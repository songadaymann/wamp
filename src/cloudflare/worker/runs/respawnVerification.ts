import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../../../config/room';
import type { CourseSnapshot } from '../../../courses/model';
import { getObjectRespawnCheckpointPoint, type RespawnCheckpointReference } from '../../../goals/respawnCheckpoints';
import type { RoomSnapshot } from '../../../persistence/roomModel';
import { PLAYER_BASE_HEIGHT } from '../../../player/geometry';
import { MAX_RUN_RESPAWN_EVENTS, type RankedRunTraceBreadcrumb, type RankedRunTraceGoalEvent,
  type RankedRunTraceRespawnEvent, type RankedRunVerificationTrace } from '../../../runs/verificationTrace';
import { resolveCourseStartRoomRef } from '../../../scenes/overworld/courseStartRoom';
import { resolveGoalRunStartPoint } from '../../../scenes/overworld/goalRunStartGate';

const TOUCH_RADIUS_PX = 64;
const RESPAWN_RADIUS_PX = 24;
const NEAREST_TOUCH_SAMPLE_MS = 300;

interface BoundCheckpoint extends RespawnCheckpointReference {
  roomId: string;
  roomX: number;
  roomY: number;
  x: number;
  y: number;
}
export interface RankedRunPhysicalSample extends RankedRunTraceBreadcrumb {
  segment: number;
  index: number;
  beforeRespawn: boolean;
}
type RespawnValidation = { respawns: Map<number, RankedRunTraceRespawnEvent> } | {
  reason: 'trace_path' | 'trace_goal' | 'trace_invalid' | 'trace_size' | 'trace_time' | 'trace_timeout';
  summary: { issue: string };
};

/** Only authored, touched checkpoints (or the authored start) authorize a reset. */
export function validateTraceRespawns(input: {
  trace: RankedRunVerificationTrace;
  room?: RoomSnapshot;
  course?: CourseSnapshot;
  roomsById: Map<string, RoomSnapshot>;
  deaths: number;
  deadline: number;
}): RespawnValidation {
  const { trace } = input;
  const events = trace.respawnEvents ?? [];
  const respawns = new Map<number, RankedRunTraceRespawnEvent>();
  if (!events.length && !trace.goalEvents.some(isCheckpointEvent)) return { respawns };
  if (events.length > MAX_RUN_RESPAWN_EVENTS) return fail('trace_size', 'respawn_limit');
  if (!Number.isSafeInteger(input.deaths) || input.deaths < events.length) return fail('trace_invalid', 'respawn_death_count');
  const rooms = new Map(input.course
    ? input.course.roomRefs.flatMap(ref => {
      const room = input.roomsById.get(ref.roomId); return room ? [[ref.roomId, room] as const] : [];
    }) : input.room ? [[input.room.id, input.room] as const] : []);
  const roomsByCoordinates = new Map([...rooms.values()].map(room => [`${room.coordinates.x},${room.coordinates.y}`, room]));
  let previousIndex = 0; let previousGoalCount = 0; let previousTime = -1;
  for (const event of events) {
    if (!Number.isSafeInteger(event.breadcrumbIndex) || event.breadcrumbIndex <= previousIndex
      || event.breadcrumbIndex >= trace.breadcrumbs.length
      || !Number.isSafeInteger(event.goalEventCount) || event.goalEventCount < previousGoalCount
      || event.goalEventCount > trace.goalEvents.length) return fail('trace_invalid', 'respawn_index');
    const after = trace.breadcrumbs[event.breadcrumbIndex];
    if (event.atMs !== after.atMs || event.atMs < previousTime
      || event.atMs < trace.breadcrumbs[event.breadcrumbIndex - 1].atMs
      || !roomsByCoordinates.has(`${event.fromRoomX},${event.fromRoomY}`)
      || !roomsByCoordinates.has(`${after.roomX},${after.roomY}`)
      || !Number.isFinite(event.fromX) || !Number.isFinite(event.fromY)
      || Math.abs(after.vx) > 1 || Math.abs(after.vy) > 1) return fail('trace_path', 'respawn_frame');
    if (trace.goalEvents[event.goalEventCount]?.atMs < event.atMs) return fail('trace_time', 'respawn_goal_event_count');
    respawns.set(event.breadcrumbIndex, event);
    previousIndex = event.breadcrumbIndex; previousGoalCount = event.goalEventCount; previousTime = event.atMs;
  }
  const samples = buildTracePhysicalSamples(trace.breadcrumbs, respawns);
  let latest: BoundCheckpoint | null = null; let consumed = 0; let nextGoalIndex = 0;
  const touchedObjects = new Set<string>();
  const goal = input.course?.goal ?? input.room?.goal;
  const consume = (count: number, cutoff: number, maxTime: number): RespawnValidation | null => {
    for (; consumed < count; consumed += 1) {
      if (Date.now() > input.deadline) return fail('trace_timeout', 'respawn_timeout');
      const event = trace.goalEvents[consumed];
      if (event.atMs > maxTime) return fail('trace_time', 'checkpoint_after_respawn');
      if (!isCheckpointEvent(event)) continue;
      const room = event.roomId ? rooms.get(event.roomId) : null;
      if (!room || room.coordinates.x !== event.roomX || room.coordinates.y !== event.roomY
        || event.actor !== 'player') return fail('trace_goal', 'checkpoint_room');
      let point: { x: number; y: number } | null = null;
      let bound: BoundCheckpoint;
      if (event.type === 'respawn_checkpoint') {
        const placed = room.placedObjects.find(object => object.instanceId === event.instanceId);
        point = placed ? getObjectRespawnCheckpointPoint(placed) : null;
        if (!point || !event.instanceId || event.checkpointIndex !== null) return fail('trace_goal', 'checkpoint_object');
        bound = { kind: 'object', roomId: room.id, roomX: event.roomX, roomY: event.roomY,
          ...point, instanceId: event.instanceId, checkpointIndex: null };
      } else {
        if (goal?.type !== 'checkpoint_sprint' || event.checkpointIndex !== nextGoalIndex
          || event.instanceId !== null) return fail('trace_goal', 'checkpoint_order');
        const marker = goal.checkpoints[nextGoalIndex];
        if (!marker || ('roomId' in marker && marker.roomId !== room.id)) return fail('trace_goal', 'checkpoint_marker');
        point = marker;
        bound = { kind: 'goal', roomId: room.id, roomX: event.roomX, roomY: event.roomY,
          x: marker.x, y: marker.y, instanceId: null, checkpointIndex: nextGoalIndex };
      }
      if (Math.hypot(event.x - point.x, event.y - point.y) > 1
        || !supportsTouch(event, samples, cutoff)) return fail('trace_goal', 'checkpoint_untouched');
      if (bound.kind === 'goal') nextGoalIndex += 1;
      else {
        const key = JSON.stringify([bound.roomId, bound.instanceId]);
        if (touchedObjects.has(key)) continue;
        touchedObjects.add(key);
      }
      latest = bound;
    }
    return null;
  };
  for (const event of events) {
    const failure = consume(event.goalEventCount, event.breadcrumbIndex, event.atMs);
    if (failure) return failure;
    const after = trace.breadcrumbs[event.breadcrumbIndex];
    const target = latest ?? getStartCheckpoint(input.room, input.course, rooms, trace.breadcrumbs[0]);
    if (!target || event.kind !== target.kind || event.instanceId !== target.instanceId
      || event.checkpointIndex !== target.checkpointIndex
      || after.roomX !== target.roomX || after.roomY !== target.roomY
      || Math.hypot(after.x - target.x, after.y - target.y) > RESPAWN_RADIUS_PX) {
      return fail('trace_path', 'respawn_destination');
    }
  }
  const failure = consume(trace.goalEvents.length, trace.breadcrumbs.length, trace.traceDurationMs);
  return failure ?? { respawns };
}

function getStartCheckpoint(room: RoomSnapshot | undefined, course: CourseSnapshot | undefined,
  rooms: Map<string, RoomSnapshot>, first: RankedRunTraceBreadcrumb | undefined): BoundCheckpoint | null {
  if (course) {
    const ref = resolveCourseStartRoomRef(course, { selectedRoomId: first ? `${first.roomX},${first.roomY}` : null,
      roomRefHasSpawnPoint: candidate => Boolean(rooms.get(candidate.roomId)?.spawnPoint) });
    room = ref ? rooms.get(ref.roomId) : undefined;
    if (room && course.startPoint?.roomId === room.id) return {
      ...course.startPoint, roomX: room.coordinates.x, roomY: room.coordinates.y,
      kind: 'start', instanceId: null, checkpointIndex: null,
    };
  }
  if (!room) return null;
  // This existing owner is Phaser-free and shares surface/headroom rules with play.
  const start = resolveGoalRunStartPoint(room, PLAYER_BASE_HEIGHT);
  return { roomId: room.id, roomX: room.coordinates.x, roomY: room.coordinates.y,
    x: start.x - room.coordinates.x * ROOM_PX_WIDTH, y: start.y - room.coordinates.y * ROOM_PX_HEIGHT,
    kind: 'start', instanceId: null, checkpointIndex: null };
}

/** The death and its respawn belong to separate physical paths, even at the same time. */
export function buildTracePhysicalSamples(breadcrumbs: RankedRunTraceBreadcrumb[],
  respawns: ReadonlyMap<number, RankedRunTraceRespawnEvent>): RankedRunPhysicalSample[] {
  const samples: RankedRunPhysicalSample[] = []; let segment = 0;
  breadcrumbs.forEach((breadcrumb, index) => {
    const respawn = respawns.get(index);
    if (respawn) {
      samples.push({ atMs: respawn.atMs, roomX: respawn.fromRoomX, roomY: respawn.fromRoomY,
        x: respawn.fromX, y: respawn.fromY, vx: 0, vy: 0, grounded: false,
        segment, index, beforeRespawn: true });
      segment += 1;
    }
    samples.push({ ...breadcrumb, segment, index, beforeRespawn: false });
  });
  return samples;
}

function supportsTouch(event: RankedRunTraceGoalEvent, samples: RankedRunPhysicalSample[], cutoff: number): boolean {
  const x = event.roomX * ROOM_PX_WIDTH + event.x; const y = event.roomY * ROOM_PX_HEIGHT + event.y;
  let previous: RankedRunPhysicalSample | null = null;
  for (const sample of samples) {
    if (sample.index >= cutoff && !(sample.index === cutoff && sample.beforeRespawn)) break;
    const sx = sample.roomX * ROOM_PX_WIDTH + sample.x; const sy = sample.roomY * ROOM_PX_HEIGHT + sample.y;
    if (Math.abs(event.atMs - sample.atMs) <= NEAREST_TOUCH_SAMPLE_MS
      && Math.hypot(x - sx, y - sy) <= TOUCH_RADIUS_PX) return true;
    if (previous && previous.segment === sample.segment && previous.atMs <= event.atMs
      && sample.atMs > previous.atMs && sample.atMs >= event.atMs) {
      const fraction = (event.atMs - previous.atMs) / (sample.atMs - previous.atMs);
      const px = previous.roomX * ROOM_PX_WIDTH + previous.x; const py = previous.roomY * ROOM_PX_HEIGHT + previous.y;
      if (Math.hypot(x - (px + (sx - px) * fraction), y - (py + (sy - py) * fraction)) <= TOUCH_RADIUS_PX) return true;
    }
    previous = sample;
  }
  return false;
}

function isCheckpointEvent(event: RankedRunTraceGoalEvent): boolean {
  return event.type === 'checkpoint' || event.type === 'respawn_checkpoint';
}
function fail(reason: Exclude<RespawnValidation, { respawns: unknown }>['reason'], issue: string): RespawnValidation {
  return { reason, summary: { issue } };
}

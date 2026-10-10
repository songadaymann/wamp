import { describe, expect, it, vi } from 'vitest';
import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../../../config/room';
import { createDefaultCourseSnapshot } from '../../../courses/model';
import { setCourseObjectLink } from '../../../courses/objectLinks';
import { createDefaultRoomSnapshot, type RoomSnapshot } from '../../../persistence/roomModel';
import { PLAYER_BASE_HEIGHT } from '../../../player/geometry';
import { listPortalHops } from '../../../runs/portalHops';
import { normalizeRankedRunVerificationTrace } from '../../../runs/verificationTrace';
import { resolveGoalRunStartPoint } from '../../../scenes/overworld/goalRunStartGate';
import { RankedRunTraceRecorder, type RankedRunTraceFrameInput } from '../../../scenes/overworld/rankedRunTraceRecorder';
import type { Env } from '../core/types';
import { recordRunVerificationAudit, verifyCourseRunTrace, verifyRoomRunTrace, type RunVerificationAuditInput } from './verification';

const binding = { verificationNonce: 'bound-nonce', verificationSnapshotHash: 'bound-snapshot' };
const clientBinding = { verificationNonce: 'bound-nonce', snapshotHash: 'bound-snapshot', verificationSchemaVersion: 1 };
const FRAME_MS = 1000 / 60;
const frame = (roomX: number, x: number, y = 256, horizontalInput = 0): RankedRunTraceFrameInput => ({
  roomCoordinates: { x: roomX, y: 0 }, x, y, vx: 0, vy: 0, grounded: true,
  horizontalInput, verticalInput: 0, jumpPressed: false,
});

/** Records 60fps play moving steadily from one x to another, as the scene would. */
function walk(recorder: RankedRunTraceRecorder, roomX: number, fromX: number, toX: number, ms: number,
  input: (index: number) => number = () => 0): number {
  const frames = Math.max(1, Math.round(ms / FRAME_MS));
  for (let index = 1; index <= frames; index += 1) {
    recorder.recordFrame(FRAME_MS, frame(roomX, fromX + ((toX - fromX) * index) / frames, 256, input(index)));
  }
  return frames * FRAME_MS;
}

function exitEvent(room: Pick<RoomSnapshot, 'id' | 'coordinates'>, x: number) {
  return { type: 'reach_exit' as const, actor: 'player' as const, roomId: room.id,
    roomX: room.coordinates.x, roomY: room.coordinates.y, x, y: 256, instanceId: null, checkpointIndex: null };
}

function portalRoom(portals: Array<{ id: 'portal_a' | 'portal_b'; instanceId: string; x: number; target?: string }>,
  exitX: number): RoomSnapshot {
  const room = { ...createDefaultRoomSnapshot(), spawnPoint: { x: 320, y: 256 } };
  room.goal = { type: 'reach_exit', exit: { x: exitX, y: 256 }, timeLimitMs: null };
  room.placedObjects = portals.map(({ id, instanceId, x, target }) => ({
    id, instanceId, x, y: 256, ...(target ? { triggerTargetInstanceId: target } : {}),
  }));
  return room;
}

/** Spawn at 320, walk left to the portal at 96, come out at 544 and walk on to the exit. */
function sameRoomPortalRun(room: RoomSnapshot) {
  const recorder = new RankedRunTraceRecorder(); recorder.start('room', clientBinding, frame(0, 320));
  let elapsed = walk(recorder, 0, 320, 96, 400);
  recorder.recordFrame(FRAME_MS, frame(0, 544)); elapsed += FRAME_MS;
  elapsed += walk(recorder, 0, 544, 600, 300);
  recorder.recordGoalEvent(exitEvent(room, 600));
  return { trace: recorder.buildTrace(elapsed)!, binding, room, elapsedMs: elapsed, deaths: 0 };
}

describe('ranked trace coverage for honest play', () => {
  it('lists each portal teleport the published room allows, including the unlinked return trip', () => {
    const room = portalRoom([{ id: 'portal_a', instanceId: 'a', x: 96, target: 'b' }, { id: 'portal_b', instanceId: 'b', x: 544 }], 600);
    expect(listPortalHops([room])).toEqual([
      { from: { roomX: 0, roomY: 0, x: 96, y: 256 }, to: { roomX: 0, roomY: 0, x: 544, y: 256 } },
      { from: { roomX: 0, roomY: 0, x: 544, y: 256 }, to: { roomX: 0, roomY: 0, x: 96, y: 256 } },
    ]);
    // Same-type or missing targets never teleport.
    room.placedObjects[1].id = 'portal_a';
    expect(listPortalHops([room])).toEqual([]);
  });

  it('accepts a portal teleport across the room, and rejects the same jump with no portal there', async () => {
    const room = portalRoom([{ id: 'portal_a', instanceId: 'a', x: 96, target: 'b' }, { id: 'portal_b', instanceId: 'b', x: 544 }], 600);
    const result = await verifyRoomRunTrace(sameRoomPortalRun(room));
    expect(result.status, JSON.stringify(result.summary)).toBe('passed');

    const withoutPortals = await verifyRoomRunTrace(sameRoomPortalRun({ ...room, placedObjects: [] }));
    expect(withoutPortals.status).toBe('failed'); expect(withoutPortals.reason).toBe('trace_path');
  });

  it('accepts the return trip through an unlinked portal', async () => {
    const room = portalRoom([{ id: 'portal_a', instanceId: 'a', x: 96, target: 'b' }, { id: 'portal_b', instanceId: 'b', x: 544 }], 40);
    const recorder = new RankedRunTraceRecorder(); recorder.start('room', clientBinding, frame(0, 320));
    let elapsed = walk(recorder, 0, 320, 544, 400);
    recorder.recordFrame(FRAME_MS, frame(0, 96)); elapsed += FRAME_MS;
    elapsed += walk(recorder, 0, 96, 40, 300);
    recorder.recordGoalEvent(exitEvent(room, 40));
    const result = await verifyRoomRunTrace({ trace: recorder.buildTrace(elapsed)!, binding, room, elapsedMs: elapsed, deaths: 0 });
    expect(result.status, JSON.stringify(result.summary)).toBe('passed');
  });

  it('still rejects a jump that no portal in the room can explain', async () => {
    const room = portalRoom([{ id: 'portal_a', instanceId: 'a', x: 40, target: 'b' }, { id: 'portal_b', instanceId: 'b', x: 80 }], 600);
    const result = await verifyRoomRunTrace(sameRoomPortalRun(room));
    expect(result.status).toBe('failed'); expect(result.reason).toBe('trace_path');
  });

  it('accepts a course portal link between rooms that are not neighbours, and only with that link', async () => {
    const rooms = [0, 1, 2, 3].map((x) => ({ ...createDefaultRoomSnapshot(), id: `${x},0`, coordinates: { x, y: 0 },
      spawnPoint: { x: 64, y: 256 } }));
    rooms[0].placedObjects = [{ id: 'portal_a', instanceId: 'a', x: 560, y: 256 }];
    rooms[3].placedObjects = [{ id: 'portal_b', instanceId: 'b', x: 96, y: 256 }];
    const course = { ...createDefaultCourseSnapshot('portal-test'), startPoint: { roomId: '0,0', x: 64, y: 256 },
      roomRefs: rooms.map((room) => ({ roomId: room.id, coordinates: room.coordinates, roomVersion: 0, roomTitle: null })) };
    course.goal = { type: 'reach_exit', exit: { roomId: '3,0', x: 200, y: 256 }, timeLimitMs: null };
    setCourseObjectLink(course, { triggerRoomId: '0,0', triggerInstanceId: 'a', targetRoomId: '3,0', targetInstanceId: 'b' },
      { triggerRoomId: '0,0', triggerInstanceId: 'a' });
    const recorder = new RankedRunTraceRecorder(); recorder.start('course', clientBinding, frame(0, 64));
    let elapsed = walk(recorder, 0, 64, 560, 700);
    recorder.recordFrame(FRAME_MS, frame(3, 96)); elapsed += FRAME_MS;
    elapsed += walk(recorder, 3, 96, 200, 300);
    recorder.recordGoalEvent(exitEvent(rooms[3], 200));
    const input = { trace: recorder.buildTrace(elapsed)!, binding, course,
      roomsById: new Map(rooms.map((room) => [room.id, room])), elapsedMs: elapsed, deaths: 0 };
    expect(input.trace.roomTransitions).toEqual([expect.objectContaining({ fromRoomX: 0, toRoomX: 3, x: 96 })]);
    const result = await verifyCourseRunTrace(input);
    expect(result.status, JSON.stringify(result.summary)).toBe('passed');

    setCourseObjectLink(course, null, { triggerRoomId: '0,0', triggerInstanceId: 'a' });
    const unlinked = await verifyCourseRunTrace(input);
    expect(unlinked.status).toBe('failed'); expect(['trace_path', 'trace_transition']).toContain(unlinked.reason);
  });

  it('accepts a 12-minute run with 300 deaths and steady input, well past the old trace limits', async () => {
    const room = { ...createDefaultRoomSnapshot(), spawnPoint: { x: 64, y: 256 } };
    room.goal = { type: 'reach_exit', exit: { x: 560, y: 256 }, timeLimitMs: null };
    const start = resolveGoalRunStartPoint(room, PLAYER_BASE_HEIGHT);
    const startX = start.x - room.coordinates.x * ROOM_PX_WIDTH, startY = start.y - room.coordinates.y * ROOM_PX_HEIGHT;
    const recorder = new RankedRunTraceRecorder();
    recorder.start('room', clientBinding, { ...frame(0, startX), y: startY });
    // About six input changes a second, the top of what honest play records.
    const pressing = (index: number) => (index % 20 < 10 ? 1 : 0);
    let elapsed = 0;
    for (let death = 0; death < 300; death += 1) {
      elapsed += walk(recorder, 0, startX, 400, 2400, pressing);
      recorder.recordDeath(frame(0, 400));
      recorder.recordRespawn({ ...frame(0, startX), y: startY }, { kind: 'start', instanceId: null, checkpointIndex: null });
    }
    elapsed += walk(recorder, 0, startX, 560, 600, pressing);
    recorder.recordGoalEvent(exitEvent(room, 560));
    const trace = recorder.buildTrace(elapsed)!;
    expect(trace.breadcrumbs.length).toBeGreaterThan(3_000);
    expect(trace.inputEvents.length).toBeGreaterThan(4_000);
    expect(trace.respawnEvents).toHaveLength(300);
    // The route normalizes the body before verifying; it must keep every respawn.
    expect(normalizeRankedRunVerificationTrace(JSON.parse(JSON.stringify(trace)))?.respawnEvents).toHaveLength(300);
    const result = await verifyRoomRunTrace({ trace, binding, room, elapsedMs: elapsed, deaths: 300 });
    expect(result.status, JSON.stringify(result.summary)).toBe('passed');
  });

  it('keeps an oversized trace out of the audit row but records that it was omitted', async () => {
    const bind = vi.fn((...values: unknown[]) => values);
    const env = { DB: { prepare: vi.fn(() => ({ bind })), batch: vi.fn(async () => []) } } as unknown as Env;
    const audit: Omit<RunVerificationAuditInput, 'trace'> = { attemptId: 'attempt', kind: 'room', status: 'passed',
      triggerReason: 'record_gap', verificationReason: null, summary: { trigger: null }, createdAt: '2026-10-10T00:00:00.000Z' };
    const breadcrumbs = Array.from({ length: 16_000 }, (_, index) => ({ atMs: index * 250, roomX: 0, roomY: 0, x: 100.123456, y: 200.654321, vx: 0, vy: 0, grounded: true }));
    const big = { ...sameRoomPortalRun(portalRoom([], 600)).trace, breadcrumbs };
    await recordRunVerificationAudit(env, { ...audit, trace: big });
    const [, , , , , summaryJson, traceJson] = bind.mock.calls[0];
    expect(traceJson).toBeNull();
    expect(JSON.parse(summaryJson as string).traceOmitted.chars).toBeGreaterThan(1_500_000);

    await recordRunVerificationAudit(env, { ...audit, trace: sameRoomPortalRun(portalRoom([], 600)).trace });
    expect(typeof bind.mock.calls[1][6]).toBe('string');
  });
});

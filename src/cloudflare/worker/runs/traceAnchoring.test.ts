import { describe, expect, it } from 'vitest';
import { createDefaultCourseSnapshot } from '../../../courses/model';
import { createDefaultRoomSnapshot, type RoomSnapshot } from '../../../persistence/roomModel';
import type { RankedRunVerificationTrace } from '../../../runs/verificationTrace';
import { RankedRunTraceRecorder, type RankedRunTraceFrameInput } from '../../../scenes/overworld/rankedRunTraceRecorder';
import { verifyCourseRunTrace, verifyRoomRunTrace } from './verification';

const binding = { verificationNonce: 'bound-nonce', verificationSnapshotHash: 'bound-snapshot' };
const clientBinding = { verificationNonce: 'bound-nonce', snapshotHash: 'bound-snapshot', verificationSchemaVersion: 1 };
const FRAME_MS = 1000 / 60;
const frame = (x: number, y = 256): RankedRunTraceFrameInput => ({
  roomCoordinates: { x: 0, y: 0 }, x, y, vx: 0, vy: 0, grounded: true, horizontalInput: 0, verticalInput: 0, jumpPressed: false,
});
const event = (type: 'reach_exit' | 'enemy', x: number, instanceId: string | null = null) => ({
  type, actor: 'player' as const, roomId: '0,0', roomX: 0, roomY: 0, x, y: 256, instanceId, checkpointIndex: null,
});

function exitRoom(): RoomSnapshot {
  const room = { ...createDefaultRoomSnapshot(), spawnPoint: { x: 64, y: 256 } };
  room.goal = { type: 'reach_exit', exit: { x: 600, y: 256 }, timeLimitMs: null };
  return room;
}

/** Records 60fps play walking from one x to another. */
function walk(recorder: RankedRunTraceRecorder, fromX: number, toX: number, ms: number): number {
  const frames = Math.round(ms / FRAME_MS);
  for (let index = 1; index <= frames; index += 1) recorder.recordFrame(FRAME_MS, frame(fromX + ((toX - fromX) * index) / frames));
  return frames * FRAME_MS;
}

function honestExitRun(room = exitRoom()) {
  const recorder = new RankedRunTraceRecorder(); recorder.start('room', clientBinding, frame(64));
  const elapsedMs = walk(recorder, 64, 600, 1_200);
  recorder.recordGoalEvent(event('reach_exit', 600));
  return { trace: recorder.buildTrace(elapsedMs)!, binding, room, elapsedMs, deaths: 0 };
}

function handMadeTrace(breadcrumbs: Array<[number, number]>, durationMs: number, goalEvents = [{ ...event('reach_exit', 600), atMs: durationMs }]):
RankedRunVerificationTrace {
  return { schemaVersion: 1, verificationNonce: 'bound-nonce', snapshotHash: 'bound-snapshot', traceDurationMs: durationMs,
    inputEvents: [], roomTransitions: [], deathEvents: [], goalEvents,
    breadcrumbs: breadcrumbs.map(([atMs, x]) => ({ atMs, roomX: 0, roomY: 0, x, y: 256, vx: 0, vy: 0, grounded: true })) };
}

describe('ranked traces must cover the whole run', () => {
  it('accepts an honest run recorded from the start point to the exit', async () => {
    const result = await verifyRoomRunTrace(honestExitRun());
    expect(result.status, JSON.stringify(result.summary)).toBe('passed');
  });

  it('rejects a trace that is just one breadcrumb at the exit', async () => {
    const recorder = new RankedRunTraceRecorder(); recorder.start('room', clientBinding, frame(600));
    recorder.recordFrame(300, frame(600));
    recorder.recordGoalEvent(event('reach_exit', 600));
    const result = await verifyRoomRunTrace({ trace: recorder.buildTrace(300)!, binding, room: exitRoom(), elapsedMs: 300, deaths: 0 });
    expect(result.status).toBe('failed'); expect(result.summary).toMatchObject({ issue: 'start_anchor' });
  });

  it('rejects a start and an exit with nothing recorded in between', async () => {
    const result = await verifyRoomRunTrace({ trace: handMadeTrace([[0, 64], [1_500, 600]], 1_500), binding, room: exitRoom(), elapsedMs: 1_500, deaths: 0 });
    expect(result.status).toBe('failed'); expect(result.summary).toMatchObject({ issue: 'breadcrumb_gap', deltaMs: 1_500 });
  });

  it('rejects a trace with no breadcrumbs, or whose recording starts late', async () => {
    const empty = await verifyRoomRunTrace({ trace: handMadeTrace([], 1_000), binding, room: exitRoom(), elapsedMs: 1_000, deaths: 0 });
    expect(empty.summary).toMatchObject({ issue: 'no_breadcrumbs' });
    const input = honestExitRun(); input.trace.breadcrumbs[0].atMs = 120;
    const late = await verifyRoomRunTrace(input);
    expect(late.status).toBe('failed'); expect(late.summary).toMatchObject({ issue: 'late_first_breadcrumb' });
  });

  it('rejects a goal event long after the recording stopped', async () => {
    const input = honestExitRun();
    const lastAt = input.trace.breadcrumbs.at(-1)!.atMs;
    input.trace.goalEvents[0].atMs = lastAt + 1_500;
    input.trace.traceDurationMs = input.elapsedMs = lastAt + 1_500;
    const result = await verifyRoomRunTrace(input);
    expect(result.status).toBe('failed'); expect(result.summary).toMatchObject({ issue: 'goal_event_after_trace' });
  });

  it('requires a defeated enemy to be near the player when it is defeated', async () => {
    const room = { ...createDefaultRoomSnapshot(), spawnPoint: { x: 64, y: 256 } };
    room.goal = { type: 'defeat_all', timeLimitMs: null };
    room.placedObjects = [{ id: 'slime_blue', instanceId: 'slime', x: 560, y: 256 }];
    const play = (reachX: number) => {
      const recorder = new RankedRunTraceRecorder(); recorder.start('room', clientBinding, frame(64));
      const elapsedMs = walk(recorder, 64, reachX, 1_200);
      recorder.recordGoalEvent(event('enemy', 560, 'slime'));
      return { trace: recorder.buildTrace(elapsedMs)!, binding, room, elapsedMs, deaths: 0 };
    };
    const stomped = await verifyRoomRunTrace(play(548));
    expect(stomped.status, JSON.stringify(stomped.summary)).toBe('passed');
    expect(stomped.derivedMetrics.enemiesDefeated).toBe(1);
    const fromAcrossTheRoom = await verifyRoomRunTrace(play(90));
    expect(fromAcrossTheRoom.status).toBe('failed');
    expect(fromAcrossTheRoom.summary).toMatchObject({ issue: 'goal_event_path_mismatch', type: 'enemy' });
  });

  it('anchors an Expanded Room run at the course start point', async () => {
    const room = exitRoom();
    const course = { ...createDefaultCourseSnapshot('anchor'), startPoint: { roomId: room.id, x: 64, y: 256 },
      roomRefs: [{ roomId: room.id, coordinates: room.coordinates, roomVersion: 0, roomTitle: null }] };
    course.goal = { type: 'reach_exit', exit: { roomId: room.id, x: 600, y: 256 }, timeLimitMs: null };
    const honest = honestExitRun(room);
    const roomsById = new Map([[room.id, room]]);
    expect((await verifyCourseRunTrace({ ...honest, course, roomsById })).status).toBe('passed');
    const recorder = new RankedRunTraceRecorder(); recorder.start('course', clientBinding, frame(600));
    recorder.recordFrame(300, frame(600)); recorder.recordGoalEvent(event('reach_exit', 600));
    const fake = await verifyCourseRunTrace({ trace: recorder.buildTrace(300)!, binding, course, roomsById, elapsedMs: 300, deaths: 0 });
    expect(fake.status).toBe('failed'); expect(fake.summary).toMatchObject({ issue: 'start_anchor' });
  });
});

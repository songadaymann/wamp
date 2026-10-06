import { describe, expect, it } from 'vitest';
import { createDefaultCourseSnapshot } from '../../../courses/model';
import { createDefaultRoomSnapshot } from '../../../persistence/roomModel';
import { RankedRunTraceRecorder, type RankedRunTraceFrameInput } from '../../../scenes/overworld/rankedRunTraceRecorder';
import { verifyCourseRunTrace, verifyRoomRunTrace } from './verification';

const binding = { verificationNonce: 'bound-nonce', verificationSnapshotHash: 'bound-snapshot' };
const clientBinding = { verificationNonce: 'bound-nonce', snapshotHash: 'bound-snapshot', verificationSchemaVersion: 1 };
const frame = (roomX: number, x: number, y = 256): RankedRunTraceFrameInput => ({
  roomCoordinates: { x: roomX, y: 0 }, x, y, vx: 0, vy: 0, grounded: true,
  horizontalInput: 0, verticalInput: 0, jumpPressed: false,
});

function courseRun(kind: 'object' | 'goal' | 'start' = 'object') {
  const rooms = [0,1,2,3].map(x => ({ ...createDefaultRoomSnapshot(), id: `${x},0`,
    coordinates: { x, y: 0 }, spawnPoint: { x: 64, y: 256 } }));
  rooms[0].placedObjects = [{ id: 'checkpoint_flag', instanceId: 'flag-1', x: 320, y: 240 }];
  const course = { ...createDefaultCourseSnapshot('checkpoint-test'),
    startPoint: { roomId: '0,0', x: 64, y: 256 },
    roomRefs: rooms.map(room => ({ roomId: room.id, coordinates: room.coordinates, roomVersion: 0, roomTitle: null })),
  };
  course.goal = kind === 'goal'
    ? { type: 'checkpoint_sprint', checkpoints: [{ roomId: '0,0', x: 320, y: 256 }],
      finish: { roomId: '3,0', x: 96, y: 256 }, timeLimitMs: null }
    : { type: 'reach_exit', exit: { roomId: '3,0', x: 96, y: 256 }, timeLimitMs: null };
  const recorder = new RankedRunTraceRecorder(); recorder.start('course', clientBinding, frame(0,64));
  recorder.recordFrame(1000, frame(0,320));
  if (kind !== 'start') recorder.recordGoalEvent({
    type: kind === 'object' ? 'respawn_checkpoint' : 'checkpoint', actor: 'player',
    roomId: '0,0', roomX: 0, roomY: 0, x: 320, y: 256,
    instanceId: kind === 'object' ? 'flag-1' : null, checkpointIndex: kind === 'goal' ? 0 : null,
  });
  recorder.recordFrame(1000, frame(1,224)); recorder.recordFrame(1000, frame(2,96));
  recorder.recordDeath(frame(2,100,280));
  recorder.recordRespawn(frame(0,kind === 'start' ? 64 : 320), { kind,
    instanceId: kind === 'object' ? 'flag-1' : null, checkpointIndex: kind === 'goal' ? 0 : null });
  recorder.recordFrame(1000, frame(0,416)); recorder.recordFrame(1000, frame(1,320));
  recorder.recordFrame(1000, frame(2,224)); recorder.recordFrame(1000, frame(3,96));
  recorder.recordGoalEvent({ type: kind === 'goal' ? 'finish' : 'reach_exit', actor: 'player',
    roomId: '3,0', roomX: 3, roomY: 0, x: 96, y: 256, instanceId: null, checkpointIndex: null });
  return { trace: recorder.buildTrace(7000)!, binding, course,
    roomsById: new Map(rooms.map(room => [room.id, room])), elapsedMs: 7000, deaths: 1 };
}

describe('ranked respawn trace verification', () => {
  it.each(['object','goal','start'] as const)('accepts an authored %s respawn across two rooms with the death retained', async kind => {
    const input = courseRun(kind);
    expect(input.trace.roomTransitions.every(event => Math.abs(event.toRoomX - event.fromRoomX) === 1)).toBe(true);
    const result = await verifyCourseRunTrace(input);
    expect(result.status, JSON.stringify(result)).toBe('passed');
    expect(result.summary.respawnEvents).toBe(1);
    expect(result.derivedMetrics.checkpointsReached).toBe(kind === 'goal' ? 1 : 0);
  });

  it('keeps normal movement checks for an unmarked teleport', async () => {
    const input = courseRun(); delete input.trace.respawnEvents;
    expect((await verifyCourseRunTrace(input)).status).toBe('failed');
  });

  it('rejects a touched-flag claim justified only by its fabricated post-respawn position', async () => {
    const input = courseRun();
    input.roomsById.get('3,0')!.placedObjects = [{ id: 'checkpoint_flag', instanceId: 'future', x: 96, y: 240 }];
    Object.assign(input.trace.goalEvents[0], { atMs: 2000, roomId: '3,0', roomX: 3, x: 96, instanceId: 'future' });
    Object.assign(input.trace.respawnEvents![0], { instanceId: 'future' });
    Object.assign(input.trace.breadcrumbs[4], { roomX: 3, x: 96 });
    const result = await verifyCourseRunTrace(input);
    expect(result.status).toBe('failed'); expect(result.summary.issue).toBe('checkpoint_untouched');
  });

  it('rejects a flag that was never touched', async () => {
    const input = courseRun(); input.trace.goalEvents.shift(); input.trace.respawnEvents![0].goalEventCount = 0;
    const result = await verifyCourseRunTrace(input);
    expect(result.status).toBe('failed'); expect(result.summary.issue).toBe('respawn_destination');
  });

  it('rejects checkpoints from a private or changed snapshot rather than the bound publication', async () => {
    const input = courseRun(); input.roomsById.get('0,0')!.placedObjects = [];
    const result = await verifyCourseRunTrace(input);
    expect(result.status).toBe('failed'); expect(result.summary.issue).toBe('checkpoint_object');
  });

  it('rejects a reset without a counted death', async () => {
    const result = await verifyCourseRunTrace({ ...courseRun(), deaths: 0 });
    expect(result.status).toBe('failed'); expect(result.summary.issue).toBe('respawn_death_count');
  });

  it('checks movement into the reported death point rather than skipping the whole step', async () => {
    const input = courseRun(); input.trace.respawnEvents![0].fromX = 10000;
    const result = await verifyCourseRunTrace(input);
    expect(result.status).toBe('failed'); expect(result.reason).toBe('trace_path');
  });

  it('rejects unknown or repeated reset indices and goal-event count regressions', async () => {
    const input = courseRun(); input.trace.respawnEvents!.push({ ...input.trace.respawnEvents![0] });
    input.deaths = 2;
    const result = await verifyCourseRunTrace(input);
    expect(result.status).toBe('failed'); expect(result.summary.issue).toBe('respawn_index');
  });

  it('requires Sprint checkpoints in authored order and at their authored position', async () => {
    const input = courseRun('goal'); input.trace.goalEvents[0].checkpointIndex = 1;
    const result = await verifyCourseRunTrace(input);
    expect(result.status).toBe('failed'); expect(result.summary.issue).toBe('checkpoint_order');
  });

  it('rejects a reset to another location even if the flag itself was touched', async () => {
    const input = courseRun(); input.trace.breadcrumbs[4].x = 400;
    const result = await verifyCourseRunTrace(input);
    expect(result.status).toBe('failed'); expect(result.summary.issue).toBe('respawn_destination');
  });

  it('does not permit a fabricated nonadjacent normal transition alongside a valid respawn', async () => {
    const input = courseRun(); input.trace.roomTransitions[0].toRoomX = 3;
    const result = await verifyCourseRunTrace(input);
    expect(result.status).toBe('failed'); expect(result.reason).toBe('trace_transition');
  });

  it('accepts ordinary room checkpoint deaths with an ongoing timer', async () => {
    const room = { ...createDefaultRoomSnapshot(), spawnPoint: { x: 64, y: 256 } };
    room.goal = { type: 'reach_exit', exit: { x: 96, y: 256 }, timeLimitMs: null };
    room.placedObjects = [{ id: 'checkpoint_flag', instanceId: 'flag', x: 320, y: 240 }];
    const recorder = new RankedRunTraceRecorder(); recorder.start('room', clientBinding, frame(0,64));
    recorder.recordFrame(1000, frame(0,320));
    recorder.recordGoalEvent({ type: 'respawn_checkpoint', actor: 'player', roomId: room.id, roomX: 0, roomY: 0,
      x: 320, y: 256, instanceId: 'flag', checkpointIndex: null });
    recorder.recordFrame(500, frame(0,416)); recorder.recordDeath(frame(0,424,280));
    recorder.recordRespawn(frame(0,320), { kind: 'object', instanceId: 'flag', checkpointIndex: null });
    recorder.recordFrame(500, frame(0,96));
    recorder.recordGoalEvent({ type: 'reach_exit', actor: 'player', roomId: room.id, roomX: 0, roomY: 0,
      x: 96, y: 256, instanceId: null, checkpointIndex: null });
    const result = await verifyRoomRunTrace({ trace: recorder.buildTrace(2000)!, binding, room, elapsedMs: 2000, deaths: 1 });
    expect(result.status, JSON.stringify(result)).toBe('passed');
  });

  it('rejects a coin claimed along the reset jump instead of the physical path before death', async () => {
    const room = { ...createDefaultRoomSnapshot(), spawnPoint: { x: 32, y: 256 } };
    room.goal = { type: 'reach_exit', exit: { x: 96, y: 256 }, timeLimitMs: null };
    room.placedObjects = [{ id: 'checkpoint_flag', instanceId: 'flag', x: 32, y: 240 },
      { id: 'coin_gold', instanceId: 'unvisited', x: 320, y: 256 }];
    const recorder = new RankedRunTraceRecorder(); recorder.start('room', clientBinding, frame(0,32));
    recorder.recordGoalEvent({ type: 'respawn_checkpoint', actor: 'player', roomId: room.id, roomX: 0, roomY: 0,
      x: 32, y: 256, instanceId: 'flag', checkpointIndex: null });
    recorder.recordFrame(1000, frame(0,608)); recorder.recordFrame(100, frame(0,608));
    recorder.recordGoalEvent({ type: 'collectible', actor: 'player', roomId: room.id, roomX: 0, roomY: 0,
      x: 320, y: 256, instanceId: 'unvisited', checkpointIndex: null });
    recorder.recordFrame(100, frame(0,608)); recorder.recordDeath(frame(0,608));
    recorder.recordRespawn(frame(0,32), { kind: 'object', instanceId: 'flag', checkpointIndex: null });
    recorder.recordFrame(500, frame(0,96));
    recorder.recordGoalEvent({ type: 'reach_exit', actor: 'player', roomId: room.id, roomX: 0, roomY: 0,
      x: 96, y: 256, instanceId: null, checkpointIndex: null });
    const result = await verifyRoomRunTrace({ room, trace: recorder.buildTrace(1700)!, binding, elapsedMs: 1700, deaths: 1 });
    expect(result.status).toBe('failed'); expect(result.summary.issue).toBe('goal_event_path_mismatch');
  });
});

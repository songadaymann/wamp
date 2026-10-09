import { describe, expect, it } from 'vitest';
import { createDefaultRoomSnapshot } from '../../../persistence/roomModel';
import { createDefaultCourseSnapshot } from '../../../courses/model';
import { RankedRunTraceRecorder, type RankedRunTraceFrameInput } from '../../../scenes/overworld/rankedRunTraceRecorder';
import { verifyRoomRunTrace, verifyCourseRunTrace } from './verification';

const binding = { verificationNonce: 'boss-nonce', verificationSnapshotHash: 'boss-snapshot' };
const clientBinding = { verificationNonce: 'boss-nonce', snapshotHash: 'boss-snapshot', verificationSchemaVersion: 1 };
const frame: RankedRunTraceFrameInput = { roomCoordinates: { x: 0, y: 0 }, x: 88, y: 288, vx: 0, vy: 0, grounded: true, horizontalInput: 0, verticalInput: 0, jumpPressed: false };
function run(hits: number | null, elapsedMs = 2200, defeatX = 128) {
  const room = createDefaultRoomSnapshot();
  room.spawnPoint = { x: 88, y: 288 }; room.goal = { type: 'defeat_all', timeLimitMs: null };
  room.placedObjects = [{ id: 'swordsman_ai', instanceId: 'boss', x: 250, y: 288, bossHitPoints: hits }];
  const recorder = new RankedRunTraceRecorder(); recorder.start('room', clientBinding, frame);
  recorder.recordFrame(elapsedMs, frame);
  recorder.recordGoalEvent({ type: 'enemy', actor: 'player', roomId: room.id, roomX: 0, roomY: 0, instanceId: 'boss', x: defeatX, y: 288, checkpointIndex: null });
  return { binding, room, elapsedMs, deaths: 0, trace: recorder.buildTrace(elapsedMs)! };
}
describe('server boss defeat plausibility', () => {
  it('accepts a boss that chases away from its authored starting point', async () => {
    expect((await verifyRoomRunTrace(run(3))).status).toBe('passed');
    expect((await verifyRoomRunTrace(run(null))).status).toBe('failed');
  });
  it('rejects too-fast and out-of-room boss defeats', async () => {
    expect((await verifyRoomRunTrace(run(3, 1199, 250))).status).toBe('failed');
    expect((await verifyRoomRunTrace(run(10, 2200, 250))).status).toBe('failed');
    expect((await verifyRoomRunTrace(run(3, 2200, 900))).status).toBe('failed');
  });
  it('uses the same immutable boss binding in expanded room verification', async () => {
    const input = run(3);
    const course = createDefaultCourseSnapshot('boss-course'); course.goal = { type: 'defeat_all', timeLimitMs: null };
    course.startPoint = { roomId: input.room.id, x: 88, y: 288 };
    course.roomRefs = [{ roomId: input.room.id, coordinates: input.room.coordinates, roomVersion: 0, roomTitle: null }];
    expect((await verifyCourseRunTrace({ ...input, course, roomsById: new Map([[input.room.id, input.room]]) })).status).toBe('passed');
  });
});

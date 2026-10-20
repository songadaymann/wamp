import { EventEmitter } from 'node:events';
import { expect, it } from 'vitest';
import { createDefaultRoomSnapshot } from '../../persistence/roomModel';
import { verifyRoomRunTrace } from '../../cloudflare/worker/runs/verification';
import { computeEffectiveElapsedMs } from '../../cloudflare/worker/courses/requestBodies';
import { gameplayNow, installGameplayClock } from './gameplayClock';
import { RankedRunTraceRecorder } from './rankedRunTraceRecorder';

it('verifies resumed simulation traces while retaining the server wall-time ranking floor', async () => {
  const scene = { events: new EventEmitter(), time: { now: 1000 } };
  const destroy = installGameplayClock(scene);
  const room = { ...createDefaultRoomSnapshot(), spawnPoint: { x: 64, y: 256 },
    goal: { type: 'reach_exit' as const, exit: { x: 600, y: 256 }, timeLimitMs: null } };
  const recorder = new RankedRunTraceRecorder();
  const frame = (x: number) => ({ roomCoordinates: { x: 0, y: 0 }, x, y: 256, vx: 0, vy: 0,
    grounded: true, horizontalInput: 1, verticalInput: 0, jumpPressed: false });
  recorder.start('room', { verificationNonce: 'pause-test', snapshotHash: 'bound-room', verificationSchemaVersion: 1 }, frame(64));
  let elapsedMs = 0;
  for (let index = 1; index <= 72; index++) {
    if (index === 37) {
      // No Scene frames, goal ticks or recorder frames run during the open menu.
      const frozenNow = gameplayNow(scene);
      scene.time.now += 60000;
      expect(gameplayNow(scene)).toBe(frozenNow);
    }
    scene.events.emit('preupdate', scene.time.now, 1000 / 60);
    recorder.recordFrame(1000 / 60, frame(64 + (536 * index) / 72));
    elapsedMs += 1000 / 60;
  }
  recorder.recordGoalEvent({ type: 'reach_exit', actor: 'player', roomId: '0,0', roomX: 0, roomY: 0,
    x: 600, y: 256, instanceId: null, checkpointIndex: null });
  const trace = recorder.buildTrace(elapsedMs)!;
  const result = await verifyRoomRunTrace({ room, trace, elapsedMs, deaths: 0,
    binding: { verificationNonce: 'pause-test', verificationSnapshotHash: 'bound-room' } });
  expect(result.status, JSON.stringify(result.summary)).toBe('passed');
  expect(trace.traceDurationMs).toBe(1200);
  expect(computeEffectiveElapsedMs('2026-10-18T00:00:00.000Z', '2026-10-18T00:01:01.200Z', elapsedMs)).toBe(61200);
  destroy();
});

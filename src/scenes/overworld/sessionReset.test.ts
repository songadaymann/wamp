import { describe, expect, it, vi } from 'vitest';
import { createDefaultRoomSnapshot } from '../../persistence/roomModel';
import { OverworldSessionResetController } from './sessionReset';

function harness(qualificationState: 'qualified' | 'practice' = 'qualified', survival = false) {
  const room = { ...createDefaultRoomSnapshot(), goal: survival
    ? { type: 'survival' as const, durationMs: 10000 }
    : { type: 'reach_exit' as const, exit: { x: 96, y: 256 }, timeLimitMs: null } };
  const run = { roomId: room.id, roomCoordinates: room.coordinates, qualificationState, goal: room.goal,
    result: 'active', elapsedMs: 3000, deaths: 0 };
  const host = { getCurrentGoalRun: () => run, getActiveCourseRun: () => null, getActiveRoomRushRun: () => null,
    hasActivePvpMatch: () => false, recordGoalRunDeath: vi.fn(() => { run.deaths++; }),
    recordCourseRunDeath: vi.fn(), recordRunDeathLocation: vi.fn(), playPlayerFailFx: vi.fn(),
    respawnPlayerToCurrentRoom: vi.fn(), clearRespawnCheckpoints: vi.fn(), showTransientStatus: vi.fn(),
    getRoomSnapshotForCoordinates: () => room, failGoalRun: vi.fn(), restartGoalRunForRoom: vi.fn(),
    refreshLeaderboardForSelection: vi.fn(), resetRoomChallengeState: vi.fn(), abandonGoalRun: vi.fn(),
    abandonRoomRushRun: vi.fn(), setActiveCourseRun: vi.fn(), clearActiveCourseRoomOverrides: vi.fn(),
    resetTransientPlayState: vi.fn(), resetGoalRunController: vi.fn(), resetRoomRushController: vi.fn(), redrawGoalMarkers: vi.fn() };
  const controller = new OverworldSessionResetController(host as unknown as ConstructorParameters<typeof OverworldSessionResetController>[0]);
  return { host, controller, run };
}
describe('death and fresh-session checkpoint boundaries', () => {
  it('retains a qualified checkpoint, timer and attempt while counting an ordinary death', () => {
    const h = harness(); h.controller.handlePlayerDeath('Ouch.');
    expect(h.run.elapsedMs).toBe(3000); expect(h.run.deaths).toBe(1);
    expect(h.host.clearRespawnCheckpoints).not.toHaveBeenCalled();
    expect(h.host.restartGoalRunForRoom).not.toHaveBeenCalled();
    expect(h.host.recordRunDeathLocation.mock.invocationCallOrder[0]).toBeLessThan(h.host.respawnPlayerToCurrentRoom.mock.invocationCallOrder[0]);
  });
  it.each(['practice', 'survival'] as const)('clears %s checkpoints before returning to the original start', kind => {
    const h = harness(kind === 'practice' ? 'practice' : 'qualified', kind === 'survival');
    h.controller.handlePlayerDeath('Ouch.');
    expect(h.host.clearRespawnCheckpoints.mock.invocationCallOrder[0]).toBeLessThan(h.host.respawnPlayerToCurrentRoom.mock.invocationCallOrder[0]);
    expect(h.host.restartGoalRunForRoom).toHaveBeenCalledTimes(1);
  });
  it('clears checkpoints before abandoning and rebuilding a fresh play session', () => {
    const h = harness(); h.controller.resetPlaySession();
    expect(h.host.clearRespawnCheckpoints.mock.invocationCallOrder[0]).toBeLessThan(h.host.abandonGoalRun.mock.invocationCallOrder[0]);
    expect(h.host.resetGoalRunController).toHaveBeenCalledTimes(1);
  });
});

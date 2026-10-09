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
    cancelPlayerAttack: vi.fn(),
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

  it.each(['expanded', 'goal-less', 'single'] as const)('recreates cached bosses before clearing %s overrides', kind => {
    const h = harness();
    const resetBossChallenges = vi.fn();
    Object.assign(h.host, {
      resetBossChallenges,
      getCurrentGoalRun: () => kind === 'single' ? h.run : null,
      getActiveCourseRun: () => kind === 'expanded' ? { result: 'completed' } : null,
    });
    h.controller.resetPlaySession();
    expect(resetBossChallenges).toHaveBeenCalledWith(kind === 'single' ? h.run.roomId : null);
    expect(resetBossChallenges.mock.invocationCallOrder[0])
      .toBeLessThan(h.host.clearActiveCourseRoomOverrides.mock.invocationCallOrder[0]);
  });

  it('counts a death once immediately and delays only the respawn, retaining elapsed time', () => {
    const h = harness();
    let pending = false;
    let finishBeat = () => {};
    Object.assign(h.host, { isPlayerDeathPending: () => pending,
      runDeathBeat: (respawn: () => void) => { pending = true; finishBeat = respawn; } });
    h.controller.handlePlayerDeath('Ouch.'); h.controller.handlePlayerDeath('Second overlapping hazard.');
    expect(h.run.deaths).toBe(1);
    expect(h.host.cancelPlayerAttack).toHaveBeenCalledTimes(1);
    expect(h.host.cancelPlayerAttack.mock.invocationCallOrder[0]).toBeLessThan(h.host.recordGoalRunDeath.mock.invocationCallOrder[0]);
    expect(h.host.playPlayerFailFx).toHaveBeenCalledTimes(1);
    expect(h.host.respawnPlayerToCurrentRoom).not.toHaveBeenCalled();
    h.run.elapsedMs += 180; finishBeat();
    expect(h.host.respawnPlayerToCurrentRoom).toHaveBeenCalledTimes(1);
    expect(h.run.elapsedMs).toBe(3180);
    expect(h.host.restartGoalRunForRoom).not.toHaveBeenCalled();
  });

  it('holds survival failure and its fresh attempt until the death beat finishes', () => {
    const h = harness('qualified', true);
    let finishBeat = () => {};
    Object.assign(h.host, { runDeathBeat: (respawn: () => void) => { finishBeat = respawn; } });
    h.controller.handlePlayerDeath('Ouch.');
    expect(h.host.failGoalRun).not.toHaveBeenCalled();
    expect(h.host.restartGoalRunForRoom).not.toHaveBeenCalled();
    finishBeat();
    expect(h.host.failGoalRun).toHaveBeenCalledTimes(1);
    expect(h.host.restartGoalRunForRoom).toHaveBeenCalledTimes(1);
  });

  it('retains the attack when PvP damage is currently disabled', () => {
    const h = harness();
    Object.assign(h.host, { hasActivePvpMatch: () => true, isPvpDamageActive: () => false });
    h.controller.handlePlayerDeath('Ignored contact.');
    expect(h.host.cancelPlayerAttack).not.toHaveBeenCalled();
    expect(h.run.deaths).toBe(0);
    expect(h.host.respawnPlayerToCurrentRoom).not.toHaveBeenCalled();
  });

  it('a nonfatal hit or protected contact does not count a death or restart survival', () => {
    const h = harness('qualified', true);
    Object.assign(h.host, { tryAbsorbPlayerDamage: () => true });
    h.controller.handlePlayerDeath('Hazard hit you.');
    expect(h.run.deaths).toBe(0);
    expect(h.host.failGoalRun).not.toHaveBeenCalled();
    expect(h.host.recordRunDeathLocation).not.toHaveBeenCalled();
    expect(h.host.respawnPlayerToCurrentRoom).not.toHaveBeenCalled();
  });

  it('lethal falls bypass health and protection and retain ordinary run death accounting', () => {
    const h = harness(); const absorb = vi.fn(() => true);
    Object.assign(h.host, { tryAbsorbPlayerDamage: absorb });
    h.controller.handlePlayerDeath('You fell.', true);
    expect(absorb).not.toHaveBeenCalled();
    expect(h.run.deaths).toBe(1);
    expect(h.host.respawnPlayerToCurrentRoom).toHaveBeenCalledTimes(1);
  });
});

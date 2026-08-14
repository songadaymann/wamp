import { describe, expect, it, vi } from 'vitest';
import { OverworldPvpCombatCoordinator } from './pvpCombatCoordinator';

function createSwordEvent(startedAt = 10_000) {
  return {
    id: 'sword-a',
    owner: 'local' as const,
    source: 'sword' as const,
    x: 20,
    y: 40,
    facing: 1 as const,
    startedAt,
    durationMs: 120,
    effectX: 25,
    effectY: 41,
    downward: false,
    projectile: null,
  };
}

describe('OverworldPvpCombatCoordinator two-client baseline', () => {
  it('throttles each attacker/target/source key for exactly 180 ms', () => {
    const alice = new OverworldPvpCombatCoordinator();
    const report = vi.fn((
      _targetUserId: string,
      _source: 'sword' | 'gun' | 'stomp',
      _hitId: string,
    ) => true);
    const base = {
      damageActive: true,
      matchId: 'match-1',
      targetUserId: 'bob',
      source: 'sword' as const,
      epochNow: 50_000,
      randomSuffix: 'fixed',
      report,
    };

    expect(alice.reportPeerHit({ ...base, monotonicNow: 1_000 })).toBe(true);
    expect(alice.reportPeerHit({ ...base, monotonicNow: 1_179 })).toBe(false);
    expect(alice.reportPeerHit({ ...base, monotonicNow: 1_180 })).toBe(true);
    expect(report).toHaveBeenCalledTimes(2);
    expect(report.mock.calls[0]?.[2]).toBe('sword:match-1:bob:50000:1000:fixed');
  });

  it('rolls back failed outbound hits so the same-frame retry remains eligible', () => {
    const alice = new OverworldPvpCombatCoordinator();
    const report = vi.fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const input = {
      damageActive: true,
      matchId: 'match-1',
      targetUserId: 'bob',
      source: 'gun' as const,
      monotonicNow: 2_000,
      epochNow: 60_000,
      randomSuffix: 'retry',
      report,
    };

    expect(alice.reportPeerHit(input)).toBe(false);
    expect(alice.reportPeerHit(input)).toBe(true);
    expect(report).toHaveBeenCalledTimes(2);
  });

  it('deduplicates received actions independently on both clients and rolls back failures', () => {
    const alice = new OverworldPvpCombatCoordinator();
    const bob = new OverworldPvpCombatCoordinator();
    const aliceReport = vi.fn(() => true);
    const bobReport = vi.fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const aliceInput = {
      channel: 'instance' as const,
      action: 'sword' as const,
      matchId: 'match-1',
      attackerUserId: 'bob',
      localUserId: 'alice',
      actionUntil: 10_025,
      report: aliceReport,
    };
    const bobInput = {
      channel: 'presence' as const,
      action: 'gun' as const,
      matchId: 'match-1',
      attackerUserId: 'alice',
      localUserId: 'bob',
      actionUntil: 11_025,
      report: bobReport,
    };

    expect(alice.reportReceivedActionHit(aliceInput)).toBe(true);
    expect(alice.reportReceivedActionHit(aliceInput)).toBe(false);
    expect(bob.reportReceivedActionHit(bobInput)).toBe(false);
    expect(bob.reportReceivedActionHit(bobInput)).toBe(true);
    expect(bob.reportReceivedActionHit(bobInput)).toBe(false);
  });

  it('preserves the 450 ms stomp boundary and resets it between matches', () => {
    const coordinator = new OverworldPvpCombatCoordinator();

    expect(coordinator.isStompReady(449)).toBe(false);
    expect(coordinator.isStompReady(450)).toBe(true);
    coordinator.recordStomp(1_000);
    expect(coordinator.isStompReady(1_449)).toBe(false);
    expect(coordinator.isStompReady(1_450)).toBe(true);
    coordinator.reset();
    expect(coordinator.isStompReady(450)).toBe(true);
  });

  it('publishes exact combat payloads and latches actions for at least 180 ms', () => {
    const coordinator = new OverworldPvpCombatCoordinator();
    const send = vi.fn(() => true);

    expect(coordinator.publishLocalAction({
      damageActive: true,
      matchId: 'match-1',
      event: createSwordEvent(),
      visualFeetOffset: 7,
      send,
    })).toBe(true);
    expect(send).toHaveBeenCalledWith({
      id: 'sword-a',
      matchId: 'match-1',
      source: 'sword',
      x: 20,
      y: 47,
      facing: 1,
      startedAt: 10_000,
      durationMs: 120,
      effectX: 25,
      effectY: 41,
      downward: false,
      projectile: null,
    });
    expect(coordinator.getActiveLocalAction(10_179)).toBe('sword');
    expect(coordinator.getActiveLocalAction(10_180)).toBeNull();
  });

  it('preserves forced sends and the 25 ms instance-state cadence', () => {
    const coordinator = new OverworldPvpCombatCoordinator();

    expect(coordinator.beginInstanceStateSend(0, false)).toBeNull();
    expect(coordinator.beginInstanceStateSend(0, true)).toBe(1);
    expect(coordinator.beginInstanceStateSend(24, false)).toBeNull();
    expect(coordinator.beginInstanceStateSend(25, false)).toBe(2);
    expect(coordinator.beginInstanceStateSend(25, true)).toBe(3);
  });

  it('deduplicates identical self-death IDs without treating send failure as retryable', () => {
    const coordinator = new OverworldPvpCombatCoordinator();
    const report = vi.fn(() => false);
    const input = {
      damageActive: true,
      matchId: 'match-1',
      localUserId: 'alice',
      epochNow: 75_000,
      report,
    };

    expect(coordinator.reportSelfDeath(input)).toBe(true);
    expect(coordinator.reportSelfDeath(input)).toBe(false);
    expect(report).toHaveBeenCalledWith('environment', 'self:match-1:alice:75000');
  });
});

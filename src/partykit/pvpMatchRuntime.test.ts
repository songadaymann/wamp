import { describe, expect, it } from 'vitest';
import {
  activatePvpMatchIfReady,
  applyPvpLifeLoss,
  createPvpMatchState,
  finalizePvpMatch,
  getPvpSnapshot,
  isValidPvpMatchConfiguration,
  markPvpForfeit,
  normalizePvpCombatEvent,
  normalizePvpParticipant,
  normalizePvpPlayerState,
  normalizePvpRoomStateEvent,
  startPvpMatch,
  upsertPvpParticipant,
} from './pvpMatchRuntime';

const alice = { userId: 'alice', displayName: 'Alice', avatarId: 'a' };
const bob = { userId: 'bob', displayName: 'Bob', avatarId: 'b' };

describe('PartyKit PvP match runtime', () => {
  it('creates, connects, counts down, starts, snapshots, and completes a two-player match', () => {
    const match = createPvpMatchState({ type: 'pvp:match:configure', matchId: ' match ', mode: 'arena', roomId: ' 1,2 ', roomCoordinates: { x: 1, y: 2 }, participants: [alice, bob] }, alice)!;
    upsertPvpParticipant(match, alice);
    expect(activatePvpMatchIfReady(match, 100)).toBe(false);
    upsertPvpParticipant(match, bob);
    expect(activatePvpMatchIfReady(match, 100)).toBe(true);
    expect(match.countdownEndsAt).toBe(4_300);
    expect(startPvpMatch(match, 4_300)).toBe(true);
    expect(getPvpSnapshot(match)).toMatchObject({ matchId: 'match', status: 'active', participants: [{ hearts: 5 }, { hearts: 5 }] });

    const bobState = match.participants[1]!;
    bobState.hearts = 1;
    expect(applyPvpLifeLoss(match, { hitId: 'h', targetUserId: 'bob', attackerUserId: 'alice', source: 'sword' }, 5_000)).toEqual({ changed: true, requiresFinalizeSchedule: true });
    expect(applyPvpLifeLoss(match, { hitId: 'h', targetUserId: 'bob', attackerUserId: 'alice', source: 'sword' }, 5_001).changed).toBe(false);
    expect(finalizePvpMatch(match, 5_350)).toBe(true);
    expect(getPvpSnapshot(match)).toMatchObject({ status: 'complete', winnerUserId: 'alice', loserUserId: 'bob', draw: false });
  });

  it('validates every configure message even after match state exists', () => {
    const valid = { type: 'pvp:match:configure', matchId: 'm', mode: 'arena', roomId: '1,2', roomCoordinates: { x: 1, y: 2 }, participants: [] } as Parameters<typeof isValidPvpMatchConfiguration>[0];
    expect(isValidPvpMatchConfiguration(valid)).toBe(true);
    expect(isValidPvpMatchConfiguration({ ...valid, matchId: ' ' })).toBe(false);
    expect(isValidPvpMatchConfiguration({ ...valid, roomCoordinates: { x: 1.5, y: 2 } })).toBe(false);
  });

  it('preserves invulnerability, simultaneous finalizing losses, draw, and forfeit rules', () => {
    const match = activeMatch();
    expect(applyPvpLifeLoss(match, { hitId: 'a', targetUserId: 'bob', attackerUserId: 'alice', source: 'gun' }, 100).changed).toBe(true);
    expect(applyPvpLifeLoss(match, { hitId: 'b', targetUserId: 'bob', attackerUserId: 'alice', source: 'gun' }, 101).changed).toBe(false);
    match.participants.forEach((participant) => { participant.hearts = 1; participant.invulnerableUntil = 0; });
    applyPvpLifeLoss(match, { hitId: 'c', targetUserId: 'bob', attackerUserId: 'alice', source: 'sword' }, 2_000);
    applyPvpLifeLoss(match, { hitId: 'd', targetUserId: 'alice', attackerUserId: 'bob', source: 'sword' }, 2_001);
    finalizePvpMatch(match, 2_350);
    expect(match).toMatchObject({ draw: true, winnerUserId: null, loserUserId: null, lastEvent: 'Draw.' });

    const forfeit = activeMatch();
    expect(markPvpForfeit(forfeit, forfeit.participants[1]!, 3_000)).toBe(true);
    finalizePvpMatch(forfeit, 3_000);
    expect(forfeit).toMatchObject({ winnerUserId: 'alice', loserUserId: 'bob' });
  });

  it('normalizes bounded player, combat, room-state, and participant inputs', () => {
    const player = normalizePvpPlayerState({ matchId: ' m ', x: 2_000_000, y: 1, velocityX: 3_000, velocityY: 0, facing: -1, animationState: 'run', action: 'gun', actionUntil: 20_000, sequence: 1.9, sentAt: 20_000 }, 'alice', 5_000);
    expect(player).toMatchObject({ matchId: 'm', x: 1_000_000, velocityX: 2_000, facing: -1, sequence: 1, actionUntil: 15_000 });
    expect(normalizePvpPlayerState({ ...player, animationState: 'butt-stomp-flip' }, 'alice', 5_000)).toBeNull();
    expect(normalizePvpCombatEvent({ id: 'e', matchId: 'm', source: 'gun', x: 1, y: 2, facing: 1, startedAt: 5_000, durationMs: 1, effectX: Number.NaN, effectY: 4, projectile: { x: 1, y: 2, velocityX: 3, lifetimeMs: 4_000 } }, 'alice', 5_000)).toMatchObject({ durationMs: 16, effectX: 1, projectile: { lifetimeMs: 3_000 } });
    expect(normalizePvpRoomStateEvent({ id: 'e', matchId: 'm', roomId: '1,2', roomCoordinates: { x: 1, y: 2 }, kind: 'room-switch-state', active: 1, sentAt: 1 }, 'alice', 5_000)).toMatchObject({ active: false, userId: 'alice' });
    expect(normalizePvpParticipant({ userId: ' u ', displayName: ' ', avatarId: ' ' })).toEqual({ userId: 'u', displayName: 'Player', avatarId: 'default-player' });
  });
});

function activeMatch() {
  const match = createPvpMatchState({ type: 'pvp:match:configure', matchId: 'm', mode: 'arena', roomId: '1,2', roomCoordinates: { x: 1, y: 2 }, participants: [alice, bob] }, alice)!;
  upsertPvpParticipant(match, alice);
  upsertPvpParticipant(match, bob);
  activatePvpMatchIfReady(match, 0);
  startPvpMatch(match, 0);
  return match;
}

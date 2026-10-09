import { describe, expect, it } from 'vitest';
import type { WorldGhostPresence } from './worldPresence';
import { getFreshCoopPlatePlayers } from './coopPlateActors';

describe('co-op presence eligibility', () => {
  const now = 100_000;
  const base: WorldGhostPresence = { userId: 'helper', connectionId: 'c', displayName: 'Helper', avatarId: 'unloaded-avatar',
    shardId: '0:0', roomId: '0,0', roomCoordinates: { x: 0, y: 0 }, x: 88, y: 306,
    velocityX: 0, velocityY: 0, facing: 1, animationState: 'idle', mode: 'play', timestamp: now };
  const options = { now, localUserId: 'me', instanceOpponentUserId: 'opponent' };
  it('accepts fresh live presence without requiring an avatar or rendered sprite', () => {
    expect(getFreshCoopPlatePlayers([base], options)).toEqual([base]);
    expect(getFreshCoopPlatePlayers([{ ...base, timestamp: now - 15_000 }, { ...base, timestamp: now + 2_000 }], options)).toHaveLength(2);
  });
  it('excludes stale, future, edit, browse, same-account and instanced PvP players', () => {
    const excluded: WorldGhostPresence[] = [
      { ...base, timestamp: now - 15_001 }, { ...base, timestamp: now + 2_001 }, { ...base, timestamp: NaN },
      { ...base, mode: 'edit' }, { ...base, mode: 'browse' }, { ...base, userId: 'me' }, { ...base, userId: 'opponent' },
      { ...base, pvp: { matchId: 'match', action: null, actionUntil: 0 } }, { ...base, x: Infinity }, { ...base, y: NaN },
    ];
    expect(getFreshCoopPlatePlayers(excluded, options)).toEqual([]);
    expect(getFreshCoopPlatePlayers([base], { ...options, now: now + 15_001 })).toEqual([]);
  });
});

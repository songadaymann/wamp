import { describe, expect, it } from 'vitest';
import type { SuspiciousUserCase } from '../model';
import {
  countSuspiciousQueueTabs,
  filterSuspiciousUsers,
  getSuspiciousIdentityTone,
} from './viewModel';

describe('suspicious admin view model', () => {
  it('filters and counts the exact three queue tabs', () => {
    const users = [user('real', 'real_players', 'no_generated_signal'), user('generated', 'generated_signals', 'generated_only')];
    expect(countSuspiciousQueueTabs(users)).toEqual({ all: 2, real_players: 1, generated_signals: 1 });
    expect(filterSuspiciousUsers(users, 'all')).toBe(users);
    expect(filterSuspiciousUsers(users, 'generated_signals')).toEqual([users[1]]);
  });

  it('preserves the identity tone mapping', () => {
    expect(getSuspiciousIdentityTone(user('a', 'generated_signals', 'generated_only'))).toBe('high');
    expect(getSuspiciousIdentityTone(user('b', 'generated_signals', 'legacy_generated_linked'))).toBe('medium');
    expect(getSuspiciousIdentityTone(user('c', 'real_players', 'no_generated_signal'))).toBe('low');
  });
});

function user(
  userId: string,
  bucket: SuspiciousUserCase['identity']['bucket'],
  kind: SuspiciousUserCase['identity']['kind'],
): SuspiciousUserCase {
  return {
    userId,
    userDisplayName: userId,
    userCreatedAt: '2026-08-13T00:00:00.000Z',
    ogpId: null,
    playerId: null,
    totalPoints: 0,
    completedRuns: 0,
    recentPoints: 0,
    recentCompletedRuns: 0,
    strongestSeverity: 'low',
    signalCodes: [],
    signals: [],
    identity: { bucket, kind, label: kind, summary: kind },
    lastActivityAt: null,
  };
}

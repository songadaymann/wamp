import { describe, expect, it } from 'vitest';
import type { LaunchStatsRecentSummary } from '../model';
import { matchesActivityFilter, normalizeActivityFilterKey } from './viewModel';

describe('launch admin view model', () => {
  it('preserves filter normalization', () => {
    expect(normalizeActivityFilterKey('guest_play_build')).toBe('guest_play_build');
    expect(normalizeActivityFilterKey('unknown')).toBe('all');
    expect(normalizeActivityFilterKey(null)).toBe('all');
  });

  it('preserves activity kind and count-aware matching', () => {
    expect(matchesActivityFilter(summary('signup'), 'signups')).toBe(true);
    expect(matchesActivityFilter(summary('guest_visit'), 'guest_play_build')).toBe(true);
    expect(matchesActivityFilter(summary('room_build', { claimCount: 1 }), 'room_claims')).toBe(true);
    expect(matchesActivityFilter(summary('room_build', { claimCount: 0 }), 'room_claims')).toBe(false);
    expect(matchesActivityFilter(summary('course_build', { coursePublishCount: 1 }), 'course_publishes')).toBe(true);
    expect(matchesActivityFilter(summary('room_play'), 'all')).toBe(true);
  });
});

function summary(
  kind: LaunchStatsRecentSummary['kind'],
  overrides: Partial<LaunchStatsRecentSummary> = {},
): LaunchStatsRecentSummary {
  return {
    kind,
    at: '2026-08-13T00:00:00.000Z',
    actorUserId: null,
    actorDisplayName: 'Fixture',
    signupSource: null,
    sessionCount: null,
    roomCount: null,
    courseCount: null,
    claimCount: null,
    roomPublishCount: null,
    coursePublishCount: null,
    attemptCount: null,
    completedCount: null,
    failedCount: null,
    abandonedCount: null,
    topRooms: [],
    topCourses: [],
    ...overrides,
  };
}

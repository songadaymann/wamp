import type { LaunchStatsRecentSummary } from '../model';

export type LaunchAdminActivityFilterKey =
  | 'all'
  | 'signups'
  | 'visit_only'
  | 'guest_play_build'
  | 'room_play'
  | 'room_claims'
  | 'room_publishes'
  | 'course_publishes';

export function normalizeActivityFilterKey(
  value: string | null | undefined,
): LaunchAdminActivityFilterKey {
  switch (value) {
    case 'signups':
    case 'visit_only':
    case 'guest_play_build':
    case 'room_play':
    case 'room_claims':
    case 'room_publishes':
    case 'course_publishes':
    case 'all':
      return value;
    default:
      return 'all';
  }
}

export function matchesActivityFilter(
  summary: LaunchStatsRecentSummary,
  filterKey: LaunchAdminActivityFilterKey,
): boolean {
  switch (filterKey) {
    case 'all':
      return true;
    case 'signups':
      return summary.kind === 'signup';
    case 'visit_only':
      return summary.kind === 'visit_only';
    case 'guest_play_build':
      return summary.kind === 'guest_visit';
    case 'room_play':
      return summary.kind === 'room_play';
    case 'room_claims':
      return summary.kind === 'room_build' && (summary.claimCount ?? 0) > 0;
    case 'room_publishes':
      return summary.kind === 'room_build' && (summary.roomPublishCount ?? 0) > 0;
    case 'course_publishes':
      return summary.kind === 'course_build' && (summary.coursePublishCount ?? 0) > 0;
  }
}

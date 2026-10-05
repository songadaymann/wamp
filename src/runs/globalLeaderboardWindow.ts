import type { GlobalLeaderboardPeriod } from './model';

/** UTC calendar bounds: Monday inclusive, following Monday exclusive. */
export function globalLeaderboardWeek(now: Date): GlobalLeaderboardPeriod {
  const start = new Date(now.getTime());
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  return { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 7 * 86400000).toISOString() };
}

import type { Env } from '../core/types';
import { pruneRateLimitEvents } from '../core/rateLimit';
import { purgeBugReports } from '../bugReports/routes';
import { purgeGuestReplays } from '../guestReplay/frames';
import { pruneGuestRuns } from '../guestRuns/attempts';
import { purgeLostSongSessions } from '../lostSongs/routes';
import { pruneExpiredRecords } from './pruneExpired';
import { pruneClosedContentReports } from '../reports/routes';
import { checkDatabaseSize } from './databaseSize';

export async function runHourlyMaintenance(env: Env, date: Date): Promise<void> {
  // First and on its own: a ballooning table is the likeliest reason a cleanup step below fails.
  try {
    await checkDatabaseSize(env, date);
  } catch (error) {
    console.error(JSON.stringify({ event: 'database-size-check-failed', error: error instanceof Error ? error.message : String(error) }));
  }
  await pruneExpiredRecords(env, date);
  await purgeGuestReplays(env, date.toISOString());
  await purgeBugReports(env);
  await purgeLostSongSessions(env);
  await pruneGuestRuns(env);
  await pruneRateLimitEvents(env);
  await pruneClosedContentReports(env, date);
}

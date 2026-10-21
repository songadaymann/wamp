import type { Env } from '../core/types';
import { pruneRateLimitEvents } from '../core/rateLimit';
import { purgeBugReports } from '../bugReports/routes';
import { purgeGuestReplays } from '../guestReplay/frames';
import { pruneGuestRuns } from '../guestRuns/attempts';
import { purgeLostSongSessions } from '../lostSongs/routes';
import { pruneExpiredRecords } from './pruneExpired';
import { pruneClosedContentReports } from '../reports/routes';

export async function runHourlyMaintenance(env: Env, date: Date): Promise<void> {
  await pruneExpiredRecords(env, date);
  await purgeGuestReplays(env, date.toISOString());
  await purgeBugReports(env);
  await purgeLostSongSessions(env);
  await pruneGuestRuns(env);
  await pruneRateLimitEvents(env);
  await pruneClosedContentReports(env, date);
}

import type { DailyResponse } from './model';
import type { GuestRunProgressRecord } from '../progression/guestRunProgress';

/** Count each real challenge date once, using its exact level/version and confirmed guest clear. */
export function guestDailyProgress(response: DailyResponse, records: GuestRunProgressRecord[]): {completed:boolean; completedLast7:number} {
  const dates = new Set<string>();
  for (const record of records) {
    if (record.guestProgress?.status !== 'saved' || !record.guestProgress.durable) continue;
    const date = record.completedAt.slice(0,10);
    const pick = response.recentPicks.find(value => value.date === date);
    if (pick && pick.version === record.version && (pick.contentType === record.contentType && pick.contentId === record.contentId
      || pick.contentType === 'expanded_room' && record.contentType === 'course' && pick.legacyCourseId === record.contentId)) dates.add(date);
  }
  return { completed:dates.has(response.date),completedLast7:dates.size };
}

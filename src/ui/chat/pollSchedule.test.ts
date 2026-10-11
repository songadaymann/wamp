import { describe, expect, it } from 'vitest';
import { CHAT_POLL_INTERVAL_MS, isScheduledChatPollDue } from './pollSchedule';

/** Ticks a 3 s timer for a minute (with a little jitter) and lists the ticks that poll. */
function pollingTicks(open: boolean): number[] {
  let last: number | null = null;
  const polls: number[] = [];
  for (let tick = 1; tick <= 20; tick += 1) {
    const now = tick * CHAT_POLL_INTERVAL_MS + (tick % 2 === 0 ? -15 : 15);
    if (isScheduledChatPollDue(open, now, last)) { polls.push(tick); last = now; }
  }
  return polls;
}

describe('chat poll schedule (F028)', () => {
  it('polls every 3 s tick while the panel is open', () => {
    expect(pollingTicks(true)).toHaveLength(20);
  });

  it('polls about every 30 s while the panel is closed, for the unread badge', () => {
    expect(pollingTicks(false)).toEqual([1, 11]);
  });
});

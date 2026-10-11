export const CHAT_POLL_INTERVAL_MS = 3000;
// A closed panel only needs the unread badge, so it checks far less often.
export const CLOSED_CHAT_POLL_INTERVAL_MS = 30_000;

/**
 * The chat timer ticks every 3 s. It polls on every tick while the panel is open and
 * about every 30 s while it is closed; half a tick of slack keeps timer jitter from
 * pushing a closed poll to the following tick.
 */
export function isScheduledChatPollDue(open: boolean, nowMs: number, lastPollStartedAtMs: number | null): boolean {
  return open
    || lastPollStartedAtMs === null
    || nowMs - lastPollStartedAtMs >= CLOSED_CHAT_POLL_INTERVAL_MS - CHAT_POLL_INTERVAL_MS / 2;
}

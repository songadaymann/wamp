/** Refresh before the 15-second ghost/co-op expiry, with time for the server to hibernate. */
export const IDLE_PRESENCE_REFRESH_MS = 12_000;

/** Group idle refreshes into shared time windows so idle players don't wake a shard in turn. */
export function isIdlePresenceRefreshDue(lastPublishedAt: number, now: number): boolean {
  return Math.floor(lastPublishedAt / IDLE_PRESENCE_REFRESH_MS) !== Math.floor(now / IDLE_PRESENCE_REFRESH_MS);
}

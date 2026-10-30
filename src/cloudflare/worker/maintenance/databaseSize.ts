import { emailConfigured } from '../email/provider';
import { releaseRateLimitSlots, takeRateLimitSlot, type RateLimitRule } from '../core/rateLimit';
import type { Env } from '../core/types';
import { deliverEmail, escapeEmailHtml } from '../email/delivery';
import { worldMapAlertRecipient } from '../worldTiles/health';

/** A D1 database stops accepting writes at 10 GB; warn well before saving, chat and sign-in stop. */
export const DATABASE_SIZE_WARNING_BYTES = 8_000_000_000;
const ALERT_ONCE_A_DAY: RateLimitRule = { bucket: 'ops:database-size-alert', limit: 1, windowMs: 24 * 60 * 60 * 1000 };

export async function checkDatabaseSize(env: Env, now = new Date(), fetcher: typeof fetch = fetch) {
  // D1 reports the database size with every result.
  const result = await env.DB.prepare('SELECT 1 AS ok').all() as { meta?: { size_after?: number } };
  const bytes = Number(result.meta?.size_after);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    console.error(JSON.stringify({ event: 'database-size-unknown' }));
    return { status: 'unknown' as const };
  }
  console.log(JSON.stringify({ event: 'database-size', bytes }));
  if (bytes < DATABASE_SIZE_WARNING_BYTES) return { status: 'ok' as const, bytes };
  if (!emailConfigured(env)) {
    console.error(JSON.stringify({ event: 'database-size-alert-not-configured', bytes }));
    return { status: 'not_configured' as const, bytes };
  }
  const slot = await takeRateLimitSlot(env, ALERT_ONCE_A_DAY, 'database', now.getTime());
  if (slot === null) {
    return { status: 'already_sent' as const, bytes };
  }
  const text = [
    `WAMP's main database is ${(bytes / 1e9).toFixed(2)} GB. Cloudflare D1 stops accepting writes at 10 GB, and then nobody can save, publish, chat or sign in.`,
    'Look for a table growing unexpectedly (guest drafts, rate limit events, replays), or ask Claude to check with a read-only size query.',
    'This warning repeats at most once a day while the database stays above 8 GB.',
  ].join('\n\n');
  try {
    await deliverEmail(env, {
      to: worldMapAlertRecipient(env),
      subject: `WAMP database at ${(bytes / 1e9).toFixed(1)} GB of 10 GB`,
      text,
      html: text.split('\n\n').map((line) => `<p>${escapeEmailHtml(line)}</p>`).join(''),
    }, `wamp-database-size-${now.toISOString().slice(0, 10)}`, fetcher);
  } catch (error) {
    // Try again next hour; the email provider's idempotency key still prevents a duplicate that day.
    await releaseRateLimitSlots(env, [slot]);
    console.error(JSON.stringify({ event: 'database-size-alert-failed', error: error instanceof Error ? error.message : String(error) }));
    return { status: 'failed' as const, bytes };
  }
  return { status: 'sent' as const, bytes };
}

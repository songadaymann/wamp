import type { Env } from '../core/types';
import { deliverEmail, escapeEmailHtml } from '../email/delivery';
import { worldMapAlertRecipient } from '../worldTiles/health';

// Standard R2 rates checked against https://developers.cloudflare.com/r2/pricing/
// on 2026-10-09. Ignore shared account free allowances to warn conservatively.
export const GHOST_ARCHIVE_COST_THRESHOLD_USD = 10;
export function ghostArchiveBillingPeriod(now: Date, billingDay = 1): string {
  const day = Number.isInteger(billingDay) && billingDay >= 1 && billingDay <= 28 ? billingDay : 1;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day));
  if (now.getUTCDate() < day) start.setUTCMonth(start.getUTCMonth() - 1);
  return start.toISOString().slice(0, 10);
}
export function estimateGhostArchiveCost(bytes: number, uploads: number, downloads: number) {
  const storage = Math.ceil(bytes / 1_000_000_000) * 0.015;
  const writes = Math.ceil(uploads / 1_000_000) * 4.50;
  const reads = Math.ceil(downloads / 1_000_000) * 0.36;
  return { storage, writes, reads, total: Math.round((storage + writes + reads) * 1000) / 1000 };
}
export async function recordGhostArchiveOperation(env: Env, operation: 'uploads' | 'downloads'): Promise<void> {
  const period = ghostArchiveBillingPeriod(new Date(), Number(env.RUN_GHOST_BILLING_CYCLE_DAY));
  // Record before touching R2, so retries/lost replies cannot undercount costs.
  await env.DB.batch([env.DB.prepare(`INSERT INTO run_ghost_archive_usage (period_start, ${operation})
    VALUES (?, 1) ON CONFLICT (period_start) DO UPDATE SET ${operation} = ${operation} + 1`).bind(period)]);
}
export function ghostArchiveAlertRecipient(env: Env): string {
  return env.RUN_GHOST_ALERT_EMAIL?.trim() || worldMapAlertRecipient(env);
}
export function ghostArchiveAlertConfigured(env: Env): boolean {
  return env.RUN_GHOST_COST_ALERTS_ENABLED === '1' && Boolean(env.RESEND_API_KEY?.trim())
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ghostArchiveAlertRecipient(env));
}
export async function loadGhostArchiveBudget(env: Env, now = new Date()) {
  const period = ghostArchiveBillingPeriod(now, Number(env.RUN_GHOST_BILLING_CYCLE_DAY));
  const [totals, usage] = await Promise.all([
    env.DB.prepare('SELECT payload_bytes, runs FROM run_ghost_archive_totals WHERE id = 1')
      .first<{ payload_bytes: number; runs: number }>(),
    env.DB.prepare('SELECT uploads, downloads, alert_sent_at FROM run_ghost_archive_usage WHERE period_start = ?')
      .bind(period).first<{ uploads: number; downloads: number; alert_sent_at: string | null }>(),
  ]);
  const cost = estimateGhostArchiveCost(totals?.payload_bytes ?? 0, usage?.uploads ?? 0, usage?.downloads ?? 0);
  return { period, totals, usage, cost };
}
export async function checkGhostArchiveCost(env: Env, now = new Date(), fetcher: typeof fetch = fetch) {
  if (env.RUN_GHOST_COST_ALERTS_ENABLED !== '1') return { status: 'disabled' as const };
  if (!ghostArchiveAlertConfigured(env)) {
    console.error(JSON.stringify({ event: 'run-ghost-cost-alert-not-configured' }));
    return { status: 'not_configured' as const };
  }
  const to = ghostArchiveAlertRecipient(env);
  const { period, totals, usage, cost } = await loadGhostArchiveBudget(env, now);
  if (cost.total <= GHOST_ARCHIVE_COST_THRESHOLD_USD) return { status: 'below_threshold' as const, cost };
  if (usage?.alert_sent_at) return { status: 'already_sent' as const, cost };
  const text = [
    `WAMP's ghost archive has an estimated monthly R2 cost of $${cost.total.toFixed(2)}, above your $10 warning.`,
    `Recordings: ${totals?.runs ?? 0}. Current archive: ${((totals?.payload_bytes ?? 0) / 1e9).toFixed(3)} GB.`,
    `Storage: $${cost.storage.toFixed(2)}/month at the current size.`,
    `Uploads/retries this billing cycle: ${usage?.uploads ?? 0} ($${cost.writes.toFixed(2)}).`,
    `Archive reads this billing cycle: ${usage?.downloads ?? 0} ($${cost.reads.toFixed(2)}).`,
    `Billing cycle starts ${period}. This warning resets each billing cycle.`,
    'This is a conservative estimate before shared free allowances. It prices the current archive for a full month, includes pending uploads, and excludes other Cloudflare services and taxes.',
    'Check the actual bill at https://dash.cloudflare.com/?to=/:account/billing/billable-usage',
    'Ghost saving remains enabled. This is a warning, not a spending cap.',
  ].join('\n\n');
  await deliverEmail(env, { to, subject: 'WAMP ghost archive: estimated monthly cost above $10',
    text, html: text.split('\n\n').map(line => `<p>${escapeEmailHtml(line)}</p>`).join('') },
  `wamp-ghost-archive-budget-${period}`, fetcher);
  await env.DB.batch([env.DB.prepare(`INSERT INTO run_ghost_archive_usage (period_start, alert_sent_at)
    VALUES (?, ?) ON CONFLICT (period_start) DO UPDATE SET alert_sent_at = excluded.alert_sent_at`)
    .bind(period, now.toISOString())]);
  return { status: 'sent' as const, cost };
}

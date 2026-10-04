import { activityDescription, type BuilderActivity } from '../../../activity/model';
import type { D1DatabaseSession, Env, WorkerExecutionContextLike } from '../core/types';
import { deliverEmail, escapeEmailHtml, type EmailMessage } from '../email/delivery';
import { emailActivityExistsSql, loadEmailActivity, type PreferenceRow } from './store';
import { createActivityUnsubscribeToken } from './unsubscribe';

const HOUR = 3600000;
const MAX_BATCH = 20;
interface Recipient extends PreferenceRow { email: string; last_dethrone_id?: number }
interface PendingEmail { id: string; user_id: string; kind: 'digest' | 'dethroned'; message_json: string; created_at: string; attempts: number }
export function digestWindow(now: string): { key: string; from: string; until: string; expires: string } | null {
  const date = new Date(now);
  const day = date.getUTCDay();
  const hour = date.getUTCHours();
  // Monday noon UTC, with the following 24 hours reserved for bounded catch-up.
  if (!(day === 1 && hour >= 12 || day === 2 && hour < 12)) return null;
  date.setUTCDate(date.getUTCDate() - (day === 2 ? 1 : 0)); date.setUTCHours(12, 0, 0, 0);
  return { key: date.toISOString(), from: new Date(date.getTime() - 7 * 86400000).toISOString(),
    until: date.toISOString(), expires: new Date(date.getTime() + 24 * HOUR).toISOString() };
}
async function buildActivityEmail(prefs: Recipient, kind: PendingEmail['kind'], entries: BuilderActivity[], now: string): Promise<EmailMessage> {
  const token = await createActivityUnsubscribeToken(prefs, kind, now);
  const unsubscribe = `https://api.wamp.land/api/activity/unsubscribe?token=${encodeURIComponent(token)}`;
  const inbox = 'https://wamp.land/?activity=1';
  const heading = kind === 'digest' ? 'Your week in WAMP' : activityDescription(entries[0]);
  const lines = entries.map(entry => `${activityDescription(entry)} (v${entry.contentVersion}) — https://wamp.land${entry.contentPath}`);
  return {
    to: prefs.email, subject: kind === 'digest' ? 'Your weekly WAMP activity' : 'Someone took your #1 in WAMP',
    text: [heading, '', ...lines, '', entries.length === 100 ? 'Showing the latest 100 events.' : '', `All activity: ${inbox}`, `Unsubscribe: ${unsubscribe}`].filter(line => line !== '').join('\n'),
    html: `<div style="font-family:monospace;background:#050505;color:#f3eee2;padding:24px"><h2>${escapeEmailHtml(heading)}</h2><ul>${entries.map(entry => `<li>${escapeEmailHtml(activityDescription(entry))} (v${entry.contentVersion}) — <a href="https://wamp.land${escapeEmailHtml(entry.contentPath)}">Open room</a></li>`).join('')}</ul>${entries.length === 100 ? '<p>Showing the latest 100 events.</p>' : ''}<p><a href="${inbox}">All activity</a></p><p><a href="${escapeEmailHtml(unsubscribe)}">Unsubscribe from ${kind === 'digest' ? 'weekly activity' : 'lost #1'} emails</a></p></div>`,
    headers: { 'List-Unsubscribe': `<${unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  };
}
const ELIGIBLE_RECIPIENT = `u.email IS NOT NULL AND trim(u.email) <> ''
  AND NOT EXISTS (SELECT 1 FROM school_students WHERE user_id = p.user_id)`;
async function queueEmail(db: D1DatabaseSession, recipient: Recipient, kind: PendingEmail['kind'], period: string, entries: BuilderActivity[], now: string, expires: string): Promise<void> {
  if (entries.length === 0) return;
  const message = await buildActivityEmail(recipient, kind, entries, now);
  await db.prepare(`INSERT OR IGNORE INTO builder_activity_emails
    (id, user_id, kind, period_key, message_json, latest_activity_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(`activity:${kind}:${recipient.user_id}:${period}`, recipient.user_id, kind, period, JSON.stringify(message), Math.max(...entries.map(entry => entry.id)), now, expires).all();
}
async function queueDethrones(db: D1DatabaseSession, now: string, attemptId?: string): Promise<void> {
  const cutoff = new Date(Date.parse(now) - 23 * HOUR).toISOString();
  const day = now.slice(0, 10);
  const recipients = await db.prepare(`SELECT p.*, u.email,
    COALESCE((SELECT MAX(latest_activity_id) FROM builder_activity_emails WHERE user_id = p.user_id AND kind = 'dethroned'), 0) AS last_dethrone_id
    FROM builder_activity_preferences p JOIN users u ON u.id = p.user_id
    WHERE ${ELIGIBLE_RECIPIENT} AND p.dethrone_alerts = 1
      AND NOT EXISTS (SELECT 1 FROM builder_activity_emails WHERE user_id = p.user_id AND kind = 'dethroned' AND period_key = ?)
      AND ${emailActivityExistsSql('dethroned')}
      ${attemptId ? "AND EXISTS (SELECT 1 FROM builder_activity a JOIN pxp_events xp ON xp.id = a.source_id WHERE a.recipient_user_id = p.user_id AND a.kind = 'dethroned' AND xp.source_id = ?)" : ''}
      ORDER BY p.user_id LIMIT ${MAX_BATCH}`)
    .bind(day, cutoff, new Date(Date.parse(now) + 1).toISOString(), ...(attemptId ? [attemptId] : [])).all<Recipient>();
  for (const recipient of recipients.results) {
    const from = recipient.dethrone_enabled_at && recipient.dethrone_enabled_at > cutoff ? recipient.dethrone_enabled_at : cutoff;
    const entries = (await loadEmailActivity(db, recipient.user_id, from, new Date(Date.parse(now) + 1).toISOString(), 'dethroned'))
      .filter(entry => entry.id > (recipient.last_dethrone_id ?? 0));
    await queueEmail(db, recipient, 'dethroned', day, entries, now, new Date(Date.parse(now) + 23 * HOUR).toISOString());
  }
}
async function queueDigests(db: D1DatabaseSession, now: string): Promise<void> {
  const period = digestWindow(now);
  if (!period) return;
  const recipients = await db.prepare(`SELECT p.*, u.email FROM builder_activity_preferences p JOIN users u ON u.id = p.user_id
    WHERE ${ELIGIBLE_RECIPIENT} AND p.weekly_digest = 1 AND p.digest_enabled_at < ?
      AND NOT EXISTS (SELECT 1 FROM builder_activity_emails WHERE user_id = p.user_id AND kind = 'digest' AND period_key = ?)
      AND ${emailActivityExistsSql()} ORDER BY p.user_id LIMIT ${MAX_BATCH}`)
    .bind(period.until, period.key, period.from, period.until).all<Recipient>();
  for (const recipient of recipients.results) {
    const from = recipient.digest_enabled_at && recipient.digest_enabled_at > period.from ? recipient.digest_enabled_at : period.from;
    await queueEmail(db, recipient, 'digest', period.key, await loadEmailActivity(db, recipient.user_id, from, period.until), now, period.expires);
  }
}
async function sendPending(db: D1DatabaseSession, env: Env, now: string, fetcher: typeof fetch, onlyUserId?: string): Promise<number> {
  let sent = 0;
  for (let index = 0; index < (onlyUserId ? 1 : MAX_BATCH); index++) {
    const lease = crypto.randomUUID();
    const row = await db.prepare(`UPDATE builder_activity_emails SET lease_token = ?, lease_until = ?, attempts = attempts + 1
      WHERE id = (SELECT id FROM builder_activity_emails WHERE sent_at IS NULL AND cancelled_at IS NULL
        AND expires_at > ? AND attempts < 8 AND created_at > ? AND (lease_until IS NULL OR lease_until <= ?)
        ${onlyUserId ? 'AND user_id = ?' : ''} ORDER BY (kind = 'dethroned') DESC, created_at, id LIMIT 1)
      RETURNING id, user_id, kind, message_json, created_at, attempts`)
      .bind(lease, new Date(Date.parse(now) + 120000).toISOString(), now, new Date(Date.parse(now) - 23 * HOUR).toISOString(), now,
        ...(onlyUserId ? [onlyUserId] : [])).first<PendingEmail>();
    if (!row) break;
    try {
      const active = await db.prepare(`SELECT u.email FROM builder_activity_preferences p JOIN users u ON u.id = p.user_id
        WHERE p.user_id = ? AND ${ELIGIBLE_RECIPIENT}
          AND (? = 'digest' AND p.weekly_digest = 1 AND p.digest_enabled_at <= ?
            OR ? = 'dethroned' AND p.dethrone_alerts = 1 AND p.dethrone_enabled_at <= ?)`)
        .bind(row.user_id, row.kind, row.created_at, row.kind, row.created_at).first<{ email: string }>();
      const message = JSON.parse(row.message_json) as EmailMessage;
      if (!active || active.email !== message.to) {
        await db.prepare('UPDATE builder_activity_emails SET cancelled_at = ?, lease_token = NULL, lease_until = NULL WHERE id = ? AND lease_token = ?')
          .bind(now, row.id, lease).all(); continue;
      }
      const providerId = await deliverEmail(env, message, row.id, fetcher);
      await db.prepare(`UPDATE builder_activity_emails SET sent_at = ?, provider_id = ?, lease_token = NULL, lease_until = NULL, last_error = NULL
        WHERE id = ? AND lease_token = ?`).bind(now, providerId, row.id, lease).all();
      sent++;
    } catch (error) {
      await db.prepare(`UPDATE builder_activity_emails SET lease_token = NULL, lease_until = ?, last_error = ? WHERE id = ? AND lease_token = ?`)
        .bind(new Date(Date.parse(now) + Math.min(4 * HOUR, 15 * 60000 * 2 ** (row.attempts - 1))).toISOString(),
          error instanceof Error ? error.message.slice(0, 200) : 'Activity email delivery failed.', row.id, lease).all();
      console.error(JSON.stringify({ event: 'activity-email-failed', kind: row.kind, attempts: row.attempts }));
      // A provider outage/rate limit should not trigger a burst of further requests.
      break;
    }
  }
  return sent;
}
export async function runActivityEmails(env: Env, options: { now?: string; fetcher?: typeof fetch; attemptId?: string } = {}): Promise<{ sent: number }> {
  if (!env.RESEND_API_KEY?.trim()) return { sent: 0 };
  const now = options.now ?? new Date().toISOString();
  const db = env.DB.withSession?.('first-primary') ?? env.DB;
  await queueDethrones(db, now, options.attemptId);
  if (!options.attemptId) await queueDigests(db, now);
  // Immediate delivery is restricted to the displaced players from this verified run.
  if (options.attemptId) {
    const recipients = await db.prepare(`SELECT DISTINCT a.recipient_user_id FROM builder_activity a JOIN pxp_events xp ON xp.id = a.source_id
      WHERE a.kind = 'dethroned' AND xp.source_id = ? LIMIT 4`).bind(options.attemptId).all<{ recipient_user_id: string }>();
    let sent = 0;
    for (const recipient of recipients.results) sent += await sendPending(db, env, now, options.fetcher ?? fetch, recipient.recipient_user_id);
    return { sent };
  }
  return { sent: await sendPending(db, env, now, options.fetcher ?? fetch) };
}
export function scheduleActivityEmails(env: Env, context: WorkerExecutionContextLike | undefined, attemptId: string): void {
  if (!context || !env.RESEND_API_KEY?.trim()) return;
  context.waitUntil(runActivityEmails(env, { attemptId }).catch(() => {
    console.error(JSON.stringify({ event: 'activity-email-dispatch-failed' }));
  }));
}

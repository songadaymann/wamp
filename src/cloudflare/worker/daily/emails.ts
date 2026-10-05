import type { Env } from '../core/types';
import { deliverEmail, escapeEmailHtml } from '../email/delivery';
import { createActivityUnsubscribeToken } from '../activity/unsubscribe';
import type { PreferenceRow } from '../activity/store';
import { dailyPickAvailable, dailyWindow, type DailyRow } from './store';

/** Scheduled only; a public read never sends email. One leased, idempotent notice per pick. */
export async function sendDailyFeatureEmail(env: Env, now = new Date().toISOString(), fetcher: typeof fetch = fetch): Promise<number> {
  if (!env.RESEND_API_KEY?.trim()) return 0;
  const scoped = { ...env, DB: env.DB.withSession?.('first-primary') ?? env.DB };
  const lease = crypto.randomUUID();
  const row = await scoped.DB.prepare(`UPDATE daily_rooms SET notice_lease_token = ?, notice_lease_until = ?, notice_attempts = notice_attempts + 1
    WHERE date = ? AND notice_sent_at IS NULL AND notice_attempts < 8
      AND (notice_lease_until IS NULL OR notice_lease_until <= ?)
      AND EXISTS (SELECT 1 FROM builder_activity_preferences p JOIN users u ON u.id = p.user_id
        WHERE p.user_id = daily_rooms.builder_user_id AND p.daily_features = 1 AND p.daily_enabled_at <= daily_rooms.picked_at
          AND u.email IS NOT NULL AND trim(u.email) <> ''
          AND NOT EXISTS (SELECT 1 FROM school_students WHERE user_id = u.id)) RETURNING *`)
    .bind(lease,new Date(Date.parse(now)+120000).toISOString(),dailyWindow(now).date,now)
    .first<DailyRow & {notice_attempts:number}>();
  if (!row) return 0;
  try {
    const prefs = await scoped.DB.prepare(`SELECT p.*, u.email FROM builder_activity_preferences p JOIN users u ON u.id = p.user_id
      WHERE p.user_id = ? AND p.daily_features = 1 AND p.daily_enabled_at <= ?
        AND NOT EXISTS (SELECT 1 FROM school_students WHERE user_id = p.user_id)`)
      .bind(row.builder_user_id,row.picked_at).first<PreferenceRow & {email:string}>();
    if (!prefs?.email || !await dailyPickAvailable(scoped,row)) {
      await scoped.DB.prepare('UPDATE daily_rooms SET notice_lease_token=NULL, notice_lease_until=NULL WHERE date=? AND notice_lease_token=?')
        .bind(row.date,lease).all();
      return 0;
    }
    const token = await createActivityUnsubscribeToken(prefs,'daily',row.picked_at);
    const unsubscribe = `https://api.wamp.land/api/activity/unsubscribe?token=${encodeURIComponent(token)}`;
    const title = `Your level is Room of the Day: ${row.title}`;
    await deliverEmail(env,{to:prefs.email,subject:title,
      text:`${title}\n\nThanks for building in WAMP! ${row.title} is the community challenge for ${row.date} (UTC).\nPlay and share: https://wamp.land/today\n\nUnsubscribe: ${unsubscribe}`,
      html:`<h2>${escapeEmailHtml(title)}</h2><p>Thanks for building in WAMP! Your level is the community challenge for ${row.date} (UTC).</p><p><a href="https://wamp.land/today">Play and share Room of the Day</a></p><p><a href="${escapeEmailHtml(unsubscribe)}">Unsubscribe from Room of the Day emails</a></p>`,
      headers:{'List-Unsubscribe':`<${unsubscribe}>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'}},
      `daily-feature:${row.date}:${row.target_key}:${row.version}`,fetcher);
    await scoped.DB.prepare('UPDATE daily_rooms SET notice_sent_at=?, notice_lease_token=NULL, notice_lease_until=NULL, notice_last_error=NULL WHERE date=? AND notice_lease_token=?')
      .bind(now,row.date,lease).all();
    return 1;
  } catch (error) {
    await scoped.DB.prepare('UPDATE daily_rooms SET notice_lease_token=NULL, notice_lease_until=?, notice_last_error=? WHERE date=? AND notice_lease_token=?')
      .bind(new Date(Date.parse(now)+Math.min(4*3600000,15*60000*2**(row.notice_attempts-1))).toISOString(),
        error instanceof Error ? error.message.slice(0,200) : 'Feature email failed.',row.date,lease).all();
    console.error(JSON.stringify({event:'daily-feature-email-failed',date:row.date,attempts:row.notice_attempts}));
    return 0;
  }
}

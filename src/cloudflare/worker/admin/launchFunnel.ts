import type { LaunchFunnelResponse } from '../../../admin/model';
import { requireAdminRequest } from '../auth/request';
import { HttpError, jsonResponse } from '../core/http';
import type { Env } from '../core/types';

const DAY_MS = 24 * 60 * 60 * 1000;
const PHONE_AGENT = `(f.user_agent LIKE '%Mobi%' OR f.user_agent LIKE '%Android%' OR f.user_agent LIKE '%iPhone%' OR f.user_agent LIKE '%iPad%')`;
const ROBOT_AGENT = `(COALESCE(f.user_agent, '') LIKE '%bot%' OR COALESCE(f.user_agent, '') LIKE '%crawl%'
  OR COALESCE(f.user_agent, '') LIKE '%spider%' OR COALESCE(f.user_agent, '') LIKE '%Headless%'
  OR COALESCE(f.user_agent, '') LIKE '%Lighthouse%')`;

/**
 * Each guest's first visit, for guests whose first visit falls in [from, to): found through the
 * first_seen_at index, then checked against that guest's other visits. Crawlers are left out.
 */
const FIRST_VISITS = `firsts AS (
    SELECT f.guest_user_id, f.session_id, f.first_seen_at, f.user_agent,
      CASE WHEN f.first_landing_path IS NULL THEN 'unknown'
        ELSE COALESCE(f.first_source, f.first_referrer_host, 'direct') END AS source
    FROM guest_visits f
    WHERE f.first_seen_at >= ? AND f.first_seen_at < ?
      AND NOT ${ROBOT_AGENT}
      AND NOT EXISTS (SELECT 1 FROM guest_visits p WHERE p.guest_user_id = f.guest_user_id
        AND (p.first_seen_at < f.first_seen_at OR (p.first_seen_at = f.first_seen_at AND p.session_id < f.session_id)))
  )`;

/**
 * New guests in a window, followed through play, building, a verified clear, signing up and
 * publishing, split by where their first visit came from (F127). Guests are browsers (the stored
 * guest id), so one person on two devices counts twice. Play, build and clear count guest activity
 * only (heartbeats stop at sign-in), and guest clears are pruned after 14 days. Accounts are linked
 * to their guest only from this release on.
 */
export async function handleAdminLaunchFunnel(request: Request, url: URL, env: Env): Promise<Response> {
  requireAdminRequest(env, request, 'read the launch funnel');
  const days = Number(url.searchParams.get('days') ?? '7');
  if (![7, 30].includes(days)) throw new HttpError(400, 'days must be 7 or 30.');
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const since = iso(now - days * DAY_MS);
  const until = iso(now + DAY_MS);
  const cohort = `WITH ${FIRST_VISITS}, steps AS (
      SELECT f.guest_user_id, f.source, ${PHONE_AGENT} AS phone,
        EXISTS (SELECT 1 FROM guest_visits v WHERE v.guest_user_id = f.guest_user_id AND v.play_seconds > 0) AS played,
        EXISTS (SELECT 1 FROM guest_visits v WHERE v.guest_user_id = f.guest_user_id AND v.edit_seconds > 0) AS built,
        EXISTS (SELECT 1 FROM guest_run_attempts a WHERE a.guest_user_id = f.guest_user_id
          AND a.result = 'completed' AND a.verification_status = 'passed') AS cleared,
        (SELECT MIN(u.id) FROM users u WHERE u.signup_guest_user_id = f.guest_user_id) AS user_id
      FROM firsts f
    )`;
  // A return is a separate visit that started at least 12 hours and at most 2 (or 7) days after
  // the first one; only guests whose whole window has passed count, so older guests are included.
  const returnedWithin = (maxDays: number) => `EXISTS (SELECT 1 FROM guest_visits r
      WHERE r.guest_user_id = f.guest_user_id AND r.session_id <> f.session_id
        AND julianday(r.first_seen_at) - julianday(f.first_seen_at) BETWEEN 0.5 AND ${maxDays})`;
  const [totals, sources, returns] = await Promise.all([
    env.DB.prepare(`${cohort}
      SELECT COUNT(*) AS visitors, SUM(played) AS played, SUM(built) AS built, SUM(cleared) AS cleared,
        SUM(user_id IS NOT NULL) AS signed_up,
        SUM(user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users u JOIN room_versions v ON v.published_by_user_id = u.id
          WHERE u.signup_guest_user_id = steps.guest_user_id)) AS published,
        SUM(phone) AS phone
      FROM steps`).bind(since, until).first<Record<string, number | null>>(),
    env.DB.prepare(`${cohort}
      SELECT source, COUNT(*) AS visitors, SUM(played) AS played, SUM(built) AS built, SUM(user_id IS NOT NULL) AS signed_up
      FROM steps GROUP BY source ORDER BY visitors DESC LIMIT 12`).bind(since, until).all<Record<string, string | number | null>>(),
    env.DB.prepare(`WITH ${FIRST_VISITS}
      SELECT
        SUM(f.first_seen_at < ?) AS d1_eligible,
        SUM(f.first_seen_at < ? AND ${returnedWithin(2)}) AS d1_returned,
        SUM(f.first_seen_at < ?) AS d7_eligible,
        SUM(f.first_seen_at < ? AND ${returnedWithin(7)}) AS d7_returned
      FROM firsts f`)
      .bind(iso(now - (days + 7) * DAY_MS), until,
        iso(now - 2 * DAY_MS), iso(now - 2 * DAY_MS), iso(now - 7 * DAY_MS), iso(now - 7 * DAY_MS))
      .first<Record<string, number | null>>(),
  ]);
  const n = (value: unknown) => Number(value ?? 0);
  const response: LaunchFunnelResponse = {
    days,
    since,
    steps: {
      visitors: n(totals?.visitors), played: n(totals?.played), built: n(totals?.built), cleared: n(totals?.cleared),
      signedUp: n(totals?.signed_up), published: n(totals?.published),
    },
    phoneVisitors: n(totals?.phone),
    sources: sources.results.map((row) => ({
      source: String(row.source ?? 'direct'), visitors: n(row.visitors), played: n(row.played),
      built: n(row.built), signedUp: n(row.signed_up),
    })),
    returns: {
      d1: { eligible: n(returns?.d1_eligible), returned: n(returns?.d1_returned) },
      d7: { eligible: n(returns?.d7_eligible), returned: n(returns?.d7_returned) },
    },
  };
  return jsonResponse(request, response, { headers: { 'Cache-Control': 'no-store' } });
}

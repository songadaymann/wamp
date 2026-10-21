import {
  REPORT_DETAILS_LIMIT,
  REPORT_REASONS,
  REPORT_REASON_LABELS,
  REPORT_TARGET_TYPES,
  type AdminContentReport,
  type AdminContentReportsResponse,
  type ContentReportRequestBody,
  type ContentReportResponse,
  type ReportReason,
  type ReportTargetType,
} from '../../../reports/model';
import { sendAdminReviewNotificationEmail } from '../admin/reviewNotifications';
import { loadOptionalRequestAuth, requireAdminRequest, requireTrustedOriginForMutation } from '../auth/request';
import { resolvePublicBaseUrl } from '../auth/store';
import { HttpError, jsonResponse, parseJsonBody } from '../core/http';
import {
  getClientIp,
  hashRateLimitKey,
  networkKeyForIp,
  releaseRateLimitSlots,
  takeRateLimitSlot,
  takeRateLimitSlots,
  type RateLimitRule,
} from '../core/rateLimit';
import type { Env, WorkerExecutionContextLike } from '../core/types';

const DAY_MS = 24 * 60 * 60 * 1000;
const REPORTS_PER_IDENTITY: RateLimitRule = { bucket: 'content-report:identity', limit: 10, windowMs: DAY_MS };
const REPORTS_PER_NETWORK: RateLimitRule = { bucket: 'content-report:network', limit: 30, windowMs: DAY_MS };
/** Guests only: signed-in players can always report, even if guests used up the day. */
const GUEST_REPORTS_IN_ALL: RateLimitRule = { bucket: 'content-report:all', limit: 1000, windowMs: DAY_MS };
/** The first report on each item emails the admin; past this many a day, the admin list has the rest. */
const REPORT_EMAILS_PER_DAY: RateLimitRule = { bucket: 'content-report:email', limit: 20, windowMs: DAY_MS };
const LABEL_LIMIT = 300;
const REPORT_ID = /^[a-f0-9-]{36}$/;

interface ReportTargetFacts {
  label: string;
  userId: string | null;
}

const noStore = (request: Request, value: unknown, status = 200) =>
  jsonResponse(request, value, { status, headers: { 'Cache-Control': 'no-store' } });

function clip(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
}

/** What the reporter is looking at, read on the server so a report cannot invent its evidence. */
async function loadReportTarget(env: Env, type: ReportTargetType, id: string): Promise<ReportTargetFacts | null> {
  switch (type) {
    case 'room': {
      const row = await env.DB.prepare(
        `SELECT x, y, published_title, COALESCE(last_published_by_user_id, claimer_user_id) AS user_id
         FROM rooms WHERE id = ? AND published_json IS NOT NULL LIMIT 1`,
      ).bind(id).first<{ x: number; y: number; published_title: string | null; user_id: string | null }>();
      return row ? { label: `${row.published_title?.trim() || 'Untitled room'} (${row.x}, ${row.y})`, userId: row.user_id } : null;
    }
    case 'user': {
      const row = await env.DB.prepare('SELECT id, display_name, username FROM users WHERE id = ? LIMIT 1')
        .bind(id).first<{ id: string; display_name: string | null; username: string | null }>();
      return row ? { label: `${row.display_name ?? 'Player'}${row.username ? ` (@${row.username})` : ''}`, userId: row.id } : null;
    }
    case 'chat_message': {
      const row = await env.DB.prepare('SELECT user_id, user_display_name, body FROM chat_messages WHERE id = ? LIMIT 1')
        .bind(id).first<{ user_id: string; user_display_name: string; body: string }>();
      return row ? { label: `${row.user_display_name}: ${row.body}`, userId: row.user_id } : null;
    }
    case 'guest_room': {
      const row = await env.DB.prepare(
        `SELECT title, guest_display_name, room_x, room_y FROM guest_room_drafts
         WHERE id = ? AND moderation_status = 'public' AND hidden_at IS NULL LIMIT 1`,
      ).bind(id).first<{ title: string | null; guest_display_name: string | null; room_x: number; room_y: number }>();
      return row ? {
        label: `Guest room ${row.title?.trim() || 'Untitled'} by ${row.guest_display_name ?? 'Guest'} (${row.room_x}, ${row.room_y})`,
        userId: null,
      } : null;
    }
    default:
      return null;
  }
}

function parseReportBody(body: Partial<ContentReportRequestBody> | null): ContentReportRequestBody {
  if (!body || !REPORT_TARGET_TYPES.includes(body.targetType as ReportTargetType)) {
    throw new HttpError(400, 'Choose what you are reporting.');
  }
  if (typeof body.targetId !== 'string' || !body.targetId.trim() || body.targetId.length > 120) {
    throw new HttpError(400, 'The reported item is missing.');
  }
  if (!REPORT_REASONS.includes(body.reason as ReportReason)) {
    throw new HttpError(400, 'Choose a reason.');
  }
  const details = typeof body.details === 'string' ? body.details.trim() : '';
  if (details.length > REPORT_DETAILS_LIMIT) {
    throw new HttpError(400, `Keep the details under ${REPORT_DETAILS_LIMIT} characters.`);
  }
  return {
    targetType: body.targetType as ReportTargetType,
    targetId: body.targetId.trim(),
    reason: body.reason as ReportReason,
    details,
  };
}

async function handleReportSubmit(
  request: Request,
  env: Env,
  context?: WorkerExecutionContextLike,
): Promise<Response> {
  const body = parseReportBody(await parseJsonBody<Partial<ContentReportRequestBody>>(request, { maxBytes: 4_000 }));
  const auth = await loadOptionalRequestAuth(env, request);
  const target = await loadReportTarget(env, body.targetType, body.targetId);
  if (!target) {
    throw new HttpError(404, 'That item is no longer available to report.');
  }
  if (auth && target.userId === auth.user.id) {
    throw new HttpError(400, 'You cannot report your own content.');
  }
  const ip = getClientIp(request);
  const network = ip ? networkKeyForIp(ip) : 'network:unknown';
  // A guest's browser id can be changed at will, so guests are counted by network instead.
  const reporterHash = await hashRateLimitKey(env, auth ? `report-user:${auth.user.id}` : `report-guest:${network}`);
  const { ids, limitedBy } = await takeRateLimitSlots(env, [
    { rule: REPORTS_PER_IDENTITY, keyHash: reporterHash },
    ...(ip ? [{ rule: REPORTS_PER_NETWORK, keyHash: await hashRateLimitKey(env, network) }] : []),
    ...(auth ? [] : [{ rule: GUEST_REPORTS_IN_ALL, keyHash: 'all' }]),
  ]);
  if (limitedBy) {
    throw new HttpError(429, 'You have sent a lot of reports today. Thank you — try again tomorrow.');
  }
  const now = new Date().toISOString();
  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO content_reports
      (id, target_type, target_id, target_label, target_user_id, reason, details, reporter_user_id, reporter_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id`,
  )
    .bind(crypto.randomUUID(), body.targetType, body.targetId, clip(target.label, LABEL_LIMIT), target.userId,
      body.reason, body.details, auth?.user.id ?? null, reporterHash, now)
    .first<{ id: string }>();
  if (!inserted) {
    await releaseRateLimitSlots(env, ids);
    const response: ContentReportResponse = { ok: true, alreadyReported: true };
    return noStore(request, response);
  }
  const earlier = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM content_reports
     WHERE target_type = ? AND target_id = ? AND status = 'open' AND id <> ? AND created_at <= ?`,
  ).bind(body.targetType, body.targetId, inserted.id, now).first<{ count: number }>();
  // Email only for the first open report on a target; later ones show up in the admin list.
  if (Number(earlier?.count ?? 0) === 0 && await takeRateLimitSlot(env, REPORT_EMAILS_PER_DAY, 'email') !== null) {
    const email = sendAdminReviewNotificationEmail(env, {
      subject: `WAMP report: ${clip(target.label, 80)}`,
      heading: 'A player sent a report',
      intro: `${REPORT_REASON_LABELS[body.reason]} — ${body.targetType.replace('_', ' ')}.`,
      details: [clip(target.label, LABEL_LIMIT), ...(body.details ? [`Details: ${body.details}`] : [])],
      actionUrl: `${resolvePublicBaseUrl(request, env)}/suspicious-admin.html`,
      actionLabel: 'Review reports',
    }).then((result) => {
      if (result.error) console.error(JSON.stringify({ event: 'content-report-email-failed', error: result.error }));
    });
    if (context?.waitUntil) context.waitUntil(email);
    else await email;
  }
  const response: ContentReportResponse = { ok: true, alreadyReported: false };
  return noStore(request, response, 201);
}

interface ReportRow {
  id: string; target_type: ReportTargetType; target_id: string; target_label: string; target_user_id: string | null;
  reason: ReportReason; details: string; reporter_user_id: string | null; status: AdminContentReport['status'];
  open_for_target: number; created_at: string;
}

async function handleAdminReports(request: Request, url: URL, env: Env): Promise<Response> {
  requireAdminRequest(env, request, 'review player reports');
  const match = /^\/api\/admin\/reports(?:\/([^/]+))?$/.exec(url.pathname);
  if (!match) throw new HttpError(404, 'Report route not found.');
  if (!match[1]) {
    if (request.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
    const status = url.searchParams.get('status') ?? 'open';
    if (!['open', 'resolved', 'dismissed', 'all'].includes(status)) throw new HttpError(400, 'Invalid report filter.');
    const rows = await env.DB.prepare(
      `SELECT r.*, (SELECT COUNT(*) FROM content_reports o
          WHERE o.target_type = r.target_type AND o.target_id = r.target_id AND o.status = 'open') AS open_for_target
       FROM content_reports r WHERE ? = 'all' OR r.status = ? ORDER BY r.created_at DESC LIMIT 100`,
    ).bind(status, status).all<ReportRow>();
    const response: AdminContentReportsResponse = {
      reports: rows.results.map((row) => ({
        id: row.id, targetType: row.target_type, targetId: row.target_id, targetLabel: row.target_label,
        targetUserId: row.target_user_id, reason: row.reason, details: row.details,
        reporterSignedIn: row.reporter_user_id !== null, status: row.status,
        openReportsForTarget: Number(row.open_for_target), createdAt: row.created_at,
      })),
    };
    return noStore(request, response);
  }
  if (request.method !== 'PATCH' || !REPORT_ID.test(match[1])) throw new HttpError(404, 'Report not found.');
  const body = await parseJsonBody<{ status?: unknown; allForTarget?: unknown; operatorLabel?: unknown }>(request, { maxBytes: 1_000 });
  if (body.status !== 'resolved' && body.status !== 'dismissed') throw new HttpError(400, 'Invalid report status.');
  const report = await env.DB.prepare('SELECT target_type, target_id FROM content_reports WHERE id = ?')
    .bind(match[1]).first<{ target_type: string; target_id: string }>();
  if (!report) throw new HttpError(404, 'Report not found.');
  const operator = typeof body.operatorLabel === 'string' && body.operatorLabel.trim() ? body.operatorLabel.trim().slice(0, 80) : 'Admin';
  const now = new Date().toISOString();
  await env.DB.batch([body.allForTarget === true
    ? env.DB.prepare(`UPDATE content_reports SET status = ?, resolved_at = ?, resolved_by = ?
        WHERE target_type = ? AND target_id = ? AND status = 'open'`)
      .bind(body.status, now, operator, report.target_type, report.target_id)
    : env.DB.prepare('UPDATE content_reports SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ?')
      .bind(body.status, now, operator, match[1])]);
  return noStore(request, { ok: true });
}

export async function handleContentReports(
  request: Request,
  url: URL,
  env: Env,
  context?: WorkerExecutionContextLike,
): Promise<Response> {
  requireTrustedOriginForMutation(request);
  if (url.pathname.startsWith('/api/admin/reports')) return handleAdminReports(request, url, env);
  if (url.pathname === '/api/reports' && request.method === 'POST') return handleReportSubmit(request, env, context);
  throw new HttpError(404, 'Route not found.');
}

/** Called from the hourly job: closed reports are kept 90 days, open ones until handled. */
export async function pruneClosedContentReports(env: Env, now: Date): Promise<void> {
  await env.DB.batch([env.DB.prepare(`DELETE FROM content_reports WHERE status <> 'open' AND resolved_at < ?`)
    .bind(new Date(now.getTime() - 90 * DAY_MS).toISOString())]);
}

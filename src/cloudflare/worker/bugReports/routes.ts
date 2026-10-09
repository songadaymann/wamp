import { loadOptionalRequestAuth, requireAdminRequest, requireTrustedOriginForMutation } from '../auth/request';
import { HttpError, jsonResponse, parseJsonBody } from '../core/http';
import { getClientIp, hashRateLimitKey, networkKeyForIp } from '../core/rateLimit';
import type { Env } from '../core/types';
import { BUG_EVIDENCE_LIMIT, type BugEvidence, type BugReportDetail, type BugReportSummary } from '../../../bugReports/model';
import { BUG_REPORT_ID, validateBugReport } from './validation';

const DAY = 86_400_000;
const reply = (request: Request, value: unknown) => jsonResponse(request, value, { headers: { 'Cache-Control': 'no-store' } });
interface ReportRow {
  id: string; notes: string; status: 'open' | 'resolved'; created_at: string; user_id: string | null;
  build: string; context_json: string; device_json: string; errors_json: string; evidence_reason: BugEvidence['reason'];
  frames: number; duration_ms: number; has_screenshot: number; evidence_expires_at: string | null;
}
const SUMMARY_COLUMNS = 'id, notes, status, created_at, user_id, build, context_json, frames, duration_ms, has_screenshot, evidence_expires_at';
function summary(row: ReportRow): BugReportSummary {
  return { id: row.id, notes: row.notes, status: row.status, createdAt: row.created_at, signedIn: Boolean(row.user_id),
    build: row.build, context: JSON.parse(row.context_json), frames: row.frames, durationMs: row.duration_ms,
    hasScreenshot: Boolean(row.has_screenshot), evidenceExpiresAt: row.evidence_expires_at };
}
export async function purgeBugReports(env: Env): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM bug_report_evidence WHERE expires_at <= ?').bind(now),
    env.DB.prepare('DELETE FROM bug_reports WHERE expires_at <= ?').bind(now),
  ]);
}
export async function handleBugReports(request: Request, url: URL, env: Env): Promise<Response> {
  requireTrustedOriginForMutation(request);
  const db = env.DB.withSession?.('first-primary') ?? env.DB;
  if (url.pathname.startsWith('/api/admin/bug-reports')) {
    requireAdminRequest(env, request, 'review bug reports');
    const match = /^\/api\/admin\/bug-reports(?:\/([a-f0-9-]+))?$/.exec(url.pathname);
    if (!match || (match[1] && !BUG_REPORT_ID.test(match[1]))) throw new HttpError(404, 'Report not found.');
    const id = match[1];
    if (!id) {
      if (request.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
      const status = url.searchParams.get('status') ?? 'open';
      if (!['open','resolved','all'].includes(status)) throw new HttpError(400, 'Invalid report filter.');
      const rows = await db.prepare(`SELECT ${SUMMARY_COLUMNS} FROM bug_reports WHERE expires_at > ? AND (? = 'all' OR status = ?) ORDER BY created_at DESC LIMIT 100`)
        .bind(new Date().toISOString(), status, status).all<ReportRow>();
      return reply(request, { reports: rows.results.map(summary) });
    }
    const row = await db.prepare(`SELECT ${SUMMARY_COLUMNS}, device_json, errors_json, evidence_reason FROM bug_reports WHERE id = ? AND expires_at > ?`)
      .bind(id, new Date().toISOString()).first<ReportRow>();
    if (!row) throw new HttpError(404, 'Report not found or expired.');
    if (request.method === 'PATCH') {
      const body = await parseJsonBody<{ status?: unknown }>(request, { maxBytes: 1000 });
      if (body.status !== 'open' && body.status !== 'resolved') throw new HttpError(400, 'Invalid report status.');
      await db.batch([db.prepare('UPDATE bug_reports SET status = ? WHERE id = ?').bind(body.status, id)]);
      return reply(request, { id, status: body.status });
    }
    if (request.method === 'DELETE') {
      await db.batch([db.prepare('DELETE FROM bug_reports WHERE id = ?').bind(id)]);
      return reply(request, { ok: true });
    }
    if (request.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
    const saved = await db.prepare('SELECT payload FROM bug_report_evidence WHERE report_id = ? AND expires_at > ?')
      .bind(id, new Date().toISOString()).first<{ payload: string }>();
    const detail: BugReportDetail = { ...summary(row), device: JSON.parse(row.device_json), errors: JSON.parse(row.errors_json),
      evidence: saved ? JSON.parse(saved.payload) : { samples: [], screenshot: null, reason: row.evidence_reason === 'captured' ? 'unavailable' : row.evidence_reason } };
    return reply(request, { report: detail });
  }
  if (url.pathname !== '/api/bug-reports' || request.method !== 'POST') throw new HttpError(404, 'Route not found.');
  const body = validateBugReport(await parseJsonBody<unknown>(request, { maxBytes: BUG_EVIDENCE_LIMIT + 30_000 }));
  const auth = await loadOptionalRequestAuth(env, request);
  const identity = await hashRateLimitKey(env, auth ? `bug-user:${auth.user.id}` : `bug-guest:${body.visitor}`);
  const ip = getClientIp(request);
  const network = await hashRateLimitKey(env, ip ? networkKeyForIp(ip) : 'bug-unknown-network');
  const hashBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(body)));
  const submissionHash = Array.from(new Uint8Array(hashBytes), byte => byte.toString(16).padStart(2, '0')).join('');
  const existing = await db.prepare('SELECT identity_hash, submission_hash FROM bug_reports WHERE id = ?').bind(body.id)
    .first<{ identity_hash: string; submission_hash: string }>();
  if (existing) {
    if (existing.identity_hash !== identity || existing.submission_hash !== submissionHash) throw new HttpError(409, 'This report identity was already used.');
    return reply(request, { id: body.id, stored: true });
  }
  const now = new Date(), since = new Date(now.getTime() - DAY).toISOString();
  const evidenceJson = JSON.stringify(body.evidence);
  const hasEvidence = body.evidence.samples.length > 0 || Boolean(body.evidence.screenshot);
  const evidenceBytes = hasEvidence ? evidenceJson.length : 0;
  const evidenceExpiry = hasEvidence ? new Date(now.getTime() + 7 * DAY).toISOString() : null;
  // Atomic metadata/evidence gates: 100 reports/day, 5 per identity/day,
  // 10 per network/hour, 200 clips and 128 MB of replay JSON. Notes last 30 days.
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO bug_reports (${SUMMARY_COLUMNS}, identity_hash, network_hash, submission_hash, expires_at,
      device_json, errors_json, evidence_reason)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
      WHERE (SELECT COUNT(*) FROM bug_reports WHERE created_at > ?) < 100
        AND (SELECT COUNT(*) FROM bug_reports WHERE identity_hash = ? AND created_at > ?) < 5
        AND (SELECT COUNT(*) FROM bug_reports WHERE network_hash = ? AND created_at > ?) < 10
        AND (? = 0 OR ((SELECT COUNT(*) FROM bug_report_evidence WHERE expires_at > ?) < 200
          AND (SELECT COALESCE(SUM(bytes),0) FROM bug_report_evidence WHERE expires_at > ?) + ? <= 128000000))`)
      .bind(body.id, body.notes, 'open', now.toISOString(), auth?.user.id ?? null, body.build, JSON.stringify(body.context),
        body.evidence.samples.length, body.evidence.samples.at(-1)?.time ?? 0, body.evidence.screenshot ? 1 : 0, evidenceExpiry,
        identity, network, submissionHash, new Date(now.getTime() + 30 * DAY).toISOString(), JSON.stringify(body.device), JSON.stringify(body.errors), body.evidence.reason,
        since, identity, since, network, new Date(now.getTime() - 3_600_000).toISOString(), evidenceBytes,
        now.toISOString(), now.toISOString(), evidenceBytes),
    ...(hasEvidence ? [db.prepare(`INSERT OR IGNORE INTO bug_report_evidence (report_id,payload,bytes,expires_at)
      SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM bug_reports WHERE id = ? AND identity_hash = ? AND submission_hash = ?)`)
      .bind(body.id, evidenceJson, evidenceBytes, evidenceExpiry, body.id, identity, submissionHash)] : []),
  ]);
  const stored = await db.prepare('SELECT identity_hash, submission_hash FROM bug_reports WHERE id = ?').bind(body.id)
    .first<{ identity_hash: string; submission_hash: string }>();
  if (!stored) throw new HttpError(429, 'Report limit reached. Try later, or turn off image attachments to send a written report.');
  if (stored.identity_hash !== identity || stored.submission_hash !== submissionHash) throw new HttpError(409, 'This report identity was already used.');
  return reply(request, { id: body.id, stored: true });
}

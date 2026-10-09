import { requireAdminRequest, requireTrustedOriginForMutation } from '../auth/request';
import { HttpError, jsonResponse } from '../core/http';
import type { Env } from '../core/types';
import { flushRunGhostArchive } from './ghostArchive';
import { GHOST_ARCHIVE_COST_THRESHOLD_USD, checkGhostArchiveCost, ghostArchiveAlertConfigured,
  ghostArchiveAlertRecipient, loadGhostArchiveBudget } from './ghostArchiveCosts';

export async function handleAdminGhostArchive(request: Request, url: URL, env: Env): Promise<Response> {
  requireAdminRequest(env, request, 'manage ghost archive');
  requireTrustedOriginForMutation(request);
  const headers = { 'Cache-Control': 'private, no-store' };
  if (url.pathname === '/api/admin/run-ghost-archive/status' && request.method === 'GET') {
    const [budget, pending] = await Promise.all([
      loadGhostArchiveBudget(env),
      env.DB.prepare('SELECT COUNT(*) AS count FROM run_ghost_archive WHERE archived_at IS NULL')
        .first<{ count: number }>(),
    ]);
    return jsonResponse(request, {
      archiveConfigured: Boolean(env.RUN_GHOST_BUCKET),
      runs: budget.totals?.runs ?? 0, payloadBytes: budget.totals?.payload_bytes ?? 0,
      pendingUploads: pending?.count ?? 0, billingPeriodStart: budget.period,
      uploads: budget.usage?.uploads ?? 0, downloads: budget.usage?.downloads ?? 0,
      estimatedMonthlyR2Cost: budget.cost, conservativeEstimate: true,
      alertThresholdUsd: GHOST_ARCHIVE_COST_THRESHOLD_USD,
      alertsEnabled: env.RUN_GHOST_COST_ALERTS_ENABLED === '1',
      alertsConfigured: ghostArchiveAlertConfigured(env),
      alertRecipient: ghostArchiveAlertRecipient(env), alertSentAt: budget.usage?.alert_sent_at ?? null,
    }, { headers });
  }
  if (url.pathname === '/api/admin/run-ghost-archive/flush' && request.method === 'POST') {
    return jsonResponse(request, await flushRunGhostArchive(env), { headers });
  }
  if (url.pathname === '/api/admin/run-ghost-archive/check-cost' && request.method === 'POST') {
    return jsonResponse(request, await checkGhostArchiveCost(env), { headers });
  }
  throw new HttpError(404, 'Ghost archive admin route not found.');
}

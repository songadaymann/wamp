import { jsonResponse } from '../core/http';
import type { Env } from '../core/types';
import { worldMapAlertsConfigured } from '../worldTiles/health';
import { LATEST_D1_MIGRATION } from './migrations';

interface HealthResult {
  status: number;
  body: Record<string, unknown>;
}

// /api/health is public: probe the database at most once per isolate every 30 s.
const HEALTH_CACHE_MS = 30_000;
let cached: { at: number; result: HealthResult } | null = null;

async function probe(env: Env): Promise<HealthResult> {
  let database: Record<string, unknown>;
  try {
    const row = await env.DB.prepare('SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1').first<{ name: string }>();
    const latestApplied = row?.name ?? null;
    database = {
      ok: latestApplied === LATEST_D1_MIGRATION,
      latestApplied,
      expected: LATEST_D1_MIGRATION,
      ...(latestApplied !== LATEST_D1_MIGRATION ? { problem: 'The code expects a migration that is not applied.' } : {}),
    };
  } catch (error) {
    database = { ok: false, problem: error instanceof Error ? error.message.slice(0, 200) : 'Database unreachable.' };
  }

  let worldTileOutbox: Record<string, unknown>;
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS pending, MIN(created_at) AS oldest FROM world_render_tile_outbox WHERE state = 'pending'`,
    ).first<{ pending: number; oldest: string | null }>();
    worldTileOutbox = { pending: Number(row?.pending ?? 0), oldestPendingAt: row?.oldest ?? null };
  } catch {
    worldTileOutbox = { pending: null, oldestPendingAt: null };
  }

  const ok = database.ok === true;
  return {
    status: ok ? 200 : 503,
    body: {
      ok,
      storage: 'd1',
      checks: { database, worldTileOutbox },
      worldMapAlertsConfigured: worldMapAlertsConfigured(env),
      auth: {
        emailConfigured: Boolean(env.RESEND_API_KEY),
        debugMagicLinks: env.AUTH_DEBUG_MAGIC_LINKS === '1',
        testResetEnabled: env.ENABLE_TEST_RESET === '1',
      },
    },
  };
}

/** GET /api/health: 200 when the database answers and has every migration this code expects, else 503. */
export async function handleHealth(request: Request, env: Env, now = Date.now()): Promise<Response> {
  if (!cached || now - cached.at >= HEALTH_CACHE_MS) {
    cached = { at: now, result: await probe(env) };
  }
  return jsonResponse(request, { ...cached.result.body, checkedAt: new Date(cached.at).toISOString() }, {
    status: cached.result.status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export function resetHealthCacheForTests(): void {
  cached = null;
}

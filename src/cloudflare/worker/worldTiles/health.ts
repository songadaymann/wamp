import { WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH } from '../../../worldTiles/assetContract';
import type { WorldTileConfig } from '../../../worldTiles/model';
import { DEFAULT_ADMIN_REVIEW_EMAIL } from '../admin/reviewNotifications';
import { DEFAULT_AUTH_EMAIL_FROM } from '../auth/store';
import type { D1DatabaseSession, Env } from '../core/types';

export const WORLD_MAP_HEALTH_CRON = '7,22,37,52 * * * *';
const REMINDER_MS = 24 * 60 * 60 * 1000;
const HEALTH_URL = 'https://api.wamp.land/api/world/tiles/config';
const DOC_URL = 'https://github.com/songadaymann/wamp/blob/main/docs/overworld-tile-pyramid.md';
type AlertKind = 'outage' | 'reminder' | 'recovery' | 'test';
type Fetcher = typeof fetch;

interface Observation {
  status: 'healthy' | 'unhealthy';
  reason: string;
  config: WorldTileConfig | null;
}
interface HealthState {
  revision: number;
  status: Observation['status'];
  incident_id: string | null;
  last_alert_created_at: string | null;
  last_event_id: string | null;
}
interface Message { from: string; to: string; subject: string; text: string }
interface PendingAlert { id: string; message_json: string }

export function worldMapAlertRecipient(env: Env): string {
  return env.WORLD_MAP_ALERT_EMAIL?.trim() || env.ADMIN_REVIEW_EMAIL?.trim() || DEFAULT_ADMIN_REVIEW_EMAIL;
}
export function worldMapAlertsConfigured(env: Env): boolean {
  return env.WORLD_MAP_HEALTH_ALERTS_ENABLED === '1' && Boolean(env.RESEND_API_KEY?.trim())
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(worldMapAlertRecipient(env));
}

export async function observeWorldMap(fetcher: Fetcher = fetch): Promise<Observation> {
  try {
    const response = await fetcher(`${HEALTH_URL}?healthCheck=${Date.now()}`, {
      headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Public map config returned HTTP ${response.status}.`);
    const config = await response.json() as WorldTileConfig;
    const healthy = config.schemaVersion === 1 && config.available === true
      && typeof config.activeRendererVersion === 'string' && config.activeRendererVersion.length > 0
      && config.rolloutPercentage > 0
      && config.activeRendererAssetContractHash === WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH
      && config.expectedRendererAssetContractHash === WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH;
    return { status: healthy ? 'healthy' : 'unhealthy', config,
      reason: healthy ? 'Compatible imagery is available.' : 'Fast-map imagery is disabled or its asset fingerprint is incompatible.' };
  } catch (error) {
    return { status: 'unhealthy', config: null,
      reason: error instanceof Error ? error.message.slice(0, 300) : 'Public map config could not be checked.' };
  }
}

function buildMessage(env: Env, kind: AlertKind, observation: Observation, createdAt: string): Message {
  const subject = {
    outage: '[WAMP] Fast world map is unavailable',
    reminder: '[WAMP] Fast world map is still unavailable',
    recovery: '[WAMP] Fast world map is back',
    test: '[WAMP] Fast-map alerts are enabled',
  }[kind];
  const intro = kind === 'test' ? 'This confirms your direct fast-map email alerts are enabled.'
    : observation.status === 'healthy' ? 'The fast world map is available again.'
      : 'The fast world map check failed. WAMP may be using the slower preview fallback.';
  return {
    from: env.AUTH_EMAIL_FROM?.trim() || DEFAULT_AUTH_EMAIL_FROM,
    to: worldMapAlertRecipient(env), subject,
    text: [intro, '', `Status: ${observation.status}`, `Reason: ${observation.reason}`, `Checked: ${createdAt}`,
      `Active renderer: ${observation.config?.activeRendererVersion ?? 'unknown'}`,
      `Active asset fingerprint: ${observation.config?.activeRendererAssetContractHash ?? 'unknown'}`,
      `Required asset fingerprint: ${WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH}`, '',
      ...(observation.status === 'unhealthy' ? ['For a catalog mismatch: rebuild and verify imagery for the current assets, then activate the matching renderer.', ''] : []),
      'Checks run every 15 minutes. Outages get one initial email, daily reminders, and a recovery email.',
      `Map: https://wamp.land`, `Recovery instructions: ${DOC_URL}`,
    ].join('\n'),
  };
}

async function recordObservation(db: D1DatabaseSession, env: Env, observation: Observation, now: string): Promise<void> {
  await db.batch([db.prepare(`INSERT OR IGNORE INTO world_map_health_state
    (id, revision, status, last_checked_at, snapshot_json) VALUES (1, 0, 'healthy', ?, '{}')`).bind(now)]);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const state = await db.prepare('SELECT * FROM world_map_health_state WHERE id = 1').first<HealthState>();
    if (!state) throw new Error('World map health state is missing.');
    let kind: AlertKind | null = null;
    let incidentId = state.incident_id;
    if (observation.status !== state.status) {
      kind = observation.status === 'unhealthy' ? 'outage' : 'recovery';
      if (kind === 'outage') incidentId = crypto.randomUUID();
    } else if (observation.status === 'unhealthy' && (!state.last_alert_created_at
      || Date.parse(now) - Date.parse(state.last_alert_created_at) >= REMINDER_MS)) kind = 'reminder';
    const checkId = crypto.randomUUID();
    const eventId = kind ? crypto.randomUUID() : state.last_event_id;
    const statements = [db.prepare(`UPDATE world_map_health_state SET revision = revision + 1,
      status = ?, incident_id = ?, last_checked_at = ?, last_check_id = ?, snapshot_json = ?, last_event_id = ?, last_alert_created_at = ?
      WHERE id = 1 AND revision = ?`).bind(observation.status, incidentId, now, checkId, JSON.stringify(observation), eventId,
        kind && kind !== 'recovery' ? now : state.last_alert_created_at, state.revision)];
    if (kind) statements.push(db.prepare(`INSERT OR IGNORE INTO world_map_health_alerts
      (id, kind, incident_id, message_json, created_at)
      SELECT ?, ?, ?, ?, ? FROM world_map_health_state WHERE id = 1 AND last_event_id = ?`).bind(eventId, kind,
        incidentId, JSON.stringify(buildMessage(env, kind, observation, now)), now, eventId));
    await db.batch(statements);
    const updated = await db.prepare('SELECT last_check_id FROM world_map_health_state WHERE id = 1')
      .first<{ last_check_id: string }>();
    if (updated?.last_check_id === checkId) return;
  }
  throw new Error('Concurrent world map checks changed the health state; retry on the next check.');
}

async function sendPendingAlerts(db: D1DatabaseSession, env: Env, now: string, fetcher: Fetcher): Promise<number> {
  let sent = 0;
  for (let index = 0; index < 5; index += 1) {
    const token = crypto.randomUUID();
    const leaseUntil = new Date(Date.parse(now) + 120_000).toISOString();
    const alert = await db.prepare(`UPDATE world_map_health_alerts SET lease_token = ?, lease_until = ?, attempts = attempts + 1
      WHERE id = (SELECT id FROM world_map_health_alerts WHERE sent_at IS NULL AND (lease_until IS NULL OR lease_until <= ?)
        ORDER BY created_at, rowid LIMIT 1) RETURNING id, message_json`).bind(token, leaseUntil, now).first<PendingAlert>();
    if (!alert) break;
    try {
      const response = await fetcher('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json',
          'Idempotency-Key': `wamp-world-map/${alert.id}` }, body: alert.message_json,
      });
      if (!response.ok) throw new Error(`Fast-map email provider returned HTTP ${response.status}.`);
      const result = await response.json() as { id?: string };
      if (!result.id) throw new Error('Fast-map email provider did not return a message id.');
      await db.batch([db.prepare(`UPDATE world_map_health_alerts SET sent_at = ?, provider_id = ?,
        lease_token = NULL, lease_until = NULL, last_error = NULL WHERE id = ? AND lease_token = ?`).bind(now, result.id, alert.id, token)]);
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Fast-map email delivery failed.';
      await db.batch([db.prepare(`UPDATE world_map_health_alerts SET lease_token = NULL, lease_until = NULL,
        last_error = ? WHERE id = ? AND lease_token = ?`).bind(message.slice(0, 300), alert.id, token)]);
      throw new Error(message);
    }
  }
  await db.batch([db.prepare('DELETE FROM world_map_health_alerts WHERE sent_at < ?')
    .bind(new Date(Date.parse(now) - 30 * 24 * 60 * 60 * 1000).toISOString())]);
  return sent;
}

export async function checkAndAlertWorldMap(env: Env, options: { testId?: string; now?: string; fetcher?: Fetcher } = {}) {
  if (env.WORLD_MAP_HEALTH_ALERTS_ENABLED !== '1') return { enabled: false, status: 'disabled', sent: 0 };
  if (!worldMapAlertsConfigured(env)) throw new Error('Fast-map alerts require a valid recipient and RESEND_API_KEY.');
  const now = options.now ?? new Date().toISOString();
  const fetcher = options.fetcher ?? fetch;
  const observation = await observeWorldMap(fetcher);
  const db = env.DB.withSession?.('first-primary') ?? env.DB;
  await recordObservation(db, env, observation, now);
  if (options.testId) {
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(options.testId)) throw new Error('A stable 8-128 character test id is required.');
    await db.batch([db.prepare(`INSERT OR IGNORE INTO world_map_health_alerts
      (id, kind, message_json, created_at) VALUES (?, 'test', ?, ?)`).bind(`test-${options.testId}`,
        JSON.stringify(buildMessage(env, 'test', observation, now)), now)]);
  }
  const sent = await sendPendingAlerts(db, env, now, fetcher);
  return { enabled: true, status: observation.status, sent };
}

export async function loadWorldMapHealthStatus(env: Env) {
  const state = await env.DB.prepare('SELECT status, last_checked_at FROM world_map_health_state WHERE id = 1').first();
  const pending = await env.DB.prepare('SELECT COUNT(*) AS count FROM world_map_health_alerts WHERE sent_at IS NULL').first<{ count: number }>();
  return { enabled: env.WORLD_MAP_HEALTH_ALERTS_ENABLED === '1', emailConfigured: worldMapAlertsConfigured(env),
    recipient: worldMapAlertRecipient(env), state, pendingAlerts: pending?.count ?? 0 };
}

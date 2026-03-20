import type {
  Env,
  PlayfunPointSyncRow,
  PlayfunUserLinkRow,
  PointEventRow,
} from '../core/types';

export const PLAYFUN_SESSION_TOKEN_HEADER = 'X-Playfun-Session-Token';

interface PlayfunValidateSessionResponse {
  valid?: boolean;
  ogpId?: string;
  playerId?: string;
  gameId?: string;
}

interface PlayfunBatchSaveResponse {
  ok?: boolean;
}

export interface PlayfunValidatedSession {
  ogpId: string;
  playerId: string | null;
  gameId: string | null;
}

export interface PlayfunPublicConfig {
  enabled: boolean;
  apiKey: string | null;
  gameId: string | null;
}

export interface PlayfunFlushSummary {
  flushed: number;
  pending: number;
  failed: number;
}

interface PlayfunPendingSyncRow {
  pointEventId: string;
  userId: string;
  ogpId: string;
  points: number;
  status: 'pending' | 'failed';
  attemptCount: number;
  createdAt: string;
}

const PLAYFUN_DEFAULT_BASE_URL = 'https://api.play.fun';

export function getPlayfunPublicConfig(env: Env): PlayfunPublicConfig {
  if (!isPlayfunConfigured(env)) {
    return {
      enabled: false,
      apiKey: null,
      gameId: null,
    };
  }

  return {
    enabled: true,
    apiKey: env.PLAYFUN_API_KEY?.trim() ?? null,
    gameId: env.PLAYFUN_GAME_ID?.trim() ?? null,
  };
}

export function getPlayfunSessionTokenFromRequest(request: Request): string | null {
  const token = request.headers.get(PLAYFUN_SESSION_TOKEN_HEADER)?.trim() ?? '';
  return token ? token : null;
}

export async function validatePlayfunSessionToken(
  env: Env,
  sessionToken: string | null
): Promise<PlayfunValidatedSession | null> {
  if (!sessionToken || !isPlayfunConfigured(env)) {
    return null;
  }

  try {
    const payload = await playfunRequest<PlayfunValidateSessionResponse>(
      env,
      'POST',
      '/play/dev/validate-session-token',
      { sessionToken }
    );

    if (!payload.valid || typeof payload.ogpId !== 'string' || !payload.ogpId.trim()) {
      return null;
    }

    const configuredGameId = env.PLAYFUN_GAME_ID?.trim() ?? '';
    if (configuredGameId && payload.gameId && payload.gameId !== configuredGameId) {
      return null;
    }

    return {
      ogpId: payload.ogpId,
      playerId: typeof payload.playerId === 'string' && payload.playerId.trim() ? payload.playerId : null,
      gameId: typeof payload.gameId === 'string' && payload.gameId.trim() ? payload.gameId : null,
    };
  } catch (error) {
    console.warn('Failed to validate Play.fun session token', error);
    return null;
  }
}

export async function enqueuePlayfunPointSync(
  env: Env,
  pointEvent: Pick<PointEventRow, 'id' | 'user_id' | 'points' | 'created_at'>,
  ogpId: string
): Promise<void> {
  if (!isPlayfunConfigured(env)) {
    return;
  }

  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO playfun_point_sync (
          point_event_id,
          user_id,
          ogp_id,
          points,
          status,
          attempt_count,
          created_at,
          last_attempted_at,
          synced_at,
          last_error
        )
        VALUES (?, ?, ?, ?, 'pending', 0, ?, NULL, NULL, NULL)
        ON CONFLICT(point_event_id) DO NOTHING
      `
    ).bind(
      pointEvent.id,
      pointEvent.user_id,
      ogpId,
      Math.max(0, Math.round(pointEvent.points)),
      pointEvent.created_at
    ),
  ]);
}

export async function upsertPlayfunUserLink(
  env: Env,
  userId: string,
  session: PlayfunValidatedSession
): Promise<void> {
  if (!isPlayfunConfigured(env)) {
    return;
  }

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO playfun_user_links (
          user_id,
          ogp_id,
          player_id,
          game_id,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          ogp_id = excluded.ogp_id,
          player_id = excluded.player_id,
          game_id = excluded.game_id,
          updated_at = excluded.updated_at
      `
    ).bind(
      userId,
      session.ogpId,
      session.playerId,
      session.gameId,
      now,
      now
    ),
  ]);
}

export async function loadPlayfunUserLink(
  env: Env,
  userId: string
): Promise<PlayfunUserLinkRow | null> {
  return env.DB.prepare(
    `
      SELECT
        user_id,
        ogp_id,
        player_id,
        game_id,
        created_at,
        updated_at
      FROM playfun_user_links
      WHERE user_id = ?
      LIMIT 1
    `
  )
    .bind(userId)
    .first<PlayfunUserLinkRow>();
}

export async function loadPlayfunUserLinkByOgpId(
  env: Env,
  ogpId: string
): Promise<PlayfunUserLinkRow | null> {
  return env.DB.prepare(
    `
      SELECT
        user_id,
        ogp_id,
        player_id,
        game_id,
        created_at,
        updated_at
      FROM playfun_user_links
      WHERE ogp_id = ?
      LIMIT 1
    `
  )
    .bind(ogpId)
    .first<PlayfunUserLinkRow>();
}

export async function maybeLinkPlayfunUser(
  env: Env,
  userId: string,
  session: PlayfunValidatedSession
): Promise<PlayfunUserLinkRow | null> {
  if (!isPlayfunConfigured(env)) {
    return null;
  }

  const existingByUser = await loadPlayfunUserLink(env, userId);
  if (existingByUser && existingByUser.ogp_id !== session.ogpId) {
    return existingByUser;
  }

  const existingByOgpId = await loadPlayfunUserLinkByOgpId(env, session.ogpId);
  if (existingByOgpId && existingByOgpId.user_id !== userId) {
    return existingByOgpId;
  }

  await upsertPlayfunUserLink(env, userId, session);
  return loadPlayfunUserLink(env, userId);
}

export async function linkPlayfunUserFromRequest(
  env: Env,
  request: Request,
  userId: string
): Promise<PlayfunValidatedSession | null> {
  const sessionToken = getPlayfunSessionTokenFromRequest(request);
  const playfunSession = await validatePlayfunSessionToken(env, sessionToken);
  if (!playfunSession) {
    return null;
  }

  const link = await maybeLinkPlayfunUser(env, userId, playfunSession);
  return link?.user_id === userId ? playfunSession : null;
}

export async function flushPlayfunPointSync(
  env: Env,
  userId: string
): Promise<PlayfunFlushSummary> {
  if (!isPlayfunConfigured(env)) {
    return {
      flushed: 0,
      pending: 0,
      failed: 0,
    };
  }

  const linkedUser = await loadPlayfunUserLink(env, userId);
  if (linkedUser?.ogp_id) {
    await enqueueMissingPlayfunPointSyncForUser(env, userId, linkedUser.ogp_id);
  }

  const pendingRows = await env.DB.prepare(
    `
      SELECT
        point_event_id,
        user_id,
        ogp_id,
        points,
        status,
        attempt_count,
        created_at
      FROM playfun_point_sync
      WHERE user_id = ?
        AND status IN ('pending', 'failed')
      ORDER BY created_at ASC
      LIMIT 100
    `
  )
    .bind(userId)
    .all<PlayfunPointSyncRow>();

  const rows = pendingRows.results.map(mapPendingSyncRow);
  let flushed = 0;

  const groupedByOgpId = new Map<string, PlayfunPendingSyncRow[]>();
  for (const row of rows) {
    const existing = groupedByOgpId.get(row.ogpId) ?? [];
    existing.push(row);
    groupedByOgpId.set(row.ogpId, existing);
  }

  for (const [ogpId, group] of groupedByOgpId) {
    const now = new Date().toISOString();
    const totalPoints = group.reduce((sum, row) => sum + Math.max(0, row.points), 0);
    const pointEventIds = group.map((row) => row.pointEventId);

    try {
      await playfunRequest<PlayfunBatchSaveResponse>(env, 'POST', '/play/dev/batch-save-points', {
        gameApiKey: env.PLAYFUN_API_KEY?.trim(),
        points: [{ playerId: ogpId, points: String(totalPoints) }],
      });

      flushed += group.length;
      await updatePlayfunPointSyncRows(env, pointEventIds, {
        status: 'sent',
        attemptedAt: now,
        syncedAt: now,
        lastError: null,
      });
    } catch (error) {
      const message = getErrorMessage(error, 'Play.fun point sync failed.');
      console.warn('Failed to flush Play.fun point sync batch', { ogpId, message });
      await updatePlayfunPointSyncRows(env, pointEventIds, {
        status: 'failed',
        attemptedAt: now,
        syncedAt: null,
        lastError: message,
      });
    }
  }

  const counts = await loadPlayfunPointSyncCounts(env, userId);
  return {
    flushed,
    pending: counts.pending,
    failed: counts.failed,
  };
}

function isPlayfunConfigured(env: Env): boolean {
  return (
    env.PLAYFUN_ENABLED === '1' &&
    Boolean(env.PLAYFUN_API_KEY?.trim()) &&
    Boolean(env.PLAYFUN_SECRET_KEY?.trim()) &&
    Boolean(env.PLAYFUN_GAME_ID?.trim())
  );
}

async function enqueueMissingPlayfunPointSyncForUser(
  env: Env,
  userId: string,
  ogpId: string
): Promise<void> {
  const result = await env.DB.prepare(
    `
      SELECT
        e.id,
        e.user_id,
        e.points,
        e.created_at
      FROM point_events e
      LEFT JOIN playfun_point_sync s
        ON s.point_event_id = e.id
      WHERE e.user_id = ?
        AND e.points > 0
        AND s.point_event_id IS NULL
      ORDER BY e.created_at ASC
      LIMIT 200
    `
  )
    .bind(userId)
    .all<Pick<PointEventRow, 'id' | 'user_id' | 'points' | 'created_at'>>();

  for (const row of result.results) {
    await enqueuePlayfunPointSync(env, row, ogpId);
  }
}

async function playfunRequest<T>(
  env: Env,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown
): Promise<T> {
  const apiKey = env.PLAYFUN_API_KEY?.trim();
  const secretKey = env.PLAYFUN_SECRET_KEY?.trim();
  const baseUrl = (env.PLAYFUN_BASE_URL?.trim() || PLAYFUN_DEFAULT_BASE_URL).replace(/\/+$/, '');

  if (!apiKey || !secretKey) {
    throw new Error('Play.fun credentials are not configured.');
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await signPlayfunRequest(secretKey, method, path, timestamp);
  const headers = new Headers({
    Authorization: `HMAC-SHA256 apiKey=${apiKey}, signature=${signature}, timestamp=${timestamp}`,
    'Content-Type': 'application/json',
    'x-auth-provider': 'hmac',
  });

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const rawText = await response.text();
  const parsed = rawText ? parseJsonSafely(rawText) : null;

  if (!response.ok) {
    const parsedMessage = extractPlayfunError(parsed);
    const rawMessage = rawText.trim();
    const message = (parsedMessage ?? rawMessage) || `Play.fun request failed with status ${response.status}.`;
    throw new Error(message);
  }

  return extractPlayfunPayload<T>(parsed);
}

async function signPlayfunRequest(
  secretKey: string,
  method: string,
  path: string,
  timestamp: number
): Promise<string> {
  const payload = `${method.toLowerCase()}\n${path.toLowerCase()}\n${timestamp}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secretKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return [...new Uint8Array(signature)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function updatePlayfunPointSyncRows(
  env: Env,
  pointEventIds: string[],
  input: {
    status: 'sent' | 'failed';
    attemptedAt: string;
    syncedAt: string | null;
    lastError: string | null;
  }
): Promise<void> {
  if (pointEventIds.length === 0) {
    return;
  }

  // D1 limits bound parameters to ~100 per statement; 4 are fixed, so chunk IDs
  const CHUNK_SIZE = 90;
  for (let i = 0; i < pointEventIds.length; i += CHUNK_SIZE) {
    const chunk = pointEventIds.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(', ');
    await env.DB.batch([
      env.DB.prepare(
        `
          UPDATE playfun_point_sync
          SET
            status = ?,
            attempt_count = attempt_count + 1,
            last_attempted_at = ?,
            synced_at = ?,
            last_error = ?
          WHERE point_event_id IN (${placeholders})
        `
      ).bind(input.status, input.attemptedAt, input.syncedAt, input.lastError, ...chunk),
    ]);
  }
}

async function loadPlayfunPointSyncCounts(
  env: Env,
  userId: string
): Promise<{ pending: number; failed: number }> {
  const rows = await env.DB.prepare(
    `
      SELECT status, COUNT(*) AS row_count
      FROM playfun_point_sync
      WHERE user_id = ?
        AND status IN ('pending', 'failed')
      GROUP BY status
    `
  )
    .bind(userId)
    .all<{ status: string; row_count: number | string | null }>();

  let pending = 0;
  let failed = 0;

  for (const row of rows.results) {
    const count = Number(row.row_count ?? 0);
    if (row.status === 'pending') {
      pending = count;
    } else if (row.status === 'failed') {
      failed = count;
    }
  }

  return { pending, failed };
}

function mapPendingSyncRow(row: PlayfunPointSyncRow): PlayfunPendingSyncRow {
  return {
    pointEventId: row.point_event_id,
    userId: row.user_id,
    ogpId: row.ogp_id,
    points: Math.max(0, Number(row.points ?? 0)),
    status: row.status === 'failed' ? 'failed' : 'pending',
    attemptCount: Math.max(0, Number(row.attempt_count ?? 0)),
    createdAt: row.created_at,
  };
}

function parseJsonSafely(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function extractPlayfunPayload<T>(payload: unknown): T {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as { data: T }).data;
  }

  return payload as T;
}

function extractPlayfunError(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const direct = (payload as { error?: unknown }).error;
  if (typeof direct === 'string' && direct.trim()) {
    return direct;
  }

  const nested = (payload as { data?: { error?: unknown; message?: unknown }; message?: unknown }).data;
  if (nested) {
    if (typeof nested.error === 'string' && nested.error.trim()) {
      return nested.error;
    }
    if (typeof nested.message === 'string' && nested.message.trim()) {
      return nested.message;
    }
  }

  const message = (payload as { message?: unknown }).message;
  return typeof message === 'string' && message.trim() ? message : null;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

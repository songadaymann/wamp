import { Resend } from 'resend';
import { verifyMessage } from 'viem';
import {
  type AuthSessionResponse,
  type AuthUser,
  type MagicLinkRequestBody,
  type MagicLinkRequestResponse,
  type WalletChallengeRequestBody,
  type WalletChallengeResponse,
  type WalletVerifyRequestBody,
  type WalletVerifyResponse,
} from '../auth/model';
import {
  cloneRoomSnapshot,
  createRoomVersionRecord,
  createDefaultRoomRecord,
  isRoomMinted,
  parseRoomId,
  roomIdFromCoordinates,
  type RoomCoordinates,
  type RoomRecord,
  type RoomRevertRequestBody,
  type RoomSnapshot,
  type RoomVersionRecord,
} from '../persistence/roomModel';
import { computeWorldWindow } from '../persistence/worldModel';

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<T[]>;
}

interface AssetsBinding {
  fetch(request: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface Env {
  ASSETS: AssetsBinding;
  DB: D1Database;
  RESEND_API_KEY?: string;
  AUTH_EMAIL_FROM?: string;
  AUTH_DEBUG_MAGIC_LINKS?: string;
  APP_BASE_URL?: string;
  ENABLE_TEST_RESET?: string;
}

interface RoomRow {
  id: string;
  x: number;
  y: number;
  draft_json: string;
  published_json: string | null;
  claimer_user_id: string | null;
  claimer_display_name: string | null;
  claimed_at: string | null;
  last_published_by_user_id: string | null;
  last_published_by_display_name: string | null;
  minted_chain_id: number | null;
  minted_contract_address: string | null;
  minted_token_id: string | null;
}

interface RoomVersionRow {
  version: number;
  snapshot_json: string;
  created_at: string;
  published_by_user_id: string | null;
  published_by_display_name: string | null;
  reverted_from_version: number | null;
}

interface UserRow {
  id: string;
  email: string | null;
  wallet_address: string | null;
  display_name: string;
  created_at: string;
  updated_at: string;
}

interface SessionJoinRow {
  id: string;
  user_id: string;
  expires_at: string;
  created_at: string;
  last_seen_at: string;
  email: string | null;
  wallet_address: string | null;
  display_name: string;
  user_created_at: string;
}

interface MagicLinkJoinRow {
  id: string;
  user_id: string;
  email: string;
  token_hash: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
  wallet_address: string | null;
  display_name: string;
  user_created_at: string;
}

interface WalletChallengeRow {
  id: string;
  address: string;
  nonce_hash: string;
  message_text: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

interface AuthSession {
  sessionId: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
  lastSeenAt: string;
  user: AuthUser;
}

const SESSION_COOKIE_NAME = 'ep_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const MAGIC_LINK_TTL_MS = 1000 * 60 * 15;
const WALLET_CHALLENGE_TTL_MS = 1000 * 60 * 10;
const DEFAULT_AUTH_EMAIL_FROM = "Everybody's Platformer <onboarding@resend.dev>";

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request),
      });
    }

    try {
      if (url.pathname === '/api/health' && request.method === 'GET') {
        return jsonResponse(
          request,
          {
            ok: true,
            storage: 'd1',
            auth: {
              emailConfigured: Boolean(env.RESEND_API_KEY),
              debugMagicLinks: env.AUTH_DEBUG_MAGIC_LINKS === '1',
              testResetEnabled: env.ENABLE_TEST_RESET === '1',
            },
          }
        );
      }

      if (url.pathname.startsWith('/api/auth')) {
        return handleAuthRequest(request, url, env);
      }

      if (url.pathname === '/api/test/reset' && request.method === 'POST') {
        return handleTestReset(request, env);
      }

      if (url.pathname === '/api/world' && request.method === 'GET') {
        const centerX = parseIntegerQueryParam(url.searchParams, 'centerX');
        const centerY = parseIntegerQueryParam(url.searchParams, 'centerY');
        const radius = parseIntegerQueryParam(url.searchParams, 'radius');

        if (radius < 0 || radius > 32) {
          throw new HttpError(400, 'Radius must be between 0 and 32.');
        }

        const publishedRooms = await loadPublishedRoomsInBounds(
          env,
          centerX - radius - 1,
          centerX + radius + 1,
          centerY - radius - 1,
          centerY + radius + 1
        );

        return jsonResponse(
          request,
          computeWorldWindow(publishedRooms, { x: centerX, y: centerY }, radius)
        );
      }

      if (!url.pathname.startsWith('/api/rooms/')) {
        throw new HttpError(404, 'Route not found.');
      }

      const segments = url.pathname.split('/').filter(Boolean);
      const roomId = decodeURIComponent(segments[2] ?? '');

      if (!roomId) {
        throw new HttpError(400, 'Room id is required.');
      }

      if (segments.length === 3 && request.method === 'GET') {
        const coordinates = getCoordinatesFromRequest(roomId, url.searchParams);
        const session = await loadCurrentSession(env, request);
        const record = await loadRoomRecord(env, roomId, coordinates, session?.user.id ?? null);
        return jsonResponse(request, record);
      }

      if (segments.length === 4 && segments[3] === 'published' && request.method === 'GET') {
        const coordinates = getCoordinatesFromRequest(roomId, url.searchParams);
        const publishedRoom = await loadPublishedRoom(env, roomId, coordinates);

        if (!publishedRoom) {
          throw new HttpError(404, 'Published room not found.');
        }

        return jsonResponse(request, publishedRoom);
      }

      if (segments.length === 4 && segments[3] === 'draft' && request.method === 'PUT') {
        const snapshot = await parseRoomSnapshot(request, roomId);
        const session = await loadCurrentSession(env, request);
        const record = await saveDraft(env, snapshot, session?.user.id ?? null);
        return jsonResponse(request, record);
      }

      if (segments.length === 4 && segments[3] === 'publish' && request.method === 'POST') {
        const snapshot = await parseRoomSnapshot(request, roomId);
        const session = await loadCurrentSession(env, request);
        const record = await publishRoom(env, snapshot, session?.user ?? null);
        return jsonResponse(request, record);
      }

      if (segments.length === 4 && segments[3] === 'revert' && request.method === 'POST') {
        const coordinates = getCoordinatesFromRequest(roomId, url.searchParams);
        const body = await parseJsonBody<RoomRevertRequestBody>(request);
        const session = await loadCurrentSession(env, request);
        const record = await revertRoom(
          env,
          roomId,
          coordinates,
          body.targetVersion,
          session?.user ?? null
        );
        return jsonResponse(request, record);
      }

      if (segments.length === 4 && segments[3] === 'versions' && request.method === 'GET') {
        const coordinates = getCoordinatesFromRequest(roomId, url.searchParams);
        const session = await loadCurrentSession(env, request);
        const record = await loadRoomRecord(env, roomId, coordinates, session?.user.id ?? null);
        return jsonResponse(request, record.versions);
      }

      throw new HttpError(405, 'Method not allowed.');
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof Error ? error.message : 'Unexpected server error.';

      if (status >= 500) {
        console.error('API failure', error);
      }

      return jsonResponse(
        request,
        {
          error: message,
        },
        { status }
      );
    }
  },
};

async function handleAuthRequest(request: Request, url: URL, env: Env): Promise<Response> {
  if (url.pathname === '/api/auth/session' && request.method === 'GET') {
    const session = await loadCurrentSession(env, request);
    return jsonResponse(request, createSessionResponse(session));
  }

  if (url.pathname === '/api/auth/request-link' && request.method === 'POST') {
    return handleRequestMagicLink(request, env);
  }

  if (url.pathname === '/api/auth/verify' && request.method === 'GET') {
    return handleVerifyMagicLink(request, url, env);
  }

  if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
    return handleLogout(request, env);
  }

  if (url.pathname === '/api/auth/wallet/challenge' && request.method === 'POST') {
    return handleWalletChallenge(request, env);
  }

  if (url.pathname === '/api/auth/wallet/verify' && request.method === 'POST') {
    return handleWalletVerify(request, env);
  }

  throw new HttpError(404, 'Auth route not found.');
}

async function handleRequestMagicLink(request: Request, env: Env): Promise<Response> {
  const body = await parseJsonBody<MagicLinkRequestBody>(request);
  const email = normalizeEmail(body.email);

  if (!isValidEmail(email)) {
    throw new HttpError(400, 'Please enter a valid email address.');
  }

  const user = (await findUserByEmail(env, email)) ?? (await createUserForEmail(env, email));
  const token = generateOpaqueToken(32);
  const tokenHash = await hashToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + MAGIC_LINK_TTL_MS).toISOString();

  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO magic_link_tokens (id, user_id, email, token_hash, expires_at, consumed_at, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, ?)
      `
    ).bind(
      crypto.randomUUID(),
      user.id,
      email,
      tokenHash,
      expiresAt,
      now.toISOString()
    ),
  ]);

  const magicLink = `${resolvePublicBaseUrl(request, env)}/api/auth/verify?token=${encodeURIComponent(token)}`;
  const responseBody: MagicLinkRequestResponse = {
    ok: true,
    delivery: env.RESEND_API_KEY ? 'email' : 'debug',
  };

  if (env.RESEND_API_KEY) {
    await sendMagicLinkEmail(env, email, magicLink);
  } else if (env.AUTH_DEBUG_MAGIC_LINKS === '1') {
    responseBody.debugMagicLink = magicLink;
  } else {
    throw new HttpError(
      500,
      'Email auth is not configured. Set RESEND_API_KEY or enable AUTH_DEBUG_MAGIC_LINKS.'
    );
  }

  return jsonResponse(request, responseBody);
}

async function handleVerifyMagicLink(request: Request, url: URL, env: Env): Promise<Response> {
  const token = url.searchParams.get('token');
  if (!token) {
    return redirectResponse('/?auth=invalid');
  }

  const tokenHash = await hashToken(token);
  const row = await env.DB.prepare(
    `
      SELECT
        m.id,
        m.user_id,
        m.email,
        m.token_hash,
        m.expires_at,
        m.consumed_at,
        m.created_at,
        u.wallet_address,
        u.display_name,
        u.created_at AS user_created_at
      FROM magic_link_tokens m
      JOIN users u ON u.id = m.user_id
      WHERE m.token_hash = ?
      LIMIT 1
    `
  )
    .bind(tokenHash)
    .first<MagicLinkJoinRow>();

  if (!row || row.consumed_at || isExpired(row.expires_at)) {
    return redirectResponse('/?auth=invalid');
  }

  const user: AuthUser = {
    id: row.user_id,
    email: row.email,
    walletAddress: row.wallet_address,
    displayName: row.display_name,
    createdAt: row.user_created_at,
  };

  const sessionToken = await createSession(env, user.id);
  const now = new Date().toISOString();

  await env.DB.batch([
    env.DB.prepare(
      `
        UPDATE magic_link_tokens
        SET consumed_at = ?
        WHERE id = ?
      `
    ).bind(now, row.id),
  ]);

  return redirectResponse('/?auth=email', {
    'Set-Cookie': createSessionCookie(request, sessionToken),
  });
}

async function handleLogout(request: Request, env: Env): Promise<Response> {
  const existing = await loadCurrentSession(env, request);
  if (existing) {
    await deleteSessionById(env, existing.sessionId);
  }

  return jsonResponse(
    request,
    { ok: true },
    {
      headers: {
        'Set-Cookie': clearSessionCookie(request),
      },
    }
  );
}

async function handleWalletChallenge(request: Request, env: Env): Promise<Response> {
  const body = await parseJsonBody<WalletChallengeRequestBody>(request);
  const address = normalizeAddress(body.address);

  if (!isValidAddress(address)) {
    throw new HttpError(400, 'Wallet address must be a valid EVM address.');
  }

  const nonce = generateOpaqueToken(24);
  const nonceHash = await hashToken(nonce);
  const now = new Date();
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + WALLET_CHALLENGE_TTL_MS).toISOString();
  const message = createWalletChallengeMessage(request, env, address, nonce, issuedAt);

  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO wallet_challenges (id, address, nonce_hash, message_text, expires_at, consumed_at, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, ?)
      `
    ).bind(
      crypto.randomUUID(),
      address,
      nonceHash,
      message,
      expiresAt,
      issuedAt
    ),
  ]);

  const responseBody: WalletChallengeResponse = {
    address,
    message,
    expiresAt,
  };

  return jsonResponse(request, responseBody);
}

async function handleWalletVerify(request: Request, env: Env): Promise<Response> {
  const body = await parseJsonBody<WalletVerifyRequestBody>(request);
  const address = normalizeAddress(body.address);

  if (!isValidAddress(address)) {
    throw new HttpError(400, 'Wallet address must be a valid EVM address.');
  }

  const nonce = extractNonceFromWalletMessage(body.message);
  if (!nonce) {
    throw new HttpError(400, 'Wallet challenge message is invalid.');
  }

  const nonceHash = await hashToken(nonce);
  const challenge = await env.DB.prepare(
    `
      SELECT id, address, nonce_hash, message_text, expires_at, consumed_at, created_at
      FROM wallet_challenges
      WHERE nonce_hash = ?
      LIMIT 1
    `
  )
    .bind(nonceHash)
    .first<WalletChallengeRow>();

  if (!challenge || challenge.consumed_at || isExpired(challenge.expires_at)) {
    throw new HttpError(401, 'Wallet challenge has expired. Please try again.');
  }

  if (challenge.address !== address || challenge.message_text !== body.message) {
    throw new HttpError(401, 'Wallet challenge did not match the requested address.');
  }

  const verified = await verifyMessage({
    address: address as `0x${string}`,
    message: body.message,
    signature: body.signature as `0x${string}`,
  });

  if (!verified) {
    throw new HttpError(401, 'Wallet signature could not be verified.');
  }

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `
        UPDATE wallet_challenges
        SET consumed_at = ?
        WHERE id = ?
      `
    ).bind(now, challenge.id),
  ]);

  const existingSession = await loadCurrentSession(env, request);
  let user: AuthUser;
  let setCookie: string | null = null;
  let linkedWallet = false;

  if (existingSession) {
    user = await attachWalletToUser(env, existingSession.user, address);
    linkedWallet = true;
  } else {
    const existingWalletUser = await findUserByWallet(env, address);
    user = existingWalletUser ?? (await createUserForWallet(env, address));
    setCookie = createSessionCookie(request, await createSession(env, user.id));
  }

  const responseBody: WalletVerifyResponse = {
    authenticated: true,
    linkedWallet,
    user,
  };

  return jsonResponse(
    request,
    responseBody,
    setCookie
      ? {
          headers: {
            'Set-Cookie': setCookie,
          },
        }
      : undefined
  );
}

async function handleTestReset(request: Request, env: Env): Promise<Response> {
  if (env.ENABLE_TEST_RESET !== '1') {
    throw new HttpError(403, 'Test reset is disabled for this Worker.');
  }

  const counts = {
    rooms: await countRows(env, 'rooms'),
    roomVersions: await countRows(env, 'room_versions'),
    users: await countRows(env, 'users'),
    sessions: await countRows(env, 'sessions'),
    magicLinks: await countRows(env, 'magic_link_tokens'),
    walletChallenges: await countRows(env, 'wallet_challenges'),
  };

  await env.DB.batch([
    env.DB.prepare('DELETE FROM magic_link_tokens'),
    env.DB.prepare('DELETE FROM sessions'),
    env.DB.prepare('DELETE FROM wallet_challenges'),
    env.DB.prepare('DELETE FROM room_versions'),
    env.DB.prepare('DELETE FROM rooms'),
    env.DB.prepare('DELETE FROM users'),
  ]);

  return jsonResponse(
    request,
    {
      ok: true,
      deleted: counts,
    },
    {
      headers: {
        'Set-Cookie': clearSessionCookie(request),
      },
    }
  );
}

function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get('Origin');
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS',
  };

  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
    headers.Vary = 'Origin';
  } else {
    headers['Access-Control-Allow-Origin'] = '*';
  }

  return headers;
}

function jsonResponse(request: Request, body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');

  for (const [key, value] of Object.entries(corsHeaders(request))) {
    headers.set(key, value);
  }

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

function redirectResponse(location: string, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Location', location);

  return new Response(null, {
    status: 302,
    headers: responseHeaders,
  });
}

async function parseJsonBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
}

function getCoordinatesFromRequest(roomId: string, searchParams: URLSearchParams): RoomCoordinates {
  const parsedFromId = parseRoomId(roomId);
  const xParam = searchParams.get('x');
  const yParam = searchParams.get('y');

  if (xParam === null || yParam === null) {
    if (parsedFromId) {
      return parsedFromId;
    }

    throw new HttpError(400, 'Room coordinates are required.');
  }

  const x = Number(xParam);
  const y = Number(yParam);

  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    throw new HttpError(400, 'Room coordinates must be integers.');
  }

  const coordinates = { x, y };
  const canonicalRoomId = roomIdFromCoordinates(coordinates);
  if (roomId !== canonicalRoomId) {
    throw new HttpError(400, 'Room id must match coordinates.');
  }

  return coordinates;
}

function parseIntegerQueryParam(searchParams: URLSearchParams, key: string): number {
  const value = searchParams.get(key);
  const parsed = Number(value);

  if (value === null || !Number.isInteger(parsed)) {
    throw new HttpError(400, `${key} must be an integer.`);
  }

  return parsed;
}

async function parseRoomSnapshot(request: Request, roomId: string): Promise<RoomSnapshot> {
  const body = await parseJsonBody<RoomSnapshot>(request);

  if (!isRoomSnapshot(body)) {
    throw new HttpError(400, 'Request body must be a room snapshot.');
  }

  const canonicalRoomId = roomIdFromCoordinates(body.coordinates);
  if (roomId !== canonicalRoomId || body.id !== canonicalRoomId) {
    throw new HttpError(400, 'Room id must match snapshot coordinates.');
  }

  return cloneRoomSnapshot(body);
}

function isRoomSnapshot(value: unknown): value is RoomSnapshot {
  if (!value || typeof value !== 'object') return false;

  const snapshot = value as Partial<RoomSnapshot>;
  return Boolean(
    typeof snapshot.id === 'string' &&
      typeof snapshot.background === 'string' &&
      typeof snapshot.version === 'number' &&
      snapshot.coordinates &&
      typeof snapshot.coordinates.x === 'number' &&
      typeof snapshot.coordinates.y === 'number' &&
      snapshot.tileData &&
      snapshot.placedObjects
  );
}

async function loadRoomRecord(
  env: Env,
  roomId: string,
  coordinates: RoomCoordinates,
  viewerUserId: string | null = null
): Promise<RoomRecord> {
  const row = await env.DB.prepare(
    `
      SELECT
        id,
        x,
        y,
        draft_json,
        published_json,
        claimer_user_id,
        claimer_display_name,
        claimed_at,
        last_published_by_user_id,
        last_published_by_display_name,
        minted_chain_id,
        minted_contract_address,
        minted_token_id
      FROM rooms
      WHERE id = ? OR (x = ? AND y = ?)
      LIMIT 1
    `
  )
    .bind(roomId, coordinates.x, coordinates.y)
    .first<RoomRow>();

  if (!row) {
    const emptyRecord = createDefaultRoomRecord(roomId, coordinates);
    return {
      ...emptyRecord,
      permissions: buildRoomPermissions(emptyRecord, viewerUserId),
    };
  }

  const draft = parseStoredSnapshot(row.draft_json, 'draft room');
  const published = row.published_json
    ? parseStoredSnapshot(row.published_json, 'published room')
    : null;
  const versions = await loadRoomVersions(env, row.id);

  const record: RoomRecord = {
    draft,
    published,
    versions,
    claimerUserId: row.claimer_user_id,
    claimerDisplayName: row.claimer_display_name,
    claimedAt: row.claimed_at,
    lastPublishedByUserId: row.last_published_by_user_id,
    lastPublishedByDisplayName: row.last_published_by_display_name,
    mintedChainId: row.minted_chain_id,
    mintedContractAddress: row.minted_contract_address,
    mintedTokenId: row.minted_token_id,
    permissions: {
      canPublish: true,
      canRevert: false,
    },
  };

  return {
    ...record,
    permissions: buildRoomPermissions(record, viewerUserId),
  };
}

async function loadPublishedRoom(
  env: Env,
  roomId: string,
  coordinates: RoomCoordinates
): Promise<RoomSnapshot | null> {
  const row = await env.DB.prepare(
    `
      SELECT published_json
      FROM rooms
      WHERE id = ? OR (x = ? AND y = ?)
      LIMIT 1
    `
  )
    .bind(roomId, coordinates.x, coordinates.y)
    .first<{ published_json: string | null }>();

  if (!row?.published_json) {
    return null;
  }

  return parseStoredSnapshot(row.published_json, 'published room');
}

async function loadPublishedRoomsInBounds(
  env: Env,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number
): Promise<RoomSnapshot[]> {
  const result = await env.DB.prepare(
    `
      SELECT published_json
      FROM rooms
      WHERE published_json IS NOT NULL
        AND x BETWEEN ? AND ?
        AND y BETWEEN ? AND ?
    `
  )
    .bind(minX, maxX, minY, maxY)
    .all<{ published_json: string }>();

  return result.results.map((row) =>
    parseStoredSnapshot(row.published_json, 'published room')
  );
}

async function countRows(env: Env, tableName: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).first<{
    count: number | string | null;
  }>();

  return Number(row?.count ?? 0);
}

async function loadRoomVersions(env: Env, roomId: string): Promise<RoomVersionRecord[]> {
  const result = await env.DB.prepare(
    `
      SELECT
        version,
        snapshot_json,
        created_at,
        published_by_user_id,
        published_by_display_name,
        reverted_from_version
      FROM room_versions
      WHERE room_id = ?
      ORDER BY version ASC
    `
  )
    .bind(roomId)
    .all<RoomVersionRow>();

  return result.results.map((row) => {
    const snapshot = parseStoredSnapshot(row.snapshot_json, 'room version');
    return createRoomVersionRecord(snapshot, {
      version: row.version,
      createdAt: row.created_at,
      publishedByUserId: row.published_by_user_id,
      publishedByDisplayName: row.published_by_display_name,
      revertedFromVersion: row.reverted_from_version,
    });
  });
}

async function saveDraft(
  env: Env,
  incomingRoom: RoomSnapshot,
  viewerUserId: string | null = null
): Promise<RoomRecord> {
  const existing = await loadRoomRecord(
    env,
    incomingRoom.id,
    incomingRoom.coordinates,
    viewerUserId
  );
  const now = new Date().toISOString();

  const draft: RoomSnapshot = {
    ...cloneRoomSnapshot(incomingRoom),
    createdAt: existing.draft.createdAt,
    updatedAt: now,
    publishedAt: existing.published?.publishedAt ?? null,
    status: 'draft',
    version: existing.draft.version || 1,
  };

  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO rooms (
          id,
          x,
          y,
          draft_json,
          published_json,
          claimer_user_id,
          claimer_display_name,
          claimed_at,
          last_published_by_user_id,
          last_published_by_display_name,
          minted_chain_id,
          minted_contract_address,
          minted_token_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          x = excluded.x,
          y = excluded.y,
          draft_json = excluded.draft_json,
          published_json = excluded.published_json,
          claimer_user_id = excluded.claimer_user_id,
          claimer_display_name = excluded.claimer_display_name,
          claimed_at = excluded.claimed_at,
          last_published_by_user_id = excluded.last_published_by_user_id,
          last_published_by_display_name = excluded.last_published_by_display_name,
          minted_chain_id = excluded.minted_chain_id,
          minted_contract_address = excluded.minted_contract_address,
          minted_token_id = excluded.minted_token_id
      `
    ).bind(
      draft.id,
      draft.coordinates.x,
      draft.coordinates.y,
      JSON.stringify(draft),
      existing.published ? JSON.stringify(existing.published) : null,
      existing.claimerUserId,
      existing.claimerDisplayName,
      existing.claimedAt,
      existing.lastPublishedByUserId,
      existing.lastPublishedByDisplayName,
      existing.mintedChainId,
      existing.mintedContractAddress,
      existing.mintedTokenId
    ),
  ]);

  return loadRoomRecord(env, draft.id, draft.coordinates, viewerUserId);
}

async function publishRoom(
  env: Env,
  incomingRoom: RoomSnapshot,
  actor: AuthUser | null
): Promise<RoomRecord> {
  const viewerUserId = actor?.id ?? null;
  const existing = await loadRoomRecord(
    env,
    incomingRoom.id,
    incomingRoom.coordinates,
    viewerUserId
  );
  if (!existing.permissions.canPublish) {
    throw new HttpError(403, 'Minted rooms cannot be published here yet.');
  }

  const now = new Date().toISOString();
  const lastPublished = existing.versions[existing.versions.length - 1];
  const lastPublishedVersion = lastPublished ? lastPublished.version : 0;
  const nextVersion =
    lastPublishedVersion > 0 ? lastPublishedVersion + 1 : Math.max(1, incomingRoom.version);
  const publishedByUserId = actor?.id ?? null;
  const publishedByDisplayName = actor?.displayName ?? 'Guest';
  const shouldClaim = !existing.claimerUserId && actor !== null;
  const claimerUserId = shouldClaim ? actor.id : existing.claimerUserId;
  const claimerDisplayName = shouldClaim ? actor.displayName : existing.claimerDisplayName;
  const claimedAt = shouldClaim ? now : existing.claimedAt;

  const published: RoomSnapshot = {
    ...cloneRoomSnapshot(incomingRoom),
    createdAt: existing.draft.createdAt,
    updatedAt: now,
    publishedAt: now,
    status: 'published',
    version: nextVersion,
  };

  const draft: RoomSnapshot = {
    ...cloneRoomSnapshot(published),
    status: 'draft',
  };

  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO rooms (
          id,
          x,
          y,
          draft_json,
          published_json,
          claimer_user_id,
          claimer_display_name,
          claimed_at,
          last_published_by_user_id,
          last_published_by_display_name,
          minted_chain_id,
          minted_contract_address,
          minted_token_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          x = excluded.x,
          y = excluded.y,
          draft_json = excluded.draft_json,
          published_json = excluded.published_json,
          claimer_user_id = excluded.claimer_user_id,
          claimer_display_name = excluded.claimer_display_name,
          claimed_at = excluded.claimed_at,
          last_published_by_user_id = excluded.last_published_by_user_id,
          last_published_by_display_name = excluded.last_published_by_display_name,
          minted_chain_id = excluded.minted_chain_id,
          minted_contract_address = excluded.minted_contract_address,
          minted_token_id = excluded.minted_token_id
      `
    ).bind(
      draft.id,
      draft.coordinates.x,
      draft.coordinates.y,
      JSON.stringify(draft),
      JSON.stringify(published),
      claimerUserId,
      claimerDisplayName,
      claimedAt,
      publishedByUserId,
      publishedByDisplayName,
      existing.mintedChainId,
      existing.mintedContractAddress,
      existing.mintedTokenId
    ),
    env.DB.prepare(
      `
        INSERT INTO room_versions (
          room_id,
          version,
          snapshot_json,
          created_at,
          published_by_user_id,
          published_by_display_name,
          reverted_from_version
        )
        VALUES (?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(room_id, version) DO UPDATE SET
          snapshot_json = excluded.snapshot_json,
          created_at = excluded.created_at,
          published_by_user_id = excluded.published_by_user_id,
          published_by_display_name = excluded.published_by_display_name,
          reverted_from_version = excluded.reverted_from_version
      `
    ).bind(
      published.id,
      published.version,
      JSON.stringify(published),
      published.publishedAt,
      publishedByUserId,
      publishedByDisplayName
    ),
  ]);

  return loadRoomRecord(env, draft.id, draft.coordinates, viewerUserId);
}

async function revertRoom(
  env: Env,
  roomId: string,
  coordinates: RoomCoordinates,
  targetVersion: number,
  actor: AuthUser | null
): Promise<RoomRecord> {
  if (!Number.isInteger(targetVersion) || targetVersion < 1) {
    throw new HttpError(400, 'targetVersion must be a positive integer.');
  }

  const viewerUserId = actor?.id ?? null;
  const existing = await loadRoomRecord(env, roomId, coordinates, viewerUserId);
  if (isRoomMinted(existing)) {
    throw new HttpError(403, 'Minted rooms cannot be reverted here yet.');
  }
  if (!existing.permissions.canRevert) {
    throw new HttpError(403, 'Only the claimer can revert this room.');
  }

  const target = existing.versions.find((version) => version.version === targetVersion) ?? null;
  if (!target) {
    throw new HttpError(404, `Version ${targetVersion} was not found.`);
  }

  const now = new Date().toISOString();
  const lastPublished = existing.versions[existing.versions.length - 1];
  const nextVersion = (lastPublished?.version ?? 0) + 1;
  const publishedByDisplayName = actor?.displayName ?? existing.claimerDisplayName ?? 'Guest';
  const published: RoomSnapshot = {
    ...cloneRoomSnapshot(target.snapshot),
    createdAt: existing.draft.createdAt,
    updatedAt: now,
    publishedAt: now,
    status: 'published',
    version: nextVersion,
  };

  const draft: RoomSnapshot = {
    ...cloneRoomSnapshot(published),
    status: 'draft',
  };

  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO rooms (
          id,
          x,
          y,
          draft_json,
          published_json,
          claimer_user_id,
          claimer_display_name,
          claimed_at,
          last_published_by_user_id,
          last_published_by_display_name,
          minted_chain_id,
          minted_contract_address,
          minted_token_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          x = excluded.x,
          y = excluded.y,
          draft_json = excluded.draft_json,
          published_json = excluded.published_json,
          claimer_user_id = excluded.claimer_user_id,
          claimer_display_name = excluded.claimer_display_name,
          claimed_at = excluded.claimed_at,
          last_published_by_user_id = excluded.last_published_by_user_id,
          last_published_by_display_name = excluded.last_published_by_display_name,
          minted_chain_id = excluded.minted_chain_id,
          minted_contract_address = excluded.minted_contract_address,
          minted_token_id = excluded.minted_token_id
      `
    ).bind(
      draft.id,
      draft.coordinates.x,
      draft.coordinates.y,
      JSON.stringify(draft),
      JSON.stringify(published),
      existing.claimerUserId,
      existing.claimerDisplayName,
      existing.claimedAt,
      actor?.id ?? null,
      publishedByDisplayName,
      existing.mintedChainId,
      existing.mintedContractAddress,
      existing.mintedTokenId
    ),
    env.DB.prepare(
      `
        INSERT INTO room_versions (
          room_id,
          version,
          snapshot_json,
          created_at,
          published_by_user_id,
          published_by_display_name,
          reverted_from_version
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
    ).bind(
      published.id,
      published.version,
      JSON.stringify(published),
      now,
      actor?.id ?? null,
      publishedByDisplayName,
      target.version
    ),
  ]);

  return loadRoomRecord(env, draft.id, draft.coordinates, viewerUserId);
}

async function findUserByEmail(env: Env, email: string): Promise<AuthUser | null> {
  const row = await env.DB.prepare(
    `
      SELECT id, email, wallet_address, display_name, created_at, updated_at
      FROM users
      WHERE email = ?
      LIMIT 1
    `
  )
    .bind(email)
    .first<UserRow>();

  return row ? mapUserRow(row) : null;
}

async function findUserByWallet(env: Env, walletAddress: string): Promise<AuthUser | null> {
  const row = await env.DB.prepare(
    `
      SELECT id, email, wallet_address, display_name, created_at, updated_at
      FROM users
      WHERE wallet_address = ?
      LIMIT 1
    `
  )
    .bind(walletAddress)
    .first<UserRow>();

  return row ? mapUserRow(row) : null;
}

async function createUserForEmail(env: Env, email: string): Promise<AuthUser> {
  const now = new Date().toISOString();
  const user: AuthUser = {
    id: crypto.randomUUID(),
    email,
    walletAddress: null,
    displayName: createDisplayNameFromEmail(email),
    createdAt: now,
  };

  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO users (id, email, wallet_address, display_name, created_at, updated_at)
        VALUES (?, ?, NULL, ?, ?, ?)
      `
    ).bind(user.id, user.email, user.displayName, now, now),
  ]);

  return user;
}

async function createUserForWallet(env: Env, walletAddress: string): Promise<AuthUser> {
  const now = new Date().toISOString();
  const user: AuthUser = {
    id: crypto.randomUUID(),
    email: null,
    walletAddress,
    displayName: shortenAddress(walletAddress),
    createdAt: now,
  };

  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO users (id, email, wallet_address, display_name, created_at, updated_at)
        VALUES (?, NULL, ?, ?, ?, ?)
      `
    ).bind(user.id, walletAddress, user.displayName, now, now),
  ]);

  return user;
}

async function attachWalletToUser(env: Env, user: AuthUser, walletAddress: string): Promise<AuthUser> {
  const normalizedWallet = normalizeAddress(walletAddress);
  const existingWalletUser = await findUserByWallet(env, normalizedWallet);

  if (existingWalletUser && existingWalletUser.id !== user.id) {
    throw new HttpError(409, 'That wallet is already linked to another account.');
  }

  if (user.walletAddress === normalizedWallet) {
    return user;
  }

  if (user.walletAddress && user.walletAddress !== normalizedWallet) {
    throw new HttpError(409, 'This account is already linked to a different wallet.');
  }

  const updatedAt = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `
        UPDATE users
        SET wallet_address = ?, updated_at = ?
        WHERE id = ?
      `
    ).bind(normalizedWallet, updatedAt, user.id),
  ]);

  return {
    ...user,
    walletAddress: normalizedWallet,
  };
}

async function loadCurrentSession(env: Env, request: Request): Promise<AuthSession | null> {
  const token = parseCookie(request.headers.get('Cookie')).get(SESSION_COOKIE_NAME);
  if (!token) {
    return null;
  }

  const tokenHash = await hashToken(token);
  const row = await env.DB.prepare(
    `
      SELECT
        s.id,
        s.user_id,
        s.expires_at,
        s.created_at,
        s.last_seen_at,
        u.email,
        u.wallet_address,
        u.display_name,
        u.created_at AS user_created_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
      LIMIT 1
    `
  )
    .bind(tokenHash)
    .first<SessionJoinRow>();

  if (!row) {
    return null;
  }

  if (isExpired(row.expires_at)) {
    await deleteSessionById(env, row.id);
    return null;
  }

  return {
    sessionId: row.id,
    userId: row.user_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    user: {
      id: row.user_id,
      email: row.email,
      walletAddress: row.wallet_address,
      displayName: row.display_name,
      createdAt: row.user_created_at,
    },
  };
}

function createSessionResponse(session: AuthSession | null): AuthSessionResponse {
  return {
    authenticated: Boolean(session),
    user: session?.user ?? null,
  };
}

async function createSession(env: Env, userId: string): Promise<string> {
  const token = generateOpaqueToken(32);
  const tokenHash = await hashToken(token);
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();

  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `
    ).bind(
      crypto.randomUUID(),
      userId,
      tokenHash,
      expiresAt,
      nowIso,
      nowIso
    ),
  ]);

  return token;
}

async function deleteSessionById(env: Env, sessionId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `
        DELETE FROM sessions
        WHERE id = ?
      `
    ).bind(sessionId),
  ]);
}

function createSessionCookie(request: Request, token: string): string {
  const secure = new URL(request.url).protocol === 'https:';
  return [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    secure ? 'Secure' : null,
  ]
    .filter(Boolean)
    .join('; ');
}

function clearSessionCookie(request: Request): string {
  const secure = new URL(request.url).protocol === 'https:';
  return [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    secure ? 'Secure' : null,
  ]
    .filter(Boolean)
    .join('; ');
}

function mapUserRow(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    walletAddress: row.wallet_address,
    displayName: row.display_name,
    createdAt: row.created_at,
  };
}

function resolvePublicBaseUrl(request: Request, env: Env): string {
  const configured = env.APP_BASE_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, '');
  }

  const origin = request.headers.get('Origin')?.trim();
  if (origin) {
    return origin.replace(/\/+$/, '');
  }

  return new URL(request.url).origin;
}

async function sendMagicLinkEmail(env: Env, email: string, magicLink: string): Promise<void> {
  if (!env.RESEND_API_KEY) {
    throw new HttpError(500, 'RESEND_API_KEY is missing.');
  }

  const resend = new Resend(env.RESEND_API_KEY);
  const from = env.AUTH_EMAIL_FROM?.trim() || DEFAULT_AUTH_EMAIL_FROM;

  await resend.emails.send({
    from,
    to: email,
    subject: "Your sign-in link for Everybody's Platformer",
    text: [
      "Use this link to sign in to Everybody's Platformer:",
      magicLink,
      '',
      'The link expires in 15 minutes.',
    ].join('\n'),
    html: [
      '<div style="font-family: monospace; background: #050505; color: #f3eee2; padding: 24px;">',
      '<h2 style="margin: 0 0 16px;">Everybody&apos;s Platformer sign-in</h2>',
      '<p style="margin: 0 0 16px;">Use this link to sign in:</p>',
      `<p style="margin: 0 0 24px;"><a href="${escapeHtml(magicLink)}" style="color: #7de5ff;">${escapeHtml(magicLink)}</a></p>`,
      '<p style="margin: 0; color: #8c877b;">This link expires in 15 minutes.</p>',
      '</div>',
    ].join(''),
  });
}

function createWalletChallengeMessage(
  request: Request,
  env: Env,
  address: string,
  nonce: string,
  issuedAt: string
): string {
  const host = new URL(resolvePublicBaseUrl(request, env)).host;

  return [
    "Everybody's Platformer wants you to sign in with your wallet.",
    '',
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Domain: ${host}`,
    `Issued At: ${issuedAt}`,
  ].join('\n');
}

function extractNonceFromWalletMessage(message: string): string | null {
  const match = /^Nonce:\s+(.+)$/m.exec(message);
  return match?.[1]?.trim() ?? null;
}

function createDisplayNameFromEmail(email: string): string {
  const local = email.split('@')[0] || 'player';
  return local.slice(0, 24);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

function isValidAddress(address: string): boolean {
  return /^0x[a-f0-9]{40}$/.test(address);
}

function shortenAddress(address: string): string {
  if (address.length < 10) {
    return address;
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function isExpired(isoDate: string): boolean {
  return Date.parse(isoDate) <= Date.now();
}

async function hashToken(rawToken: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawToken));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

function generateOpaqueToken(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);

  let binary = '';
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function parseCookie(rawCookie: string | null): Map<string, string> {
  const cookies = new Map<string, string>();

  if (!rawCookie) {
    return cookies;
  }

  for (const segment of rawCookie.split(';')) {
    const [rawKey, ...rest] = segment.split('=');
    const key = rawKey.trim();
    if (!key) continue;
    cookies.set(key, rest.join('=').trim());
  }

  return cookies;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseStoredSnapshot(raw: string, label: string): RoomSnapshot {
  try {
    return JSON.parse(raw) as RoomSnapshot;
  } catch {
    throw new HttpError(500, `Failed to parse ${label}.`);
  }
}

function buildRoomPermissions(record: RoomRecord, viewerUserId: string | null) {
  const minted = isRoomMinted(record);
  return {
    canPublish: !minted,
    canRevert: !minted && viewerUserId !== null && viewerUserId === record.claimerUserId,
  };
}

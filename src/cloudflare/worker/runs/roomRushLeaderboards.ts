import { expandedRoomIdFromStandaloneRoomId } from '../../../expandedRooms/model';
import {
  DEFAULT_ROOM_COORDINATES,
  roomIdFromCoordinates,
  type RoomCoordinates,
} from '../../../persistence/roomModel';
import type {
  RoomRushDifficulty,
  RoomRushLeaderboardEntry,
  RoomRushLeaderboardModeKey,
  RoomRushLeaderboardResponse,
  RoomRushLeaderboardsResponse,
  RoomRushRouteStepRecord,
  RoomRushRunStartResponse,
  RoomRushRunSubmissionRequestBody,
  RoomRushRunSubmissionResponse,
  RoomRushStartRule,
} from '../../../runs/model';
import { requireAuthenticatedRequestAuth, loadOptionalRequestAuth, requireOptionalScope } from '../auth/request';
import { HttpError, jsonResponse, parsePositiveIntegerQueryParam } from '../core/http';
import { ServerTiming, timedJsonResponse } from '../core/serverTiming';
import type { Env, RoomRushRunRow, RoomRushRunStartRow } from '../core/types';
import {
  assertWampLeaderboardWriteAllowed,
  sqlUserIdIsNotLegacyGeneratedOnly,
} from '../generatedUsers/leaderboardIsolation';
import { loadPublishedExpandedRoomMembershipsInBounds } from '../expandedRooms/store';
import { loadPublishedRoom, loadPublishedRoomsInBounds } from '../rooms/store';
import { parseRoomRushRunStartBody, parseRoomRushRunSubmissionBody } from './requestBodies';

const ROOM_RUSH_MODE_ORDER: Array<{
  difficulty: RoomRushDifficulty;
  startRule: RoomRushStartRule;
}> = [
  { difficulty: 'easy', startRule: 'selected' },
  { difficulty: 'hard', startRule: 'selected' },
  { difficulty: 'easy', startRule: 'origin' },
  { difficulty: 'hard', startRule: 'origin' },
];

const ROOM_RUSH_LEADERBOARD_ORDER =
  'unique_rooms DESC, elapsed_ms ASC, deaths ASC, finished_at ASC, attempt_id ASC';
const ROOM_RUSH_START_TTL_MS = 2 * 60 * 60 * 1000;
const ROOM_RUSH_FINALIZE_CLOCK_GRACE_MS = 10_000;
const ROOM_RUSH_MIN_MS_PER_TRANSITION = 100;

interface RankedRoomRushRunRow extends RoomRushRunRow {
  overall_rank: number | string | null;
}

interface ScoredRoomRushRoute {
  uniqueRooms: number;
  route: RoomRushRouteStepRecord[];
}

export async function handleRoomRushRunStart(
  request: Request,
  env: Env
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'start Room Rush runs',
    'runs:write'
  );
  await assertWampLeaderboardWriteAllowed(env, auth, 'play Room Rush');
  const body = await parseRoomRushRunStartBody(request);

  if (
    body.startRule === 'origin' &&
    !areRoomCoordinatesEqual(body.startCoordinates, DEFAULT_ROOM_COORDINATES)
  ) {
    throw new HttpError(400, 'Origin Room Rush runs must start at the world origin.');
  }

  const startRoomId = roomIdFromCoordinates(body.startCoordinates);
  const startRoom = await loadPublishedRoom(env, startRoomId, body.startCoordinates);
  if (!startRoom) {
    throw new HttpError(400, 'Room Rush runs must start on a published room.');
  }

  const startId = crypto.randomUUID();
  const clientRunId = `room-rush-${startId}`;
  const startedAtDate = new Date();
  const startedAt = startedAtDate.toISOString();
  const expiresAt = new Date(startedAtDate.getTime() + ROOM_RUSH_START_TTL_MS).toISOString();

  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO room_rush_run_starts (
          start_id,
          client_run_id,
          user_id,
          difficulty,
          start_rule,
          start_room_id,
          start_x,
          start_y,
          started_at,
          expires_at,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).bind(
      startId,
      clientRunId,
      auth.user.id,
      body.difficulty,
      body.startRule,
      startRoomId,
      body.startCoordinates.x,
      body.startCoordinates.y,
      startedAt,
      expiresAt,
      startedAt
    ),
  ]);

  const response: RoomRushRunStartResponse = {
    startId,
    clientRunId,
    difficulty: body.difficulty,
    startRule: body.startRule,
    startCoordinates: { ...body.startCoordinates },
    startedAt,
    expiresAt,
  };
  return jsonResponse(request, response, { status: 201 });
}

export async function handleRoomRushRunSubmit(
  request: Request,
  env: Env
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'submit Room Rush runs',
    'runs:write'
  );
  await assertWampLeaderboardWriteAllowed(env, auth, 'play Room Rush');
  const body = await parseRoomRushRunSubmissionBody(request);
  const start = await loadRoomRushRunStart(env, auth.user.id, body.startId);
  if (!start) {
    throw new HttpError(400, 'Room Rush run start was not found.');
  }
  assertRoomRushStartMatchesSubmission(start, body);

  const existing = await env.DB.prepare(
    `
      SELECT attempt_id
      FROM room_rush_runs
      WHERE user_id = ?
        AND client_run_id = ?
      LIMIT 1
    `
  )
    .bind(auth.user.id, body.clientRunId)
    .first<{ attempt_id: string }>();

  if (existing?.attempt_id) {
    const response: RoomRushRunSubmissionResponse = {
      saved: false,
      attemptId: existing.attempt_id,
    };
    return jsonResponse(request, response);
  }

  if (start.consumed_attempt_id) {
    throw new HttpError(409, 'Room Rush run start has already been finalized.');
  }

  const finishedAtDate = new Date();
  assertRoomRushTimingIsPlausible(start, body, finishedAtDate);
  assertRoomRushRouteIsPlausible(body);
  const scoredRoute = await scoreRoomRushRouteByExpandedRoom(env, body.route);
  const uniqueRooms = scoredRoute.uniqueRooms;
  if (uniqueRooms <= 0) {
    throw new HttpError(400, 'Room Rush runs must include at least one unique room.');
  }

  const attemptId = crypto.randomUUID();
  const finishedAt = finishedAtDate.toISOString();
  const startRoomId = roomIdFromCoordinates(body.startCoordinates);
  const finishRoomId = roomIdFromCoordinates(body.finishCoordinates);
  const response: RoomRushRunSubmissionResponse = {
    saved: true,
    attemptId,
  };

  await env.DB.batch([
    env.DB.prepare(
      `
        UPDATE room_rush_run_starts
        SET consumed_attempt_id = ?,
            consumed_at = ?
        WHERE start_id = ?
          AND user_id = ?
          AND consumed_attempt_id IS NULL
      `
    ).bind(attemptId, finishedAt, start.start_id, auth.user.id),
    env.DB.prepare(
      `
        INSERT INTO room_rush_runs (
          attempt_id,
          client_run_id,
          user_id,
          user_display_name,
          difficulty,
          start_rule,
          result,
          unique_rooms,
          elapsed_ms,
          deaths,
          start_room_id,
          start_x,
          start_y,
          finish_room_id,
          finish_x,
          finish_y,
          route_json,
          finished_at,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).bind(
      attemptId,
      body.clientRunId,
      auth.user.id,
      auth.user.displayName,
      body.difficulty,
      body.startRule,
      body.result,
      uniqueRooms,
      body.elapsedMs,
      body.deaths,
      startRoomId,
      body.startCoordinates.x,
      body.startCoordinates.y,
      finishRoomId,
      body.finishCoordinates.x,
      body.finishCoordinates.y,
      JSON.stringify(scoredRoute.route),
      finishedAt,
      finishedAt
    ),
  ]);

  return jsonResponse(request, response, { status: 201 });
}

async function scoreRoomRushRouteByExpandedRoom(
  env: Env,
  route: RoomRushRouteStepRecord[]
): Promise<ScoredRoomRushRoute> {
  if (route.length === 0) {
    return { uniqueRooms: 0, route };
  }

  const bounds = getRouteBounds(route.map((step) => step.coordinates));
  const publishedRooms = await loadPublishedRoomsInBounds(
    env,
    bounds.minX,
    bounds.maxX,
    bounds.minY,
    bounds.maxY
  );
  const publishedRoomIds = new Set(publishedRooms.map((source) => source.snapshot.id));
  for (const step of route) {
    if (!publishedRoomIds.has(step.roomId)) {
      throw new HttpError(400, 'Room Rush routes can only include published rooms.');
    }
  }

  const memberships = isExpandedRoomsEnabled(env)
    ? await loadPublishedExpandedRoomMembershipsInBounds(
        env,
        bounds.minX,
        bounds.maxX,
        bounds.minY,
        bounds.maxY
      )
    : [];
  const expandedRoomIdByRoomId = new Map(
    memberships.map((membership) => [membership.roomId, membership.expandedRoomId])
  );
  const areaVisitIndexById = new Map<string, number>();
  const scoredRoute = route.map((step) => {
    const expandedRoomId =
      expandedRoomIdByRoomId.get(step.roomId) ?? expandedRoomIdFromStandaloneRoomId(step.roomId);
    let uniqueAreaVisitIndex = areaVisitIndexById.get(expandedRoomId) ?? null;
    if (uniqueAreaVisitIndex === null) {
      uniqueAreaVisitIndex = areaVisitIndexById.size + 1;
      areaVisitIndexById.set(expandedRoomId, uniqueAreaVisitIndex);
    }

    return {
      ...step,
      expandedRoomId,
      uniqueVisitIndex: uniqueAreaVisitIndex,
      uniqueAreaVisitIndex,
    };
  });

  return {
    uniqueRooms: areaVisitIndexById.size,
    route: scoredRoute,
  };
}

async function loadRoomRushRunStart(
  env: Env,
  userId: string,
  startId: string
): Promise<RoomRushRunStartRow | null> {
  const row = await env.DB.prepare(
    `
      SELECT
        start_id,
        client_run_id,
        user_id,
        difficulty,
        start_rule,
        start_room_id,
        start_x,
        start_y,
        started_at,
        expires_at,
        consumed_attempt_id,
        consumed_at,
        created_at
      FROM room_rush_run_starts
      WHERE start_id = ?
        AND user_id = ?
      LIMIT 1
    `
  )
    .bind(startId, userId)
    .first<RoomRushRunStartRow>();

  return row ?? null;
}

function assertRoomRushStartMatchesSubmission(
  start: RoomRushRunStartRow,
  body: RoomRushRunSubmissionRequestBody
): void {
  if (start.client_run_id !== body.clientRunId) {
    throw new HttpError(400, 'Room Rush clientRunId does not match the server start.');
  }

  if (start.difficulty !== body.difficulty || start.start_rule !== body.startRule) {
    throw new HttpError(400, 'Room Rush mode does not match the server start.');
  }

  if (
    start.start_x !== body.startCoordinates.x ||
    start.start_y !== body.startCoordinates.y ||
    start.start_room_id !== roomIdFromCoordinates(body.startCoordinates)
  ) {
    throw new HttpError(400, 'Room Rush start coordinates do not match the server start.');
  }
}

function assertRoomRushTimingIsPlausible(
  start: RoomRushRunStartRow,
  body: RoomRushRunSubmissionRequestBody,
  finishedAtDate: Date
): void {
  const startedAtMs = Date.parse(start.started_at);
  const expiresAtMs = Date.parse(start.expires_at);
  const finishedAtMs = finishedAtDate.getTime();
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(expiresAtMs)) {
    throw new HttpError(400, 'Room Rush run start timestamp is invalid.');
  }

  if (startedAtMs > finishedAtMs + ROOM_RUSH_FINALIZE_CLOCK_GRACE_MS) {
    throw new HttpError(400, 'Room Rush run start is in the future.');
  }

  if (expiresAtMs <= finishedAtMs) {
    throw new HttpError(400, 'Room Rush run start has expired.');
  }

  const maxElapsedMs = Math.max(
    0,
    finishedAtMs - startedAtMs + ROOM_RUSH_FINALIZE_CLOCK_GRACE_MS
  );
  if (body.elapsedMs > maxElapsedMs) {
    throw new HttpError(400, 'Room Rush elapsed time exceeds the server run window.');
  }

  const minElapsedMs = Math.max(0, body.route.length - 1) * ROOM_RUSH_MIN_MS_PER_TRANSITION;
  if (body.elapsedMs < minElapsedMs) {
    throw new HttpError(400, 'Room Rush elapsed time is too short for the submitted route.');
  }
}

function assertRoomRushRouteIsPlausible(body: RoomRushRunSubmissionRequestBody): void {
  const firstStep = body.route[0];
  const lastStep = body.route[body.route.length - 1];
  if (!firstStep || !lastStep) {
    throw new HttpError(400, 'Room Rush route must contain at least one room.');
  }

  if (!areRoomCoordinatesEqual(firstStep.coordinates, body.startCoordinates)) {
    throw new HttpError(400, 'Room Rush route must begin at the server start room.');
  }

  if (!areRoomCoordinatesEqual(lastStep.coordinates, body.finishCoordinates)) {
    throw new HttpError(400, 'Room Rush finish coordinates must match the route end.');
  }

  for (let index = 0; index < body.route.length; index += 1) {
    const step = body.route[index];
    if (step.routeIndex !== index) {
      throw new HttpError(400, 'Room Rush route indexes must be contiguous.');
    }

    const previousStep = body.route[index - 1] ?? null;
    if (!previousStep) {
      continue;
    }

    const distance =
      Math.abs(step.coordinates.x - previousStep.coordinates.x) +
      Math.abs(step.coordinates.y - previousStep.coordinates.y);
    if (distance !== 1) {
      throw new HttpError(400, 'Room Rush route steps must be adjacent rooms.');
    }
  }
}

function areRoomCoordinatesEqual(left: RoomCoordinates, right: RoomCoordinates): boolean {
  return left.x === right.x && left.y === right.y;
}

function getRouteBounds(coordinates: RoomCoordinates[]): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  return coordinates.reduce(
    (bounds, coordinate) => ({
      minX: Math.min(bounds.minX, coordinate.x),
      maxX: Math.max(bounds.maxX, coordinate.x),
      minY: Math.min(bounds.minY, coordinate.y),
      maxY: Math.max(bounds.maxY, coordinate.y),
    }),
    {
      minX: coordinates[0]?.x ?? 0,
      maxX: coordinates[0]?.x ?? 0,
      minY: coordinates[0]?.y ?? 0,
      maxY: coordinates[0]?.y ?? 0,
    },
  );
}

function isExpandedRoomsEnabled(env: Env): boolean {
  const raw = env.EXPANDED_ROOMS_ENABLED?.trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'off';
}

export async function handleRoomRushLeaderboards(
  request: Request,
  url: URL,
  env: Env
): Promise<Response> {
  const timing = new ServerTiming();
  const auth = await timing.measure('auth', () => loadOptionalRequestAuth(env, request));
  requireOptionalScope(auth, 'leaderboards:read', 'read Room Rush leaderboards');
  const limit = parsePositiveIntegerQueryParam(url.searchParams, 'limit', 25, 1, 50);
  const requestedMode = parseRoomRushLeaderboardModeQuery(url.searchParams.get('mode'));
  const modeOrder = requestedMode ? [requestedMode] : ROOM_RUSH_MODE_ORDER;
  const modes = await timing.measure('leaderboard', () => Promise.all(
    modeOrder.map((mode) =>
      buildRoomRushLeaderboardResponse(
        env,
        mode.difficulty,
        mode.startRule,
        limit,
        auth?.user.id ?? null
      )
    )
  ));
  const response: RoomRushLeaderboardsResponse = { modes };
  const authenticated = auth !== null;
  timing.setDiagnostic('cache', authenticated ? 'private-20' : 'public-20-swr-40');
  return timedJsonResponse(request, response, timing, {
    headers: {
      'Cache-Control': authenticated
        ? 'private, max-age=20'
        : 'public, max-age=20, stale-while-revalidate=40',
    },
  });
}

function parseRoomRushLeaderboardModeQuery(value: string | null): {
  difficulty: RoomRushDifficulty;
  startRule: RoomRushStartRule;
} | null {
  if (!value) {
    return null;
  }

  const match = ROOM_RUSH_MODE_ORDER.find(
    (mode) => getRoomRushModeKey(mode.difficulty, mode.startRule) === value
  );
  if (!match) {
    throw new HttpError(400, 'Invalid Room Rush leaderboard mode.');
  }

  return match;
}

async function buildRoomRushLeaderboardResponse(
  env: Env,
  difficulty: RoomRushDifficulty,
  startRule: RoomRushStartRule,
  limit: number,
  viewerUserId: string | null
): Promise<RoomRushLeaderboardResponse> {
  const entries = (await loadRankedRoomRushRows(env, difficulty, startRule, limit)).map(
    mapRoomRushLeaderboardEntry
  );
  let viewerBest: RoomRushLeaderboardEntry | null = null;

  if (viewerUserId !== null) {
    viewerBest = entries.find((entry) => entry.userId === viewerUserId) ?? null;
    if (viewerBest === null) {
      const viewerRow = await loadViewerRankedRoomRushRow(
        env,
        difficulty,
        startRule,
        viewerUserId
      );
      viewerBest = viewerRow ? mapRoomRushLeaderboardEntry(viewerRow) : null;
    }
  }

  return {
    difficulty,
    startRule,
    modeKey: getRoomRushModeKey(difficulty, startRule),
    entries,
    viewerBest,
    viewerRank: viewerBest?.rank ?? null,
  };
}

async function loadRankedRoomRushRows(
  env: Env,
  difficulty: RoomRushDifficulty,
  startRule: RoomRushStartRule,
  limit: number
): Promise<RankedRoomRushRunRow[]> {
  const result = await env.DB.prepare(
    `
      ${buildRankedRoomRushCte()}
      SELECT *
      FROM ranked_runs
      ORDER BY overall_rank
      LIMIT ?
    `
  )
    .bind(difficulty, startRule, limit)
    .all<RankedRoomRushRunRow>();

  return result.results;
}

async function loadViewerRankedRoomRushRow(
  env: Env,
  difficulty: RoomRushDifficulty,
  startRule: RoomRushStartRule,
  viewerUserId: string
): Promise<RankedRoomRushRunRow | null> {
  const row = await env.DB.prepare(
    `
      ${buildRankedRoomRushCte()}
      SELECT *
      FROM ranked_runs
      WHERE user_id = ?
      LIMIT 1
    `
  )
    .bind(difficulty, startRule, viewerUserId)
    .first<RankedRoomRushRunRow>();

  return row ?? null;
}

function buildRankedRoomRushCte(): string {
  return `
    WITH candidate_runs AS (
      SELECT
        attempt_id,
        client_run_id,
        user_id,
        user_display_name,
        difficulty,
        start_rule,
        result,
        unique_rooms,
        elapsed_ms,
        deaths,
        start_room_id,
        start_x,
        start_y,
        finish_room_id,
        finish_x,
        finish_y,
        route_json,
        finished_at,
        created_at,
        ROW_NUMBER() OVER (
          PARTITION BY user_id
          ORDER BY ${ROOM_RUSH_LEADERBOARD_ORDER}
        ) AS user_row_num
      FROM room_rush_runs
      WHERE difficulty = ?
        AND start_rule = ?
        AND result IN ('completed', 'failed')
        AND unique_rooms > 0
        AND elapsed_ms >= 0
        AND ${sqlUserIdIsNotLegacyGeneratedOnly('room_rush_runs.user_id')}
    ),
    best_runs AS (
      SELECT
        attempt_id,
        client_run_id,
        user_id,
        user_display_name,
        difficulty,
        start_rule,
        result,
        unique_rooms,
        elapsed_ms,
        deaths,
        start_room_id,
        start_x,
        start_y,
        finish_room_id,
        finish_x,
        finish_y,
        route_json,
        finished_at,
        created_at
      FROM candidate_runs
      WHERE user_row_num = 1
    ),
    ranked_runs AS (
      SELECT
        attempt_id,
        client_run_id,
        user_id,
        user_display_name,
        difficulty,
        start_rule,
        result,
        unique_rooms,
        elapsed_ms,
        deaths,
        start_room_id,
        start_x,
        start_y,
        finish_room_id,
        finish_x,
        finish_y,
        route_json,
        finished_at,
        created_at,
        ROW_NUMBER() OVER (
          ORDER BY ${ROOM_RUSH_LEADERBOARD_ORDER}
        ) AS overall_rank
      FROM best_runs
    )
  `;
}

function mapRoomRushLeaderboardEntry(
  row: RankedRoomRushRunRow
): RoomRushLeaderboardEntry {
  const difficulty = row.difficulty === 'hard' ? 'hard' : 'easy';
  const startRule = row.start_rule === 'origin' ? 'origin' : 'selected';

  return {
    rank: Number(row.overall_rank),
    attemptId: row.attempt_id,
    userId: row.user_id,
    userDisplayName: row.user_display_name,
    difficulty,
    startRule,
    result: row.result === 'failed' ? 'failed' : 'completed',
    uniqueRooms: Number(row.unique_rooms),
    elapsedMs: Number(row.elapsed_ms),
    deaths: Number(row.deaths),
    startRoomId: row.start_room_id,
    startCoordinates: {
      x: Number(row.start_x),
      y: Number(row.start_y),
    },
    finishRoomId: row.finish_room_id,
    finishCoordinates: {
      x: Number(row.finish_x),
      y: Number(row.finish_y),
    },
    finishedAt: row.finished_at,
  };
}

function getRoomRushModeKey(
  difficulty: RoomRushDifficulty,
  startRule: RoomRushStartRule
): RoomRushLeaderboardModeKey {
  return `${difficulty}:${startRule}` as RoomRushLeaderboardModeKey;
}

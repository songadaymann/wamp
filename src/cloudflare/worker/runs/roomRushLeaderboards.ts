import { expandedRoomIdFromStandaloneRoomId } from '../../../expandedRooms/model';
import {
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
  RoomRushRunSubmissionResponse,
  RoomRushStartRule,
} from '../../../runs/model';
import { requireAuthenticatedRequestAuth, loadOptionalRequestAuth, requireOptionalScope } from '../auth/request';
import { HttpError, jsonResponse, parsePositiveIntegerQueryParam } from '../core/http';
import type { Env, RoomRushRunRow } from '../core/types';
import {
  assertWampLeaderboardWriteAllowed,
  sqlUserIdIsNotPlayfunOnly,
} from '../playfun/leaderboardIsolation';
import { loadPublishedExpandedRoomMembershipsInBounds } from '../expandedRooms/store';
import { parseRoomRushRunSubmissionBody } from './requestBodies';

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

interface RankedRoomRushRunRow extends RoomRushRunRow {
  overall_rank: number | string | null;
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

  const scoredRoute = await scoreRoomRushRouteByExpandedRoom(env, body.route);
  const uniqueRooms = scoredRoute.uniqueRooms;
  if (uniqueRooms <= 0) {
    throw new HttpError(400, 'Room Rush runs must include at least one unique room.');
  }

  const attemptId = crypto.randomUUID();
  const finishedAt = new Date().toISOString();
  const startRoomId = roomIdFromCoordinates(body.startCoordinates);
  const finishRoomId = roomIdFromCoordinates(body.finishCoordinates);
  const response: RoomRushRunSubmissionResponse = {
    saved: true,
    attemptId,
  };

  await env.DB.batch([
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
): Promise<{ uniqueRooms: number; route: RoomRushRouteStepRecord[] }> {
  if (route.length === 0 || !isExpandedRoomsEnabled(env)) {
    return {
      uniqueRooms: new Set(route.map((step) => step.roomId)).size,
      route,
    };
  }

  const bounds = getRouteBounds(route.map((step) => step.coordinates));
  const memberships = await loadPublishedExpandedRoomMembershipsInBounds(
    env,
    bounds.minX,
    bounds.maxX,
    bounds.minY,
    bounds.maxY,
  );
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
  const auth = await loadOptionalRequestAuth(env, request);
  requireOptionalScope(auth, 'leaderboards:read', 'read Room Rush leaderboards');
  const limit = parsePositiveIntegerQueryParam(url.searchParams, 'limit', 25, 1, 50);
  const requestedMode = parseRoomRushLeaderboardModeQuery(url.searchParams.get('mode'));
  const modeOrder = requestedMode ? [requestedMode] : ROOM_RUSH_MODE_ORDER;
  const modes = await Promise.all(
    modeOrder.map((mode) =>
      buildRoomRushLeaderboardResponse(
        env,
        mode.difficulty,
        mode.startRule,
        limit,
        auth?.user.id ?? null
      )
    )
  );
  const response: RoomRushLeaderboardsResponse = { modes };
  return jsonResponse(request, response);
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
        AND ${sqlUserIdIsNotPlayfunOnly('room_rush_runs.user_id')}
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

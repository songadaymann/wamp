import type {
  PvpMatchSubmissionParticipant,
  PvpMatchSubmissionRequestBody,
  PvpMatchSubmissionResponse,
  PvpResult,
} from '../../../pvp/model';
import { createEmptyProgressionDelta } from '../progression/shared';
import { awardLaneDelta, persistProgressIncrement } from '../progression/laneEvents';
import { loadPublicProgressionSummary, syncUserBadges } from '../progression/store';
import { requireAuthenticatedRequestAuth } from '../auth/request';
import { HttpError, jsonResponse, parseJsonBody } from '../core/http';
import type { Env, PvpMatchRow } from '../core/types';

const PVP_LOSS_PXP = 6;
const PVP_DRAW_PXP = 10;
const PVP_WIN_PXP = 20;

export async function handlePvpMatchSubmit(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(env, request, 'submit PVP matches', 'runs:write');
  const body = normalizePvpMatchSubmission(await parseJsonBody<PvpMatchSubmissionRequestBody>(request));
  const viewerParticipant = body.participants.find((participant) => participant.userId === auth.user.id);
  if (!viewerParticipant) {
    throw new HttpError(403, 'You can only submit PVP matches you played in.');
  }

  const existing = await env.DB.prepare(
    `
      SELECT match_id
      FROM pvp_matches
      WHERE match_id = ?
      LIMIT 1
    `
  )
    .bind(body.matchId)
    .first<Pick<PvpMatchRow, 'match_id'>>();

  if (existing?.match_id) {
    return jsonResponse(request, {
      saved: false,
      matchId: existing.match_id,
      progressionDelta: createEmptyProgressionDelta(),
      progression: await loadPublicProgressionSummary(env, auth.user.id),
    } satisfies PvpMatchSubmissionResponse);
  }

  const createdAt = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO pvp_matches (
          match_id,
          mode,
          room_id,
          room_x,
          room_y,
          result,
          winner_user_id,
          loser_user_id,
          started_at,
          finished_at,
          duration_ms,
          final_snapshot_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).bind(
      body.matchId,
      body.mode,
      body.roomId,
      body.roomCoordinates.x,
      body.roomCoordinates.y,
      body.result,
      body.winnerUserId,
      body.loserUserId,
      body.startedAt,
      body.finishedAt,
      body.durationMs,
      JSON.stringify(body.finalSnapshot),
      createdAt,
    ),
    ...body.participants.map((participant) =>
      env.DB.prepare(
        `
          INSERT INTO pvp_match_players (
            match_id,
            user_id,
            user_display_name,
            result,
            hearts_remaining,
            lives_lost,
            hits,
            xp_awarded,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
        `
      ).bind(
        body.matchId,
        participant.userId,
        participant.userDisplayName,
        participant.result,
        participant.heartsRemaining,
        participant.livesLost,
        participant.hits,
        createdAt,
      )
    ),
  ]);

  const progressionDelta = createEmptyProgressionDelta();
  for (const participant of body.participants) {
    const awarded = await awardPvpParticipantProgression(env, body.matchId, participant, createdAt);
    await env.DB.batch([
      env.DB.prepare(
        `
          UPDATE pvp_match_players
          SET xp_awarded = ?
          WHERE match_id = ?
            AND user_id = ?
        `
      ).bind(awarded, body.matchId, participant.userId),
      env.DB.prepare(
        `
          INSERT INTO user_stats (
            user_id,
            user_display_name,
            pvp_wins,
            pvp_losses,
            pvp_draws,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            user_display_name = excluded.user_display_name,
            pvp_wins = user_stats.pvp_wins + excluded.pvp_wins,
            pvp_losses = user_stats.pvp_losses + excluded.pvp_losses,
            pvp_draws = user_stats.pvp_draws + excluded.pvp_draws,
            updated_at = excluded.updated_at
        `
      ).bind(
        participant.userId,
        participant.userDisplayName,
        participant.result === 'win' ? 1 : 0,
        participant.result === 'loss' ? 1 : 0,
        participant.result === 'draw' ? 1 : 0,
        createdAt,
      ),
    ]);

    if (participant.userId === auth.user.id) {
      progressionDelta.pxp += awarded;
    }
  }

  return jsonResponse(request, {
    saved: true,
    matchId: body.matchId,
    progressionDelta,
    progression: await loadPublicProgressionSummary(env, auth.user.id),
  } satisfies PvpMatchSubmissionResponse, { status: 201 });
}

async function awardPvpParticipantProgression(
  env: Env,
  matchId: string,
  participant: PvpMatchSubmissionParticipant,
  createdAt: string,
): Promise<number> {
  const amount =
    participant.result === 'win'
      ? PVP_WIN_PXP
      : participant.result === 'draw'
        ? PVP_DRAW_PXP
        : PVP_LOSS_PXP;
  const awarded = await awardLaneDelta(
    env,
    participant.userId,
    'pxp',
    `pvp_match_${participant.result}`,
    'pvp_match',
    matchId,
    `pxp:pvp_match:${matchId}:${participant.userId}`,
    amount,
    createdAt,
    {
      result: participant.result,
      heartsRemaining: participant.heartsRemaining,
      livesLost: participant.livesLost,
      hits: participant.hits,
    },
  );
  await persistProgressIncrement(env, participant.userId, {
    pxp: awarded,
    bxp: 0,
    cxp: 0,
    trust: 0,
  }, createdAt);
  await syncUserBadges(env, participant.userId);
  return awarded;
}

function normalizePvpMatchSubmission(value: PvpMatchSubmissionRequestBody): PvpMatchSubmissionRequestBody {
  if (!value || typeof value !== 'object') {
    throw new HttpError(400, 'Invalid PVP match submission.');
  }

  const matchId = normalizeText(value.matchId, 96, 'Match id is required.');
  const roomId = normalizeText(value.roomId, 80, 'Room id is required.');
  if (value.mode !== 'arena') {
    throw new HttpError(400, 'Unsupported PVP mode.');
  }
  if (!value.roomCoordinates || !Number.isInteger(value.roomCoordinates.x) || !Number.isInteger(value.roomCoordinates.y)) {
    throw new HttpError(400, 'Room coordinates are required.');
  }
  if (value.result !== 'win' && value.result !== 'draw') {
    throw new HttpError(400, 'Invalid PVP result.');
  }
  if (value.result === 'win' && (!value.winnerUserId || !value.loserUserId || value.winnerUserId === value.loserUserId)) {
    throw new HttpError(400, 'Winner and loser are required.');
  }
  if (value.result === 'draw' && (value.winnerUserId || value.loserUserId)) {
    throw new HttpError(400, 'Draw matches cannot have a winner.');
  }

  const participants = normalizeParticipants(value.participants);
  if (participants.length !== 2) {
    throw new HttpError(400, 'PVP matches require two participants.');
  }
  if (value.winnerUserId && !participants.some((participant) => participant.userId === value.winnerUserId)) {
    throw new HttpError(400, 'Winner must be a participant.');
  }
  if (value.loserUserId && !participants.some((participant) => participant.userId === value.loserUserId)) {
    throw new HttpError(400, 'Loser must be a participant.');
  }
  if (value.result === 'draw') {
    if (!participants.every((participant) => participant.result === 'draw')) {
      throw new HttpError(400, 'Draw participants must all be marked draw.');
    }
  } else {
    const winners = participants.filter((participant) => participant.result === 'win');
    const losers = participants.filter((participant) => participant.result === 'loss');
    if (
      winners.length !== 1 ||
      losers.length !== 1 ||
      winners[0]?.userId !== value.winnerUserId ||
      losers[0]?.userId !== value.loserUserId
    ) {
      throw new HttpError(400, 'Winner and loser participant results are inconsistent.');
    }
  }

  return {
    ...value,
    matchId,
    mode: 'arena',
    roomId,
    roomCoordinates: {
      x: value.roomCoordinates.x,
      y: value.roomCoordinates.y,
    },
    startedAt: normalizeIso(value.startedAt, 'Started timestamp is required.'),
    finishedAt: normalizeIso(value.finishedAt, 'Finished timestamp is required.'),
    durationMs: clampInteger(value.durationMs, 0, 60 * 60 * 1000),
    winnerUserId: value.winnerUserId,
    loserUserId: value.loserUserId,
    participants,
    finalSnapshot: value.finalSnapshot,
  };
}

function normalizeParticipants(value: unknown): PvpMatchSubmissionParticipant[] {
  if (!Array.isArray(value)) {
    throw new HttpError(400, 'PVP participants are required.');
  }

  const seen = new Set<string>();
  const participants: PvpMatchSubmissionParticipant[] = [];
  for (const item of value) {
    const raw = item as Partial<PvpMatchSubmissionParticipant>;
    const userId = normalizeText(raw.userId, 96, 'Participant user id is required.');
    if (seen.has(userId)) {
      continue;
    }

    const result = normalizePvpResult(raw.result);
    participants.push({
      userId,
      userDisplayName: normalizeText(raw.userDisplayName, 32, 'Participant display name is required.'),
      result,
      heartsRemaining: clampInteger(raw.heartsRemaining, 0, 3),
      livesLost: clampInteger(raw.livesLost, 0, 3),
      hits: clampInteger(raw.hits, 0, 99),
    });
    seen.add(userId);
  }

  return participants;
}

function normalizePvpResult(value: unknown): PvpResult {
  if (value === 'win' || value === 'loss' || value === 'draw') {
    return value;
  }

  throw new HttpError(400, 'Invalid participant result.');
}

function normalizeText(value: unknown, maxLength: number, message: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, message);
  }

  return value.trim().slice(0, maxLength);
}

function normalizeIso(value: unknown, message: string): string {
  const text = normalizeText(value, 40, message);
  if (!Number.isFinite(Date.parse(text))) {
    throw new HttpError(400, message);
  }

  return text;
}

function clampInteger(value: unknown, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.round(number)));
}

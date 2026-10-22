import type { PvpMatchSnapshot, PvpMatchSubmissionParticipant } from '../../../pvp/model';
import { getMultiplayerModeDefinition } from '../../../multiplayer/model';
import { awardCappedLaneDelta, persistProgressIncrement } from '../progression/laneEvents';
import { syncUserBadges } from '../progression/store';
import { hashRateLimitKey, releaseRateLimitSlots, takeRateLimitSlots, type RateLimitRule } from '../core/rateLimit';
import { loadSchoolAuthContextForUser } from '../school/store';
import type { Env } from '../core/types';

const PVP_LOSS_PXP = 6;
const PVP_DRAW_PXP = 10;
const PVP_WIN_PXP = 20;
const MAX_MATCH_DURATION_MS = 60 * 60 * 1000;
// PvP earns at most this much PXP per UTC day, and each player has at most this many
// matches saved per hour; matches past the hourly limit are not saved.
const PVP_PXP_CAP = { eventTypes: ['pvp_match_win', 'pvp_match_draw', 'pvp_match_loss'], dailyCap: 200 } as const;
const PVP_MATCHES_PER_PLAYER: RateLimitRule = { bucket: 'pvp-match-saved', limit: 20, windowMs: 60 * 60 * 1000 };

export type PvpMatchRecordOutcome = 'recorded' | 'duplicate' | 'invalid' | 'ineligible' | 'limited';

/**
 * Saves a match the presence room ran to completion. Participants come from the room's
 * signed identities; names come from the users table. Matches with a guest, a missing
 * account or a classroom account are not saved.
 */
export async function recordPvpMatchResult(env: Env, match: PvpMatchSnapshot): Promise<PvpMatchRecordOutcome> {
  const participants = completedMatchParticipants(match);
  if (!participants) {
    return 'invalid';
  }
  if (await pvpMatchExists(env, match.matchId)) {
    return 'duplicate';
  }

  const names = await loadParticipantDisplayNames(env, participants.map(({ userId }) => userId));
  if (!names) {
    return 'ineligible';
  }
  for (const participant of participants) {
    const school = await loadSchoolAuthContextForUser(env, participant.userId);
    if (school.context || school.disabled) {
      return 'ineligible';
    }
    participant.userDisplayName = names.get(participant.userId) ?? participant.userDisplayName;
  }

  const slots = await takeRateLimitSlots(env, await Promise.all(participants.map(async ({ userId }) => ({
    rule: PVP_MATCHES_PER_PLAYER,
    keyHash: await hashRateLimitKey(env, `pvp-match:${userId}`),
  }))));
  if (slots.limitedBy) {
    return 'limited';
  }

  const createdAt = new Date().toISOString();
  try {
    await insertPvpMatch(env, match, participants, createdAt);
  } catch (error) {
    await releaseRateLimitSlots(env, slots.ids);
    if (await pvpMatchExists(env, match.matchId)) {
      return 'duplicate';
    }
    throw error;
  }

  for (const participant of participants) {
    const awarded = await awardPvpParticipantProgression(env, match.matchId, participant, createdAt);
    await env.DB.batch([
      env.DB.prepare(
        `
          UPDATE pvp_match_players
          SET xp_awarded = ?
          WHERE match_id = ?
            AND user_id = ?
        `
      ).bind(awarded, match.matchId, participant.userId),
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
  }

  return 'recorded';
}

/** The room's final standings, or null when the snapshot is not a finished match. */
function completedMatchParticipants(match: PvpMatchSnapshot): PvpMatchSubmissionParticipant[] | null {
  if (match.status !== 'complete' || match.mode !== 'arena' || !match.matchId) {
    return null;
  }
  if (!Number.isFinite(match.startedAt) || !Number.isFinite(match.finishedAt)) {
    return null;
  }
  const mode = getMultiplayerModeDefinition(match.mode);
  const userIds = new Set(match.participants.map(({ userId }) => userId));
  if (
    userIds.size !== match.participants.length ||
    match.participants.length < mode.minPlayers ||
    match.participants.length > mode.maxPlayers
  ) {
    return null;
  }
  if (!match.draw && (
    !match.winnerUserId ||
    !match.loserUserId ||
    match.winnerUserId === match.loserUserId ||
    !userIds.has(match.winnerUserId) ||
    !userIds.has(match.loserUserId)
  )) {
    return null;
  }

  return match.participants.map((participant) => ({
    userId: participant.userId,
    userDisplayName: participant.displayName,
    result: match.draw ? 'draw' : participant.userId === match.winnerUserId ? 'win' : 'loss',
    heartsRemaining: clampInteger(participant.hearts, 0, mode.startingLives),
    livesLost: clampInteger(mode.startingLives - participant.hearts, 0, mode.startingLives),
    hits: clampInteger(participant.hits, 0, 99),
  }));
}

async function pvpMatchExists(env: Env, matchId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `
      SELECT match_id
      FROM pvp_matches
      WHERE match_id = ?
      LIMIT 1
    `
  )
    .bind(matchId)
    .first<{ match_id: string }>();
  return Boolean(row?.match_id);
}

/** Current account names, or null when any participant has no account. */
async function loadParticipantDisplayNames(env: Env, userIds: string[]): Promise<Map<string, string> | null> {
  const rows = await env.DB.prepare(
    `
      SELECT id, display_name
      FROM users
      WHERE id IN (SELECT value FROM json_each(?))
    `
  )
    .bind(JSON.stringify(userIds))
    .all<{ id: string; display_name: string }>();
  const names = new Map(rows.results.map((row) => [row.id, row.display_name]));
  return userIds.every((userId) => names.has(userId)) ? names : null;
}

async function insertPvpMatch(
  env: Env,
  match: PvpMatchSnapshot,
  participants: PvpMatchSubmissionParticipant[],
  createdAt: string,
): Promise<void> {
  const startedAt = match.startedAt ?? 0;
  const finishedAt = match.finishedAt ?? startedAt;
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
      match.matchId,
      match.mode,
      match.roomId,
      match.roomCoordinates.x,
      match.roomCoordinates.y,
      match.draw ? 'draw' : 'win',
      match.draw ? null : match.winnerUserId,
      match.draw ? null : match.loserUserId,
      new Date(startedAt).toISOString(),
      new Date(finishedAt).toISOString(),
      clampInteger(finishedAt - startedAt, 0, MAX_MATCH_DURATION_MS),
      JSON.stringify(match),
      createdAt,
    ),
    ...participants.map((participant) =>
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
        match.matchId,
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
  const awarded = await awardCappedLaneDelta(env, participant.userId, 'pxp', {
    eventType: `pvp_match_${participant.result}`,
    sourceType: 'pvp_match',
    sourceId: matchId,
    dedupeKey: `pxp:pvp_match:${matchId}:${participant.userId}`,
    amount,
    createdAt,
    breakdown: {
      result: participant.result,
      heartsRemaining: participant.heartsRemaining,
      livesLost: participant.livesLost,
      hits: participant.hits,
    },
  }, PVP_PXP_CAP);
  await persistProgressIncrement(env, participant.userId, {
    pxp: awarded,
    bxp: 0,
    cxp: 0,
    trust: 0,
  }, createdAt);
  await syncUserBadges(env, participant.userId);
  return awarded;
}

function clampInteger(value: unknown, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.round(number)));
}

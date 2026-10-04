import type { ProgressionDelta } from '../../../progression/model';
import type { Env, UserProgressRow } from '../core/types';
import { loadOrBackfillUserProgress, loadUserProgressRow } from './progressRows';
import {
  levelForXp,
  type LaneEventConfig,
  parseRowNumber,
  trustTierFromScore,
} from './shared';

export async function persistProgressIncrement(
  env: Env,
  userId: string,
  delta: ProgressionDelta,
  updatedAt: string,
): Promise<UserProgressRow> {
  await loadOrBackfillUserProgress(env, userId);
  await env.DB.batch([env.DB.prepare(`UPDATE user_progress SET
    total_pxp = total_pxp + ?, total_bxp = total_bxp + ?, total_cxp = total_cxp + ?,
    hidden_trust_score = MAX(0, hidden_trust_score + ?), updated_at = ? WHERE user_id = ?`)
    .bind(delta.pxp, delta.bxp, delta.cxp, delta.trust, updatedAt, userId)]);
  return refreshProgressLevels(env, userId);
}

export async function refreshProgressLevels(env: Env, userId: string): Promise<UserProgressRow> {
  for (let retry = 0; retry <= 3; retry += 1) {
    const progress = await loadUserProgressRow(env, userId);
    if (!progress) throw new Error('Progress row is missing.');
    const playerLevel = levelForXp(progress.total_pxp);
    const builderLevel = levelForXp(progress.total_bxp);
    const curatorLevel = levelForXp(progress.total_cxp);
    const trustTier = trustTierFromScore(progress.hidden_trust_score);
    if (progress.player_level === playerLevel && progress.builder_level === builderLevel
      && progress.curator_level === curatorLevel && progress.trust_tier_internal === trustTier) return progress;
    if (retry === 3) break;
    await env.DB.batch([env.DB.prepare(`UPDATE user_progress SET player_level = ?, builder_level = ?,
      curator_level = ?, trust_tier_internal = ? WHERE user_id = ? AND total_pxp = ? AND total_bxp = ?
      AND total_cxp = ? AND hidden_trust_score = ?`)
      .bind(playerLevel, builderLevel, curatorLevel, trustTier, userId, progress.total_pxp, progress.total_bxp,
        progress.total_cxp, progress.hidden_trust_score)]);
  }
  throw new Error('Progress changed during the receipt; retry to refresh it.');
}

async function progressEventExists(
  env: Env,
  table: LaneEventConfig['table'],
  dedupeKey: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `
      SELECT 1 AS found
      FROM ${table}
      WHERE dedupe_key = ?
      LIMIT 1
    `
  )
    .bind(dedupeKey)
    .first<{ found: number | string | null }>();

  return parseRowNumber(row?.found) === 1;
}

async function recordLaneEvent(
  env: Env,
  userId: string,
  config: LaneEventConfig,
): Promise<boolean> {
  if (config.amount <= 0) {
    return false;
  }

  if (await progressEventExists(env, config.table, config.dedupeKey)) {
    return false;
  }

  try {
    await env.DB.batch([
      env.DB.prepare(
        `
          INSERT INTO ${config.table} (
            id,
            user_id,
            event_type,
            source_type,
            source_id,
            dedupe_key,
            amount,
            breakdown_json,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      ).bind(
        crypto.randomUUID(),
        userId,
        config.eventType,
        config.sourceType,
        config.sourceId,
        config.dedupeKey,
        config.amount,
        config.breakdown ? JSON.stringify(config.breakdown) : null,
        config.createdAt,
      ),
    ]);
  } catch (error) {
    if (isLaneDedupeConstraintError(error, config.table)) {
      return false;
    }
    throw error;
  }

  return true;
}

function isLaneDedupeConstraintError(
  error: unknown,
  table: LaneEventConfig['table'],
): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('UNIQUE constraint failed')
    && message.includes(`${table}.dedupe_key`);
}

export async function awardLaneDelta(
  env: Env,
  userId: string,
  lane: 'pxp' | 'bxp' | 'cxp' | 'trust',
  eventType: string,
  sourceType: string,
  sourceId: string,
  dedupeKey: string,
  amount: number,
  createdAt: string,
  breakdown?: Record<string, unknown> | null,
): Promise<number> {
  const table =
    lane === 'pxp'
      ? 'pxp_events'
      : lane === 'bxp'
        ? 'bxp_events'
        : lane === 'cxp'
          ? 'cxp_events'
          : 'trust_events';
  const inserted = await recordLaneEvent(env, userId, {
    table,
    amount,
    eventType,
    sourceType,
    sourceId,
    dedupeKey,
    createdAt,
    breakdown,
  });
  return inserted ? amount : 0;
}

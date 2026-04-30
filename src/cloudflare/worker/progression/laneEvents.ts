import type { ProgressionDelta } from '../../../progression/model';
import type { Env, UserProgressRow } from '../core/types';
import { loadOrBackfillUserProgress, upsertUserProgressRow } from './progressRows';
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
  const progress = await loadOrBackfillUserProgress(env, userId);
  const totalPxp = progress.total_pxp + delta.pxp;
  const totalBxp = progress.total_bxp + delta.bxp;
  const totalCxp = progress.total_cxp + delta.cxp;
  const trustScore = Math.max(0, progress.hidden_trust_score + delta.trust);
  const updated: UserProgressRow = {
    ...progress,
    total_pxp: totalPxp,
    total_bxp: totalBxp,
    total_cxp: totalCxp,
    player_level: levelForXp(totalPxp),
    builder_level: levelForXp(totalBxp),
    curator_level: levelForXp(totalCxp),
    hidden_trust_score: trustScore,
    trust_tier_internal: trustTierFromScore(trustScore),
    updated_at: updatedAt,
  };
  await upsertUserProgressRow(env, updated);
  return updated;
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

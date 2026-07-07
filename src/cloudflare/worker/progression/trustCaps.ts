import { getObjectById, type PlacedObject } from '../../../config';
import type { RoomSnapshot } from '../../../persistence/roomModel';
import type { BuilderCapabilitySummary, TrustTier } from '../../../progression/model';
import { HttpError } from '../core/http';
import type { Env, UserProgressRow } from '../core/types';
import { buildBuilderCapabilitySummary as buildCapabilitySummary } from './capabilities';
import { loadOrBackfillUserProgress } from './progressRows';
import {
  getUtcDayKey,
  parseRowNumber,
  TRUST_PENALTY_WINDOW_MS,
  trustTierFromScore,
} from './shared';

export interface RoomCapabilitySnapshot {
  trustTier: TrustTier;
  claimLimitPerDay: number;
  publishLimitPerDay: number;
  expandedRoomCellLimit: number;
  objectLimit: number;
  collectibleLimit: number;
}

export interface EffectiveTrustState {
  rawScore: number;
  rawTier: TrustTier;
  effectiveScore: number;
  effectiveTier: TrustTier;
  penaltyActive: boolean;
  suspiciousPenaltyActive: boolean;
  chatPenaltyActive: boolean;
}

function isPenaltyWindowActive(timestamp: string | null, nowMs: number): boolean {
  if (!timestamp) {
    return false;
  }
  const parsedMs = Date.parse(timestamp);
  return Number.isFinite(parsedMs) && parsedMs + TRUST_PENALTY_WINDOW_MS > nowMs;
}

function pickLatestTimestamp(left: string | null, right: string | null): string | null {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

export async function loadEffectiveTrustState(
  env: Env,
  userId: string,
  progress?: UserProgressRow,
): Promise<EffectiveTrustState> {
  const resolvedProgress = progress ?? await loadOrBackfillUserProgress(env, userId);
  const [suspiciousRow, chatBanAuditRow, activeChatBanRow] = await Promise.all([
    env.DB.prepare(
      `
        SELECT created_at
        FROM admin_suspicious_invalidation_audit
        WHERE target_user_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `
    )
      .bind(userId)
      .first<{ created_at: string | null }>(),
    env.DB.prepare(
      `
        SELECT created_at
        FROM chat_ban_audit
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `
    )
      .bind(userId)
      .first<{ created_at: string | null }>(),
    env.DB.prepare(
      `
        SELECT created_at
        FROM chat_bans
        WHERE user_id = ?
        LIMIT 1
      `
    )
      .bind(userId)
      .first<{ created_at: string | null }>(),
  ]);

  const nowMs = Date.now();
  const latestChatBanAt = pickLatestTimestamp(
    chatBanAuditRow?.created_at ?? null,
    activeChatBanRow?.created_at ?? null,
  );
  const suspiciousPenaltyActive = isPenaltyWindowActive(suspiciousRow?.created_at ?? null, nowMs);
  const chatPenaltyActive =
    activeChatBanRow !== null || isPenaltyWindowActive(latestChatBanAt, nowMs);
  const penaltyActive = suspiciousPenaltyActive || chatPenaltyActive;
  const rawScore = resolvedProgress.hidden_trust_score;
  const effectiveScore = penaltyActive ? 0 : rawScore;

  return {
    rawScore,
    rawTier: trustTierFromScore(rawScore),
    effectiveScore,
    effectiveTier: trustTierFromScore(effectiveScore),
    penaltyActive,
    suspiciousPenaltyActive,
    chatPenaltyActive,
  };
}

export async function loadEffectiveTrustTier(
  env: Env,
  userId: string,
  progress?: UserProgressRow,
): Promise<TrustTier> {
  return (await loadEffectiveTrustState(env, userId, progress)).effectiveTier;
}

export async function loadBuilderCapabilitySummary(
  env: Env,
  progress: UserProgressRow,
  requestAuthSource: 'session' | 'api_token' | 'agent_token' | null,
): Promise<BuilderCapabilitySummary> {
  return buildCapabilitySummary(
    env,
    progress,
    requestAuthSource,
    await loadEffectiveTrustTier(env, progress.user_id, progress),
  );
}

function countCollectibleObjects(placedObjects: PlacedObject[]): number {
  let total = 0;
  for (const object of placedObjects) {
    const config = getObjectById(object.id);
    if (config?.category === 'collectible') {
      total += 1;
    }
  }

  return total;
}

export async function resolveRoomCapabilities(
  env: Env,
  userId: string,
  requestAuthSource: 'session' | 'api_token' | 'agent_token' | null,
): Promise<RoomCapabilitySnapshot> {
  const progress = await loadOrBackfillUserProgress(env, userId);
  const summary = await loadBuilderCapabilitySummary(env, progress, requestAuthSource);
  return {
    trustTier: summary.trustTier,
    claimLimitPerDay: summary.claimLimitPerDay,
    publishLimitPerDay: summary.publishLimitPerDay,
    expandedRoomCellLimit: summary.expandedRoomCellLimit,
    objectLimit: summary.objectLimit,
    collectibleLimit: summary.collectibleLimit,
  };
}

async function countDailyRoomPublishes(env: Env, userId: string, dayStartIso: string): Promise<number> {
  const roomRow = await env.DB.prepare(
    `
      SELECT COUNT(*) AS count
      FROM room_versions
      WHERE published_by_user_id = ?
        AND created_at >= ?
        AND NOT EXISTS (
          SELECT 1
          FROM room_versions AS prior_versions
          WHERE prior_versions.room_id = room_versions.room_id
            AND prior_versions.version < room_versions.version
        )
    `
  )
    .bind(userId, dayStartIso)
    .first<{ count: number | string | null }>();

  return parseRowNumber(roomRow?.count);
}

export async function assertUserCanPublishContent(
  env: Env,
  userId: string,
  requestAuthSource: 'session' | 'api_token' | 'agent_token' | null,
  nowIso: string = new Date().toISOString(),
): Promise<void> {
  const capabilities = await resolveRoomCapabilities(env, userId, requestAuthSource);
  const utcDayStart = `${getUtcDayKey(nowIso)}T00:00:00.000Z`;
  const publishCount = await countDailyRoomPublishes(env, userId, utcDayStart);
  if (publishCount >= capabilities.publishLimitPerDay) {
    throw new HttpError(
      429,
      `Daily publish limit reached. You can publish ${capabilities.publishLimitPerDay} new rooms per UTC day. Publishing an Expanded Room setup does not count toward this limit.`,
    );
  }
}

export function validateRoomObjectsAgainstCapabilities(
  room: RoomSnapshot,
  capabilities: RoomCapabilitySnapshot,
  previousRoom: RoomSnapshot | null,
): void {
  const previousPlacedObjectsCount = previousRoom?.placedObjects.length ?? 0;
  if (
    room.placedObjects.length > capabilities.objectLimit &&
    room.placedObjects.length > previousPlacedObjectsCount
  ) {
    throw new HttpError(
      429,
      `Builder cap reached. Your current trust tier allows ${capabilities.objectLimit} placed objects per room.`,
    );
  }

  const collectibleCount = countCollectibleObjects(room.placedObjects);
  const previousCollectibleCount = previousRoom ? countCollectibleObjects(previousRoom.placedObjects) : 0;
  if (
    collectibleCount > capabilities.collectibleLimit &&
    collectibleCount > previousCollectibleCount
  ) {
    throw new HttpError(
      429,
      `Builder cap reached. Your current trust tier allows ${capabilities.collectibleLimit} collectibles per room.`,
    );
  }
}

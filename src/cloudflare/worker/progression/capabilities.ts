import type { BuilderCapabilitySummary, TrustTier } from '../../../progression/model';
import { getExpandedRoomCellLimitForTrustTier } from '../../../expandedRooms/model';
import type { Env, UserProgressRow } from '../core/types';

type RequestAuthSource = 'session' | 'api_token' | 'agent_token' | null;

const TRUST_TIER_CAPABILITIES: Record<
  TrustTier,
  { claimLimitPerDay: number; publishLimitPerDay: number; objectLimit: number; collectibleLimit: number }
> = {
  T0: { claimLimitPerDay: 1, publishLimitPerDay: 1, objectLimit: 250, collectibleLimit: 50 },
  T1: { claimLimitPerDay: 2, publishLimitPerDay: 2, objectLimit: 400, collectibleLimit: 75 },
  T2: { claimLimitPerDay: 4, publishLimitPerDay: 3, objectLimit: 700, collectibleLimit: 100 },
  T3: { claimLimitPerDay: 6, publishLimitPerDay: 5, objectLimit: 1000, collectibleLimit: 125 },
  T4: { claimLimitPerDay: 9, publishLimitPerDay: 9, objectLimit: 1500, collectibleLimit: 150 },
};

export function sanitizeOptionalOverride(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed <= 0) {
    return null;
  }
  return Math.floor(parsed);
}

function hasBuilderCapOverride(progress: UserProgressRow): boolean {
  return (
    progress.builder_claim_limit_override !== null ||
    progress.builder_publish_limit_override !== null ||
    progress.builder_object_limit_override !== null ||
    progress.builder_collectible_limit_override !== null ||
    progress.builder_expanded_room_cell_limit_override != null
  );
}

export function buildBuilderCapabilitySummary(
  env: Env,
  progress: UserProgressRow,
  _requestAuthSource: RequestAuthSource,
  trustTier: TrustTier,
): BuilderCapabilitySummary {
  const base = TRUST_TIER_CAPABILITIES[trustTier];
  const roomClaimLimit = resolveRoomClaimLimit(env, progress, base.claimLimitPerDay);
  const publishLimitPerDay = resolveRoomPublishLimit(env, progress, base.publishLimitPerDay);
  const objectLimit = progress.builder_object_limit_override ?? base.objectLimit;
  const collectibleLimit = progress.builder_collectible_limit_override ?? base.collectibleLimit;
  const expandedRoomCellLimit =
    progress.builder_expanded_room_cell_limit_override ?? getExpandedRoomCellLimitForTrustTier(trustTier);

  return {
    trustTier,
    claimLimitPerDay: roomClaimLimit,
    publishLimitPerDay,
    objectLimit,
    collectibleLimit,
    expandedRoomCellLimit,
    overrideActive: hasBuilderCapOverride(progress),
  };
}

function resolveRoomClaimLimit(
  env: Env,
  progress: UserProgressRow,
  baseClaimLimitPerDay: number,
): number {
  return progress.builder_claim_limit_override
    ?? parseOptionalPositiveInteger(env.ROOM_DAILY_CLAIM_LIMIT)
    ?? baseClaimLimitPerDay;
}

function resolveRoomPublishLimit(
  env: Env,
  progress: UserProgressRow,
  basePublishLimitPerDay: number,
): number {
  return progress.builder_publish_limit_override
    ?? parseOptionalPositiveInteger(env.ROOM_DAILY_PUBLISH_LIMIT)
    ?? basePublishLimitPerDay;
}

function parseOptionalPositiveInteger(raw: string | undefined): number | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

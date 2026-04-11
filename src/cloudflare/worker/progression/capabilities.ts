import type { BuilderCapabilitySummary, TrustTier } from '../../../progression/model';
import type { Env, UserProgressRow } from '../core/types';

type RequestAuthSource = 'session' | 'playfun' | 'api_token' | 'agent_token' | null;

const TRUST_TIER_CAPABILITIES: Record<
  TrustTier,
  { claimLimitPerDay: number; publishLimitPerDay: number; objectLimit: number; collectibleLimit: number }
> = {
  T0: { claimLimitPerDay: 1, publishLimitPerDay: 1, objectLimit: 250, collectibleLimit: 25 },
  T1: { claimLimitPerDay: 2, publishLimitPerDay: 2, objectLimit: 400, collectibleLimit: 40 },
  T2: { claimLimitPerDay: 4, publishLimitPerDay: 3, objectLimit: 700, collectibleLimit: 70 },
  T3: { claimLimitPerDay: 6, publishLimitPerDay: 5, objectLimit: 1000, collectibleLimit: 100 },
  T4: { claimLimitPerDay: 9, publishLimitPerDay: 8, objectLimit: 1500, collectibleLimit: 150 },
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
    progress.builder_collectible_limit_override !== null
  );
}

export function buildBuilderCapabilitySummary(
  env: Env,
  progress: UserProgressRow,
  requestAuthSource: RequestAuthSource,
  trustTier: TrustTier,
): BuilderCapabilitySummary {
  const base = TRUST_TIER_CAPABILITIES[trustTier];
  const roomClaimLimit = resolveRoomClaimLimit(env, requestAuthSource, progress, base.claimLimitPerDay);
  const playfunObjectCap =
    requestAuthSource === 'playfun'
      ? parseOptionalPositiveInteger(env.PLAYFUN_ROOM_MAX_PLACED_OBJECTS)
      : null;

  const publishLimitPerDay = resolveRoomPublishLimit(env, requestAuthSource, progress, base.publishLimitPerDay);
  const objectLimit = progress.builder_object_limit_override ?? base.objectLimit;
  const collectibleLimit = progress.builder_collectible_limit_override ?? base.collectibleLimit;

  return {
    trustTier,
    claimLimitPerDay: roomClaimLimit,
    publishLimitPerDay,
    objectLimit: playfunObjectCap === null ? objectLimit : Math.min(objectLimit, playfunObjectCap),
    collectibleLimit,
    overrideActive: hasBuilderCapOverride(progress),
  };
}

function resolveRoomClaimLimit(
  env: Env,
  requestAuthSource: RequestAuthSource,
  progress: UserProgressRow,
  baseClaimLimitPerDay: number,
): number {
  const claimLimitPerDay = progress.builder_claim_limit_override ?? baseClaimLimitPerDay;
  if (requestAuthSource === 'playfun') {
    const playfunCap = parseOptionalPositiveInteger(env.PLAYFUN_ROOM_DAILY_CLAIM_LIMIT);
    return playfunCap === null ? claimLimitPerDay : Math.min(claimLimitPerDay, playfunCap);
  }

  return progress.builder_claim_limit_override
    ?? parseOptionalPositiveInteger(env.ROOM_DAILY_CLAIM_LIMIT)
    ?? baseClaimLimitPerDay;
}

function resolveRoomPublishLimit(
  env: Env,
  requestAuthSource: RequestAuthSource,
  progress: UserProgressRow,
  basePublishLimitPerDay: number,
): number {
  const publishLimitPerDay = progress.builder_publish_limit_override ?? basePublishLimitPerDay;
  if (requestAuthSource === 'playfun') {
    return publishLimitPerDay;
  }

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

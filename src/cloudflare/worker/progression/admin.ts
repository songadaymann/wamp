import type { BuilderCapabilitySummary, ProgressionLaneSummary, TrustTier } from '../../../progression/model';
import { HttpError } from '../core/http';
import type { Env, UserProgressRow, UserRow } from '../core/types';
import { sanitizeOptionalOverride } from './capabilities';
import { buildLaneSummary } from './shared';
import {
  loadOrBackfillUserProgress,
  loadUserIdentityRow,
  upsertUserProgressRow,
} from './progressRows';
import { loadBuilderCapabilitySummary, loadEffectiveTrustState } from './trustCaps';

interface AdminProgressionIdentitySummary {
  userId: string;
  displayName: string;
  email: string | null;
  founderNumber: number | null;
  trust: {
    rawScore: number;
    rawTier: TrustTier;
    effectiveScore: number;
    effectiveTier: TrustTier;
    penaltyActive: boolean;
    suspiciousPenaltyActive: boolean;
    chatPenaltyActive: boolean;
  };
  stats: {
    player: ProgressionLaneSummary;
    builder: ProgressionLaneSummary;
    curator: ProgressionLaneSummary;
    badgeCount: number;
    trophyCount: number;
    firstIdentityQualifiedAt: string | null;
  };
  builderCaps: BuilderCapabilitySummary;
  override: {
    claimLimitPerDay: number | null;
    publishLimitPerDay: number | null;
    objectLimit: number | null;
    collectibleLimit: number | null;
    reason: string | null;
    updatedAt: string | null;
    updatedBy: string | null;
  };
}

async function buildAdminProgressionIdentitySummary(
  env: Env,
  identity: UserRow,
  progress: UserProgressRow,
): Promise<AdminProgressionIdentitySummary> {
  const effectiveTrust = await loadEffectiveTrustState(env, identity.id, progress);
  return {
    userId: identity.id,
    displayName: identity.display_name,
    email: identity.email,
    founderNumber: progress.founder_number,
    trust: {
      rawScore: effectiveTrust.rawScore,
      rawTier: effectiveTrust.rawTier,
      effectiveScore: effectiveTrust.effectiveScore,
      effectiveTier: effectiveTrust.effectiveTier,
      penaltyActive: effectiveTrust.penaltyActive,
      suspiciousPenaltyActive: effectiveTrust.suspiciousPenaltyActive,
      chatPenaltyActive: effectiveTrust.chatPenaltyActive,
    },
    stats: {
      player: buildLaneSummary('player', progress.total_pxp),
      builder: buildLaneSummary('builder', progress.total_bxp),
      curator: buildLaneSummary('curator', progress.total_cxp),
      badgeCount: progress.badge_count,
      trophyCount: progress.trophy_count,
      firstIdentityQualifiedAt: progress.first_identity_qualified_at,
    },
    builderCaps: await loadBuilderCapabilitySummary(env, progress, 'session'),
    override: {
      claimLimitPerDay: progress.builder_claim_limit_override,
      publishLimitPerDay: progress.builder_publish_limit_override,
      objectLimit: progress.builder_object_limit_override,
      collectibleLimit: progress.builder_collectible_limit_override,
      reason: progress.builder_cap_override_reason,
      updatedAt: progress.builder_cap_override_updated_at,
      updatedBy: progress.builder_cap_override_updated_by,
    },
  };
}

export async function searchAdminProgressionUsers(
  env: Env,
  query: string,
): Promise<AdminProgressionIdentitySummary[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const lowered = trimmed.toLowerCase();
  const like = `%${lowered}%`;
  const rows = await env.DB.prepare(
    `
      SELECT
        id,
        email,
        wallet_address,
        display_name,
        avatar_url,
        bio,
        selected_avatar_id,
        created_at,
        updated_at
      FROM users
      WHERE id = ?
         OR lower(display_name) = ?
         OR lower(COALESCE(email, '')) = ?
         OR id LIKE ?
         OR lower(display_name) LIKE ?
         OR lower(COALESCE(email, '')) LIKE ?
      ORDER BY
        CASE
          WHEN id = ? THEN 0
          WHEN lower(display_name) = ? THEN 1
          WHEN lower(COALESCE(email, '')) = ? THEN 2
          ELSE 3
        END,
        updated_at DESC
      LIMIT 12
    `
  )
    .bind(trimmed, lowered, lowered, like, like, like, trimmed, lowered, lowered)
    .all<UserRow>();

  return Promise.all(
    rows.results.map(async (identity) => {
      const progress = await loadOrBackfillUserProgress(env, identity.id);
      return await buildAdminProgressionIdentitySummary(env, identity, progress);
    }),
  );
}

export async function loadAdminProgressionUser(
  env: Env,
  userId: string,
): Promise<AdminProgressionIdentitySummary> {
  const identity = await loadUserIdentityRow(env, userId);
  if (!identity) {
    throw new HttpError(404, 'User not found.');
  }
  const progress = await loadOrBackfillUserProgress(env, userId);
  return buildAdminProgressionIdentitySummary(env, identity, progress);
}

export async function updateAdminBuilderCapOverride(
  env: Env,
  params: {
    userId: string;
    claimLimitPerDay: number | null;
    publishLimitPerDay: number | null;
    objectLimit: number | null;
    collectibleLimit: number | null;
    reason: string | null;
    operatorLabel: string;
  },
): Promise<AdminProgressionIdentitySummary> {
  const progress = await loadOrBackfillUserProgress(env, params.userId);
  const claimLimitPerDay = sanitizeOptionalOverride(params.claimLimitPerDay);
  const publishLimitPerDay = sanitizeOptionalOverride(params.publishLimitPerDay);
  const objectLimit = sanitizeOptionalOverride(params.objectLimit);
  const collectibleLimit = sanitizeOptionalOverride(params.collectibleLimit);
  const overrideActive =
    claimLimitPerDay !== null ||
    publishLimitPerDay !== null ||
    objectLimit !== null ||
    collectibleLimit !== null;
  const now = new Date().toISOString();
  const normalizedReason = params.reason?.trim() ? params.reason.trim() : null;
  const normalizedOperator = params.operatorLabel.trim() || 'Admin';

  await upsertUserProgressRow(env, {
    ...progress,
    builder_claim_limit_override: claimLimitPerDay,
    builder_publish_limit_override: publishLimitPerDay,
    builder_object_limit_override: objectLimit,
    builder_collectible_limit_override: collectibleLimit,
    builder_cap_override_reason: overrideActive ? normalizedReason : null,
    builder_cap_override_updated_at: overrideActive ? now : null,
    builder_cap_override_updated_by: overrideActive ? normalizedOperator : null,
    updated_at: now,
  });

  return loadAdminProgressionUser(env, params.userId);
}

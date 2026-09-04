import type { AuthUser } from '../../../auth/model';
import { cloneRoomSnapshot, type RoomSnapshot } from '../../../persistence/roomModel';
import {
  COMPLIMENTARY_WORLD_CLAIM_CEILING,
  COMPLIMENTARY_WORLD_PUBLISH_CEILING,
  DEFAULT_WORLD_CLAIM_LIMIT,
  DEFAULT_WORLD_PUBLISH_LIMIT,
  WAMP_PRIME_WORLD_ID,
  type MyWorldsResponse,
  type WorldBuildPolicy,
  type WorldActivityEvent,
  type WorldAdminState,
  type WorldDetail,
  type WorldEntitlementStatus,
  type WorldEntitlementSummary,
  type WorldPublishPolicy,
  type WorldSettings,
  type WorldSummary,
} from '../../../worlds/model';
import { buildWorldSharePath } from '../../../worlds/geometry';
import {
  createUserForEmail,
  findUserByEmail,
  isValidEmail,
  normalizeEmail,
} from '../auth/store';
import { HttpError } from '../core/http';
import type { Env } from '../core/types';
import { loadWorldAccessById } from './access';
import { prepareWorldActivityStatement } from './activity';
import { listPendingWorldNameRequests } from './names';

interface WorldSummaryRow {
  id: string;
  number: number;
  approved_name: string | null;
  owner_user_id: string | null;
  owner_display_name: string | null;
  origin_x: number;
  origin_y: number;
  room_count: number;
  build_policy: WorldBuildPolicy;
  publish_policy: WorldPublishPolicy;
  claim_limit_per_day: number;
  publish_limit_per_day: number;
  entitlement_status: WorldEntitlementStatus | null;
  claim_limit_ceiling: number | null;
  publish_limit_ceiling: number | null;
}

interface EntitlementRow {
  id: string;
  owner_user_id: string | null;
  owner_email: string;
  source: 'complimentary' | 'payment_provider';
  provider: string | null;
  status: WorldEntitlementStatus;
  claim_limit_ceiling: number;
  publish_limit_ceiling: number;
  billing_interval: 'month' | 'year' | null;
  current_period_end: string | null;
  seed_draft_json: string | null;
  seed_updated_at: string | null;
  world_id: string | null;
  world_number: number | null;
}

const WORLD_SUMMARY_SELECT = `
  SELECT
    w.id,
    w.number,
    w.approved_name,
    w.owner_user_id,
    owner.display_name AS owner_display_name,
    w.origin_x,
    w.origin_y,
    w.build_policy,
    w.publish_policy,
    w.claim_limit_per_day,
    w.publish_limit_per_day,
    e.status AS entitlement_status,
    e.claim_limit_ceiling,
    e.publish_limit_ceiling,
    COUNT(c.room_id) AS room_count
  FROM worlds w
  LEFT JOIN users owner ON owner.id = w.owner_user_id
  LEFT JOIN world_entitlements e ON e.id = w.entitlement_id
  LEFT JOIN world_room_claims c ON c.world_id = w.id
`;

export function worldsEnabled(env: Env): boolean {
  return env.WORLDS_ENABLED === '1';
}

export async function listWorlds(
  env: Env,
  viewerUserId: string | null,
  viewerIsAdmin = false,
): Promise<WorldSummary[]> {
  const result = await env.DB.prepare(
    `${WORLD_SUMMARY_SELECT}
     GROUP BY w.id
     ORDER BY w.number ASC`,
  ).all<WorldSummaryRow>();
  return Promise.all(result.results.map((row) => mapSummaryWithViewer(env, row, viewerUserId, viewerIsAdmin)));
}

export async function loadWorldDetailByNumber(
  env: Env,
  number: number,
  viewerUserId: string | null,
  viewerIsAdmin = false,
): Promise<WorldDetail | null> {
  const row = await env.DB.prepare(
    `${WORLD_SUMMARY_SELECT}
     WHERE w.number = ?
     GROUP BY w.id
     LIMIT 1`,
  ).bind(number).first<WorldSummaryRow>();
  if (!row) return null;
  return mapDetailWithViewer(env, row, viewerUserId, viewerIsAdmin);
}

export async function loadWorldDetailById(
  env: Env,
  worldId: string,
  viewerUserId: string | null,
  viewerIsAdmin = false,
): Promise<WorldDetail | null> {
  const row = await env.DB.prepare(
    `${WORLD_SUMMARY_SELECT}
     WHERE w.id = ?
     GROUP BY w.id
     LIMIT 1`,
  ).bind(worldId).first<WorldSummaryRow>();
  if (!row) return null;
  return mapDetailWithViewer(env, row, viewerUserId, viewerIsAdmin);
}

async function mapSummaryWithViewer(
  env: Env,
  row: WorldSummaryRow,
  viewerUserId: string | null,
  viewerIsAdmin: boolean,
): Promise<WorldSummary> {
  const access = await loadWorldAccessById(env, row.id, viewerUserId, viewerIsAdmin);
  return {
    id: row.id,
    number: row.number,
    displayName: row.approved_name,
    ownerUserId: row.owner_user_id,
    ownerDisplayName: row.owner_display_name,
    origin: { x: row.origin_x, y: row.origin_y },
    roomCount: Number(row.room_count) || 0,
    buildPolicy: row.build_policy,
    publishPolicy: row.publish_policy,
    frozen: row.number !== 0 && row.entitlement_status !== 'active',
    sharePath: buildWorldSharePath(row.number),
    viewerRole: access?.viewerRole ?? null,
    viewerMembershipStatus: access?.membershipStatus ?? null,
  };
}

async function mapDetailWithViewer(
  env: Env,
  row: WorldSummaryRow,
  viewerUserId: string | null,
  viewerIsAdmin: boolean,
): Promise<WorldDetail> {
  const summary = await mapSummaryWithViewer(env, row, viewerUserId, viewerIsAdmin);
  const access = await loadWorldAccessById(env, row.id, viewerUserId, viewerIsAdmin);
  return {
    ...summary,
    settings: {
      buildPolicy: row.build_policy,
      publishPolicy: row.publish_policy,
      claimLimitPerDay: row.claim_limit_per_day,
      publishLimitPerDay: row.publish_limit_per_day,
    },
    claimLimitCeiling: row.claim_limit_ceiling ?? row.claim_limit_per_day,
    publishLimitCeiling: row.publish_limit_ceiling ?? row.publish_limit_per_day,
    canManageMembers: access?.policy.canManageMembers ?? false,
    canManageSettings: access?.policy.canManageSettings ?? false,
    canReviewPublications: access?.policy.canReviewPublications ?? false,
    canRequestName: access?.policy.canRequestName ?? false,
  };
}

export async function loadMyWorlds(env: Env, user: AuthUser, isAdmin = false): Promise<MyWorldsResponse> {
  await bindPendingWorldIdentity(env, user);
  const entitlements = await listEntitlementsForUser(env, user.id);
  const result = await env.DB.prepare(
    `
      SELECT DISTINCT w.id
      FROM worlds w
      LEFT JOIN world_memberships m ON m.world_id = w.id
      WHERE w.number > 0
        AND (w.owner_user_id = ? OR (m.user_id = ? AND m.status IN ('active', 'invited', 'requested')))
      ORDER BY w.number ASC
    `,
  ).bind(user.id, user.id).all<{ id: string }>();
  const worlds = (
    await Promise.all(result.results.map((row) => loadWorldDetailById(env, row.id, user.id, isAdmin)))
  ).filter((world): world is WorldDetail => world !== null);
  return { entitlements, worlds };
}

export async function recordWorldDirectoryWarp(
  env: Env,
  worldId: string,
  userId: string | null,
): Promise<void> {
  const world = await loadWorldDetailById(env, worldId, userId, false);
  if (!world) throw new HttpError(404, 'World was not found.');
  await env.DB.batch([prepareWorldActivityStatement(env, {
    worldId,
    actorUserId: userId,
    eventType: 'directory_warped',
    subjectId: world.sharePath,
    metadata: { worldNumber: world.number },
    occurredAt: new Date().toISOString(),
  })]);
}

export async function bindPendingWorldIdentity(env: Env, user: AuthUser): Promise<void> {
  if (!user.email) return;
  const email = normalizeEmail(user.email);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE world_entitlements
       SET owner_user_id = ?, updated_at = ?
       WHERE owner_email = ? AND owner_user_id IS NULL`,
    ).bind(user.id, now, email),
    env.DB.prepare(
      `UPDATE world_memberships
       SET user_id = ?, display_name = ?, updated_at = ?
       WHERE email = ? AND user_id IS NULL`,
    ).bind(user.id, user.displayName, now, email),
  ]);
}

export async function listEntitlementsForUser(
  env: Env,
  userId: string,
): Promise<WorldEntitlementSummary[]> {
  const result = await env.DB.prepare(
    `
      SELECT
        e.id, e.owner_user_id, e.owner_email, e.source, e.provider, e.status,
        e.claim_limit_ceiling, e.publish_limit_ceiling, e.billing_interval,
        e.current_period_end, e.seed_draft_json, e.seed_updated_at,
        w.id AS world_id, w.number AS world_number
      FROM world_entitlements e
      LEFT JOIN worlds w ON w.entitlement_id = e.id
      WHERE e.owner_user_id = ?
      ORDER BY e.created_at DESC
    `,
  ).bind(userId).all<EntitlementRow>();
  return result.results.map(mapEntitlement);
}

function mapEntitlement(row: EntitlementRow): WorldEntitlementSummary {
  let seedDraft: RoomSnapshot | null = null;
  if (row.seed_draft_json) {
    try {
      seedDraft = cloneRoomSnapshot(JSON.parse(row.seed_draft_json) as RoomSnapshot);
    } catch {
      seedDraft = null;
    }
  }
  return {
    id: row.id,
    status: row.status,
    source: row.source,
    provider: row.provider,
    worldId: row.world_id,
    worldNumber: row.world_number,
    ownerEmail: row.owner_email,
    claimLimitCeiling: row.claim_limit_ceiling,
    publishLimitCeiling: row.publish_limit_ceiling,
    billingInterval: row.billing_interval,
    currentPeriodEnd: row.current_period_end,
    seedDraft,
    seedUpdatedAt: row.seed_updated_at,
  };
}

export async function createComplimentaryWorldGrant(
  env: Env,
  rawEmail: string,
  idempotencyKey: string | null = null,
): Promise<WorldEntitlementSummary> {
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) throw new HttpError(400, 'A valid owner email is required.');
  const normalizedKey = normalizeIdempotencyKey(idempotencyKey);
  if (normalizedKey) {
    const existing = await loadEntitlementByGrantKey(env, normalizedKey);
    if (existing) {
      if (existing.ownerEmail !== email) {
        throw new HttpError(409, 'That idempotency key belongs to another World grant.');
      }
      return existing;
    }
  }
  const user = (await findUserByEmail(env, email)) ?? (await createUserForEmail(env, email));
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO world_entitlements (
          id, owner_user_id, owner_email, source, provider, status,
          claim_limit_ceiling, publish_limit_ceiling, billing_interval,
          current_period_end, external_customer_ref, external_subscription_ref,
          grant_idempotency_key, seed_draft_json, seed_updated_at, created_at, updated_at
        ) VALUES (?, ?, ?, 'complimentary', NULL, 'active', ?, ?, NULL, NULL, NULL, NULL, ?, NULL, NULL, ?, ?)
      `,
    ).bind(
      id,
      user.id,
      email,
      COMPLIMENTARY_WORLD_CLAIM_CEILING,
      COMPLIMENTARY_WORLD_PUBLISH_CEILING,
      normalizedKey,
      now,
      now,
    ),
    prepareWorldActivityStatement(env, {
      entitlementId: id,
      actorUserId: null,
      eventType: 'complimentary_grant_created',
      subjectId: user.id,
      idempotencyKey: normalizedKey ? `grant:${normalizedKey}` : null,
      occurredAt: now,
    }),
  ]);
  const created = (await listEntitlementsForUser(env, user.id)).find((entry) => entry.id === id);
  if (!created) throw new HttpError(500, 'World grant could not be loaded after creation.');
  return created;
}

export async function loadWorldEntitlementById(
  env: Env,
  entitlementId: string,
): Promise<WorldEntitlementSummary | null> {
  const row = await env.DB.prepare(
    `SELECT
       e.id, e.owner_user_id, e.owner_email, e.source, e.provider, e.status,
       e.claim_limit_ceiling, e.publish_limit_ceiling, e.billing_interval,
       e.current_period_end, e.seed_draft_json, e.seed_updated_at,
       w.id AS world_id, w.number AS world_number
     FROM world_entitlements e
     LEFT JOIN worlds w ON w.entitlement_id = e.id
     WHERE e.id = ? LIMIT 1`,
  ).bind(entitlementId).first<EntitlementRow>();
  return row ? mapEntitlement(row) : null;
}

async function loadEntitlementByGrantKey(
  env: Env,
  idempotencyKey: string,
): Promise<WorldEntitlementSummary | null> {
  const row = await env.DB.prepare(
    `SELECT
       e.id, e.owner_user_id, e.owner_email, e.source, e.provider, e.status,
       e.claim_limit_ceiling, e.publish_limit_ceiling, e.billing_interval,
       e.current_period_end, e.seed_draft_json, e.seed_updated_at,
       w.id AS world_id, w.number AS world_number
     FROM world_entitlements e
     LEFT JOIN worlds w ON w.entitlement_id = e.id
     WHERE e.grant_idempotency_key = ? LIMIT 1`,
  ).bind(idempotencyKey).first<EntitlementRow>();
  return row ? mapEntitlement(row) : null;
}

function normalizeIdempotencyKey(value: string | null): string | null {
  const normalized = value?.trim() ?? '';
  if (!normalized) return null;
  if (normalized.length > 160) throw new HttpError(400, 'Idempotency key must be 160 characters or fewer.');
  return normalized;
}

export async function saveWorldSeedDraft(
  env: Env,
  grantId: string,
  userId: string,
  snapshot: RoomSnapshot,
): Promise<WorldEntitlementSummary> {
  const entitlement = await requireOwnedUnactivatedEntitlement(env, grantId, userId);
  if (entitlement.status !== 'active') throw new HttpError(403, 'This World grant is frozen.');
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE world_entitlements
       SET seed_draft_json = ?, seed_updated_at = ?, updated_at = ?
       WHERE id = ? AND owner_user_id = ?`,
    ).bind(JSON.stringify(snapshot), now, now, grantId, userId),
    prepareWorldActivityStatement(env, {
      entitlementId: grantId,
      actorUserId: userId,
      eventType: 'seed_draft_saved',
      subjectId: grantId,
      occurredAt: now,
    }),
  ]);
  const updated = (await listEntitlementsForUser(env, userId)).find((entry) => entry.id === grantId);
  if (!updated) throw new HttpError(404, 'World grant was not found.');
  return updated;
}

export async function requireOwnedUnactivatedEntitlement(
  env: Env,
  grantId: string,
  userId: string,
): Promise<WorldEntitlementSummary> {
  const entitlement = (await listEntitlementsForUser(env, userId)).find((entry) => entry.id === grantId);
  if (!entitlement) throw new HttpError(404, 'World grant was not found.');
  if (entitlement.worldId) throw new HttpError(409, 'This grant has already activated a World.');
  return entitlement;
}

export async function updateWorldSettings(
  env: Env,
  worldId: string,
  userId: string,
  isAdmin: boolean,
  settings: WorldSettings,
): Promise<WorldDetail> {
  const current = await loadWorldDetailById(env, worldId, userId, isAdmin);
  if (!current) throw new HttpError(404, 'World was not found.');
  if (!current.canManageSettings) throw new HttpError(403, 'Only the active World owner can change settings.');
  assertSettings(settings, current.claimLimitCeiling, current.publishLimitCeiling);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE worlds SET
        build_policy = ?, publish_policy = ?, claim_limit_per_day = ?,
        publish_limit_per_day = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(
      settings.buildPolicy,
      settings.publishPolicy,
      settings.claimLimitPerDay,
      settings.publishLimitPerDay,
      now,
      worldId,
    ),
    prepareWorldActivityStatement(env, {
      worldId,
      actorUserId: userId,
      eventType: 'settings_updated',
      subjectId: worldId,
      metadata: settings,
      occurredAt: now,
    }),
  ]);
  const updated = await loadWorldDetailById(env, worldId, userId, isAdmin);
  if (!updated) throw new HttpError(404, 'World was not found.');
  return updated;
}

function assertSettings(settings: WorldSettings, claimCeiling: number, publishCeiling: number): void {
  if (settings.buildPolicy !== 'request_to_join' && settings.buildPolicy !== 'invite_only') {
    throw new HttpError(400, 'buildPolicy must be request_to_join or invite_only.');
  }
  if (settings.publishPolicy !== 'members_publish' && settings.publishPolicy !== 'approval_required') {
    throw new HttpError(400, 'publishPolicy must be members_publish or approval_required.');
  }
  if (!Number.isInteger(settings.claimLimitPerDay) || settings.claimLimitPerDay < 1 || settings.claimLimitPerDay > claimCeiling) {
    throw new HttpError(400, `claimLimitPerDay must be between 1 and ${claimCeiling}.`);
  }
  if (!Number.isInteger(settings.publishLimitPerDay) || settings.publishLimitPerDay < 1 || settings.publishLimitPerDay > publishCeiling) {
    throw new HttpError(400, `publishLimitPerDay must be between 1 and ${publishCeiling}.`);
  }
}

export async function setWorldEntitlementStatus(
  env: Env,
  entitlementId: string,
  status: WorldEntitlementStatus,
  idempotencyKey: string,
): Promise<void> {
  const entitlement = await loadWorldEntitlementById(env, entitlementId);
  if (!entitlement) throw new HttpError(404, 'World entitlement was not found.');
  const eventType = status === 'active' ? 'entitlement_activated' : 'entitlement_frozen';
  const prior = await env.DB.prepare(
    `SELECT entitlement_id, event_type FROM world_activity_events WHERE idempotency_key = ? LIMIT 1`,
  ).bind(idempotencyKey).first<{ entitlement_id: string | null; event_type: string }>();
  if (prior) {
    if (prior.entitlement_id !== entitlementId || prior.event_type !== eventType) {
      throw new HttpError(409, 'That idempotency key was already used for another lifecycle change.');
    }
    return;
  }
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE world_entitlements SET status = ?, updated_at = ?
       WHERE id = ? AND NOT EXISTS (
         SELECT 1 FROM world_activity_events WHERE idempotency_key = ?
       )`,
    ).bind(status, now, entitlementId, idempotencyKey),
    prepareWorldActivityStatement(env, {
      entitlementId,
      actorUserId: null,
      eventType,
      subjectId: entitlementId,
      occurredAt: now,
      idempotencyKey,
    }),
  ]);
}

export async function listAdminWorldState(env: Env): Promise<WorldAdminState> {
  const entitlements = await env.DB.prepare(
    `
      SELECT
        e.id, e.owner_user_id, e.owner_email, e.source, e.provider, e.status,
        e.claim_limit_ceiling, e.publish_limit_ceiling, e.billing_interval,
        e.current_period_end, e.seed_draft_json, e.seed_updated_at,
        w.id AS world_id, w.number AS world_number
      FROM world_entitlements e
      LEFT JOIN worlds w ON w.entitlement_id = e.id
      ORDER BY e.created_at DESC
    `,
  ).all<EntitlementRow>();
  const activity = await env.DB.prepare(
    `SELECT id, world_id, entitlement_id, event_type, subject_id, occurred_at
     FROM world_activity_events ORDER BY occurred_at DESC LIMIT 100`,
  ).all<{
    id: string; world_id: string | null; entitlement_id: string | null;
    event_type: string; subject_id: string | null; occurred_at: string;
  }>();
  return {
    worlds: await listWorlds(env, null, true),
    entitlements: entitlements.results.map(mapEntitlement),
    pendingNames: await listPendingWorldNameRequests(env),
    recentActivity: activity.results.map((row): WorldActivityEvent => ({
      id: row.id,
      worldId: row.world_id,
      entitlementId: row.entitlement_id,
      eventType: row.event_type,
      subjectId: row.subject_id,
      occurredAt: row.occurred_at,
    })),
  };
}

export const DEFAULT_WORLD_SETTINGS: WorldSettings = {
  buildPolicy: 'request_to_join',
  publishPolicy: 'approval_required',
  claimLimitPerDay: DEFAULT_WORLD_CLAIM_LIMIT,
  publishLimitPerDay: DEFAULT_WORLD_PUBLISH_LIMIT,
};

export { WAMP_PRIME_WORLD_ID };

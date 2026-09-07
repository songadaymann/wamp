import type { D1PreparedStatement, Env } from '../core/types';

export function prepareWorldActivityStatement(
  env: Env,
  params: {
    worldId?: string | null;
    entitlementId?: string | null;
    actorUserId?: string | null;
    eventType: string;
    subjectId?: string | null;
    metadata?: unknown;
    idempotencyKey?: string | null;
    occurredAt: string;
  },
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT OR IGNORE INTO world_activity_events (
      id, world_id, entitlement_id, actor_user_id, event_type,
      subject_id, metadata_json, idempotency_key, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    params.worldId ?? null,
    params.entitlementId ?? null,
    params.actorUserId ?? null,
    params.eventType,
    params.subjectId ?? null,
    params.metadata === undefined ? null : JSON.stringify(params.metadata),
    params.idempotencyKey ?? null,
    params.occurredAt,
  );
}

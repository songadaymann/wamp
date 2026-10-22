import { HttpError } from '../core/http';
import type { D1PreparedStatement, Env } from '../core/types';

export interface AccountSuspension {
  suspendedAt: string | null;
  suspendedReason: string | null;
}

export async function loadAccountSuspension(env: Env, userId: string): Promise<AccountSuspension | null> {
  const row = await env.DB.prepare('SELECT suspended_at, suspended_reason FROM users WHERE id = ? LIMIT 1')
    .bind(userId)
    .first<{ suspended_at: string | null; suspended_reason: string | null }>();
  return row ? { suspendedAt: row.suspended_at, suspendedReason: row.suspended_reason } : null;
}

/** Signed-in writes go through this, for sessions and for API and agent tokens alike. */
export async function assertAccountNotSuspended(env: Env, userId: string): Promise<void> {
  const suspension = await loadAccountSuspension(env, userId);
  if (suspension?.suspendedAt) {
    throw new HttpError(
      403,
      'This account is suspended. You can still play, but saving, publishing and posting are turned off.',
    );
  }
}

export type ModerationAuditAction = 'suspend' | 'unsuspend' | 'revert_edits' | 'room_clear';

export function prepareModerationAuditStatement(
  env: Env,
  entry: {
    action: ModerationAuditAction;
    targetUserId?: string | null;
    targetRoomId?: string | null;
    operatorLabel: string;
    reason?: string | null;
    details?: Record<string, unknown>;
    createdAt: string;
  },
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO moderation_audit
      (action, target_user_id, target_room_id, operator_label, reason, details_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    entry.action,
    entry.targetUserId ?? null,
    entry.targetRoomId ?? null,
    entry.operatorLabel,
    entry.reason ?? null,
    JSON.stringify(entry.details ?? {}),
    entry.createdAt,
  );
}

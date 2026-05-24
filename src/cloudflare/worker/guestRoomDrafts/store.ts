import {
  cloneRoomSnapshot,
  isRoomSnapshotBlank,
  normalizeRoomRecord,
  roomIdFromCoordinates,
  type RoomSnapshot,
} from '../../../persistence/roomModel';
import type { GuestRoomDraftStatus, GuestRoomDraftSummary } from '../../../guestRooms/model';
import type { Env } from '../core/types';

export interface GuestRoomDraftRow {
  id: string;
  guest_user_id: string;
  guest_display_name: string;
  recovery_token_hash: string;
  room_id: string;
  room_x: number;
  room_y: number;
  snapshot_json: string;
  title: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  moderation_status: string;
}

interface UpsertGuestRoomDraftInput {
  guestUserId: string;
  guestDisplayName: string;
  recoveryTokenHash: string;
  snapshot: RoomSnapshot;
  nowIso: string;
}

export async function upsertGuestRoomDraft(
  env: Env,
  input: UpsertGuestRoomDraftInput,
): Promise<GuestRoomDraftSummary> {
  const snapshot = cloneRoomSnapshot(input.snapshot);
  const roomId = roomIdFromCoordinates(snapshot.coordinates);
  const existing = await env.DB.prepare(
    `
      SELECT id
      FROM guest_room_drafts
      WHERE guest_user_id = ?
        AND recovery_token_hash = ?
        AND room_id = ?
        AND status = 'active'
      ORDER BY updated_at DESC
      LIMIT 1
    `,
  )
    .bind(input.guestUserId, input.recoveryTokenHash, roomId)
    .first<{ id: string }>();

  const snapshotJson = JSON.stringify(snapshot);
  const title = snapshot.title?.trim() || null;
  const draftId = existing?.id ?? createDraftId();

  if (existing) {
    await env.DB.batch([
      env.DB.prepare(
        `
          UPDATE guest_room_drafts
          SET guest_display_name = ?,
              room_x = ?,
              room_y = ?,
              snapshot_json = ?,
              title = ?,
              updated_at = ?,
              last_seen_at = ?
          WHERE id = ?
        `,
      ).bind(
          input.guestDisplayName,
          snapshot.coordinates.x,
          snapshot.coordinates.y,
          snapshotJson,
          title,
          input.nowIso,
          input.nowIso,
          draftId,
        ),
    ]);
  } else {
    await env.DB.batch([
      env.DB.prepare(
        `
          INSERT INTO guest_room_drafts (
            id,
            guest_user_id,
            guest_display_name,
            recovery_token_hash,
            room_id,
            room_x,
            room_y,
            snapshot_json,
            title,
            status,
            created_at,
            updated_at,
            last_seen_at,
            moderation_status
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, 'private')
        `,
      ).bind(
          draftId,
          input.guestUserId,
          input.guestDisplayName,
          input.recoveryTokenHash,
          roomId,
          snapshot.coordinates.x,
          snapshot.coordinates.y,
          snapshotJson,
          title,
          input.nowIso,
          input.nowIso,
          input.nowIso,
        ),
    ]);
  }

  const draft = await loadOwnedGuestRoomDraft(env, {
    draftId,
    guestUserId: input.guestUserId,
    recoveryTokenHash: input.recoveryTokenHash,
  });
  if (!draft) {
    throw new Error('Failed to load saved guest room draft.');
  }
  return draft;
}

export async function listOwnedGuestRoomDrafts(
  env: Env,
  guestUserId: string,
  recoveryTokenHash: string,
): Promise<GuestRoomDraftSummary[]> {
  const rows = await env.DB.prepare(
    `
      SELECT
        id,
        guest_user_id,
        guest_display_name,
        recovery_token_hash,
        room_id,
        room_x,
        room_y,
        snapshot_json,
        title,
        status,
        created_at,
        updated_at,
        submitted_at,
        moderation_status
      FROM guest_room_drafts
      WHERE guest_user_id = ?
        AND recovery_token_hash = ?
        AND status = 'active'
        AND hidden_at IS NULL
      ORDER BY updated_at DESC
      LIMIT 10
    `,
  )
    .bind(guestUserId, recoveryTokenHash)
    .all<GuestRoomDraftRow>();

  return rows.results.map(rowToGuestRoomDraftSummary).filter((draft): draft is GuestRoomDraftSummary => draft !== null);
}

export async function listSubmittedGuestRoomDrafts(
  env: Env,
  limit: number,
): Promise<GuestRoomDraftSummary[]> {
  const rows = await env.DB.prepare(
    `
      SELECT
        id,
        guest_user_id,
        guest_display_name,
        recovery_token_hash,
        room_id,
        room_x,
        room_y,
        snapshot_json,
        title,
        status,
        created_at,
        updated_at,
        submitted_at,
        moderation_status
      FROM guest_room_drafts
      WHERE status = 'submitted'
        AND moderation_status = 'public'
        AND hidden_at IS NULL
      ORDER BY COALESCE(submitted_at, updated_at) DESC
      LIMIT ?
    `,
  )
    .bind(limit)
    .all<GuestRoomDraftRow>();

  return rows.results.map(rowToGuestRoomDraftSummary).filter((draft): draft is GuestRoomDraftSummary => draft !== null);
}

export async function loadOwnedGuestRoomDraft(
  env: Env,
  input: {
    draftId: string;
    guestUserId: string;
    recoveryTokenHash: string;
  },
): Promise<GuestRoomDraftSummary | null> {
  const row = await env.DB.prepare(
    `
      SELECT
        id,
        guest_user_id,
        guest_display_name,
        recovery_token_hash,
        room_id,
        room_x,
        room_y,
        snapshot_json,
        title,
        status,
        created_at,
        updated_at,
        submitted_at,
        moderation_status
      FROM guest_room_drafts
      WHERE id = ?
        AND guest_user_id = ?
        AND recovery_token_hash = ?
        AND hidden_at IS NULL
      LIMIT 1
    `,
  )
    .bind(input.draftId, input.guestUserId, input.recoveryTokenHash)
    .first<GuestRoomDraftRow>();

  return rowToGuestRoomDraftSummary(row);
}

export async function submitOwnedGuestRoomDraft(
  env: Env,
  input: {
    draftId: string;
    guestUserId: string;
    recoveryTokenHash: string;
    nowIso: string;
  },
): Promise<GuestRoomDraftSummary | null> {
  await env.DB.batch([
    env.DB.prepare(
      `
        UPDATE guest_room_drafts
        SET status = 'submitted',
            submitted_at = COALESCE(submitted_at, ?),
            updated_at = ?,
            moderation_status = CASE
              WHEN moderation_status = 'private' THEN 'public'
              ELSE moderation_status
            END
        WHERE id = ?
          AND guest_user_id = ?
          AND recovery_token_hash = ?
          AND status = 'active'
          AND hidden_at IS NULL
      `,
    ).bind(input.nowIso, input.nowIso, input.draftId, input.guestUserId, input.recoveryTokenHash),
  ]);

  return loadOwnedGuestRoomDraft(env, input);
}

function rowToGuestRoomDraftSummary(row: GuestRoomDraftRow | null): GuestRoomDraftSummary | null {
  if (!row) {
    return null;
  }

  try {
    const snapshot = normalizeRoomRecord(
      {
        draft: JSON.parse(row.snapshot_json) as unknown,
        versions: [],
        permissions: {
          canSaveDraft: true,
          canPublish: true,
          canRevert: false,
          canMint: false,
        },
      },
      row.room_id,
      { x: row.room_x, y: row.room_y },
    ).draft;
    if (isRoomSnapshotBlank(snapshot)) {
      return null;
    }

    return {
      id: row.id,
      guestUserId: row.guest_user_id,
      guestDisplayName: row.guest_display_name,
      roomId: row.room_id,
      roomX: row.room_x,
      roomY: row.room_y,
      title: row.title,
      status: normalizeStatus(row.status),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      submittedAt: row.submitted_at,
      moderationStatus: row.moderation_status,
      snapshot,
    };
  } catch {
    return null;
  }
}

function normalizeStatus(value: string): GuestRoomDraftStatus {
  if (
    value === 'active' ||
    value === 'claimed' ||
    value === 'submitted' ||
    value === 'discarded' ||
    value === 'hidden'
  ) {
    return value;
  }
  return 'active';
}

function createDraftId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `guest_draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

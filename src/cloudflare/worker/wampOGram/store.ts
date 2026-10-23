import {
  cloneWampOGramRecord,
  normalizeWampOGramDeliveryStatus,
  type WampOGramCreateRequest,
  type WampOGramRecord,
} from '../../../wampOGram/model';
import type { RoomSnapshot, RoomStatus } from '../../../persistence/roomModel';
import { cloneRoomSnapshot } from '../../../persistence/roomModel';
import type { RequestAuth } from '../core/types';
import type { Env } from '../core/types';
import { HttpError } from '../core/http';
import { loadRoomRecord, parseStoredSnapshot } from '../rooms/store';
import { assertCanPersistRoomVideo } from '../rooms/guardrails';

interface WampOGramRow {
  id: string;
  slug: string;
  creator_user_id: string | null;
  creator_display_name: string | null;
  recipient_name: string | null;
  recipient_email: string | null;
  sender_name: string | null;
  title: string | null;
  message: string | null;
  occasion: string | null;
  room_id: string;
  room_x: number;
  room_y: number;
  room_version: number | null;
  room_status: string;
  snapshot_json: string;
  delivery_status: string;
  delivery_error: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function createWampOGram(
  env: Env,
  input: WampOGramCreateRequest,
  auth: RequestAuth,
): Promise<WampOGramRecord> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const slug = createRandomSlug();
  const snapshot = cloneRoomSnapshot(input.roomSnapshot);
  const sourceRoomStatus = normalizeRoomStatus(snapshot.status);
  snapshot.status = sourceRoomStatus;

  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO wamp_o_grams (
          id,
          slug,
          creator_user_id,
          creator_principal_type,
          creator_agent_id,
          creator_display_name,
          recipient_name,
          recipient_email,
          sender_name,
          title,
          message,
          occasion,
          room_id,
          room_x,
          room_y,
          room_version,
          room_status,
          snapshot_json,
          delivery_status,
          delivery_error,
          sent_at,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).bind(
      id,
      slug,
      auth.user.id,
      auth.principal.kind,
      auth.principal.agentId,
      auth.principal.displayName || auth.user.displayName || 'Player',
      input.postcard.recipientName,
      input.postcard.recipientEmail,
      input.postcard.senderName,
      input.postcard.title,
      input.postcard.message,
      input.postcard.occasion,
      snapshot.id,
      snapshot.coordinates.x,
      snapshot.coordinates.y,
      Number.isFinite(snapshot.version) ? snapshot.version : null,
      sourceRoomStatus,
      JSON.stringify(snapshot),
      'draft',
      null,
      null,
      now,
      now,
    ),
  ]);

  const created = await loadWampOGramBySlug(env, slug);
  if (!created) {
    throw new HttpError(500, 'Wamp-O-Gram was created but could not be loaded.');
  }

  return created;
}

/**
 * The room a gram shows. A published room is always shown as it was published, whatever the
 * request sent. A room that is not published yet can be sent only by someone who can save its
 * draft, with the content they sent; a video in it needs the same builder trust as a room draft.
 */
export async function resolveWampOGramRoomSnapshot(
  env: Env,
  requested: RoomSnapshot,
  auth: RequestAuth,
): Promise<RoomSnapshot> {
  const record = await loadRoomRecord(
    env,
    requested.id,
    requested.coordinates,
    auth.user.id,
    auth.user.walletAddress,
    auth.isAdmin,
  );
  if (record.published) {
    return cloneRoomSnapshot(record.published);
  }
  if (!record.permissions.canSaveDraft) {
    throw new HttpError(403, 'Only the room claimer can send this unpublished room as a Wamp-O-Gram.');
  }

  const snapshot = cloneRoomSnapshot(requested);
  snapshot.status = 'draft';
  await assertCanPersistRoomVideo(env, snapshot, null, auth.user.id, auth.source);
  return snapshot;
}

export async function deleteWampOGramBySlug(env: Env, slug: string): Promise<boolean> {
  const row = await env.DB.prepare('DELETE FROM wamp_o_grams WHERE slug = ? RETURNING id')
    .bind(slug)
    .first<{ id: string }>();
  return row !== null;
}

/** Whether a gram exists, without reading its stored room. */
export async function wampOGramExists(env: Env, slug: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT 1 AS found FROM wamp_o_grams WHERE slug = ? LIMIT 1')
    .bind(slug)
    .first<{ found: number }>();
  return row !== null;
}

export async function loadWampOGramBySlug(
  env: Env,
  slug: string,
): Promise<WampOGramRecord | null> {
  const row = await env.DB.prepare(
    `
      SELECT
        id,
        slug,
        creator_user_id,
        creator_display_name,
        recipient_name,
        recipient_email,
        sender_name,
        title,
        message,
        occasion,
        room_id,
        room_x,
        room_y,
        room_version,
        room_status,
        snapshot_json,
        delivery_status,
        delivery_error,
        sent_at,
        created_at,
        updated_at
      FROM wamp_o_grams
      WHERE slug = ?
      LIMIT 1
    `,
  )
    .bind(slug)
    .first<WampOGramRow>();

  return row ? mapWampOGramRow(row) : null;
}

function mapWampOGramRow(row: WampOGramRow): WampOGramRecord {
  const roomSnapshot = parseStoredSnapshot(row.snapshot_json, 'Wamp-O-Gram room snapshot');
  return cloneWampOGramRecord({
    id: row.id,
    slug: row.slug,
    title: row.title,
    recipientName: row.recipient_name,
    recipientEmail: row.recipient_email,
    senderName: row.sender_name,
    message: row.message,
    occasion: row.occasion,
    roomSnapshot,
    sourceRoomId: row.room_id,
    sourceRoomVersion: row.room_version,
    sourceRoomStatus: normalizeRoomStatus(row.room_status),
    creatorUserId: row.creator_user_id,
    creatorDisplayName: row.creator_display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: row.sent_at,
    deliveryStatus: normalizeWampOGramDeliveryStatus(row.delivery_status),
    deliveryError: row.delivery_error,
  });
}

function createRandomSlug(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function normalizeRoomStatus(value: unknown): RoomStatus {
  return value === 'published' ? 'published' : 'draft';
}

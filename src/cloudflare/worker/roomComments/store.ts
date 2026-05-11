import {
  parseRoomId,
  type RoomCoordinates,
} from '../../../persistence/roomModel';
import type {
  AdminRoomCommentRecord,
  RoomCommentRecord,
  RoomCommentStatus,
} from '../../../roomComments/model';
import type { Env, RoomCommentRow } from '../core/types';

export interface RoomCommentTarget {
  roomId: string;
  roomVersion: number;
  roomTitle: string | null;
  coordinates: RoomCoordinates;
  builderUserId: string | null;
  builderDisplayName: string | null;
  builderEmail: string | null;
}

export async function loadRoomCommentTarget(
  env: Env,
  roomId: string,
  coordinates: RoomCoordinates,
  roomVersion: number | null,
): Promise<RoomCommentTarget | null> {
  const row = await env.DB.prepare(
    `
      SELECT
        rooms.id,
        rooms.x,
        rooms.y,
        rooms.published_title,
        json_extract(rooms.published_json, '$.version') AS current_version,
        room_versions.title AS version_title,
        room_versions.published_by_user_id,
        room_versions.published_by_display_name,
        rooms.claimer_user_id,
        rooms.claimer_display_name,
        rooms.last_published_by_user_id,
        rooms.last_published_by_display_name,
        builder.email AS builder_email,
        builder.display_name AS builder_user_display_name
      FROM rooms
      LEFT JOIN room_versions
        ON room_versions.room_id = rooms.id
       AND room_versions.version = COALESCE(?, json_extract(rooms.published_json, '$.version'))
      LEFT JOIN users AS builder
        ON builder.id = COALESCE(
          room_versions.published_by_user_id,
          rooms.claimer_user_id,
          rooms.last_published_by_user_id
        )
      WHERE (rooms.id = ? OR (rooms.x = ? AND rooms.y = ?))
        AND rooms.published_json IS NOT NULL
      LIMIT 1
    `,
  )
    .bind(roomVersion, roomId, coordinates.x, coordinates.y)
    .first<{
      id: string;
      x: number;
      y: number;
      published_title: string | null;
      current_version: number | string | null;
      version_title: string | null;
      published_by_user_id: string | null;
      published_by_display_name: string | null;
      claimer_user_id: string | null;
      claimer_display_name: string | null;
      last_published_by_user_id: string | null;
      last_published_by_display_name: string | null;
      builder_email: string | null;
      builder_user_display_name: string | null;
    }>();

  if (!row) {
    return null;
  }

  const currentVersion = Number(row.current_version ?? 0);
  if (!Number.isInteger(currentVersion) || currentVersion <= 0) {
    return null;
  }

  if (roomVersion !== null && roomVersion !== currentVersion) {
    return null;
  }

  const builderUserId =
    row.published_by_user_id ?? row.claimer_user_id ?? row.last_published_by_user_id;
  const builderDisplayName =
    row.published_by_display_name
    ?? row.builder_user_display_name
    ?? row.claimer_display_name
    ?? row.last_published_by_display_name;

  return {
    roomId: row.id,
    roomVersion: currentVersion,
    roomTitle: row.version_title ?? row.published_title ?? null,
    coordinates: { x: row.x, y: row.y },
    builderUserId,
    builderDisplayName,
    builderEmail: row.builder_email,
  };
}

export async function listApprovedRoomComments(
  env: Env,
  target: RoomCommentTarget,
  limit: number,
): Promise<RoomCommentRecord[]> {
  const result = await env.DB.prepare(
    `
      SELECT *
      FROM room_comments
      WHERE room_id = ?
        AND room_version = ?
        AND status = 'approved'
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `,
  )
    .bind(target.roomId, target.roomVersion, limit)
    .all<RoomCommentRow>();

  return result.results.map((row) => mapPublicRoomCommentRow(row, target.coordinates));
}

export async function createRoomComment(
  env: Env,
  input: {
    target: RoomCommentTarget;
    localX: number;
    localY: number;
    body: string;
    authorUserId: string;
    authorDisplayName: string;
    ipHash: string | null;
    userAgent: string | null;
    createdAt: string;
  },
): Promise<RoomCommentRecord> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `
      INSERT INTO room_comments (
        id,
        room_id,
        room_version,
        room_x,
        room_y,
        body,
        author_user_id,
        author_display_name,
        builder_user_id,
        builder_display_name,
        status,
        created_at,
        reviewed_at,
        reviewed_by_label,
        review_reason,
        notified_at,
        notification_error,
        ip_hash,
        user_agent
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', ?, NULL, NULL, NULL, NULL, NULL, ?, ?)
    `,
  )
    .bind(
      id,
      input.target.roomId,
      input.target.roomVersion,
      input.localX,
      input.localY,
      input.body,
      input.authorUserId,
      input.authorDisplayName,
      input.target.builderUserId,
      input.target.builderDisplayName,
      input.createdAt,
      input.ipHash,
      input.userAgent,
    )
    .all();

  return {
    id,
    roomId: input.target.roomId,
    roomVersion: input.target.roomVersion,
    roomCoordinates: { ...input.target.coordinates },
    position: { x: input.localX, y: input.localY },
    body: input.body,
    authorUserId: input.authorUserId,
    authorDisplayName: input.authorDisplayName,
    createdAt: input.createdAt,
  };
}

export async function countRecentRoomCommentsForUser(
  env: Env,
  userId: string,
  sinceIso: string,
): Promise<number> {
  const row = await env.DB.prepare(
    `
      SELECT COUNT(*) AS count
      FROM room_comments
      WHERE author_user_id = ?
        AND created_at >= ?
    `,
  )
    .bind(userId, sinceIso)
    .first<{ count: number | string | null }>();

  return Number(row?.count ?? 0);
}

export async function countRecentRoomCommentsForUserRoom(
  env: Env,
  userId: string,
  roomId: string,
  roomVersion: number,
  sinceIso: string,
): Promise<number> {
  const row = await env.DB.prepare(
    `
      SELECT COUNT(*) AS count
      FROM room_comments
      WHERE author_user_id = ?
        AND room_id = ?
        AND room_version = ?
        AND created_at >= ?
    `,
  )
    .bind(userId, roomId, roomVersion, sinceIso)
    .first<{ count: number | string | null }>();

  return Number(row?.count ?? 0);
}

export async function listAdminRoomComments(
  env: Env,
  status: RoomCommentStatus | 'all',
  limit: number,
): Promise<AdminRoomCommentRecord[]> {
  const query =
    status === 'all'
      ? `
        SELECT
          room_comments.*,
          author.email AS author_email,
          builder.email AS builder_email,
          rooms.published_title AS room_title
        FROM room_comments
        LEFT JOIN users AS author ON author.id = room_comments.author_user_id
        LEFT JOIN users AS builder ON builder.id = room_comments.builder_user_id
        LEFT JOIN rooms ON rooms.id = room_comments.room_id
        ORDER BY room_comments.created_at DESC, room_comments.id DESC
        LIMIT ?
      `
      : `
        SELECT
          room_comments.*,
          author.email AS author_email,
          builder.email AS builder_email,
          rooms.published_title AS room_title
        FROM room_comments
        LEFT JOIN users AS author ON author.id = room_comments.author_user_id
        LEFT JOIN users AS builder ON builder.id = room_comments.builder_user_id
        LEFT JOIN rooms ON rooms.id = room_comments.room_id
        WHERE room_comments.status = ?
        ORDER BY room_comments.created_at DESC, room_comments.id DESC
        LIMIT ?
      `;

  const result =
    status === 'all'
      ? await env.DB.prepare(query).bind(limit).all<AdminRoomCommentJoinRow>()
      : await env.DB.prepare(query).bind(status, limit).all<AdminRoomCommentJoinRow>();

  return result.results.map(mapAdminRoomCommentRow);
}

export async function loadAdminRoomComment(
  env: Env,
  commentId: string,
): Promise<AdminRoomCommentRecord | null> {
  const row = await env.DB.prepare(
    `
      SELECT
        room_comments.*,
        author.email AS author_email,
        builder.email AS builder_email,
        rooms.published_title AS room_title
      FROM room_comments
      LEFT JOIN users AS author ON author.id = room_comments.author_user_id
      LEFT JOIN users AS builder ON builder.id = room_comments.builder_user_id
      LEFT JOIN rooms ON rooms.id = room_comments.room_id
      WHERE room_comments.id = ?
      LIMIT 1
    `,
  )
    .bind(commentId)
    .first<AdminRoomCommentJoinRow>();

  return row ? mapAdminRoomCommentRow(row) : null;
}

export async function reviewRoomComment(
  env: Env,
  commentId: string,
  status: Extract<RoomCommentStatus, 'approved' | 'rejected'>,
  input: {
    reviewedAt: string;
    reviewedByLabel: string;
    reviewReason: string | null;
  },
): Promise<void> {
  await env.DB.prepare(
    `
      UPDATE room_comments
      SET
        status = ?,
        reviewed_at = ?,
        reviewed_by_label = ?,
        review_reason = ?,
        notification_error = CASE WHEN ? = 'approved' THEN NULL ELSE notification_error END
      WHERE id = ?
    `,
  )
    .bind(
      status,
      input.reviewedAt,
      input.reviewedByLabel,
      input.reviewReason,
      status,
      commentId,
    )
    .all();
}

export async function markRoomCommentNotificationSent(
  env: Env,
  commentId: string,
  notifiedAt: string,
): Promise<void> {
  await env.DB.prepare(
    `
      UPDATE room_comments
      SET notified_at = ?, notification_error = NULL
      WHERE id = ?
    `,
  )
    .bind(notifiedAt, commentId)
    .all();
}

export async function markRoomCommentNotificationError(
  env: Env,
  commentId: string,
  error: string,
): Promise<void> {
  await env.DB.prepare(
    `
      UPDATE room_comments
      SET notification_error = ?
      WHERE id = ?
    `,
  )
    .bind(error.slice(0, 500), commentId)
    .all();
}

interface AdminRoomCommentJoinRow extends RoomCommentRow {
  author_email: string | null;
  builder_email: string | null;
  room_title: string | null;
}

function mapPublicRoomCommentRow(
  row: RoomCommentRow,
  coordinates: RoomCoordinates,
): RoomCommentRecord {
  return {
    id: row.id,
    roomId: row.room_id,
    roomVersion: Number(row.room_version),
    roomCoordinates: { ...coordinates },
    position: {
      x: Number(row.room_x),
      y: Number(row.room_y),
    },
    body: row.body,
    authorUserId: row.author_user_id,
    authorDisplayName: row.author_display_name,
    createdAt: row.created_at,
  };
}

function mapAdminRoomCommentRow(row: AdminRoomCommentJoinRow): AdminRoomCommentRecord {
  const coordinates = parseRoomId(row.room_id) ?? { x: 0, y: 0 };
  return {
    ...mapPublicRoomCommentRow(row, coordinates),
    authorEmail: row.author_email,
    builderUserId: row.builder_user_id,
    builderDisplayName: row.builder_display_name,
    builderEmail: row.builder_email,
    roomTitle: row.room_title,
    status: row.status,
    reviewedAt: row.reviewed_at,
    reviewedByLabel: row.reviewed_by_label,
    reviewReason: row.review_reason,
    notifiedAt: row.notified_at,
    notificationError: row.notification_error,
  };
}

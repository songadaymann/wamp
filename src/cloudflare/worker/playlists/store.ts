import type { AuthUser } from '../../../auth/model';
import type {
  RoomPlaylistExpandedRoomTarget,
  RoomPlaylistItem,
  RoomPlaylistResponse,
  RoomPlaylistSummary,
} from '../../../playlists/model';
import type { ResolvedExpandedRoomTarget } from '../../../expandedRooms/model';
import {
  derivePlaylistSlugBase,
  normalizePlaylistDescription,
  normalizePlaylistSlug,
  normalizePlaylistTitle,
  validatePlaylistDescription,
  validatePlaylistSlug,
  validatePlaylistTitle,
} from '../../../playlists/model';
import type { RoomCoordinates } from '../../../persistence/roomModel';
import type { Env } from '../core/types';
import { HttpError } from '../core/http';
import {
  loadPublishedExpandedRoomMembershipsForRoomIds,
  resolveExpandedRoomAtCoordinates,
} from '../expandedRooms/store';
import { parseStoredSnapshot } from '../rooms/store';

interface PlaylistRow {
  id: string;
  owner_user_id: string;
  owner_display_name: string | null;
  owner_username: string | null;
  title: string;
  slug: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  room_count: number | string | null;
}

interface PlaylistItemRow {
  id: string;
  room_id: string;
  room_version: number | string | null;
  position: number | string | null;
  added_at: string;
  room_x: number | string | null;
  room_y: number | string | null;
  version_title: string | null;
  snapshot_json: string;
  version_created_at: string | null;
}

interface PlaylistCountItemRow {
  playlist_id: string;
  room_id: string;
  room_version: number | string | null;
}

interface PublishedRoomVersionRow {
  room_id: string;
  room_version: number | string | null;
  room_x: number | string | null;
  room_y: number | string | null;
}

const PROFILE_PLAYLIST_LIMIT = 12;
const MY_PLAYLIST_LIMIT = 50;

export async function loadPublicPlaylistSummariesForUser(
  env: Env,
  userId: string,
  limit: number = PROFILE_PLAYLIST_LIMIT,
): Promise<RoomPlaylistSummary[]> {
  const rows = await env.DB.prepare(
    `
      SELECT
        room_playlists.id,
        room_playlists.owner_user_id,
        users.display_name AS owner_display_name,
        users.username AS owner_username,
        room_playlists.title,
        room_playlists.slug,
        room_playlists.description,
        room_playlists.created_at,
        room_playlists.updated_at,
        COUNT(room_playlist_items.id) AS room_count
      FROM room_playlists
      INNER JOIN users
        ON users.id = room_playlists.owner_user_id
      LEFT JOIN room_playlist_items
        ON room_playlist_items.playlist_id = room_playlists.id
      WHERE room_playlists.owner_user_id = ?
        AND room_playlists.visibility = 'public'
      GROUP BY
        room_playlists.id,
        room_playlists.owner_user_id,
        users.display_name,
        users.username,
        room_playlists.title,
        room_playlists.slug,
        room_playlists.description,
        room_playlists.created_at,
        room_playlists.updated_at
      ORDER BY room_playlists.updated_at DESC, room_playlists.created_at DESC
      LIMIT ?
    `
  )
    .bind(userId, limit)
    .all<PlaylistRow>();

  return hydratePlaylistSummaryCounts(env, rows.results.map(mapPlaylistSummaryRow));
}

export async function loadMyPlaylistSummaries(
  env: Env,
  userId: string,
): Promise<RoomPlaylistSummary[]> {
  return loadPublicPlaylistSummariesForUser(env, userId, MY_PLAYLIST_LIMIT);
}

export async function loadPlaylistBySlug(
  env: Env,
  slug: string,
  viewerUserId: string | null,
): Promise<RoomPlaylistResponse | null> {
  const normalizedSlug = normalizePlaylistSlug(slug);
  if (validatePlaylistSlug(normalizedSlug)) {
    return null;
  }

  const row = await env.DB.prepare(
    `
      SELECT
        room_playlists.id,
        room_playlists.owner_user_id,
        users.display_name AS owner_display_name,
        users.username AS owner_username,
        room_playlists.title,
        room_playlists.slug,
        room_playlists.description,
        room_playlists.created_at,
        room_playlists.updated_at,
        COUNT(room_playlist_items.id) AS room_count
      FROM room_playlists
      INNER JOIN users
        ON users.id = room_playlists.owner_user_id
      LEFT JOIN room_playlist_items
        ON room_playlist_items.playlist_id = room_playlists.id
      WHERE room_playlists.slug = ?
        AND room_playlists.visibility = 'public'
      GROUP BY
        room_playlists.id,
        room_playlists.owner_user_id,
        users.display_name,
        users.username,
        room_playlists.title,
        room_playlists.slug,
        room_playlists.description,
        room_playlists.created_at,
        room_playlists.updated_at
      LIMIT 1
    `
  )
    .bind(normalizedSlug)
    .first<PlaylistRow>();

  if (!row) {
    return null;
  }

  const summary = mapPlaylistSummaryRow(row);
  const items = await loadPlaylistItems(env, summary.id);
  return {
    ...summary,
    roomCount: items.length,
    viewerCanEdit: viewerUserId === summary.ownerUserId,
    items,
  };
}

export async function loadPlaylistByIdForOwner(
  env: Env,
  playlistId: string,
  ownerUserId: string,
): Promise<RoomPlaylistResponse | null> {
  const row = await env.DB.prepare(
    `
      SELECT
        room_playlists.id,
        room_playlists.owner_user_id,
        users.display_name AS owner_display_name,
        users.username AS owner_username,
        room_playlists.title,
        room_playlists.slug,
        room_playlists.description,
        room_playlists.created_at,
        room_playlists.updated_at,
        COUNT(room_playlist_items.id) AS room_count
      FROM room_playlists
      INNER JOIN users
        ON users.id = room_playlists.owner_user_id
      LEFT JOIN room_playlist_items
        ON room_playlist_items.playlist_id = room_playlists.id
      WHERE room_playlists.id = ?
        AND room_playlists.owner_user_id = ?
        AND room_playlists.visibility = 'public'
      GROUP BY
        room_playlists.id,
        room_playlists.owner_user_id,
        users.display_name,
        users.username,
        room_playlists.title,
        room_playlists.slug,
        room_playlists.description,
        room_playlists.created_at,
        room_playlists.updated_at
      LIMIT 1
    `
  )
    .bind(playlistId, ownerUserId)
    .first<PlaylistRow>();

  if (!row) {
    return null;
  }

  const summary = mapPlaylistSummaryRow(row);
  const items = await loadPlaylistItems(env, summary.id);
  return {
    ...summary,
    roomCount: items.length,
    viewerCanEdit: true,
    items,
  };
}

export async function createRoomPlaylist(
  env: Env,
  owner: AuthUser,
  input: { title?: unknown; slug?: unknown; description?: unknown },
): Promise<RoomPlaylistResponse> {
  const title = normalizePlaylistTitle(input.title);
  const titleValidation = validatePlaylistTitle(title);
  if (titleValidation) {
    throw new HttpError(400, titleValidation);
  }

  const description = normalizePlaylistDescription(input.description);
  const descriptionValidation = validatePlaylistDescription(description);
  if (descriptionValidation) {
    throw new HttpError(400, descriptionValidation);
  }

  const requestedSlug =
    typeof input.slug === 'string' && input.slug.trim()
      ? normalizePlaylistSlug(input.slug)
      : derivePlaylistSlugBase(title);
  const slugValidation = validatePlaylistSlug(requestedSlug);
  if (slugValidation) {
    throw new HttpError(400, slugValidation);
  }

  const slug = await claimUniquePlaylistSlug(env, requestedSlug);
  const now = new Date().toISOString();
  const playlistId = crypto.randomUUID();
  await env.DB.prepare(
    `
      INSERT INTO room_playlists (
        id,
        owner_user_id,
        title,
        slug,
        description,
        visibility,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, 'public', ?, ?)
    `
  )
    .bind(playlistId, owner.id, title, slug, description, now, now)
    .all();

  const playlist = await loadPlaylistByIdForOwner(env, playlistId, owner.id);
  if (!playlist) {
    throw new HttpError(500, 'Playlist was created but could not be loaded.');
  }

  return playlist;
}

export async function updateRoomPlaylist(
  env: Env,
  owner: AuthUser,
  playlistId: string,
  input: { title?: unknown; slug?: unknown; description?: unknown },
): Promise<RoomPlaylistResponse> {
  const existing = await loadPlaylistByIdForOwner(env, playlistId, owner.id);
  if (!existing) {
    throw new HttpError(404, 'Playlist not found.');
  }

  const title =
    input.title === undefined
      ? existing.title
      : normalizePlaylistTitle(input.title);
  const titleValidation = validatePlaylistTitle(title);
  if (titleValidation) {
    throw new HttpError(400, titleValidation);
  }

  const description =
    input.description === undefined
      ? existing.description
      : normalizePlaylistDescription(input.description);
  const descriptionValidation = validatePlaylistDescription(description);
  if (descriptionValidation) {
    throw new HttpError(400, descriptionValidation);
  }

  const requestedSlug =
    input.slug === undefined || input.slug === null || String(input.slug).trim() === ''
      ? existing.slug
      : normalizePlaylistSlug(input.slug);
  const slugValidation = validatePlaylistSlug(requestedSlug);
  if (slugValidation) {
    throw new HttpError(400, slugValidation);
  }
  const slug =
    requestedSlug === existing.slug
      ? existing.slug
      : await claimUniquePlaylistSlug(env, requestedSlug);
  const now = new Date().toISOString();

  await env.DB.prepare(
    `
      UPDATE room_playlists
      SET title = ?, slug = ?, description = ?, updated_at = ?
      WHERE id = ?
        AND owner_user_id = ?
    `
  )
    .bind(title, slug, description, now, playlistId, owner.id)
    .all();

  const playlist = await loadPlaylistByIdForOwner(env, playlistId, owner.id);
  if (!playlist) {
    throw new HttpError(500, 'Playlist was updated but could not be loaded.');
  }

  return playlist;
}

export async function deleteRoomPlaylist(
  env: Env,
  ownerUserId: string,
  playlistId: string,
): Promise<void> {
  await requirePlaylistOwner(env, playlistId, ownerUserId);
  await env.DB.prepare(
    `
      DELETE FROM room_playlists
      WHERE id = ?
        AND owner_user_id = ?
    `
  )
    .bind(playlistId, ownerUserId)
    .all();
}

export async function addRoomToPlaylist(
  env: Env,
  owner: AuthUser,
  playlistId: string,
  input: { roomId?: unknown; roomCoordinates?: unknown; roomVersion?: unknown },
): Promise<RoomPlaylistResponse> {
  await requirePlaylistOwner(env, playlistId, owner.id);
  const roomId = normalizeRoomId(input.roomId);
  const roomVersion = normalizePositiveVersion(input.roomVersion);
  const roomCoordinates = normalizeCoordinates(input.roomCoordinates);
  const room = await loadPublishedRoomVersionForPlaylist(
    env,
    roomId,
    roomCoordinates,
    roomVersion,
  );
  if (!room) {
    throw new HttpError(404, 'Published room version not found.');
  }

  const storedRoomCoordinates = {
    x: parseRowNumber(room.room_x),
    y: parseRowNumber(room.room_y),
  };
  const storedRoomVersion = parseRowNumber(room.room_version);
  const expandedRoomTarget = await loadPlaylistExpandedRoomTargetForCell(
    env,
    room.room_id,
    storedRoomCoordinates,
    storedRoomVersion,
  );
  if (await playlistContainsPlayableTarget(env, playlistId, expandedRoomTarget, {
    roomId: room.room_id,
    roomVersion: storedRoomVersion,
  })) {
    const playlist = await loadPlaylistByIdForOwner(env, playlistId, owner.id);
    if (!playlist) {
      throw new HttpError(500, 'Playlist duplicate was skipped but playlist reload failed.');
    }
    return playlist;
  }

  const now = new Date().toISOString();
  const itemId = crypto.randomUUID();
  const position = await loadNextPlaylistPosition(env, playlistId);
  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT OR IGNORE INTO room_playlist_items (
          id,
          playlist_id,
          room_id,
          room_version,
          position,
          added_by_user_id,
          added_at,
          note
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
      `
    ).bind(itemId, playlistId, room.room_id, storedRoomVersion, position, owner.id, now),
    env.DB.prepare(
      `
        UPDATE room_playlists
        SET updated_at = ?
        WHERE id = ?
          AND owner_user_id = ?
      `
    ).bind(now, playlistId, owner.id),
  ]);

  const playlist = await loadPlaylistByIdForOwner(env, playlistId, owner.id);
  if (!playlist) {
    throw new HttpError(500, 'Playlist item was saved but playlist reload failed.');
  }

  return playlist;
}

export async function removeRoomFromPlaylist(
  env: Env,
  ownerUserId: string,
  playlistId: string,
  itemId: string,
): Promise<RoomPlaylistResponse> {
  await requirePlaylistOwner(env, playlistId, ownerUserId);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `
        DELETE FROM room_playlist_items
        WHERE id = ?
          AND playlist_id = ?
      `
    ).bind(itemId, playlistId),
    env.DB.prepare(
      `
        UPDATE room_playlists
        SET updated_at = ?
        WHERE id = ?
          AND owner_user_id = ?
      `
    ).bind(now, playlistId, ownerUserId),
  ]);

  const playlist = await loadPlaylistByIdForOwner(env, playlistId, ownerUserId);
  if (!playlist) {
    throw new HttpError(500, 'Playlist item was removed but playlist reload failed.');
  }

  return playlist;
}

async function loadPlaylistItems(env: Env, playlistId: string): Promise<RoomPlaylistItem[]> {
  const rows = await env.DB.prepare(
    `
      SELECT
        room_playlist_items.id,
        room_playlist_items.room_id,
        room_playlist_items.room_version,
        room_playlist_items.position,
        room_playlist_items.added_at,
        rooms.x AS room_x,
        rooms.y AS room_y,
        room_versions.title AS version_title,
        room_versions.snapshot_json,
        room_versions.created_at AS version_created_at
      FROM room_playlist_items
      INNER JOIN rooms
        ON rooms.id = room_playlist_items.room_id
      INNER JOIN room_versions
        ON room_versions.room_id = room_playlist_items.room_id
       AND room_versions.version = room_playlist_items.room_version
      WHERE room_playlist_items.playlist_id = ?
      ORDER BY room_playlist_items.position ASC, room_playlist_items.added_at ASC
    `
  )
    .bind(playlistId)
    .all<PlaylistItemRow>();

  const items: RoomPlaylistItem[] = [];
  for (const row of rows.results) {
    try {
      items.push(mapPlaylistItemRow(row));
    } catch (error) {
      console.warn('Skipping malformed playlist room item.', row.id, error);
    }
  }
  return hydratePlaylistItemsWithExpandedRooms(env, items);
}

async function hydratePlaylistSummaryCounts(
  env: Env,
  summaries: RoomPlaylistSummary[],
): Promise<RoomPlaylistSummary[]> {
  if (!isExpandedRoomsEnabled(env) || summaries.length === 0) {
    return summaries;
  }

  const countRows = await loadPlaylistCountItemRows(env, summaries.map((summary) => summary.id));
  const memberships = await loadPublishedExpandedRoomMembershipsForRoomIds(
    env,
    countRows.map((row) => row.room_id),
  );
  const membershipByRoomId = new Map(
    memberships
      .filter((membership) => membership.cellCount > 1)
      .map((membership) => [membership.roomId, membership] as const),
  );
  const playableTargetKeysByPlaylistId = new Map<string, Set<string>>();
  for (const row of countRows) {
    const roomVersion = normalizeResolvedRoomVersion(row.room_version);
    if (roomVersion === null) {
      continue;
    }

    const membership = membershipByRoomId.get(row.room_id);
    const belongsToCurrentExpandedTarget = membership?.roomVersion === roomVersion;
    const playableTargetKey = belongsToCurrentExpandedTarget
      ? `expanded-room:${membership.expandedRoomId}:published`
      : getStandalonePlaylistTargetKey(row.room_id, roomVersion);
    let playlistTargetKeys = playableTargetKeysByPlaylistId.get(row.playlist_id);
    if (!playlistTargetKeys) {
      playlistTargetKeys = new Set<string>();
      playableTargetKeysByPlaylistId.set(row.playlist_id, playlistTargetKeys);
    }
    playlistTargetKeys.add(playableTargetKey);
  }

  return summaries.map((summary) => ({
    ...summary,
    roomCount: playableTargetKeysByPlaylistId.get(summary.id)?.size ?? 0,
  }));
}

async function loadPlaylistCountItemRows(
  env: Env,
  playlistIds: string[],
): Promise<PlaylistCountItemRow[]> {
  if (playlistIds.length === 0) {
    return [];
  }

  const placeholders = playlistIds.map(() => '?').join(', ');
  const result = await env.DB.prepare(
    `
      SELECT
        room_playlist_items.playlist_id,
        room_playlist_items.room_id,
        room_playlist_items.room_version
      FROM room_playlist_items
      INNER JOIN room_versions
        ON room_versions.room_id = room_playlist_items.room_id
       AND room_versions.version = room_playlist_items.room_version
      WHERE room_playlist_items.playlist_id IN (${placeholders})
      ORDER BY room_playlist_items.playlist_id ASC, room_playlist_items.position ASC, room_playlist_items.added_at ASC
    `,
  )
    .bind(...playlistIds)
    .all<PlaylistCountItemRow>();

  return result.results;
}

async function loadPublishedRoomVersionForPlaylist(
  env: Env,
  roomId: string,
  coordinates: RoomCoordinates,
  roomVersion: number,
): Promise<PublishedRoomVersionRow | null> {
  return env.DB.prepare(
    `
      SELECT
        rooms.id AS room_id,
        room_versions.version AS room_version,
        rooms.x AS room_x,
        rooms.y AS room_y
      FROM rooms
      INNER JOIN room_versions
        ON room_versions.room_id = rooms.id
       AND room_versions.version = ?
      WHERE rooms.id = ?
        AND rooms.x = ?
        AND rooms.y = ?
        AND rooms.published_json IS NOT NULL
      LIMIT 1
    `
  )
    .bind(roomVersion, roomId, coordinates.x, coordinates.y)
    .first<PublishedRoomVersionRow>();
}

async function requirePlaylistOwner(
  env: Env,
  playlistId: string,
  ownerUserId: string,
): Promise<void> {
  const row = await env.DB.prepare(
    `
      SELECT 1 AS found
      FROM room_playlists
      WHERE id = ?
        AND owner_user_id = ?
      LIMIT 1
    `
  )
    .bind(playlistId, ownerUserId)
    .first<{ found: number | string | null }>();

  if (Number(row?.found ?? 0) !== 1) {
    throw new HttpError(404, 'Playlist not found.');
  }
}

async function claimUniquePlaylistSlug(env: Env, requestedSlug: string): Promise<string> {
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const candidate =
      suffix === 0
        ? requestedSlug
        : `${requestedSlug.slice(0, Math.max(1, 47 - String(suffix).length))}-${suffix}`;
    const existing = await env.DB.prepare(
      `
        SELECT 1 AS found
        FROM room_playlists
        WHERE slug = ?
        LIMIT 1
      `
    )
      .bind(candidate)
      .first<{ found: number | string | null }>();
    if (Number(existing?.found ?? 0) !== 1) {
      return candidate;
    }
  }

  throw new HttpError(409, 'Could not find an available playlist URL name.');
}

async function loadNextPlaylistPosition(env: Env, playlistId: string): Promise<number> {
  const row = await env.DB.prepare(
    `
      SELECT COALESCE(MAX(position), -1) + 1 AS next_position
      FROM room_playlist_items
      WHERE playlist_id = ?
    `
  )
    .bind(playlistId)
    .first<{ next_position: number | string | null }>();

  return parseRowNumber(row?.next_position);
}

function mapPlaylistSummaryRow(row: PlaylistRow): RoomPlaylistSummary {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    ownerDisplayName: row.owner_display_name?.trim() || 'Unknown player',
    ownerUsername: row.owner_username?.trim() || null,
    title: row.title,
    slug: row.slug,
    description: row.description,
    roomCount: parseRowNumber(row.room_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPlaylistItemRow(row: PlaylistItemRow): RoomPlaylistItem {
  const snapshot = parseStoredSnapshot(row.snapshot_json, 'playlist room');
  const roomVersion = parseRowNumber(row.room_version);
  return {
    id: row.id,
    roomId: row.room_id,
    roomCoordinates: {
      x: parseRowNumber(row.room_x),
      y: parseRowNumber(row.room_y),
    },
    roomTitle: row.version_title?.trim() || snapshot.title?.trim() || null,
    roomVersion,
    goalType: snapshot.goal?.type ?? null,
    publishedAt: snapshot.publishedAt ?? row.version_created_at,
    position: parseRowNumber(row.position),
    addedAt: row.added_at,
    expandedRoom: null,
  };
}

async function hydratePlaylistItemsWithExpandedRooms(
  env: Env,
  items: RoomPlaylistItem[],
): Promise<RoomPlaylistItem[]> {
  const hydrated: RoomPlaylistItem[] = [];
  const seenPlayableTargetKeys = new Set<string>();
  for (const item of items) {
    const expandedRoomTarget = await loadPlaylistExpandedRoomTargetForCell(
      env,
      item.roomId,
      item.roomCoordinates,
      item.roomVersion,
    );
    const expandedRoom = expandedRoomTarget
      ? mapExpandedRoomTargetForPlaylistItem(expandedRoomTarget, item.roomCoordinates)
      : null;
    const playableTargetKey = expandedRoomTarget
      ? getExpandedRoomPlaylistTargetKey(expandedRoomTarget)
      : getStandalonePlaylistTargetKey(item.roomId, item.roomVersion);
    if (seenPlayableTargetKeys.has(playableTargetKey)) {
      continue;
    }
    seenPlayableTargetKeys.add(playableTargetKey);
    hydrated.push({
      ...item,
      roomTitle: expandedRoom?.title?.trim() || item.roomTitle,
      goalType: expandedRoomTarget?.goalType ?? item.goalType,
      publishedAt: expandedRoomTarget?.publishedAt ?? item.publishedAt,
      expandedRoom,
    });
  }
  return hydrated;
}

async function loadPlaylistExpandedRoomTargetForCell(
  env: Env,
  roomId: string,
  coordinates: RoomCoordinates,
  roomVersion: number,
): Promise<ResolvedExpandedRoomTarget | null> {
  if (!isExpandedRoomsEnabled(env)) {
    return null;
  }

  const target = await resolveExpandedRoomAtCoordinates(env, coordinates);
  if (!target || target.cellCount <= 1) {
    return null;
  }

  const containsPinnedCell = target.cells.some(
    (cell) => cell.roomId === roomId && normalizeResolvedRoomVersion(cell.roomVersion) === roomVersion,
  );
  return containsPinnedCell ? target : null;
}

async function playlistContainsPlayableTarget(
  env: Env,
  playlistId: string,
  expandedRoomTarget: ResolvedExpandedRoomTarget | null,
  fallback: { roomId: string; roomVersion: number },
): Promise<boolean> {
  const cells = expandedRoomTarget
    ? getExpandedRoomPlaylistCells(expandedRoomTarget)
    : [{ roomId: fallback.roomId, roomVersion: fallback.roomVersion }];
  const predicate = buildPlaylistItemTargetPredicate(cells);
  const row = await env.DB.prepare(
    `
      SELECT 1 AS found
      FROM room_playlist_items
      WHERE playlist_id = ?
        AND (${predicate.sql})
      LIMIT 1
    `,
  )
    .bind(playlistId, ...predicate.bindings)
    .first<{ found: number | string | null }>();

  return Number(row?.found ?? 0) === 1;
}

function mapExpandedRoomTargetForPlaylistItem(
  target: ResolvedExpandedRoomTarget,
  focusedCoordinates: RoomCoordinates,
): RoomPlaylistExpandedRoomTarget {
  return {
    expandedRoomId: target.expandedRoomId,
    expandedRoomVersion: target.version,
    title: target.title,
    source: target.source,
    legacyCourseId: target.legacyCourseId,
    cellCount: target.cellCount,
    anchorCoordinates: { ...target.anchorCoordinates },
    focusedCoordinates: { ...focusedCoordinates },
  };
}

function getExpandedRoomPlaylistCells(
  target: ResolvedExpandedRoomTarget,
): Array<{ roomId: string; roomVersion: number }> {
  return target.cells
    .map((cell) => ({
      roomId: cell.roomId,
      roomVersion: normalizeResolvedRoomVersion(cell.roomVersion),
    }))
    .filter((cell): cell is { roomId: string; roomVersion: number } => cell.roomVersion !== null);
}

function buildPlaylistItemTargetPredicate(cells: Array<{ roomId: string; roomVersion: number }>): {
  sql: string;
  bindings: Array<string | number>;
} {
  const safeCells = cells.length > 0
    ? cells
    : [{ roomId: '', roomVersion: 0 }];
  return {
    sql: safeCells.map(() => '(room_id = ? AND room_version = ?)').join(' OR '),
    bindings: safeCells.flatMap((cell) => [cell.roomId, cell.roomVersion]),
  };
}

function getExpandedRoomPlaylistTargetKey(target: ResolvedExpandedRoomTarget): string {
  return `expanded-room:${target.expandedRoomId}:v${target.version ?? 'published'}`;
}

function getStandalonePlaylistTargetKey(roomId: string, roomVersion: number): string {
  return `room:${roomId}:v${roomVersion}`;
}

function normalizeResolvedRoomVersion(value: unknown): number | null {
  const version = Number(value);
  return Number.isInteger(version) && version > 0 ? version : null;
}

function isExpandedRoomsEnabled(env: Env): boolean {
  const raw = env.EXPANDED_ROOMS_ENABLED?.trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'off';
}

function normalizeRoomId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, 'roomId is required.');
  }
  return value.trim();
}

function normalizePositiveVersion(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, 'roomVersion must be a positive integer.');
  }
  return parsed;
}

function normalizeCoordinates(value: unknown): RoomCoordinates {
  if (!value || typeof value !== 'object') {
    throw new HttpError(400, 'roomCoordinates are required.');
  }
  const coordinates = value as Partial<RoomCoordinates>;
  if (!Number.isInteger(coordinates.x) || !Number.isInteger(coordinates.y)) {
    throw new HttpError(400, 'roomCoordinates must be integers.');
  }
  return {
    x: Number(coordinates.x),
    y: Number(coordinates.y),
  };
}

function parseRowNumber(value: number | string | null | undefined): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

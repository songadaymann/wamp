import {
  createExpandedRoomSummaryFromLegacyCourse,
  createExpandedRoomSummaryFromResolvedTarget,
  createExpandedRoomSummaryFromStandaloneRoom,
  expandedRoomIdFromLegacyCourseId,
  isExpandedRoomGoalType,
  type ExpandedRoomCellMembership,
  type ExpandedRoomCellRef,
  type ExpandedRoomGoalType,
  type ExpandedRoomSource,
  type ResolvedExpandedRoomTarget,
} from '../../../expandedRooms/model';
import { type CourseGoalType, type CourseSnapshot } from '../../../courses/model';
import {
  isRoomMinted,
  parseRoomId,
  type RoomCoordinates,
} from '../../../persistence/roomModel';
import { HttpError } from '../core/http';
import type { Env } from '../core/types';
import {
  loadCourseRecord,
  loadPublishedCourse,
  loadPublishedCourseMembershipsInBounds,
} from '../courses/store';
import { parseStoredSnapshot } from '../rooms/store';
import { isExpandedRoomSchemaMissingError } from './schemaErrors';

interface ExpandedRoomRow {
  id: string;
  owner_user_id: string | null;
  owner_display_name: string | null;
  source_type: string | null;
  legacy_course_id: string | null;
  anchor_room_id: string;
  anchor_x: number;
  anchor_y: number;
  published_json: string;
  published_title: string | null;
  published_version: number;
  published_at: string | null;
  updated_at: string | null;
}

interface ExpandedRoomMembershipRow {
  expanded_room_id: string;
  source_type: string | null;
  legacy_course_id: string | null;
  published_title: string | null;
  published_json: string | null;
  published_at: string | null;
  updated_at: string | null;
  room_id: string;
  room_x: number;
  room_y: number;
  room_version: number | null;
  room_title: string | null;
  protected_minted: number | null;
  cell_count: number;
}

interface ExpandedRoomCellRow {
  cell_order: number;
  room_id: string;
  room_x: number;
  room_y: number;
  room_version: number | null;
  room_title: string | null;
  protected_minted: number | null;
}

interface StandaloneRoomRow {
  id: string;
  x: number;
  y: number;
  published_json: string;
  claimer_user_id: string | null;
  claimer_display_name: string | null;
  last_published_by_user_id: string | null;
  last_published_by_display_name: string | null;
  minted_chain_id: number | null;
  minted_contract_address: string | null;
  minted_token_id: string | null;
}

interface MintedProtectionRow {
  id: string;
  minted_chain_id: number | null;
  minted_contract_address: string | null;
  minted_token_id: string | null;
}

export async function loadPublishedExpandedRoomMembershipsInBounds(
  env: Env,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number
): Promise<ExpandedRoomCellMembership[]> {
  const membershipsByRoomId = new Map<string, ExpandedRoomCellMembership>();
  const nativeMemberships = await loadNativeExpandedRoomMembershipsInBounds(
    env,
    minX,
    maxX,
    minY,
    maxY
  );
  for (const membership of nativeMemberships) {
    membershipsByRoomId.set(membership.roomId, membership);
  }

  const legacyMemberships = await loadLegacyCourseMembershipsAsExpandedRoomsInBounds(
    env,
    minX,
    maxX,
    minY,
    maxY
  );
  for (const membership of legacyMemberships) {
    if (membershipsByRoomId.has(membership.roomId)) {
      continue;
    }
    membershipsByRoomId.set(membership.roomId, membership);
  }

  return Array.from(membershipsByRoomId.values()).sort(compareExpandedRoomCellMemberships);
}

export async function loadPublishedExpandedRoomMembershipsForRoomIds(
  env: Env,
  roomIds: string[],
): Promise<ExpandedRoomCellMembership[]> {
  const uniqueRoomIds = Array.from(
    new Set(roomIds.map((roomId) => roomId.trim()).filter((roomId) => roomId.length > 0)),
  );
  if (uniqueRoomIds.length === 0) {
    return [];
  }

  const membershipsByRoomId = new Map<string, ExpandedRoomCellMembership>();
  const nativeMemberships = await loadNativeExpandedRoomMembershipsForRoomIds(env, uniqueRoomIds);
  for (const membership of nativeMemberships) {
    membershipsByRoomId.set(membership.roomId, membership);
  }

  const legacyMemberships = await loadLegacyCourseMembershipsAsExpandedRoomsForRoomIds(env, uniqueRoomIds);
  for (const membership of legacyMemberships) {
    if (membershipsByRoomId.has(membership.roomId)) {
      continue;
    }
    membershipsByRoomId.set(membership.roomId, membership);
  }

  return Array.from(membershipsByRoomId.values()).sort(compareExpandedRoomCellMemberships);
}

export async function resolveExpandedRoomAtCoordinates(
  env: Env,
  coordinates: RoomCoordinates
): Promise<ResolvedExpandedRoomTarget | null> {
  const nativeTarget = await loadNativeExpandedRoomTargetAtCoordinates(env, coordinates);
  if (nativeTarget) {
    return nativeTarget;
  }

  const legacyTarget = await loadLegacyCourseExpandedRoomTargetAtCoordinates(env, coordinates);
  if (legacyTarget) {
    return legacyTarget;
  }

  return loadStandaloneRoomExpandedRoomTargetByCoordinates(env, coordinates);
}

export async function loadExpandedRoomTarget(
  env: Env,
  expandedRoomId: string,
  options: { focusedCoordinates?: RoomCoordinates | null } = {}
): Promise<ResolvedExpandedRoomTarget | null> {
  const nativeTarget = await loadNativeExpandedRoomTarget(
    env,
    expandedRoomId,
    options.focusedCoordinates ?? null
  );
  if (nativeTarget) {
    return nativeTarget;
  }

  const legacyCourseId = getLegacyCourseIdFromExpandedRoomId(expandedRoomId);
  if (legacyCourseId) {
    return loadLegacyCourseExpandedRoomTarget(
      env,
      legacyCourseId,
      options.focusedCoordinates ?? null
    );
  }

  const standaloneRoomId = getStandaloneRoomIdFromExpandedRoomId(expandedRoomId);
  if (standaloneRoomId) {
    return loadStandaloneRoomExpandedRoomTargetByRoomId(
      env,
      standaloneRoomId,
      options.focusedCoordinates ?? null
    );
  }

  const legacyAlias = await resolveLegacyCourseExpandedRoomId(env, expandedRoomId);
  if (legacyAlias) {
    return loadExpandedRoomTarget(env, legacyAlias, options);
  }

  const coordinates = parseRoomId(expandedRoomId);
  if (coordinates) {
    return loadStandaloneRoomExpandedRoomTargetByRoomId(
      env,
      expandedRoomId,
      options.focusedCoordinates ?? coordinates
    );
  }

  return null;
}

export async function resolveLegacyCourseExpandedRoomId(
  env: Env,
  courseId: string
): Promise<string | null> {
  const normalizedCourseId = getLegacyCourseIdFromExpandedRoomId(courseId) ?? courseId;
  try {
    const row = await env.DB.prepare(
      `
        SELECT id
        FROM expanded_rooms
        WHERE legacy_course_id = ?
          AND published_json IS NOT NULL
          AND published_version IS NOT NULL
          AND archived_at IS NULL
        ORDER BY published_at DESC, updated_at DESC, id ASC
        LIMIT 1
      `
    )
      .bind(normalizedCourseId)
      .first<{ id: string }>();

    if (row?.id) {
      return row.id;
    }
  } catch (error) {
    if (!isExpandedRoomSchemaMissingError(error)) {
      throw error;
    }
  }

  const publishedCourse = await loadPublishedCourse(env, normalizedCourseId);
  return publishedCourse ? expandedRoomIdFromLegacyCourseId(normalizedCourseId) : null;
}

async function loadNativeExpandedRoomMembershipsInBounds(
  env: Env,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number
): Promise<ExpandedRoomCellMembership[]> {
  try {
    const result = await env.DB.prepare(
      `
        SELECT
          rooms.id AS expanded_room_id,
          rooms.source_type,
          rooms.legacy_course_id,
          rooms.published_title,
          rooms.published_json,
          rooms.published_at,
          rooms.updated_at,
          cells.room_id,
          cells.room_x,
          cells.room_y,
          cells.room_version,
          cells.room_title,
          cells.protected_minted,
          counts.cell_count
        FROM expanded_room_cells cells
        INNER JOIN expanded_rooms rooms
          ON rooms.id = cells.expanded_room_id
         AND rooms.published_version = cells.expanded_room_version
         AND rooms.published_json IS NOT NULL
         AND rooms.published_version IS NOT NULL
         AND rooms.archived_at IS NULL
        INNER JOIN (
          SELECT expanded_room_id, expanded_room_version, COUNT(*) AS cell_count
          FROM expanded_room_cells
          GROUP BY expanded_room_id, expanded_room_version
        ) counts
          ON counts.expanded_room_id = cells.expanded_room_id
         AND counts.expanded_room_version = cells.expanded_room_version
        WHERE cells.room_x BETWEEN ? AND ?
          AND cells.room_y BETWEEN ? AND ?
        ORDER BY
          cells.room_y ASC,
          cells.room_x ASC,
          rooms.published_at DESC,
          rooms.updated_at DESC,
          rooms.id ASC,
          cells.cell_order ASC
      `
    )
      .bind(minX, maxX, minY, maxY)
      .all<ExpandedRoomMembershipRow>();

    return normalizeNativeMembershipRows(result.results);
  } catch (error) {
    if (isExpandedRoomSchemaMissingError(error)) {
      return [];
    }
    throw error;
  }
}

async function loadNativeExpandedRoomTargetAtCoordinates(
  env: Env,
  coordinates: RoomCoordinates
): Promise<ResolvedExpandedRoomTarget | null> {
  const memberships = await loadNativeExpandedRoomMembershipsInBounds(
    env,
    coordinates.x,
    coordinates.x,
    coordinates.y,
    coordinates.y
  );
  if (memberships.length === 0) {
    return null;
  }
  if (memberships.length > 1) {
    console.warn('Conflicting expanded room memberships for coordinate.', {
      coordinates,
      expandedRoomIds: memberships.map((membership) => membership.expandedRoomId),
    });
  }

  return loadNativeExpandedRoomTarget(env, memberships[0].expandedRoomId, coordinates);
}

async function loadNativeExpandedRoomMembershipsForRoomIds(
  env: Env,
  roomIds: string[],
): Promise<ExpandedRoomCellMembership[]> {
  const memberships: ExpandedRoomCellMembership[] = [];
  try {
    for (const roomIdChunk of chunkValues(roomIds, 50)) {
      const result = await env.DB.prepare(
        `
          SELECT
            rooms.id AS expanded_room_id,
            rooms.source_type,
            rooms.legacy_course_id,
            rooms.published_title,
            rooms.published_json,
            rooms.published_at,
            rooms.updated_at,
            cells.room_id,
            cells.room_x,
            cells.room_y,
            cells.room_version,
            cells.room_title,
            cells.protected_minted,
            counts.cell_count
          FROM expanded_room_cells cells
          INNER JOIN expanded_rooms rooms
            ON rooms.id = cells.expanded_room_id
           AND rooms.published_version = cells.expanded_room_version
           AND rooms.published_json IS NOT NULL
           AND rooms.published_version IS NOT NULL
           AND rooms.archived_at IS NULL
          INNER JOIN (
            SELECT expanded_room_id, expanded_room_version, COUNT(*) AS cell_count
            FROM expanded_room_cells
            GROUP BY expanded_room_id, expanded_room_version
          ) counts
            ON counts.expanded_room_id = cells.expanded_room_id
           AND counts.expanded_room_version = cells.expanded_room_version
          WHERE cells.room_id IN (${roomIdChunk.map(() => '?').join(', ')})
          ORDER BY
            cells.room_y ASC,
            cells.room_x ASC,
            rooms.published_at DESC,
            rooms.updated_at DESC,
            rooms.id ASC,
            cells.cell_order ASC
        `
      )
        .bind(...roomIdChunk)
        .all<ExpandedRoomMembershipRow>();
      memberships.push(...normalizeNativeMembershipRows(result.results));
    }
    return memberships;
  } catch (error) {
    if (isExpandedRoomSchemaMissingError(error)) {
      return [];
    }
    throw error;
  }
}

async function loadNativeExpandedRoomTarget(
  env: Env,
  expandedRoomId: string,
  focusedCoordinates: RoomCoordinates | null
): Promise<ResolvedExpandedRoomTarget | null> {
  try {
    const row = await env.DB.prepare(
      `
        SELECT
          id,
          owner_user_id,
          owner_display_name,
          source_type,
          legacy_course_id,
          anchor_room_id,
          anchor_x,
          anchor_y,
          published_json,
          published_title,
          published_version,
          published_at,
          updated_at
        FROM expanded_rooms
        WHERE id = ?
          AND published_json IS NOT NULL
          AND published_version IS NOT NULL
          AND archived_at IS NULL
        LIMIT 1
      `
    )
      .bind(expandedRoomId)
      .first<ExpandedRoomRow>();

    if (!row) {
      return null;
    }

    const cells = await loadNativeExpandedRoomCells(env, row.id, row.published_version);
    if (cells.length === 0) {
      return null;
    }

    const source = normalizeExpandedRoomSource(row.source_type, cells.length);
    const legacyCourseId =
      row.legacy_course_id ?? (source === 'legacy_course' ? getLegacyCourseIdFromExpandedRoomId(row.id) : null);
    const goalType = getExpandedRoomGoalTypeFromJson(row.published_json);
    return {
      expandedRoomId: row.id,
      title: row.published_title,
      goalType,
      cellCount: cells.length,
      source,
      legacyCourseId,
      ownerUserId: row.owner_user_id,
      ownerDisplayName: row.owner_display_name,
      anchorRoomId: row.anchor_room_id,
      anchorCoordinates: {
        x: Number(row.anchor_x),
        y: Number(row.anchor_y),
      },
      focusedCoordinates: focusedCoordinates ? { ...focusedCoordinates } : null,
      version: Number(row.published_version),
      publishedAt: row.published_at,
      cells,
    };
  } catch (error) {
    if (isExpandedRoomSchemaMissingError(error)) {
      return null;
    }
    throw error;
  }
}

async function loadNativeExpandedRoomCells(
  env: Env,
  expandedRoomId: string,
  expandedRoomVersion: number
): Promise<ExpandedRoomCellRef[]> {
  const result = await env.DB.prepare(
    `
      SELECT
        cell_order,
        room_id,
        room_x,
        room_y,
        room_version,
        room_title,
        protected_minted
      FROM expanded_room_cells
      WHERE expanded_room_id = ?
        AND expanded_room_version = ?
      ORDER BY cell_order ASC, room_y ASC, room_x ASC, room_id ASC
    `
  )
    .bind(expandedRoomId, expandedRoomVersion)
    .all<ExpandedRoomCellRow>();

  return result.results.map((row) => ({
    roomId: row.room_id,
    coordinates: {
      x: Number(row.room_x),
      y: Number(row.room_y),
    },
    roomVersion: row.room_version === null ? null : Number(row.room_version),
    roomTitle: row.room_title,
    protectedMinted: row.protected_minted === 1,
  }));
}

function normalizeNativeMembershipRows(
  rows: ExpandedRoomMembershipRow[]
): ExpandedRoomCellMembership[] {
  const memberships: ExpandedRoomCellMembership[] = [];
  const membershipsByRoomId = new Map<string, ExpandedRoomCellMembership>();
  for (const row of rows) {
    const cellCount = Number(row.cell_count ?? 0);
    const source = normalizeExpandedRoomSource(row.source_type, cellCount);
    const legacyCourseId =
      row.legacy_course_id ??
      (source === 'legacy_course'
        ? getLegacyCourseIdFromExpandedRoomId(row.expanded_room_id)
        : null);
    const membership: ExpandedRoomCellMembership = {
      expandedRoomId: row.expanded_room_id,
      title: row.published_title,
      goalType: getExpandedRoomGoalTypeFromJson(row.published_json),
      cellCount,
      source,
      legacyCourseId,
      roomId: row.room_id,
      coordinates: {
        x: Number(row.room_x),
        y: Number(row.room_y),
      },
      roomVersion: row.room_version === null ? null : Number(row.room_version),
      roomTitle: row.room_title,
      protectedMinted: row.protected_minted === 1,
    };
    const existing = membershipsByRoomId.get(membership.roomId);
    if (existing) {
      console.warn('Conflicting expanded room memberships for room.', {
        roomId: membership.roomId,
        existingExpandedRoomId: existing.expandedRoomId,
        candidateExpandedRoomId: membership.expandedRoomId,
      });
      continue;
    }
    membershipsByRoomId.set(membership.roomId, membership);
    memberships.push(membership);
  }

  return memberships;
}

async function loadLegacyCourseMembershipsAsExpandedRoomsInBounds(
  env: Env,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number
): Promise<ExpandedRoomCellMembership[]> {
  const memberships = await loadPublishedCourseMembershipsInBounds(env, minX, maxX, minY, maxY);
  return memberships.map((membership) => {
    const coordinates = parseRoomId(membership.roomId) ?? { x: minX, y: minY };
    return {
      ...createExpandedRoomSummaryFromLegacyCourse(membership),
      roomId: membership.roomId,
      coordinates,
      roomVersion: null,
      roomTitle: null,
      protectedMinted: false,
    };
  });
}

async function loadLegacyCourseMembershipsAsExpandedRoomsForRoomIds(
  env: Env,
  roomIds: string[],
): Promise<ExpandedRoomCellMembership[]> {
  const memberships: ExpandedRoomCellMembership[] = [];
  for (const roomIdChunk of chunkValues(roomIds, 50)) {
    const result = await env.DB.prepare(
      `
        SELECT
          refs.room_id,
          refs.room_x,
          refs.room_y,
          course.id AS course_id,
          course.published_title,
          course.published_json,
          room_counts.room_count
        FROM course_room_refs refs
        INNER JOIN courses course
          ON course.id = refs.course_id
         AND course.published_version = refs.course_version
         AND course.published_json IS NOT NULL
        INNER JOIN (
          SELECT course_id, course_version, COUNT(*) AS room_count
          FROM course_room_refs
          GROUP BY course_id, course_version
        ) room_counts
          ON room_counts.course_id = refs.course_id
         AND room_counts.course_version = refs.course_version
        WHERE refs.room_id IN (${roomIdChunk.map(() => '?').join(', ')})
        ORDER BY refs.course_id ASC, refs.room_y ASC, refs.room_x ASC, refs.room_id ASC
      `
    )
      .bind(...roomIdChunk)
      .all<{
        room_id: string;
        room_x: number;
        room_y: number;
        course_id: string;
        published_title: string | null;
        published_json: string | null;
        room_count: number;
      }>();

    const goalTypeByCourseId = new Map<string, CourseGoalType | null>();
    for (const row of result.results) {
      const goalType = (() => {
        if (goalTypeByCourseId.has(row.course_id)) {
          return goalTypeByCourseId.get(row.course_id) ?? null;
        }

        const parsed = getLegacyCourseGoalTypeFromJson(row.published_json);
        goalTypeByCourseId.set(row.course_id, parsed);
        return parsed;
      })();
      memberships.push({
        ...createExpandedRoomSummaryFromLegacyCourse({
          courseId: row.course_id,
          courseTitle: row.published_title,
          goalType,
          roomCount: Number(row.room_count ?? 0),
        }),
        roomId: row.room_id,
        coordinates: {
          x: Number(row.room_x),
          y: Number(row.room_y),
        },
        roomVersion: null,
        roomTitle: null,
        protectedMinted: false,
      });
    }
  }
  return memberships;
}

async function loadLegacyCourseExpandedRoomTargetAtCoordinates(
  env: Env,
  coordinates: RoomCoordinates
): Promise<ResolvedExpandedRoomTarget | null> {
  const memberships = await loadPublishedCourseMembershipsInBounds(
    env,
    coordinates.x,
    coordinates.x,
    coordinates.y,
    coordinates.y
  );
  if (memberships.length === 0) {
    return null;
  }
  if (memberships.length > 1) {
    console.warn('Conflicting legacy course memberships for coordinate.', {
      coordinates,
      courseIds: memberships.map((membership) => membership.courseId),
    });
  }

  return loadLegacyCourseExpandedRoomTarget(env, memberships[0].courseId, coordinates);
}

async function loadLegacyCourseExpandedRoomTarget(
  env: Env,
  courseId: string,
  focusedCoordinates: RoomCoordinates | null
): Promise<ResolvedExpandedRoomTarget | null> {
  const record = await loadCourseRecord(env, courseId);
  if (!record) {
    return null;
  }

  const snapshot = record.published;
  if (!snapshot || snapshot.roomRefs.length === 0) {
    return null;
  }

  const cells = await createLegacyCourseCells(env, snapshot);
  const anchorCell =
    cells.find((cell) => cell.roomId === snapshot.startPoint?.roomId) ??
    cells.slice().sort(compareExpandedRoomCellRefs)[0];

  return {
    ...createExpandedRoomSummaryFromLegacyCourse({
      courseId,
      courseTitle: snapshot.title,
      goalType: snapshot.goal?.type ?? null,
      roomCount: cells.length,
    }),
    ownerUserId: record.ownerUserId,
    ownerDisplayName: record.ownerDisplayName,
    anchorRoomId: anchorCell.roomId,
    anchorCoordinates: { ...anchorCell.coordinates },
    focusedCoordinates: focusedCoordinates ? { ...focusedCoordinates } : null,
    version: snapshot.version,
    publishedAt: snapshot.publishedAt,
    cells,
  };
}

async function createLegacyCourseCells(
  env: Env,
  snapshot: CourseSnapshot
): Promise<ExpandedRoomCellRef[]> {
  const protectedRoomIds = await loadProtectedMintedRoomIds(
    env,
    snapshot.roomRefs.map((roomRef) => roomRef.roomId)
  );

  return snapshot.roomRefs.map((roomRef) => ({
    roomId: roomRef.roomId,
    coordinates: { ...roomRef.coordinates },
    roomVersion: roomRef.roomVersion,
    roomTitle: roomRef.roomTitle,
    protectedMinted: protectedRoomIds.has(roomRef.roomId),
  }));
}

async function loadStandaloneRoomExpandedRoomTargetByCoordinates(
  env: Env,
  coordinates: RoomCoordinates
): Promise<ResolvedExpandedRoomTarget | null> {
  return loadStandaloneRoomExpandedRoomTarget(
    env,
    `
      SELECT
        id,
        x,
        y,
        published_json,
        claimer_user_id,
        claimer_display_name,
        last_published_by_user_id,
        last_published_by_display_name,
        minted_chain_id,
        minted_contract_address,
        minted_token_id
      FROM rooms
      WHERE x = ?
        AND y = ?
        AND published_json IS NOT NULL
      LIMIT 1
    `,
    [coordinates.x, coordinates.y],
    coordinates
  );
}

async function loadStandaloneRoomExpandedRoomTargetByRoomId(
  env: Env,
  roomId: string,
  focusedCoordinates: RoomCoordinates | null
): Promise<ResolvedExpandedRoomTarget | null> {
  return loadStandaloneRoomExpandedRoomTarget(
    env,
    `
      SELECT
        id,
        x,
        y,
        published_json,
        claimer_user_id,
        claimer_display_name,
        last_published_by_user_id,
        last_published_by_display_name,
        minted_chain_id,
        minted_contract_address,
        minted_token_id
      FROM rooms
      WHERE id = ?
        AND published_json IS NOT NULL
      LIMIT 1
    `,
    [roomId],
    focusedCoordinates
  );
}

async function loadStandaloneRoomExpandedRoomTarget(
  env: Env,
  query: string,
  bindings: unknown[],
  focusedCoordinates: RoomCoordinates | null
): Promise<ResolvedExpandedRoomTarget | null> {
  const row = await bindAll(env.DB.prepare(query), bindings).first<StandaloneRoomRow>();
  if (!row) {
    return null;
  }

  const snapshot = parseStoredSnapshot(row.published_json, 'published standalone expanded room');
  const coordinates = {
    x: Number(row.x),
    y: Number(row.y),
  };
  const cell: ExpandedRoomCellRef = {
    roomId: row.id,
    coordinates,
    roomVersion: snapshot.version,
    roomTitle: snapshot.title,
    protectedMinted: isMintedDatabaseRow(row),
  };

  return {
    ...createExpandedRoomSummaryFromStandaloneRoom({
      roomId: row.id,
      roomTitle: snapshot.title,
      goalType: snapshot.goal?.type ?? null,
    }),
    ownerUserId: row.claimer_user_id ?? row.last_published_by_user_id,
    ownerDisplayName: row.claimer_display_name ?? row.last_published_by_display_name,
    anchorRoomId: row.id,
    anchorCoordinates: { ...coordinates },
    focusedCoordinates: focusedCoordinates ? { ...focusedCoordinates } : null,
    version: snapshot.version,
    publishedAt: snapshot.publishedAt,
    cells: [cell],
  };
}

async function loadProtectedMintedRoomIds(
  env: Env,
  roomIds: string[]
): Promise<Set<string>> {
  const uniqueRoomIds = Array.from(new Set(roomIds));
  if (uniqueRoomIds.length === 0) {
    return new Set();
  }

  const placeholders = uniqueRoomIds.map(() => '?').join(', ');
  const result = await bindAll(
    env.DB.prepare(
      `
        SELECT id, minted_chain_id, minted_contract_address, minted_token_id
        FROM rooms
        WHERE id IN (${placeholders})
      `
    ),
    uniqueRoomIds
  ).all<MintedProtectionRow>();

  return new Set(
    result.results
      .filter((row) => isMintedDatabaseRow(row))
      .map((row) => row.id)
  );
}

function isMintedDatabaseRow(
  row: Pick<MintedProtectionRow, 'minted_chain_id' | 'minted_contract_address' | 'minted_token_id'>
): boolean {
  return isRoomMinted({
    mintedChainId: row.minted_chain_id,
    mintedContractAddress: row.minted_contract_address,
    mintedTokenId: row.minted_token_id,
  });
}

function bindAll<T extends { bind(...values: unknown[]): T }>(statement: T, values: unknown[]): T {
  return values.length === 0 ? statement : statement.bind(...values);
}

function normalizeExpandedRoomSource(value: string | null, cellCount: number): ExpandedRoomSource {
  if (value === 'legacy_course') {
    return 'legacy_course';
  }
  if (value === 'native_expanded_room') {
    return 'native_expanded_room';
  }
  return cellCount <= 1 ? 'standalone_room' : 'native_expanded_room';
}

function getExpandedRoomGoalTypeFromJson(raw: string | null): ExpandedRoomGoalType | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as { goal?: { type?: unknown } };
    return isExpandedRoomGoalType(parsed.goal?.type) ? parsed.goal.type : null;
  } catch {
    throw new HttpError(500, 'Stored expanded room data is invalid.');
  }
}

function getLegacyCourseGoalTypeFromJson(raw: string | null): CourseGoalType | null {
  const goalType = getExpandedRoomGoalTypeFromJson(raw);
  return goalType === 'collect_race' || goalType === 'npc_quest' ? null : goalType;
}

function getLegacyCourseIdFromExpandedRoomId(expandedRoomId: string): string | null {
  return expandedRoomId.startsWith('course:') ? expandedRoomId.slice('course:'.length) : null;
}

function getStandaloneRoomIdFromExpandedRoomId(expandedRoomId: string): string | null {
  return expandedRoomId.startsWith('room:') ? expandedRoomId.slice('room:'.length) : null;
}

function compareExpandedRoomCellMemberships(
  a: ExpandedRoomCellMembership,
  b: ExpandedRoomCellMembership
): number {
  if (a.coordinates.y !== b.coordinates.y) {
    return a.coordinates.y - b.coordinates.y;
  }
  if (a.coordinates.x !== b.coordinates.x) {
    return a.coordinates.x - b.coordinates.x;
  }
  return a.roomId.localeCompare(b.roomId);
}

function compareExpandedRoomCellRefs(a: ExpandedRoomCellRef, b: ExpandedRoomCellRef): number {
  if (a.coordinates.y !== b.coordinates.y) {
    return a.coordinates.y - b.coordinates.y;
  }
  if (a.coordinates.x !== b.coordinates.x) {
    return a.coordinates.x - b.coordinates.x;
  }
  return a.roomId.localeCompare(b.roomId);
}

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

export function createExpandedRoomMembershipSummaryFromTarget(
  target: ResolvedExpandedRoomTarget
) {
  return createExpandedRoomSummaryFromResolvedTarget(target);
}

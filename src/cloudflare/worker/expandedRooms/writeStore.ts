import {
  expandedRoomIdFromLegacyCourseId,
} from '../../../expandedRooms/model';
import {
  cloneCourseSnapshot,
  sortCourseRoomRefsForStorage,
  type CourseRoomRef,
  type CourseSnapshot,
} from '../../../courses/model';
import {
  isRoomMinted,
} from '../../../persistence/roomModel';
import type { Env } from '../core/types';
import { isExpandedRoomSchemaMissingError } from './schemaErrors';

interface LegacyCourseExpandedRoomRecordInput {
  draft: CourseSnapshot;
  published: CourseSnapshot | null;
  ownerUserId: string;
  ownerDisplayName: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

interface LegacyCourseExpandedRoomVersionInput {
  snapshot: CourseSnapshot;
  createdAt: string;
  publishedByUserId: string | null;
  publishedByDisplayName: string | null;
}

interface MintedRoomRow {
  id: string;
  minted_chain_id: number | null;
  minted_contract_address: string | null;
  minted_token_id: string | null;
}

export async function syncExpandedRoomRecordFromLegacyCourse(
  env: Env,
  input: LegacyCourseExpandedRoomRecordInput,
): Promise<void> {
  try {
    await persistExpandedRoomRecordFromLegacyCourse(env, input);
  } catch (error) {
    if (isExpandedRoomSchemaMissingError(error)) {
      console.warn('Expanded room schema is missing; skipped expanded-room record sync.');
      return;
    }
    throw error;
  }
}

export async function syncExpandedRoomVersionFromLegacyCourse(
  env: Env,
  input: LegacyCourseExpandedRoomVersionInput,
): Promise<void> {
  try {
    await persistExpandedRoomVersionFromLegacyCourse(env, input);
  } catch (error) {
    if (isExpandedRoomSchemaMissingError(error)) {
      console.warn('Expanded room schema is missing; skipped expanded-room version sync.');
      return;
    }
    throw error;
  }
}

export function getExpandedRoomIdForLegacyCourse(courseId: string): string {
  return expandedRoomIdFromLegacyCourseId(courseId);
}

async function persistExpandedRoomRecordFromLegacyCourse(
  env: Env,
  input: LegacyCourseExpandedRoomRecordInput,
): Promise<void> {
  const published = input.published ? cloneCourseSnapshot(input.published) : null;
  const draft = cloneCourseSnapshot(input.draft);
  const anchor = resolveExpandedRoomAnchor(published ?? draft);
  const expandedRoomId = getExpandedRoomIdForLegacyCourse(draft.id);

  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO expanded_rooms (
          id,
          owner_user_id,
          owner_display_name,
          source_type,
          legacy_course_id,
          anchor_room_id,
          anchor_x,
          anchor_y,
          draft_json,
          published_json,
          draft_title,
          published_title,
          draft_version,
          published_version,
          created_at,
          updated_at,
          published_at,
          archived_at
        )
        VALUES (?, ?, ?, 'native_expanded_room', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(id) DO UPDATE SET
          owner_user_id = excluded.owner_user_id,
          owner_display_name = excluded.owner_display_name,
          source_type = excluded.source_type,
          legacy_course_id = excluded.legacy_course_id,
          anchor_room_id = excluded.anchor_room_id,
          anchor_x = excluded.anchor_x,
          anchor_y = excluded.anchor_y,
          draft_json = excluded.draft_json,
          published_json = excluded.published_json,
          draft_title = excluded.draft_title,
          published_title = excluded.published_title,
          draft_version = excluded.draft_version,
          published_version = excluded.published_version,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          published_at = excluded.published_at,
          archived_at = NULL
      `
    ).bind(
      expandedRoomId,
      input.ownerUserId,
      input.ownerDisplayName,
      draft.id,
      anchor.roomId,
      anchor.coordinates.x,
      anchor.coordinates.y,
      JSON.stringify(draft),
      published ? JSON.stringify(published) : null,
      draft.title,
      published?.title ?? null,
      draft.version,
      published?.version ?? null,
      input.createdAt,
      input.updatedAt,
      input.publishedAt,
    ),
  ]);
}

async function persistExpandedRoomVersionFromLegacyCourse(
  env: Env,
  input: LegacyCourseExpandedRoomVersionInput,
): Promise<void> {
  const snapshot = cloneCourseSnapshot(input.snapshot);
  const expandedRoomId = getExpandedRoomIdForLegacyCourse(snapshot.id);
  const sortedRoomRefs = sortCourseRoomRefsForStorage(snapshot.roomRefs);
  const protectedRoomIds = await loadProtectedMintedRoomIds(
    env,
    sortedRoomRefs.map((roomRef) => roomRef.roomId),
  );

  const statements = [
    env.DB.prepare(
      `
        INSERT INTO expanded_room_versions (
          expanded_room_id,
          version,
          snapshot_json,
          title,
          created_at,
          published_by_user_id,
          published_by_display_name,
          legacy_course_id,
          legacy_course_version
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(expanded_room_id, version) DO UPDATE SET
          snapshot_json = excluded.snapshot_json,
          title = excluded.title,
          created_at = excluded.created_at,
          published_by_user_id = excluded.published_by_user_id,
          published_by_display_name = excluded.published_by_display_name,
          legacy_course_id = excluded.legacy_course_id,
          legacy_course_version = excluded.legacy_course_version
      `
    ).bind(
      expandedRoomId,
      snapshot.version,
      JSON.stringify(snapshot),
      snapshot.title,
      input.createdAt,
      input.publishedByUserId,
      input.publishedByDisplayName,
      snapshot.id,
      snapshot.version,
    ),
    env.DB.prepare(
      `
        DELETE FROM expanded_room_cells
        WHERE expanded_room_id = ?
          AND expanded_room_version = ?
      `
    ).bind(expandedRoomId, snapshot.version),
  ];

  for (let index = 0; index < sortedRoomRefs.length; index += 1) {
    const roomRef = sortedRoomRefs[index];
    statements.push(
      env.DB.prepare(
        `
          INSERT INTO expanded_room_cells (
            expanded_room_id,
            expanded_room_version,
            cell_order,
            room_id,
            room_x,
            room_y,
            room_version,
            room_title,
            protected_minted
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      ).bind(
        expandedRoomId,
        snapshot.version,
        index,
        roomRef.roomId,
        roomRef.coordinates.x,
        roomRef.coordinates.y,
        roomRef.roomVersion,
        roomRef.roomTitle,
        protectedRoomIds.has(roomRef.roomId) ? 1 : 0,
      )
    );
  }

  await env.DB.batch(statements);
}

function resolveExpandedRoomAnchor(snapshot: CourseSnapshot): CourseRoomRef {
  const sortedRoomRefs = sortCourseRoomRefsForStorage(snapshot.roomRefs);
  const startRoomId = snapshot.startPoint?.roomId ?? null;
  const anchor = (
    sortedRoomRefs.find((roomRef) => roomRef.roomId === startRoomId) ??
    sortedRoomRefs[0]
  );
  if (!anchor) {
    throw new Error('Expanded rooms need at least one cell.');
  }
  return anchor;
}

async function loadProtectedMintedRoomIds(
  env: Env,
  roomIds: string[],
): Promise<Set<string>> {
  const uniqueRoomIds = Array.from(new Set(roomIds));
  if (uniqueRoomIds.length === 0) {
    return new Set();
  }

  const placeholders = uniqueRoomIds.map(() => '?').join(', ');
  const result = await env.DB.prepare(
    `
      SELECT id, minted_chain_id, minted_contract_address, minted_token_id
      FROM rooms
      WHERE id IN (${placeholders})
    `
  )
    .bind(...uniqueRoomIds)
    .all<MintedRoomRow>();

  return new Set(
    result.results
      .filter((row) =>
        isRoomMinted({
          mintedChainId: row.minted_chain_id,
          mintedContractAddress: row.minted_contract_address,
          mintedTokenId: row.minted_token_id,
        })
      )
      .map((row) => row.id)
  );
}

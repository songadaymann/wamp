import { loadDiscoveryRatingVersionKeys, ratingVersionIdentity } from '../progression/discoveryRatingWindows';
import type { Env } from '../core/types';
import { isExpandedRoomSchemaMissingError } from '../expandedRooms/schemaErrors';

export interface DiscoveryRoomVersionKey {
  roomId: string;
  roomVersion: number;
}

export interface DiscoveryExpandedRoomVersionKey {
  expandedRoomId: string;
  expandedRoomVersion: number;
}

export interface DiscoveryViewerRoomState {
  visited: boolean;
  completed: boolean;
  rated: boolean;
}

export async function loadDiscoveryViewerRoomStates(
  env: Env,
  userId: string,
  roomVersionKeys: DiscoveryRoomVersionKey[],
): Promise<Map<string, DiscoveryViewerRoomState>> {
  const states = new Map<string, DiscoveryViewerRoomState>();
  for (const key of roomVersionKeys) {
    states.set(buildDiscoveryRoomVersionKey(key.roomId, key.roomVersion), createEmptyDiscoveryViewerRoomState());
  }

  for (const roomVersionChunk of chunkValues(roomVersionKeys, 40)) {
    const whereClause = roomVersionChunk
      .map(() => '(room_id = ? AND room_version = ?)')
      .join(' OR ');
    const bindings = roomVersionChunk.flatMap((entry) => [entry.roomId, entry.roomVersion]);
    const runRows = await env.DB.prepare(
      `
        SELECT
          room_id,
          room_version,
          COUNT(*) AS run_count,
          SUM(CASE WHEN result = 'completed' THEN 1 ELSE 0 END) AS completed_count
        FROM room_runs
        WHERE user_id = ?
          AND (${whereClause})
        GROUP BY room_id, room_version
      `
    )
      .bind(userId, ...bindings)
      .all<{
        room_id: string;
        room_version: number | string | null;
        run_count: number | string | null;
        completed_count: number | string | null;
      }>();

    for (const row of runRows.results) {
      const key = buildDiscoveryRoomVersionKey(row.room_id, parseRowNumber(row.room_version));
      const state = states.get(key) ?? createEmptyDiscoveryViewerRoomState();
      state.visited = parseRowNumber(row.run_count) > 0;
      state.completed = parseRowNumber(row.completed_count) > 0;
      states.set(key, state);
    }

    const ratingWhereClause = roomVersionChunk
      .map(() => '(room_id = ? AND version_key = ?)')
      .join(' OR ');
    const buckets = await loadDiscoveryRatingVersionKeys(env, 'room', roomVersionChunk.map(entry => ({ id: entry.roomId, version: entry.roomVersion })));
    const ratingBindings = roomVersionChunk.flatMap(entry => [entry.roomId, buckets.get(ratingVersionIdentity(entry.roomId, entry.roomVersion)) ?? entry.roomVersion]);
    const ratingRows = await env.DB.prepare(
      `
        SELECT
          room_id,
          version_key
        FROM room_ratings
        WHERE user_id = ?
          AND (quality_stars IS NOT NULL OR difficulty_choice IS NOT NULL)
          AND (${ratingWhereClause})
      `
    )
      .bind(userId, ...ratingBindings)
      .all<{ room_id: string; version_key: number | string | null }>();

    for (const row of ratingRows.results) {
      for (const target of roomVersionChunk) {
        if (target.roomId !== row.room_id || buckets.get(ratingVersionIdentity(target.roomId, target.roomVersion)) !== parseRowNumber(row.version_key)) continue;
        const key = buildDiscoveryRoomVersionKey(target.roomId, target.roomVersion);
        const state = states.get(key) ?? createEmptyDiscoveryViewerRoomState();
        state.rated = true;
        states.set(key, state);
      }
    }
  }

  return states;
}

export async function loadDiscoveryViewerExpandedRoomStates(
  env: Env,
  userId: string,
  expandedRoomVersionKeys: DiscoveryExpandedRoomVersionKey[],
): Promise<Map<string, DiscoveryViewerRoomState>> {
  const states = new Map<string, DiscoveryViewerRoomState>();
  for (const key of expandedRoomVersionKeys) {
    states.set(
      buildDiscoveryExpandedRoomVersionKey(key.expandedRoomId, key.expandedRoomVersion),
      createEmptyDiscoveryViewerRoomState(),
    );
  }

  for (const versionChunk of chunkValues(expandedRoomVersionKeys, 40)) {
    const whereClause = versionChunk
      .map(() => '(expanded_room_id = ? AND expanded_room_version = ?)')
      .join(' OR ');
    const bindings = versionChunk.flatMap((entry) => [
      entry.expandedRoomId,
      entry.expandedRoomVersion,
    ]);
    try {
      const runRows = await env.DB.prepare(
        `
          SELECT
            expanded_room_id,
            expanded_room_version,
            COUNT(*) AS run_count,
            SUM(CASE WHEN result = 'completed' THEN 1 ELSE 0 END) AS completed_count
          FROM expanded_room_runs
          WHERE user_id = ?
            AND (${whereClause})
          GROUP BY expanded_room_id, expanded_room_version
        `
      )
        .bind(userId, ...bindings)
        .all<{
          expanded_room_id: string;
          expanded_room_version: number | string | null;
          run_count: number | string | null;
          completed_count: number | string | null;
        }>();

      for (const row of runRows.results) {
        const key = buildDiscoveryExpandedRoomVersionKey(
          row.expanded_room_id,
          parseRowNumber(row.expanded_room_version),
        );
        const state = states.get(key) ?? createEmptyDiscoveryViewerRoomState();
        state.visited = parseRowNumber(row.run_count) > 0;
        state.completed = parseRowNumber(row.completed_count) > 0;
        states.set(key, state);
      }

      const ratingWhereClause = versionChunk
        .map(() => '(expanded_room_id = ? AND version_key = ?)')
        .join(' OR ');
      const buckets = await loadDiscoveryRatingVersionKeys(env, 'expanded_room', versionChunk.map(entry => ({ id: entry.expandedRoomId, version: entry.expandedRoomVersion })));
      const ratingBindings = versionChunk.flatMap((entry) => [
        entry.expandedRoomId,
        buckets.get(ratingVersionIdentity(entry.expandedRoomId, entry.expandedRoomVersion)) ?? entry.expandedRoomVersion,
      ]);
      const ratingRows = await env.DB.prepare(
        `
          SELECT
            expanded_room_id,
            version_key
          FROM expanded_room_ratings
          WHERE user_id = ?
            AND (quality_stars IS NOT NULL OR difficulty_choice IS NOT NULL)
            AND (${ratingWhereClause})
        `
      )
        .bind(userId, ...ratingBindings)
        .all<{ expanded_room_id: string; version_key: number | string | null }>();

      for (const row of ratingRows.results) {
        for (const target of versionChunk) {
          if (target.expandedRoomId !== row.expanded_room_id || buckets.get(ratingVersionIdentity(target.expandedRoomId, target.expandedRoomVersion)) !== parseRowNumber(row.version_key)) continue;
          const key = buildDiscoveryExpandedRoomVersionKey(target.expandedRoomId, target.expandedRoomVersion);
          const state = states.get(key) ?? createEmptyDiscoveryViewerRoomState();
          state.rated = true;
          states.set(key, state);
        }
      }
    } catch (error) {
      if (isExpandedRoomSchemaMissingError(error)) {
        return states;
      }
      throw error;
    }
  }

  return states;
}

export function createEmptyDiscoveryViewerRoomState(): DiscoveryViewerRoomState {
  return {
    visited: false,
    completed: false,
    rated: false,
  };
}

export function buildDiscoveryRoomVersionKey(roomId: string, roomVersion: number): string {
  return `${roomId}:${roomVersion}`;
}

export function buildDiscoveryExpandedRoomVersionKey(expandedRoomId: string, expandedRoomVersion: number): string {
  return `${expandedRoomId}:${expandedRoomVersion}`;
}

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
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

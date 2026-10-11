import type { RoomCoordinates, RoomRecord, RoomSnapshot } from '../../../persistence/roomModel';
import {
  ROOM_VERSION_FACTS_VERSION,
  computeRoomVersionFacts,
  type RoomVersionFacts,
  type RoomVersionMeta,
} from '../../../persistence/roomVersionLineage';
import type { Env } from '../core/types';
import { computeRoomWeightedChange } from '../progression/changeMetrics';
import { loadRoomRecordWith, parseStoredSnapshot } from './store';

/**
 * A room for ranking paths (leaderboards, run finish, votes, ratings): every version's
 * compact facts plus only the snapshots asked for, instead of every version snapshot.
 */
export type RoomRankingRecord = Omit<RoomRecord, 'versions'> & {
  versions: RoomVersionMeta[];
  versionSnapshots: ReadonlyMap<number, RoomSnapshot>;
};

interface RoomVersionMetaRow {
  version: number;
  created_at: string;
  published_by_user_id: string | null;
  published_by_principal_type: RoomVersionMeta['publishedByPrincipalKind'];
  published_by_agent_id: string | null;
  published_by_display_name: string | null;
  reverted_from_version: number | null;
  leaderboard_source_version: number | null;
  facts_version: number | null;
  facts_json: string | null;
  change_from_previous: number | null;
}

const FACTS_UPSERT_CHUNK = 40;

export async function loadRoomRankingRecord(
  env: Env,
  roomId: string,
  coordinates: RoomCoordinates,
  options: {
    viewerUserId?: string | null;
    viewerWalletAddress?: string | null;
    viewerIsAdmin?: boolean;
    /** Historical versions whose snapshots the caller needs (the published one is always present). */
    snapshotVersions?: readonly (number | null)[];
  } = {},
): Promise<RoomRankingRecord> {
  const record = await loadRoomRecordWith(
    env, roomId, coordinates, options.viewerUserId ?? null, options.viewerWalletAddress ?? null, options.viewerIsAdmin ?? false,
    {
      statement: prepareLoadRoomVersionMetasStatement(env, roomId),
      isVersionRow: (candidate): candidate is RoomVersionMetaRow => 'facts_version' in candidate,
      map: async (rows, rowId) => resolveRoomVersionMetas(
        env, rowId, rowId === roomId ? rows : await loadVersionMetaRows(env, rowId),
      ),
    },
  );
  const wanted = [...new Set(options.snapshotVersions ?? [])].filter((version): version is number =>
    version !== null && version !== record.published?.version && record.versions.some((entry) => entry.version === version));
  const versionSnapshots = new Map<number, RoomSnapshot>();
  for (const [version, snapshot] of await loadVersionSnapshots(env, record.draft.id, wanted)) versionSnapshots.set(version, snapshot);
  return { ...record, versionSnapshots };
}

function prepareLoadRoomVersionMetasStatement(env: Env, roomId: string) {
  return env.DB.prepare(
    `
      SELECT
        v.version,
        v.created_at,
        v.published_by_user_id,
        v.published_by_principal_type,
        v.published_by_agent_id,
        v.published_by_display_name,
        v.reverted_from_version,
        v.leaderboard_source_version,
        f.facts_version,
        f.facts_json,
        f.change_from_previous
      FROM room_versions v
      LEFT JOIN room_version_facts f ON f.room_id = v.room_id AND f.version = v.version
      WHERE v.room_id = ?
      ORDER BY v.version ASC
    `,
  ).bind(roomId);
}

async function loadVersionMetaRows(env: Env, roomId: string): Promise<RoomVersionMetaRow[]> {
  return (await prepareLoadRoomVersionMetasStatement(env, roomId).all<RoomVersionMetaRow>()).results;
}

/**
 * Turns rows into version metas, computing and storing facts that are missing or from
 * an older facts version. A version's change is measured against the previous version,
 * so computing it also loads that predecessor's snapshot.
 */
async function resolveRoomVersionMetas(env: Env, roomId: string, rows: RoomVersionMetaRow[]): Promise<RoomVersionMeta[]> {
  const stale = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.facts_version !== ROOM_VERSION_FACTS_VERSION || row.facts_json === null || row.change_from_previous === null);
  const computed = new Map<number, { facts: RoomVersionFacts; changeFromPrevious: number }>();
  if (stale.length > 0) {
    const needed = new Set<number>();
    for (const { row, index } of stale) {
      needed.add(row.version);
      if (index > 0) needed.add(rows[index - 1].version);
    }
    const snapshots = await loadVersionSnapshots(env, roomId, [...needed]);
    const computedAt = new Date().toISOString();
    const upserts = [];
    for (const { row, index } of stale) {
      const snapshot = snapshots.get(row.version);
      if (!snapshot) continue;
      const previous = index > 0 ? snapshots.get(rows[index - 1].version) ?? null : null;
      const facts = computeRoomVersionFacts(snapshot);
      const changeFromPrevious = index === 0 ? 1 : computeRoomWeightedChange(previous, snapshot);
      computed.set(row.version, { facts, changeFromPrevious });
      upserts.push(env.DB.prepare(
        `
          INSERT INTO room_version_facts (room_id, version, facts_version, facts_json, change_from_previous, computed_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (room_id, version) DO UPDATE SET
            facts_version = excluded.facts_version,
            facts_json = excluded.facts_json,
            change_from_previous = excluded.change_from_previous,
            computed_at = excluded.computed_at
        `,
      ).bind(roomId, row.version, ROOM_VERSION_FACTS_VERSION, JSON.stringify(facts), changeFromPrevious, computedAt));
    }
    for (let start = 0; start < upserts.length; start += FACTS_UPSERT_CHUNK) {
      await env.DB.batch(upserts.slice(start, start + FACTS_UPSERT_CHUNK));
    }
  }

  return rows.flatMap((row) => {
    const stored = computed.get(row.version) ?? (row.facts_json !== null && row.change_from_previous !== null
      ? { facts: JSON.parse(row.facts_json) as RoomVersionFacts, changeFromPrevious: row.change_from_previous }
      : null);
    if (!stored) return [];
    return [{
      version: row.version,
      createdAt: row.created_at,
      publishedByUserId: row.published_by_user_id,
      publishedByPrincipalKind: row.published_by_principal_type,
      publishedByAgentId: row.published_by_agent_id,
      publishedByDisplayName: row.published_by_display_name,
      revertedFromVersion: row.reverted_from_version,
      leaderboardSourceVersion: row.leaderboard_source_version,
      facts: stored.facts,
      changeFromPrevious: stored.changeFromPrevious,
    }];
  });
}

async function loadVersionSnapshots(env: Env, roomId: string, versions: readonly number[]): Promise<Map<number, RoomSnapshot>> {
  const snapshots = new Map<number, RoomSnapshot>();
  if (versions.length === 0) return snapshots;
  const result = await env.DB.prepare(
    'SELECT version, snapshot_json FROM room_versions WHERE room_id = ? AND version IN (SELECT value FROM json_each(?))',
  ).bind(roomId, JSON.stringify(versions)).all<{ version: number; snapshot_json: string }>();
  for (const row of result.results) snapshots.set(row.version, parseStoredSnapshot(row.snapshot_json, 'room version'));
  return snapshots;
}

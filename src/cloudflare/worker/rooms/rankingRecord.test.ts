import { describe, expect, it } from 'vitest';
import { cloneRoomSnapshot } from '../../../persistence/roomModel';
import { ROOM_VERSION_FACTS_VERSION, computeRoomVersionFacts } from '../../../persistence/roomVersionLineage';
import { NOW, fixture } from '../activity/testDatabase';
import { resolveAggregatedRoomLeaderboardSelection } from '../runs/roomLeaderboardAggregation';
import { loadRoomRankingRecord } from './rankingRecord';
import { loadRoomRecord } from './store';

type Fixture = ReturnType<typeof fixture>;

/** Publishes the next version of room 0,0, unchanged or with its terrain rebuilt. */
function publish(f: Fixture, changed = false): number {
  const snapshot = cloneRoomSnapshot(f.record.published!);
  snapshot.version += 1;
  if (changed) for (const row of snapshot.tileData.terrain) row.fill(1);
  const json = JSON.stringify(snapshot);
  f.sqlite.prepare(`INSERT INTO room_versions (room_id,version,snapshot_json,title,created_at,published_by_user_id) VALUES ('0,0',?,?,'Lava Gauntlet',?,'builder')`)
    .run(snapshot.version, json, NOW);
  f.sqlite.prepare(`UPDATE rooms SET published_json = ? WHERE id = '0,0'`).run(json);
  f.record.published = snapshot;
  return snapshot.version;
}

const factRows = (f: Fixture) => f.sqlite.prepare('SELECT version, facts_version, change_from_previous FROM room_version_facts ORDER BY version').all() as
  Array<{ version: number; facts_version: number; change_from_previous: number }>;

describe('room ranking record', () => {
  it('computes and stores version facts on first read, and only for new versions after', async () => {
    const f = fixture();
    const first = await loadRoomRankingRecord(f.env, '0,0', { x: 0, y: 0 });
    expect(first.versions.map((v) => v.version)).toEqual([1]);
    expect(first.versions[0].facts).toEqual(computeRoomVersionFacts(f.record.published!));
    expect(factRows(f)).toEqual([{ version: 1, facts_version: ROOM_VERSION_FACTS_VERSION, change_from_previous: 1 }]);

    const same = publish(f); const changed = publish(f, true);
    const second = await loadRoomRankingRecord(f.env, '0,0', { x: 0, y: 0 });
    expect(second.versions.map((v) => [v.version, v.changeFromPrevious > 0.1])).toEqual([[1, true], [same, false], [changed, true]]);
    expect(factRows(f).map((row) => row.version)).toEqual([1, same, changed]);
  });

  it('reads stored facts without parsing old snapshots again, and recomputes outdated facts', async () => {
    const f = fixture();
    publish(f); await loadRoomRankingRecord(f.env, '0,0', { x: 0, y: 0 });
    const original = f.sqlite.prepare(`SELECT snapshot_json FROM room_versions WHERE room_id = '0,0' AND version = 1`).get() as { snapshot_json: string };
    // A stored fact is enough: the snapshot is never read for it.
    f.sqlite.prepare(`UPDATE room_versions SET snapshot_json = 'not json' WHERE room_id = '0,0' AND version = 1`).run();
    expect((await loadRoomRankingRecord(f.env, '0,0', { x: 0, y: 0 })).versions).toHaveLength(2);
    // An older facts version is recomputed from the snapshot.
    f.sqlite.prepare(`UPDATE room_versions SET snapshot_json = ? WHERE room_id = '0,0' AND version = 1`).run(original.snapshot_json);
    f.sqlite.prepare(`UPDATE room_version_facts SET facts_version = 0, computed_at = 'old' WHERE version = 1`).run();
    await loadRoomRankingRecord(f.env, '0,0', { x: 0, y: 0 });
    expect(factRows(f)[0].facts_version).toBe(ROOM_VERSION_FACTS_VERSION);
  });

  it('loads only the historical snapshots asked for, and selects the same leaderboard as the full record', async () => {
    const f = fixture();
    const same = publish(f); const changed = publish(f, true);
    const ranking = await loadRoomRankingRecord(f.env, '0,0', { x: 0, y: 0 }, { snapshotVersions: [1, null] });
    expect([...ranking.versionSnapshots.keys()]).toEqual([1]);
    const full = await loadRoomRecord(f.env, '0,0', { x: 0, y: 0 });
    for (const version of [1, same, changed]) {
      const fromRanking = resolveAggregatedRoomLeaderboardSelection(
        { ...ranking, versionSnapshots: new Map([[version, full.versions.find((v) => v.version === version)!.snapshot]]) }, version);
      const fromFull = resolveAggregatedRoomLeaderboardSelection(full, version);
      expect({ ...fromRanking, snapshot: fromRanking.snapshot.version }).toEqual({ ...fromFull, snapshot: fromFull.snapshot.version });
    }
    expect(() => resolveAggregatedRoomLeaderboardSelection({ ...ranking, versionSnapshots: new Map() }, 1)).toThrow(/not found/);
  });
});

describe('stored version facts', () => {
  it('stay stable for a fixed room; if this fails, bump ROOM_VERSION_FACTS_VERSION and update the expectation', () => {
    const f = fixture();
    expect({ factsVersion: ROOM_VERSION_FACTS_VERSION, facts: computeRoomVersionFacts(f.record.published!) }).toMatchInlineSnapshot(`
      {
        "facts": {
          "bossSignature": "[]",
          "fingerprint": "70be18499fdb326b",
          "goalType": "reach_exit",
          "hasCoopPlates": false,
          "hasGoal": true,
          "playerHearts": 1,
          "rankingMode": "time",
          "snapshotId": "0,0",
        },
        "factsVersion": 1,
      }
    `);
  });
});

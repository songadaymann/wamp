import { describe, expect, it } from 'vitest';
import { cloneRoomSnapshot } from '../../../persistence/roomModel';
import type { RunGhost } from '../../../runs/ghostRace';
import { NOW, fixture, run } from '../activity/testDatabase';
import { loadRoomRecord } from '../rooms/store';
import { handleRoomGhosts, loadGhostOption } from './ghosts';
import { loadRankedRoomLeaderboardRows } from './leaderboards';
import { resolveAggregatedRoomLeaderboardSelection } from './roomLeaderboardAggregation';

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

function ghostFor(f: Fixture, attemptId: string, user: string, version: number, elapsedMs: number): void {
  run(f, attemptId, user, elapsedMs, 'passed', version);
  const ghost: RunGhost = { schemaVersion: 1, attemptId, roomId: '0,0', roomVersion: version, displayName: user,
    avatarId: 'default-player', elapsedMs, points: [
      { atMs: 0, roomX: 0, roomY: 0, x: 0, y: 100, vx: 100, vy: 0, grounded: true, snap: false },
      { atMs: elapsedMs, roomX: 0, roomY: 0, x: 100, y: 100, vx: 100, vy: 0, grounded: true, snap: false },
    ] };
  f.sqlite.prepare('INSERT INTO run_ghosts (room_id,room_version,user_id,attempt_id,elapsed_ms,deaths,payload_json,created_at) VALUES (?,?,?,?,?,0,?,?)')
    .run('0,0', version, user, attemptId, elapsedMs, JSON.stringify(ghost), NOW);
}

/** Counts the room version snapshots D1 hands back, through single statements and batches. */
function countSnapshotRows(f: Fixture): { rows: number } {
  const seen = { rows: 0 };
  const count = (results: unknown[]) => {
    seen.rows += results.filter((row) => typeof row === 'object' && row !== null && 'snapshot_json' in row).length;
  };
  const prepare = f.env.DB.prepare.bind(f.env.DB);
  const batch = f.env.DB.batch.bind(f.env.DB);
  f.env.DB.prepare = (sql: string) => {
    const statement = prepare(sql);
    const all = statement.all.bind(statement);
    statement.all = async <T>() => { const result = await all<T>(); count(result.results); return result; };
    return statement;
  };
  f.env.DB.batch = async <T>(statements: Parameters<typeof batch>[0]) => {
    const results = await batch<T>(statements);
    for (const result of results) count((result as { results?: unknown[] }).results ?? []);
    return results;
  };
  return seen;
}

/** The pre-F329 lookup: every version snapshot loaded, then the same selection and ghost reads. */
async function legacyTop(f: Fixture, version: number | null) {
  const selection = resolveAggregatedRoomLeaderboardSelection(await loadRoomRecord(f.env, '0,0', { x: 0, y: 0 }), version);
  const rows = await loadRankedRoomLeaderboardRows(f.env, '0,0', selection.leaderboardFamilyVersions, selection.snapshot.goal!, 1);
  return { roomVersion: selection.roomVersion, top: await loadGhostOption(f.env, '0,0', selection.equivalentRoomVersions, rows[0] ?? null) };
}

async function ghosts(f: Fixture, version: number | null) {
  const request = new Request(`https://api.wamp.land/api/rooms/0%2C0/ghosts${version === null ? '' : `?version=${version}`}`);
  return (await handleRoomGhosts(request, new URL(request.url), f.env, '0,0')).json();
}

describe('room ghost lookup reads (F329)', () => {
  it('loads at most the requested version snapshot and answers the same as the full-history read', async () => {
    const f = fixture();
    ghostFor(f, 'v1-best', 'p1', 1, 9000);
    const same = publish(f); for (let i = 0; i < 6; i += 1) publish(f);
    const changed = publish(f, true);
    ghostFor(f, 'current-best', 'p2', changed, 8000);
    // The first ranking read stores every version's compact facts, as for room leaderboards.
    await ghosts(f, null);

    for (const version of [null, 1, same, changed]) {
      const expected = await legacyTop(f, version);
      const seen = countSnapshotRows(f);
      const response = await ghosts(f, version);
      expect(response).toEqual({ roomId: '0,0', ...expected, personal: { ghost: null, reason: 'sign_in' }, challenge: {ghost:null,reason:'no_run'} });
      // The published snapshot comes from the room row; only an older requested version is read.
      expect(seen.rows).toBe(version === null || version === changed ? 0 : 1);
    }
    expect((await legacyTop(f, same)).top.ghost?.attemptId).toBe('v1-best');
    expect((await legacyTop(f, changed)).top.ghost?.attemptId).toBe('current-best');
  });

  it('still reads every version for the full room record the lookup used to load', async () => {
    const f = fixture();
    for (let i = 0; i < 4; i += 1) publish(f);
    const seen = countSnapshotRows(f);
    await loadRoomRecord(f.env, '0,0', { x: 0, y: 0 });
    expect(seen.rows).toBe(5);
  });
});

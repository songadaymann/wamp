import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { Env } from '../core/types';
import { loadRankedExpandedRoomLeaderboardRows, loadViewerRankedExpandedRoomLeaderboardRow } from './leaderboards';

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach(db => db.close()));
function fixture() {
  const db = new DatabaseSync(':memory:'); databases.push(db);
  db.exec(`CREATE TABLE expanded_room_runs (attempt_id TEXT PRIMARY KEY, expanded_room_id TEXT, expanded_room_version INTEGER,
    user_id TEXT, user_display_name TEXT, elapsed_ms INTEGER, deaths INTEGER, score INTEGER, finished_at TEXT, result TEXT, verification_status TEXT);
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, wallet_address TEXT);
    CREATE TABLE playfun_user_links (user_id TEXT);`);
  const env = { DB: { prepare: (sql: string) => ({ bind: (...values: (string | number)[]) => ({
    all: async () => ({ results: db.prepare(sql).all(...values) }), first: async () => db.prepare(sql).get(...values) ?? null,
  }) }) } } as unknown as Env;
  const save = (attempt: string, user: string, time: number, changes: { room?: string; version?: number; score?: number; result?: string; verification?: string; deaths?: number } = {}) => {
    db.prepare(`INSERT INTO expanded_room_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-10-18T12:00:00Z', ?, ?)`)
      .run(attempt, changes.room ?? 'whole-room', changes.version ?? 3, user, user, time, changes.deaths ?? 0,
        changes.score ?? 0, changes.result ?? 'completed', changes.verification ?? 'passed');
  };
  return { env, save };
}
const goal = { type: 'reach_exit' as const, exit: { roomId: 'second-cell', x: 10, y: 10 }, timeLimitMs: null };
describe('saved whole Expanded Room rankings', () => {
  it('ranks valid saved clears, one best per player, isolated from cells, versions, failed and unverified runs', async () => {
    const { env, save } = fixture();
    save('slow', 'Alice', 3000); save('best', 'Alice', 1000); save('second', 'Bob', 2000);
    save('cell', 'Cell player', 1, { room: 'second-cell' }); save('old', 'Old player', 1, { version: 2 });
    save('failed', 'Failed', 1, { result: 'failed' }); save('bad', 'Bad trace', 1, { verification: 'failed' });
    save('pending', 'Pending', 1, { result: 'active' }); save('timeout', 'Timeout', 1, { verification: 'timeout' });
    const rows = await loadRankedExpandedRoomLeaderboardRows(env, 'whole-room', 3, goal, 25);
    expect(rows.map(row => [row.attempt_id, Number(row.overall_rank)])).toEqual([['best', 1], ['second', 2]]);
    expect(await loadViewerRankedExpandedRoomLeaderboardRow(env, 'whole-room', 3, goal, 'Bob')).toMatchObject({ attempt_id: 'second', overall_rank: 2 });
    save('new-best', 'Bob', 500);
    expect((await loadRankedExpandedRoomLeaderboardRows(env, 'whole-room', 3, goal, 1))[0]).toMatchObject({ attempt_id: 'new-best', overall_rank: 1 });
    expect((await loadViewerRankedExpandedRoomLeaderboardRow(env, 'whole-room', 3, goal, 'Alice'))?.overall_rank).toBe(2);
  });
  it('uses score ordering when the whole-room goal is score based, with deterministic time/death ties', async () => {
    const { env, save } = fixture(); save('fast-low', 'Low', 500, { score: 1 });
    save('high', 'High', 1000, { score: 4, deaths: 1 }); save('tie', 'Tie', 1000, { score: 4 });
    const rows = await loadRankedExpandedRoomLeaderboardRows(env, 'whole-room', 3,
      { type: 'collect_target', requiredCount: 4, timeLimitMs: null }, 25);
    expect(rows.map(row => row.attempt_id)).toEqual(['tie', 'high', 'fast-low']);
  });
});

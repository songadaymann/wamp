import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { D1Database, D1PreparedStatement, Env } from '../core/types';
import { recordDiscoveryRunPlayer, loadDiscoveryRunMetrics, recordClaimedDiscoveryPlayers } from './runMetrics';
import { loadIndexedDiscoveryRows } from './discovery';
import { refreshPlayableContentIndexForRoom, refreshPlayableContentIndexForExpandedRoom } from './store';
import { syncContentTrophy } from '../progression/badgesTrophies';
import { loadExpandedDiscoveryTrophies } from './trophies';
import { suggestProgressionDifficulty } from '../../../progression/autoDifficulty';
import { handleAdminRequest } from '../admin/routes';

class Statement implements D1PreparedStatement {
  values: (string | number | null)[] = [];
  constructor(readonly sql: string, readonly db: DatabaseSync) {}
  bind(...values: unknown[]): this {
    this.values = values.map(value => {
      if (value === null || typeof value === 'string' || typeof value === 'number') return value;
      throw new Error('Unexpected SQL parameter');
    });
    return this;
  }
  async first<T>(): Promise<T | null> { return (this.db.prepare(this.sql).get(...this.values) as T | undefined) ?? null; }
  async all<T>(): Promise<{ results: T[] }> { return { results: this.db.prepare(this.sql).all(...this.values) as T[] }; }
}
class Database implements D1Database {
  constructor(readonly sqlite: DatabaseSync) {}
  prepare(sql: string): Statement { return new Statement(sql, this.sqlite); }
  async batch<T>(statements: D1PreparedStatement[]): Promise<T[]> {
    this.sqlite.exec('BEGIN');
    try {
      const result = statements.map(query => {
        if (!(query instanceof Statement)) throw new Error('Unexpected statement');
        return { results: this.sqlite.prepare(query.sql).all(...query.values) } as T;
      });
      this.sqlite.exec('COMMIT'); return result;
    } catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
}
const NOW = '2026-10-04T16:00:00.000Z';
const ROOT = new URL('../../../../', import.meta.url);
let sqlite: DatabaseSync, env: Env;
function read(sql: string): Record<string, unknown> | undefined { return sqlite.prepare(sql).get() as Record<string, unknown> | undefined; }
function applyMigrations(includeDiscovery = true): void {
  const directory = new URL('migrations/', ROOT);
  for (const file of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) {
    if (!includeDiscovery && file.startsWith('0054_')) continue;
    sqlite.exec(readFileSync(new URL(file, directory), 'utf8'));
  }
}
function target(id = '0,0', version = 1): void {
  const coordinates = id.split(',').map(Number);
  const snapshot = JSON.stringify({ version, title: 'Test', publishedAt: NOW, goal: { type: 'reach_exit' } });
  sqlite.prepare(`INSERT INTO rooms (id,x,y,draft_json,published_json,last_published_by_user_id)
    VALUES (?,?,?,?,?,'owner') ON CONFLICT(id) DO UPDATE SET published_json=excluded.published_json`)
    .run(id, coordinates[0], coordinates[1], snapshot, snapshot);
  sqlite.prepare('INSERT OR IGNORE INTO room_versions (room_id,version,snapshot_json,created_at) VALUES (?,?,?,?)')
    .run(id, version, snapshot, NOW);
}
async function sample(user: string, deaths = 0, version = 1, result: 'completed' | 'failed' | 'abandoned' = 'completed', at = NOW) {
  await recordDiscoveryRunPlayer(env, 'room:0,0', version, user, {
    result, elapsedMs: 10000, deaths, collectiblesCollected: 0, enemiesDefeated: 0, checkpointsReached: 0, finishedAt: at,
  });
}
beforeEach(async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(NOW));
  sqlite = new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys = ON');
  applyMigrations();
  const db = new Database(sqlite); env = { DB: db, JAM_DB: db, ASSETS: { fetch: async () => new Response() }, PLAYABLE_CONTENT_INDEX_READS: '1' };
  for (const user of ['owner', 'p1', 'p2', 'p3', 'p4', 'generated']) {
    sqlite.prepare('INSERT INTO users (id,email,display_name,created_at,updated_at) VALUES (?,?,?,?,?)')
      .run(user, user + '@example.test', user === 'generated' ? 'playfun-fixture' : user, NOW, NOW);
  }
  target(); await refreshPlayableContentIndexForRoom(env, '0,0');
});
afterEach(() => { sqlite.close(); vi.useRealTimers(); });

describe('discovery metrics against the migrated SQLite schema', () => {
  it('counts each player once and estimates only after three independent first clears', async () => {
    await sample('owner'); await sample('generated'); await sample('p1');
    await sample('p1', 12); await sample('p2');
    expect((await loadDiscoveryRunMetrics(env)).get('room:0,0')?.measured_difficulty).toBeNull();
    await sample('p3', 1);
    const metrics = (await loadDiscoveryRunMetrics(env)).get('room:0,0');
    expect(metrics).toMatchObject({ measured_players: 3, recent_players: 3, measured_difficulty: 'easy' });
    expect(read("SELECT difficulty_choice FROM discovery_run_players WHERE user_id='p1'")?.difficulty_choice).toBe('easy');
    const filtered = await loadIndexedDiscoveryRows(env, 'easy', 48, 'popular', false, 0);
    expect(filtered).toHaveLength(1);
    expect(filtered?.[0]).toMatchObject({ consensus_difficulty: 'easy', difficulty_source: 'measured', recent_players: 3 });
  });
  it('gives explicit votes priority at three votes and does not carry estimates to a new version', async () => {
    await sample('p1'); await sample('p2'); await sample('p3');
    sqlite.exec("UPDATE playable_content_index SET consensus_difficulty='hard', difficulty_vote_count=3");
    expect(await loadIndexedDiscoveryRows(env, 'easy', 48, 'popular', false, 0)).toHaveLength(0);
    expect((await loadIndexedDiscoveryRows(env, 'hard', 48, 'popular', false, 0))?.[0]?.difficulty_source).toBe('votes');
    target('0,0', 2); await refreshPlayableContentIndexForRoom(env, '0,0');
    expect((await loadIndexedDiscoveryRows(env, null, 48, 'popular', false, 0))?.[0])
      .toMatchObject({ version_key: 2, consensus_difficulty: null, recent_players: 0 });
  });
  it('counts recent failed attempts as plays, but excludes abandonments and expired recency from popularity', async () => {
    await sample('p1', 0, 1, 'completed', '2026-09-19T16:00:00.000Z');
    await sample('p2', 0, 1, 'failed'); await sample('p3', 0, 1, 'abandoned');
    expect((await loadDiscoveryRunMetrics(env)).get('room:0,0'))
      .toMatchObject({ measured_players: 1, recent_players: 1, measured_difficulty: null });
    expect(read('SELECT COUNT(*) AS count FROM discovery_run_players')?.count).toBe(2);
  });
  it('uses the first actual completion even when deferred writes arrive out of order', async () => {
    await sample('p1', 9, 1, 'completed', NOW);
    await sample('p1', 0, 1, 'completed', '2026-10-04T15:00:00.000Z');
    await sample('p1', 2, 1, 'failed', '2026-10-04T16:01:00.000Z');
    expect(read("SELECT difficulty_choice,sampled_at,last_played_at FROM discovery_run_players WHERE user_id='p1'"))
      .toMatchObject({ difficulty_choice: 'easy', sampled_at: '2026-10-04T15:00:00.000Z', last_played_at: '2026-10-04T16:01:00.000Z' });
  });
  it('keeps Popular ordered by distinct recent players rather than a single high rating', async () => {
    target('1,0'); await refreshPlayableContentIndexForRoom(env, '1,0');
    sqlite.exec("UPDATE playable_content_index SET quality_adjusted_average=5,quality_vote_count=1 WHERE content_id='1,0'");
    await sample('p1'); await sample('p2');
    const rows = await loadIndexedDiscoveryRows(env, null, 1, 'popular', false, 0);
    expect(rows?.map(row => row.content_id)).toEqual(['0,0', '1,0']);
    expect(await loadIndexedDiscoveryRows(env, null, 1, 'popular', false, 1)).toHaveLength(1);
  });
  it('makes Featured exclusive and drops a feature on republish', async () => {
    expect(await loadIndexedDiscoveryRows(env, null, 48, 'featured', false, 0)).toHaveLength(0);
    sqlite.prepare("INSERT INTO featured_rooms (room_id,room_version,featured_at,target_key,target_version) VALUES ('0,0',1,?,'room:0,0',1)").run(NOW);
    await refreshPlayableContentIndexForRoom(env, '0,0');
    expect(await loadIndexedDiscoveryRows(env, null, 48, 'featured', false, 0)).toHaveLength(1);
    target('0,0', 2); await refreshPlayableContentIndexForRoom(env, '0,0');
    expect(await loadIndexedDiscoveryRows(env, null, 48, 'featured', false, 0)).toHaveLength(0);
  });
  it('records claimed verified guest clears once under the signed-in identity', async () => {
    sqlite.prepare(`INSERT INTO guest_run_attempts
      (attempt_id,guest_user_id,recovery_token_hash,client_run_id,content_type,content_id,content_version,progress_source_type,progress_source_id,
       verification_nonce,snapshot_hash,started_at,expires_at,result,verification_status,finished_at,metrics_json,claimed_user_id,claim_id)
      VALUES ('guest1','guest','hash','client','room','0,0',1,'room','0,0','nonce','snapshot',?,?,'completed','passed',?,?,'p1','claim')`)
      .run(NOW, NOW, NOW, JSON.stringify({elapsedMs:10000,deaths:0}));
    await recordClaimedDiscoveryPlayers(env, 'claim', 'p1');
    await recordClaimedDiscoveryPlayers(env, 'claim', 'p1');
    await sample('p1');
    expect(read("SELECT COUNT(*) AS count FROM discovery_run_players WHERE user_id='p1'")?.count).toBe(1);
  });
  it('allows credible five-vote quality trophies while preserving the score floor and vote minimum', async () => {
    const quality = { adjustedAverage:4.25,rawAverage:5,voteCount:5,weightedVoteCount:5,
      counts:{oneStar:0,twoStar:0,threeStar:0,fourStar:0,fiveStar:5} };
    await syncContentTrophy(env, 'room', '0,0', 1, quality);
    expect(read('SELECT COUNT(*) AS count FROM content_trophies')?.count).toBe(1);
    await syncContentTrophy(env, 'room', '0,0', 1, {...quality, voteCount:2, weightedVoteCount:10});
    expect(read('SELECT COUNT(*) AS count FROM content_trophies')?.count).toBe(0);
    await syncContentTrophy(env, 'room', '0,0', 1, {...quality, adjustedAverage:3.9});
    expect(read('SELECT COUNT(*) AS count FROM content_trophies')?.count).toBe(0);
  });
  it('runs the additive migration and idempotent historical catch-up on verified run history', async () => {
    sqlite.exec('DROP TABLE discovery_run_players');
    sqlite.prepare(`INSERT INTO room_runs
      (attempt_id,room_id,room_x,room_y,room_version,goal_type,goal_json,user_id,user_display_name,started_at,finished_at,
       result,elapsed_ms,deaths,verification_status)
      VALUES ('historical','0,0',0,0,1,'reach_exit','{}','p1','Player',?,?,'completed',10000,0,'passed')`).run(NOW,NOW);
    const migration = readFileSync(new URL('migrations/0054_discovery_run_players.sql',ROOT),'utf8');
    sqlite.exec(migration.slice(0,migration.indexOf('-- Feature the reviewed')));
    expect(read('SELECT COUNT(*) AS count FROM discovery_run_players')?.count).toBe(1);
    const catchup = readFileSync(new URL('scripts/sql/backfill_discovery_run_players.sql',ROOT),'utf8');
    sqlite.exec(catchup); sqlite.exec(catchup);
    expect(read('SELECT COUNT(*) AS count FROM discovery_run_players')?.count).toBe(1);
    expect(read("SELECT difficulty_choice FROM discovery_run_players WHERE user_id='p1'")?.difficulty_choice).toBe('easy');
  });
  it('backfills the shared heuristic and ignores rejected, timed out and abandoned runs', () => {
    const insert = sqlite.prepare(`INSERT INTO room_runs
      (attempt_id,room_id,room_x,room_y,room_version,goal_type,goal_json,user_id,user_display_name,started_at,finished_at,
       result,elapsed_ms,deaths,collectibles_collected,enemies_defeated,checkpoints_reached,verification_status)
      VALUES (?,'0,0',0,0,?,'reach_exit','{}','p1','Player',?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const inputs = [
      {elapsedMs:0,deaths:0}, {elapsedMs:64000,deaths:0}, {elapsedMs:10000,deaths:2},
      {elapsedMs:10000,deaths:4}, {elapsedMs:120000,deaths:0,collectiblesCollected:30,enemiesDefeated:10,checkpointsReached:10},
    ];
    inputs.forEach((input,index) => insert.run('sample'+index,index+1,NOW,NOW,'completed',input.elapsedMs,input.deaths,
      input.collectiblesCollected??0,input.enemiesDefeated??0,input.checkpointsReached??0,'passed'));
    for (const [index,result,status] of [[6,'completed','failed'],[7,'completed','timeout'],[8,'abandoned','not_required']] as const) {
      insert.run('excluded'+index,index,NOW,NOW,result,10000,0,0,0,0,status);
    }
    const catchup = readFileSync(new URL('scripts/sql/backfill_discovery_run_players.sql',ROOT),'utf8');
    sqlite.exec(catchup);
    inputs.forEach((input,index) => expect(read(`SELECT difficulty_choice FROM discovery_run_players WHERE version_key=${index+1}`)?.difficulty_choice)
      .toBe(suggestProgressionDifficulty(input)));
    expect(read('SELECT COUNT(*) AS count FROM discovery_run_players')?.count).toBe(inputs.length);
  });
  it('pins an expanded assembly, including when the anchor version stays unchanged', async () => {
    target('1,0');
    const snapshot=JSON.stringify({version:1,title:'Expanded',publishedAt:NOW,goal:{type:'reach_exit'},roomRefs:[]});
    sqlite.prepare(`INSERT INTO expanded_rooms
      (id,owner_user_id,owner_display_name,source_type,anchor_room_id,anchor_x,anchor_y,draft_json,published_json,
       published_version,created_at,updated_at,published_at) VALUES ('level','owner','Owner','native_expanded_room','0,0',0,0,?,?,1,?,?,?)`)
      .run(snapshot,snapshot,NOW,NOW,NOW);
    sqlite.prepare("INSERT INTO expanded_room_versions (expanded_room_id,version,snapshot_json,created_at) VALUES ('level',1,?,?)").run(snapshot,NOW);
    sqlite.exec(`INSERT INTO expanded_room_cells (expanded_room_id,expanded_room_version,cell_order,room_id,room_x,room_y,room_version)
      VALUES ('level',1,0,'0,0',0,0,1),('level',1,1,'1,0',1,0,1)`);
    sqlite.prepare("INSERT INTO featured_rooms (room_id,room_version,featured_at,target_key,target_version) VALUES ('0,0',1,?,'expanded_room:level',1)").run(NOW);
    await refreshPlayableContentIndexForExpandedRoom(env,'level');
    expect((await loadIndexedDiscoveryRows(env,null,48,'featured',false,0))?.[0]?.content_id).toBe('level');
    target('0,0',2); // Standalone head changes; the published assembly still pins v1.
    const feature = (targetVersion: number) => {
      const url=new URL('https://api.wamp.land/api/admin/rooms/0%2C0/feature');
      const request=new Request(url,{method:'POST',headers:{'Content-Type':'application/json','x-admin-key':'test-admin'},
        body:JSON.stringify({roomVersion:1,featured:true,targetKey:'expanded_room:level',targetVersion})});
      return handleAdminRequest(request,url,{...env,ADMIN_API_KEY:'test-admin'},{waitUntil:()=>{}});
    };
    expect((await feature(1)).status).toBe(200);
    expect(read("SELECT target_key,target_version,room_version FROM featured_rooms WHERE room_id='0,0'"))
      .toMatchObject({target_key:'expanded_room:level',target_version:1,room_version:1});
    await expect(feature(2)).rejects.toMatchObject({status:409});
    sqlite.prepare("INSERT INTO expanded_room_versions (expanded_room_id,version,snapshot_json,created_at) VALUES ('level',2,?,?)").run(snapshot,NOW);
    sqlite.exec(`INSERT INTO expanded_room_cells (expanded_room_id,expanded_room_version,cell_order,room_id,room_x,room_y,room_version)
      VALUES ('level',2,0,'0,0',0,0,1),('level',2,1,'1,0',1,0,1);
      UPDATE expanded_rooms SET published_version=2 WHERE id='level'`);
    await refreshPlayableContentIndexForExpandedRoom(env,'level');
    expect(await loadIndexedDiscoveryRows(env,null,48,'featured',false,0)).toHaveLength(0);
  });
  it('loads whole-level trophies on the exact version and respects D1 bind limits', async () => {
    sqlite.prepare(`INSERT INTO content_trophies (content_type,content_id,version_key,trophy_type,awarded_at)
      VALUES ('room','0,0',1,'highly_rated',?),('course','legacy',2,'highly_rated',?),
        ('expanded_room','course:legacy',2,'highly_rated',?),('expanded_room','course:legacy',1,'highly_rated',?)`)
      .run(NOW,NOW,NOW,NOW);
    const prepare=vi.spyOn(env.DB,'prepare');
    const targets=[{expandedRoomId:'course:legacy',expandedRoomVersion:2},
      ...Array.from({length:26},(_,index)=>({expandedRoomId:'empty'+index,expandedRoomVersion:1}))];
    const trophies=await loadExpandedDiscoveryTrophies(env,targets);
    expect(trophies.size).toBe(1);
    expect(trophies.get('course:legacy:2')).toMatchObject({contentType:'expanded_room',versionKey:2});
    expect(prepare).toHaveBeenCalledTimes(2);
    sqlite.exec("DELETE FROM content_trophies WHERE content_type='expanded_room'");
    expect((await loadExpandedDiscoveryTrophies(env,targets)).get('course:legacy:2')?.contentType).toBe('course');
  });
});

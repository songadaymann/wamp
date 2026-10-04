import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { D1Database, D1PreparedStatement, Env } from '../core/types';
import { createDefaultRoomRecord, createRoomVersionRecord, type RoomRecord } from '../../../persistence/roomModel';
import type { RoomRunRecord } from '../../../runs/model';
export const NOW = '2026-10-04T17:00:00.000Z';
class Statement implements D1PreparedStatement {
  values: (string | number | null)[] = [];
  constructor(readonly sql: string, readonly db: DatabaseSync) {}
  bind(...values: unknown[]): this {
    this.values = values.map(value => {
      if (value === null || typeof value === 'string' || typeof value === 'number') return value;
      throw new Error('Unexpected SQL parameter');
    }); return this;
  }
  async first<T>(): Promise<T | null> { return (this.db.prepare(this.sql).get(...this.values) as T | undefined) ?? null; }
  async all<T>(): Promise<{ results: T[] }> { return { results: this.db.prepare(this.sql).all(...this.values) as T[] }; }
}
class Database implements D1Database {
  constructor(readonly sqlite: DatabaseSync) {}
  prepare(sql: string): Statement { return new Statement(sql, this.sqlite); }
  withSession(): this { return this; }
  async batch<T>(statements: D1PreparedStatement[]): Promise<T[]> {
    this.sqlite.exec('BEGIN');
    try {
      const result = statements.map(query => {
        if (!(query instanceof Statement)) throw new Error('Unexpected statement');
        return { results: this.sqlite.prepare(query.sql).all(...query.values) } as T;
      }); this.sqlite.exec('COMMIT'); return result;
    } catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
}
export function fixture(includeActivity = true) {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys = ON');
  const directory = new URL('../../../../migrations/', import.meta.url);
  for (const file of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) {
    if (!includeActivity && file.startsWith('0055_')) continue;
    sqlite.exec(readFileSync(new URL(file, directory), 'utf8'));
  }
  for (const user of ['builder', 'p1', 'p2', 'p3', 'generated']) sqlite.prepare('INSERT INTO users (id,email,display_name,created_at,updated_at) VALUES (?,?,?,?,?)')
    .run(user, `${user}@example.test`, user, NOW, NOW);
  const record = createDefaultRoomRecord('0,0', { x: 0, y: 0 }); record.claimerUserId = 'builder';
  const snapshot = record.draft; snapshot.status = 'published'; snapshot.version = 1;
  snapshot.title = 'Lava Gauntlet'; snapshot.goal = { type: 'reach_exit', exit: { x: 700, y: 320 }, timeLimitMs: null }; snapshot.publishedAt = NOW;
  record.published = snapshot; record.versions = [createRoomVersionRecord(snapshot, { publishedByUserId: 'builder', publishedByDisplayName: 'builder' })];
  const json = JSON.stringify(snapshot);
  sqlite.prepare(`INSERT INTO rooms (id,x,y,draft_json,published_json,published_title,claimer_user_id) VALUES ('0,0',0,0,?,?,'Lava Gauntlet','builder')`).run(json, json);
  sqlite.prepare(`INSERT INTO room_versions (room_id,version,snapshot_json,title,created_at,published_by_user_id) VALUES ('0,0',1,?,'Lava Gauntlet',?,'builder')`).run(json, NOW);
  const db = new Database(sqlite); const env: Env = { DB: db, JAM_DB: db, ASSETS: { fetch: async () => new Response() } };
  return { sqlite, env, record, migrate: () => sqlite.exec(readFileSync(new URL('0055_builder_activity.sql', directory), 'utf8')) };
}
export function award(f: ReturnType<typeof fixture>, id: string, kind = 'unique_completion_room', actor = 'p1', at = NOW, structured = true): void {
  f.sqlite.prepare(`INSERT OR IGNORE INTO bxp_events (id,user_id,event_type,source_type,source_id,dedupe_key,amount,breakdown_json,created_at) VALUES (?,'builder',?,'room_completion',?,?,1,?,?)`)
    .run(id, kind, `0,0:1:${actor}`, id, structured ? JSON.stringify({ activity: { contentType: 'room', contentId: '0,0', version: 1, actorUserId: actor, qualityStars: kind === 'unique_rating_room' ? 4 : null } }) : null, at);
}
export function top1(f: ReturnType<typeof fixture>, id: string, displaced = 'p1', at = NOW): void {
  f.sqlite.prepare(`INSERT INTO pxp_events (id,user_id,event_type,source_type,source_id,dedupe_key,amount,breakdown_json,created_at) VALUES (?,'p2','top1_take','room_attempt',?,?,1,?,?)`)
    .run(id, id, id, JSON.stringify({ activity: { contentType: 'room', contentId: '0,0', version: 1, builderUserId: 'builder', dethronedUserId: displaced } }), at);
}
export function run(f: ReturnType<typeof fixture>, id: string, user = 'p1', elapsedMs = 10000, status = 'passed', version = 1): RoomRunRecord {
  f.sqlite.prepare(`INSERT INTO room_runs (attempt_id,room_id,room_x,room_y,room_version,goal_type,goal_json,user_id,user_display_name,started_at,finished_at,result,elapsed_ms,verification_status)
    VALUES (?,'0,0',0,0,?,'reach_exit','{"type":"reach_exit"}',?,?,?,?,'completed',?,?)`).run(id, version, user, user, NOW, NOW, elapsedMs, status);
  return { attemptId: id, roomId: '0,0', roomCoordinates: { x: 0, y: 0 }, roomVersion: version,
    goalType: 'reach_exit', goal: { type: 'reach_exit', exit: { x: 700, y: 320 }, timeLimitMs: null }, userId: user, userDisplayName: user, startedAt: NOW, finishedAt: NOW,
    result: 'completed', elapsedMs, deaths: 0, score: 100, collectiblesCollected: 0, enemiesDefeated: 0, checkpointsReached: 0,
    verificationStatus: status as RoomRunRecord['verificationStatus'] };
}
export function params(record: RoomRecord, value: RoomRunRecord) { return { roomRecord: record, run: value,
  goal: value.goal, creatorUserId: 'builder', isFirstCompletion: true, isNewPersonalBest: true, completedAt: NOW }; }

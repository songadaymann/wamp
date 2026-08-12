import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { RoomGoal } from '../../../goals/roomGoals';
import type { D1Database, D1PreparedStatement, Env } from '../core/types';
import {
  loadRankedRoomLeaderboardRows,
  loadViewerRankedRoomLeaderboardRow,
} from './leaderboards';

const REACH_EXIT_GOAL: RoomGoal = {
  type: 'reach_exit',
  exit: { x: 1, y: 1 },
  timeLimitMs: null,
};

describe('room leaderboard SQL', () => {
  const databases: DatabaseSync[] = [];

  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
  });

  it('ranks and deduplicates runs across more than 100 family versions with three binds', async () => {
    const sqlite = createDatabase();
    databases.push(sqlite);
    const database = new RecordingSqliteD1Database(sqlite);
    const env = { DB: database } as unknown as Env;
    const versions = Array.from({ length: 101 }, (_, index) => index + 1);
    insertRun(sqlite, {
      attemptId: 'alice-old',
      roomVersion: 1,
      userId: 'alice',
      userDisplayName: 'Alice',
      elapsedMs: 3_000,
    });
    insertRun(sqlite, {
      attemptId: 'alice-best',
      roomVersion: 101,
      userId: 'alice',
      userDisplayName: 'Alice',
      elapsedMs: 1_000,
    });
    insertRun(sqlite, {
      attemptId: 'bob-best',
      roomVersion: 50,
      userId: 'bob',
      userDisplayName: 'Bob',
      elapsedMs: 2_000,
    });

    const rows = await loadRankedRoomLeaderboardRows(
      env,
      '0,0',
      versions,
      REACH_EXIT_GOAL,
      25,
    );

    expect(rows.map((row) => ({
      attemptId: row.attempt_id,
      roomVersion: row.room_version,
      rank: Number(row.overall_rank),
    }))).toEqual([
      { attemptId: 'alice-best', roomVersion: 101, rank: 1 },
      { attemptId: 'bob-best', roomVersion: 50, rank: 2 },
    ]);
    expect(database.queries[0]).toContain('FROM json_each(?)');
    expect(database.bindings[0]).toEqual(['0,0', JSON.stringify(versions), 25]);
  });

  it('loads a viewer rank across more than 100 family versions with three binds', async () => {
    const sqlite = createDatabase();
    databases.push(sqlite);
    const database = new RecordingSqliteD1Database(sqlite);
    const env = { DB: database } as unknown as Env;
    const versions = Array.from({ length: 101 }, (_, index) => index + 1);
    insertRun(sqlite, {
      attemptId: 'alice-best',
      roomVersion: 101,
      userId: 'alice',
      userDisplayName: 'Alice',
      elapsedMs: 1_000,
    });
    insertRun(sqlite, {
      attemptId: 'bob-best',
      roomVersion: 1,
      userId: 'bob',
      userDisplayName: 'Bob',
      elapsedMs: 2_000,
    });

    const row = await loadViewerRankedRoomLeaderboardRow(
      env,
      '0,0',
      versions,
      REACH_EXIT_GOAL,
      'bob',
    );

    expect(row).toMatchObject({
      attempt_id: 'bob-best',
      room_version: 1,
      overall_rank: 2,
    });
    expect(database.queries[0]).toContain('FROM json_each(?)');
    expect(database.bindings[0]).toEqual(['0,0', JSON.stringify(versions), 'bob']);
  });
});

class RecordingSqliteD1Statement implements D1PreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly recordBindings: (values: unknown[]) => void,
    private readonly boundValues: SqliteValue[] = [],
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.recordBindings(values);
    return new RecordingSqliteD1Statement(
      this.database,
      this.sql,
      this.recordBindings,
      values.map(toSqliteValue),
    );
  }

  async first<T>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.boundValues) as T | undefined) ?? null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.database.prepare(this.sql).all(...this.boundValues) as T[] };
  }
}

class RecordingSqliteD1Database implements D1Database {
  readonly queries: string[] = [];
  readonly bindings: unknown[][] = [];

  constructor(private readonly database: DatabaseSync) {}

  prepare(sql: string): D1PreparedStatement {
    this.queries.push(sql);
    return new RecordingSqliteD1Statement(
      this.database,
      sql,
      (values) => this.bindings.push(values),
    );
  }

  async batch<T>(): Promise<T[]> {
    throw new Error('Batch is not used by these leaderboard tests.');
  }
}

type SqliteValue = null | number | bigint | string | Uint8Array;

function toSqliteValue(value: unknown): SqliteValue {
  if (
    value === null
    || typeof value === 'number'
    || typeof value === 'bigint'
    || typeof value === 'string'
    || value instanceof Uint8Array
  ) {
    return value;
  }
  throw new TypeError(`Unsupported SQLite test binding: ${typeof value}.`);
}

function createDatabase(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE room_runs (
      attempt_id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      room_version INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      user_display_name TEXT NOT NULL,
      elapsed_ms INTEGER,
      deaths INTEGER NOT NULL,
      score INTEGER NOT NULL,
      finished_at TEXT,
      result TEXT NOT NULL,
      verification_status TEXT
    );
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT,
      wallet_address TEXT
    );
    CREATE TABLE playfun_user_links (
      user_id TEXT NOT NULL
    );
  `);
  return database;
}

function insertRun(
  database: DatabaseSync,
  values: {
    attemptId: string;
    roomVersion: number;
    userId: string;
    userDisplayName: string;
    elapsedMs: number;
  },
): void {
  database.prepare(`
    INSERT INTO room_runs (
      attempt_id,
      room_id,
      room_version,
      user_id,
      user_display_name,
      elapsed_ms,
      deaths,
      score,
      finished_at,
      result,
      verification_status
    )
    VALUES (?, '0,0', ?, ?, ?, ?, 0, 0, '2026-08-12T00:00:00.000Z', 'completed', 'passed')
  `).run(
    values.attemptId,
    values.roomVersion,
    values.userId,
    values.userDisplayName,
    values.elapsedMs,
  );
}

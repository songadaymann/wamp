import { describe, expect, it } from 'vitest';
import { createDefaultRoomPatternMusic } from '../../../music/pattern';
import { createDefaultRoomSnapshot } from '../../../persistence/roomModel';
import type { D1Database, D1PreparedStatement, Env } from '../core/types';
import { prepareMusicPhrasePublishStatements } from './store';

class RecordingStatement implements D1PreparedStatement {
  values: unknown[] = [];

  constructor(
    readonly query: string,
    private readonly firstResult: unknown,
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.values = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    return this.firstResult as T | null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: [] };
  }
}

function createEnv(existingBatchId: string | null): {
  env: Env;
  statements: RecordingStatement[];
} {
  const statements: RecordingStatement[] = [];
  const db: D1Database = {
    prepare(query: string): D1PreparedStatement {
      const firstResult = query.includes('FROM music_phrase_batches')
        ? existingBatchId
          ? { id: existingBatchId }
          : null
        : null;
      const statement = new RecordingStatement(query, firstResult);
      statements.push(statement);
      return statement;
    },
    async batch<T>(): Promise<T[]> {
      return [];
    },
  };

  return {
    env: {
      DB: db,
      JAM_DB: db,
      ASSETS: { fetch: async () => new Response() },
    },
    statements,
  };
}

function createPublishedPatternRoom() {
  const room = createDefaultRoomSnapshot('6,12', { x: 6, y: 12 });
  const music = createDefaultRoomPatternMusic();
  music.tabs.drums['kick-1'] = [0, 8, 16, 24];
  return {
    ...room,
    title: 'Backrooms rage Reach Exit',
    music,
    status: 'published' as const,
    publishedAt: '2026-07-26T14:00:00.000Z',
  };
}

const ACTOR = {
  userId: 'wallet-user',
  principalKind: 'user' as const,
  agentId: null,
  displayName: 'Wallet Player',
};

describe('published music phrase batches', () => {
  it('reuses a phrase batch saved before the room was first published', async () => {
    const existingBatchId = 'existing-version-one-batch';
    const { env } = createEnv(existingBatchId);

    const statements = await prepareMusicPhrasePublishStatements(
      env,
      createPublishedPatternRoom(),
      ACTOR,
    ) as RecordingStatement[];

    expect(statements.some((statement) =>
      statement.query.includes('INSERT INTO music_phrase_batches'))).toBe(false);
    const phraseInsert = statements.find((statement) =>
      statement.query.includes('INSERT INTO music_phrases'));
    expect(phraseInsert?.values[1]).toBe(existingBatchId);
  });

  it('creates one batch when the room version has no saved phrase batch', async () => {
    const { env } = createEnv(null);

    const statements = await prepareMusicPhrasePublishStatements(
      env,
      createPublishedPatternRoom(),
      ACTOR,
    ) as RecordingStatement[];

    const batchInserts = statements.filter((statement) =>
      statement.query.includes('INSERT INTO music_phrase_batches'));
    expect(batchInserts).toHaveLength(1);
    const phraseInsert = statements.find((statement) =>
      statement.query.includes('INSERT INTO music_phrases'));
    expect(phraseInsert?.values[1]).toBe(batchInserts[0]?.values[0]);
  });
});

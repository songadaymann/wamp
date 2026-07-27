import { describe, expect, it } from 'vitest';
import type { D1Database, D1PreparedStatement, Env } from '../core/types';
import { loadAdminGameJams } from './gameJams';

describe('Launch Admin Game Jams', () => {
  it('groups future jams and reconciles registrations with submissions by account or email', async () => {
    const registrations = [
      {
        id: 'registration-account',
        jam_slug: 'future-jam-2027',
        username: 'Builder One',
        email: 'one@example.com',
        email_normalized: 'one@example.com',
        matched_user_id: 'user-one',
        created_at: '2027-01-01T10:00:00.000Z',
        updated_at: '2027-01-01T10:00:00.000Z',
      },
      {
        id: 'registration-email',
        jam_slug: 'future-jam-2027',
        username: 'Builder Two',
        email: 'TWO@example.com',
        email_normalized: 'two@example.com',
        matched_user_id: null,
        created_at: '2027-01-02T10:00:00.000Z',
        updated_at: '2027-01-02T10:00:00.000Z',
      },
      {
        id: 'registration-waiting',
        jam_slug: 'future-jam-2027',
        username: 'Still Building',
        email: 'waiting@example.com',
        email_normalized: 'waiting@example.com',
        matched_user_id: null,
        created_at: '2027-01-03T10:00:00.000Z',
        updated_at: '2027-01-03T10:00:00.000Z',
      },
    ];
    const submissions = [
      {
        id: 'submission-account',
        jam_slug: 'future-jam-2027',
        user_id: 'user-one',
        username: 'Builder One',
        email: 'changed@example.com',
        room_x: 6,
        room_y: 12,
        room_url: 'https://wamp.land/r/6/12',
        created_at: '2027-01-04T10:00:00.000Z',
        updated_at: '2027-01-04T10:00:00.000Z',
      },
      {
        id: 'submission-email',
        jam_slug: 'future-jam-2027',
        user_id: 'user-two',
        username: 'Builder Two',
        email: 'two@example.com',
        room_x: 7,
        room_y: 13,
        room_url: 'https://wamp.land/r/7/13',
        created_at: '2027-01-05T10:00:00.000Z',
        updated_at: '2027-01-05T10:00:00.000Z',
      },
      {
        id: 'submission-only',
        jam_slug: 'future-jam-2027',
        user_id: 'user-three',
        username: 'Submission Only',
        email: 'three@example.com',
        room_x: 8,
        room_y: 14,
        room_url: 'https://wamp.land/r/8/14',
        created_at: '2027-01-06T10:00:00.000Z',
        updated_at: '2027-01-06T10:00:00.000Z',
      },
    ];
    const users = [
      {
        id: 'user-one',
        display_name: 'Current One',
        username: 'current-one',
        email: 'account-one@example.com',
        wallet_address: '0x1111111111111111111111111111111111111111',
      },
      {
        id: 'user-two',
        display_name: 'Current Two',
        username: 'current-two',
        email: 'two@example.com',
        wallet_address: null,
      },
      {
        id: 'user-three',
        display_name: 'Current Three',
        username: null,
        email: 'three@example.com',
        wallet_address: '0x3333333333333333333333333333333333333333',
      },
    ];
    const env = createEnv(registrations, submissions, users);

    const response = await loadAdminGameJams(env);
    const futureJam = response.jams.find((jam) => jam.slug === 'future-jam-2027');

    expect(response.jams.some((jam) => jam.slug === 'solo-room-jam-2026-07')).toBe(true);
    expect(futureJam).toMatchObject({
      registrationCount: 3,
      submissionCount: 3,
      awaitingSubmissionCount: 1,
    });
    expect(futureJam?.participants).toHaveLength(4);
    expect(futureJam?.participants.find(
      (participant) => participant.registration?.id === 'registration-account',
    )).toMatchObject({
      account: { id: 'user-one', displayName: 'Current One' },
      submission: { id: 'submission-account', roomX: 6, roomY: 12 },
    });
    expect(futureJam?.participants.find(
      (participant) => participant.registration?.id === 'registration-email',
    )).toMatchObject({
      account: { id: 'user-two', displayName: 'Current Two' },
      submission: { id: 'submission-email', roomX: 7, roomY: 13 },
    });
    expect(futureJam?.participants.find(
      (participant) => participant.submission?.id === 'submission-only',
    )?.registration).toBeNull();
  });
});

function createEnv(
  registrations: Array<Record<string, unknown>>,
  submissions: Array<Record<string, unknown>>,
  users: Array<Record<string, unknown>>,
): Env {
  const jamDatabase = createDatabase((query) => {
    if (query.includes('FROM jam_registrations')) {
      return registrations;
    }
    if (query.includes('FROM jam_submissions')) {
      return submissions;
    }
    return [];
  });
  const appDatabase = createDatabase((query, values) => {
    if (!query.includes('FROM users')) {
      return [];
    }
    const ids = new Set(values.map(String));
    return users.filter((user) => ids.has(String(user.id)));
  });
  return {
    DB: appDatabase,
    JAM_DB: jamDatabase,
    ASSETS: { fetch: async () => new Response() },
  };
}

function createDatabase(
  resolve: (query: string, values: unknown[]) => Array<Record<string, unknown>>,
): D1Database {
  class Statement implements D1PreparedStatement {
    private values: unknown[] = [];

    constructor(private readonly query: string) {}

    bind(...values: unknown[]): D1PreparedStatement {
      this.values = values;
      return this;
    }

    async first<T>(): Promise<T | null> {
      return (resolve(this.query, this.values)[0] ?? null) as T | null;
    }

    async all<T>(): Promise<{ results: T[] }> {
      return { results: resolve(this.query, this.values) as T[] };
    }
  }

  return {
    prepare(query: string): D1PreparedStatement {
      return new Statement(query);
    },
    async batch<T>(statements: D1PreparedStatement[]): Promise<T[]> {
      return Promise.all(statements.map((statement) => statement.all().then((result) => result as T)));
    },
  };
}

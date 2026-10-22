import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { D1PreparedStatement, Env } from '../core/types';
import { checkDatabaseSize } from './databaseSize';

let db: DatabaseSync;
let size = 1_000;
function statement(sql: string, values: unknown[] = []): D1PreparedStatement {
  return { bind: (...next: unknown[]) => statement(sql, next),
    async first<T>() { return (db.prepare(sql).get(...values as []) ?? null) as T | null; },
    async all<T>() { return { results: db.prepare(sql).all(...values as []) as T[], meta: { size_after: size } }; } } as D1PreparedStatement;
}
const env = () => ({
  DB: { prepare: statement, async batch(statements: D1PreparedStatement[]) { return Promise.all(statements.map((query) => query.all())); } },
  RESEND_API_KEY: 'test-key', ADMIN_REVIEW_EMAIL: 'ops@example.test',
}) as unknown as Env;
beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(readFileSync('migrations/0049_rate_limit_events.sql', 'utf8'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => { db.close(); vi.restoreAllMocks(); });

describe('database size warning', () => {
  it('stays quiet below 8 GB and emails at most once a day above it', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: 'email-1' }), { status: 200 }));
    size = 7_900_000_000;
    expect(await checkDatabaseSize(env(), new Date(), fetcher)).toMatchObject({ status: 'ok' });
    size = 8_400_000_000;
    expect(await checkDatabaseSize(env(), new Date(), fetcher)).toMatchObject({ status: 'sent', bytes: 8_400_000_000 });
    expect(await checkDatabaseSize(env(), new Date(), fetcher)).toMatchObject({ status: 'already_sent' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ to: 'ops@example.test', subject: 'WAMP database at 8.4 GB of 10 GB' });
  });

  it('reports an unknown size without failing the hourly job', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    size = Number.NaN;
    expect(await checkDatabaseSize(env())).toEqual({ status: 'unknown' });
  });

  it('tries again next hour when the email could not be sent', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    size = 9_000_000_000;
    const failing = vi.fn(async () => new Response('busy', { status: 503 }));
    expect(await checkDatabaseSize(env(), new Date(), failing)).toMatchObject({ status: 'failed' });
    const working = vi.fn(async () => new Response(JSON.stringify({ id: 'email-2' }), { status: 200 }));
    expect(await checkDatabaseSize(env(), new Date(), working)).toMatchObject({ status: 'sent' });
  });
});

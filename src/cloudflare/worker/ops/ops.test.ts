import { readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixture } from '../activity/testDatabase';
import { HttpError } from '../core/http';
import { apiErrorResponse, handleClientErrorReport, redactClientErrorText } from './errors';
import { handleHealth, resetHealthCacheForTests } from './health';
import { LATEST_D1_MIGRATION } from './migrations';

const url = new URL('https://api.wamp.land/api/rooms/1%2C2/draft');
const request = (headers: Record<string, string> = {}) => new Request(url, { method: 'PUT', headers: { Origin: 'https://wamp.land', ...headers } });

afterEach(() => vi.restoreAllMocks());

describe('LATEST_D1_MIGRATION (F192)', () => {
  it('is the newest file in migrations/ — update it when adding a migration', () => {
    const newest = readdirSync(new URL('../../../../migrations/', import.meta.url)).filter((name) => name.endsWith('.sql')).sort().at(-1);
    expect(LATEST_D1_MIGRATION).toBe(newest);
  });
});

describe('/api/health (F192)', () => {
  beforeEach(() => resetHealthCacheForTests());
  const health = (f: ReturnType<typeof fixture>, now?: number) => handleHealth(new Request('https://api.wamp.land/api/health'), f.env, now);
  const withMigrations = (names: string[]) => {
    const f = fixture();
    f.sqlite.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT)');
    for (const name of names) f.sqlite.prepare('INSERT INTO d1_migrations (name, applied_at) VALUES (?, ?)').run(name, '2026-10-10');
    return f;
  };

  it('is healthy when the database has every migration this code expects', async () => {
    const response = await health(withMigrations(['0063_run_ghost_archive.sql', LATEST_D1_MIGRATION]));
    const body = await response.json() as { ok: boolean; storage: string; checks: { database: { ok: boolean }; worldTileOutbox: { pending: number } } };
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, storage: 'd1', checks: { database: { ok: true }, worldTileOutbox: { pending: 0 } } });
  });

  it('reports 503 when the code was deployed before its migration was applied', async () => {
    const response = await health(withMigrations(['0063_run_ghost_archive.sql']));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, checks: { database: { ok: false, latestApplied: '0063_run_ghost_archive.sql', expected: LATEST_D1_MIGRATION } } });
  });

  it('reports 503 when the database cannot be read, and probes it at most every 30 s', async () => {
    const f = fixture();
    const prepare = vi.spyOn(f.env.DB, 'prepare');
    expect((await health(f, 1_000)).status).toBe(503);
    const probes = prepare.mock.calls.length;
    await health(f, 20_000);
    expect(prepare.mock.calls.length).toBe(probes);
    await health(f, 31_000);
    expect(prepare.mock.calls.length).toBeGreaterThan(probes);
  });
});

describe('API error replies (F185)', () => {
  it('keeps client-error messages and deliberate server messages', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const notFound = apiErrorResponse(request(), url, new HttpError(404, 'Room not found.'));
    expect([notFound.status, await notFound.json()]).toEqual([404, { error: 'Room not found.' }]);
    const unconfigured = apiErrorResponse(request({ 'cf-ray': 'abc123-EWR' }), url, new HttpError(503, 'Room minting is not configured on this backend.'));
    expect([unconfigured.status, await unconfigured.json()]).toEqual([503, { error: 'Room minting is not configured on this backend.', requestId: 'abc123-EWR' }]);
  });

  it('hides unexpected failures behind a reference and logs them with their route', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = apiErrorResponse(request({ 'cf-ray': 'abc123-EWR' }), url, new Error('D1_ERROR: no such column: secret_column'));
    const body = await response.json() as { error: string; requestId: string };
    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Something went wrong on our side. Reference: abc123-EWR.', requestId: 'abc123-EWR' });
    expect(JSON.parse(String(logged.mock.calls[0][0]))).toMatchObject({ kind: 'api_error', status: 500, method: 'PUT', route: '/api/rooms/1%2C2/draft', requestId: 'abc123-EWR', message: 'D1_ERROR: no such column: secret_column' });
  });
});

describe('client error reports (F185)', () => {
  const report = (body: unknown, ip = '203.0.113.7') => new Request('https://api.wamp.land/api/client-errors', {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'CF-Connecting-IP': ip }, body: typeof body === 'string' ? body : JSON.stringify(body),
  });

  it('logs a redacted report and stores nothing but a rate-limit slot', async () => {
    const f = fixture();
    const logged = vi.spyOn(console, 'log').mockImplementation(() => {});
    const response = await handleClientErrorReport(report({ type: 'error', message: 'Cannot read x of undefined for ada@example.com',
      source: 'https://wamp.land/assets/cache-v2/main.js?token=abc', line: 12, stack: `at f (https://wamp.land/a.js?x=1)\n${'k'.repeat(40)}`, route: '/r/1/2' }), f.env);
    expect(response.status).toBe(204);
    const entry = JSON.parse(String(logged.mock.calls[0][0]));
    expect(entry).toMatchObject({ kind: 'client_error', type: 'error', message: 'Cannot read x of undefined for [email]', source: 'https://wamp.land/assets/cache-v2/main.js', line: 12, route: '/r/1/2' });
    expect(entry.stack).toBe('at f (https://wamp.land/a.js)\n[token]');
  });

  it('rejects oversized or malformed reports and drops a flood quietly', async () => {
    const f = fixture();
    const logged = vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(handleClientErrorReport(report('x'.repeat(9_000)), f.env)).rejects.toMatchObject({ status: 413 });
    await expect(handleClientErrorReport(report('not json'), f.env)).rejects.toMatchObject({ status: 400 });
    await expect(handleClientErrorReport(report({ message: '' }), f.env)).rejects.toMatchObject({ status: 400 });
    for (let index = 0; index < 32; index += 1) {
      expect((await handleClientErrorReport(report({ message: `boom ${index}` }), f.env)).status).toBe(204);
    }
    expect(logged).toHaveBeenCalledTimes(30);
  });

  it('redacts emails, tokens and query strings', () => {
    expect(redactClientErrorText('mail bob+x@mail.example.org at https://a.test/p?q=1#h', 200)).toBe('mail [email] at https://a.test/p');
  });
});

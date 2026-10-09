import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ id: null as string | null }));
vi.mock('../auth/request', async importActual => ({ ...await importActual<object>(),
  loadOptionalRequestAuth: async () => auth.id ? { user: { id: auth.id } } : null }));
import { handleBugReports, purgeBugReports } from './routes';
import { validateBugReport } from './validation';
import type { D1Database, D1PreparedStatement, Env } from '../core/types';
let db: DatabaseSync, env: Env;
function statement(sql: string, values: unknown[] = []): D1PreparedStatement {
  return { bind: (...next) => statement(sql, next),
    async first<T>() { return (db.prepare(sql).get(...values as []) ?? null) as T | null; },
    async all<T>() { return { results: db.prepare(sql).all(...values as []) as T[] }; } };
}
beforeEach(() => {
  auth.id = null; db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON');
  db.exec(readFileSync('migrations/0060_bug_reports.sql','utf8'));
  const database: D1Database = { prepare: statement, async batch<T>(statements: D1PreparedStatement[]): Promise<T[]> {
    db.exec('BEGIN'); try { const results = []; for (const query of statements) results.push(await query.all()); db.exec('COMMIT'); return results as T[]; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }, withSession: () => database };
  env = { DB: database, JAM_DB: database, ASSETS: { fetch: async () => new Response() }, ADMIN_API_KEY: 'test-key' };
});
afterEach(() => db.close());
function body() { return { id: crypto.randomUUID(), visitor: crypto.randomUUID(), notes: 'Camera jerks while running', build: 'abc123',
  context: { coordinates: { x: -17, y: 10 }, roomVersion: 3, source: 'published', token: 'secret' },
  device: { browser: 'Chrome', width: 1440, height: 900, password: 'secret' }, errors: [{ kind: 'runtime', source: 'assets/main.js', line: 10, message: 'secret form' }],
  evidence: { samples: [{ sequence: 0, time: 0, mode: 'play', screen: 'game', room: '-17,10', player: { x: 10, y: 30, token: 'secret' }, actions: [], image: 'data:image/jpeg;base64,/9j/AAAA' }],
    screenshot: 'data:image/jpeg;base64,/9j/AAAA', reason: 'captured' } }; }
const call = (path: string, data?: unknown, admin = false, method = data ? 'POST' : 'GET') => {
  const url = new URL(`https://api.wamp.land${path}`);
  return handleBugReports(new Request(url, { method, headers: { Origin: 'https://wamp.land', 'CF-Connecting-IP': '203.0.113.1',
    ...(admin ? { 'x-admin-key': 'test-key' } : {}) }, body: data ? JSON.stringify(data) : undefined }), url, env);
};
it('stores guest and signed-in reports privately, deduplicates retry and strips sensitive fields', async () => {
  const report = body(); expect((await call('/api/bug-reports', report)).status).toBe(200);
  await call('/api/bug-reports', report);
  expect(db.prepare('SELECT COUNT(*) n FROM bug_reports').get()).toMatchObject({ n: 1 });
  await expect(call('/api/admin/bug-reports')).rejects.toMatchObject({ status: 403 });
  await expect(call(`/api/admin/bug-reports/${report.id}`)).rejects.toMatchObject({ status: 403 });
  const detail = await (await call(`/api/admin/bug-reports/${report.id}`, undefined, true)).json();
  expect(JSON.stringify(detail)).not.toContain('secret');
  expect(detail.report.context).toMatchObject({ roomId: '-17,10', roomVersion: 3 });
  expect(detail.report.evidence.samples).toHaveLength(1);
  await expect(call('/api/bug-reports', { ...report, visitor: crypto.randomUUID() })).rejects.toMatchObject({ status: 409 });
  auth.id = 'verified-user'; const signed = body(); await call('/api/bug-reports', signed);
  expect(db.prepare('SELECT user_id FROM bug_reports WHERE id=?').get(signed.id)).toMatchObject({ user_id: 'verified-user' });
});
it('supports status filters, safe written reports, image expiry and eventual cascading deletion', async () => {
  const report = body(); await call('/api/bug-reports', report);
  await call(`/api/admin/bug-reports/${report.id}`, { status: 'resolved' }, true, 'PATCH');
  const open = await (await call('/api/admin/bug-reports', undefined, true)).json(); expect(open.reports).toHaveLength(0);
  const resolved = await (await call('/api/admin/bug-reports?status=resolved', undefined, true)).json(); expect(resolved.reports).toHaveLength(1);
  db.exec("UPDATE bug_report_evidence SET expires_at='2000-01-01'"); await purgeBugReports(env);
  const detail = await (await call(`/api/admin/bug-reports/${report.id}`, undefined, true)).json(); expect(detail.report.evidence.samples).toHaveLength(0);
  expect(detail.report.notes).toContain('Camera');
  const written = { ...body(), evidence: { samples: [], screenshot: null, reason: 'disabled' } }; await call('/api/bug-reports', written);
  expect(db.prepare('SELECT COUNT(*) n FROM bug_report_evidence').get()).toMatchObject({ n: 0 });
  db.exec("UPDATE bug_reports SET expires_at='2000-01-01'"); await purgeBugReports(env);
  expect(db.prepare('SELECT COUNT(*) n FROM bug_reports').get()).toMatchObject({ n: 0 });
});
it('enforces identity and atomic image budgets, with written submission available when images are full', async () => {
  const visitor = crypto.randomUUID();
  for (let i = 0; i < 5; i++) await call('/api/bug-reports', { ...body(), visitor });
  await expect(call('/api/bug-reports', { ...body(), visitor })).rejects.toMatchObject({ status: 429 });
  db.exec('UPDATE bug_report_evidence SET bytes=128000000');
  const limited = body(); await expect(call('/api/bug-reports', limited)).rejects.toMatchObject({ status: 429 });
  expect(db.prepare('SELECT id FROM bug_reports WHERE id=?').get(limited.id)).toBeUndefined();
  await call('/api/bug-reports', { ...limited, evidence: { samples: [], screenshot: null, reason: 'not_attached' } });
  expect(db.prepare('SELECT id FROM bug_reports WHERE id=?').get(limited.id)).toBeDefined();
});
it('rejects foreign mutation origins, oversized/malformed images and unbounded replay payloads', async () => {
  const url = new URL('https://api.wamp.land/api/bug-reports');
  await expect(handleBugReports(new Request(url, { method: 'POST', headers: { Origin: 'https://evil.example' }, body: JSON.stringify(body()) }),url,env))
    .rejects.toMatchObject({ status: 403 });
  for (const evidence of [{ ...body().evidence, screenshot: 'data:text/html,<script>' },
    { ...body().evidence, samples: Array(121).fill(body().evidence.samples[0]) },
    { ...body().evidence, reason: 'disabled' }, { ...body().evidence, screenshot: 'x'.repeat(8001) }])
    expect(() => validateBugReport({ ...body(), evidence })).toThrow();
  await expect(handleBugReports(new Request(url, { method: 'POST', headers: { Origin: 'https://wamp.land', 'Content-Length': '2000000' }, body: '{}' }),url,env))
    .rejects.toMatchObject({ status: 413 });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '../core/http';
import type { Env } from '../core/types';
import { handleAdminRequest } from './routes';
import {
  createRecordingDatabase,
  normalizeSql,
  readRepoFile,
  readTypeScriptImportClosure,
  type RecordedD1Query,
} from './t14ContractTestSupport';

const NOW = '2026-08-13T16:00:00.000Z';

afterEach(() => {
  vi.useRealTimers();
});

describe('T14 suspicious admin route response contracts', () => {
  it('returns the complete empty summary model and preserves the default review window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const { env, queries } = createAdminEnv();
    const request = adminRequest('/api/admin/suspicious/summary');

    const response = await handleAdminRequest(request, new URL(request.url), env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      generatedAt: NOW,
      windowHours: 24,
      counts: { openCases: 0, high: 0, medium: 0, low: 0 },
      recentInvalidations: [],
    });
    expect(queries).toHaveLength(4);
    expect(queries.map((query) => query.sql)).toEqual(expect.arrayContaining([
      expect.stringContaining('FROM room_runs r'),
      expect.stringContaining('FROM course_runs r'),
      expect.stringContaining('FROM point_events e'),
      expect.stringContaining('FROM admin_suspicious_invalidation_audit'),
    ]));
  });

  it('returns the stable filtered user-list model at the maximum supported window and limit', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const { env, queries } = createAdminEnv();
    const request = adminRequest(
      '/api/admin/suspicious/users?windowHours=168&limit=200&severity=high&signal=record_gap',
    );

    const response = await handleAdminRequest(request, new URL(request.url), env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      generatedAt: NOW,
      windowHours: 168,
      scope: 'review_window',
      total: 0,
      items: [],
    });
    expect(queries).toHaveLength(3);
  });

  it('rejects missing admin authorization before any suspicious query', async () => {
    const { env, queries } = createAdminEnv();
    const request = new Request('https://api.example.test/api/admin/suspicious/summary');

    await expect(handleAdminRequest(request, new URL(request.url), env)).rejects.toMatchObject({
      status: 403,
      message: 'Admin key is required to read suspicious activity summary.',
    });
    expect(queries).toHaveLength(0);
  });

  it('rejects invalid filters and out-of-range windows before reading D1', async () => {
    for (const path of [
      '/api/admin/suspicious/summary?windowHours=169',
      '/api/admin/suspicious/users?severity=critical',
      '/api/admin/suspicious/users?signal=unknown_signal',
    ]) {
      const { env, queries } = createAdminEnv();
      const request = adminRequest(path);
      await expect(handleAdminRequest(request, new URL(request.url), env)).rejects.toBeInstanceOf(
        HttpError,
      );
      expect(queries, path).toHaveLength(0);
    }
  });

  it('does not accept a mutating method at a read-only suspicious endpoint', async () => {
    const { env, queries } = createAdminEnv();
    const request = adminRequest('/api/admin/suspicious/summary', 'POST');

    await expect(handleAdminRequest(request, new URL(request.url), env)).rejects.toMatchObject({
      status: 404,
      message: 'Admin route not found.',
    });
    expect(queries).toHaveLength(0);
  });
});

describe('T14 suspicious analysis source contracts', () => {
  const routeSource = readRepoFile('src/cloudflare/worker/admin/routes.ts');
  const suspiciousClosure = readTypeScriptImportClosure(
    'src/cloudflare/worker/admin/suspicious.ts',
  );
  const normalizedClosure = normalizeSql(suspiciousClosure);

  it('pins every suspicious endpoint, method, handler, and decoded user-id route', () => {
    for (const routeContract of [
      "url.pathname === '/api/admin/suspicious/summary' && request.method === 'GET'",
      "url.pathname === '/api/admin/suspicious/users' && request.method === 'GET'",
      "suspiciousUserDetailMatch && request.method === 'GET'",
      "suspiciousPreviewMatch && request.method === 'POST'",
      "suspiciousInvalidateMatch && request.method === 'POST'",
      'handleAdminSuspiciousSummary(request, url, env)',
      'handleAdminSuspiciousUsers(request, url, env)',
      'handleAdminSuspiciousUserDetail(',
      'handleAdminSuspiciousInvalidatePreview(',
      'handleAdminSuspiciousInvalidate(',
      'decodeURIComponent(suspiciousUserDetailMatch[1])',
      'decodeURIComponent(suspiciousPreviewMatch[1])',
      'decodeURIComponent(suspiciousInvalidateMatch[1])',
    ]) {
      expect(routeSource).toContain(routeContract);
    }
    expect(routeSource).toContain(
      "const suspiciousUserDetailMatch = /^\\/api\\/admin\\/suspicious\\/users\\/([^/]+)$/.exec(url.pathname)",
    );
    expect(routeSource).toContain(
      "const suspiciousPreviewMatch = /^\\/api\\/admin\\/suspicious\\/users\\/([^/]+)\\/invalidate-preview$/.exec(",
    );
    expect(routeSource).toContain(
      "const suspiciousInvalidateMatch = /^\\/api\\/admin\\/suspicious\\/users\\/([^/]+)\\/invalidate$/.exec(",
    );
  });

  it('pins the analysis windows, limits, and every detection threshold', () => {
    for (const sourceLine of [
      'const DEFAULT_WINDOW_HOURS = 24;',
      'const MAX_WINDOW_HOURS = 24 * 7;',
      'const DEFAULT_USER_LIMIT = 50;',
      'const MAX_USER_LIMIT = 200;',
      'const MAX_RECENT_RUNS = 5_000;',
      'const MAX_RECENT_POINT_EVENTS = 5_000;',
      'const MAX_PLAYER_HISTORY_POINT_EVENTS = 100;',
      'const TOO_FAST_ABSOLUTE_MS = 1_000;',
      'const RECORD_GAP_MIN_IMPROVEMENT_MS = 3_000;',
      'const RECORD_GAP_MIN_IMPROVEMENT_RATIO = 0.3;',
      'const RUN_BURST_5M_THRESHOLD = 10;',
      'const RUN_BURST_5M_HIGH_THRESHOLD = 20;',
      'const RUN_BURST_60M_THRESHOLD = 30;',
      'const RUN_BURST_60M_HIGH_THRESHOLD = 60;',
      'const REPEAT_IDENTICAL_THRESHOLD = 4;',
      'const REPEAT_IDENTICAL_WINDOW_MS = 15 * 60 * 1_000;',
      'const POINT_BURST_5M_THRESHOLD = 500;',
      'const POINT_BURST_5M_HIGH_THRESHOLD = 1_000;',
      'const NEW_ACCOUNT_MAX_AGE_MS = 24 * 60 * 60 * 1_000;',
      'const NEW_ACCOUNT_POINTS_THRESHOLD = 1_000;',
      'const NEW_ACCOUNT_COMPLETED_RUNS_THRESHOLD = 20;',
    ]) {
      expect(suspiciousClosure).toContain(sourceLine);
    }
  });

  it('pins signal codes and labels as external admin JSON vocabulary', () => {
    const signalLabels = {
      record_gap: 'Record Gap',
      too_fast_absolute: 'Too Fast',
      run_burst_5m: 'Run Burst · 5m',
      run_burst_60m: 'Run Burst · 60m',
      repeat_identical: 'Repeated Identical Clears',
      point_burst_5m: 'Point Burst · 5m',
      new_account_spike: 'New Account Spike',
    };
    for (const [code, label] of Object.entries(signalLabels)) {
      expect(suspiciousClosure).toContain(`${code}: '${label}'`);
    }
  });

  it('pins the suspicious D1 read and audit table surface', () => {
    for (const table of [
      'room_runs',
      'room_versions',
      'course_runs',
      'course_versions',
      'expanded_room_runs',
      'expanded_room_versions',
      'users',
      'user_stats',
      'point_events',
      'admin_suspicious_invalidation_audit',
    ]) {
      expect(normalizedClosure).toMatch(new RegExp(`\\b(?:FROM|JOIN) ${table}\\b`, 'i'));
    }
    expect(suspiciousClosure).toContain('LEGACY_GENERATED_USER_LINKS_TABLE');
    expect(suspiciousClosure).toContain('isExpandedRoomSchemaMissingError(error)');
  });

  it('pins the public suspicious response field names and scope values', () => {
    const modelSource = readRepoFile('src/admin/model.ts');
    for (const field of [
      'generatedAt: string;',
      'windowHours: number;',
      'recentInvalidations: SuspiciousInvalidationAuditSummary[];',
      "scope: SuspiciousUserListScope;",
      "scope: SuspiciousUserDetailScope;",
      'total: number;',
      'items: SuspiciousUserCase[];',
      'user: SuspiciousUserCase;',
      'roomRuns: SuspiciousRunCase[];',
      'courseRuns: SuspiciousRunCase[];',
      'recentPointEvents: SuspiciousPointEventRecord[];',
    ]) {
      expect(modelSource).toContain(field);
    }
    expect(modelSource).toContain(
      "export type SuspiciousUserListScope = 'review_window' | 'player_history_search';",
    );
    expect(modelSource).toContain(
      "export type SuspiciousUserDetailScope = 'review_window' | 'player_history';",
    );
  });
});

function createAdminEnv(): { env: Env; queries: RecordedD1Query[] } {
  const queries: RecordedD1Query[] = [];
  return {
    env: {
      ASSETS: { fetch: async () => new Response() },
      DB: createRecordingDatabase('app', queries),
      JAM_DB: createRecordingDatabase('jam', []),
      ADMIN_API_KEY: 'fixture-admin-key',
    },
    queries,
  };
}

function adminRequest(path: string, method = 'GET'): Request {
  return new Request(`https://api.example.test${path}`, {
    method,
    headers: { 'x-admin-key': 'fixture-admin-key' },
  });
}

import { describe, expect, it } from 'vitest';
import type { Env } from '../core/types';
import { createRecordingDatabase, type RecordedD1Query } from './t14ContractTestSupport';
import { handleAdminPublishedGoalIssues } from './publishedGoalIssues';

function createEnv() {
  const queries: RecordedD1Query[] = [];
  const env = { ADMIN_API_KEY: 'review-only', DB: createRecordingDatabase('DB', queries, query => ({
    rows: query.sql.includes('GROUP BY issue')
      ? [{ issue: 'missing_exit', count: 2 }]
      : [
        { room_id: '-1,0', x: -1, y: 0, title: '<img src=x>', version: 2, issue: 'missing_exit' },
        { room_id: '2,0', x: 2, y: 0, title: null, version: 4, issue: 'missing_exit' },
      ],
  })) } as Env;
  return { env, queries };
}

describe('read-only published goal review', () => {
  it('checks authentication and pagination inputs before reading the database', async () => {
    const { env, queries } = createEnv();
    const url = new URL('https://api.wamp.land/api/admin/suspicious/published-goals');
    await expect(handleAdminPublishedGoalIssues(new Request(url), url, env)).rejects.toMatchObject({ status: 403 });
    for (const params of ['limit=0', 'limit=101', 'limit=abc', 'cursor=bad']) {
      url.search = params;
      await expect(handleAdminPublishedGoalIssues(new Request(url, { headers: { 'x-admin-key': 'review-only' } }), url, env)).rejects.toMatchObject({ status: 400 });
    }
    expect(queries).toEqual([]);
  });

  it('returns bounded thin rows, full counts, a stable next cursor and uncached data with two read queries', async () => {
    const { env, queries } = createEnv();
    const url = new URL('https://api.wamp.land/api/admin/suspicious/published-goals?limit=1');
    const response = await handleAdminPublishedGoalIssues(new Request(url, { headers: { 'x-admin-key': 'review-only' } }), url, env);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({
      counts: { missing_exit: 2, missing_finish: 0, no_enemies: 0 },
      items: [{ roomId: '-1,0', x: -1, y: 0, title: '<img src=x>', version: 2, issue: 'missing_exit' }],
      nextCursor: '-1,0',
    });
    expect(queries).toHaveLength(2);
    expect(queries[1].bindings.slice(-2)).toEqual(['', 2]);
    expect(queries.every(query => !/\b(UPDATE|INSERT|DELETE)\b/.test(query.sql))).toBe(true);
    expect(queries[1].sql).toContain("target.target_type = 'expanded_room'");
  });
});

import type { PublishedGoalIssueKind, PublishedGoalIssuesResponse } from '../../../admin/publishedGoalIssues';
import { requireAdminRequest } from '../auth/request';
import { HttpError, jsonResponse } from '../core/http';
import type { Env } from '../core/types';
import { PUBLISHED_GOAL_ISSUES_BINDINGS, PUBLISHED_GOAL_ISSUES_CTE } from './publishedGoalIssuesSql';

interface IssueRow {
  room_id: string;
  x: number;
  y: number;
  title: string | null;
  version: number;
  issue: PublishedGoalIssueKind;
}

export async function handleAdminPublishedGoalIssues(request: Request, url: URL, env: Env): Promise<Response> {
  requireAdminRequest(env, request, 'review published room goals');
  const rawLimit = url.searchParams.get('limit') ?? '30';
  if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100) {
    throw new HttpError(400, 'Limit must be between 1 and 100.');
  }
  const limit = Number(rawLimit);
  const cursor = url.searchParams.get('cursor') ?? '';
  if (cursor && (cursor.length > 64 || !/^-?\d+,-?\d+$/.test(cursor))) {
    throw new HttpError(400, 'Invalid room setup cursor.');
  }
  const [countsResult, pageResult] = await Promise.all([
    env.DB.prepare(`${PUBLISHED_GOAL_ISSUES_CTE} SELECT issue, COUNT(*) AS count FROM goal_issues WHERE issue IS NOT NULL GROUP BY issue`)
      .bind(...PUBLISHED_GOAL_ISSUES_BINDINGS).all<{ issue: PublishedGoalIssueKind; count: number }>(),
    env.DB.prepare(`${PUBLISHED_GOAL_ISSUES_CTE} SELECT room_id, x, y, title, version, issue FROM goal_issues WHERE issue IS NOT NULL AND room_id > ? ORDER BY room_id LIMIT ?`)
      .bind(...PUBLISHED_GOAL_ISSUES_BINDINGS, cursor, limit + 1).all<IssueRow>(),
  ]);
  const counts: PublishedGoalIssuesResponse['counts'] = { missing_exit: 0, missing_finish: 0, no_enemies: 0 };
  for (const row of countsResult.results ?? []) counts[row.issue] = row.count;
  const rows = pageResult.results ?? [];
  const page = rows.slice(0, limit);
  const response: PublishedGoalIssuesResponse = {
    generatedAt: new Date().toISOString(),
    counts,
    items: page.map(row => ({ roomId: row.room_id, x: row.x, y: row.y, title: row.title, version: row.version, issue: row.issue })),
    nextCursor: rows.length > limit ? page[page.length - 1].room_id : null,
  };
  return jsonResponse(request, response, { headers: { 'Cache-Control': 'no-store' } });
}

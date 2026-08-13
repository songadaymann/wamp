import { describe, expect, it } from 'vitest';
import { HttpError } from '../core/http';
import {
  createEmptyRoomDifficultyCounts,
  encodeRoomDiscoveryCursor,
  getRoomDifficultyVoteTotal,
  parseBuilderDiscoverySortOrThrow,
  parseRoomDifficultyOrThrow,
  parseRoomDiscoverySortOrThrow,
  resolveRoomDifficultyConsensus,
} from './difficulty';
import { parseRoomDifficultyVoteBody } from './requestBodies';
import {
  normalizeSql,
  readRepoFile,
  readTypeScriptImportClosure,
} from '../admin/t14ContractTestSupport';

describe('T14 difficulty model contracts', () => {
  it('keeps the four difficulty buckets, total, consensus, and deterministic tie order', () => {
    const empty = createEmptyRoomDifficultyCounts();
    expect(empty).toEqual({ easy: 0, medium: 0, hard: 0, extreme: 0 });
    expect(getRoomDifficultyVoteTotal(empty)).toBe(0);
    expect(resolveRoomDifficultyConsensus(empty)).toBeNull();

    const counts = { easy: 2, medium: 2, hard: 1, extreme: 0 };
    expect(getRoomDifficultyVoteTotal(counts)).toBe(5);
    expect(resolveRoomDifficultyConsensus(counts)).toBe('easy');
    expect(resolveRoomDifficultyConsensus({ ...counts, medium: 3 })).toBe('medium');
  });

  it('accepts only the exact public difficulty and discovery sort vocabularies', () => {
    expect(['easy', 'medium', 'hard', 'extreme'].map(parseRoomDifficultyOrThrow)).toEqual([
      'easy',
      'medium',
      'hard',
      'extreme',
    ]);
    expect(
      ['featured', 'quality', 'newest', 'builder', 'unbeaten', 'unvisited', 'unrated'].map(
        parseRoomDiscoverySortOrThrow,
      ),
    ).toEqual(['featured', 'quality', 'newest', 'builder', 'unbeaten', 'unvisited', 'unrated']);
    expect(['alphabet', 'rooms', 'recent'].map(parseBuilderDiscoverySortOrThrow)).toEqual([
      'alphabet',
      'rooms',
      'recent',
    ]);

    expectHttpError(() => parseRoomDifficultyOrThrow('impossible'), 400,
      'difficulty must be easy, medium, hard, or extreme.');
    expectHttpError(() => parseRoomDiscoverySortOrThrow('popular'), 400,
      'sort must be featured, quality, newest, builder, unbeaten, unvisited, or unrated.');
    expectHttpError(() => parseBuilderDiscoverySortOrThrow('quality'), 400,
      'sort must be alphabet, rooms, or recent.');
  });

  it('keeps the versioned, sort-bound, URL-safe cursor payload', () => {
    const cursor = encodeRoomDiscoveryCursor('newest', 48);
    const decoded = JSON.parse(decodeBase64Url(cursor)) as unknown;

    expect(cursor).toBe('eyJ2ZXJzaW9uIjoxLCJzb3J0IjoibmV3ZXN0Iiwib2Zmc2V0Ijo0OH0');
    expect(cursor).not.toMatch(/[+/=]/);
    expect(decoded).toEqual({ version: 1, sort: 'newest', offset: 48 });
  });

  it('normalizes the difficulty vote body without changing its public fields', async () => {
    const request = new Request('https://api.example.test/api/leaderboards/rooms/11%2C-12/difficulty-vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomCoordinates: { x: 11, y: -12 },
        roomVersion: 7,
        difficulty: 'hard',
        ignored: 'field',
      }),
    });

    await expect(parseRoomDifficultyVoteBody(request)).resolves.toEqual({
      roomCoordinates: { x: 11, y: -12 },
      roomVersion: 7,
      difficulty: 'hard',
    });
  });
});

describe('T14 discovery and difficulty route source contracts', () => {
  const workerSource = readRepoFile('src/cloudflare/worker.ts');
  const runRouteClosure = readTypeScriptImportClosure('src/cloudflare/worker/runs/routes.ts');
  const difficultyClosure = readTypeScriptImportClosure('src/cloudflare/worker/runs/difficulty.ts');
  const normalizedDifficulty = normalizeSql(difficultyClosure);

  it('pins the public GET discovery and POST difficulty-vote dispatch methods', () => {
    expect(workerSource).toContain(
      "url.pathname === '/api/leaderboards/rooms/discover' && request.method === 'GET'",
    );
    expect(workerSource).toContain(
      "url.pathname === '/api/leaderboards/builders/discover' && request.method === 'GET'",
    );
    expect(workerSource).toContain(
      "const roomDifficultyVoteMatch = /^\\/api\\/leaderboards\\/rooms\\/([^/]+)\\/difficulty-vote$/.exec(",
    );
    expect(workerSource).toContain(
      "roomDifficultyVoteMatch && request.method === 'POST'",
    );
    expect(workerSource).toContain('handleRoomDiscovery(request, url, env, ctx)');
    expect(workerSource).toContain('handleBuilderDiscovery(request, url, env, ctx)');
    expect(workerSource).toContain('decodeURIComponent(roomDifficultyVoteMatch[1])');
  });

  it('pins optional read scope, vote authentication, query defaults, and cache policy', () => {
    for (const sourceContract of [
      "requireOptionalScope(auth, 'leaderboards:read', 'discover room challenges')",
      "requireOptionalScope(auth, 'leaderboards:read', 'discover builders')",
      "'rate room difficulty',\n    'runs:write'",
      "parsePositiveIntegerQueryParam(url.searchParams, 'limit', 100, 1, 200)",
      "? parseRoomDiscoverySortOrThrow(rawSort) : 'featured'",
      "? parseBuilderDiscoverySortOrThrow(rawSort) : 'alphabet'",
      "headers: { 'Cache-Control': authenticated ? 'private, no-store' : 'public, max-age=20' }",
      'loadAnonymousPublicCache(request, authenticated ? undefined : context, loadResponse)',
    ]) {
      expect(runRouteClosure).toContain(sourceContract);
    }
  });

  it('pins cursor validation, pagination limits, and goal-less discovery rules', () => {
    for (const sourceContract of [
      'decoded.version !== 1 || decoded.sort !== sort',
      'Number.isSafeInteger(offset)',
      'offset > 100_000',
      "throw new HttpError(400, 'Invalid room discovery cursor.')",
      "sort === 'newest'",
      'parseBooleanQueryFlag(url.searchParams.get(\'includeGoalLessRooms\'))',
      "normalized === '1' || normalized === 'true' || normalized === 'yes'",
      'encodeRoomDiscoveryCursor(sort, cursorOffset + limit)',
    ]) {
      expect(runRouteClosure).toContain(sourceContract);
    }
  });

  it('pins index-read gating, exact index tables, and narrow legacy fallback behavior', () => {
    for (const sourceContract of [
      'env.PLAYABLE_CONTENT_INDEX_READS?.trim().toLowerCase()',
      "raw === '1' || raw === 'true' || raw === 'on'",
      "sort !== 'newest' && sort !== 'featured' && sort !== 'quality'",
      'const candidateLimit = limit + 1;',
      "String(error).toLowerCase().includes('playable_content_index')",
      'Playable-content index is enabled but unavailable; falling back to legacy discovery reads.',
      'throw error;',
    ]) {
      expect(difficultyClosure).toContain(sourceContract);
    }
    expect(normalizedDifficulty).toMatch(/\bFROM playable_content_index index_row\b/i);
    expect(normalizedDifficulty).toMatch(/\bLEFT JOIN playable_content_index_members member\b/i);
    expect(normalizedDifficulty).toMatch(/\bFROM rooms\b/i);
    expect(normalizedDifficulty).toMatch(/\b(?:FROM|JOIN) room_versions\b/i);
  });

  it('pins difficulty vote delegation and index refresh without changing the legacy vote table', () => {
    for (const sourceContract of [
      'const body = await parseRoomDifficultyVoteBody(request);',
      'resolveAggregatedRoomLeaderboardSelection(record, body.roomVersion)',
      'Difficulty voting is only available on the current published version.',
      'Only published challenge rooms can receive difficulty votes.',
      'await submitRoomRating(env, {',
      'qualityStars: null,',
      'difficultyChoice: body.difficulty,',
      'autoSuggestedDifficulty: body.difficulty,',
      'schedulePlayableContentIndexRefresh(context, refreshPlayableContentIndexForRoom(env, roomId))',
      'return noContentResponse(request);',
    ]) {
      expect(runRouteClosure).toContain(sourceContract);
    }
    expect(normalizedDifficulty).toMatch(/\bINSERT INTO room_difficulty_votes\b/i);
    expect(difficultyClosure).toContain(
      'ON CONFLICT(room_id, room_version, user_id) DO UPDATE SET',
    );
  });
});

function expectHttpError(
  operation: () => unknown,
  status: number,
  message: string,
): void {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status, message });
    return;
  }
  throw new Error('Expected operation to throw HttpError.');
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
}

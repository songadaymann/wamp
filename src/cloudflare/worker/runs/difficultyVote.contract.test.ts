import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env, WorkerExecutionContextLike } from '../core/types';

const mocks = vi.hoisted(() => ({
  requireAuthenticatedRequestAuth: vi.fn(),
  loadRoomRecord: vi.fn(),
  resolveAggregatedRoomLeaderboardSelection: vi.fn(),
  submitRoomRating: vi.fn(),
  refreshPlayableContentIndexForRoom: vi.fn(),
  schedulePlayableContentIndexRefresh: vi.fn(),
}));

vi.mock('../auth/request', async (importOriginal) => ({
  ...await importOriginal<typeof import('../auth/request')>(),
  requireAuthenticatedRequestAuth: mocks.requireAuthenticatedRequestAuth,
}));

vi.mock('../rooms/store', async (importOriginal) => ({
  ...await importOriginal<typeof import('../rooms/store')>(),
  loadRoomRecord: mocks.loadRoomRecord,
}));

vi.mock('./roomLeaderboardAggregation', async (importOriginal) => ({
  ...await importOriginal<typeof import('./roomLeaderboardAggregation')>(),
  resolveAggregatedRoomLeaderboardSelection: mocks.resolveAggregatedRoomLeaderboardSelection,
}));

vi.mock('../progression/store', async (importOriginal) => ({
  ...await importOriginal<typeof import('../progression/store')>(),
  submitRoomRating: mocks.submitRoomRating,
}));

vi.mock('../playableContentIndex/store', async (importOriginal) => ({
  ...await importOriginal<typeof import('../playableContentIndex/store')>(),
  refreshPlayableContentIndexForRoom: mocks.refreshPlayableContentIndexForRoom,
  schedulePlayableContentIndexRefresh: mocks.schedulePlayableContentIndexRefresh,
}));

import { HttpError } from '../core/http';
import { handleRoomDifficultyVote } from './routes';

const roomRecord = {
  published: { version: 7 },
};
const selectedSnapshot = {
  id: '11,-12',
  version: 7,
  goal: { type: 'reach_exit' },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuthenticatedRequestAuth.mockResolvedValue({
    user: {
      id: 'fixture-user',
      displayName: 'Fixture User',
      walletAddress: '0x1111111111111111111111111111111111111111',
    },
    isAdmin: false,
  });
  mocks.loadRoomRecord.mockResolvedValue(roomRecord);
  mocks.resolveAggregatedRoomLeaderboardSelection.mockReturnValue({
    roomVersion: 7,
    snapshot: selectedSnapshot,
  });
  mocks.submitRoomRating.mockResolvedValue({});
  mocks.refreshPlayableContentIndexForRoom.mockResolvedValue(undefined);
});

describe('T14 room difficulty vote delegation contract', () => {
  it('authenticates, resolves the published lineage, delegates as a rating, and schedules refresh', async () => {
    const env = createEnv();
    const context: WorkerExecutionContextLike = { waitUntil: vi.fn() };
    const request = voteRequest();

    const response = await handleRoomDifficultyVote(request, env, '11,-12', context);

    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
    expect(mocks.requireAuthenticatedRequestAuth).toHaveBeenCalledWith(
      env,
      request,
      'rate room difficulty',
      'runs:write',
    );
    expect(mocks.loadRoomRecord).toHaveBeenCalledWith(
      env,
      '11,-12',
      { x: 11, y: -12 },
      'fixture-user',
      '0x1111111111111111111111111111111111111111',
      false,
    );
    expect(mocks.resolveAggregatedRoomLeaderboardSelection).toHaveBeenCalledWith(roomRecord, 7);
    expect(mocks.submitRoomRating).toHaveBeenCalledWith(env, {
      roomRecord,
      userId: 'fixture-user',
      body: {
        roomCoordinates: { x: 11, y: -12 },
        roomVersion: 7,
        qualityStars: null,
        difficultyChoice: 'hard',
        autoSuggestedDifficulty: 'hard',
      },
    });
    expect(mocks.refreshPlayableContentIndexForRoom).toHaveBeenCalledWith(env, '11,-12');
    expect(mocks.schedulePlayableContentIndexRefresh).toHaveBeenCalledWith(
      context,
      mocks.refreshPlayableContentIndexForRoom.mock.results[0]?.value,
    );
  });

  it('rejects a historical selection before rating or refresh delegation', async () => {
    mocks.resolveAggregatedRoomLeaderboardSelection.mockReturnValue({
      roomVersion: 6,
      snapshot: { ...selectedSnapshot, version: 6 },
    });
    const env = createEnv();

    await expect(handleRoomDifficultyVote(voteRequest(6), env, '11,-12')).rejects.toMatchObject({
      status: 409,
      message: 'Difficulty voting is only available on the current published version.',
    });
    expect(mocks.submitRoomRating).not.toHaveBeenCalled();
    expect(mocks.refreshPlayableContentIndexForRoom).not.toHaveBeenCalled();
    expect(mocks.schedulePlayableContentIndexRefresh).not.toHaveBeenCalled();
  });

  it('rejects a published room without a challenge goal before rating delegation', async () => {
    mocks.resolveAggregatedRoomLeaderboardSelection.mockReturnValue({
      roomVersion: 7,
      snapshot: { ...selectedSnapshot, goal: null },
    });
    const env = createEnv();

    await expect(handleRoomDifficultyVote(voteRequest(), env, '11,-12')).rejects.toEqual(
      new HttpError(409, 'Only published challenge rooms can receive difficulty votes.'),
    );
    expect(mocks.submitRoomRating).not.toHaveBeenCalled();
    expect(mocks.refreshPlayableContentIndexForRoom).not.toHaveBeenCalled();
  });
});

function voteRequest(roomVersion = 7): Request {
  return new Request(
    'https://api.example.test/api/leaderboards/rooms/11%2C-12/difficulty-vote',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomCoordinates: { x: 11, y: -12 },
        roomVersion,
        difficulty: 'hard',
      }),
    },
  );
}

function createEnv(): Env {
  const unexpectedDatabase = {
    prepare(): never {
      throw new Error('Unexpected D1 access in vote delegation contract.');
    },
    async batch(): Promise<never[]> {
      throw new Error('Unexpected D1 batch in vote delegation contract.');
    },
  };
  return {
    ASSETS: { fetch: async () => new Response() },
    DB: unexpectedDatabase,
    JAM_DB: unexpectedDatabase,
  };
}

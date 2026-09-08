import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setFeaturedRoomStatus } from '../admin/featuredRoomsClient';
import { readApiErrorMessage } from './readApiErrorMessage';
import { createRunRepository, isRunApiError } from '../runs/runRepository';
import { createProfileRepository, isProfileApiError } from '../profiles/profileRepository';
import { createAvatarRepository, isAvatarApiError } from '../avatars/repository';
import { createPvpRepository } from '../pvp/repository';
import type { PvpMatchSubmissionRequestBody } from '../pvp/model';
import { invalidateStaleWhileRevalidateCache } from './staleWhileRevalidateCache';

const bodies = [
  ['{"error":"specific reason"}', 'specific reason'],
  ['<html>Bad Gateway</html>', '<html>Bad Gateway</html>'],
  ['{broken', '{broken'],
  ['null', 'null'],
  ['[]', '[]'],
  ['"message"', '"message"'],
  ['{"error":42}', '{"error":42}'],
  ['', 'fallback'],
  ['   ', 'fallback'],
];

describe('API error messages', () => {
  beforeEach(() => invalidateStaleWhileRevalidateCache(''));
  afterEach(() => vi.unstubAllGlobals());

  it.each(bodies)('reads %j once', async (body, expected) => {
    const response = new Response(body, { status: 502 });
    const text = vi.spyOn(response, 'text');
    expect(await readApiErrorMessage(response, 'fallback')).toBe(expected);
    expect(text).toHaveBeenCalledTimes(1);
  });

  it('uses the fallback when reading the body fails', async () => {
    const response = new Response('broken', { status: 502 });
    vi.spyOn(response, 'text').mockRejectedValue(new Error('stream failed'));
    expect(await readApiErrorMessage(response, 'fallback')).toBe('fallback');
  });

  const clients = [
    { label: 'Run', call: () => createRunRepository().loadBuilderDiscovery(), typed: isRunApiError },
    { label: 'Profile', call: () => createProfileRepository().loadProfile('test'), typed: isProfileApiError },
    { label: 'Avatar', call: () => createAvatarRepository().loadCryptopunkStatus(1), typed: isAvatarApiError },
    { label: 'PVP', call: () => createPvpRepository().submitMatch({} as PvpMatchSubmissionRequestBody), typed: (error: unknown) => error instanceof Error && error.constructor.name === 'PvpApiError' },
  ];
  for (const client of clients) {
    it.each(bodies)(`${client.label} preserves status and error type for %j`, async (body, expected) => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 502 })));
      const error: unknown = await client.call().catch((failure: unknown) => failure);
      expect(client.typed(error)).toBe(true);
      expect(error).toMatchObject({ status: 502, message: expected === 'fallback' ? `${client.label} API request failed with status 502.` : expected });
    });
    it(`${client.label} preserves successful JSON responses`, async () => {
      const payload = { entries: [], test: true };
      vi.stubGlobal('fetch', vi.fn(async () => Response.json(payload)));
      expect(await client.call()).toEqual(payload);
    });
  }
  it('preserves proxy errors in the featured room admin client', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Bad Gateway</html>', { status: 502 })));
    const storage = { getItem: () => 'test-key' } as unknown as Storage;
    await expect(setFeaturedRoomStatus('room', { roomVersion: 1, featured: true }, { storage }))
      .rejects.toThrow('<html>Bad Gateway</html>');
  });
  it('preserves successful 204 run requests', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    await expect(createRunRepository().submitRoomDifficultyVote('room', { difficulty: 'easy', roomCoordinates: { x: 0, y: 0 }, roomVersion: 1 })).resolves.toBeUndefined();
  });
});

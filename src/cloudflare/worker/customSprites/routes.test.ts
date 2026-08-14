import { describe, expect, it } from 'vitest';
import type { D1Database, D1PreparedStatement, Env } from '../core/types';
import { handleCustomSpriteRequest } from './routes';

describe('handleCustomSpriteRequest', () => {
  it('returns a private no-store usage response', async () => {
    const request = new Request('https://wamp.land/api/custom-sprites/sprite_test_123/usage');
    const response = await handleCustomSpriteRequest(request, new URL(request.url), createEnv());

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({ inUse: false });
  });

  it('rejects invalid sprite ids', async () => {
    const request = new Request('https://wamp.land/api/custom-sprites/not%20valid/usage');

    await expect(
      handleCustomSpriteRequest(request, new URL(request.url), createEnv()),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects malformed encoded sprite ids', async () => {
    const request = new Request('https://wamp.land/api/custom-sprites/sprite_%/usage');

    await expect(
      handleCustomSpriteRequest(request, new URL(request.url), createEnv()),
    ).rejects.toMatchObject({ status: 400 });
  });
});

function createEnv(): Env {
  const statement: D1PreparedStatement = {
    bind: () => statement,
    first: async <T>() => null as T | null,
    all: async <T>() => ({ results: [] as T[] }),
  };
  const database: D1Database = {
    prepare: () => statement,
    batch: async <T>() => [] as T[],
  };
  return {
    DB: database,
    JAM_DB: database,
    ASSETS: { fetch: async () => new Response() },
  };
}

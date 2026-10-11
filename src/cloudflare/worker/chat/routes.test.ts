import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessageListResponse } from '../../../chat/model';
import { NOW, fixture } from '../activity/testDatabase';
import { createSession } from '../auth/store';
import type { WorkerExecutionContextLike } from '../core/types';
import { handleChatRequest } from './routes';
import { createChatBan, createChatMessage } from './store';

afterEach(() => vi.unstubAllGlobals());

function edgeCache() {
  const stored = new Map<string, Response>();
  vi.stubGlobal('caches', { default: {
    async match(request: Request) { return stored.get(request.url)?.clone(); },
    async put(request: Request, response: Response) { stored.set(request.url, response.clone()); },
  } });
  const waits: Promise<unknown>[] = [];
  const context: WorkerExecutionContextLike = { waitUntil: (promise) => { waits.push(promise); } };
  return { stored, context, settle: () => Promise.all(waits) };
}

const URL_PATH = 'https://api.example/api/chat/messages?limit=50';
async function list(f: ReturnType<typeof fixture>, context: WorkerExecutionContextLike, cookie?: string) {
  const request = new Request(URL_PATH, { headers: { Origin: 'https://wamp.land', ...(cookie ? { Cookie: cookie } : {}) } });
  const response = await handleChatRequest(request, new URL(request.url), f.env, context);
  return { response, body: await response.json() as ChatMessageListResponse };
}

describe('chat message polling (F028)', () => {
  it('serves anonymous polls from a 3 s edge cache with the anonymous viewer', async () => {
    const f = fixture(); const cache = edgeCache();
    await createChatMessage(f.env, 'p1', 'p1', 'hello', NOW);
    const first = await list(f, cache.context); await cache.settle();
    expect(first.response.headers.get('X-WAMP-Cache')).toBe('miss');
    expect(first.response.headers.get('Cache-Control')).toBe('public, max-age=3');
    expect(first.body).toMatchObject({ messages: [{ body: 'hello' }], viewer: { role: 'none', banned: false } });

    await createChatMessage(f.env, 'p1', 'p1', 'second', '2026-10-04T17:00:01.000Z');
    const second = await list(f, cache.context);
    expect(second.response.headers.get('X-WAMP-Cache')).toBe('hit');
    expect(second.response.headers.get('Cache-Control')).toBe('public, max-age=3');
    expect(second.body.messages).toHaveLength(1);
  });

  it('never caches signed-in polls, and still reports their moderation state', async () => {
    const f = fixture(); const cache = edgeCache();
    await createChatMessage(f.env, 'p1', 'p1', 'hello', NOW);
    await createChatBan(f.env, 'p2', 'builder', NOW);
    const cookie = `ep_session=${await createSession(f.env, 'p2')}`;
    const signedIn = await list(f, cache.context, cookie); await cache.settle();
    expect(signedIn.response.headers.get('X-WAMP-Cache')).toBe('bypass');
    expect(signedIn.response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(signedIn.body.viewer).toEqual({ role: 'none', banned: true });
    expect(cache.stored.size).toBe(0);
    // An anonymous poll afterwards does not see the signed-in viewer.
    expect((await list(f, cache.context)).body.viewer).toEqual({ role: 'none', banned: false });
  });
});

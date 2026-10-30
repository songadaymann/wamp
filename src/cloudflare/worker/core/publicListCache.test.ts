import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env, RequestAuth, WorkerExecutionContextLike } from './types';
import { HttpError } from './http';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), builders: vi.fn(), rooms: vi.fn(), playlists: vi.fn(),
  summary: vi.fn(), user: vi.fn(), collection: vi.fn(),
}));
vi.mock('../auth/request', async (importOriginal) => ({
  ...await importOriginal<typeof import('../auth/request')>(),
  loadOptionalRequestAuth: mocks.auth,
}));
vi.mock('../runs/difficulty', async (importOriginal) => ({
  ...await importOriginal<typeof import('../runs/difficulty')>(),
  loadBuilderDiscoveryResponse: mocks.builders,
}));
vi.mock('../profiles/store', () => ({
  loadUserProfileRoomsPage: mocks.rooms,
  loadUserProfilePlaylists: mocks.playlists,
  loadUserProfileSummary: mocks.summary,
}));
vi.mock('../auth/store', async (importOriginal) => ({
  ...await importOriginal<typeof import('../auth/store')>(),
  findUserById: mocks.user,
}));
vi.mock('../collections/store', () => ({ loadCollectionShelf: mocks.collection }));
import { handleCollectionRead } from '../collections/routes';
import { handleBuilderDiscovery } from '../runs/routes';
import { handleProfilePlaylistsGet, handleProfileRoomsGet, handleProfileSummaryGet } from '../profiles/routes';

const env = {} as Env;
const pending: Promise<unknown>[] = [];
const stored = new Map<string, Response>();
const keys: Request[] = [];
const context: WorkerExecutionContextLike = { waitUntil: promise => { pending.push(promise); } };
const routes = [
  { path: '/api/discovery/builders?limit=2', loader: mocks.builders,
    call: (request: Request) => handleBuilderDiscovery(request, new URL(request.url), env, context) },
  { path: '/api/profiles/builder/rooms?limit=2', loader: mocks.rooms,
    call: (request: Request) => handleProfileRoomsGet(request, new URL(request.url), env, 'builder', context) },
  { path: '/api/profiles/builder/playlists', loader: mocks.playlists,
    call: (request: Request) => handleProfilePlaylistsGet(request, env, 'builder', context) },
  { path: '/api/profiles/builder/collection?limit=2', loader: mocks.collection,
    call: (request: Request) => handleCollectionRead(request, env, context, 'builder') },
];

function auth(id: string): RequestAuth {
  return {
    source: 'session', user: { id, displayName: id, email: null, walletAddress: null },
    principal: { kind: 'user', id, displayName: id, ownerUserId: id, agentId: null },
    agent: null, session: null, school: null, scopes: null, apiToken: null,
    agentToken: null, isAdmin: false,
  };
}

beforeEach(() => {
  vi.resetAllMocks(); pending.length = 0; keys.length = 0; stored.clear();
  mocks.auth.mockResolvedValue(null);
  mocks.user.mockResolvedValue({ id: 'builder' });
  for (const { loader } of routes) loader.mockResolvedValue({ results: [{ title: 'Public content' }] });
  vi.stubGlobal('caches', { default: {
    async match(request: Request) { keys.push(request); return stored.get(request.url)?.clone(); },
    async put(request: Request, response: Response) { stored.set(request.url, response.clone()); },
  } });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('viewer-independent public lists', () => {
  it.each(routes)('shares $path across two signed-in viewers and an anonymous visitor', async ({ path, call, loader }) => {
    const request = (id: string, origin: string) => new Request(`https://api.wamp.land${path}`, {
      headers: { Origin: origin, Cookie: `ep_session=${id}`, Authorization: `Bearer ${id}` },
    });
    mocks.auth.mockResolvedValue(auth('first'));
    const first = await call(request('first', 'https://wamp.land'));
    expect(first.headers.get('X-WAMP-Cache')).toBe('miss');
    await Promise.all(pending);
    for (const viewer of [auth('second'), null]) {
      mocks.auth.mockResolvedValue(viewer);
      const response = await call(request(viewer?.user.id ?? 'anonymous', 'http://localhost:3000'));
      expect(response.headers.get('X-WAMP-Cache')).toBe('hit');
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=20');
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
      expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
      expect(response.headers.get('Set-Cookie')).toBeNull();
      expect(await response.json()).toEqual({ results: [{ title: 'Public content' }] });
    }
    expect(loader).toHaveBeenCalledTimes(1);
    expect(mocks.auth).toHaveBeenCalledTimes(3);
    for (const key of keys) expect([...key.headers]).toEqual([]);
  });

  it.each(routes)('checks credentials before a warm $path cache', async ({ path, call, loader }) => {
    const request = new Request(`https://api.wamp.land${path}`);
    await call(request); await Promise.all(pending);
    mocks.auth.mockRejectedValue(new HttpError(401, 'Invalid token'));
    await expect(call(request)).rejects.toMatchObject({ status: 401 });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(keys).toHaveLength(1);
  });

  it('checks token scopes before a warm builder list cache', async () => {
    const request = new Request(`https://api.wamp.land${routes[0].path}`);
    await routes[0].call(request); await Promise.all(pending);
    mocks.auth.mockResolvedValue({ ...auth('limited'), source: 'api_token', scopes: ['rooms:read'] });
    await expect(routes[0].call(request)).rejects.toMatchObject({ status: 403 });
    expect(keys).toHaveLength(1);
  });

  it('keeps pagination, filters and target profiles in separate cache entries', async () => {
    for (const path of [routes[0].path, '/api/discovery/builders?limit=2&sort=rooms', '/api/discovery/builders?limit=1']) {
      const request = new Request(`https://api.wamp.land${path}`);
      await routes[0].call(request); await Promise.all(pending);
    }
    expect(mocks.builders).toHaveBeenCalledTimes(3);
    for (const [user, query] of [['first', 'limit=2'], ['second', 'limit=2'], ['first', 'limit=2&cursor=next']]) {
      const request = new Request(`https://api.wamp.land/api/profiles/${user}/rooms?${query}`);
      await handleProfileRoomsGet(request, new URL(request.url), env, user, context);
      await Promise.all(pending);
    }
    expect(mocks.rooms).toHaveBeenCalledTimes(3);
    expect(stored.size).toBe(6);
  });

  it('does not cache failed or missing profile playlist loads', async () => {
    mocks.user.mockResolvedValue(null);
    const request = new Request(`https://api.wamp.land${routes[2].path}`);
    await expect(routes[2].call(request)).rejects.toMatchObject({ status: 404 });
    expect(stored.size).toBe(0);
    expect(mocks.playlists).not.toHaveBeenCalled();
  });

  it('leaves self-profile permissions and entitlements outside the shared cache', async () => {
    mocks.auth.mockResolvedValue(auth('builder'));
    mocks.summary.mockResolvedValue({ isSelf: true, canEdit: true, avatarChoices: ['entitled'] });
    const request = new Request('https://api.wamp.land/api/profiles/builder/summary');
    const response = await handleProfileSummaryGet(request, env, 'builder', context);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-WAMP-Cache')).toBe('bypass');
    expect(await response.json()).toEqual({ isSelf: true, canEdit: true, avatarChoices: ['entitled'] });
    expect(stored.size).toBe(0);
  });
});

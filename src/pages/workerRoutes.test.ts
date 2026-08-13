import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './worker';
import type { PagesWorkerEnv } from './model';

const APP_SHELL = '<!doctype html><html><head><title>WAMP</title></head><body>app</body></html>';

const SHARE_PAGE_ROUTES = [
  {
    label: 'direct room path',
    pathname: '/r/11/-12',
    metadataPath: '/api/rooms/11%2C-12/published?x=11&y=-12',
    metadata: { title: 'Safety <Room> & "Friends"', version: 7 },
    expected: {
      title: 'Safety &lt;Room&gt; &amp; &quot;Friends&quot; - WAMP room 11,-12',
      description: 'Play &quot;Safety &lt;Room&gt; &amp; &quot;Friends&quot;&quot; in WAMP. Can you do better?',
      canonicalUrl: 'https://preview.wamp.land/r/11/-12',
      imageUrl: 'https://preview.wamp.land/r/11/-12/image.png?v=7&amp;renderer=assets-v5',
      ogType: 'website',
    },
  },
  {
    label: 'room query',
    pathname: '/?x=11&y=-12',
    metadataPath: '/api/rooms/11%2C-12/published?x=11&y=-12',
    metadata: { title: 'Safety <Room> & "Friends"', version: 7 },
    expected: {
      title: 'Safety &lt;Room&gt; &amp; &quot;Friends&quot; - WAMP room 11,-12',
      description: 'Play &quot;Safety &lt;Room&gt; &amp; &quot;Friends&quot;&quot; in WAMP. Can you do better?',
      canonicalUrl: 'https://preview.wamp.land/r/11/-12',
      imageUrl: 'https://preview.wamp.land/r/11/-12/image.png?v=7&amp;renderer=assets-v5',
      ogType: 'website',
    },
  },
  {
    label: 'playlist',
    pathname: '/playlist/safety-fixture',
    metadataPath: '/api/playlists/by-slug/safety-fixture',
    metadata: {
      title: 'Safety <Playlist> & "Friends"',
      description: 'A <playlist> & "description"',
      roomCount: 2,
    },
    expected: {
      title: 'Safety &lt;Playlist&gt; &amp; &quot;Friends&quot; - WAMP playlist',
      description: 'A &lt;playlist&gt; &amp; &quot;description&quot;',
      canonicalUrl: 'https://preview.wamp.land/playlist/safety-fixture',
      imageUrl: 'https://preview.wamp.land/favicon.svg',
      ogType: 'website',
    },
  },
  {
    label: 'Wamp-O-Gram',
    pathname: '/wamp-o-gram/abcdefghijkl',
    metadataPath: '/api/wamp-o-grams/abcdefghijkl',
    metadata: {
      title: 'Safety <Postcard> & "Friends"',
      message: 'A <postcard> & "description"',
    },
    expected: {
      title: 'Safety &lt;Postcard&gt; &amp; &quot;Friends&quot;',
      description: 'A &lt;postcard&gt; &amp; &quot;description&quot;',
      canonicalUrl: 'https://preview.wamp.land/wamp-o-gram/abcdefghijkl',
      imageUrl: 'https://api.example.test/api/wamp-o-grams/abcdefghijkl/preview.png',
      ogType: 'website',
    },
  },
  {
    label: 'valid profile',
    pathname: '/fixture_user',
    metadataPath: '/api/profiles/by-username/fixture_user',
    metadata: {
      displayName: 'Fixture <User> & "Friends"',
      username: 'fixture_user',
      bio: 'A <profile> & "description"',
      avatarUrl: 'https://cdn.example.test/avatar.png?size=2&v=1',
    },
    expected: {
      title: 'Fixture &lt;User&gt; &amp; &quot;Friends&quot; (@fixture_user) on WAMP',
      description: 'A &lt;profile&gt; &amp; &quot;description&quot;',
      canonicalUrl: 'https://preview.wamp.land/fixture_user',
      imageUrl: 'https://cdn.example.test/avatar.png?size=2&amp;v=1',
      ogType: 'profile',
    },
  },
] as const;

const FALLBACK_ROUTE_CASES = [
  {
    label: 'room',
    pathname: '/r/11/-12',
    metadataRequests: 2,
    expected: {
      title: 'WAMP room 11,-12',
      description: 'Play this WAMP room at 11,-12.',
      canonicalUrl: 'https://preview.wamp.land/r/11/-12',
      imageUrl: 'https://preview.wamp.land/r/11/-12/image.png',
    },
  },
  {
    label: 'playlist',
    pathname: '/playlist/safety-fixture',
    metadataRequests: 1,
    expected: {
      title: 'safety-fixture - WAMP playlist',
      description: 'Play this WAMP room playlist.',
      canonicalUrl: 'https://preview.wamp.land/playlist/safety-fixture',
      imageUrl: 'https://preview.wamp.land/favicon.svg',
    },
  },
  {
    label: 'Wamp-O-Gram',
    pathname: '/wamp-o-gram/abcdefghijkl',
    metadataRequests: 1,
    expected: {
      title: 'Wamp-O-Gram',
      description: 'Open this playable WAMP level postcard.',
      canonicalUrl: 'https://preview.wamp.land/wamp-o-gram/abcdefghijkl',
      imageUrl: 'https://api.example.test/api/wamp-o-grams/abcdefghijkl/preview.png',
    },
  },
  {
    label: 'profile',
    pathname: '/fixture_user',
    metadataRequests: 1,
    expected: {
      title: '@fixture_user on WAMP',
      description: 'View @fixture_user&#39;s WAMP profile, levels, progress, and stats.',
      canonicalUrl: 'https://preview.wamp.land/fixture_user',
      imageUrl: 'https://preview.wamp.land/favicon.svg',
    },
  },
] as const;

const METADATA_FAILURE_CASES = FALLBACK_ROUTE_CASES.flatMap((route) => [
  { ...route, failure: 'non-OK' as const },
  { ...route, failure: 'throw' as const },
  { ...route, failure: 'malformed' as const },
]);

function createEnv(
  fetchAsset: (request: Request) => Promise<Response>,
  apiBaseUrl: string | null = 'https://api.example.test',
): PagesWorkerEnv {
  const env: PagesWorkerEnv = { ASSETS: { fetch: fetchAsset } };
  if (apiBaseUrl !== null) env.ROOM_SHARE_API_BASE_URL = apiBaseUrl;
  return env;
}

function stubMetadataFetch(
  expectedPath: string,
  metadata: object,
  calls: string[],
): ReturnType<typeof vi.fn> {
  const fetchMetadata = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
    calls.push(`metadata:${url.pathname}${url.search}`);
    expect(url.origin).toBe('https://api.example.test');
    expect(`${url.pathname}${url.search}`).toBe(expectedPath);
    return Response.json(metadata);
  });
  vi.stubGlobal('fetch', fetchMetadata);
  return fetchMetadata;
}

function createAppShellFetch(calls?: string[]) {
  return vi.fn(async (request: Request) => {
    const url = new URL(request.url);
    calls?.push(`asset:${url.pathname}${url.search}`);
    return new Response(APP_SHELL, {
      headers: { 'Content-Type': 'text/html', 'Content-Length': '999' },
    });
  });
}

function expectEscapedMetadata(
  html: string,
  expected: {
    title: string;
    description: string;
    canonicalUrl: string;
    imageUrl: string;
    ogType?: string;
  },
): void {
  expect(html).toContain(`<title>${expected.title}</title>`);
  expect(html).toContain(`<meta property="og:title" content="${expected.title}">`);
  expect(html).toContain(`<meta property="og:description" content="${expected.description}">`);
  expect(html).toContain(`<link rel="canonical" href="${expected.canonicalUrl}">`);
  expect(html).toContain(`<meta property="og:image" content="${expected.imageUrl}">`);
  if (expected.ogType) {
    expect(html).toContain(`<meta property="og:type" content="${expected.ogType}">`);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Pages share route dispatch matrix', () => {
  it('preserves the full-worker POST /jam/ contract after typed redirect fallthrough', async () => {
    const fetchMetadata = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchMetadata);
    const fetchAsset = vi.fn(async () => new Response('unexpected'));

    const response = await worker.fetch(
      new Request('https://preview.wamp.land/jam/?fixture=safety', { method: 'POST' }),
      createEnv(fetchAsset),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET, HEAD');
    expect(await response.text()).toBe('Method Not Allowed');
    expect(fetchMetadata).not.toHaveBeenCalled();
    expect(fetchAsset).not.toHaveBeenCalled();
  });

  it.each(SHARE_PAGE_ROUTES)(
    'dispatches GET $label metadata before loading the app shell',
    async ({ pathname, metadataPath, metadata, expected }) => {
      const calls: string[] = [];
      const fetchMetadata = stubMetadataFetch(metadataPath, metadata, calls);
      const fetchAsset = vi.fn(async (request: Request) => {
        calls.push(`asset:${new URL(request.url).pathname}`);
        expect(new URL(request.url).pathname).toBe('/index.html');
        expect(request.method).toBe('GET');
        return new Response(APP_SHELL, {
          headers: { 'Content-Type': 'text/html', 'Content-Length': '999' },
        });
      });

      const response = await worker.fetch(
        new Request(`https://preview.wamp.land${pathname}`),
        createEnv(fetchAsset),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=60, s-maxage=300');
      expect(response.headers.get('Content-Length')).toBeNull();
      const html = await response.text();
      expect(html).toContain('<base href="/">');
      expectEscapedMetadata(html, expected);
      expect(calls).toEqual([`metadata:${metadataPath}`, 'asset:/index.html']);
      expect(fetchMetadata).toHaveBeenCalledOnce();
      expect(fetchAsset).toHaveBeenCalledOnce();
    },
  );

  it.each(SHARE_PAGE_ROUTES)(
    'dispatches HEAD $label through metadata and shell lookup, then omits the body',
    async ({ pathname, metadataPath, metadata }) => {
      const calls: string[] = [];
      const fetchMetadata = stubMetadataFetch(metadataPath, metadata, calls);
      const fetchAsset = vi.fn(async (request: Request) => {
        calls.push(`asset:${new URL(request.url).pathname}`);
        expect(new URL(request.url).pathname).toBe('/index.html');
        expect(request.method).toBe('HEAD');
        return new Response(APP_SHELL, { headers: { 'Content-Type': 'text/html' } });
      });

      const response = await worker.fetch(
        new Request(`https://preview.wamp.land${pathname}`, { method: 'HEAD' }),
        createEnv(fetchAsset),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
      expect(await response.text()).toBe('');
      expect(calls).toEqual([`metadata:${metadataPath}`, 'asset:/index.html']);
      expect(fetchMetadata).toHaveBeenCalledOnce();
      expect(fetchAsset).toHaveBeenCalledOnce();
    },
  );

  it('dispatches a room-image HEAD without metadata or asset I/O', async () => {
    const fetchMetadata = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchMetadata);
    const fetchAsset = vi.fn(async () => new Response('unexpected'));

    const response = await worker.fetch(
      new Request('https://preview.wamp.land/r/11/-12/image.png', { method: 'HEAD' }),
      createEnv(fetchAsset),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300, s-maxage=3600');
    expect(await response.text()).toBe('');
    expect(fetchMetadata).not.toHaveBeenCalled();
    expect(fetchAsset).not.toHaveBeenCalled();
  });

  it.each([
    ['direct room path', '/r/11/-12'],
    ['room query', '/?x=11&y=-12'],
    ['room image', '/r/11/-12/image.png'],
    ['playlist', '/playlist/safety-fixture'],
    ['Wamp-O-Gram', '/wamp-o-gram/abcdefghijkl'],
    ['valid profile', '/fixture_user'],
  ])('rejects POST to the $0 share route before metadata or asset I/O', async (_label, pathname) => {
    const fetchMetadata = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchMetadata);
    const fetchAsset = vi.fn(async () => new Response('unexpected'));

    const response = await worker.fetch(
      new Request(`https://preview.wamp.land${pathname}`, { method: 'POST' }),
      createEnv(fetchAsset),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET, HEAD');
    expect(await response.text()).toBe('Method Not Allowed');
    expect(fetchMetadata).not.toHaveBeenCalled();
    expect(fetchAsset).not.toHaveBeenCalled();
  });

  it.each(['GET', 'HEAD', 'POST'])('falls back to ASSETS for a generic %s request', async (method) => {
    const fetchMetadata = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchMetadata);
    const request = new Request('https://preview.wamp.land/api/health?fixture=safety', { method });
    const upstream = new Response(method === 'HEAD' ? null : 'generic asset response', {
      status: 202,
      headers: { 'X-Asset-Fallback': 'yes' },
    });
    const fetchAsset = vi.fn(async (receivedRequest: Request) => {
      expect(receivedRequest).toBe(request);
      return upstream;
    });

    const response = await worker.fetch(request, createEnv(fetchAsset));

    expect(response).toBe(upstream);
    expect(response.status).toBe(202);
    expect(response.headers.get('X-Asset-Fallback')).toBe('yes');
    expect(fetchMetadata).not.toHaveBeenCalled();
    expect(fetchAsset).toHaveBeenCalledOnce();
  });

  it.each(METADATA_FAILURE_CASES)(
    'uses deterministic $label fallback metadata when metadata is $failure',
    async ({ pathname, metadataRequests, expected, failure }) => {
      const fetchMetadata = vi.fn(async () => {
        if (failure === 'throw') throw new Error('fixture metadata failure');
        if (failure === 'malformed') {
          return new Response('{not-json', {
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('unavailable', { status: 503 });
      });
      vi.stubGlobal('fetch', fetchMetadata);
      const fetchAsset = createAppShellFetch();

      const response = await worker.fetch(
        new Request(`https://preview.wamp.land${pathname}`),
        createEnv(fetchAsset),
      );

      expect(response.status).toBe(200);
      expectEscapedMetadata(await response.text(), expected);
      expect(fetchMetadata).toHaveBeenCalledTimes(metadataRequests);
      expect(fetchAsset).toHaveBeenCalledOnce();
    },
  );

  it('loads the app shell in /index.html -> / -> original-request order', async () => {
    const calls: string[] = [];
    stubMetadataFetch(
      '/api/profiles/by-username/fixture_user',
      { displayName: 'Fixture User', username: 'fixture_user' },
      calls,
    );
    const fetchAsset = vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      calls.push(`asset:${url.pathname}${url.search}`);
      if (url.pathname === '/index.html') return new Response('missing index', { status: 404 });
      if (url.pathname === '/') return new Response('missing root', { status: 503 });
      return new Response(APP_SHELL, { headers: { 'Content-Type': 'text/html' } });
    });

    const response = await worker.fetch(
      new Request('https://preview.wamp.land/fixture_user?fixture=safety'),
      createEnv(fetchAsset),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Fixture User (@fixture_user) on WAMP');
    expect(calls).toEqual([
      'metadata:/api/profiles/by-username/fixture_user',
      'asset:/index.html',
      'asset:/',
      'asset:/fixture_user?fixture=safety',
    ]);
  });

  it('returns the generated share shell after all three app-shell lookups fail', async () => {
    const calls: string[] = [];
    stubMetadataFetch(
      '/api/profiles/by-username/fixture_user',
      { displayName: 'Fixture User', username: 'fixture_user' },
      calls,
    );
    const fetchAsset = vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      calls.push(`asset:${url.pathname}${url.search}`);
      return new Response('missing', { status: 404 });
    });

    const response = await worker.fetch(
      new Request('https://preview.wamp.land/fixture_user?fixture=safety'),
      createEnv(fetchAsset),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=60, s-maxage=300');
    expect(await response.text()).toContain('Open this WAMP profile');
    expect(calls).toEqual([
      'metadata:/api/profiles/by-username/fixture_user',
      'asset:/index.html',
      'asset:/',
      'asset:/fixture_user?fixture=safety',
    ]);
  });

  it.each([
    {
      label: 'configured binding',
      requestUrl: 'https://preview.wamp.land/fixture_user',
      apiBaseUrl: '  https://safety-api.example.test/root///  ',
      expectedUrl: 'https://safety-api.example.test/api/profiles/by-username/fixture_user',
    },
    {
      label: 'localhost fallback',
      requestUrl: 'http://localhost:4602/fixture_user',
      apiBaseUrl: null,
      expectedUrl: 'http://localhost:8787/api/profiles/by-username/fixture_user',
    },
    {
      label: '127.0.0.1 fallback',
      requestUrl: 'http://127.0.0.1:4602/fixture_user',
      apiBaseUrl: null,
      expectedUrl: 'http://127.0.0.1:8787/api/profiles/by-username/fixture_user',
    },
    {
      label: 'default production API',
      requestUrl: 'https://preview.wamp.land/fixture_user',
      apiBaseUrl: null,
      expectedUrl: 'https://api.wamp.land/api/profiles/by-username/fixture_user',
    },
  ])('resolves metadata against the $label base URL', async ({ requestUrl, apiBaseUrl, expectedUrl }) => {
    const metadataUrls: string[] = [];
    const fetchMetadata = vi.fn(async (input: RequestInfo | URL) => {
      metadataUrls.push(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
      return Response.json({ displayName: 'Fixture User', username: 'fixture_user' });
    });
    vi.stubGlobal('fetch', fetchMetadata);
    const fetchAsset = createAppShellFetch();

    const response = await worker.fetch(
      new Request(requestUrl),
      createEnv(fetchAsset, apiBaseUrl),
    );

    expect(response.status).toBe(200);
    expect(metadataUrls).toEqual([expectedUrl]);
    expect(fetchMetadata).toHaveBeenCalledOnce();
  });

  it.each([
    {
      label: 'leading zeros and a direct trailing slash',
      pathname: '/r/00011/-0012/',
      metadataPath: '/api/rooms/11%2C-12/published?x=11&y=-12',
      canonicalUrl: 'https://preview.wamp.land/r/11/-12',
    },
    {
      label: 'an unsafe direct integer rounded by parseInt',
      pathname: '/r/9007199254740993/-0/',
      metadataPath: '/api/rooms/9007199254740992%2C0/published?x=9007199254740992&y=0',
      canonicalUrl: 'https://preview.wamp.land/r/9007199254740992/0',
    },
    {
      label: 'strict safe integers on /index.html',
      pathname: '/index.html?x=-0&y=00012',
      metadataPath: '/api/rooms/0%2C12/published?x=0&y=12',
      canonicalUrl: 'https://preview.wamp.land/r/0/12',
    },
  ])('preserves the room coordinate parsing quirk for $label', async ({ pathname, metadataPath, canonicalUrl }) => {
    const calls: string[] = [];
    stubMetadataFetch(metadataPath, { version: 3 }, calls);
    const fetchAsset = createAppShellFetch(calls);

    const response = await worker.fetch(
      new Request(`https://preview.wamp.land${pathname}`),
      createEnv(fetchAsset),
    );

    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain(`<link rel="canonical" href="${canonicalUrl}">`);
    expect(calls).toEqual([`metadata:${metadataPath}`, 'asset:/index.html']);
  });

  it.each([
    '/?x=11',
    '/?x=11.5&y=-12',
    '/?x=%2B11&y=-12',
    '/?x=9007199254740993&y=0',
    '/r/11/nope',
    '/r/11/-12/extra',
    '/admin',
    '/api',
    '/ab',
    '/bad%20name',
    '/bad%E0%A4%A',
    '/two/segments',
  ])('falls through malformed, unsafe, or reserved route %s to ASSETS', async (pathname) => {
    const fetchMetadata = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchMetadata);
    const request = new Request(`https://preview.wamp.land${pathname}`);
    const upstream = new Response('asset fallback', {
      status: 203,
      headers: { 'X-Fallthrough': 'yes' },
    });
    const fetchAsset = vi.fn(async (receivedRequest: Request) => {
      expect(receivedRequest).toBe(request);
      return upstream;
    });

    const response = await worker.fetch(request, createEnv(fetchAsset));

    expect(response).toBe(upstream);
    expect(response.headers.get('X-Fallthrough')).toBe('yes');
    expect(fetchMetadata).not.toHaveBeenCalled();
    expect(fetchAsset).toHaveBeenCalledOnce();
  });

  it('does not interpret a room query outside / or /index.html before profile dispatch', async () => {
    const calls: string[] = [];
    stubMetadataFetch(
      '/api/profiles/by-username/not-index',
      { displayName: 'Not Index', username: 'not-index' },
      calls,
    );
    const fetchAsset = createAppShellFetch(calls);

    const response = await worker.fetch(
      new Request('https://preview.wamp.land/not-index?x=11&y=-12'),
      createEnv(fetchAsset),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Not Index (@not-index) on WAMP');
    expect(calls).toEqual([
      'metadata:/api/profiles/by-username/not-index',
      'asset:/index.html',
    ]);
  });

  it.each([
    {
      label: 'playlist',
      pathname: '/playlist/safety-fixture/',
      metadataPath: '/api/playlists/by-slug/safety-fixture',
      metadata: { title: 'Safety playlist' },
    },
    {
      label: 'Wamp-O-Gram',
      pathname: '/wamp-o-gram/abcdefghijkl/',
      metadataPath: '/api/wamp-o-grams/abcdefghijkl',
      metadata: { title: 'Safety postcard' },
    },
    {
      label: 'profile',
      pathname: '/Fixture_User/',
      metadataPath: '/api/profiles/by-username/fixture_user',
      metadata: { displayName: 'Fixture User', username: 'fixture_user' },
    },
  ])('accepts and normalizes a trailing slash for $label', async ({ pathname, metadataPath, metadata }) => {
    const calls: string[] = [];
    stubMetadataFetch(metadataPath, metadata, calls);
    const fetchAsset = createAppShellFetch(calls);

    const response = await worker.fetch(
      new Request(`https://preview.wamp.land${pathname}`),
      createEnv(fetchAsset),
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([`metadata:${metadataPath}`, 'asset:/index.html']);
  });

  it.each([
    '/r/11/-12/image/',
    '/r/11/-12/image.png/',
  ])('accepts trailing slash room-image variant %s for HEAD', async (pathname) => {
    const fetchMetadata = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchMetadata);
    const fetchAsset = vi.fn(async () => new Response('unexpected'));

    const response = await worker.fetch(
      new Request(`https://preview.wamp.land${pathname}`, { method: 'HEAD' }),
      createEnv(fetchAsset),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(fetchMetadata).not.toHaveBeenCalled();
    expect(fetchAsset).not.toHaveBeenCalled();
  });

  it('renders a PNG from the fallback room snapshot when metadata and assets fail', async () => {
    const fetchMetadata = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
      expect(`${url.pathname}${url.search}`).toBe('/api/rooms/11%2C-12/published?x=11&y=-12');
      return new Response('unavailable', { status: 503 });
    });
    vi.stubGlobal('fetch', fetchMetadata);
    const fetchAsset = vi.fn(async (request: Request) => {
      expect(new URL(request.url).pathname).toMatch(/^\/assets\/backgrounds\/grassland\/[1-4]\.png$/);
      throw new Error('fixture asset failure');
    });

    const response = await worker.fetch(
      new Request('https://preview.wamp.land/r/11/-12/image.png'),
      createEnv(fetchAsset),
    );
    const png = new Uint8Array(await response.arrayBuffer());
    const header = new DataView(png.buffer, png.byteOffset, png.byteLength);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300, s-maxage=3600');
    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(header.getUint32(16)).toBe(1200);
    expect(header.getUint32(20)).toBe(630);
    expect(fetchMetadata).toHaveBeenCalledOnce();
    expect(fetchAsset).toHaveBeenCalledTimes(4);
  });
});

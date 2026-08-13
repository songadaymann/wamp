import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PagesWorkerEnv } from './model';
import {
  loadPlaylistMetadata,
  loadProfileMetadata,
  loadPublishedRoomSnapshot,
  loadRoomMetadata,
  loadWampOGramMetadata,
} from './shareMetadata';

const PAGE_ORIGIN = 'https://preview.wamp.land';
const API_ORIGIN = 'https://api.example.test';
const COORDINATES = { x: 11, y: -12 } as const;

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

interface MetadataOperation {
  label: string;
  defaultUserAgent: string;
  run(request: Request, env: PagesWorkerEnv, url: URL): Promise<unknown>;
}

const METADATA_OPERATIONS: MetadataOperation[] = [
  {
    label: 'room metadata',
    defaultUserAgent: 'WAMP room share renderer',
    run: (request, env, url) => loadRoomMetadata(request, env, url, COORDINATES),
  },
  {
    label: 'profile metadata',
    defaultUserAgent: 'WAMP profile share renderer',
    run: (request, env, url) => loadProfileMetadata(request, env, url, 'fixture_user'),
  },
  {
    label: 'playlist metadata',
    defaultUserAgent: 'WAMP playlist share renderer',
    run: (request, env, url) => loadPlaylistMetadata(request, env, url, 'safety-fixture'),
  },
  {
    label: 'Wamp-O-Gram metadata',
    defaultUserAgent: 'WAMP Wamp-O-Gram share renderer',
    run: (request, env, url) => loadWampOGramMetadata(request, env, url, 'abcdefghijkl'),
  },
  {
    label: 'published room metadata',
    defaultUserAgent: 'WAMP room share renderer',
    run: (request, env, url) => loadPublishedRoomSnapshot(
      request,
      env,
      url,
      COORDINATES,
      1200,
    ),
  },
];

function createEnv(): PagesWorkerEnv {
  return {
    ASSETS: {
      fetch: vi.fn(async () => new Response('unused asset response')),
    },
    ROOM_SHARE_API_BASE_URL: API_ORIGIN,
  };
}

function createRequest(pathname: string, userAgent?: string): Request {
  return new Request(`${PAGE_ORIGIN}${pathname}`, userAgent
    ? { headers: { 'User-Agent': userAgent } }
    : undefined);
}

function stubFetch(implementation: FetchImplementation): ReturnType<typeof vi.fn<FetchImplementation>> {
  const fetchMock = vi.fn<FetchImplementation>(implementation);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.toString() : input.url;
}

function requireSignal(init?: RequestInit): AbortSignal {
  const signal = init?.signal;
  if (!signal) throw new Error('Expected metadata fetch to receive an abort signal.');
  return signal;
}

function waitForAbort(signal: AbortSignal): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const rejectForAbort = () => reject(
      signal.reason instanceof Error
        ? signal.reason
        : new DOMException('The operation was aborted.', 'AbortError'),
    );

    if (signal.aborted) {
      rejectForAbort();
      return;
    }

    signal.addEventListener('abort', rejectForAbort, { once: true });
  });
}

function expectRequestHeaders(init: RequestInit | undefined, userAgent: string): void {
  const headers = new Headers(init?.headers);
  expect(headers.get('Accept')).toBe('application/json');
  expect(headers.get('User-Agent')).toBe(userAgent);
}

afterEach(() => {
  if (vi.isFakeTimers()) {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
  vi.unstubAllGlobals();
});

describe('share metadata request contracts', () => {
  it.each(METADATA_OPERATIONS)(
    'preserves exact request headers and clears successful timers for $label',
    async ({ defaultUserAgent, run }) => {
      vi.useFakeTimers();
      const capturedInits: Array<RequestInit | undefined> = [];
      const fetchMock = stubFetch(async (_input, init) => {
        capturedInits.push(init);
        return Response.json({});
      });

      await run(
        createRequest('/fixture'),
        createEnv(),
        new URL(`${PAGE_ORIGIN}/fixture`),
      );
      await run(
        createRequest('/fixture', 'FixtureBot/9.2 (+https://fixture.example)'),
        createEnv(),
        new URL(`${PAGE_ORIGIN}/fixture`),
      );

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expectRequestHeaders(capturedInits[0], defaultUserAgent);
      expectRequestHeaders(capturedInits[1], 'FixtureBot/9.2 (+https://fixture.example)');
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('requests published room metadata before the share-meta fallback and forces the local image URL', async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const fetchMock = stubFetch(async (input, init) => {
      calls.push(requestUrl(input));
      expectRequestHeaders(init, 'Fixture Share Bot');
      if (calls.length === 1) {
        return new Response('not published', { status: 404 });
      }

      return Response.json({
        title: '  Legacy\n Share   Room  ',
        description: '  A\t remote   description. ',
        url: 'https://canonical.example.test/shared-room',
        imageUrl: 'https://cdn.example.test/remote-preview.png',
        imageWidth: 640,
        imageHeight: 480,
      });
    });

    const result = await loadRoomMetadata(
      createRequest('/r/11/-12', 'Fixture Share Bot'),
      createEnv(),
      new URL(`${PAGE_ORIGIN}/r/11/-12`),
      COORDINATES,
    );

    expect(result).toEqual({
      title: 'Legacy Share Room',
      description: 'A remote description.',
      url: 'https://canonical.example.test/shared-room',
      imageUrl: `${PAGE_ORIGIN}/r/11/-12/image.png`,
      imageWidth: 640,
      imageHeight: 480,
    });
    expect(calls).toEqual([
      `${API_ORIGIN}/api/rooms/11%2C-12/published?x=11&y=-12`,
      `${API_ORIGIN}/api/share/rooms/11%2C-12/meta?x=11&y=-12&url=https%3A%2F%2Fpreview.wamp.land%2Fr%2F11%2F-12`,
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('share metadata timeout contracts', () => {
  it('gives both room metadata requests their own 1200 ms timeout and clears the timers', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const calls: string[] = [];
    const fetchMock = stubFetch(async (input, init) => {
      calls.push(requestUrl(input));
      const signal = requireSignal(init);
      signals.push(signal);
      return waitForAbort(signal);
    });

    const resultPromise = loadRoomMetadata(
      createRequest('/r/11/-12'),
      createEnv(),
      new URL(`${PAGE_ORIGIN}/r/11/-12`),
      COORDINATES,
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(signals).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(1199);
    expect(signals[0]?.aborted).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);
    expect(signals[0]?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(signals).toHaveLength(2);
    expect(signals[1]?.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(1199);
    expect(signals[1]?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(resultPromise).resolves.toMatchObject({
      title: 'WAMP room 11,-12',
      imageUrl: `${PAGE_ORIGIN}/r/11/-12/image.png`,
    });
    expect(signals[1]?.aborted).toBe(true);
    expect(calls).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    {
      label: 'profile metadata',
      run: (request: Request, env: PagesWorkerEnv, url: URL) => (
        loadProfileMetadata(request, env, url, 'fixture_user')
      ),
      expected: { title: '@fixture_user on WAMP' },
    },
    {
      label: 'playlist metadata',
      run: (request: Request, env: PagesWorkerEnv, url: URL) => (
        loadPlaylistMetadata(request, env, url, 'safety-fixture')
      ),
      expected: { title: 'safety-fixture - WAMP playlist' },
    },
    {
      label: 'Wamp-O-Gram metadata',
      run: (request: Request, env: PagesWorkerEnv, url: URL) => (
        loadWampOGramMetadata(request, env, url, 'abcdefghijkl')
      ),
      expected: { title: 'Wamp-O-Gram' },
    },
  ])('aborts $label at 1200 ms and returns its fallback', async ({ run, expected }) => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const fetchMock = stubFetch(async (_input, init) => {
      const signal = requireSignal(init);
      signals.push(signal);
      return waitForAbort(signal);
    });

    const resultPromise = run(
      createRequest('/fixture'),
      createEnv(),
      new URL(`${PAGE_ORIGIN}/fixture`),
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(signals[0]?.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(1199);
    expect(signals[0]?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(resultPromise).resolves.toMatchObject(expected);
    expect(signals[0]?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts a published-room request at its supplied 1200 ms timeout and returns null', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const fetchMock = stubFetch(async (_input, init) => {
      const signal = requireSignal(init);
      signals.push(signal);
      return waitForAbort(signal);
    });

    const resultPromise = loadPublishedRoomSnapshot(
      createRequest('/r/11/-12'),
      createEnv(),
      new URL(`${PAGE_ORIGIN}/r/11/-12`),
      COORDINATES,
      1200,
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(signals[0]?.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(1199);
    expect(signals[0]?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(resultPromise).resolves.toBeNull();
    expect(signals[0]?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('share metadata normalization edge cases', () => {
  it('normalizes malformed room share-meta fields and rejects unsafe URL schemes', async () => {
    const fetchMock = stubFetch(async (_input) => {
      if (fetchMock.mock.calls.length === 1) {
        return new Response('not published', { status: 404 });
      }

      return new Response(JSON.stringify({
        title: ['not text'],
        description: '  Kept\n   description\t text. ',
        url: 'javascript:alert(1)',
        imageUrl: 'data:image/png;base64,unsafe',
        imageWidth: '640',
        imageHeight: null,
      }));
    });

    const result = await loadRoomMetadata(
      createRequest('/r/11/-12'),
      createEnv(),
      new URL(`${PAGE_ORIGIN}/r/11/-12`),
      COORDINATES,
    );

    expect(result).toEqual({
      title: 'WAMP room 11,-12',
      description: 'Kept description text.',
      url: `${PAGE_ORIGIN}/r/11/-12`,
      imageUrl: `${PAGE_ORIGIN}/r/11/-12/image.png`,
      imageWidth: 1200,
      imageHeight: 630,
    });
  });

  it.each([
    {
      label: 'zero',
      payload: '{"title":"  Version\\n Room  ","version":0}',
      expectedImageUrl: `${PAGE_ORIGIN}/r/11/-12/image.png?v=0&renderer=assets-v5`,
    },
    {
      label: 'negative finite number',
      payload: '{"title":"Version Room","version":-3}',
      expectedImageUrl: `${PAGE_ORIGIN}/r/11/-12/image.png?v=-3&renderer=assets-v5`,
    },
    {
      label: 'numeric string',
      payload: '{"title":"Version Room","version":"7"}',
      expectedImageUrl: `${PAGE_ORIGIN}/r/11/-12/image.png?renderer=assets-v5`,
    },
    {
      label: 'non-finite JSON number',
      payload: '{"title":"Version Room","version":1e400}',
      expectedImageUrl: `${PAGE_ORIGIN}/r/11/-12/image.png?renderer=assets-v5`,
    },
  ])('preserves the $label published-room version rule', async ({ payload, expectedImageUrl }) => {
    stubFetch(async () => new Response(payload));

    const result = await loadRoomMetadata(
      createRequest('/r/11/-12'),
      createEnv(),
      new URL(`${PAGE_ORIGIN}/r/11/-12`),
      COORDINATES,
    );

    expect(result.title).toContain('Version Room');
    expect(result.imageUrl).toBe(expectedImageUrl);
  });

  it.each([
    {
      label: 'numeric-string singular count',
      payload: {
        displayName: '  Fixture\n User  ',
        stats: { totalRoomsPublished: '1' },
        avatarUrl: 'javascript:alert(1)',
      },
      expectedDescription: "Fixture User's WAMP profile with 1 published level, progress, and stats.",
    },
    {
      label: 'invalid count',
      payload: {
        displayName: 'Fixture User',
        stats: { totalRoomsPublished: 'not-a-number' },
      },
      expectedDescription: "Fixture User's WAMP profile with 0 published levels, progress, and stats.",
    },
  ])('preserves the profile $label rule', async ({ payload, expectedDescription }) => {
    stubFetch(async () => Response.json(payload));

    const result = await loadProfileMetadata(
      createRequest('/fixture_user'),
      createEnv(),
      new URL(`${PAGE_ORIGIN}/fixture_user`),
      'fixture_user',
    );

    expect(result.title).toBe('Fixture User on WAMP');
    expect(result.description).toBe(expectedDescription);
    expect(result.imageUrl).toBe(`${PAGE_ORIGIN}/favicon.svg`);
  });

  it.each([
    {
      label: 'null count falling back to item length',
      payload: {
        title: '  Safety\n Mix  ',
        ownerDisplayName: '  Jonathan\t Mann ',
        description: 42,
        roomCount: null,
        items: [{}, {}],
      },
      expectedDescription: "Jonathan Mann's WAMP playlist with 2 rooms.",
    },
    {
      label: 'numeric-string singular count',
      payload: {
        title: 'Safety Mix',
        roomCount: '1',
        items: [{}, {}],
      },
      expectedDescription: 'WAMP playlist with 1 room.',
    },
    {
      label: 'invalid explicit count overriding item length',
      payload: {
        title: 'Safety Mix',
        roomCount: 'not-a-number',
        items: [{}, {}, {}],
      },
      expectedDescription: 'WAMP playlist with 0 rooms.',
    },
  ])('preserves the playlist $label rule', async ({ payload, expectedDescription }) => {
    stubFetch(async () => Response.json(payload));

    const result = await loadPlaylistMetadata(
      createRequest('/playlist/safety-fixture'),
      createEnv(),
      new URL(`${PAGE_ORIGIN}/playlist/safety-fixture`),
      'safety-fixture',
    );

    expect(result.title).toBe('Safety Mix - WAMP playlist');
    expect(result.description).toBe(expectedDescription);
  });

  it('collapses Wamp-O-Gram whitespace and falls back across malformed individual fields', async () => {
    stubFetch(async () => Response.json({
      title: 42,
      recipientName: '  Ada\n Lovelace  ',
      senderName: null,
      creatorDisplayName: '  Fixture\t Creator ',
      message: { not: 'text' },
    }));

    const result = await loadWampOGramMetadata(
      createRequest('/wamp-o-gram/abcdefghijkl'),
      createEnv(),
      new URL(`${PAGE_ORIGIN}/wamp-o-gram/abcdefghijkl`),
      'abcdefghijkl',
    );

    expect(result.title).toBe('A Wamp-O-Gram for Ada Lovelace');
    expect(result.description).toBe('Fixture Creator made a playable WAMP level postcard.');
    expect(result.imageUrl).toBe(`${API_ORIGIN}/api/wamp-o-grams/abcdefghijkl/preview.png`);
  });
});

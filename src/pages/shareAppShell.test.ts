import { describe, expect, it, vi } from 'vitest';
import type { PagesWorkerEnv } from './model';
import {
  renderPlaylistAppShell,
  renderProfileAppShell,
  renderRoomAppShell,
  renderWampOGramAppShell,
} from './shareAppShell';
import type { RoomShareMetadata, ShareMetadata } from './shareMetadata';

const CACHE_CONTROL = 'public, max-age=60, s-maxage=300';
const APP_SHELL = '<!doctype html><html><head><title>WAMP</title></head><body>app</body></html>';

type ShellRenderer = (
  request: Request,
  env: PagesWorkerEnv,
  metadata: ShareMetadata,
) => Promise<Response>;

interface ShellCase {
  kind: string;
  render: ShellRenderer;
  metadata: ShareMetadata;
  fallbackLink: string;
  ogType: 'profile' | 'website';
  twitterCard: 'summary' | 'summary_large_image';
  includesImageDimensions: boolean;
}

const ROOM_METADATA: RoomShareMetadata = {
  title: 'Fixture Room',
  description: 'A room fixture.',
  url: 'https://preview.wamp.land/r/11/-12',
  imageUrl: 'https://preview.wamp.land/r/11/-12/image.png',
  imageWidth: 1200,
  imageHeight: 630,
};

const PROFILE_METADATA: ShareMetadata = {
  title: 'Fixture User (@fixture_user) on WAMP',
  description: 'A profile fixture.',
  url: 'https://preview.wamp.land/fixture_user',
  imageUrl: 'https://cdn.example.test/avatar.png',
};

const PLAYLIST_METADATA: ShareMetadata = {
  title: 'Fixture Playlist - WAMP playlist',
  description: 'A playlist fixture.',
  url: 'https://preview.wamp.land/playlist/fixture-playlist',
  imageUrl: 'https://preview.wamp.land/favicon.svg',
};

const WAMP_O_GRAM_METADATA: RoomShareMetadata = {
  title: 'Fixture Wamp-O-Gram',
  description: 'A postcard fixture.',
  url: 'https://preview.wamp.land/wamp-o-gram/abcdefghijkl',
  imageUrl: 'https://api.example.test/api/wamp-o-grams/abcdefghijkl/preview.png',
  imageWidth: 1200,
  imageHeight: 630,
};

const SHELL_CASES: ShellCase[] = [
  {
    kind: 'room',
    render: (request, env, metadata) =>
      renderRoomAppShell(request, env, metadata as RoomShareMetadata),
    metadata: ROOM_METADATA,
    fallbackLink: 'Open this WAMP room',
    ogType: 'website',
    twitterCard: 'summary_large_image',
    includesImageDimensions: true,
  },
  {
    kind: 'profile',
    render: renderProfileAppShell,
    metadata: PROFILE_METADATA,
    fallbackLink: 'Open this WAMP profile',
    ogType: 'profile',
    twitterCard: 'summary',
    includesImageDimensions: false,
  },
  {
    kind: 'playlist',
    render: renderPlaylistAppShell,
    metadata: PLAYLIST_METADATA,
    fallbackLink: 'Open this WAMP playlist',
    ogType: 'website',
    twitterCard: 'summary',
    includesImageDimensions: false,
  },
  {
    kind: 'Wamp-O-Gram',
    render: (request, env, metadata) =>
      renderWampOGramAppShell(request, env, metadata as RoomShareMetadata),
    metadata: WAMP_O_GRAM_METADATA,
    fallbackLink: 'Open this Wamp-O-Gram',
    ogType: 'website',
    twitterCard: 'summary_large_image',
    includesImageDimensions: true,
  },
];

function createEnv(fetchAsset: (request: Request) => Promise<Response>): PagesWorkerEnv {
  return { ASSETS: { fetch: fetchAsset } };
}

describe('Pages share app shell asset lookup', () => {
  it('looks up /index.html, /, then the original request while dropping query data only from canonical shell URLs', async () => {
    const calls: Array<{ url: string; method: string; marker: string | null }> = [];
    const fetchAsset = vi.fn(async (request: Request) => {
      calls.push({
        url: request.url,
        method: request.method,
        marker: request.headers.get('X-Fixture-Marker'),
      });
      const pathname = new URL(request.url).pathname;
      if (pathname === '/index.html') return new Response('missing index', { status: 404 });
      if (pathname === '/') return new Response('missing root', { status: 503 });
      return new Response(APP_SHELL);
    });
    const request = new Request(
      'https://preview.wamp.land/fixture_user?fixture=safety&attempt=2',
      { headers: { 'X-Fixture-Marker': 'preserved' } },
    );

    const response = await renderProfileAppShell(request, createEnv(fetchAsset), PROFILE_METADATA);

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        url: 'https://preview.wamp.land/index.html',
        method: 'GET',
        marker: 'preserved',
      },
      {
        url: 'https://preview.wamp.land/',
        method: 'GET',
        marker: 'preserved',
      },
      {
        url: 'https://preview.wamp.land/fixture_user?fixture=safety&attempt=2',
        method: 'GET',
        marker: 'preserved',
      },
    ]);
  });

  it('propagates an asset binding rejection instead of converting it into generated HTML', async () => {
    const failure = new Error('asset binding unavailable');
    const fetchAsset = vi.fn(async () => Promise.reject(failure));

    await expect(
      renderRoomAppShell(
        new Request('https://preview.wamp.land/r/11/-12'),
        createEnv(fetchAsset),
        ROOM_METADATA,
      ),
    ).rejects.toBe(failure);
    expect(fetchAsset).toHaveBeenCalledOnce();
  });
});

describe('Pages generated share app shells', () => {
  it.each(SHELL_CASES)(
    'generates the $kind fallback only after all three asset responses are non-ok',
    async ({ render, metadata, fallbackLink, ogType, twitterCard, includesImageDimensions }) => {
      const calls: string[] = [];
      const fetchAsset = vi.fn(async (request: Request) => {
        calls.push(request.url);
        return new Response('missing', { status: 404 });
      });
      const request = new Request(`${metadata.url}?fixture=safety`);

      const response = await render(request, createEnv(fetchAsset), metadata);
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
      expect(response.headers.get('Cache-Control')).toBe(CACHE_CONTROL);
      expect(html).toContain(fallbackLink);
      expect(html).toContain(`<meta property="og:type" content="${ogType}">`);
      expect(html).toContain(`<meta name="twitter:card" content="${twitterCard}">`);
      expect(html.includes('property="og:image:width"')).toBe(includesImageDimensions);
      expect(html.includes('property="og:image:height"')).toBe(includesImageDimensions);
      expect(calls).toEqual([
        'https://preview.wamp.land/index.html',
        'https://preview.wamp.land/',
        request.url,
      ]);
    },
  );

  it('escapes every HTML-sensitive character in metadata and the fallback link', async () => {
    const metadata: RoomShareMetadata = {
      title: `Fish & <Chips> "double" 'single'`,
      description: `A & <B> "C" 'D'`,
      url: `https://preview.wamp.land/r/1/2?a=1&label=<room>"'`,
      imageUrl: `https://cdn.example.test/image.png?a=1&label=<image>"'`,
      imageWidth: 1200,
      imageHeight: 630,
    };
    const fetchAsset = vi.fn(async () => new Response('missing', { status: 404 }));

    const response = await renderRoomAppShell(
      new Request('https://preview.wamp.land/r/1/2'),
      createEnv(fetchAsset),
      metadata,
    );
    const html = await response.text();

    expect(html).toContain('Fish &amp; &lt;Chips&gt; &quot;double&quot; &#39;single&#39;');
    expect(html).toContain('A &amp; &lt;B&gt; &quot;C&quot; &#39;D&#39;');
    expect(html).toContain(
      'href="https://preview.wamp.land/r/1/2?a=1&amp;label=&lt;room&gt;&quot;&#39;"',
    );
    expect(html).toContain(
      'content="https://cdn.example.test/image.png?a=1&amp;label=&lt;image&gt;&quot;&#39;"',
    );
    expect(html).not.toContain('<Chips>');
    expect(html).not.toContain('<B>');
  });
});

describe('Pages successful share app shells', () => {
  it.each(SHELL_CASES)(
    'preserves the $kind metadata vocabulary',
    async ({ render, metadata, ogType, twitterCard, includesImageDimensions }) => {
      const fetchAsset = vi.fn(async () => new Response(APP_SHELL));

      const response = await render(
        new Request(metadata.url),
        createEnv(fetchAsset),
        metadata,
      );
      const html = await response.text();

      expect(html).toContain(`<meta property="og:type" content="${ogType}">`);
      expect(html).toContain(`<meta name="twitter:card" content="${twitterCard}">`);
      expect(html.includes('property="og:image:width"')).toBe(includesImageDimensions);
      expect(html.includes('property="og:image:height"')).toBe(includesImageDimensions);
      expect(html).toContain(`<meta property="og:title" content="${metadata.title}">`);
      expect(html).toContain(`<meta property="og:description" content="${metadata.description}">`);
      expect(html).toContain(`<link rel="canonical" href="${metadata.url}">`);
      expect(html).toContain(`<meta property="og:image" content="${metadata.imageUrl}">`);
    },
  );

  it('forces the response contract while preserving unrelated asset headers', async () => {
    const fetchAsset = vi.fn(async () => new Response(APP_SHELL, {
      status: 206,
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Length': '999',
        'Content-Type': 'application/octet-stream',
        ETag: 'fixture-etag',
        'X-Asset-Fixture': 'preserved',
      },
    }));

    const response = await renderPlaylistAppShell(
      new Request(PLAYLIST_METADATA.url),
      createEnv(fetchAsset),
      PLAYLIST_METADATA,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe(CACHE_CONTROL);
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('Content-Length')).toBeNull();
    expect(response.headers.get('ETag')).toBe('fixture-etag');
    expect(response.headers.get('X-Asset-Fixture')).toBe('preserved');
  });

  it('performs the HEAD lookup with the original method and returns no body', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetchAsset = vi.fn(async (request: Request) => {
      calls.push({ url: request.url, method: request.method });
      if (calls.length < 3) return new Response('missing', { status: 404 });
      return new Response(APP_SHELL, { headers: { 'X-Asset-Fixture': 'preserved' } });
    });
    const request = new Request(
      'https://preview.wamp.land/fixture_user?fixture=safety',
      { method: 'HEAD' },
    );

    const response = await renderProfileAppShell(request, createEnv(fetchAsset), PROFILE_METADATA);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect(response.body).toBeNull();
    expect(response.headers.get('X-Asset-Fixture')).toBe('preserved');
    expect(calls).toEqual([
      { url: 'https://preview.wamp.land/index.html', method: 'HEAD' },
      { url: 'https://preview.wamp.land/', method: 'HEAD' },
      {
        url: 'https://preview.wamp.land/fixture_user?fixture=safety',
        method: 'HEAD',
      },
    ]);
  });

  it('inserts a base and metadata before the first closing head, replaces only the first title, and retains existing social tags', async () => {
    const source = [
      '<!doctype html>',
      '<html>',
      '<head data-fixture="shell">',
      '  <title>Old first title</title>',
      '  <title>Keep second title</title>',
      '  <meta property="og:title" content="retain-existing">',
      '</head>',
      '<body></body>',
      '</html>',
    ].join('\n');
    const fetchAsset = vi.fn(async () => new Response(source));

    const response = await renderRoomAppShell(
      new Request(ROOM_METADATA.url),
      createEnv(fetchAsset),
      ROOM_METADATA,
    );
    const html = await response.text();

    expect(html.match(/<base\s/gi)).toHaveLength(1);
    expect(html).toContain('<head data-fixture="shell">\n    <base href="/">');
    expect(html).toContain('<title>Fixture Room</title>');
    expect(html).not.toContain('<title>Old first title</title>');
    expect(html).toContain('<title>Keep second title</title>');
    expect(html).toContain('<meta property="og:title" content="retain-existing">');
    expect(html.indexOf('<meta property="og:title" content="Fixture Room">'))
      .toBeLessThan(html.indexOf('</head>'));
  });

  it('does not duplicate an existing case-insensitive base element', async () => {
    const source = '<html><head><BASE href="/already/"><title>Old</title></head><body></body></html>';
    const fetchAsset = vi.fn(async () => new Response(source));

    const response = await renderProfileAppShell(
      new Request(PROFILE_METADATA.url),
      createEnv(fetchAsset),
      PROFILE_METADATA,
    );
    const html = await response.text();

    expect(html.match(/<base\s/gi)).toHaveLength(1);
    expect(html).toContain('<BASE href="/already/">');
    expect(html).not.toContain('<base href="/">');
  });
});

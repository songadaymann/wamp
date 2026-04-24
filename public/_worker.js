const ROOM_PATH_PATTERN = /^\/r\/(-?\d+)\/(-?\d+)\/?$/;
const DEFAULT_API_BASE_URL = 'https://api.wamp.land';
const ROOM_META_TIMEOUT_MS = 1200;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const coordinates = parseRoomPath(url.pathname);
    if (!coordinates) {
      return env.ASSETS.fetch(request);
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { Allow: 'GET, HEAD' },
      });
    }

    const metadata = await loadRoomMetadata(request, env, url, coordinates);
    return renderRoomAppShell(request, env, metadata);
  },
};

function parseRoomPath(pathname) {
  const match = ROOM_PATH_PATTERN.exec(pathname);
  if (!match) {
    return null;
  }

  return {
    x: Number.parseInt(match[1], 10),
    y: Number.parseInt(match[2], 10),
  };
}

async function loadRoomMetadata(request, env, url, coordinates) {
  const apiBaseUrl = resolveApiBaseUrl(env, url);
  const roomId = `${coordinates.x},${coordinates.y}`;
  const publicUrl = `${url.origin}/r/${coordinates.x}/${coordinates.y}`;
  const fallback = buildFallbackMetadata(apiBaseUrl, roomId, coordinates, publicUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ROOM_META_TIMEOUT_MS);

  try {
    const metaUrl = new URL(`/api/share/rooms/${encodeURIComponent(roomId)}/meta`, apiBaseUrl);
    metaUrl.searchParams.set('x', String(coordinates.x));
    metaUrl.searchParams.set('y', String(coordinates.y));
    metaUrl.searchParams.set('url', publicUrl);
    const response = await fetch(metaUrl.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': request.headers.get('User-Agent') || 'WAMP room share renderer',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      return fallback;
    }

    return normalizeMetadata(await response.json(), fallback);
  } catch {
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}

function resolveApiBaseUrl(env, url) {
  const configured = typeof env.ROOM_SHARE_API_BASE_URL === 'string'
    ? env.ROOM_SHARE_API_BASE_URL.trim()
    : '';
  if (configured) {
    return configured.replace(/\/+$/, '');
  }

  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    return `${url.protocol}//${url.hostname}:8787`;
  }

  return DEFAULT_API_BASE_URL;
}

function buildFallbackMetadata(apiBaseUrl, roomId, coordinates, publicUrl) {
  const imageUrl = new URL(`/api/share/rooms/${encodeURIComponent(roomId)}/image`, apiBaseUrl);
  imageUrl.searchParams.set('x', String(coordinates.x));
  imageUrl.searchParams.set('y', String(coordinates.y));

  return {
    title: `WAMP room ${coordinates.x},${coordinates.y}`,
    description: `Play this WAMP room at ${coordinates.x},${coordinates.y}.`,
    url: publicUrl,
    imageUrl: imageUrl.toString(),
    imageWidth: 1200,
    imageHeight: 630,
  };
}

function normalizeMetadata(value, fallback) {
  if (!value || typeof value !== 'object') {
    return fallback;
  }

  return {
    title: cleanText(value.title) || fallback.title,
    description: cleanText(value.description) || fallback.description,
    url: cleanUrl(value.url) || fallback.url,
    imageUrl: cleanUrl(value.imageUrl) || fallback.imageUrl,
    imageWidth: Number.isFinite(value.imageWidth) ? value.imageWidth : fallback.imageWidth,
    imageHeight: Number.isFinite(value.imageHeight) ? value.imageHeight : fallback.imageHeight,
  };
}

async function renderRoomAppShell(request, env, metadata) {
  const url = new URL(request.url);
  const indexRequest = new Request(new URL('/index.html', url.origin), request);
  const indexResponse = await env.ASSETS.fetch(indexRequest);
  if (!indexResponse.ok) {
    return fallbackHtmlResponse(request, metadata);
  }

  const headers = new Headers(indexResponse.headers);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'public, max-age=60, s-maxage=300');
  headers.delete('Content-Length');

  if (request.method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers,
    });
  }

  const html = await indexResponse.text();
  return new Response(injectRoomMetadata(html, metadata), {
    status: 200,
    headers,
  });
}

function fallbackHtmlResponse(request, metadata) {
  const body = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    buildRoomMetaTags(metadata),
    '</head>',
    '<body>',
    `  <p><a href="${escapeHtml(metadata.url)}">Open this WAMP room</a></p>`,
    '</body>',
    '</html>',
  ].join('\n');

  return new Response(request.method === 'HEAD' ? null : body, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=60, s-maxage=300',
    },
  });
}

function injectRoomMetadata(html, metadata) {
  let nextHtml = html;
  if (!/<base\s/i.test(nextHtml)) {
    nextHtml = nextHtml.replace(/<head([^>]*)>/i, '<head$1>\n    <base href="/">');
  }

  if (/<title>[\s\S]*?<\/title>/i.test(nextHtml)) {
    nextHtml = nextHtml.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(metadata.title)}</title>`);
  }

  return nextHtml.replace(/<\/head>/i, `${buildRoomMetaTags(metadata)}\n  </head>`);
}

function buildRoomMetaTags(metadata) {
  const title = escapeHtml(metadata.title);
  const description = escapeHtml(metadata.description);
  const pageUrl = escapeHtml(metadata.url);
  const imageUrl = escapeHtml(metadata.imageUrl);
  const imageWidth = escapeHtml(String(metadata.imageWidth));
  const imageHeight = escapeHtml(String(metadata.imageHeight));

  return [
    '    <meta name="robots" content="index,follow">',
    `    <link rel="canonical" href="${pageUrl}">`,
    '    <meta property="og:type" content="website">',
    '    <meta property="og:site_name" content="WAMP">',
    `    <meta property="og:title" content="${title}">`,
    `    <meta property="og:description" content="${description}">`,
    `    <meta property="og:url" content="${pageUrl}">`,
    `    <meta property="og:image" content="${imageUrl}">`,
    `    <meta property="og:image:secure_url" content="${imageUrl}">`,
    `    <meta property="og:image:width" content="${imageWidth}">`,
    `    <meta property="og:image:height" content="${imageHeight}">`,
    '    <meta name="twitter:card" content="summary_large_image">',
    `    <meta name="twitter:title" content="${title}">`,
    `    <meta name="twitter:description" content="${description}">`,
    `    <meta name="twitter:image" content="${imageUrl}">`,
  ].join('\n');
}

function cleanText(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function cleanUrl(value) {
  if (typeof value !== 'string') {
    return '';
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

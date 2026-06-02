import decodeJpegBytes from 'jpeg-js/lib/decoder.js';
import {
  buildProfileSharePath,
  parseProfileSharePath,
} from '../src/profiles/username.ts';
import {
  buildPlaylistSharePath,
  parsePlaylistSharePath,
} from '../src/playlists/model.ts';
import {
  buildWampOGramSharePath,
  parseWampOGramSharePath,
} from '../src/wampOGram/links.ts';
import {
  BACKGROUND_GROUPS,
  GAME_OBJECTS,
  ROOM_HEIGHT,
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
  ROOM_WIDTH,
  TILESETS,
  TILE_FLIP_X_FLAG,
  TILE_FLIP_Y_FLAG,
  TILE_SIZE,
  getObjectDefaultFrame,
  getObjectFrameSourceRect,
  getPlacedObjectLayer,
} from '../src/config.ts';

const ROOM_PATH_PATTERN = /^\/r\/(-?\d+)\/(-?\d+)\/?$/;
const ROOM_IMAGE_PATH_PATTERN = /^\/r\/(-?\d+)\/(-?\d+)\/image(?:\.png)?\/?$/;
const DEFAULT_API_BASE_URL = 'https://api.wamp.land';
const ROOM_META_TIMEOUT_MS = 1200;
const PROFILE_META_TIMEOUT_MS = 1200;
const WAMP_O_GRAM_META_TIMEOUT_MS = 1200;
const ROOM_IMAGE_TIMEOUT_MS = 3500;
const ROOM_IMAGE_RENDERER_VERSION = 'assets-v5';
const ROOM_SHARE_IMAGE_WIDTH = 1200;
const ROOM_SHARE_IMAGE_HEIGHT = 630;
const CUSTOM_BACKGROUND_PREFIX = 'custom:';
const CUSTOM_SPRITE_OBJECT_PREFIX = 'custom_sprite:';
const SOLID_BACKGROUND_PREFIX = 'solid:';
const DEFAULT_CUSTOM_BACKGROUND_FIT = 'tile';
const MAX_TILED_PHOTO_WIDTH = 128;
const MAX_TILED_PHOTO_HEIGHT = 96;
const MAX_CUSTOM_BACKGROUND_DECODE_MP = 8;
const MAX_CUSTOM_BACKGROUND_DECODE_MEMORY_MB = 96;
const PREVIEW_TILE_SIZE = 27;
const PREVIEW_LEFT = 60;
const PREVIEW_TOP = 18;
const PREVIEW_WIDTH = ROOM_WIDTH * PREVIEW_TILE_SIZE;
const PREVIEW_HEIGHT = ROOM_HEIGHT * PREVIEW_TILE_SIZE;
const GAME_OBJECT_CONFIG_BY_ID = new Map(GAME_OBJECTS.map((config) => [config.id, config]));
const imageDataCache = new Map();
const STANDALONE_PAGE_ALIASES = new Map([
  ['/school-admin', '/school-admin.html'],
  ['/school-admin/', '/school-admin.html'],
  ['/school-admin.html', '/school-admin.html'],
  ['/school-login', '/school-login.html'],
  ['/school-login/', '/school-login.html'],
  ['/school-login.html', '/school-login.html'],
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const standalonePage = STANDALONE_PAGE_ALIASES.get(url.pathname);
    if (standalonePage) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method Not Allowed', {
          status: 405,
          headers: { Allow: 'GET, HEAD' },
        });
      }

      return fetchStandalonePageAsset(request, env, standalonePage);
    }

    const imageCoordinates = parseRoomPath(url.pathname, ROOM_IMAGE_PATH_PATTERN);
    if (imageCoordinates) {
      return renderRoomImageResponse(request, env, url, imageCoordinates);
    }

    const coordinates = parseRoomPath(url.pathname) || parseRoomQuery(url);
    if (coordinates) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method Not Allowed', {
          status: 405,
          headers: { Allow: 'GET, HEAD' },
        });
      }

      const metadata = await loadRoomMetadata(request, env, url, coordinates);
      return renderRoomAppShell(request, env, metadata);
    }

    const playlistSlug = parsePlaylistSharePath(url.pathname);
    if (playlistSlug) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method Not Allowed', {
          status: 405,
          headers: { Allow: 'GET, HEAD' },
        });
      }

      const metadata = await loadPlaylistMetadata(request, env, url, playlistSlug);
      return renderPlaylistAppShell(request, env, metadata);
    }

    const wampOGramSlug = parseWampOGramSharePath(url.pathname);
    if (wampOGramSlug) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method Not Allowed', {
          status: 405,
          headers: { Allow: 'GET, HEAD' },
        });
      }

      const metadata = await loadWampOGramMetadata(request, env, url, wampOGramSlug);
      return renderWampOGramAppShell(request, env, metadata);
    }

    const profileUsername = parseProfileSharePath(url.pathname);
    if (!profileUsername) {
      return env.ASSETS.fetch(request);
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { Allow: 'GET, HEAD' },
      });
    }

    const metadata = await loadProfileMetadata(request, env, url, profileUsername);
    return renderProfileAppShell(request, env, metadata);
  },
};

async function fetchStandalonePageAsset(request, env, pathname) {
  const url = new URL(request.url);
  const apiBaseUrl = resolveApiBaseUrl(env, url);
  const assetUrl = new URL(pathname, `${apiBaseUrl}/`);
  const response = await fetch(assetUrl.toString(), {
    method: request.method === 'HEAD' ? 'GET' : request.method,
    headers: { Accept: 'text/html' },
    redirect: 'follow',
  });
  const headers = new Headers(response.headers);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'public, max-age=60, s-maxage=300');
  headers.delete('Content-Length');

  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status,
    headers,
  });
}

function parseRoomPath(pathname, pattern = ROOM_PATH_PATTERN) {
  const match = pattern.exec(pathname);
  if (!match) {
    return null;
  }

  return {
    x: Number.parseInt(match[1], 10),
    y: Number.parseInt(match[2], 10),
  };
}

function parseRoomQuery(url) {
  if (url.pathname !== '/' && url.pathname !== '/index.html') {
    return null;
  }

  const x = parseStrictInteger(url.searchParams.get('x'));
  const y = parseStrictInteger(url.searchParams.get('y'));
  if (x === null || y === null) {
    return null;
  }

  return { x, y };
}

function parseStrictInteger(value) {
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

async function loadRoomMetadata(request, env, url, coordinates) {
  const apiBaseUrl = resolveApiBaseUrl(env, url);
  const roomId = `${coordinates.x},${coordinates.y}`;
  const publicUrl = `${url.origin}/r/${coordinates.x}/${coordinates.y}`;
  const fallback = buildFallbackMetadata(apiBaseUrl, roomId, coordinates, publicUrl);
  const publishedRoom = await loadPublishedRoomSnapshot(request, env, url, coordinates, ROOM_META_TIMEOUT_MS);
  if (publishedRoom) {
    return buildPublishedRoomMetadata(publishedRoom, fallback, coordinates);
  }

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

    return {
      ...normalizeMetadata(await response.json(), fallback),
      imageUrl: fallback.imageUrl,
    };
  } catch {
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadProfileMetadata(request, env, url, username) {
  const apiBaseUrl = resolveApiBaseUrl(env, url);
  const publicUrl = `${url.origin}${buildProfileSharePath(username)}`;
  const fallback = buildFallbackProfileMetadata(username, publicUrl, url.origin);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROFILE_META_TIMEOUT_MS);

  try {
    const profileUrl = new URL(`/api/profiles/by-username/${encodeURIComponent(username)}`, apiBaseUrl);
    const response = await fetch(profileUrl.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': request.headers.get('User-Agent') || 'WAMP profile share renderer',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      return fallback;
    }

    return buildPublishedProfileMetadata(await response.json(), fallback);
  } catch {
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadPlaylistMetadata(request, env, url, slug) {
  const apiBaseUrl = resolveApiBaseUrl(env, url);
  const publicUrl = `${url.origin}${buildPlaylistSharePath(slug)}`;
  const fallback = buildFallbackPlaylistMetadata(slug, publicUrl, url.origin);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROFILE_META_TIMEOUT_MS);

  try {
    const playlistUrl = new URL(`/api/playlists/by-slug/${encodeURIComponent(slug)}`, apiBaseUrl);
    const response = await fetch(playlistUrl.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': request.headers.get('User-Agent') || 'WAMP playlist share renderer',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      return fallback;
    }

    return buildPublishedPlaylistMetadata(await response.json(), fallback);
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
  const imageUrl = new URL(`/r/${coordinates.x}/${coordinates.y}/image.png`, publicUrl);

  return {
    title: `WAMP room ${coordinates.x},${coordinates.y}`,
    description: `Play this WAMP room at ${coordinates.x},${coordinates.y}.`,
    url: publicUrl,
    imageUrl: imageUrl.toString(),
    imageWidth: 1200,
    imageHeight: 630,
  };
}

function buildFallbackProfileMetadata(username, publicUrl, origin) {
  return {
    title: `@${username} on WAMP`,
    description: `View @${username}'s WAMP profile, levels, progress, and stats.`,
    url: publicUrl,
    imageUrl: new URL('/favicon.svg', origin).toString(),
  };
}

function buildFallbackPlaylistMetadata(slug, publicUrl, origin) {
  return {
    title: `${slug} - WAMP playlist`,
    description: `Play this WAMP room playlist.`,
    url: publicUrl,
    imageUrl: new URL('/favicon.svg', origin).toString(),
  };
}

function buildFallbackWampOGramMetadata(slug, publicUrl, apiBaseUrl) {
  return {
    title: 'Wamp-O-Gram',
    description: 'Open this playable WAMP level postcard.',
    url: publicUrl,
    imageUrl: new URL(`/api/wamp-o-grams/${encodeURIComponent(slug)}/preview.png`, apiBaseUrl).toString(),
    imageWidth: ROOM_SHARE_IMAGE_WIDTH,
    imageHeight: ROOM_SHARE_IMAGE_HEIGHT,
  };
}

function buildPublishedRoomMetadata(snapshot, fallback, coordinates) {
  const roomTitle = cleanText(snapshot?.title);
  const title = roomTitle
    ? `${roomTitle} - WAMP room ${coordinates.x},${coordinates.y}`
    : fallback.title;

  return {
    ...fallback,
    title,
    description: roomTitle
      ? `Play "${roomTitle}" in WAMP. Can you do better?`
      : fallback.description,
    imageUrl: withRoomVersionQuery(fallback.imageUrl, snapshot?.version),
  };
}

function buildPublishedProfileMetadata(profile, fallback) {
  const displayName = cleanText(profile?.displayName) || fallback.title.replace(/ on WAMP$/, '');
  const username = cleanText(profile?.username);
  const bio = cleanText(profile?.bio);
  const totalRooms = Number(profile?.stats?.totalRoomsPublished ?? 0) || 0;
  const roomText = totalRooms === 1 ? '1 published level' : `${totalRooms} published levels`;
  const title = username ? `${displayName} (@${username}) on WAMP` : `${displayName} on WAMP`;
  const description = bio || `${displayName}'s WAMP profile with ${roomText}, progress, and stats.`;
  const avatarUrl = cleanUrl(profile?.avatarUrl);

  return {
    ...fallback,
    title,
    description,
    imageUrl: avatarUrl || fallback.imageUrl,
  };
}

function buildPublishedPlaylistMetadata(playlist, fallback) {
  const title = cleanText(playlist?.title) || fallback.title;
  const owner = cleanText(playlist?.ownerDisplayName);
  const description = cleanText(playlist?.description);
  const roomCount = Number(playlist?.roomCount ?? playlist?.items?.length ?? 0) || 0;
  const roomText = roomCount === 1 ? '1 room' : `${roomCount} rooms`;

  return {
    ...fallback,
    title: `${title} - WAMP playlist`,
    description: description || `${owner ? `${owner}'s ` : ''}WAMP playlist with ${roomText}.`,
  };
}

function buildPublishedWampOGramMetadata(record, fallback) {
  const title = cleanText(record?.title);
  const recipient = cleanText(record?.recipientName);
  const sender = cleanText(record?.senderName) || cleanText(record?.creatorDisplayName);
  const message = cleanText(record?.message);

  return {
    ...fallback,
    title: title || (recipient ? `A Wamp-O-Gram for ${recipient}` : 'Wamp-O-Gram'),
    description: message || (sender
      ? `${sender} made a playable WAMP level postcard.`
      : fallback.description),
  };
}

async function loadWampOGramMetadata(request, env, url, slug) {
  const apiBaseUrl = resolveApiBaseUrl(env, url);
  const publicUrl = `${url.origin}${buildWampOGramSharePath(slug)}`;
  const fallback = buildFallbackWampOGramMetadata(slug, publicUrl, apiBaseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WAMP_O_GRAM_META_TIMEOUT_MS);

  try {
    const gramUrl = new URL(`/api/wamp-o-grams/${encodeURIComponent(slug)}`, apiBaseUrl);
    const response = await fetch(gramUrl.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': request.headers.get('User-Agent') || 'WAMP Wamp-O-Gram share renderer',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      return fallback;
    }

    return buildPublishedWampOGramMetadata(await response.json(), fallback);
  } catch {
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}

function withRoomVersionQuery(imageUrl, version) {
  const url = new URL(imageUrl);
  if (Number.isFinite(version)) {
    url.searchParams.set('v', String(version));
  }
  url.searchParams.set('renderer', ROOM_IMAGE_RENDERER_VERSION);
  return url.toString();
}

async function loadPublishedRoomSnapshot(request, env, url, coordinates, timeoutMs) {
  const apiBaseUrl = resolveApiBaseUrl(env, url);
  const roomId = `${coordinates.x},${coordinates.y}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const roomUrl = new URL(`/api/rooms/${encodeURIComponent(roomId)}/published`, apiBaseUrl);
    roomUrl.searchParams.set('x', String(coordinates.x));
    roomUrl.searchParams.set('y', String(coordinates.y));
    const response = await fetch(roomUrl.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': request.headers.get('User-Agent') || 'WAMP room share renderer',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function renderRoomImageResponse(request, env, url, coordinates) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { Allow: 'GET, HEAD' },
    });
  }

  const headers = {
    'Content-Type': 'image/png',
    'Cache-Control': 'public, max-age=300, s-maxage=3600',
  };

  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers });
  }

  const snapshot =
    await loadPublishedRoomSnapshot(request, env, url, coordinates, ROOM_IMAGE_TIMEOUT_MS)
    ?? createFallbackRoomSnapshot(coordinates);
  return new Response(await renderRoomSharePreviewPng(request, env, url, snapshot), {
    status: 200,
    headers,
  });
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
  const indexResponse = await fetchAppShellAsset(request, env);
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

async function renderProfileAppShell(request, env, metadata) {
  const indexResponse = await fetchAppShellAsset(request, env);
  if (!indexResponse.ok) {
    return fallbackProfileHtmlResponse(request, metadata);
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
  return new Response(injectProfileMetadata(html, metadata), {
    status: 200,
    headers,
  });
}

async function renderPlaylistAppShell(request, env, metadata) {
  const indexResponse = await fetchAppShellAsset(request, env);
  if (!indexResponse.ok) {
    return fallbackPlaylistHtmlResponse(request, metadata);
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
  return new Response(injectPlaylistMetadata(html, metadata), {
    status: 200,
    headers,
  });
}

async function renderWampOGramAppShell(request, env, metadata) {
  const indexResponse = await fetchAppShellAsset(request, env);
  if (!indexResponse.ok) {
    return fallbackWampOGramHtmlResponse(request, metadata);
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
  return new Response(injectWampOGramMetadata(html, metadata), {
    status: 200,
    headers,
  });
}

async function fetchAppShellAsset(request, env) {
  const url = new URL(request.url);
  for (const pathname of ['/index.html', '/']) {
    const assetUrl = new URL(pathname, url.origin);
    const response = await env.ASSETS.fetch(new Request(assetUrl, request));
    if (response.ok) {
      return response;
    }
  }

  return env.ASSETS.fetch(request);
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

function fallbackProfileHtmlResponse(request, metadata) {
  const body = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    buildProfileMetaTags(metadata),
    '</head>',
    '<body>',
    `  <p><a href="${escapeHtml(metadata.url)}">Open this WAMP profile</a></p>`,
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

function fallbackPlaylistHtmlResponse(request, metadata) {
  const body = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    buildPlaylistMetaTags(metadata),
    '</head>',
    '<body>',
    `  <p><a href="${escapeHtml(metadata.url)}">Open this WAMP playlist</a></p>`,
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

function fallbackWampOGramHtmlResponse(request, metadata) {
  const body = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    buildRoomMetaTags(metadata),
    '</head>',
    '<body>',
    `  <p><a href="${escapeHtml(metadata.url)}">Open this Wamp-O-Gram</a></p>`,
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

function injectProfileMetadata(html, metadata) {
  let nextHtml = html;
  if (!/<base\s/i.test(nextHtml)) {
    nextHtml = nextHtml.replace(/<head([^>]*)>/i, '<head$1>\n    <base href="/">');
  }

  if (/<title>[\s\S]*?<\/title>/i.test(nextHtml)) {
    nextHtml = nextHtml.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(metadata.title)}</title>`);
  }

  return nextHtml.replace(/<\/head>/i, `${buildProfileMetaTags(metadata)}\n  </head>`);
}

function injectPlaylistMetadata(html, metadata) {
  let nextHtml = html;
  if (!/<base\s/i.test(nextHtml)) {
    nextHtml = nextHtml.replace(/<head([^>]*)>/i, '<head$1>\n    <base href="/">');
  }

  if (/<title>[\s\S]*?<\/title>/i.test(nextHtml)) {
    nextHtml = nextHtml.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(metadata.title)}</title>`);
  }

  return nextHtml.replace(/<\/head>/i, `${buildPlaylistMetaTags(metadata)}\n  </head>`);
}

function injectWampOGramMetadata(html, metadata) {
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
    '    <meta property="og:image:type" content="image/png">',
    `    <meta property="og:image:width" content="${imageWidth}">`,
    `    <meta property="og:image:height" content="${imageHeight}">`,
    `    <meta property="og:image:alt" content="${title}">`,
    '    <meta name="twitter:card" content="summary_large_image">',
    `    <meta name="twitter:title" content="${title}">`,
    `    <meta name="twitter:description" content="${description}">`,
    `    <meta name="twitter:image" content="${imageUrl}">`,
    `    <meta name="twitter:image:alt" content="${title}">`,
  ].join('\n');
}

function buildProfileMetaTags(metadata) {
  const title = escapeHtml(metadata.title);
  const description = escapeHtml(metadata.description);
  const pageUrl = escapeHtml(metadata.url);
  const imageUrl = escapeHtml(metadata.imageUrl);

  return [
    '    <meta name="robots" content="index,follow">',
    `    <link rel="canonical" href="${pageUrl}">`,
    '    <meta property="og:type" content="profile">',
    '    <meta property="og:site_name" content="WAMP">',
    `    <meta property="og:title" content="${title}">`,
    `    <meta property="og:description" content="${description}">`,
    `    <meta property="og:url" content="${pageUrl}">`,
    `    <meta property="og:image" content="${imageUrl}">`,
    `    <meta property="og:image:secure_url" content="${imageUrl}">`,
    '    <meta name="twitter:card" content="summary">',
    `    <meta name="twitter:title" content="${title}">`,
    `    <meta name="twitter:description" content="${description}">`,
    `    <meta name="twitter:image" content="${imageUrl}">`,
  ].join('\n');
}

function buildPlaylistMetaTags(metadata) {
  const title = escapeHtml(metadata.title);
  const description = escapeHtml(metadata.description);
  const pageUrl = escapeHtml(metadata.url);
  const imageUrl = escapeHtml(metadata.imageUrl);

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
    '    <meta name="twitter:card" content="summary">',
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

function createFallbackRoomSnapshot(coordinates) {
  return {
    id: `${coordinates.x},${coordinates.y}`,
    coordinates,
    title: null,
    background: 'grassland',
    tileData: {
      background: emptyTileLayer(),
      terrain: emptyTileLayer(),
      foreground: emptyTileLayer(),
    },
    placedObjects: [],
  };
}

function emptyTileLayer() {
  return Array.from({ length: ROOM_HEIGHT }, () => Array.from({ length: ROOM_WIDTH }, () => -1));
}

async function renderRoomSharePreviewPng(request, env, url, snapshot) {
  const canvas = createCanvas(ROOM_SHARE_IMAGE_WIDTH, ROOM_SHARE_IMAGE_HEIGHT);
  await primeRoomAssetCache(request, env, url, snapshot);
  await drawPreviewBackground(canvas, request, env, url, snapshot);
  drawRoomFrame(canvas);
  await drawRoomAssetLayers(canvas, request, env, url, snapshot);
  drawBorder(canvas, PREVIEW_LEFT - 4, PREVIEW_TOP - 4, PREVIEW_WIDTH + 8, PREVIEW_HEIGHT + 8, 0xf5f1de);
  return encodePng(canvas.width, canvas.height, canvas.pixels);
}

function createCanvas(width, height) {
  return {
    width,
    height,
    pixels: new Uint8Array(width * height * 4),
  };
}

async function drawPreviewBackground(canvas, request, env, url, snapshot) {
  const background = resolvePreviewBackground(snapshot?.background);
  if (background.kind === 'solid') {
    fillRect(canvas, 0, 0, canvas.width, canvas.height, background.color);
    return;
  }

  const palette = background.palette;
  fillRect(canvas, 0, 0, canvas.width, canvas.height, palette.sky);
  fillRect(canvas, 0, Math.floor(canvas.height * 0.42), canvas.width, Math.ceil(canvas.height * 0.3), palette.far);
  fillRect(canvas, 0, Math.floor(canvas.height * 0.62), canvas.width, Math.ceil(canvas.height * 0.38), palette.near);
  drawHorizonSteps(canvas, palette.far, palette.near, snapshot?.id || 'room');

  if (background.kind === 'custom') {
    try {
      const image = await loadCustomBackgroundImageData(request, env, url, background.id);
      drawCustomBackgroundImage(canvas, image, background.fit, 0, 0, canvas.width, canvas.height);
    } catch {
      // Keep the generated fallback background when a remote upload cannot be transformed.
    }
    return;
  }

  const group = getBackgroundGroup(background.id);
  if (!group || group.layers.length === 0) {
    return;
  }

  for (const layer of group.layers) {
    try {
      const image = await loadAssetImageData(request, env, url, layer.path);
      const drawHeight = canvas.height;
      const drawWidth = Math.max(1, Math.ceil(layer.width * (drawHeight / layer.height)));
      for (let drawX = 0; drawX < canvas.width + drawWidth; drawX += drawWidth) {
        blitImageNearest(canvas, image, 0, 0, image.width, image.height, drawX, 0, drawWidth, drawHeight);
      }
    } catch {
      return;
    }
  }
}

function resolvePreviewBackground(background) {
  if (typeof background === 'string') {
    const solidColor = parseSolidBackgroundColor(background);
    if (solidColor !== null) {
      return { kind: 'solid', color: solidColor };
    }

    const custom = parseCustomBackground(background);
    if (custom) {
      return { kind: 'custom', ...custom, palette: backgroundPalette('grassland') };
    }

    return { kind: 'palette', id: background, palette: backgroundPalette(background) };
  }

  if (background && typeof background === 'object') {
    if (background.kind === 'solid' && typeof background.color === 'string') {
      return { kind: 'solid', color: hexToNumber(background.color) };
    }

    const id =
      background.groupId
      || background.group?.id
      || background.id
      || background.name
      || 'grassland';
    return { kind: 'palette', id: String(id), palette: backgroundPalette(String(id)) };
  }

  return { kind: 'palette', id: 'grassland', palette: backgroundPalette('grassland') };
}

function backgroundPalette(id) {
  const palettes = {
    forest: { sky: 0x8dd7cf, far: 0x5aa56f, near: 0x2f6f4c },
    dark_forest: { sky: 0x151f34, far: 0x1d3a38, near: 0x122722 },
    grassland: { sky: 0x8bcce3, far: 0x8ec65c, near: 0x4f8b48 },
    mountains: { sky: 0x96cde8, far: 0x8195aa, near: 0x4d6379 },
    meadow: { sky: 0xa7d99f, far: 0x84bf69, near: 0x4f8d57 },
    aurora: { sky: 0x172448, far: 0x2e5d7f, near: 0x283d58 },
    cave: { sky: 0x17171f, far: 0x262739, near: 0x12151d },
    desert: { sky: 0xf2c986, far: 0xd89d58, near: 0x9d6438 },
  };
  return palettes[id] || palettes.grassland;
}

function getBackgroundGroup(id) {
  return BACKGROUND_GROUPS.find((group) => group.id === id) || null;
}

function parseSolidBackgroundColor(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed.toLowerCase().startsWith(SOLID_BACKGROUND_PREFIX)) {
    return null;
  }

  const color = trimmed.slice(SOLID_BACKGROUND_PREFIX.length).replace(/^#/, '').trim();
  return /^[0-9a-f]{6}$/i.test(color) ? Number.parseInt(color, 16) : null;
}

function parseCustomBackground(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed.toLowerCase().startsWith(CUSTOM_BACKGROUND_PREFIX)) {
    return null;
  }

  const customValue = trimmed.slice(CUSTOM_BACKGROUND_PREFIX.length).trim();
  const queryStart = customValue.indexOf('?');
  const id = (queryStart >= 0 ? customValue.slice(0, queryStart) : customValue).trim();
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(id)) {
    return null;
  }

  const fit = queryStart >= 0
    ? new URLSearchParams(customValue.slice(queryStart + 1)).get('fit')
    : DEFAULT_CUSTOM_BACKGROUND_FIT;
  return {
    id,
    fit: fit === 'stretch' || fit === 'center' || fit === 'tile'
      ? fit
      : DEFAULT_CUSTOM_BACKGROUND_FIT,
  };
}

async function primeRoomAssetCache(request, env, url, snapshot) {
  const paths = new Set();
  const background = resolvePreviewBackground(snapshot?.background);
  if (background.kind === 'palette') {
    for (const layer of getBackgroundGroup(background.id)?.layers ?? []) {
      paths.add(layer.path);
    }
  } else if (background.kind === 'custom') {
    await loadCustomBackgroundImageData(request, env, url, background.id).catch(() => null);
  }

  const tileData = snapshot?.tileData || {};
  for (const layerName of ['background', 'terrain', 'foreground']) {
    const layer = Array.isArray(tileData[layerName]) ? tileData[layerName] : [];
    for (const row of layer) {
      if (!Array.isArray(row)) {
        continue;
      }
      for (const value of row) {
        const tileset = getTilesetByGid(decodeTileValue(value ?? -1).gid);
        if (tileset) {
          paths.add(tileset.path);
        }
      }
    }
  }

  const placedObjects = Array.isArray(snapshot?.placedObjects) ? snapshot.placedObjects : [];
  for (const placed of placedObjects) {
    const config = getObjectConfig(placed?.id);
    if (config) {
      paths.add(config.path);
    }
  }

  await Promise.allSettled(
    Array.from(paths, (path) => loadAssetImageData(request, env, url, path))
  );
}

function drawRoomFrame(canvas) {
  blendRect(canvas, PREVIEW_LEFT - 8, PREVIEW_TOP - 8, PREVIEW_WIDTH + 16, PREVIEW_HEIGHT + 16, 0x05070c, 0.12);
  blendRect(canvas, PREVIEW_LEFT, PREVIEW_TOP, PREVIEW_WIDTH, PREVIEW_HEIGHT, 0x0e1524, 0.04);
}

async function drawRoomAssetLayers(canvas, request, env, url, snapshot) {
  const tileData = snapshot?.tileData || {};
  for (const layerName of ['background', 'terrain', 'foreground']) {
    const layer = Array.isArray(tileData[layerName]) ? tileData[layerName] : [];
    await drawAssetTileLayer(canvas, request, env, url, layerName, layer);
    await drawAssetObjectsForLayer(canvas, request, env, url, snapshot, layerName);
  }
}

async function drawAssetTileLayer(canvas, request, env, url, layerName, layer) {
  for (let tileY = 0; tileY < ROOM_HEIGHT; tileY += 1) {
    const row = Array.isArray(layer[tileY]) ? layer[tileY] : [];
    for (let tileX = 0; tileX < ROOM_WIDTH; tileX += 1) {
      const { gid, flipX, flipY } = decodeTileValue(row[tileX] ?? -1);
      if (gid <= 0) {
        continue;
      }

      const tileset = getTilesetByGid(gid);
      if (!tileset) {
        drawFallbackTile(canvas, layerName, tileX, tileY, gid);
        continue;
      }

      try {
        const image = await loadAssetImageData(request, env, url, tileset.path);
        const localIndex = gid - tileset.firstGid;
        const sourceCol = localIndex % tileset.columns;
        const sourceRow = Math.floor(localIndex / tileset.columns);
        blitImageNearest(
          canvas,
          image,
          sourceCol * TILE_SIZE,
          sourceRow * TILE_SIZE,
          TILE_SIZE,
          TILE_SIZE,
          PREVIEW_LEFT + tileX * PREVIEW_TILE_SIZE,
          PREVIEW_TOP + tileY * PREVIEW_TILE_SIZE,
          PREVIEW_TILE_SIZE,
          PREVIEW_TILE_SIZE,
          flipX,
          flipY,
        );
      } catch {
        drawFallbackTile(canvas, layerName, tileX, tileY, gid);
      }
    }
  }
}

async function drawAssetObjectsForLayer(canvas, request, env, url, snapshot, layerName) {
  const placedObjects = Array.isArray(snapshot?.placedObjects) ? snapshot.placedObjects : [];
  for (const placed of placedObjects) {
    if (getPlacedObjectLayer(placed) !== layerName) {
      continue;
    }

    const customSprite = getCustomSpriteForObject(snapshot, placed?.id);
    if (customSprite) {
      drawCustomSpriteObject(canvas, customSprite, placed);
      continue;
    }

    const config = getObjectConfig(placed?.id);
    if (!config) {
      drawFallbackObject(canvas, placed);
      continue;
    }

    try {
      const image = await loadAssetImageData(request, env, url, config.path);
      const frame = getObjectDefaultFrame(config);
      const source = getObjectFrameSourceRect(config, frame, image.width || config.frameWidth);
      const scale = PREVIEW_TILE_SIZE / TILE_SIZE;
      const destX = PREVIEW_LEFT + Math.round((Number(placed.x || 0) - config.frameWidth / 2) * scale);
      const destY = PREVIEW_TOP + Math.round((Number(placed.y || 0) - config.frameHeight / 2) * scale);
      const destWidth = Math.max(1, Math.round(source.sw * scale));
      const destHeight = Math.max(1, Math.round(source.sh * scale));
      const shouldFlipX =
        Boolean(config.facingDirection) &&
        Boolean(placed.facing) &&
        config.facingDirection !== placed.facing;

      blitImageNearest(
        canvas,
        image,
        source.sx,
        source.sy,
        source.sw,
        source.sh,
        destX,
        destY,
        destWidth,
        destHeight,
        shouldFlipX,
        false,
      );
    } catch {
      drawFallbackObject(canvas, placed);
    }
  }
}

function getCustomSpriteForObject(snapshot, objectId) {
  const spriteId = parseCustomSpriteObjectId(objectId);
  if (!spriteId || !Array.isArray(snapshot?.customSprites)) {
    return null;
  }

  return snapshot.customSprites.find((sprite) => (
    sprite &&
    sprite.id === spriteId &&
    sprite.status !== 'blocked' &&
    (sprite.size === 16 || sprite.size === 32) &&
    Array.isArray(sprite.pixels)
  )) || null;
}

function parseCustomSpriteObjectId(objectId) {
  if (typeof objectId !== 'string' || !objectId.startsWith(CUSTOM_SPRITE_OBJECT_PREFIX)) {
    return null;
  }

  const id = objectId.slice(CUSTOM_SPRITE_OBJECT_PREFIX.length).trim();
  return id || null;
}

function drawCustomSpriteObject(canvas, sprite, placed) {
  const size = sprite.size === 32 ? 32 : 16;
  const scale = PREVIEW_TILE_SIZE / TILE_SIZE;
  const destX = PREVIEW_LEFT + Math.round((Number(placed.x || 0) - size / 2) * scale);
  const destY = PREVIEW_TOP + Math.round((Number(placed.y || 0) - size / 2) * scale);
  const destSize = Math.max(1, Math.round(size * scale));

  for (let pixelY = 0; pixelY < size; pixelY += 1) {
    const top = destY + Math.floor((pixelY * destSize) / size);
    const bottom = destY + Math.ceil(((pixelY + 1) * destSize) / size);
    for (let pixelX = 0; pixelX < size; pixelX += 1) {
      const color = sprite.pixels[pixelY * size + pixelX];
      if (!isCustomSpriteColor(color)) {
        continue;
      }

      const left = destX + Math.floor((pixelX * destSize) / size);
      const right = destX + Math.ceil(((pixelX + 1) * destSize) / size);
      fillRect(canvas, left, top, right - left, bottom - top, hexToNumber(color));
    }
  }
}

function isCustomSpriteColor(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

function drawTiles(canvas, snapshot) {
  const tileData = snapshot?.tileData || {};
  for (const layerName of ['background', 'terrain', 'foreground']) {
    const layer = Array.isArray(tileData[layerName]) ? tileData[layerName] : [];
    for (let tileY = 0; tileY < ROOM_HEIGHT; tileY += 1) {
      const row = Array.isArray(layer[tileY]) ? layer[tileY] : [];
      for (let tileX = 0; tileX < ROOM_WIDTH; tileX += 1) {
        const gid = decodeTileGid(row[tileX] ?? -1);
        if (gid <= 0) {
          continue;
        }

        drawFallbackTile(canvas, layerName, tileX, tileY, gid);
      }
    }
  }
}

function drawFallbackTile(canvas, layerName, tileX, tileY, gid) {
  const x = PREVIEW_LEFT + tileX * PREVIEW_TILE_SIZE;
  const y = PREVIEW_TOP + tileY * PREVIEW_TILE_SIZE;
  const color = getTileColor(gid, tileX, tileY);

  if (layerName === 'background') {
    blendRect(canvas, x + 4, y + 4, PREVIEW_TILE_SIZE - 8, PREVIEW_TILE_SIZE - 8, color, 0.45);
    return;
  }

  if (layerName === 'foreground') {
    blendRect(canvas, x + 2, y + 2, PREVIEW_TILE_SIZE - 4, PREVIEW_TILE_SIZE - 4, lighten(color, 0.18), 0.74);
    drawBorder(canvas, x + 2, y + 2, PREVIEW_TILE_SIZE - 4, PREVIEW_TILE_SIZE - 4, darken(color, 0.28));
    return;
  }

  fillRect(canvas, x, y, PREVIEW_TILE_SIZE, PREVIEW_TILE_SIZE, color);
  fillRect(canvas, x, y, PREVIEW_TILE_SIZE, 4, lighten(color, 0.2));
  fillRect(canvas, x, y + PREVIEW_TILE_SIZE - 4, PREVIEW_TILE_SIZE, 4, darken(color, 0.24));
  fillRect(canvas, x, y, 3, PREVIEW_TILE_SIZE, darken(color, 0.18));
  fillRect(canvas, x + PREVIEW_TILE_SIZE - 3, y, 3, PREVIEW_TILE_SIZE, darken(color, 0.3));
}

function drawObjects(canvas, snapshot) {
  const placedObjects = Array.isArray(snapshot?.placedObjects) ? snapshot.placedObjects : [];

  for (const placed of placedObjects) {
    drawFallbackObject(canvas, placed);
  }
}

function drawFallbackObject(canvas, placed) {
  if (!placed || typeof placed.id !== 'string') {
    return;
  }

  const scale = PREVIEW_TILE_SIZE / TILE_SIZE;
  const id = placed.id;
  const dimensions = getObjectPreviewDimensions(id);
  const width = Math.max(10, Math.round(dimensions.width * scale));
  const height = Math.max(10, Math.round(dimensions.height * scale));
  const centerX = PREVIEW_LEFT + Math.round(((Number(placed.x) || 0) / TILE_SIZE) * PREVIEW_TILE_SIZE);
  const centerY = PREVIEW_TOP + Math.round(((Number(placed.y) || 0) / TILE_SIZE) * PREVIEW_TILE_SIZE);
  const x = centerX - Math.floor(width / 2);
  const y = centerY - Math.floor(height / 2);

  if (isHazardObject(id)) {
    drawTriangle(canvas, centerX, y, x, y + height, x + width, y + height, 0xff5d4d);
    drawTriangle(canvas, centerX, y + 6, x + 6, y + height - 4, x + width - 6, y + height - 4, 0xffb15a);
  } else if (isEnemyObject(id)) {
    fillEllipse(canvas, centerX, centerY, Math.max(8, Math.floor(width * 0.45)), Math.max(7, Math.floor(height * 0.38)), 0x4fd1c5);
    fillRect(canvas, centerX - 5, centerY - 4, 4, 4, 0x07111c);
    fillRect(canvas, centerX + 3, centerY - 4, 4, 4, 0x07111c);
  } else if (isCollectibleObject(id)) {
    drawDiamond(canvas, centerX, centerY, Math.max(7, Math.floor(Math.min(width, height) * 0.42)), 0xffd447);
    drawDiamond(canvas, centerX, centerY - 2, Math.max(3, Math.floor(Math.min(width, height) * 0.18)), 0xfff3a4);
  } else if (id === 'flag' || id.includes('checkpoint')) {
    fillRect(canvas, centerX - 2, y, 5, height, 0xf5f1de);
    fillRect(canvas, centerX + 3, y + 2, Math.max(12, Math.floor(width * 0.7)), Math.max(12, Math.floor(height * 0.42)), 0x5dc16b);
  } else if (id === 'ladder') {
    fillRect(canvas, x + Math.floor(width * 0.2), y, 4, height, 0xd7ac63);
    fillRect(canvas, x + Math.floor(width * 0.75), y, 4, height, 0xd7ac63);
    for (let rungY = y + 8; rungY < y + height - 4; rungY += 12) {
      fillRect(canvas, x + Math.floor(width * 0.2), rungY, Math.floor(width * 0.6), 4, 0xf0c06b);
    }
  } else if (id.includes('door')) {
    fillRect(canvas, x, y, width, height, 0x3d4a5c);
    fillRect(canvas, x + 5, y + 5, width - 10, height - 10, 0x6f7f96);
    fillRect(canvas, x + width - 9, centerY, 5, 5, 0xffd447);
  } else if (id === 'spawn_point') {
    drawDiamond(canvas, centerX, centerY, Math.max(9, Math.floor(Math.min(width, height) * 0.38)), 0x7fd4ff);
  } else if (id.includes('platform')) {
    fillRect(canvas, x, y, width, height, 0x9a6b44);
    fillRect(canvas, x, y, width, 5, 0xd6a268);
    drawBorder(canvas, x, y, width, height, 0x4b2d1f);
  } else {
    drawDecoration(canvas, id, x, y, width, height, centerX, centerY);
  }
}

function getObjectPreviewDimensions(id) {
  if (id === 'ladder') return { width: 16, height: 48 };
  if (id.includes('trapdoor')) return { width: 16, height: 16 };
  if (id === 'blast_door') return { width: 16, height: 16 };
  if (id === 'barricade') return { width: 16, height: 16 };
  if (id.includes('door')) return { width: 32, height: 48 };
  if (id === 'flag' || id.includes('checkpoint')) return { width: 32, height: 48 };
  if (id.includes('tree')) return { width: 48, height: 64 };
  if (id.includes('sun')) return { width: 48, height: 48 };
  if (id.includes('water')) return { width: 16, height: 16 };
  if (id.includes('platform')) return { width: 48, height: 12 };
  return { width: 24, height: 24 };
}

function isHazardObject(id) {
  return /spike|fire|lava|saw|stake|thorn|hazard/.test(id);
}

function isEnemyObject(id) {
  return /enemy|slime|snake|bird|bat|crawler|ghost|monster/.test(id);
}

function isCollectibleObject(id) {
  return /coin|gem|key|star|heart|collect/.test(id);
}

function drawDecoration(canvas, id, x, y, width, height, centerX, centerY) {
  if (id.includes('tree')) {
    fillRect(canvas, centerX - 5, centerY, 10, Math.max(12, Math.floor(height * 0.45)), 0x7a4f34);
    fillEllipse(canvas, centerX, centerY - Math.floor(height * 0.22), Math.max(12, Math.floor(width * 0.42)), Math.max(12, Math.floor(height * 0.36)), 0x4b9b57);
    return;
  }

  if (id.includes('sign')) {
    fillRect(canvas, centerX - 3, y + Math.floor(height * 0.45), 6, Math.max(10, Math.floor(height * 0.48)), 0x9a6b44);
    fillRect(canvas, x, y, width, Math.max(12, Math.floor(height * 0.52)), 0xd7ac63);
    drawBorder(canvas, x, y, width, Math.max(12, Math.floor(height * 0.52)), 0x5f3928);
    return;
  }

  if (id.includes('rock')) {
    fillEllipse(canvas, centerX, centerY, Math.max(8, Math.floor(width * 0.46)), Math.max(6, Math.floor(height * 0.34)), 0x8c98a8);
    return;
  }

  if (id.includes('sun')) {
    fillEllipse(canvas, centerX, centerY, Math.max(12, Math.floor(width * 0.44)), Math.max(12, Math.floor(height * 0.44)), 0xffd447);
    return;
  }

  if (id.includes('water')) {
    blendRect(canvas, x, y, width, height, 0x4aa3df, 0.75);
    fillRect(canvas, x, y, width, 3, 0x9ddcff);
    return;
  }

  fillEllipse(canvas, centerX, centerY, Math.max(8, Math.floor(width * 0.42)), Math.max(6, Math.floor(height * 0.3)), 0x5dc16b);
}

function getTilesetByGid(gid) {
  for (const tileset of TILESETS) {
    if (gid >= tileset.firstGid && gid < tileset.firstGid + tileset.tileCount) {
      return tileset;
    }
  }

  return null;
}

function getObjectConfig(id) {
  return typeof id === 'string' ? GAME_OBJECT_CONFIG_BY_ID.get(id) ?? null : null;
}

function decodeTileGid(value) {
  return decodeTileValue(value).gid;
}

function decodeTileValue(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return { gid: -1, flipX: false, flipY: false };
  }

  const flipX = value >= TILE_FLIP_X_FLAG && Math.floor(value / TILE_FLIP_X_FLAG) % 2 === 1;
  const flipY = value >= TILE_FLIP_Y_FLAG && Math.floor(value / TILE_FLIP_Y_FLAG) % 2 === 1;
  return {
    gid: value - (flipX ? TILE_FLIP_X_FLAG : 0) - (flipY ? TILE_FLIP_Y_FLAG : 0),
    flipX,
    flipY,
  };
}

function getTileColor(gid, tileX, tileY) {
  const palettes = [
    0xd7ac63,
    0x5dc16b,
    0x63d6cb,
    0xff7a5c,
    0x8c98a8,
    0x9a6b44,
  ];
  const base = palettes[Math.abs(gid + tileX * 3 + tileY * 5) % palettes.length];
  const variation = ((gid + tileX + tileY) % 5) - 2;
  return variation >= 0 ? lighten(base, variation * 0.04) : darken(base, Math.abs(variation) * 0.05);
}

function drawHorizonSteps(canvas, farColor, nearColor, seedText) {
  let seed = hashString(seedText);
  for (let index = 0; index < 22; index += 1) {
    seed = nextSeed(seed);
    const stepWidth = 80 + (seed % 90);
    seed = nextSeed(seed);
    const stepHeight = 40 + (seed % 120);
    const x = (index * 67 + (seed % 40)) % canvas.width;
    const y = Math.floor(canvas.height * 0.5) - Math.floor(stepHeight * 0.35);
    blendRect(canvas, x, y, stepWidth, stepHeight, index % 2 === 0 ? farColor : nearColor, 0.32);
  }
}

function fillRect(canvas, x, y, width, height, color) {
  const rgb = numberToRgb(color);
  const left = clampInt(x, 0, canvas.width);
  const top = clampInt(y, 0, canvas.height);
  const right = clampInt(x + width, 0, canvas.width);
  const bottom = clampInt(y + height, 0, canvas.height);

  for (let row = top; row < bottom; row += 1) {
    let offset = (row * canvas.width + left) * 4;
    for (let col = left; col < right; col += 1) {
      canvas.pixels[offset] = rgb.r;
      canvas.pixels[offset + 1] = rgb.g;
      canvas.pixels[offset + 2] = rgb.b;
      canvas.pixels[offset + 3] = 255;
      offset += 4;
    }
  }
}

function blendRect(canvas, x, y, width, height, color, alpha) {
  const rgb = numberToRgb(color);
  const left = clampInt(x, 0, canvas.width);
  const top = clampInt(y, 0, canvas.height);
  const right = clampInt(x + width, 0, canvas.width);
  const bottom = clampInt(y + height, 0, canvas.height);
  const clampedAlpha = Math.max(0, Math.min(1, alpha));
  const inverseAlpha = 1 - clampedAlpha;

  for (let row = top; row < bottom; row += 1) {
    let offset = (row * canvas.width + left) * 4;
    for (let col = left; col < right; col += 1) {
      canvas.pixels[offset] = Math.round(canvas.pixels[offset] * inverseAlpha + rgb.r * clampedAlpha);
      canvas.pixels[offset + 1] = Math.round(canvas.pixels[offset + 1] * inverseAlpha + rgb.g * clampedAlpha);
      canvas.pixels[offset + 2] = Math.round(canvas.pixels[offset + 2] * inverseAlpha + rgb.b * clampedAlpha);
      canvas.pixels[offset + 3] = 255;
      offset += 4;
    }
  }
}

function drawBorder(canvas, x, y, width, height, color) {
  fillRect(canvas, x, y, width, 3, color);
  fillRect(canvas, x, y + height - 3, width, 3, color);
  fillRect(canvas, x, y, 3, height, color);
  fillRect(canvas, x + width - 3, y, 3, height, color);
}

function drawDiamond(canvas, centerX, centerY, radius, color) {
  for (let dy = -radius; dy <= radius; dy += 1) {
    const halfWidth = radius - Math.abs(dy);
    fillRect(canvas, centerX - halfWidth, centerY + dy, halfWidth * 2 + 1, 1, color);
  }
}

function drawTriangle(canvas, ax, ay, bx, by, cx, cy, color) {
  const minY = Math.floor(Math.min(ay, by, cy));
  const maxY = Math.ceil(Math.max(ay, by, cy));

  for (let y = minY; y <= maxY; y += 1) {
    const intersections = [];
    collectEdgeIntersection(intersections, y, ax, ay, bx, by);
    collectEdgeIntersection(intersections, y, bx, by, cx, cy);
    collectEdgeIntersection(intersections, y, cx, cy, ax, ay);
    intersections.sort((left, right) => left - right);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      fillRect(
        canvas,
        Math.floor(intersections[index]),
        y,
        Math.ceil(intersections[index + 1] - intersections[index]) + 1,
        1,
        color,
      );
    }
  }
}

function collectEdgeIntersection(intersections, scanY, ax, ay, bx, by) {
  if ((scanY < ay && scanY < by) || (scanY > ay && scanY > by) || ay === by) {
    return;
  }

  const t = (scanY - ay) / (by - ay);
  if (t < 0 || t > 1) {
    return;
  }

  intersections.push(ax + (bx - ax) * t);
}

function fillEllipse(canvas, centerX, centerY, radiusX, radiusY, color) {
  const safeRadiusX = Math.max(1, radiusX);
  const safeRadiusY = Math.max(1, radiusY);
  for (let dy = -safeRadiusY; dy <= safeRadiusY; dy += 1) {
    const normalizedY = dy / safeRadiusY;
    const halfWidth = Math.floor(safeRadiusX * Math.sqrt(Math.max(0, 1 - normalizedY * normalizedY)));
    fillRect(canvas, centerX - halfWidth, centerY + dy, halfWidth * 2 + 1, 1, color);
  }
}

async function loadAssetImageData(request, env, url, assetPath) {
  const normalizedPath = normalizeAssetPath(assetPath);
  let pending = imageDataCache.get(normalizedPath);
  if (pending) {
    return pending;
  }

  pending = (async () => {
    const assetUrl = new URL(normalizedPath, url.origin);
    const response = await env.ASSETS.fetch(new Request(assetUrl, request));
    if (!response.ok) {
      throw new Error(`Failed to load asset ${normalizedPath}`);
    }

    return decodePng(new Uint8Array(await response.arrayBuffer()));
  })();
  imageDataCache.set(normalizedPath, pending);
  return pending;
}

async function loadCustomBackgroundImageData(request, env, url, id) {
  const apiBaseUrl = resolveApiBaseUrl(env, url);
  const imageUrl = new URL(`/api/background-images/${encodeURIComponent(id)}/image`, apiBaseUrl);
  const cacheKey = `custom-background:${imageUrl.toString()}`;
  let pending = imageDataCache.get(cacheKey);
  if (pending) {
    return pending;
  }

  pending = (async () => {
    const response = await fetch(imageUrl.toString(), {
      headers: {
        Accept: 'image/png',
        'User-Agent': request.headers.get('User-Agent') || 'WAMP room share renderer',
      },
      cf: {
        image: {
          format: 'png',
        },
      },
    });
    if (!response.ok) {
      throw new Error(`Failed to load custom background ${id}`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (isPng(bytes)) {
      return decodePng(bytes);
    }
    if (isJpeg(bytes)) {
      return decodeJpegImageData(bytes);
    }
    throw new Error(`Custom background ${id} was not returned as a supported image format.`);
  })();
  imageDataCache.set(cacheKey, pending);
  return pending;
}

function decodeJpegImageData(bytes) {
  const image = decodeJpegBytes(bytes, {
    useTArray: true,
    formatAsRGBA: true,
    maxResolutionInMP: MAX_CUSTOM_BACKGROUND_DECODE_MP,
    maxMemoryUsageInMB: MAX_CUSTOM_BACKGROUND_DECODE_MEMORY_MB,
  });
  return {
    width: image.width,
    height: image.height,
    pixels: image.data,
  };
}

function normalizeAssetPath(assetPath) {
  const trimmed = String(assetPath || '').trim();
  return `/${trimmed.replace(/^\/+/, '')}`;
}

function drawCustomBackgroundImage(canvas, image, fit, x, y, width, height) {
  if (fit === 'stretch') {
    blitImageSmooth(canvas, image, 0, 0, image.width, image.height, x, y, width, height);
    return;
  }

  if (fit === 'center') {
    const rect = getCustomBackgroundCenterRect(
      { width: image.width, height: image.height },
      { width: ROOM_PX_WIDTH, height: ROOM_PX_HEIGHT },
    );
    const scaleX = width / ROOM_PX_WIDTH;
    const scaleY = height / ROOM_PX_HEIGHT;
    blitImageSmooth(
      canvas,
      image,
      0,
      0,
      image.width,
      image.height,
      x + rect.x * scaleX,
      y + rect.y * scaleY,
      Math.max(1, Math.round(rect.width * scaleX)),
      Math.max(1, Math.round(rect.height * scaleY)),
    );
    return;
  }

  const tileScale = getCustomBackgroundTileScale(image) * (width / ROOM_PX_WIDTH);
  const drawWidth = Math.max(1, Math.ceil(image.width * tileScale));
  const drawHeight = Math.max(1, Math.ceil(image.height * tileScale));
  for (let drawY = 0; drawY < height + drawHeight; drawY += drawHeight) {
    for (let drawX = 0; drawX < width + drawWidth; drawX += drawWidth) {
      blitImageSmooth(canvas, image, 0, 0, image.width, image.height, x + drawX, y + drawY, drawWidth, drawHeight);
    }
  }
}

function getCustomBackgroundTileScale(size) {
  const width = Math.max(1, size.width);
  const height = Math.max(1, size.height);
  return Math.min(1, MAX_TILED_PHOTO_WIDTH / width, MAX_TILED_PHOTO_HEIGHT / height);
}

function getCustomBackgroundCenterRect(source, target) {
  const sourceWidth = Math.max(1, Math.round(source.width));
  const sourceHeight = Math.max(1, Math.round(source.height));
  const scale = Math.min(1, target.width / sourceWidth, target.height / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  return {
    x: Math.floor((target.width - width) / 2),
    y: Math.floor((target.height - height) / 2),
    width,
    height,
  };
}

function blitImageNearest(canvas, image, sx, sy, sw, sh, dx, dy, dw, dh, flipX = false, flipY = false) {
  if (dw <= 0 || dh <= 0 || sw <= 0 || sh <= 0) {
    return;
  }

  const left = Math.max(0, Math.floor(dx));
  const top = Math.max(0, Math.floor(dy));
  const right = Math.min(canvas.width, Math.ceil(dx + dw));
  const bottom = Math.min(canvas.height, Math.ceil(dy + dh));

  for (let targetY = top; targetY < bottom; targetY += 1) {
    const relativeY = Math.min(sh - 1, Math.max(0, Math.floor(((targetY + 0.5 - dy) / dh) * sh)));
    const sourceY = Math.max(0, Math.min(image.height - 1, Math.floor(sy + (flipY ? sh - 1 - relativeY : relativeY))));
    for (let targetX = left; targetX < right; targetX += 1) {
      const relativeX = Math.min(sw - 1, Math.max(0, Math.floor(((targetX + 0.5 - dx) / dw) * sw)));
      const sourceX = Math.max(0, Math.min(image.width - 1, Math.floor(sx + (flipX ? sw - 1 - relativeX : relativeX))));
      const sourceOffset = (sourceY * image.width + sourceX) * 4;
      const alpha = image.pixels[sourceOffset + 3];
      if (alpha <= 0) {
        continue;
      }

      const targetOffset = (targetY * canvas.width + targetX) * 4;
      if (alpha >= 255) {
        canvas.pixels[targetOffset] = image.pixels[sourceOffset];
        canvas.pixels[targetOffset + 1] = image.pixels[sourceOffset + 1];
        canvas.pixels[targetOffset + 2] = image.pixels[sourceOffset + 2];
        canvas.pixels[targetOffset + 3] = 255;
        continue;
      }

      const sourceAlpha = alpha / 255;
      const inverseAlpha = 1 - sourceAlpha;
      canvas.pixels[targetOffset] = Math.round(image.pixels[sourceOffset] * sourceAlpha + canvas.pixels[targetOffset] * inverseAlpha);
      canvas.pixels[targetOffset + 1] = Math.round(image.pixels[sourceOffset + 1] * sourceAlpha + canvas.pixels[targetOffset + 1] * inverseAlpha);
      canvas.pixels[targetOffset + 2] = Math.round(image.pixels[sourceOffset + 2] * sourceAlpha + canvas.pixels[targetOffset + 2] * inverseAlpha);
      canvas.pixels[targetOffset + 3] = 255;
    }
  }
}

function blitImageSmooth(canvas, image, sx, sy, sw, sh, dx, dy, dw, dh) {
  if (dw <= 0 || dh <= 0 || sw <= 0 || sh <= 0) {
    return;
  }

  const left = Math.max(0, Math.floor(dx));
  const top = Math.max(0, Math.floor(dy));
  const right = Math.min(canvas.width, Math.ceil(dx + dw));
  const bottom = Math.min(canvas.height, Math.ceil(dy + dh));

  for (let targetY = top; targetY < bottom; targetY += 1) {
    const sourceY = sy + ((targetY + 0.5 - dy) / dh) * sh - 0.5;
    for (let targetX = left; targetX < right; targetX += 1) {
      const sourceX = sx + ((targetX + 0.5 - dx) / dw) * sw - 0.5;
      const rgba = sampleImageBilinear(image, sourceX, sourceY);
      blendPixel(canvas, targetX, targetY, rgba[0], rgba[1], rgba[2], rgba[3]);
    }
  }
}

function sampleImageBilinear(image, x, y) {
  const x0 = Math.max(0, Math.min(image.width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(image.height - 1, Math.floor(y)));
  const x1 = Math.max(0, Math.min(image.width - 1, x0 + 1));
  const y1 = Math.max(0, Math.min(image.height - 1, y0 + 1));
  const tx = Math.max(0, Math.min(1, x - x0));
  const ty = Math.max(0, Math.min(1, y - y0));
  const top = interpolateRgba(
    readImagePixel(image, x0, y0),
    readImagePixel(image, x1, y0),
    tx,
  );
  const bottom = interpolateRgba(
    readImagePixel(image, x0, y1),
    readImagePixel(image, x1, y1),
    tx,
  );
  return interpolateRgba(top, bottom, ty);
}

function readImagePixel(image, x, y) {
  const offset = (y * image.width + x) * 4;
  return [
    image.pixels[offset],
    image.pixels[offset + 1],
    image.pixels[offset + 2],
    image.pixels[offset + 3],
  ];
}

function interpolateRgba(left, right, t) {
  const inverse = 1 - t;
  return [
    Math.round(left[0] * inverse + right[0] * t),
    Math.round(left[1] * inverse + right[1] * t),
    Math.round(left[2] * inverse + right[2] * t),
    Math.round(left[3] * inverse + right[3] * t),
  ];
}

function blendPixel(canvas, x, y, red, green, blue, alpha) {
  if (alpha <= 0) {
    return;
  }

  const offset = (y * canvas.width + x) * 4;
  if (alpha >= 255) {
    canvas.pixels[offset] = red;
    canvas.pixels[offset + 1] = green;
    canvas.pixels[offset + 2] = blue;
    canvas.pixels[offset + 3] = 255;
    return;
  }

  const sourceAlpha = alpha / 255;
  const inverseAlpha = 1 - sourceAlpha;
  canvas.pixels[offset] = Math.round(red * sourceAlpha + canvas.pixels[offset] * inverseAlpha);
  canvas.pixels[offset + 1] = Math.round(green * sourceAlpha + canvas.pixels[offset + 1] * inverseAlpha);
  canvas.pixels[offset + 2] = Math.round(blue * sourceAlpha + canvas.pixels[offset + 2] * inverseAlpha);
  canvas.pixels[offset + 3] = 255;
}

async function decodePng(bytes) {
  assertPngSignature(bytes);

  let offset = 8;
  let header = null;
  let palette = null;
  let paletteAlpha = null;
  const idatChunks = [];

  while (offset + 8 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const type = readAscii(bytes, offset + 4, 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) {
      throw new Error('Invalid PNG chunk length.');
    }

    const data = bytes.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      header = {
        width: readUint32(data, 0),
        height: readUint32(data, 4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === 'PLTE') {
      palette = data.slice();
    } else if (type === 'tRNS') {
      paletteAlpha = data.slice();
    } else if (type === 'IDAT') {
      idatChunks.push(data.slice());
    } else if (type === 'IEND') {
      break;
    }

    offset = dataEnd + 4;
  }

  if (!header) {
    throw new Error('PNG is missing IHDR.');
  }
  if (header.compression !== 0 || header.filter !== 0 || header.interlace !== 0) {
    throw new Error('Unsupported PNG encoding.');
  }
  if (header.bitDepth !== 8 && !(header.colorType === 3 && [1, 2, 4, 8].includes(header.bitDepth))) {
    throw new Error('Unsupported PNG bit depth.');
  }

  const inflated = await inflateZlib(concatUint8Arrays(idatChunks));
  const bitsPerPixel = getPngBitsPerPixel(header.colorType, header.bitDepth);
  const scanlineLength = Math.ceil((header.width * bitsPerPixel) / 8);
  const filterByteWidth = Math.max(1, Math.ceil(bitsPerPixel / 8));
  const pixels = new Uint8Array(header.width * header.height * 4);
  let readOffset = 0;
  let previousRow = new Uint8Array(scanlineLength);

  for (let y = 0; y < header.height; y += 1) {
    const filterType = inflated[readOffset];
    readOffset += 1;
    const filteredRow = inflated.subarray(readOffset, readOffset + scanlineLength);
    readOffset += scanlineLength;
    const row = unfilterPngScanline(filteredRow, previousRow, filterType, filterByteWidth);
    writePngRowToRgba(pixels, y, row, header, palette, paletteAlpha);
    previousRow = row;
  }

  return {
    width: header.width,
    height: header.height,
    pixels,
  };
}

function assertPngSignature(bytes) {
  if (isPng(bytes)) {
    return;
  }

  throw new Error('Invalid PNG signature.');
}

function isPng(bytes) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[index] !== signature[index]) {
      return false;
    }
  }
  return true;
}

function isJpeg(bytes) {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
}

async function inflateZlib(data) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('DecompressionStream is not available.');
  }

  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function getPngBitsPerPixel(colorType, bitDepth) {
  if (colorType === 0 || colorType === 3) {
    return bitDepth;
  }
  if (colorType === 2) {
    return bitDepth * 3;
  }
  if (colorType === 4) {
    return bitDepth * 2;
  }
  if (colorType === 6) {
    return bitDepth * 4;
  }
  throw new Error(`Unsupported PNG color type ${colorType}.`);
}

function unfilterPngScanline(filteredRow, previousRow, filterType, bytesPerPixel) {
  const row = new Uint8Array(filteredRow.length);
  for (let index = 0; index < filteredRow.length; index += 1) {
    const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0;
    const up = previousRow[index] ?? 0;
    const upLeft = index >= bytesPerPixel ? previousRow[index - bytesPerPixel] ?? 0 : 0;
    const value = filteredRow[index];

    if (filterType === 0) {
      row[index] = value;
    } else if (filterType === 1) {
      row[index] = (value + left) & 0xff;
    } else if (filterType === 2) {
      row[index] = (value + up) & 0xff;
    } else if (filterType === 3) {
      row[index] = (value + Math.floor((left + up) / 2)) & 0xff;
    } else if (filterType === 4) {
      row[index] = (value + paethPredictor(left, up, upLeft)) & 0xff;
    } else {
      throw new Error(`Unsupported PNG filter ${filterType}.`);
    }
  }
  return row;
}

function writePngRowToRgba(target, y, row, header, palette, paletteAlpha) {
  for (let x = 0; x < header.width; x += 1) {
    const targetOffset = (y * header.width + x) * 4;

    if (header.colorType === 6) {
      const sourceOffset = x * 4;
      target[targetOffset] = row[sourceOffset];
      target[targetOffset + 1] = row[sourceOffset + 1];
      target[targetOffset + 2] = row[sourceOffset + 2];
      target[targetOffset + 3] = row[sourceOffset + 3];
    } else if (header.colorType === 2) {
      const sourceOffset = x * 3;
      target[targetOffset] = row[sourceOffset];
      target[targetOffset + 1] = row[sourceOffset + 1];
      target[targetOffset + 2] = row[sourceOffset + 2];
      target[targetOffset + 3] = 255;
    } else if (header.colorType === 3) {
      const paletteIndex = getPackedPngSample(row, x, header.bitDepth);
      const paletteOffset = paletteIndex * 3;
      target[targetOffset] = palette?.[paletteOffset] ?? 0;
      target[targetOffset + 1] = palette?.[paletteOffset + 1] ?? 0;
      target[targetOffset + 2] = palette?.[paletteOffset + 2] ?? 0;
      target[targetOffset + 3] = paletteAlpha?.[paletteIndex] ?? 255;
    } else if (header.colorType === 0) {
      const value = header.bitDepth === 8
        ? row[x]
        : scalePngSample(getPackedPngSample(row, x, header.bitDepth), header.bitDepth);
      target[targetOffset] = value;
      target[targetOffset + 1] = value;
      target[targetOffset + 2] = value;
      target[targetOffset + 3] = 255;
    } else if (header.colorType === 4) {
      const sourceOffset = x * 2;
      const value = row[sourceOffset];
      target[targetOffset] = value;
      target[targetOffset + 1] = value;
      target[targetOffset + 2] = value;
      target[targetOffset + 3] = row[sourceOffset + 1];
    } else {
      throw new Error(`Unsupported PNG color type ${header.colorType}.`);
    }
  }
}

function getPackedPngSample(row, pixelIndex, bitDepth) {
  if (bitDepth === 8) {
    return row[pixelIndex];
  }

  const bitIndex = pixelIndex * bitDepth;
  const byte = row[Math.floor(bitIndex / 8)] ?? 0;
  const shift = 8 - bitDepth - (bitIndex % 8);
  return (byte >> shift) & ((1 << bitDepth) - 1);
}

function scalePngSample(value, bitDepth) {
  return Math.round((value / ((1 << bitDepth) - 1)) * 255);
}

function paethPredictor(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) {
    return left;
  }
  return upDistance <= upLeftDistance ? up : upLeft;
}

function numberToRgb(color) {
  return {
    r: (color >> 16) & 0xff,
    g: (color >> 8) & 0xff,
    b: color & 0xff,
  };
}

function rgbToNumber(color) {
  return ((color.r & 0xff) << 16) | ((color.g & 0xff) << 8) | (color.b & 0xff);
}

function hexToNumber(value) {
  const normalized = value.replace(/^#/, '').trim();
  return Number.parseInt(normalized || '000000', 16) & 0xffffff;
}

function lighten(color, amount) {
  const rgb = numberToRgb(color);
  return rgbToNumber({
    r: Math.round(rgb.r + (255 - rgb.r) * amount),
    g: Math.round(rgb.g + (255 - rgb.g) * amount),
    b: Math.round(rgb.b + (255 - rgb.b) * amount),
  });
}

function darken(color, amount) {
  const rgb = numberToRgb(color);
  return rgbToNumber({
    r: Math.round(rgb.r * (1 - amount)),
    g: Math.round(rgb.g * (1 - amount)),
    b: Math.round(rgb.b * (1 - amount)),
  });
}

function clampInt(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function nextSeed(seed) {
  return (Math.imul(seed, 1664525) + 1013904223) >>> 0;
}

function encodePng(width, height, rgba) {
  const bytesPerRow = width * 4;
  const scanlines = new Uint8Array((bytesPerRow + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const targetOffset = row * (bytesPerRow + 1);
    scanlines[targetOffset] = 0;
    scanlines.set(rgba.subarray(row * bytesPerRow, row * bytesPerRow + bytesPerRow), targetOffset + 1);
  }

  return concatUint8Arrays([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    createPngChunk('IHDR', createIhdrData(width, height)),
    createPngChunk('IDAT', createZlibUncompressedBlockStream(scanlines)),
    createPngChunk('IEND', new Uint8Array(0)),
  ]);
}

function createIhdrData(width, height) {
  const data = new Uint8Array(13);
  writeUint32(data, 0, width);
  writeUint32(data, 4, height);
  data[8] = 8;
  data[9] = 6;
  return data;
}

function createPngChunk(type, data) {
  const typeBytes = asciiBytes(type);
  const chunk = new Uint8Array(12 + data.length);
  writeUint32(chunk, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  writeUint32(chunk, 8 + data.length, crc32(typeBytes, data));
  return chunk;
}

function createZlibUncompressedBlockStream(data) {
  const blockCount = Math.max(1, Math.ceil(data.length / 65535));
  const output = new Uint8Array(2 + data.length + blockCount * 5 + 4);
  let offset = 0;
  output[offset++] = 0x78;
  output[offset++] = 0x01;

  for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
    const blockStart = blockIndex * 65535;
    const blockLength = Math.min(65535, data.length - blockStart);
    const isFinal = blockIndex === blockCount - 1;
    output[offset++] = isFinal ? 0x01 : 0x00;
    output[offset++] = blockLength & 0xff;
    output[offset++] = (blockLength >> 8) & 0xff;
    const nlen = (~blockLength) & 0xffff;
    output[offset++] = nlen & 0xff;
    output[offset++] = (nlen >> 8) & 0xff;
    output.set(data.subarray(blockStart, blockStart + blockLength), offset);
    offset += blockLength;
  }

  writeUint32(output, offset, adler32(data));
  return output;
}

function asciiBytes(value) {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index) & 0xff;
  }
  return bytes;
}

function concatUint8Arrays(parts) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function readUint32(source, offset) {
  return (
    ((source[offset] ?? 0) * 0x1000000) +
    ((source[offset + 1] ?? 0) << 16) +
    ((source[offset + 2] ?? 0) << 8) +
    (source[offset + 3] ?? 0)
  ) >>> 0;
}

function readAscii(source, offset, length) {
  let value = '';
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(source[offset + index] ?? 0);
  }
  return value;
}

function writeUint32(target, offset, value) {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function crc32(typeBytes, data) {
  let crc = 0xffffffff;
  crc = updateCrc32(crc, typeBytes);
  crc = updateCrc32(crc, data);
  return (crc ^ 0xffffffff) >>> 0;
}

function updateCrc32(initial, data) {
  let crc = initial;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return crc >>> 0;
}

function adler32(data) {
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

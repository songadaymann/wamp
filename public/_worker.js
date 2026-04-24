const ROOM_PATH_PATTERN = /^\/r\/(-?\d+)\/(-?\d+)\/?$/;
const ROOM_IMAGE_PATH_PATTERN = /^\/r\/(-?\d+)\/(-?\d+)\/image(?:\.png)?\/?$/;
const DEFAULT_API_BASE_URL = 'https://api.wamp.land';
const ROOM_META_TIMEOUT_MS = 1200;
const ROOM_IMAGE_TIMEOUT_MS = 3500;
const ROOM_SHARE_IMAGE_WIDTH = 1200;
const ROOM_SHARE_IMAGE_HEIGHT = 630;
const ROOM_WIDTH = 40;
const ROOM_HEIGHT = 22;
const TILE_SIZE = 16;
const PREVIEW_TILE_SIZE = 27;
const PREVIEW_LEFT = 60;
const PREVIEW_TOP = 18;
const PREVIEW_WIDTH = ROOM_WIDTH * PREVIEW_TILE_SIZE;
const PREVIEW_HEIGHT = ROOM_HEIGHT * PREVIEW_TILE_SIZE;
const TILE_FLIP_X_FLAG = 1 << 20;
const TILE_FLIP_Y_FLAG = 1 << 21;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const imageCoordinates = parseRoomPath(url.pathname, ROOM_IMAGE_PATH_PATTERN);
    if (imageCoordinates) {
      return renderRoomImageResponse(request, env, url, imageCoordinates);
    }

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
  };
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
  return new Response(renderRoomSharePreviewPng(snapshot), {
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

function renderRoomSharePreviewPng(snapshot) {
  const canvas = createCanvas(ROOM_SHARE_IMAGE_WIDTH, ROOM_SHARE_IMAGE_HEIGHT);
  drawPreviewBackground(canvas, snapshot);
  drawRoomFrame(canvas);
  drawTiles(canvas, snapshot);
  drawObjects(canvas, snapshot);
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

function drawPreviewBackground(canvas, snapshot) {
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
}

function resolvePreviewBackground(background) {
  if (typeof background === 'string') {
    return { kind: 'palette', palette: backgroundPalette(background) };
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
    return { kind: 'palette', palette: backgroundPalette(String(id)) };
  }

  return { kind: 'palette', palette: backgroundPalette('grassland') };
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

function drawRoomFrame(canvas) {
  blendRect(canvas, PREVIEW_LEFT - 8, PREVIEW_TOP - 8, PREVIEW_WIDTH + 16, PREVIEW_HEIGHT + 16, 0x05070c, 0.84);
  blendRect(canvas, PREVIEW_LEFT, PREVIEW_TOP, PREVIEW_WIDTH, PREVIEW_HEIGHT, 0x0e1524, 0.34);
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

        const x = PREVIEW_LEFT + tileX * PREVIEW_TILE_SIZE;
        const y = PREVIEW_TOP + tileY * PREVIEW_TILE_SIZE;
        const color = getTileColor(gid, tileX, tileY);

        if (layerName === 'background') {
          blendRect(canvas, x + 4, y + 4, PREVIEW_TILE_SIZE - 8, PREVIEW_TILE_SIZE - 8, color, 0.45);
          continue;
        }

        if (layerName === 'foreground') {
          blendRect(canvas, x + 2, y + 2, PREVIEW_TILE_SIZE - 4, PREVIEW_TILE_SIZE - 4, lighten(color, 0.18), 0.74);
          drawBorder(canvas, x + 2, y + 2, PREVIEW_TILE_SIZE - 4, PREVIEW_TILE_SIZE - 4, darken(color, 0.28));
          continue;
        }

        fillRect(canvas, x, y, PREVIEW_TILE_SIZE, PREVIEW_TILE_SIZE, color);
        fillRect(canvas, x, y, PREVIEW_TILE_SIZE, 4, lighten(color, 0.2));
        fillRect(canvas, x, y + PREVIEW_TILE_SIZE - 4, PREVIEW_TILE_SIZE, 4, darken(color, 0.24));
        fillRect(canvas, x, y, 3, PREVIEW_TILE_SIZE, darken(color, 0.18));
        fillRect(canvas, x + PREVIEW_TILE_SIZE - 3, y, 3, PREVIEW_TILE_SIZE, darken(color, 0.3));
      }
    }
  }
}

function drawObjects(canvas, snapshot) {
  const placedObjects = Array.isArray(snapshot?.placedObjects) ? snapshot.placedObjects : [];
  const scale = PREVIEW_TILE_SIZE / TILE_SIZE;

  for (const placed of placedObjects) {
    if (!placed || typeof placed.id !== 'string') {
      continue;
    }

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
}

function getObjectPreviewDimensions(id) {
  if (id === 'ladder') return { width: 16, height: 48 };
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

function decodeTileGid(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return -1;
  }

  const flipX = value >= TILE_FLIP_X_FLAG && Math.floor(value / TILE_FLIP_X_FLAG) % 2 === 1;
  const flipY = value >= TILE_FLIP_Y_FLAG && Math.floor(value / TILE_FLIP_Y_FLAG) % 2 === 1;
  return value - (flipX ? TILE_FLIP_X_FLAG : 0) - (flipY ? TILE_FLIP_Y_FLAG : 0);
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

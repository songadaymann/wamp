const ROOM_PATH_PATTERN = /^\/r\/(-?\d+)\/(-?\d+)\/?$/;
const ROOM_IMAGE_PATH_PATTERN = /^\/r\/(-?\d+)\/(-?\d+)\/image(?:\.png)?\/?$/;
const DEFAULT_API_BASE_URL = 'https://api.wamp.land';
const ROOM_META_TIMEOUT_MS = 1200;
const ROOM_IMAGE_TIMEOUT_MS = 3500;
const ROOM_IMAGE_RENDERER_VERSION = 'assets-v1';
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
const TILESETS = [
  { key: 'forest', path: 'assets/tilesets/tileset_forest.png', columns: 12, firstGid: 1, tileCount: 72 },
  { key: 'desert', path: 'assets/tilesets/tileset_desert.png?v=2026-04-01-desert-tiles', columns: 12, firstGid: 73, tileCount: 72 },
  { key: 'cave', path: 'assets/tilesets/tileset_cave.png', columns: 12, firstGid: 145, tileCount: 72 },
  { key: 'lava', path: 'assets/tilesets/tileset_lava.png', columns: 15, firstGid: 217, tileCount: 105 },
  { key: 'snow', path: 'assets/tilesets/tileset_snow.png', columns: 11, firstGid: 322, tileCount: 66 },
  { key: 'water', path: 'assets/tilesets/tileset_water.png', columns: 12, firstGid: 388, tileCount: 72 },
  { key: 'smb_lvl1_3_5', path: 'assets/tilesets/tileset_smb_lvl1_3_5.png', columns: 8, firstGid: 460, tileCount: 32 },
];
const BACKGROUND_GROUPS = [
  { id: 'none', layers: [] },
  {
    id: 'forest',
    layers: [
      { path: 'assets/backgrounds/forest/1.png', width: 576, height: 324 },
      { path: 'assets/backgrounds/forest/2.png', width: 576, height: 324 },
      { path: 'assets/backgrounds/forest/3.png', width: 576, height: 324 },
      { path: 'assets/backgrounds/forest/5.png', width: 576, height: 324 },
      { path: 'assets/backgrounds/forest/6.png', width: 576, height: 324 },
      { path: 'assets/backgrounds/forest/10.png', width: 576, height: 324 },
      { path: 'assets/backgrounds/forest/7.png', width: 576, height: 324 },
      { path: 'assets/backgrounds/forest/8.png', width: 576, height: 324 },
    ],
  },
  {
    id: 'dark_forest',
    layers: [
      { path: 'assets/backgrounds/dark_forest/1.png', width: 576, height: 324 },
      { path: 'assets/backgrounds/dark_forest/2.png', width: 576, height: 324 },
      { path: 'assets/backgrounds/dark_forest/3.png', width: 576, height: 324 },
      { path: 'assets/backgrounds/dark_forest/4.png', width: 576, height: 324 },
      { path: 'assets/backgrounds/dark_forest/5.png', width: 576, height: 324 },
      { path: 'assets/backgrounds/dark_forest/6.png', width: 576, height: 324 },
      { path: 'assets/backgrounds/dark_forest/7.png', width: 576, height: 324 },
    ],
  },
  {
    id: 'grassland',
    layers: [
      { path: 'assets/backgrounds/grassland/1.png', width: 576, height: 324 },
      { path: 'assets/backgrounds/grassland/2.png', width: 576, height: 324 },
      { path: 'assets/backgrounds/grassland/3.png', width: 576, height: 324 },
      { path: 'assets/backgrounds/grassland/4.png', width: 576, height: 324 },
    ],
  },
  {
    id: 'mountains',
    layers: [
      { path: 'assets/backgrounds/mountains/1.png', width: 576, height: 324 },
      { path: 'assets/backgrounds/mountains/2.png', width: 576, height: 324 },
      { path: 'assets/backgrounds/mountains/3.png', width: 576, height: 324 },
      { path: 'assets/backgrounds/mountains/4.png', width: 576, height: 324 },
    ],
  },
  {
    id: 'meadow',
    layers: [
      { path: 'assets/backgrounds/meadow/1.png', width: 576, height: 324 },
      { path: 'assets/backgrounds/meadow/2.png', width: 576, height: 324 },
      { path: 'assets/backgrounds/meadow/3.png', width: 576, height: 324 },
      { path: 'assets/backgrounds/meadow/4.png', width: 576, height: 324 },
      { path: 'assets/backgrounds/meadow/5.png', width: 576, height: 324 },
    ],
  },
  {
    id: 'aurora',
    layers: [
      { path: 'assets/backgrounds/aurora/1.png', width: 576, height: 324 },
      { path: 'assets/backgrounds/aurora/2.png', width: 576, height: 324 },
      { path: 'assets/backgrounds/aurora/3.png', width: 576, height: 324 },
    ],
  },
  {
    id: 'cave',
    layers: [
      { path: 'assets/backgrounds/cave/layer1_far.png', width: 960, height: 480 },
      { path: 'assets/backgrounds/cave/layer2_mid.png', width: 960, height: 480 },
      { path: 'assets/backgrounds/cave/layer3_near.png', width: 960, height: 480 },
    ],
  },
  {
    id: 'desert',
    layers: [
      { path: 'assets/backgrounds/desert/far.png', width: 576, height: 324 },
      { path: 'assets/backgrounds/desert/middle.png', width: 576, height: 324 },
      { path: 'assets/backgrounds/desert/near.png', width: 576, height: 324 },
    ],
  },
];
const GAME_OBJECTS = [
  { id: 'coin_gold', path: 'assets/objects/coin_gold.png', frameWidth: 16, frameHeight: 16, frameCount: 8 },
  { id: 'coin_silver', path: 'assets/objects/coin_silver.png', frameWidth: 16, frameHeight: 16, frameCount: 8 },
  { id: 'gem', path: 'assets/objects/gem.png', frameWidth: 16, frameHeight: 16, frameCount: 5 },
  { id: 'blue_gem', path: 'assets/objects/blue_gem.png', frameWidth: 16, frameHeight: 16, frameCount: 8 },
  { id: 'orange_gem', path: 'assets/objects/orange_gem.png', frameWidth: 16, frameHeight: 16, frameCount: 4 },
  { id: 'red_gem', path: 'assets/objects/red_gem.png', frameWidth: 16, frameHeight: 16, frameCount: 4 },
  { id: 'black_pearl', path: 'assets/objects/black_pearl.png', frameWidth: 16, frameHeight: 16, frameCount: 4 },
  { id: 'crown', path: 'assets/objects/crown.png', frameWidth: 16, frameHeight: 16, frameCount: 8 },
  { id: 'ring', path: 'assets/objects/ring.png', frameWidth: 16, frameHeight: 16, frameCount: 4 },
  { id: 'star', path: 'assets/objects/star.png', frameWidth: 16, frameHeight: 16, frameCount: 8 },
  { id: 'heart', path: 'assets/objects/heart.png', frameWidth: 16, frameHeight: 16, frameCount: 8 },
  { id: 'key', path: 'assets/objects/key.png', frameWidth: 16, frameHeight: 16, frameCount: 8 },
  { id: 'health_potion', path: 'assets/objects/health_potion.png', frameWidth: 16, frameHeight: 16, frameCount: 8 },
  { id: 'mana_potion', path: 'assets/objects/mana_potion.png', frameWidth: 16, frameHeight: 16, frameCount: 8 },
  { id: 'mushroom', path: 'assets/objects/mushroom.png', frameWidth: 16, frameHeight: 16, frameCount: 8 },
  { id: 'egg', path: 'assets/objects/egg.png', frameWidth: 16, frameHeight: 16, frameCount: 8 },
  { id: 'bone', path: 'assets/objects/bone.png', frameWidth: 16, frameHeight: 16, frameCount: 8 },
  { id: 'book', path: 'assets/objects/book.png', frameWidth: 16, frameHeight: 16, frameCount: 8 },
  { id: 'scroll', path: 'assets/objects/scroll.png', frameWidth: 16, frameHeight: 16, frameCount: 8 },
  { id: 'skull', path: 'assets/objects/skull.png', frameWidth: 16, frameHeight: 16, frameCount: 8 },
  { id: 'bomb_pickup', path: 'assets/objects/bomb_pickup.png', frameWidth: 16, frameHeight: 16, frameCount: 8 },
  { id: 'apple', path: 'assets/objects/apple.png', frameWidth: 16, frameHeight: 16, frameCount: 1 },
  { id: 'banana', path: 'assets/objects/banana.png', frameWidth: 16, frameHeight: 16, frameCount: 1 },
  { id: 'kitkat', path: 'assets/objects/kitkat.png', frameWidth: 16, frameHeight: 16, frameCount: 12 },
  { id: 'poop', path: 'assets/objects/poop.png', frameWidth: 16, frameHeight: 16, frameCount: 1 },
  { id: 'cake', path: 'assets/objects/cake.png', frameWidth: 32, frameHeight: 32, frameCount: 6 },
  { id: 'coin_small_gold', path: 'assets/objects/coin_small_gold.png', frameWidth: 16, frameHeight: 16, frameCount: 6 },
  { id: 'coin_small_silver', path: 'assets/objects/coin_small_silver.png', frameWidth: 16, frameHeight: 16, frameCount: 6 },
  { id: 'spikes', path: 'assets/enemies/spikes.png', frameWidth: 16, frameHeight: 16, frameCount: 4 },
  { id: 'saw', path: 'assets/enemies/saw.png', frameWidth: 34, frameHeight: 34, frameCount: 4, animationFrames: [0, 2, 3, 2] },
  { id: 'fire', path: 'assets/enemies/fire.png', frameWidth: 16, frameHeight: 16, frameCount: 6 },
  { id: 'fireball', path: 'assets/enemies/fireball.png', frameWidth: 16, frameHeight: 16, frameCount: 4 },
  { id: 'bomb', path: 'assets/enemies/bomb.png', frameWidth: 32, frameHeight: 48, frameCount: 15 },
  { id: 'wood_stakes', path: 'assets/enemies/wood_stakes.png', frameWidth: 32, frameHeight: 32, frameCount: 1 },
  { id: 'cannon', path: 'assets/enemies/cannon.png', frameWidth: 32, frameHeight: 32, frameCount: 1, defaultFrame: 2, facingDirection: 'left' },
  { id: 'cactus', path: 'assets/enemies/cactus.png', frameWidth: 32, frameHeight: 32, frameCount: 6 },
  { id: 'tornado', path: 'assets/enemies/tornado.png', frameWidth: 48, frameHeight: 48, frameCount: 8 },
  { id: 'fire_big', path: 'assets/enemies/fire_big.png', frameWidth: 32, frameHeight: 32, frameCount: 6 },
  { id: 'ice_spikes', path: 'assets/enemies/ice_spikes.png', frameWidth: 16, frameHeight: 16, frameCount: 8 },
  { id: 'icicle', path: 'assets/enemies/icicle.png', frameWidth: 48, frameHeight: 48, frameCount: 6, animationFrames: [0, 1, 2, 3] },
  { id: 'lightning', path: 'assets/enemies/lightning.png', frameWidth: 64, frameHeight: 96, frameCount: 4, defaultFrame: 1, animationFrames: [0, 1] },
  { id: 'propeller', path: 'assets/enemies/propeller.png', frameWidth: 16, frameHeight: 16, frameCount: 4 },
  { id: 'quicksand', path: 'assets/enemies/quicksand.png', frameWidth: 32, frameHeight: 32, frameCount: 8 },
  { id: 'cactus_spike', path: 'assets/enemies/cactus_spike.png', frameWidth: 16, frameHeight: 16, frameCount: 1 },
  { id: 'tornado_sand', path: 'assets/enemies/tornado_sand.png', frameWidth: 48, frameHeight: 48, frameCount: 8 },
  { id: 'lava_surface', path: 'assets/deco/lava_surface.png', frameWidth: 48, frameHeight: 48, frameCount: 8 },
  { id: 'water_surface_a', path: 'assets/deco/water_surface_a.png', frameWidth: 32, frameHeight: 32, frameCount: 8 },
  { id: 'water_surface_b', path: 'assets/deco/water_surface_b.png', frameWidth: 16, frameHeight: 16, frameCount: 5 },
  { id: 'slime_blue', path: 'assets/enemies/slime_blue.png', frameWidth: 16, frameHeight: 16, frameCount: 5, facingDirection: 'left' },
  { id: 'slime_red', path: 'assets/enemies/slime_red.png', frameWidth: 16, frameHeight: 16, frameCount: 5, facingDirection: 'left' },
  { id: 'bat', path: 'assets/enemies/bat.png', frameWidth: 32, frameHeight: 32, frameCount: 8, defaultFrame: 6, animationFrames: [4, 5, 6, 7, 6, 5], facingDirection: 'right' },
  { id: 'crab', path: 'assets/enemies/crab.png', frameWidth: 32, frameHeight: 16, frameCount: 9, defaultFrame: 1, animationFrames: [0, 1, 2, 1], facingDirection: 'left' },
  { id: 'bird', path: 'assets/enemies/bird.png', frameWidth: 32, frameHeight: 32, frameCount: 4, facingDirection: 'left' },
  { id: 'fish', path: 'assets/enemies/fish.png', frameWidth: 32, frameHeight: 16, frameCount: 3, defaultFrame: 1, animationFrames: [0, 1, 2, 1], facingDirection: 'right' },
  { id: 'frog', path: 'assets/enemies/frog.png', frameWidth: 32, frameHeight: 32, frameCount: 4, facingDirection: 'right' },
  { id: 'snake', path: 'assets/enemies/snake.png', frameWidth: 32, frameHeight: 32, frameCount: 4, facingDirection: 'left' },
  { id: 'penguin', path: 'assets/enemies/penguin.png', frameWidth: 32, frameHeight: 32, frameCount: 4, facingDirection: 'right' },
  { id: 'bear_brown', path: 'assets/enemies/bear_brown.png', frameWidth: 32, frameHeight: 32, frameCount: 8, defaultFrame: 5, animationFrames: [4, 5, 6, 7, 6, 5], facingDirection: 'right' },
  { id: 'bear_polar', path: 'assets/enemies/bear_polar.png', frameWidth: 32, frameHeight: 32, frameCount: 8, defaultFrame: 5, animationFrames: [4, 5, 6, 7, 6, 5], facingDirection: 'right' },
  { id: 'chicken', path: 'assets/enemies/chicken.png', frameWidth: 32, frameHeight: 32, frameCount: 14, defaultFrame: 7, animationFrames: [7, 8, 9, 10, 11, 12, 13], facingDirection: 'left' },
  { id: 'shark', path: 'assets/enemies/shark.png', frameWidth: 64, frameHeight: 32, frameCount: 4, defaultFrame: 1, animationFrames: [0, 1, 2, 3, 2, 1], facingDirection: 'left' },
  { id: 'bounce_pad', path: 'assets/objects/bounce_pad.png', frameWidth: 16, frameHeight: 32, frameCount: 4 },
  { id: 'spawn_point', path: 'assets/objects/sign_arrow.png', frameWidth: 16, frameHeight: 32, frameCount: 1 },
  { id: 'flag', path: 'assets/objects/flag.png', frameWidth: 32, frameHeight: 32, frameCount: 9 },
  { id: 'door_locked', path: 'assets/objects/door_locked.png', frameWidth: 32, frameHeight: 48, frameCount: 1 },
  { id: 'door_metal', path: 'assets/objects/metal_door_locked.png', frameWidth: 32, frameHeight: 48, frameCount: 1 },
  { id: 'crate', path: 'assets/objects/crate_static.png', frameWidth: 32, frameHeight: 32, frameCount: 1 },
  { id: 'brick_box', path: 'assets/objects/brick_box.png', frameWidth: 32, frameHeight: 32, frameCount: 6, defaultFrame: 5 },
  { id: 'treasure_chest', path: 'assets/objects/treasure_chest.png', frameWidth: 32, frameHeight: 32, frameCount: 4, defaultFrame: 0 },
  { id: 'log_wall', path: 'assets/deco/log_wall.png', frameWidth: 32, frameHeight: 48, frameCount: 1 },
  { id: 'cage', path: 'assets/objects/cage.png', frameWidth: 18, frameHeight: 32, frameCount: 5, defaultFrame: 0 },
  { id: 'sign', path: 'assets/objects/sign.png', frameWidth: 16, frameHeight: 32, frameCount: 1 },
  { id: 'sign_arrow', path: 'assets/objects/sign_arrow.png', frameWidth: 16, frameHeight: 32, frameCount: 1 },
  { id: 'ladder', path: 'assets/objects/ladder.png', frameWidth: 16, frameHeight: 64, frameCount: 1 },
  { id: 'floor_trigger', path: 'assets/objects/floor_trigger.png', frameWidth: 16, frameHeight: 16, frameCount: 2, defaultFrame: 0 },
  { id: 'button', path: 'assets/objects/button.png', frameWidth: 16, frameHeight: 16, frameCount: 4, defaultFrame: 0 },
  { id: 'bush', path: 'assets/deco/bush.png', frameWidth: 32, frameHeight: 16, frameCount: 1 },
  { id: 'rock', path: 'assets/deco/rock.png', frameWidth: 16, frameHeight: 16, frameCount: 1 },
  { id: 'tree', path: 'assets/deco/tree.png', frameWidth: 48, frameHeight: 48, frameCount: 1 },
  { id: 'tree_b', path: 'assets/deco/tree_b.png', frameWidth: 48, frameHeight: 64, frameCount: 1 },
  { id: 'tree_c', path: 'assets/deco/tree_c.png', frameWidth: 48, frameHeight: 48, frameCount: 1 },
  { id: 'tree_trunk', path: 'assets/deco/tree_trunk.png', frameWidth: 16, frameHeight: 16, frameCount: 1 },
  { id: 'sun', path: 'assets/deco/sun.png', frameWidth: 32, frameHeight: 32, frameCount: 6 },
  { id: 'clouds_deco', path: 'assets/deco/clouds.png', frameWidth: 48, frameHeight: 16, frameCount: 1 },
];
const GAME_OBJECT_CONFIG_BY_ID = new Map(GAME_OBJECTS.map((config) => [config.id, config]));
const imageDataCache = new Map();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const imageCoordinates = parseRoomPath(url.pathname, ROOM_IMAGE_PATH_PATTERN);
    if (imageCoordinates) {
      return renderRoomImageResponse(request, env, url, imageCoordinates);
    }

    const coordinates = parseRoomPath(url.pathname) || parseRoomQuery(url);
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
    imageUrl: withRoomVersionQuery(fallback.imageUrl, snapshot?.version),
  };
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

async function primeRoomAssetCache(request, env, url, snapshot) {
  const paths = new Set();
  const background = resolvePreviewBackground(snapshot?.background);
  if (background.kind === 'palette') {
    for (const layer of getBackgroundGroup(background.id)?.layers ?? []) {
      paths.add(layer.path);
    }
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

function getObjectDefaultFrame(config) {
  if (typeof config.defaultFrame === 'number') {
    return config.defaultFrame;
  }
  if (Array.isArray(config.animationFrames) && config.animationFrames.length > 0) {
    return config.animationFrames[0] ?? 0;
  }
  return 0;
}

function getObjectFrameSourceRect(config, frame, sheetWidth) {
  const columns = Math.max(1, Math.floor(sheetWidth / config.frameWidth));
  const normalizedFrame = Math.max(0, frame);
  const column = normalizedFrame % columns;
  const row = Math.floor(normalizedFrame / columns);
  return {
    sx: column * config.frameWidth,
    sy: row * config.frameHeight,
    sw: config.frameWidth,
    sh: config.frameHeight,
  };
}

function getPlacedObjectLayer(placed) {
  return placed?.layer === 'background' || placed?.layer === 'terrain' || placed?.layer === 'foreground'
    ? placed.layer
    : 'terrain';
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

function normalizeAssetPath(assetPath) {
  const trimmed = String(assetPath || '').trim();
  return `/${trimmed.replace(/^\/+/, '')}`;
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
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[index] !== signature[index]) {
      throw new Error('Invalid PNG signature.');
    }
  }
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

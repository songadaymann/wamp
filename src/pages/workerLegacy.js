// Rendering implementation retained separately while the typed Pages entry and route shell evolve.
import {
  BACKGROUND_GROUPS,
  GAME_OBJECTS,
  ROOM_HEIGHT,
  ROOM_WIDTH,
  TILESETS,
  TILE_FLIP_X_FLAG,
  TILE_FLIP_Y_FLAG,
  TILE_SIZE,
  getObjectDefaultFrame,
  getObjectFrameSourceRect,
  getPlacedObjectLayer,
} from '../config.ts';
import {
  ROOM_SHARE_IMAGE_HEIGHT,
  ROOM_SHARE_IMAGE_WIDTH,
  loadPublishedRoomSnapshot,
} from './shareMetadata.ts';
import {
  handleSharePageRequest,
  parseRoomImageCoordinates,
} from './shareRoutes.ts';
import {
  blendRect,
  blitImageNearest,
  createCanvas,
  darken,
  drawBorder,
  drawDiamond,
  drawHorizonSteps,
  drawTriangle,
  encodePng,
  fillEllipse,
  fillRect,
  hexToNumber,
  lighten,
} from './roomImagePrimitives.ts';
import {
  drawCustomBackgroundImage,
  loadAssetImageData,
  loadCustomBackgroundImageData,
  parseCustomBackground,
} from './roomImageAssets.ts';

const ROOM_IMAGE_TIMEOUT_MS = 3500;
const CUSTOM_SPRITE_OBJECT_PREFIX = 'custom_sprite:';
const SOLID_BACKGROUND_PREFIX = 'solid:';
const PREVIEW_TILE_SIZE = 27;
const PREVIEW_LEFT = 60;
const PREVIEW_TOP = 18;
const PREVIEW_WIDTH = ROOM_WIDTH * PREVIEW_TILE_SIZE;
const PREVIEW_HEIGHT = ROOM_HEIGHT * PREVIEW_TILE_SIZE;
const GAME_OBJECT_CONFIG_BY_ID = new Map(GAME_OBJECTS.map((config) => [config.id, config]));
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const imageCoordinates = parseRoomImageCoordinates(url.pathname);
    if (imageCoordinates) {
      return renderRoomImageResponse(request, env, url, imageCoordinates);
    }

    const sharePageResponse = await handleSharePageRequest(request, env, url);
    return sharePageResponse ?? env.ASSETS.fetch(request);
  },
};

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
  } else if (id.includes('platform') || id.includes('bridge')) {
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
  if (id.includes('narrow') && id.includes('door')) return { width: 16, height: 48 };
  if (id.includes('door')) return { width: 32, height: 48 };
  if (id === 'flag' || id.includes('checkpoint')) return { width: 32, height: 48 };
  if (id.includes('tree')) return { width: 48, height: 64 };
  if (id.includes('sun')) return { width: 48, height: 48 };
  if (id.includes('water')) return { width: 16, height: 16 };
  if (id.includes('bridge')) return { width: 64, height: 16 };
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

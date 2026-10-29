import { resolveRoomBackground } from '../backgrounds/model';
import { getCustomRoomTileDefinitionForGid } from '../customTiles/model';
import { parseCustomSpriteObjectId } from '../customSprites/model';
import { maskBlockedCustomArt } from '../customSprites/blockedArt';
import type { RoomSnapshot } from '../persistence/roomModel';
import { getRoomMetadataBackgroundLayerLayout, getRoomMetadataObjectDrawRect } from '../mint/roomMetadataRenderLayout';
import { drawStarfieldToContext, hashStringToSeed } from '../visuals/starfieldCanvas';
import {
  GAME_OBJECTS,
  ROOM_HEIGHT,
  ROOM_WIDTH,
  TILE_SIZE,
  getObjectDefaultFrame,
  getObjectDisplayScale,
  getObjectDisplayOffset,
  getTilesetByGid,
  decodeTileDataValue,
  getObjectFrameSourceRect,
  getPlacedObjectLayer,
  type GameObjectConfig,
} from '../config';
import type { RoomImageEnvironment } from './types';
import {
  drawCustomBackgroundImage,
  loadAssetImageData,
  loadCustomBackgroundImageData,
} from './roomImageAssets';
import {
  blendRect,
  blitImageNearest,
  createCanvas,
  darken,
  drawBorder,
  drawDiamond,
  drawTriangle,
  fillEllipse,
  fillRect,
  hexToNumber,
  lighten,
  type RoomImageData,
} from './roomImagePrimitives';
import { encodePng } from '../utils/pngEncoder';
import {
  ROOM_SHARE_IMAGE_HEIGHT,
  ROOM_SHARE_IMAGE_WIDTH,
  type PublishedRoomSnapshot,
  type RoomCoordinates,
} from './types';

export interface RoomImageLayout { left: number; top: number; tileSize: number }
const CARD_LAYOUT: RoomImageLayout = { left: 60, top: 18, tileSize: 27 };
const ROOM_IMAGE_LAYER_NAMES = ['background', 'terrain', 'foreground'] as const;
const GAME_OBJECT_CONFIG_BY_ID = new Map(GAME_OBJECTS.map((config) => [config.id, config]));

type RoomImageLayerName = (typeof ROOM_IMAGE_LAYER_NAMES)[number];
type RoomImageRecord = Record<string, unknown>;
type RoomImageTileLayer = unknown[];

export function roomImageCommunityArtIds(snapshot: PublishedRoomSnapshot): string[] {
  const sprites = Array.isArray(snapshot.customSprites) ? snapshot.customSprites.filter(isRecord) : [];
  const tiles = Array.isArray(snapshot.customTiles) ? snapshot.customTiles.filter(isRecord) : [];
  return [...new Set([...sprites.map(sprite => sprite.id), ...tiles.map(tile => tile.sourceSpriteId)]
    .filter((id): id is string => typeof id === 'string' && id.length > 0))];
}

/** Use the same moderation mask as the API/map before drawing custom sprite or tile pixels. */
export function markBlockedCustomSprites(snapshot: PublishedRoomSnapshot, blocked: ReadonlySet<string>): PublishedRoomSnapshot {
  if (blocked.size === 0) return snapshot;
  const normalized = {
    ...snapshot,
    customSprites: (Array.isArray(snapshot.customSprites) ? snapshot.customSprites : []).filter(isRecord)
      .map(sprite => ({ ...sprite, pixels: Array.isArray(sprite.pixels) ? sprite.pixels : [] })),
    customTiles: (Array.isArray(snapshot.customTiles) ? snapshot.customTiles : []).filter(isRecord)
      .map(tile => ({ ...tile, pixels: Array.isArray(tile.pixels) ? tile.pixels : [] })),
  };
  return maskBlockedCustomArt(normalized as unknown as RoomSnapshot, blocked) as unknown as PublishedRoomSnapshot;
}

export function createFallbackRoomSnapshot(
  coordinates: RoomCoordinates,
): PublishedRoomSnapshot {
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

function emptyTileLayer(): number[][] {
  return Array.from(
    { length: ROOM_HEIGHT },
    () => Array.from({ length: ROOM_WIDTH }, () => -1),
  );
}

export async function renderRoomSharePreviewPng(
  request: Request, env: RoomImageEnvironment, url: URL, snapshot: PublishedRoomSnapshot,
): Promise<Uint8Array> {
  const canvas = await renderRoomImage(request, env, url, snapshot);
  return encodePng(canvas.width, canvas.height, canvas.pixels);
}

export async function renderRoomImage(
  request: Request, env: RoomImageEnvironment, url: URL, snapshot: PublishedRoomSnapshot,
  layout: RoomImageLayout = CARD_LAYOUT,
  size = { width: ROOM_SHARE_IMAGE_WIDTH, height: ROOM_SHARE_IMAGE_HEIGHT },
  frame = true,
): Promise<RoomImageData> {
  const canvas = createCanvas(size.width, size.height);
  await primeRoomAssetCache(request, env, url, snapshot);
  await drawPreviewBackground(canvas, request, env, url, snapshot);
  if (frame) drawRoomFrame(canvas, layout);
  // Paint room pixels at their native grid once, then scale the complete layer. Rounding each
  // scaled/offset object's rect at 27 px per tile otherwise shifts it relative to the map by a pixel.
  if (layout.tileSize === TILE_SIZE && layout.left === 0 && layout.top === 0) {
    await drawRoomAssetLayers(canvas, request, env, url, snapshot, layout);
  } else {
    const content = createCanvas(ROOM_WIDTH * TILE_SIZE, ROOM_HEIGHT * TILE_SIZE);
    await drawRoomAssetLayers(content, request, env, url, snapshot, { left: 0, top: 0, tileSize: TILE_SIZE });
    blitImageNearest(canvas, content, 0, 0, content.width, content.height, layout.left, layout.top,
      ROOM_WIDTH * layout.tileSize, ROOM_HEIGHT * layout.tileSize);
  }
  if (frame) drawBorder(canvas, layout.left - 4, layout.top - 4,
    ROOM_WIDTH * layout.tileSize + 8, ROOM_HEIGHT * layout.tileSize + 8, 0xf5f1de);
  return canvas;
}

async function drawPreviewBackground(
  canvas: RoomImageData, request: Request, env: RoomImageEnvironment, url: URL, snapshot: PublishedRoomSnapshot,
): Promise<void> {
  const background = resolveRoomBackground(snapshot.background);
  if (background.kind === 'none') {
    const context = { fillStyle: '', globalAlpha: 1,
      fillRect(x: number, y: number, width: number, height: number) {
        blendRect(canvas, x, y, width, height, hexToNumber(this.fillStyle), this.globalAlpha);
      } };
    const coordinates = isRecord(snapshot.coordinates) ? snapshot.coordinates : {};
    drawStarfieldToContext(context as unknown as CanvasRenderingContext2D, canvas.width, canvas.height,
      hashStringToSeed(`${snapshot.id || 'room'}:${Number(coordinates.x) || 0},${Number(coordinates.y) || 0}`));
    return;
  }
  if (background.kind === 'solid') {
    fillRect(canvas, 0, 0, canvas.width, canvas.height, hexToNumber(background.color)); return;
  }
  fillRect(canvas, 0, 0, canvas.width, canvas.height,
    background.kind === 'group' && background.group.bgColor ? hexToNumber(background.group.bgColor) : 0x050505);
  if (background.kind === 'custom') {
    try {
      const image = await loadCustomBackgroundImageData(request, env, url, background.id);
      drawCustomBackgroundImage(canvas, image, background.fit, 0, 0, canvas.width, canvas.height);
    } catch { /* A missing or unapproved upload keeps the neutral background. */ }
    return;
  }
  for (const layer of background.group.layers) {
    try {
      const image = await loadAssetImageData(request, env, url, layer.path);
      const { drawWidth, repeat } = getRoomMetadataBackgroundLayerLayout(layer, canvas.width, canvas.height);
      for (let x = 0; x < canvas.width; x += drawWidth) {
        blitImageNearest(canvas, image, 0, 0, image.width, image.height, x, 0, drawWidth, canvas.height);
        if (!repeat) break;
      }
    } catch { /* Keep the configured base colour when a layer cannot be loaded. */ }
  }
}

async function primeRoomAssetCache(
  request: Request,
  env: RoomImageEnvironment,
  url: URL,
  snapshot: PublishedRoomSnapshot,
): Promise<void> {
  const paths = new Set<string>();
  const background = resolveRoomBackground(snapshot.background);
  if (background.kind === 'group') {
    for (const layer of background.group.layers) {
      paths.add(layer.path);
    }
  } else if (background.kind === 'custom') {
    await loadCustomBackgroundImageData(request, env, url, background.id).catch(() => null);
  }

  for (const layerName of ROOM_IMAGE_LAYER_NAMES) {
    for (const row of getTileLayer(snapshot, layerName)) {
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

  for (const placed of getPlacedObjects(snapshot)) {
    const config = getObjectConfig(placed.id);
    if (config) {
      paths.add(config.path);
    }
  }

  await Promise.allSettled(
    Array.from(paths, (path) => loadAssetImageData(request, env, url, path)),
  );
}

function drawRoomFrame(canvas: RoomImageData, layout: RoomImageLayout): void {
  blendRect(
    canvas,
    layout.left - 8,
    layout.top - 8,
    (ROOM_WIDTH * layout.tileSize) + 16,
    (ROOM_HEIGHT * layout.tileSize) + 16,
    0x05070c,
    0.12,
  );
  blendRect(
    canvas,
    layout.left,
    layout.top,
    (ROOM_WIDTH * layout.tileSize),
    (ROOM_HEIGHT * layout.tileSize),
    0x0e1524,
    0.04,
  );
}

async function drawRoomAssetLayers(
  canvas: RoomImageData,
  request: Request,
  env: RoomImageEnvironment,
  url: URL,
  snapshot: PublishedRoomSnapshot,
  layout: RoomImageLayout,
): Promise<void> {
  for (const layerName of ROOM_IMAGE_LAYER_NAMES) {
    await drawAssetTileLayer(
      canvas,
      request,
      env,
      url,
      layerName,
      snapshot,
      layout,
    );
    await drawAssetObjectsForLayer(canvas, request, env, url, snapshot, layerName, layout);
  }
}

async function drawAssetTileLayer(
  canvas: RoomImageData,
  request: Request,
  env: RoomImageEnvironment,
  url: URL,
  layerName: RoomImageLayerName,
  snapshot: PublishedRoomSnapshot,
  layout: RoomImageLayout,
): Promise<void> {
  const layer = getTileLayer(snapshot, layerName);
  for (let tileY = 0; tileY < ROOM_HEIGHT; tileY += 1) {
    const layerRow = layer[tileY];
    const row: unknown[] = Array.isArray(layerRow) ? layerRow : [];
    for (let tileX = 0; tileX < ROOM_WIDTH; tileX += 1) {
      const { gid, flipX, flipY } = decodeTileValue(row[tileX] ?? -1);
      if (gid <= 0) {
        continue;
      }

      const custom = getCustomRoomTileDefinitionForGid({ customTiles: Array.isArray(snapshot.customTiles) ? snapshot.customTiles : [] }, gid);
      if (custom) {
        const image = pixelImage(TILE_SIZE, custom.pixels);
        blitImageNearest(canvas, image, 0, 0, TILE_SIZE, TILE_SIZE, layout.left + tileX * layout.tileSize,
          layout.top + tileY * layout.tileSize, layout.tileSize, layout.tileSize, flipX, flipY);
        continue;
      }
      const tileset = getTilesetByGid(gid);
      if (!tileset) {
        drawFallbackTile(canvas, layerName, tileX, tileY, gid, layout);
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
          layout.left + tileX * layout.tileSize,
          layout.top + tileY * layout.tileSize,
          layout.tileSize,
          layout.tileSize,
          flipX,
          flipY,
        );
      } catch {
        drawFallbackTile(canvas, layerName, tileX, tileY, gid, layout);
      }
    }
  }
}

async function drawAssetObjectsForLayer(
  canvas: RoomImageData,
  request: Request,
  env: RoomImageEnvironment,
  url: URL,
  snapshot: PublishedRoomSnapshot,
  layerName: RoomImageLayerName,
  layout: RoomImageLayout,
): Promise<void> {
  for (const placed of getPlacedObjects(snapshot)) {
    if (getPlacedLayer(placed) !== layerName) {
      continue;
    }

    const spriteId = parseCustomSpriteObjectId(typeof placed.id === 'string' ? placed.id : null);
    if (spriteId && Array.isArray(snapshot.customSprites) && snapshot.customSprites.some(
      sprite => isRecord(sprite) && sprite.id === spriteId && sprite.status === 'blocked')) continue;
    const customSprite = getCustomSpriteForObject(snapshot, placed.id);
    if (customSprite) {
      drawCustomSpriteObject(canvas, customSprite, placed, layout);
      continue;
    }

    const config = getObjectConfig(placed.id);
    if (!config) {
      drawFallbackObject(canvas, placed, layout);
      continue;
    }

    try {
      const image = await loadAssetImageData(request, env, url, config.path);
      const frame = getObjectDefaultFrame(config);
      const source = getObjectFrameSourceRect(config, frame, image.width || config.frameWidth);
      const rect = getRoomMetadataObjectDrawRect({ frameWidth: config.frameWidth, frameHeight: config.frameHeight,
        displayScale: getObjectDisplayScale(config), displayOffset: getObjectDisplayOffset(config) },
        { x: Number(placed.x) || 0, y: Number(placed.y) || 0 }, layout.tileSize);
      const destX = layout.left + rect.x, destY = layout.top + rect.y;
      const destWidth = rect.width, destHeight = rect.height;
      const shouldFlipX =
        Boolean(config.facingDirection)
        && Boolean(placed.facing)
        && config.facingDirection !== placed.facing;

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
      drawFallbackObject(canvas, placed, layout);
    }
  }
}

function getCustomSpriteForObject(
  snapshot: PublishedRoomSnapshot,
  objectId: unknown,
): RoomImageRecord | null {
  const spriteId = parseCustomSpriteObjectId(typeof objectId === 'string' ? objectId : null);
  if (!spriteId || !Array.isArray(snapshot.customSprites)) {
    return null;
  }

  return snapshot.customSprites.find((candidate): candidate is RoomImageRecord => (
    isRecord(candidate)
    && candidate.id === spriteId
    && candidate.status !== 'blocked'
    && (candidate.size === 16 || candidate.size === 32)
    && Array.isArray(candidate.pixels)
  )) ?? null;
}

function drawCustomSpriteObject(
  canvas: RoomImageData,
  sprite: RoomImageRecord,
  placed: RoomImageRecord,
  layout: RoomImageLayout,
): void {
  const size = sprite.size === 32 ? 32 : 16;
  const pixels = Array.isArray(sprite.pixels) ? sprite.pixels : [];
  const scale = layout.tileSize / TILE_SIZE;
  const destX = layout.left + Math.round((Number(placed.x || 0) - size / 2) * scale);
  const destY = layout.top + Math.round((Number(placed.y || 0) - size / 2) * scale);
  const destSize = Math.max(1, Math.round(size * scale));

  blitImageNearest(canvas, pixelImage(size, pixels), 0, 0, size, size, destX, destY, destSize, destSize);
}

function pixelImage(size: number, colors: unknown[]): RoomImageData {
  const image = createCanvas(size, size);
  colors.forEach((color, i) => {
    if (!isCustomSpriteColor(color) || i >= size * size) return;
    const value = hexToNumber(color), at = i * 4;
    image.pixels[at] = (value >> 16) & 255; image.pixels[at + 1] = (value >> 8) & 255;
    image.pixels[at + 2] = value & 255; image.pixels[at + 3] = 255;
  });
  return image;
}

function isCustomSpriteColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

function drawFallbackTile(
  canvas: RoomImageData,
  layerName: RoomImageLayerName,
  tileX: number,
  tileY: number,
  gid: number,
  layout: RoomImageLayout,
): void {
  const x = layout.left + tileX * layout.tileSize;
  const y = layout.top + tileY * layout.tileSize;
  const color = getTileColor(gid, tileX, tileY);

  if (layerName === 'background') {
    blendRect(
      canvas,
      x + 4,
      y + 4,
      layout.tileSize - 8,
      layout.tileSize - 8,
      color,
      0.45,
    );
    return;
  }

  if (layerName === 'foreground') {
    blendRect(
      canvas,
      x + 2,
      y + 2,
      layout.tileSize - 4,
      layout.tileSize - 4,
      lighten(color, 0.18),
      0.74,
    );
    drawBorder(
      canvas,
      x + 2,
      y + 2,
      layout.tileSize - 4,
      layout.tileSize - 4,
      darken(color, 0.28),
    );
    return;
  }

  fillRect(canvas, x, y, layout.tileSize, layout.tileSize, color);
  fillRect(canvas, x, y, layout.tileSize, 4, lighten(color, 0.2));
  fillRect(
    canvas,
    x,
    y + layout.tileSize - 4,
    layout.tileSize,
    4,
    darken(color, 0.24),
  );
  fillRect(canvas, x, y, 3, layout.tileSize, darken(color, 0.18));
  fillRect(
    canvas,
    x + layout.tileSize - 3,
    y,
    3,
    layout.tileSize,
    darken(color, 0.3),
  );
}

function drawFallbackObject(canvas: RoomImageData, placed: RoomImageRecord, layout: RoomImageLayout): void {
  if (typeof placed.id !== 'string') {
    return;
  }

  const scale = layout.tileSize / TILE_SIZE;
  const id = placed.id;
  const dimensions = getObjectPreviewDimensions(id);
  const width = Math.max(10, Math.round(dimensions.width * scale));
  const height = Math.max(10, Math.round(dimensions.height * scale));
  const centerX = layout.left
    + Math.round(((Number(placed.x) || 0) / TILE_SIZE) * layout.tileSize);
  const centerY = layout.top
    + Math.round(((Number(placed.y) || 0) / TILE_SIZE) * layout.tileSize);
  const x = centerX - Math.floor(width / 2);
  const y = centerY - Math.floor(height / 2);

  if (isHazardObject(id)) {
    drawTriangle(canvas, centerX, y, x, y + height, x + width, y + height, 0xff5d4d);
    drawTriangle(
      canvas,
      centerX,
      y + 6,
      x + 6,
      y + height - 4,
      x + width - 6,
      y + height - 4,
      0xffb15a,
    );
  } else if (isEnemyObject(id)) {
    fillEllipse(
      canvas,
      centerX,
      centerY,
      Math.max(8, Math.floor(width * 0.45)),
      Math.max(7, Math.floor(height * 0.38)),
      0x4fd1c5,
    );
    fillRect(canvas, centerX - 5, centerY - 4, 4, 4, 0x07111c);
    fillRect(canvas, centerX + 3, centerY - 4, 4, 4, 0x07111c);
  } else if (isCollectibleObject(id)) {
    drawDiamond(
      canvas,
      centerX,
      centerY,
      Math.max(7, Math.floor(Math.min(width, height) * 0.42)),
      0xffd447,
    );
    drawDiamond(
      canvas,
      centerX,
      centerY - 2,
      Math.max(3, Math.floor(Math.min(width, height) * 0.18)),
      0xfff3a4,
    );
  } else if (id === 'flag' || id.includes('checkpoint')) {
    fillRect(canvas, centerX - 2, y, 5, height, 0xf5f1de);
    fillRect(
      canvas,
      centerX + 3,
      y + 2,
      Math.max(12, Math.floor(width * 0.7)),
      Math.max(12, Math.floor(height * 0.42)),
      0x5dc16b,
    );
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
    drawDiamond(
      canvas,
      centerX,
      centerY,
      Math.max(9, Math.floor(Math.min(width, height) * 0.38)),
      0x7fd4ff,
    );
  } else if (id.includes('platform') || id.includes('bridge')) {
    fillRect(canvas, x, y, width, height, 0x9a6b44);
    fillRect(canvas, x, y, width, 5, 0xd6a268);
    drawBorder(canvas, x, y, width, height, 0x4b2d1f);
  } else {
    drawDecoration(canvas, id, x, y, width, height, centerX, centerY);
  }
}

function getObjectPreviewDimensions(id: string): { width: number; height: number } {
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

function isHazardObject(id: string): boolean {
  return /spike|fire|lava|saw|stake|thorn|hazard/.test(id);
}

function isEnemyObject(id: string): boolean {
  return /enemy|slime|snake|bird|bat|crawler|ghost|monster/.test(id);
}

function isCollectibleObject(id: string): boolean {
  return /coin|gem|key|star|heart|collect/.test(id);
}

function drawDecoration(
  canvas: RoomImageData,
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
): void {
  if (id.includes('tree')) {
    fillRect(
      canvas,
      centerX - 5,
      centerY,
      10,
      Math.max(12, Math.floor(height * 0.45)),
      0x7a4f34,
    );
    fillEllipse(
      canvas,
      centerX,
      centerY - Math.floor(height * 0.22),
      Math.max(12, Math.floor(width * 0.42)),
      Math.max(12, Math.floor(height * 0.36)),
      0x4b9b57,
    );
    return;
  }

  if (id.includes('sign')) {
    fillRect(
      canvas,
      centerX - 3,
      y + Math.floor(height * 0.45),
      6,
      Math.max(10, Math.floor(height * 0.48)),
      0x9a6b44,
    );
    fillRect(canvas, x, y, width, Math.max(12, Math.floor(height * 0.52)), 0xd7ac63);
    drawBorder(canvas, x, y, width, Math.max(12, Math.floor(height * 0.52)), 0x5f3928);
    return;
  }

  if (id.includes('rock')) {
    fillEllipse(
      canvas,
      centerX,
      centerY,
      Math.max(8, Math.floor(width * 0.46)),
      Math.max(6, Math.floor(height * 0.34)),
      0x8c98a8,
    );
    return;
  }

  if (id.includes('sun')) {
    fillEllipse(
      canvas,
      centerX,
      centerY,
      Math.max(12, Math.floor(width * 0.44)),
      Math.max(12, Math.floor(height * 0.44)),
      0xffd447,
    );
    return;
  }

  if (id.includes('water')) {
    blendRect(canvas, x, y, width, height, 0x4aa3df, 0.75);
    fillRect(canvas, x, y, width, 3, 0x9ddcff);
    return;
  }

  fillEllipse(
    canvas,
    centerX,
    centerY,
    Math.max(8, Math.floor(width * 0.42)),
    Math.max(6, Math.floor(height * 0.3)),
    0x5dc16b,
  );
}

function getObjectConfig(id: unknown): GameObjectConfig | null {
  return typeof id === 'string' ? GAME_OBJECT_CONFIG_BY_ID.get(id) ?? null : null;
}

export function decodeTileValue(value: unknown) {
  return decodeTileDataValue(typeof value === 'number' && Number.isFinite(value) ? value : -1);
}

export function getTileColor(gid: number, tileX: number, tileY: number): number {
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
  return variation >= 0
    ? lighten(base, variation * 0.04)
    : darken(base, Math.abs(variation) * 0.05);
}

function getTileLayer(
  snapshot: PublishedRoomSnapshot,
  layerName: RoomImageLayerName,
): RoomImageTileLayer {
  const tileData = isRecord(snapshot.tileData) ? snapshot.tileData : {};
  const layer = tileData[layerName];
  return Array.isArray(layer) ? layer : [];
}

function getPlacedObjects(snapshot: PublishedRoomSnapshot): RoomImageRecord[] {
  if (!Array.isArray(snapshot.placedObjects)) {
    return [];
  }
  return snapshot.placedObjects.filter(isRecord);
}

function getPlacedLayer(placed: RoomImageRecord): RoomImageLayerName {
  return getPlacedObjectLayer(placed as { layer?: RoomImageLayerName });
}

function isRecord(value: unknown): value is RoomImageRecord {
  return typeof value === 'object' && value !== null;
}

import Phaser from 'phaser';
import {
  decodeTileDataValue,
  LAYER_NAMES,
  ROOM_HEIGHT,
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
  ROOM_WIDTH,
  TILESETS,
  TILE_SIZE,
  getObjectDefaultFrame,
  getObjectDisplayOffset,
  getObjectDisplayScale,
  getObjectFrameSourceRect,
  getPlacedObjectLayer,
  type LayerName,
} from '../config';
import { getEditorObjectConfigById } from '../customSprites/objectConfig';
import {
  ensureCustomSpriteTexture,
  registerCustomSpritesFromSnapshot,
} from '../customSprites/registry';
import {
  getCustomRoomTileDefinitionForGid,
  getCustomRoomTileSignature,
} from '../customTiles/model';
import { drawCustomRoomTileToContext } from '../customTiles/runtime';
import { resolveRoomBackground } from '../backgrounds/model';
import {
  getCustomBackgroundCenterRect,
  getCustomBackgroundTextureKey,
  getCustomBackgroundTileScale,
} from '../backgrounds/runtime';
import type { RoomSnapshot } from '../persistence/roomModel';
import { RETRO_COLORS, drawStarfieldToContext, hashStringToSeed } from './starfield';

export type RoomTextureMode = 'preview' | 'full' | 'editor-preview';

export interface RoomTextureBuildOptions {
  includeObjects?: boolean;
  includeBackground?: boolean;
  includedLayers?: LayerName[];
  showConstructionOverlay?: boolean;
  constructionLabel?: string;
  skipCustomBackgroundImages?: boolean;
}

export interface RoomTextureDrawOptions extends RoomTextureBuildOptions {
  offsetX?: number;
  offsetY?: number;
}

const CUSTOM_BACKGROUND_DRAW_CACHE_MAX_ENTRIES = 128;
const customBackgroundSourceIds = new WeakMap<object, number>();
const customBackgroundDrawCache = new Map<string, HTMLCanvasElement>();
let nextCustomBackgroundSourceId = 1;

export function getRoomSnapshotTextureDebugState(): Record<string, unknown> {
  let approximateCustomBackgroundCachePixels = 0;
  for (const canvas of customBackgroundDrawCache.values()) {
    approximateCustomBackgroundCachePixels += canvas.width * canvas.height;
  }

  return {
    customBackgroundDrawCacheCount: customBackgroundDrawCache.size,
    customBackgroundDrawCacheMaxEntries: CUSTOM_BACKGROUND_DRAW_CACHE_MAX_ENTRIES,
    customBackgroundSourceCount: nextCustomBackgroundSourceId - 1,
    approximateCustomBackgroundCachePixels,
  };
}

export function buildRoomTextureKey(
  room: RoomSnapshot,
  mode: RoomTextureMode,
  tilePixelSize: number,
  options: RoomTextureBuildOptions = {},
): string {
  return [
    'room',
    sanitizeTextureKey(room.id),
    mode,
    String(tilePixelSize),
    options.includeBackground === false ? 'no-background' : 'with-background',
    options.includeObjects === false ? 'tiles-only' : 'with-objects',
    options.includedLayers?.join('_') ?? 'all-layers',
    options.showConstructionOverlay ? `construction-${sanitizeTextureKey(options.constructionLabel ?? 'building')}` : 'clean',
    `ct-${hashStringToSeed(getCustomRoomTileSignature(room.customTiles)).toString(36)}`,
    room.version,
    sanitizeTextureKey(room.updatedAt),
  ].join('-');
}

export function buildRoomSnapshotTexture(
  scene: Phaser.Scene,
  room: RoomSnapshot,
  textureKey: string,
  tilePixelSize: number,
  options: RoomTextureBuildOptions = {},
): void {
  registerCustomSpritesFromSnapshot(room);
  const width = ROOM_WIDTH * tilePixelSize;
  const height = ROOM_HEIGHT * tilePixelSize;
  const canvasTexture = scene.textures.createCanvas(textureKey, width, height);
  if (!canvasTexture) {
    return;
  }

  const canvas = canvasTexture.getSourceImage() as HTMLCanvasElement;
  const context = canvas.getContext('2d');
  if (!context) {
    return;
  }

  context.clearRect(0, 0, width, height);
  context.imageSmoothingEnabled = false;

  drawRoomSnapshotToContext(scene, context, room, tilePixelSize, options);
  canvasTexture.refresh();
}

export function drawRoomSnapshotToContext(
  scene: Phaser.Scene,
  context: CanvasRenderingContext2D,
  room: RoomSnapshot,
  tilePixelSize: number,
  options: RoomTextureDrawOptions = {},
): void {
  registerCustomSpritesFromSnapshot(room);
  const width = ROOM_WIDTH * tilePixelSize;
  const height = ROOM_HEIGHT * tilePixelSize;
  const offsetX = options.offsetX ?? 0;
  const offsetY = options.offsetY ?? 0;

  // When drawing multiple rooms into a shared chunk canvas, clip each room to
  // its own cell so repeating background layers do not bleed into neighbors.
  context.save();
  context.beginPath();
  context.rect(offsetX, offsetY, width, height);
  context.clip();

  if (options.includeBackground !== false) {
    drawRoomBackground(
      scene,
      context,
      room,
      width,
      height,
      offsetX,
      offsetY,
      options.skipCustomBackgroundImages === true,
    );
  }
  drawRoomTiles(
    scene,
    context,
    room,
    tilePixelSize,
    options.includeObjects !== false,
    options.includedLayers ?? LAYER_NAMES,
    offsetX,
    offsetY,
  );

  if (options.showConstructionOverlay) {
    drawConstructionOverlay(
      context,
      width,
      height,
      offsetX,
      offsetY,
      options.constructionLabel ?? 'BUILDING',
    );
  }

  context.restore();
}

export function drawRoomBackground(
  scene: Phaser.Scene,
  context: CanvasRenderingContext2D,
  room: Pick<RoomSnapshot, 'id' | 'coordinates' | 'background'>,
  width: number = ROOM_PX_WIDTH,
  height: number = ROOM_PX_HEIGHT,
  offsetX = 0,
  offsetY = 0,
  skipCustomBackgroundImages = false,
): void {
  const resolved = resolveRoomBackground(room.background);
  if (resolved.kind === 'none') {
    context.save();
    context.translate(offsetX, offsetY);
    drawStarfieldToContext(
      context,
      width,
      height,
      hashStringToSeed(`${room.id}:${room.coordinates.x},${room.coordinates.y}`),
    );
    context.restore();
    return;
  }

  if (resolved.kind === 'solid') {
    context.fillStyle = resolved.color;
    context.fillRect(offsetX, offsetY, width, height);
    return;
  }

  if (resolved.kind === 'custom') {
    context.fillStyle = RETRO_COLORS.background;
    context.fillRect(offsetX, offsetY, width, height);
    if (skipCustomBackgroundImages) {
      return;
    }
    const sourceImage = getTextureSource(scene, getCustomBackgroundTextureKey(resolved.id));
    if (sourceImage) {
      drawCustomBackgroundImage(context, sourceImage, resolved.fit, offsetX, offsetY, width, height);
    }
    return;
  }

  context.fillStyle = resolved.group.bgColor ?? RETRO_COLORS.background;
  context.fillRect(offsetX, offsetY, width, height);

  for (const layer of resolved.group.layers) {
    const sourceImage = getTextureSource(scene, layer.key);
    if (!sourceImage) continue;

    if (layer.repeat === false) {
      context.drawImage(sourceImage, offsetX, offsetY, width, height);
      continue;
    }

    const scale = height / layer.height;
    const drawWidth = Math.max(1, Math.ceil(layer.width * scale));
    for (let drawX = 0; drawX < width + drawWidth; drawX += drawWidth) {
      context.drawImage(sourceImage, offsetX + drawX, offsetY, drawWidth, height);
    }
  }
}

function drawCustomBackgroundImage(
  context: CanvasRenderingContext2D,
  sourceImage: CanvasImageSource,
  fit: 'stretch' | 'tile' | 'center',
  offsetX: number,
  offsetY: number,
  width: number,
  height: number,
): void {
  const cachedCanvas = getCachedCustomBackgroundCanvas(sourceImage, fit, width, height);
  if (cachedCanvas) {
    context.drawImage(cachedCanvas, offsetX, offsetY);
    return;
  }

  drawCustomBackgroundImageUncached(context, sourceImage, fit, offsetX, offsetY, width, height);
}

function drawCustomBackgroundImageUncached(
  context: CanvasRenderingContext2D,
  sourceImage: CanvasImageSource,
  fit: 'stretch' | 'tile' | 'center',
  offsetX: number,
  offsetY: number,
  width: number,
  height: number,
): void {
  const sourceSize = getCanvasSourceSize(sourceImage, width, height);
  const sourceWidth = sourceSize.width;
  const sourceHeight = sourceSize.height;

  if (fit === 'stretch') {
    context.drawImage(sourceImage, offsetX, offsetY, width, height);
    return;
  }

  if (fit === 'center') {
    const rect = getCustomBackgroundCenterRect(
      { width: sourceWidth, height: sourceHeight },
      { width: ROOM_PX_WIDTH, height: ROOM_PX_HEIGHT },
    );
    const scaleX = width / ROOM_PX_WIDTH;
    const scaleY = height / ROOM_PX_HEIGHT;
    context.drawImage(
      sourceImage,
      offsetX + rect.x * scaleX,
      offsetY + rect.y * scaleY,
      Math.max(1, Math.round(rect.width * scaleX)),
      Math.max(1, Math.round(rect.height * scaleY)),
    );
    return;
  }

  const scale = getCustomBackgroundTileScale({
    width: sourceWidth,
    height: sourceHeight,
  }) * (width / ROOM_PX_WIDTH);
  const drawWidth = Math.max(1, Math.ceil(sourceWidth * scale));
  const drawHeight = Math.max(1, Math.ceil(sourceHeight * scale));
  for (let drawY = 0; drawY < height + drawHeight; drawY += drawHeight) {
    for (let drawX = 0; drawX < width + drawWidth; drawX += drawWidth) {
      context.drawImage(sourceImage, offsetX + drawX, offsetY + drawY, drawWidth, drawHeight);
    }
  }
}

function getCachedCustomBackgroundCanvas(
  sourceImage: CanvasImageSource,
  fit: 'stretch' | 'tile' | 'center',
  width: number,
  height: number,
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const sourceObject = sourceImage as object;
  let sourceId = customBackgroundSourceIds.get(sourceObject);
  if (!sourceId) {
    sourceId = nextCustomBackgroundSourceId;
    nextCustomBackgroundSourceId += 1;
    customBackgroundSourceIds.set(sourceObject, sourceId);
  }

  const sourceSize = getCanvasSourceSize(sourceImage, width, height);
  const cacheKey = [
    sourceId,
    fit,
    width,
    height,
    sourceSize.width,
    sourceSize.height,
  ].join(':');
  const existing = customBackgroundDrawCache.get(cacheKey);
  if (existing) {
    customBackgroundDrawCache.delete(cacheKey);
    customBackgroundDrawCache.set(cacheKey, existing);
    return existing;
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const cacheContext = canvas.getContext('2d');
  if (!cacheContext) {
    return null;
  }

  cacheContext.imageSmoothingEnabled = false;
  drawCustomBackgroundImageUncached(cacheContext, sourceImage, fit, 0, 0, width, height);
  customBackgroundDrawCache.set(cacheKey, canvas);
  while (customBackgroundDrawCache.size > CUSTOM_BACKGROUND_DRAW_CACHE_MAX_ENTRIES) {
    const oldestKey = customBackgroundDrawCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    customBackgroundDrawCache.delete(oldestKey);
  }
  return canvas;
}

function getCanvasSourceSize(
  sourceImage: CanvasImageSource,
  fallbackWidth: number,
  fallbackHeight: number,
): { width: number; height: number } {
  const source = sourceImage as {
    width?: unknown;
    height?: unknown;
    naturalWidth?: unknown;
    naturalHeight?: unknown;
    videoWidth?: unknown;
    videoHeight?: unknown;
  };
  const rawWidth = typeof source.width === 'number'
    ? source.width
    : typeof source.naturalWidth === 'number'
      ? source.naturalWidth
      : typeof source.videoWidth === 'number'
        ? source.videoWidth
        : fallbackWidth;
  const rawHeight = typeof source.height === 'number'
    ? source.height
    : typeof source.naturalHeight === 'number'
      ? source.naturalHeight
      : typeof source.videoHeight === 'number'
        ? source.videoHeight
        : fallbackHeight;
  return {
    width: Math.max(1, Math.round(rawWidth)),
    height: Math.max(1, Math.round(rawHeight)),
  };
}

function drawRoomTiles(
  scene: Phaser.Scene,
  context: CanvasRenderingContext2D,
  room: RoomSnapshot,
  tilePixelSize: number,
  includeObjects: boolean,
  includedLayers: readonly LayerName[],
  offsetX = 0,
  offsetY = 0,
): void {
  for (const layerName of includedLayers) {
    for (let y = 0; y < ROOM_HEIGHT; y++) {
      for (let x = 0; x < ROOM_WIDTH; x++) {
        const tileValue = room.tileData[layerName][y][x];
        const { gid, flipX, flipY } = decodeTileDataValue(tileValue);
        if (gid <= 0) continue;

        const customTile = getCustomRoomTileDefinitionForGid(room, gid);
        if (customTile) {
          drawCustomTileFrame(
            context,
            customTile,
            offsetX + x * tilePixelSize,
            offsetY + y * tilePixelSize,
            tilePixelSize,
            flipX,
            flipY,
          );
          continue;
        }

        const resolvedTileset = resolveTilesetForGid(gid);
        if (!resolvedTileset) continue;

        const sourceImage = getTextureSource(scene, resolvedTileset.key);
        if (!sourceImage) continue;

        const sourceCol = resolvedTileset.localIndex % resolvedTileset.columns;
        const sourceRow = Math.floor(resolvedTileset.localIndex / resolvedTileset.columns);
        drawTileFrame(
          context,
          sourceImage,
          sourceCol * TILE_SIZE,
          sourceRow * TILE_SIZE,
          offsetX + x * tilePixelSize,
          offsetY + y * tilePixelSize,
          tilePixelSize,
          tilePixelSize,
          flipX,
          flipY,
        );
      }
    }

    if (includeObjects) {
      drawRoomObjectsForLayer(scene, context, room, tilePixelSize, layerName, offsetX, offsetY);
    }
  }

  context.globalAlpha = 1;
}

function drawCustomTileFrame(
  context: CanvasRenderingContext2D,
  tile: NonNullable<ReturnType<typeof getCustomRoomTileDefinitionForGid>>,
  dx: number,
  dy: number,
  size: number,
  flipX: boolean,
  flipY: boolean,
): void {
  context.save();
  context.translate(dx + (flipX ? size : 0), dy + (flipY ? size : 0));
  context.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  drawCustomRoomTileToContext(context, tile, 0, 0, size);
  context.restore();
}

function drawConstructionOverlay(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
  label: string,
): void {
  const bannerHeight = Math.max(10, Math.floor(height * 0.22));
  const stripeWidth = Math.max(8, Math.floor(width / 10));
  const stripeHeight = Math.max(8, Math.floor(bannerHeight * 0.92));

  context.save();
  context.translate(offsetX, offsetY);

  context.fillStyle = 'rgba(12, 12, 12, 0.28)';
  context.fillRect(0, 0, width, height);

  for (let stripeX = -stripeWidth; stripeX < width + stripeWidth; stripeX += stripeWidth) {
    context.fillStyle = (Math.floor(stripeX / stripeWidth) & 1) === 0 ? '#f6c445' : '#141414';
    context.beginPath();
    context.moveTo(stripeX, 0);
    context.lineTo(stripeX + stripeWidth, 0);
    context.lineTo(stripeX + stripeWidth * 0.4, stripeHeight);
    context.lineTo(stripeX - stripeWidth * 0.6, stripeHeight);
    context.closePath();
    context.fill();
  }

  context.fillStyle = 'rgba(7, 7, 7, 0.76)';
  context.fillRect(0, 0, width, bannerHeight);
  context.strokeStyle = 'rgba(255, 203, 82, 0.92)';
  context.lineWidth = 2;
  context.strokeRect(1, 1, Math.max(0, width - 2), Math.max(0, height - 2));

  context.font = `bold ${Math.max(6, Math.floor(bannerHeight * 0.54))}px monospace`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#fff6c2';
  context.fillText(label, width * 0.5, bannerHeight * 0.54);

  context.restore();
}

function drawTileFrame(
  context: CanvasRenderingContext2D,
  sourceImage: CanvasImageSource,
  sx: number,
  sy: number,
  dx: number,
  dy: number,
  sizeX: number,
  sizeY: number,
  flipX: boolean,
  flipY: boolean,
): void {
  context.save();
  context.translate(dx + (flipX ? sizeX : 0), dy + (flipY ? sizeY : 0));
  context.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  context.drawImage(
    sourceImage,
    sx,
    sy,
    TILE_SIZE,
    TILE_SIZE,
    0,
    0,
    sizeX,
    sizeY,
  );
  context.restore();
}

function drawRoomObjectsForLayer(
  scene: Phaser.Scene,
  context: CanvasRenderingContext2D,
  room: RoomSnapshot,
  tilePixelSize: number,
  layerName: (typeof LAYER_NAMES)[number],
  offsetX = 0,
  offsetY = 0,
): void {
  const scale = tilePixelSize / TILE_SIZE;

  for (const placedObject of room.placedObjects) {
    if (getPlacedObjectLayer(placedObject) !== layerName) {
      continue;
    }

    const objectConfig = getEditorObjectConfigById(placedObject.id);
    if (!objectConfig) continue;

    ensureCustomSpriteTexture(scene, objectConfig);
    const sourceImage = getTextureSource(scene, objectConfig.id);
    if (!sourceImage) continue;

    const displayScale = getObjectDisplayScale(objectConfig);
    const displayOffset = getObjectDisplayOffset(objectConfig);
    const destWidth = Math.max(1, Math.round(objectConfig.frameWidth * displayScale * scale));
    const destHeight = Math.max(1, Math.round(objectConfig.frameHeight * displayScale * scale));
    const destX = offsetX + Math.round((placedObject.x + displayOffset.x) * scale - destWidth / 2);
    const destY = offsetY + Math.round((placedObject.y + displayOffset.y) * scale - destHeight / 2);

    const frame = getObjectDefaultFrame(objectConfig);
    const { sx, sy, sw, sh } = getObjectFrameSourceRect(
      objectConfig,
      frame,
      getCanvasSourceWidth(sourceImage) || objectConfig.frameWidth,
    );
    const shouldFlipX =
      Boolean(objectConfig.facingDirection) &&
      Boolean(placedObject.facing) &&
      objectConfig.facingDirection !== placedObject.facing;

    context.save();
    if (shouldFlipX) {
      context.translate(destX + destWidth, destY);
      context.scale(-1, 1);
      context.drawImage(
        sourceImage,
        sx,
        sy,
        sw,
        sh,
        0,
        0,
        destWidth,
        destHeight,
      );
    } else {
      context.drawImage(
        sourceImage,
        sx,
        sy,
        sw,
        sh,
        destX,
        destY,
        destWidth,
        destHeight,
      );
    }
    context.restore();
  }
}

function getTextureSource(scene: Phaser.Scene, key: string): CanvasImageSource | null {
  const texture = scene.textures.get(key);
  if (!texture) return null;
  return (texture.getSourceImage() as CanvasImageSource | null) ?? null;
}

function getCanvasSourceWidth(source: CanvasImageSource): number {
  const sourceWithDimensions = source as
    | { naturalWidth?: number; width?: number; videoWidth?: number }
    | undefined;
  return (
    sourceWithDimensions?.naturalWidth ??
    sourceWithDimensions?.videoWidth ??
    sourceWithDimensions?.width ??
    0
  );
}

function resolveTilesetForGid(gid: number) {
  for (let index = TILESETS.length - 1; index >= 0; index--) {
    const tileset = TILESETS[index];
    if (gid < tileset.firstGid) {
      continue;
    }

    const localIndex = gid - tileset.firstGid;
    if (localIndex >= tileset.tileCount) {
      continue;
    }

    return {
      ...tileset,
      localIndex,
    };
  }

  return null;
}

function sanitizeTextureKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '_');
}

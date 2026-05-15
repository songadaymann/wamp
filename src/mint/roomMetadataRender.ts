import {
  BACKGROUND_GROUPS,
  GAME_OBJECTS,
  ROOM_HEIGHT,
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
  ROOM_WIDTH,
  TILESETS,
  TILE_SIZE,
  decodeTileDataValue,
  getObjectById,
  getObjectDefaultFrame,
  getObjectFrameSourceRect,
  getPlacedObjectLayer,
  getTilesetByGid,
  type LayerName,
} from '../config';
import { getApiBaseUrl } from '../api/baseUrl';
import { resolveRoomBackground } from '../backgrounds/model';
import {
  parseCustomSpriteObjectId,
  type CustomSpriteDefinition,
} from '../customSprites/model';
import { getCustomRoomTileDefinitionForGid, type CustomRoomTileDefinition } from '../customTiles/model';
import { drawCustomRoomTileToContext } from '../customTiles/runtime';
import type { RoomSnapshot } from '../persistence/roomModel';
import { buildRoomSnapshotFromMintedPayload, type WampMintedRoomPayload } from './roomMetadata';
import { RETRO_COLORS, drawStarfieldToContext, hashStringToSeed } from '../visuals/starfield';

export interface MintedRoomRenderOptions {
  tilePixelSize?: number;
  includeObjects?: boolean;
  includeBackground?: boolean;
  includedLayers?: LayerName[];
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();
const customSpriteCanvasCache = new Map<string, HTMLCanvasElement>();
const MAX_TILED_PHOTO_WIDTH = 128;
const MAX_TILED_PHOTO_HEIGHT = 96;

function getBackgroundImageUrl(id: string): string {
  return `${getApiBaseUrl()}/api/background-images/${encodeURIComponent(id)}/image`;
}

export async function renderWampMintedRoomToCanvas(
  payload: WampMintedRoomPayload,
  options: MintedRoomRenderOptions = {}
): Promise<HTMLCanvasElement> {
  return renderRoomSnapshotToCanvas(
    buildRoomSnapshotFromMintedPayload(payload),
    options
  );
}

export async function renderRoomSnapshotToCanvas(
  snapshot: RoomSnapshot,
  options: MintedRoomRenderOptions = {}
): Promise<HTMLCanvasElement> {
  const tilePixelSize = options.tilePixelSize ?? 2;
  const canvas = document.createElement('canvas');
  canvas.width = ROOM_WIDTH * tilePixelSize;
  canvas.height = ROOM_HEIGHT * tilePixelSize;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas 2D context was not available.');
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = false;

  await drawRoomSnapshotToContext(context, snapshot, options);
  return canvas;
}

export async function renderWampMintedRoomToPngDataUrl(
  payload: WampMintedRoomPayload,
  options: MintedRoomRenderOptions = {}
): Promise<string> {
  const canvas = await renderWampMintedRoomToCanvas(payload, options);
  return canvas.toDataURL('image/png');
}

export async function renderRoomSnapshotToPngDataUrl(
  snapshot: RoomSnapshot,
  options: MintedRoomRenderOptions = {}
): Promise<string> {
  const canvas = await renderRoomSnapshotToCanvas(snapshot, options);
  return canvas.toDataURL('image/png');
}

export async function drawRoomSnapshotToContext(
  context: CanvasRenderingContext2D,
  snapshot: RoomSnapshot,
  options: MintedRoomRenderOptions = {}
): Promise<void> {
  const tilePixelSize = options.tilePixelSize ?? 2;
  const width = ROOM_WIDTH * tilePixelSize;
  const height = ROOM_HEIGHT * tilePixelSize;
  const layers = options.includedLayers ?? ['background', 'terrain', 'foreground'];

  if (options.includeBackground !== false) {
    await drawRoomBackground(context, snapshot, width, height);
  } else {
    context.clearRect(0, 0, width, height);
  }

  await drawRoomTiles(
    context,
    snapshot,
    tilePixelSize,
    layers,
    options.includeObjects !== false
  );
}

async function drawRoomBackground(
  context: CanvasRenderingContext2D,
  snapshot: Pick<RoomSnapshot, 'id' | 'coordinates' | 'background'>,
  width: number,
  height: number
): Promise<void> {
  const resolved = resolveRoomBackground(snapshot.background);
  if (resolved.kind === 'none') {
    drawStarfieldToContext(
      context,
      width,
      height,
      hashStringToSeed(`${snapshot.id}:${snapshot.coordinates.x},${snapshot.coordinates.y}`)
    );
    return;
  }

  if (resolved.kind === 'solid') {
    context.fillStyle = resolved.color;
    context.fillRect(0, 0, width, height);
    return;
  }

  if (resolved.kind === 'custom') {
    context.fillStyle = RETRO_COLORS.background;
    context.fillRect(0, 0, width, height);
    try {
      const image = await loadAssetImage(getBackgroundImageUrl(resolved.id));
      drawCustomBackgroundImage(context, image, resolved.fit, width, height);
    } catch (error) {
      console.warn('Failed to load custom room snapshot background.', resolved.id, error);
    }
    return;
  }

  context.fillStyle = resolved.group.bgColor ?? RETRO_COLORS.background;
  context.fillRect(0, 0, width, height);

  for (const layer of resolved.group.layers) {
    const image = await loadAssetImage(layer.path);
    const scale = height / layer.height;
    const drawWidth = Math.max(1, Math.ceil(layer.width * scale));
    for (let drawX = 0; drawX < width + drawWidth; drawX += drawWidth) {
      context.drawImage(image, drawX, 0, drawWidth, height);
    }
  }
}

function drawCustomBackgroundImage(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  fit: 'stretch' | 'tile' | 'center',
  width: number,
  height: number
): void {
  const sourceWidth = Math.max(1, Math.round(image.naturalWidth || image.width || width));
  const sourceHeight = Math.max(1, Math.round(image.naturalHeight || image.height || height));

  if (fit === 'stretch') {
    context.drawImage(image, 0, 0, width, height);
    return;
  }

  if (fit === 'center') {
    const rect = getCustomBackgroundCenterRect(
      { width: sourceWidth, height: sourceHeight },
      { width: ROOM_PX_WIDTH, height: ROOM_PX_HEIGHT }
    );
    const scaleX = width / ROOM_PX_WIDTH;
    const scaleY = height / ROOM_PX_HEIGHT;
    context.drawImage(
      image,
      rect.x * scaleX,
      rect.y * scaleY,
      Math.max(1, Math.round(rect.width * scaleX)),
      Math.max(1, Math.round(rect.height * scaleY))
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
      context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
    }
  }
}

function getCustomBackgroundTileScale(size: { width: number; height: number }): number {
  const width = Math.max(1, size.width);
  const height = Math.max(1, size.height);
  return Math.min(1, MAX_TILED_PHOTO_WIDTH / width, MAX_TILED_PHOTO_HEIGHT / height);
}

function getCustomBackgroundCenterRect(
  source: { width: number; height: number },
  target: { width: number; height: number }
): { x: number; y: number; width: number; height: number } {
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

async function drawRoomTiles(
  context: CanvasRenderingContext2D,
  snapshot: RoomSnapshot,
  tilePixelSize: number,
  includedLayers: readonly LayerName[],
  includeObjects: boolean
): Promise<void> {
  for (const layerName of includedLayers) {
    for (let y = 0; y < ROOM_HEIGHT; y += 1) {
      for (let x = 0; x < ROOM_WIDTH; x += 1) {
        const tileValue = snapshot.tileData[layerName][y][x];
        const { gid, flipX, flipY } = decodeTileDataValue(tileValue);
        if (gid <= 0) {
          continue;
        }

        const customTile = getCustomRoomTileDefinitionForGid(snapshot, gid);
        if (customTile) {
          drawCustomTileFrame(
            context,
            customTile,
            x * tilePixelSize,
            y * tilePixelSize,
            tilePixelSize,
            tilePixelSize,
            flipX,
            flipY
          );
          continue;
        }

        const tileset = getTilesetByGid(gid);
        if (!tileset) {
          continue;
        }

        const localIndex = gid - tileset.firstGid;
        const image = await loadAssetImage(tileset.path);
        const sourceCol = localIndex % tileset.columns;
        const sourceRow = Math.floor(localIndex / tileset.columns);
        drawTileFrame(
          context,
          image,
          sourceCol * TILE_SIZE,
          sourceRow * TILE_SIZE,
          x * tilePixelSize,
          y * tilePixelSize,
          tilePixelSize,
          tilePixelSize,
          flipX,
          flipY
        );
      }
    }

    if (includeObjects) {
      await drawObjectsForLayer(context, snapshot, tilePixelSize, layerName);
    }
  }
}

function drawTileFrame(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  sx: number,
  sy: number,
  dx: number,
  dy: number,
  width: number,
  height: number,
  flipX: boolean,
  flipY: boolean
): void {
  context.save();
  context.translate(dx + (flipX ? width : 0), dy + (flipY ? height : 0));
  context.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  context.drawImage(image, sx, sy, TILE_SIZE, TILE_SIZE, 0, 0, width, height);
  context.restore();
}

function drawCustomTileFrame(
  context: CanvasRenderingContext2D,
  tile: CustomRoomTileDefinition,
  dx: number,
  dy: number,
  width: number,
  height: number,
  flipX: boolean,
  flipY: boolean
): void {
  context.save();
  context.translate(dx + (flipX ? width : 0), dy + (flipY ? height : 0));
  context.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  drawCustomRoomTileToContext(context, tile, 0, 0, Math.min(width, height));
  context.restore();
}

async function drawObjectsForLayer(
  context: CanvasRenderingContext2D,
  snapshot: RoomSnapshot,
  tilePixelSize: number,
  layerName: LayerName
): Promise<void> {
  const scale = tilePixelSize / TILE_SIZE;

  for (const placedObject of snapshot.placedObjects) {
    if (getPlacedObjectLayer(placedObject) !== layerName) {
      continue;
    }

    const objectConfig = getObjectById(placedObject.id);
    if (!objectConfig) {
      const customSprite = getCustomSpriteForObject(snapshot, placedObject.id);
      if (customSprite) {
        drawCustomSpriteObject(context, customSprite, placedObject, tilePixelSize);
      }
      continue;
    }

    const image = await loadAssetImage(objectConfig.path);
    const frame = getObjectDefaultFrame(objectConfig);
    const { sx, sy, sw, sh } = getObjectFrameSourceRect(
      objectConfig,
      frame,
      image.width || objectConfig.frameWidth
    );
    const destX = Math.round((placedObject.x - objectConfig.frameWidth / 2) * scale);
    const destY = Math.round((placedObject.y - objectConfig.frameHeight / 2) * scale);
    const destWidth = Math.max(1, Math.round(sw * scale));
    const destHeight = Math.max(1, Math.round(sh * scale));
    const shouldFlipX =
      Boolean(objectConfig.facingDirection) &&
      Boolean(placedObject.facing) &&
      objectConfig.facingDirection !== placedObject.facing;

    context.save();
    context.translate(destX + (shouldFlipX ? destWidth : 0), destY);
    context.scale(shouldFlipX ? -1 : 1, 1);
    context.drawImage(image, sx, sy, sw, sh, 0, 0, destWidth, destHeight);
    context.restore();
  }
}

function getCustomSpriteForObject(
  snapshot: Pick<RoomSnapshot, 'customSprites'>,
  objectId: string
): CustomSpriteDefinition | null {
  const spriteId = parseCustomSpriteObjectId(objectId);
  if (!spriteId || !Array.isArray(snapshot.customSprites)) {
    return null;
  }

  return snapshot.customSprites.find(
    (sprite) => sprite.id === spriteId && sprite.status !== 'blocked'
  ) ?? null;
}

function drawCustomSpriteObject(
  context: CanvasRenderingContext2D,
  sprite: CustomSpriteDefinition,
  placedObject: { x: number; y: number },
  tilePixelSize: number
): void {
  const sourceCanvas = getCustomSpriteCanvas(sprite);
  const scale = tilePixelSize / TILE_SIZE;
  const destX = Math.round((placedObject.x - sprite.size / 2) * scale);
  const destY = Math.round((placedObject.y - sprite.size / 2) * scale);
  const destSize = Math.max(1, Math.round(sprite.size * scale));
  context.drawImage(sourceCanvas, 0, 0, sprite.size, sprite.size, destX, destY, destSize, destSize);
}

function getCustomSpriteCanvas(sprite: CustomSpriteDefinition): HTMLCanvasElement {
  const cacheKey = `${sprite.id}:${sprite.size}:${sprite.updatedAt}`;
  const cached = customSpriteCanvasCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const canvas = document.createElement('canvas');
  canvas.width = sprite.size;
  canvas.height = sprite.size;
  const context = canvas.getContext('2d');
  if (context) {
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, sprite.size, sprite.size);
    for (let index = 0; index < sprite.pixels.length; index += 1) {
      const color = sprite.pixels[index];
      if (!color || !/^#[0-9a-f]{6}$/i.test(color)) {
        continue;
      }
      context.fillStyle = color;
      context.fillRect(index % sprite.size, Math.floor(index / sprite.size), 1, 1);
    }
  }
  customSpriteCanvasCache.set(cacheKey, canvas);
  return canvas;
}

function loadAssetImage(assetPath: string): Promise<HTMLImageElement> {
  const normalizedPath = /^https?:\/\//i.test(assetPath)
    ? assetPath
    : assetPath.startsWith('/')
      ? assetPath
      : `/${assetPath}`;
  let pending = imageCache.get(normalizedPath);
  if (pending) {
    return pending;
  }

  pending = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load asset ${normalizedPath}.`));
    image.src = normalizedPath;
  });
  imageCache.set(normalizedPath, pending);
  return pending;
}

export function warmRoomMetadataRenderAssetCache(): Promise<void> {
  const paths = new Set<string>();

  for (const tileset of TILESETS) {
    paths.add(tileset.path);
  }
  for (const backgroundGroup of BACKGROUND_GROUPS) {
    for (const layer of backgroundGroup.layers) {
      paths.add(layer.path);
    }
  }
  for (const objectConfig of GAME_OBJECTS) {
    paths.add(objectConfig.path);
  }

  return Promise.all([...paths].map((path) => loadAssetImage(path))).then(() => undefined);
}

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
  getBackgroundGroup,
  getObjectById,
  getObjectDefaultFrame,
  getObjectFrameSourceRect,
  getPlacedObjectLayer,
  type LayerName,
} from '../config';
import type { RoomSnapshot } from '../persistence/roomModel';
import { RETRO_COLORS, drawStarfieldToContext, hashStringToSeed } from './starfield';

export type RoomTextureMode = 'preview' | 'full' | 'editor-preview';

export interface RoomTextureBuildOptions {
  includeObjects?: boolean;
  includeBackground?: boolean;
  includedLayers?: LayerName[];
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

  if (options.includeBackground !== false) {
    drawRoomBackground(scene, context, room, width, height);
  }
  drawRoomTiles(
    scene,
    context,
    room,
    tilePixelSize,
    options.includeObjects !== false,
    options.includedLayers ?? LAYER_NAMES
  );
  canvasTexture.refresh();
}

export function drawRoomBackground(
  scene: Phaser.Scene,
  context: CanvasRenderingContext2D,
  room: Pick<RoomSnapshot, 'id' | 'coordinates' | 'background'>,
  width: number = ROOM_PX_WIDTH,
  height: number = ROOM_PX_HEIGHT,
): void {
  const backgroundGroup = getBackgroundGroup(room.background);
  if (!backgroundGroup || backgroundGroup.layers.length === 0) {
    drawStarfieldToContext(
      context,
      width,
      height,
      hashStringToSeed(`${room.id}:${room.coordinates.x},${room.coordinates.y}`),
    );
    return;
  }

  context.fillStyle = backgroundGroup.bgColor ?? RETRO_COLORS.background;
  context.fillRect(0, 0, width, height);

  for (const layer of backgroundGroup.layers) {
    const sourceImage = getTextureSource(scene, layer.key);
    if (!sourceImage) continue;

    const scale = height / layer.height;
    const drawWidth = Math.max(1, Math.ceil(layer.width * scale));
    for (let drawX = 0; drawX < width + drawWidth; drawX += drawWidth) {
      context.drawImage(sourceImage, drawX, 0, drawWidth, height);
    }
  }
}

function drawRoomTiles(
  scene: Phaser.Scene,
  context: CanvasRenderingContext2D,
  room: RoomSnapshot,
  tilePixelSize: number,
  includeObjects: boolean,
  includedLayers: readonly LayerName[],
): void {
  for (const layerName of includedLayers) {
    for (let y = 0; y < ROOM_HEIGHT; y++) {
      for (let x = 0; x < ROOM_WIDTH; x++) {
        const tileValue = room.tileData[layerName][y][x];
        const { gid, flipX, flipY } = decodeTileDataValue(tileValue);
        if (gid <= 0) continue;

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
          x * tilePixelSize,
          y * tilePixelSize,
          tilePixelSize,
          tilePixelSize,
          flipX,
          flipY,
        );
      }
    }

    if (includeObjects) {
      drawRoomObjectsForLayer(scene, context, room, tilePixelSize, layerName);
    }
  }

  context.globalAlpha = 1;
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
): void {
  const scale = tilePixelSize / TILE_SIZE;

  for (const placedObject of room.placedObjects) {
    if (getPlacedObjectLayer(placedObject) !== layerName) {
      continue;
    }

    const objectConfig = getObjectById(placedObject.id);
    if (!objectConfig) continue;

    const sourceImage = getTextureSource(scene, objectConfig.id);
    if (!sourceImage) continue;

    const destX = Math.round((placedObject.x - objectConfig.frameWidth / 2) * scale);
    const destY = Math.round((placedObject.y - objectConfig.frameHeight / 2) * scale);
    const destWidth = Math.max(1, Math.round(objectConfig.frameWidth * scale));
    const destHeight = Math.max(1, Math.round(objectConfig.frameHeight * scale));

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

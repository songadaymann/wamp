import Phaser from 'phaser';
import {
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
} from '../config';
import type { RoomSnapshot } from '../persistence/roomModel';
import { RETRO_COLORS, drawStarfieldToContext, hashStringToSeed } from './starfield';

export type RoomTextureMode = 'preview' | 'full' | 'editor-preview';

export interface RoomTextureBuildOptions {
  includeObjects?: boolean;
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
    options.includeObjects === false ? 'tiles-only' : 'with-objects',
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

  drawRoomBackground(scene, context, room, width, height);
  drawRoomTiles(scene, context, room, tilePixelSize);
  if (options.includeObjects !== false) {
    drawRoomObjects(scene, context, room, tilePixelSize);
  }
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
): void {
  for (const layerName of LAYER_NAMES) {
    for (let y = 0; y < ROOM_HEIGHT; y++) {
      for (let x = 0; x < ROOM_WIDTH; x++) {
        const gid = room.tileData[layerName][y][x];
        if (gid <= 0) continue;

        const resolvedTileset = resolveTilesetForGid(gid);
        if (!resolvedTileset) continue;

        const sourceImage = getTextureSource(scene, resolvedTileset.key);
        if (!sourceImage) continue;

        const sourceCol = resolvedTileset.localIndex % resolvedTileset.columns;
        const sourceRow = Math.floor(resolvedTileset.localIndex / resolvedTileset.columns);

        context.drawImage(
          sourceImage,
          sourceCol * TILE_SIZE,
          sourceRow * TILE_SIZE,
          TILE_SIZE,
          TILE_SIZE,
          x * tilePixelSize,
          y * tilePixelSize,
          tilePixelSize,
          tilePixelSize,
        );
      }
    }
  }

  context.globalAlpha = 1;
}

function drawRoomObjects(
  scene: Phaser.Scene,
  context: CanvasRenderingContext2D,
  room: RoomSnapshot,
  tilePixelSize: number,
): void {
  const scale = tilePixelSize / TILE_SIZE;

  for (const placedObject of room.placedObjects) {
    const objectConfig = getObjectById(placedObject.id);
    if (!objectConfig) continue;

    const sourceImage = getTextureSource(scene, objectConfig.id);
    if (!sourceImage) continue;

    const destX = Math.round((placedObject.x - objectConfig.frameWidth / 2) * scale);
    const destY = Math.round((placedObject.y - objectConfig.frameHeight / 2) * scale);
    const destWidth = Math.max(1, Math.round(objectConfig.frameWidth * scale));
    const destHeight = Math.max(1, Math.round(objectConfig.frameHeight * scale));

    context.drawImage(
      sourceImage,
      getObjectDefaultFrame(objectConfig) * objectConfig.frameWidth,
      0,
      objectConfig.frameWidth,
      objectConfig.frameHeight,
      destX,
      destY,
      destWidth,
      destHeight,
    );
  }
}

function getTextureSource(scene: Phaser.Scene, key: string): CanvasImageSource | null {
  const texture = scene.textures.get(key);
  if (!texture) return null;
  return (texture.getSourceImage() as CanvasImageSource | null) ?? null;
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

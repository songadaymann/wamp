import Phaser from 'phaser';
import { TILE_SIZE } from '../config/room';
import {
  CUSTOM_ROOM_TILE_ATLAS_COLUMNS,
  CUSTOM_ROOM_TILE_ATLAS_ROWS,
  CUSTOM_ROOM_TILE_FIRST_GID,
  CUSTOM_ROOM_TILE_MAX_TILES,
  CUSTOM_ROOM_TILESET_KEY_PREFIX,
  normalizeCustomRoomTileDefinitions,
  type CustomRoomTileDefinition,
} from './model';

export function buildCustomRoomTileTextureKey(scope: string): string {
  return `${CUSTOM_ROOM_TILESET_KEY_PREFIX}:${sanitizeTextureKey(scope)}`;
}

export function ensureCustomRoomTileTexture(
  scene: Phaser.Scene,
  textureKey: string,
  customTiles: readonly CustomRoomTileDefinition[] | null | undefined,
): void {
  const tiles = normalizeCustomRoomTileDefinitions(customTiles);
  const width = CUSTOM_ROOM_TILE_ATLAS_COLUMNS * TILE_SIZE;
  const height = CUSTOM_ROOM_TILE_ATLAS_ROWS * TILE_SIZE;
  const texture = scene.textures.exists(textureKey)
    ? scene.textures.get(textureKey) as Phaser.Textures.CanvasTexture
    : scene.textures.createCanvas(textureKey, width, height);
  if (!texture) {
    return;
  }

  if (typeof texture.setSize === 'function') {
    texture.setSize(width, height);
  }

  const canvas = texture.getSourceImage() as HTMLCanvasElement;
  const context = canvas.getContext('2d');
  if (!context) {
    return;
  }

  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, width, height);
  for (let index = 0; index < Math.min(tiles.length, CUSTOM_ROOM_TILE_MAX_TILES); index += 1) {
    drawCustomRoomTileToContext(
      context,
      tiles[index],
      (index % CUSTOM_ROOM_TILE_ATLAS_COLUMNS) * TILE_SIZE,
      Math.floor(index / CUSTOM_ROOM_TILE_ATLAS_COLUMNS) * TILE_SIZE,
      TILE_SIZE,
    );
  }

  texture.refresh();
}

export function drawCustomRoomTileToContext(
  context: CanvasRenderingContext2D,
  tile: CustomRoomTileDefinition,
  dx: number,
  dy: number,
  size: number,
): void {
  const cellSize = size / TILE_SIZE;
  for (let index = 0; index < tile.pixels.length; index += 1) {
    const color = tile.pixels[index];
    if (!color) {
      continue;
    }
    const x = index % TILE_SIZE;
    const y = Math.floor(index / TILE_SIZE);
    context.fillStyle = color;
    context.fillRect(
      dx + x * cellSize,
      dy + y * cellSize,
      Math.ceil(cellSize),
      Math.ceil(cellSize),
    );
  }
}

export function ensureCustomRoomTilesetForMap(
  map: Phaser.Tilemaps.Tilemap,
  textureKey: string,
): Phaser.Tilemaps.Tileset | null {
  const existing = map.tilesets.find((tileset) => tileset.name === textureKey);
  if (existing) {
    return existing;
  }

  return map.addTilesetImage(
    textureKey,
    textureKey,
    TILE_SIZE,
    TILE_SIZE,
    0,
    0,
    CUSTOM_ROOM_TILE_FIRST_GID,
  );
}

export function syncCustomRoomTilesetForLayers(
  map: Phaser.Tilemaps.Tilemap,
  layers: Iterable<Phaser.Tilemaps.TilemapLayer>,
  textureKey: string,
): void {
  const tileset = ensureCustomRoomTilesetForMap(map, textureKey);
  if (!tileset) {
    return;
  }

  for (const layer of layers) {
    const currentTilesets = Array.isArray(layer.tileset) ? layer.tileset : [];
    if (currentTilesets.some((candidate) => candidate.name === textureKey)) {
      continue;
    }
    layer.tileset = [...currentTilesets, tileset];
  }
}

function sanitizeTextureKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '_');
}

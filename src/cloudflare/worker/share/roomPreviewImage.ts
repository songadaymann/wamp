import {
  ROOM_HEIGHT,
  ROOM_WIDTH,
  TILE_SIZE,
  decodeTileDataValue,
  getObjectById,
  getPlacedObjectLayer,
  getTerrainCollisionProfileForGid,
  getTilesetByGid,
} from '../../../config';
import { resolveRoomBackground } from '../../../backgrounds/model';
import {
  getCustomRoomTileCollisionProfile,
  getCustomRoomTileDefinitionForGid,
  type CustomRoomTileDefinition,
} from '../../../customTiles/model';
import {
  createDefaultRoomSnapshot,
  type RoomCoordinates,
  type RoomSnapshot,
} from '../../../persistence/roomModel';

export const ROOM_SHARE_IMAGE_WIDTH = 1200;
export const ROOM_SHARE_IMAGE_HEIGHT = 630;

const PREVIEW_TILE_SIZE = 27;
const PREVIEW_LEFT = 60;
const PREVIEW_TOP = 18;
const PREVIEW_WIDTH = ROOM_WIDTH * PREVIEW_TILE_SIZE;
const PREVIEW_HEIGHT = ROOM_HEIGHT * PREVIEW_TILE_SIZE;
const EXPANDED_PREVIEW_MARGIN_X = 60;
const EXPANDED_PREVIEW_MARGIN_Y = 36;

interface RoomPreviewLayout {
  left: number;
  top: number;
  tileSize: number;
}

export interface ExpandedRoomSharePreviewCell {
  snapshot: RoomSnapshot;
  coordinates: RoomCoordinates;
}

const DEFAULT_ROOM_PREVIEW_LAYOUT: RoomPreviewLayout = {
  left: PREVIEW_LEFT,
  top: PREVIEW_TOP,
  tileSize: PREVIEW_TILE_SIZE,
};

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

interface ShareCanvas {
  width: number;
  height: number;
  pixels: Uint8Array;
}

const FALLBACK_THEME = {
  accentCool: 0x5dc16b,
  accentWarm: 0xd7ac63,
  accentHot: 0xff7a5c,
  accentAlt: 0x63d6cb,
};

const BACKGROUND_COLORS: Record<string, { sky: number; far: number; near: number }> = {
  forest: { sky: 0x8dd7cf, far: 0x5aa56f, near: 0x2f6f4c },
  dark_forest: { sky: 0x151f34, far: 0x1d3a38, near: 0x122722 },
  grassland: { sky: 0x8bcce3, far: 0x8ec65c, near: 0x4f8b48 },
  mountains: { sky: 0x96cde8, far: 0x8195aa, near: 0x4d6379 },
  meadow: { sky: 0xa7d99f, far: 0x84bf69, near: 0x4f8d57 },
  aurora: { sky: 0x172448, far: 0x2e5d7f, near: 0x283d58 },
  cave: { sky: 0x17171f, far: 0x262739, near: 0x12151d },
  desert: { sky: 0xf2c986, far: 0xd89d58, near: 0x9d6438 },
};

export function renderRoomSharePreviewPng(snapshot: RoomSnapshot): Uint8Array {
  const canvas = createCanvas(ROOM_SHARE_IMAGE_WIDTH, ROOM_SHARE_IMAGE_HEIGHT);
  drawBackground(canvas, snapshot);
  drawRoomFrame(canvas, DEFAULT_ROOM_PREVIEW_LAYOUT);
  drawTiles(canvas, snapshot, DEFAULT_ROOM_PREVIEW_LAYOUT);
  drawObjects(canvas, snapshot, DEFAULT_ROOM_PREVIEW_LAYOUT);
  drawBorder(canvas, PREVIEW_LEFT - 4, PREVIEW_TOP - 4, PREVIEW_WIDTH + 8, PREVIEW_HEIGHT + 8, 0xf5f1de);
  return encodePng(canvas.width, canvas.height, canvas.pixels);
}

export function renderExpandedRoomSharePreviewPng(cells: ExpandedRoomSharePreviewCell[]): Uint8Array {
  if (cells.length <= 1) {
    return renderRoomSharePreviewPng(cells[0]?.snapshot ?? createDefaultRoomSnapshot());
  }

  const sortedCells = cells
    .filter((cell) => Number.isFinite(cell.coordinates.x) && Number.isFinite(cell.coordinates.y))
    .sort((left, right) => (
      left.coordinates.y - right.coordinates.y
      || left.coordinates.x - right.coordinates.x
    ));
  if (sortedCells.length === 0) {
    return renderRoomSharePreviewPng(createDefaultRoomSnapshot());
  }

  const bounds = getExpandedRoomPreviewBounds(sortedCells);
  const canvas = createCanvas(ROOM_SHARE_IMAGE_WIDTH, ROOM_SHARE_IMAGE_HEIGHT);
  drawBackground(canvas, sortedCells[0].snapshot);

  const columnCount = bounds.maxX - bounds.minX + 1;
  const rowCount = bounds.maxY - bounds.minY + 1;
  const tileSize = Math.max(
    3,
    Math.floor(
      Math.min(
        (ROOM_SHARE_IMAGE_WIDTH - EXPANDED_PREVIEW_MARGIN_X * 2) / (columnCount * ROOM_WIDTH),
        (ROOM_SHARE_IMAGE_HEIGHT - EXPANDED_PREVIEW_MARGIN_Y * 2) / (rowCount * ROOM_HEIGHT),
      ),
    ),
  );
  const cellWidth = ROOM_WIDTH * tileSize;
  const cellHeight = ROOM_HEIGHT * tileSize;
  const previewWidth = columnCount * cellWidth;
  const previewHeight = rowCount * cellHeight;
  const previewLeft = Math.floor((ROOM_SHARE_IMAGE_WIDTH - previewWidth) / 2);
  const previewTop = Math.floor((ROOM_SHARE_IMAGE_HEIGHT - previewHeight) / 2);
  const occupiedCells = new Set(sortedCells.map((cell) => getCoordinateKey(cell.coordinates)));

  blendRect(canvas, previewLeft - 12, previewTop - 12, previewWidth + 24, previewHeight + 24, 0x05070c, 0.7);
  blendRect(canvas, previewLeft, previewTop, previewWidth, previewHeight, 0x0e1524, 0.34);

  for (const cell of sortedCells) {
    const layout = {
      left: previewLeft + (cell.coordinates.x - bounds.minX) * cellWidth,
      top: previewTop + (cell.coordinates.y - bounds.minY) * cellHeight,
      tileSize,
    };
    drawTiles(canvas, cell.snapshot, layout);
    drawObjects(canvas, cell.snapshot, layout);
  }

  drawExpandedRoomOuterBorder(canvas, sortedCells, occupiedCells, bounds, {
    left: previewLeft,
    top: previewTop,
    tileSize,
  });
  return encodePng(canvas.width, canvas.height, canvas.pixels);
}

function getExpandedRoomPreviewBounds(cells: ExpandedRoomSharePreviewCell[]): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  return cells.reduce(
    (bounds, cell) => ({
      minX: Math.min(bounds.minX, cell.coordinates.x),
      maxX: Math.max(bounds.maxX, cell.coordinates.x),
      minY: Math.min(bounds.minY, cell.coordinates.y),
      maxY: Math.max(bounds.maxY, cell.coordinates.y),
    }),
    {
      minX: cells[0].coordinates.x,
      maxX: cells[0].coordinates.x,
      minY: cells[0].coordinates.y,
      maxY: cells[0].coordinates.y,
    },
  );
}

function drawExpandedRoomOuterBorder(
  canvas: ShareCanvas,
  cells: ExpandedRoomSharePreviewCell[],
  occupiedCells: Set<string>,
  bounds: { minX: number; minY: number },
  layout: RoomPreviewLayout,
): void {
  const cellWidth = ROOM_WIDTH * layout.tileSize;
  const cellHeight = ROOM_HEIGHT * layout.tileSize;
  const stroke = Math.max(3, Math.floor(layout.tileSize / 3));

  for (const cell of cells) {
    const left = layout.left + (cell.coordinates.x - bounds.minX) * cellWidth;
    const top = layout.top + (cell.coordinates.y - bounds.minY) * cellHeight;
    const { x, y } = cell.coordinates;
    if (!occupiedCells.has(`${x},${y - 1}`)) {
      fillRect(canvas, left - stroke, top - stroke, cellWidth + stroke * 2, stroke, 0xf5f1de);
    }
    if (!occupiedCells.has(`${x},${y + 1}`)) {
      fillRect(canvas, left - stroke, top + cellHeight, cellWidth + stroke * 2, stroke, 0xf5f1de);
    }
    if (!occupiedCells.has(`${x - 1},${y}`)) {
      fillRect(canvas, left - stroke, top - stroke, stroke, cellHeight + stroke * 2, 0xf5f1de);
    }
    if (!occupiedCells.has(`${x + 1},${y}`)) {
      fillRect(canvas, left + cellWidth, top - stroke, stroke, cellHeight + stroke * 2, 0xf5f1de);
    }
  }
}

function getCoordinateKey(coordinates: RoomCoordinates): string {
  return `${coordinates.x},${coordinates.y}`;
}

function getTilePreviewInset(tileSize: number, preferredInset: number): number {
  return Math.max(0, Math.min(preferredInset, Math.floor((tileSize - 1) / 2)));
}

function getTilePreviewEdgeSize(tileSize: number): number {
  return Math.max(1, Math.min(4, Math.floor(tileSize / 4) || 1));
}

function getTilePreviewSideSize(tileSize: number): number {
  return Math.max(1, Math.min(3, Math.floor(tileSize / 5) || 1));
}

function createCanvas(width: number, height: number): ShareCanvas {
  return {
    width,
    height,
    pixels: new Uint8Array(width * height * 4),
  };
}

function drawBackground(canvas: ShareCanvas, snapshot: RoomSnapshot): void {
  const resolved = resolveRoomBackground(snapshot.background);

  if (resolved.kind === 'solid') {
    fillRect(canvas, 0, 0, canvas.width, canvas.height, hexToNumber(resolved.color));
    return;
  }

  if (resolved.kind === 'group') {
    const palette = BACKGROUND_COLORS[resolved.group.id] ?? BACKGROUND_COLORS.forest;
    fillRect(canvas, 0, 0, canvas.width, canvas.height, palette.sky);
    fillRect(canvas, 0, Math.floor(canvas.height * 0.42), canvas.width, Math.ceil(canvas.height * 0.3), palette.far);
    fillRect(canvas, 0, Math.floor(canvas.height * 0.62), canvas.width, Math.ceil(canvas.height * 0.38), palette.near);
    drawHorizonSteps(canvas, palette.far, palette.near, snapshot.id);
    return;
  }

  if (resolved.kind === 'custom') {
    fillRect(canvas, 0, 0, canvas.width, canvas.height, 0x1f2937);
    fillChecker(canvas, 0, 0, canvas.width, canvas.height, 40, 0x283447, 0x1b2433);
    return;
  }

  fillRect(canvas, 0, 0, canvas.width, canvas.height, 0x070b16);
  drawStars(canvas, snapshot.id);
}

function drawRoomFrame(canvas: ShareCanvas, layout: RoomPreviewLayout): void {
  const width = ROOM_WIDTH * layout.tileSize;
  const height = ROOM_HEIGHT * layout.tileSize;
  blendRect(canvas, layout.left - 8, layout.top - 8, width + 16, height + 16, 0x05070c, 0.84);
  blendRect(canvas, layout.left, layout.top, width, height, 0x0e1524, 0.34);
}

function drawTiles(canvas: ShareCanvas, snapshot: RoomSnapshot, layout: RoomPreviewLayout): void {
  const layers = ['background', 'terrain', 'foreground'] as const;

  for (const layerName of layers) {
    const layer = snapshot.tileData[layerName];
    for (let tileY = 0; tileY < ROOM_HEIGHT; tileY += 1) {
      const row = layer[tileY];
      for (let tileX = 0; tileX < ROOM_WIDTH; tileX += 1) {
        const rawTile = row?.[tileX] ?? -1;
        const { gid, flipX, flipY } = decodeTileDataValue(rawTile);
        if (gid <= 0) {
          continue;
        }

        const x = layout.left + tileX * layout.tileSize;
        const y = layout.top + tileY * layout.tileSize;
        const edgeSize = getTilePreviewEdgeSize(layout.tileSize);
        const sideSize = getTilePreviewSideSize(layout.tileSize);
        const customTile = getCustomRoomTileDefinitionForGid(snapshot, gid);
        if (customTile) {
          const alpha = layerName === 'background'
            ? 0.5
            : layerName === 'foreground'
              ? 0.78
              : 1;
          drawCustomRoomTilePreview(canvas, customTile, x, y, layout.tileSize, alpha, flipX, flipY);
          if (layerName === 'terrain') {
            const collision = getCustomRoomTileCollisionProfile(snapshot, gid);
            if (collision?.hasCollision) {
              blendRect(canvas, x, y, layout.tileSize, edgeSize, 0xffffff, 0.18);
              blendRect(canvas, x, y + layout.tileSize - edgeSize, layout.tileSize, edgeSize, 0x000000, 0.22);
              blendRect(canvas, x, y, sideSize, layout.tileSize, 0x000000, 0.16);
              blendRect(canvas, x + layout.tileSize - sideSize, y, sideSize, layout.tileSize, 0x000000, 0.22);
            }
          }
          continue;
        }

        const color = getTileColor(gid, tileX, tileY);

        if (layerName === 'background') {
          const inset = getTilePreviewInset(layout.tileSize, 4);
          blendRect(canvas, x + inset, y + inset, layout.tileSize - inset * 2, layout.tileSize - inset * 2, color, 0.45);
          continue;
        }

        if (layerName === 'foreground') {
          const inset = getTilePreviewInset(layout.tileSize, 2);
          blendRect(canvas, x + inset, y + inset, layout.tileSize - inset * 2, layout.tileSize - inset * 2, lighten(color, 0.18), 0.74);
          drawBorder(canvas, x + inset, y + inset, layout.tileSize - inset * 2, layout.tileSize - inset * 2, darken(color, 0.28));
          continue;
        }

        const collision = getTerrainCollisionProfileForGid(gid);
        fillRect(canvas, x, y, layout.tileSize, layout.tileSize, color);
        fillRect(canvas, x, y, layout.tileSize, edgeSize, lighten(color, collision.hasCollision ? 0.22 : 0.1));
        fillRect(canvas, x, y + layout.tileSize - edgeSize, layout.tileSize, edgeSize, darken(color, 0.24));
        fillRect(canvas, x, y, sideSize, layout.tileSize, darken(color, 0.18));
        fillRect(canvas, x + layout.tileSize - sideSize, y, sideSize, layout.tileSize, darken(color, 0.3));
      }
    }
  }
}

function drawCustomRoomTilePreview(
  canvas: ShareCanvas,
  tile: CustomRoomTileDefinition,
  x: number,
  y: number,
  size: number,
  alpha: number,
  flipX: boolean,
  flipY: boolean,
): void {
  for (let sourceY = 0; sourceY < TILE_SIZE; sourceY += 1) {
    for (let sourceX = 0; sourceX < TILE_SIZE; sourceX += 1) {
      const sourceIndex = sourceY * TILE_SIZE + sourceX;
      const color = tile.pixels[sourceIndex];
      if (!color) {
        continue;
      }

      const destCellX = flipX ? TILE_SIZE - 1 - sourceX : sourceX;
      const destCellY = flipY ? TILE_SIZE - 1 - sourceY : sourceY;
      const left = x + Math.floor((destCellX * size) / TILE_SIZE);
      const top = y + Math.floor((destCellY * size) / TILE_SIZE);
      const right = x + Math.ceil(((destCellX + 1) * size) / TILE_SIZE);
      const bottom = y + Math.ceil(((destCellY + 1) * size) / TILE_SIZE);
      const width = Math.max(1, right - left);
      const height = Math.max(1, bottom - top);
      const numericColor = hexToNumber(color);

      if (alpha >= 1) {
        fillRect(canvas, left, top, width, height, numericColor);
      } else {
        blendRect(canvas, left, top, width, height, numericColor, alpha);
      }
    }
  }
}

function drawObjects(canvas: ShareCanvas, snapshot: RoomSnapshot, layout: RoomPreviewLayout): void {
  const scale = layout.tileSize / TILE_SIZE;

  for (const placed of snapshot.placedObjects) {
    if (getPlacedObjectLayer(placed) === 'background') {
      continue;
    }

    const config = getObjectById(placed.id);
    if (!config) {
      continue;
    }

    const width = Math.max(10, Math.round(config.frameWidth * scale));
    const height = Math.max(10, Math.round(config.frameHeight * scale));
    const centerX = layout.left + Math.round((placed.x / TILE_SIZE) * layout.tileSize);
    const centerY = layout.top + Math.round((placed.y / TILE_SIZE) * layout.tileSize);
    const x = centerX - Math.floor(width / 2);
    const y = centerY - Math.floor(height / 2);

    switch (config.category) {
      case 'collectible':
        drawDiamond(canvas, centerX, centerY, Math.max(7, Math.floor(Math.min(width, height) * 0.42)), 0xffd447);
        drawDiamond(canvas, centerX, centerY - 2, Math.max(3, Math.floor(Math.min(width, height) * 0.18)), 0xfff3a4);
        break;
      case 'hazard':
        drawTriangle(canvas, centerX, y, x, y + height, x + width, y + height, 0xff5d4d);
        drawTriangle(canvas, centerX, y + 6, x + 6, y + height - 4, x + width - 6, y + height - 4, 0xffb15a);
        break;
      case 'enemy':
        fillEllipse(canvas, centerX, centerY, Math.max(8, Math.floor(width * 0.45)), Math.max(7, Math.floor(height * 0.38)), 0x4fd1c5);
        fillRect(canvas, centerX - 5, centerY - 4, 4, 4, 0x07111c);
        fillRect(canvas, centerX + 3, centerY - 4, 4, 4, 0x07111c);
        break;
      case 'interactive':
        drawInteractiveObject(canvas, placed.id, x, y, width, height, centerX, centerY);
        break;
      case 'platform':
        fillRect(canvas, x, y, width, height, 0x9a6b44);
        fillRect(canvas, x, y, width, 5, 0xd6a268);
        drawBorder(canvas, x, y, width, height, 0x4b2d1f);
        break;
      case 'decoration':
      default:
        drawDecoration(canvas, placed.id, x, y, width, height, centerX, centerY);
        break;
    }
  }
}

function drawInteractiveObject(
  canvas: ShareCanvas,
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
): void {
  if (id === 'flag') {
    fillRect(canvas, centerX - 2, y, 5, height, 0xf5f1de);
    fillRect(canvas, centerX + 3, y + 2, Math.max(12, Math.floor(width * 0.7)), Math.max(12, Math.floor(height * 0.42)), 0x5dc16b);
    return;
  }

  if (id === 'ladder') {
    fillRect(canvas, x + Math.floor(width * 0.2), y, 4, height, 0xd7ac63);
    fillRect(canvas, x + Math.floor(width * 0.75), y, 4, height, 0xd7ac63);
    for (let rungY = y + 8; rungY < y + height - 4; rungY += 12) {
      fillRect(canvas, x + Math.floor(width * 0.2), rungY, Math.floor(width * 0.6), 4, 0xf0c06b);
    }
    return;
  }

  if (id.includes('door')) {
    fillRect(canvas, x, y, width, height, 0x3d4a5c);
    fillRect(canvas, x + 5, y + 5, width - 10, height - 10, 0x6f7f96);
    fillRect(canvas, x + width - 9, centerY, 5, 5, 0xffd447);
    return;
  }

  if (id === 'spawn_point') {
    drawDiamond(canvas, centerX, centerY, Math.max(9, Math.floor(Math.min(width, height) * 0.38)), 0x7fd4ff);
    return;
  }

  fillRect(canvas, x, y, width, height, 0x63d6cb);
  fillRect(canvas, x + 4, y + 4, width - 8, Math.max(4, height - 8), 0xf5f1de);
}

function drawDecoration(
  canvas: ShareCanvas,
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
): void {
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

  fillEllipse(canvas, centerX, centerY, Math.max(8, Math.floor(width * 0.42)), Math.max(6, Math.floor(height * 0.3)), 0x5dc16b);
}

function drawHorizonSteps(canvas: ShareCanvas, farColor: number, nearColor: number, seedText: string): void {
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

function drawStars(canvas: ShareCanvas, seedText: string): void {
  let seed = hashString(seedText);
  for (let index = 0; index < 180; index += 1) {
    seed = nextSeed(seed);
    const x = seed % canvas.width;
    seed = nextSeed(seed);
    const y = seed % canvas.height;
    seed = nextSeed(seed);
    const size = 1 + (seed % 3);
    blendRect(canvas, x, y, size, size, 0xf5f1de, 0.5 + (seed % 40) / 100);
  }
}

function fillChecker(
  canvas: ShareCanvas,
  x: number,
  y: number,
  width: number,
  height: number,
  size: number,
  colorA: number,
  colorB: number,
): void {
  for (let row = y; row < y + height; row += size) {
    for (let col = x; col < x + width; col += size) {
      const color = ((Math.floor((col - x) / size) + Math.floor((row - y) / size)) % 2 === 0)
        ? colorA
        : colorB;
      fillRect(canvas, col, row, size, size, color);
    }
  }
}

function getTileColor(gid: number, tileX: number, tileY: number): number {
  const tileset = getTilesetByGid(gid);
  const theme = tileset?.uiTheme ?? FALLBACK_THEME;
  const localIndex = tileset ? gid - tileset.firstGid : gid;
  const palette = [
    theme.accentWarm,
    theme.accentCool,
    theme.accentAlt,
    theme.accentHot,
  ];
  const base = palette[Math.abs(localIndex + tileX * 3 + tileY * 5) % palette.length];
  const variation = ((localIndex + tileX + tileY) % 5) - 2;
  return variation >= 0 ? lighten(base, variation * 0.04) : darken(base, Math.abs(variation) * 0.05);
}

function fillRect(canvas: ShareCanvas, x: number, y: number, width: number, height: number, color: number): void {
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

function blendRect(
  canvas: ShareCanvas,
  x: number,
  y: number,
  width: number,
  height: number,
  color: number,
  alpha: number,
): void {
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

function drawBorder(canvas: ShareCanvas, x: number, y: number, width: number, height: number, color: number): void {
  fillRect(canvas, x, y, width, 3, color);
  fillRect(canvas, x, y + height - 3, width, 3, color);
  fillRect(canvas, x, y, 3, height, color);
  fillRect(canvas, x + width - 3, y, 3, height, color);
}

function drawDiamond(canvas: ShareCanvas, centerX: number, centerY: number, radius: number, color: number): void {
  for (let dy = -radius; dy <= radius; dy += 1) {
    const halfWidth = radius - Math.abs(dy);
    fillRect(canvas, centerX - halfWidth, centerY + dy, halfWidth * 2 + 1, 1, color);
  }
}

function drawTriangle(
  canvas: ShareCanvas,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  color: number,
): void {
  const minY = Math.floor(Math.min(ay, by, cy));
  const maxY = Math.ceil(Math.max(ay, by, cy));

  for (let y = minY; y <= maxY; y += 1) {
    const intersections: number[] = [];
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

function collectEdgeIntersection(
  intersections: number[],
  scanY: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): void {
  if ((scanY < ay && scanY < by) || (scanY > ay && scanY > by) || ay === by) {
    return;
  }

  const t = (scanY - ay) / (by - ay);
  if (t < 0 || t > 1) {
    return;
  }

  intersections.push(ax + (bx - ax) * t);
}

function fillEllipse(
  canvas: ShareCanvas,
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  color: number,
): void {
  const safeRadiusX = Math.max(1, radiusX);
  const safeRadiusY = Math.max(1, radiusY);
  for (let dy = -safeRadiusY; dy <= safeRadiusY; dy += 1) {
    const normalizedY = dy / safeRadiusY;
    const halfWidth = Math.floor(safeRadiusX * Math.sqrt(Math.max(0, 1 - normalizedY * normalizedY)));
    fillRect(canvas, centerX - halfWidth, centerY + dy, halfWidth * 2 + 1, 1, color);
  }
}

function numberToRgb(color: number): RgbColor {
  return {
    r: (color >> 16) & 0xff,
    g: (color >> 8) & 0xff,
    b: color & 0xff,
  };
}

function rgbToNumber(color: RgbColor): number {
  return ((color.r & 0xff) << 16) | ((color.g & 0xff) << 8) | (color.b & 0xff);
}

function hexToNumber(value: string): number {
  const normalized = value.replace(/^#/, '').trim();
  return Number.parseInt(normalized || '000000', 16) & 0xffffff;
}

function lighten(color: number, amount: number): number {
  const rgb = numberToRgb(color);
  return rgbToNumber({
    r: Math.round(rgb.r + (255 - rgb.r) * amount),
    g: Math.round(rgb.g + (255 - rgb.g) * amount),
    b: Math.round(rgb.b + (255 - rgb.b) * amount),
  });
}

function darken(color: number, amount: number): number {
  const rgb = numberToRgb(color);
  return rgbToNumber({
    r: Math.round(rgb.r * (1 - amount)),
    g: Math.round(rgb.g * (1 - amount)),
    b: Math.round(rgb.b * (1 - amount)),
  });
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function nextSeed(seed: number): number {
  return (Math.imul(seed, 1664525) + 1013904223) >>> 0;
}

function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
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

function createIhdrData(width: number, height: number): Uint8Array {
  const data = new Uint8Array(13);
  writeUint32(data, 0, width);
  writeUint32(data, 4, height);
  data[8] = 8;
  data[9] = 6;
  data[10] = 0;
  data[11] = 0;
  data[12] = 0;
  return data;
}

function createPngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = asciiBytes(type);
  const chunk = new Uint8Array(12 + data.length);
  writeUint32(chunk, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  writeUint32(chunk, 8 + data.length, crc32(typeBytes, data));
  return chunk;
}

function createZlibUncompressedBlockStream(data: Uint8Array): Uint8Array {
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

function asciiBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index) & 0xff;
  }
  return bytes;
}

function concatUint8Arrays(parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function writeUint32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function crc32(typeBytes: Uint8Array, data: Uint8Array): number {
  let crc = 0xffffffff;
  crc = updateCrc32(crc, typeBytes);
  crc = updateCrc32(crc, data);
  return (crc ^ 0xffffffff) >>> 0;
}

function updateCrc32(initial: number, data: Uint8Array): number {
  let crc = initial;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return crc >>> 0;
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

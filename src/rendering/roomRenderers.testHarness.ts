import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import { vi } from 'vitest';
import { TILE_FLIP_X_FLAG, TILE_FLIP_Y_FLAG, TILE_SIZE } from '../config';
import { renderExpandedRoomSharePreviewPng, renderRoomSharePreviewPng as renderApiSharePreviewPng } from '../cloudflare/worker/share/roomPreviewImage';
import type { CustomRoomTileDefinition } from '../customTiles/model';
import type { CustomSpriteDefinition } from '../customSprites/model';
import { renderRoomSnapshotToCanvas, type MintedRoomRenderOptions } from '../mint/roomMetadataRender';
import type { PagesWorkerEnv } from '../pages/model';
import { decodePng } from '../pages/roomImagePrimitives';
import { renderRoomSharePreviewPng as renderPagesSharePreviewPng } from '../pages/roomImageRenderer';
import type { PublishedRoomSnapshot } from '../pages/shareMetadata';
import { createDefaultRoomSnapshot, type RoomCoordinates, type RoomSnapshot } from '../persistence/roomModel';

/**
 * Test kit for the room-image renderers (F484): fixture rooms (the feature room below and the
 * smart-autotiling reference rooms), a way to run each renderer in vitest, and pixel helpers.
 *
 * - API Worker card (cloudflare/worker/share/roomPreviewImage.ts): abstract shapes, 1200x630.
 * - Pages card (pages/roomImageRenderer.ts): real art from public/, 1200x630.
 * - World-tile leaf (world-tile-render.ts over mint/roomMetadataRender.ts): real art at 16 px per
 *   tile plus a 1 px gutter, 642x354. Production runs it in Chrome through Browser Rendering, so here
 *   it draws into SoftwareCanvas, a small model of the 2D canvas: nearest-neighbour drawImage and
 *   fillRect that fills pixels whose centre is inside the rectangle. Its output is the draw calls the
 *   renderer makes, not Chrome's exact rasterisation. The game's own room texture
 *   (visuals/roomSnapshotTexture.ts) draws into it too.
 */

export interface Raster {
  width: number;
  height: number;
  pixels: Uint8Array;
}

export type Rgba = [number, number, number, number];

/** Where both 1200x630 cards put the room: 27 px per tile from (60, 18). */
export const CARD_ROOM = { left: 60, top: 18, tilePixelSize: 27 } as const;

// ── Fixture rooms ──

export function loadReferenceRoom(name: string): RoomSnapshot {
  return JSON.parse(readFileSync(`test/fixtures/smart-autotiling/references/${name}.room.json`, 'utf8')).snapshot as RoomSnapshot;
}

/** Room-pixel centre of a tile column or row, where tile-sized objects sit. */
const tileCentre = (tile: number): number => tile * TILE_SIZE + TILE_SIZE / 2;

/** Tile cells and object positions in the feature room, for assertions. */
export const FEATURE_ROOM = {
  id: 'feature-room',
  coordinates: { x: 3, y: -2 },
  groundRow: 19,
  /** Tileset tiles: plain, flipped X, flipped Y and both, on the terrain layer. */
  flippedTiles: { row: 15, columns: [4, 5, 6, 7], gid: 87 },
  backgroundTile: { x: 9, y: 15, gid: 83 },
  foregroundTile: { x: 10, y: 15, gid: 157 },
  /** Custom tile gid 10000 (no collision) plain, flipped X and flipped Y; gid 10001 is solid. */
  customTiles: { row: 12, columns: [12, 13, 14], solidColumn: 15 },
  customTileOnBackground: { x: 16, y: 12 },
  customTileOnForeground: { x: 17, y: 12 },
  customSprite: { id: 'feature-sprite', x: tileCentre(20), y: tileCentre(12) },
  /** Background-layer tree with displayScale 0.5 and displayOffset (-48, 73). */
  tree: { id: 'tree_pack_oak_05', x: 480, y: 256 },
  /** Jimothy faces right in its art, so facing left draws it mirrored. */
  npc: { id: 'jimothy', x: 416, y: 304 },
  plainObjects: [
    { id: 'coin_gold', x: tileCentre(3), y: tileCentre(17), layer: 'terrain' },
    { id: 'lost_song', x: tileCentre(5), y: tileCentre(17), layer: 'foreground' },
    { id: 'spawn_point', x: tileCentre(1), y: 288, layer: 'terrain' },
    { id: 'ladder', x: tileCentre(8), y: 256, layer: 'terrain' },
    { id: 'door_locked', x: 544, y: 280, layer: 'terrain' },
    { id: 'flag', x: 592, y: 304, layer: 'terrain' },
  ],
} as const;

const CUSTOM_TILE_RED = '#e04040';
const CUSTOM_TILE_GREEN = '#40c060';
const CUSTOM_TILE_BLUE = '#4060e0';

/** 16x16 custom tile: red left half, green right half, a blue corner, a transparent bottom strip. */
export function customTilePixel(x: number, y: number): string | null {
  if (y >= 13) return null;
  if (x < 4 && y < 4) return CUSTOM_TILE_BLUE;
  return x < 8 ? CUSTOM_TILE_RED : CUSTOM_TILE_GREEN;
}

/** 16x16 custom sprite: a yellow L with a magenta dot, transparent elsewhere. */
function customSpritePixel(x: number, y: number): string | null {
  if (x >= 2 && x < 5 && y >= 2 && y < 14) return '#f0d020';
  if (y >= 11 && y < 14 && x >= 2 && x < 12) return '#f0d020';
  if (x >= 9 && x < 12 && y >= 3 && y < 6) return '#d030c0';
  return null;
}

const pixelGrid = (pixel: (x: number, y: number) => string | null): Array<string | null> => (
  Array.from({ length: TILE_SIZE * TILE_SIZE }, (_, index) => pixel(index % TILE_SIZE, Math.floor(index / TILE_SIZE))));

function customTile(id: string, collision: CustomRoomTileDefinition['collision'], sourceSpriteId: string | null = null): CustomRoomTileDefinition {
  return {
    id, name: id, pixels: pixelGrid(customTilePixel), collision, sourceSpriteId,
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
  };
}

function customSprite(id: string): CustomSpriteDefinition {
  return {
    id, name: id, size: 16, kind: 'decoration', pixels: pixelGrid(customSpritePixel), status: 'active',
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
  };
}

/**
 * One room with every feature the renderers handle: tileset tiles on all three layers with flips,
 * custom tiles (flipped, solid, on each layer), a custom sprite, a scaled and offset background-layer
 * tree, a mirrored NPC, plain objects on terrain and foreground, and markers (spawn point, flag).
 * The default background is 'none' (the starfield). Every object's top-left corner is on a 16 px
 * grid line, as in rooms built in the editor, so its pixels map one to one between 16 and 27 px tiles.
 */
export function buildFeatureRoom(): RoomSnapshot {
  const room = createDefaultRoomSnapshot(FEATURE_ROOM.id, FEATURE_ROOM.coordinates);
  const { terrain, background, foreground } = room.tileData;
  for (let x = 0; x < terrain[0].length; x += 1) {
    terrain[FEATURE_ROOM.groundRow][x] = 88;
    terrain[FEATURE_ROOM.groundRow + 1][x] = 100;
    terrain[FEATURE_ROOM.groundRow + 2][x] = 100;
  }
  const flips = [0, TILE_FLIP_X_FLAG, TILE_FLIP_Y_FLAG, TILE_FLIP_X_FLAG + TILE_FLIP_Y_FLAG];
  FEATURE_ROOM.flippedTiles.columns.forEach((column, index) => {
    terrain[FEATURE_ROOM.flippedTiles.row][column] = FEATURE_ROOM.flippedTiles.gid + flips[index];
  });
  background[FEATURE_ROOM.backgroundTile.y][FEATURE_ROOM.backgroundTile.x] = FEATURE_ROOM.backgroundTile.gid;
  foreground[FEATURE_ROOM.foregroundTile.y][FEATURE_ROOM.foregroundTile.x] = FEATURE_ROOM.foregroundTile.gid;

  room.customTiles = [customTile('feature-tile', 'none'), customTile('feature-tile-solid', 'solid')];
  const [plain, flipX, flipY] = FEATURE_ROOM.customTiles.columns;
  terrain[FEATURE_ROOM.customTiles.row][plain] = 10_000;
  terrain[FEATURE_ROOM.customTiles.row][flipX] = 10_000 + TILE_FLIP_X_FLAG;
  terrain[FEATURE_ROOM.customTiles.row][flipY] = 10_000 + TILE_FLIP_Y_FLAG;
  terrain[FEATURE_ROOM.customTiles.row][FEATURE_ROOM.customTiles.solidColumn] = 10_001;
  background[FEATURE_ROOM.customTileOnBackground.y][FEATURE_ROOM.customTileOnBackground.x] = 10_000;
  foreground[FEATURE_ROOM.customTileOnForeground.y][FEATURE_ROOM.customTileOnForeground.x] = 10_000;

  room.customSprites = [customSprite(FEATURE_ROOM.customSprite.id)];
  room.placedObjects = [
    { id: FEATURE_ROOM.tree.id, x: FEATURE_ROOM.tree.x, y: FEATURE_ROOM.tree.y, instanceId: 'tree', layer: 'background' },
    { id: FEATURE_ROOM.npc.id, x: FEATURE_ROOM.npc.x, y: FEATURE_ROOM.npc.y, instanceId: 'npc', facing: 'left', layer: 'terrain' },
    { id: `custom_sprite:${FEATURE_ROOM.customSprite.id}`, x: FEATURE_ROOM.customSprite.x, y: FEATURE_ROOM.customSprite.y, instanceId: 'sprite', layer: 'terrain' },
    ...FEATURE_ROOM.plainObjects.map((placed) => ({ ...placed, instanceId: placed.id })),
  ];
  return room;
}

/** A copy of a room with only some of its parts, to look at one feature at a time. */
export function roomWith(
  room: RoomSnapshot,
  keep: { tiles?: boolean; customTiles?: boolean; objects?: (id: string) => boolean; background?: string },
): RoomSnapshot {
  const keepTile = (value: number): number => {
    const gid = value % TILE_FLIP_X_FLAG;
    if (value <= 0) return value;
    if (gid >= 10_000) return keep.customTiles ? value : -1;
    return keep.tiles ? value : -1;
  };
  return {
    ...room,
    background: keep.background ?? room.background,
    tileData: {
      background: room.tileData.background.map((row) => row.map(keepTile)),
      terrain: room.tileData.terrain.map((row) => row.map(keepTile)),
      foreground: room.tileData.foreground.map((row) => row.map(keepTile)),
    },
    placedObjects: room.placedObjects.filter((placed) => keep.objects?.(placed.id) ?? false),
  };
}

// ── Renderers ──

/** API Worker share card (link previews for Expanded Rooms and Wamp-O-Grams). */
export async function renderApiCard(snapshot: RoomSnapshot): Promise<Raster> {
  return decodePng(await renderApiSharePreviewPng(snapshot));
}

export async function renderApiExpandedCard(cells: Array<{ snapshot: RoomSnapshot; coordinates: RoomCoordinates }>): Promise<Raster> {
  return decodePng(await renderExpandedRoomSharePreviewPng(cells));
}

const PAGES_URL = new URL('https://wamp.land/r/3/-2/image.png');

/** Serves public/ like the Pages ASSETS binding; the query (?v=…) is not part of the file name. */
const PAGES_ENV: PagesWorkerEnv = {
  ASSETS: {
    fetch: async (request: Request) => {
      const path = `public${decodeURIComponent(new URL(request.url).pathname)}`;
      return existsSync(path) ? new Response(new Uint8Array(readFileSync(path))) : new Response('missing', { status: 404 });
    },
  },
  ROOM_SHARE_API_BASE_URL: 'https://api.example.test',
};

/** Pages share card (link previews for single rooms). */
export async function renderPagesCard(snapshot: RoomSnapshot | PublishedRoomSnapshot): Promise<Raster> {
  const png = await renderPagesSharePreviewPng(new Request(PAGES_URL), PAGES_ENV, PAGES_URL, snapshot as PublishedRoomSnapshot);
  return decodePng(png);
}

/** The canvas renderer (mint/roomMetadataRender) drawn into SoftwareCanvas. Needs installSoftwareBrowser(). */
export async function renderCanvasRoom(snapshot: RoomSnapshot, options: MintedRoomRenderOptions = {}): Promise<Raster> {
  const canvas = await renderRoomSnapshotToCanvas(snapshot, options);
  return (canvas as unknown as SoftwareCanvas).toRaster();
}

/** The world-tile renderer page's leaf render (what the map shows), decoded. Needs installSoftwareBrowser(). */
export async function renderWorldTileLeaf(snapshot: RoomSnapshot): Promise<Raster> {
  await import('../world-tile-render');
  const renderer = window.__WORLD_TILE_RENDERER__;
  if (!renderer) throw new Error('world-tile-render did not install its renderer.');
  const result = await renderer.renderLeaf(snapshot);
  const prefix = 'data:image/png;base64,';
  if (!result.pngDataUrl.startsWith(prefix)) throw new Error('Leaf render did not return a PNG data URL.');
  return decodePng(new Uint8Array(Buffer.from(result.pngDataUrl.slice(prefix.length), 'base64')));
}

// ── Raster helpers ──

export function pixelAt(image: Raster, x: number, y: number): Rgba {
  const offset = (y * image.width + x) * 4;
  return [image.pixels[offset], image.pixels[offset + 1], image.pixels[offset + 2], image.pixels[offset + 3]];
}

export function hexToRgba(hex: string): Rgba {
  const value = Number.parseInt(hex.replace(/^#/, ''), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff, 255];
}

export function pixelHash(image: Raster): string {
  return createHash('sha256').update(image.pixels).digest('hex');
}

export function crop(image: Raster, left: number, top: number, width: number, height: number): Raster {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const start = ((top + y) * image.width + left) * 4;
    pixels.set(image.pixels.subarray(start, start + width * 4), y * width * 4);
  }
  return { width, height, pixels };
}

/**
 * Reads a card's room at one pixel per room pixel (640x352). Room pixel u covers card pixels
 * from floor(u * s) to floor((u + 1) * s) at s = 27/16; the last of them is inside the span for
 * nearest-neighbour scaling and for the per-pixel rectangles custom art is drawn with, and never on
 * a nearest-neighbour tie, so both kinds of scaling read back the same room pixel.
 */
export function sampleRoomGrid(card: Raster, roomWidth = 640, roomHeight = 352): Raster {
  const scale = CARD_ROOM.tilePixelSize / TILE_SIZE;
  const grid: Raster = { width: roomWidth, height: roomHeight, pixels: new Uint8Array(roomWidth * roomHeight * 4) };
  for (let v = 0; v < roomHeight; v += 1) {
    const y = CARD_ROOM.top + Math.floor((v + 1) * scale) - 1;
    for (let u = 0; u < roomWidth; u += 1) {
      const x = CARD_ROOM.left + Math.floor((u + 1) * scale) - 1;
      const from = (y * card.width + x) * 4;
      grid.pixels.set(card.pixels.subarray(from, from + 4), (v * roomWidth + u) * 4);
    }
  }
  return grid;
}

/** `over` drawn on `under` (source-over), as a renderer drawing that layer would. */
export function composite(under: Raster, over: Raster): Raster {
  const result: Raster = { width: under.width, height: under.height, pixels: under.pixels.slice() };
  for (let offset = 0; offset < over.pixels.length; offset += 4) {
    blendPixel(result.pixels, offset, over.pixels[offset], over.pixels[offset + 1], over.pixels[offset + 2], over.pixels[offset + 3] / 255);
  }
  return result;
}

export interface RasterDiff {
  count: number;
  bounds: { left: number; top: number; right: number; bottom: number } | null;
  first: Array<{ x: number; y: number; left: Rgba; right: Rgba }>;
}

/** Pixels that differ by more than `tolerance` in any channel. */
export function diffRasters(left: Raster, right: Raster, tolerance = 0): RasterDiff {
  if (left.width !== right.width || left.height !== right.height) {
    throw new Error(`Cannot compare ${left.width}x${left.height} with ${right.width}x${right.height}.`);
  }
  const result: RasterDiff = { count: 0, bounds: null, first: [] };
  for (let y = 0; y < left.height; y += 1) {
    for (let x = 0; x < left.width; x += 1) {
      const offset = (y * left.width + x) * 4;
      let differs = false;
      for (let channel = 0; channel < 4; channel += 1) {
        if (Math.abs(left.pixels[offset + channel] - right.pixels[offset + channel]) > tolerance) differs = true;
      }
      if (!differs) continue;
      result.count += 1;
      const bounds = result.bounds ?? { left: x, top: y, right: x, bottom: y };
      result.bounds = {
        left: Math.min(bounds.left, x), top: Math.min(bounds.top, y),
        right: Math.max(bounds.right, x), bottom: Math.max(bounds.bottom, y),
      };
      if (result.first.length < 5) result.first.push({ x, y, left: pixelAt(left, x, y), right: pixelAt(right, x, y) });
    }
  }
  return result;
}

/** Bounding box of the pixels where two renders of the same canvas differ, or null. */
export function changedBounds(before: Raster, after: Raster): RasterDiff['bounds'] {
  return diffRasters(before, after).bounds;
}

// ── SoftwareCanvas: the parts of the browser 2D canvas the canvas renderer uses ──

function blendPixel(pixels: Uint8Array, offset: number, red: number, green: number, blue: number, alpha: number): void {
  if (alpha <= 0) return;
  if (alpha >= 1) {
    pixels[offset] = red;
    pixels[offset + 1] = green;
    pixels[offset + 2] = blue;
    pixels[offset + 3] = 255;
    return;
  }
  const destinationAlpha = pixels[offset + 3] / 255;
  const outputAlpha = alpha + destinationAlpha * (1 - alpha);
  const mix = (source: number, destination: number): number => Math.round(
    (source * alpha + destination * destinationAlpha * (1 - alpha)) / outputAlpha);
  pixels[offset] = mix(red, pixels[offset]);
  pixels[offset + 1] = mix(green, pixels[offset + 1]);
  pixels[offset + 2] = mix(blue, pixels[offset + 2]);
  pixels[offset + 3] = Math.round(outputAlpha * 255);
}

function parseCssColor(value: string): Rgba {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].replace(/./g, '$&$&') : hex[1];
    return hexToRgba(digits);
  }
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(value.trim());
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Math.round(Number(rgba[4] ?? 1) * 255)];
  throw new Error(`SoftwareCanvas cannot parse the colour ${value}.`);
}

interface DeviceRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface DrawState {
  fillStyle: string;
  globalAlpha: number;
  imageSmoothingEnabled: boolean;
  matrix: { a: number; d: number; e: number; f: number };
  clip: DeviceRect | null;
}

interface RasterSource {
  readonly width: number;
  readonly height: number;
  readRaster(): Raster | null;
}

class SoftwareContext2D {
  fillStyle = '#000000';
  globalAlpha = 1;
  imageSmoothingEnabled = true;
  /** Only translate and scale are used, so x' = a x + e and y' = d y + f. */
  private matrix = { a: 1, d: 1, e: 0, f: 0 };
  /** Only axis-aligned rectangles are used as clip paths. */
  private clipRect: DeviceRect | null = null;
  private pathRect: DeviceRect | null = null;
  private readonly stack: DrawState[] = [];

  constructor(private readonly canvas: SoftwareCanvas) {}

  save(): void {
    this.stack.push({
      fillStyle: this.fillStyle, globalAlpha: this.globalAlpha,
      imageSmoothingEnabled: this.imageSmoothingEnabled, matrix: { ...this.matrix }, clip: this.clipRect,
    });
  }

  restore(): void {
    const state = this.stack.pop();
    if (!state) return;
    this.fillStyle = state.fillStyle;
    this.globalAlpha = state.globalAlpha;
    this.imageSmoothingEnabled = state.imageSmoothingEnabled;
    this.matrix = state.matrix;
    this.clipRect = state.clip;
  }

  beginPath(): void {
    this.pathRect = null;
  }

  rect(x: number, y: number, width: number, height: number): void {
    this.pathRect = this.toDeviceRect(x, y, width, height);
  }

  clip(): void {
    const path = this.pathRect ?? { left: 0, top: 0, right: 0, bottom: 0 };
    const current = this.clipRect;
    this.clipRect = current
      ? {
        left: Math.max(current.left, path.left), top: Math.max(current.top, path.top),
        right: Math.min(current.right, path.right), bottom: Math.min(current.bottom, path.bottom),
      }
      : path;
  }

  translate(x: number, y: number): void {
    this.matrix.e += this.matrix.a * x;
    this.matrix.f += this.matrix.d * y;
  }

  scale(x: number, y: number): void {
    this.matrix.a *= x;
    this.matrix.d *= y;
  }

  clearRect(x: number, y: number, width: number, height: number): void {
    const { pixels } = this.canvas.readRaster();
    this.forEachCoveredPixel(x, y, width, height, (offset) => pixels.fill(0, offset, offset + 4));
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    const [red, green, blue, alpha] = parseCssColor(this.fillStyle);
    const { pixels } = this.canvas.readRaster();
    const coverage = (alpha / 255) * this.globalAlpha;
    this.forEachCoveredPixel(x, y, width, height, (offset) => blendPixel(pixels, offset, red, green, blue, coverage));
  }

  drawImage(image: RasterSource, ...args: number[]): void {
    const source = image.readRaster();
    if (!source) return;
    const [sx, sy, sw, sh, dx, dy, dw, dh] = args.length === 2
      ? [0, 0, source.width, source.height, args[0], args[1], source.width, source.height]
      : args.length === 4
        ? [0, 0, source.width, source.height, ...args]
        : args;
    if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;
    const { pixels } = this.canvas.readRaster();
    const { a, d, e, f } = this.matrix;
    this.forEachCoveredPixel(dx, dy, dw, dh, (offset, px, py) => {
      const userX = (px + 0.5 - e) / a;
      const userY = (py + 0.5 - f) / d;
      const sourceX = Math.min(Math.min(sx + sw, source.width) - 1, Math.max(sx, Math.floor(sx + ((userX - dx) / dw) * sw)));
      const sourceY = Math.min(Math.min(sy + sh, source.height) - 1, Math.max(sy, Math.floor(sy + ((userY - dy) / dh) * sh)));
      const from = (sourceY * source.width + sourceX) * 4;
      blendPixel(pixels, offset, source.pixels[from], source.pixels[from + 1], source.pixels[from + 2],
        (source.pixels[from + 3] / 255) * this.globalAlpha);
    });
  }

  /** The device pixels (half-open) whose centre lies inside the transformed rectangle. */
  private toDeviceRect(x: number, y: number, width: number, height: number): DeviceRect {
    const { a, d, e, f } = this.matrix;
    const xs = [a * x + e, a * (x + width) + e];
    const ys = [d * y + f, d * (y + height) + f];
    return {
      left: Math.ceil(Math.min(...xs) - 0.5), right: Math.ceil(Math.max(...xs) - 0.5),
      top: Math.ceil(Math.min(...ys) - 0.5), bottom: Math.ceil(Math.max(...ys) - 0.5),
    };
  }

  private forEachCoveredPixel(
    x: number, y: number, width: number, height: number,
    visit: (offset: number, px: number, py: number) => void,
  ): void {
    const raster = this.canvas.readRaster();
    const rect = this.toDeviceRect(x, y, width, height);
    const clip = this.clipRect ?? { left: 0, top: 0, right: raster.width, bottom: raster.height };
    const left = Math.max(0, clip.left, rect.left);
    const right = Math.min(raster.width, clip.right, rect.right);
    const top = Math.max(0, clip.top, rect.top);
    const bottom = Math.min(raster.height, clip.bottom, rect.bottom);
    for (let py = top; py < bottom; py += 1) {
      for (let px = left; px < right; px += 1) visit((py * raster.width + px) * 4, px, py);
    }
  }
}

export class SoftwareCanvas implements RasterSource {
  private raster: Raster = { width: 300, height: 150, pixels: new Uint8Array(300 * 150 * 4) };
  private context: SoftwareContext2D | null = null;

  get width(): number { return this.raster.width; }
  set width(value: number) { this.resize(value, this.raster.height); }
  get height(): number { return this.raster.height; }
  set height(value: number) { this.resize(this.raster.width, value); }

  getContext(kind: string): SoftwareContext2D | null {
    if (kind !== '2d') return null;
    this.context ??= new SoftwareContext2D(this);
    return this.context;
  }

  readRaster(): Raster {
    return this.raster;
  }

  toRaster(): Raster {
    return { width: this.raster.width, height: this.raster.height, pixels: this.raster.pixels.slice() };
  }

  toDataURL(type = 'image/png'): string {
    if (type !== 'image/png') throw new Error(`SoftwareCanvas encodes PNG only, not ${type}.`);
    return `data:image/png;base64,${encodePngSync(this.raster).toString('base64')}`;
  }

  /** Setting either dimension clears the canvas, as in a browser. */
  private resize(width: number, height: number): void {
    this.raster = { width, height, pixels: new Uint8Array(width * height * 4) };
  }
}

function encodePngSync(raster: Raster): Buffer {
  const rowLength = raster.width * 4 + 1;
  const scanlines = Buffer.alloc(rowLength * raster.height);
  for (let y = 0; y < raster.height; y += 1) {
    scanlines.set(raster.pixels.subarray(y * raster.width * 4, (y + 1) * raster.width * 4), y * rowLength + 1);
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(raster.width, 0);
  header.writeUInt32BE(raster.height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(scanlines)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** An <img> that loads from public/ (paths) or base64 PNG data URLs, decoded with the repo's decodePng. */
class SoftwareImage implements RasterSource {
  crossOrigin: string | null = null;
  decoding = 'auto';
  onload: (() => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  width = 0;
  height = 0;
  naturalWidth = 0;
  naturalHeight = 0;
  private raster: Raster | null = null;
  private source = '';
  private loading: Promise<void> = Promise.resolve();

  get src(): string { return this.source; }
  set src(value: string) {
    this.source = value;
    this.loading = this.load(value);
  }

  decode(): Promise<void> {
    return this.loading;
  }

  readRaster(): Raster | null {
    return this.raster;
  }

  private async load(value: string): Promise<void> {
    try {
      const raster = await decodePng(readImageBytes(value));
      this.raster = raster;
      this.width = this.naturalWidth = raster.width;
      this.height = this.naturalHeight = raster.height;
      this.onload?.();
    } catch (error) {
      this.onerror?.(error);
    }
  }
}

/** A loaded <img> of a public/ asset, for fake texture managers. */
export async function loadSoftwareImage(path: string): Promise<SoftwareImage> {
  const image = new SoftwareImage();
  image.src = path;
  await image.decode();
  if (!image.readRaster()) throw new Error(`Could not load ${path}.`);
  return image;
}

function readImageBytes(source: string): Uint8Array {
  const dataPrefix = 'data:image/png;base64,';
  if (source.startsWith(dataPrefix)) return new Uint8Array(Buffer.from(source.slice(dataPrefix.length), 'base64'));
  if (/^[a-z]+:/i.test(source)) throw new Error(`SoftwareImage only loads public/ files, not ${source}.`);
  const path = `public/${decodeURIComponent(source.split(/[?#]/)[0]).replace(/^\/+/, '')}`;
  if (!existsSync(path)) throw new Error(`Missing asset ${path}.`);
  return new Uint8Array(readFileSync(path));
}

/** Gives the canvas renderer a document, Image and window; undo with vi.unstubAllGlobals(). */
export function installSoftwareBrowser(): void {
  vi.stubGlobal('document', {
    createElement: (tag: string) => {
      if (tag !== 'canvas') throw new Error(`SoftwareCanvas cannot create <${tag}>.`);
      return new SoftwareCanvas();
    },
    getElementById: () => null,
    querySelector: () => null,
  });
  vi.stubGlobal('Image', SoftwareImage);
  vi.stubGlobal('window', { location: new URL('https://wamp.land/') });
}

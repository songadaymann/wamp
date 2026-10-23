import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Math: { Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)) },
    Textures: { FilterMode: { NEAREST: 0 } },
  },
}));

import { getSceneObjectTexture } from '../assets/sceneArt';
import treeAtlases from '../assets/treeAtlasManifest.json';
import { decodeTileDataValue, getBackgroundGroup, getObjectById, getTilesetByGid, ROOM_PX_HEIGHT, ROOM_PX_WIDTH, TILE_SIZE } from '../config';
import { getRoomMetadataObjectDrawRect } from '../mint/roomMetadataRenderLayout';
import type { RoomSnapshot } from '../persistence/roomModel';
import {
  buildFeatureRoom, diffRasters, FEATURE_ROOM, installSoftwareBrowser, loadReferenceRoom, loadSoftwareImage, pixelAt,
  renderCanvasRoom, roomWith, SoftwareCanvas, type Raster,
} from '../rendering/roomRenderers.testHarness';
import { drawRoomSnapshotToContext } from './roomSnapshotTexture';

/**
 * F484: the game's own room texture (map previews, chunk renders) against the world-tile renderer
 * (mint/roomMetadataRender), both at 16 px per tile into SoftwareCanvas. The client reads Phaser
 * textures, so a fake texture manager serves the same public/ files, and tree atlases with their
 * trimmed frames as Phaser would cut them. See rendering/roomRenderers.equivalence.test.ts for the
 * server-side renderers.
 */

interface AtlasFrame { cutX: number; cutY: number; cutWidth: number; cutHeight: number; x: number; y: number }
interface FakeTexture { source: unknown; frames?: Map<string, AtlasFrame> }

const textures = new Map<string, FakeTexture>();
const scene = {
  textures: {
    exists: (key: string) => textures.has(key),
    get: (key: string) => ({
      getSourceImage: () => textures.get(key)?.source ?? null,
      get: (frame: string) => textures.get(key)?.frames?.get(frame),
    }),
    // ensureCustomSpriteTexture adds each community sprite's canvas here.
    addCanvas: (key: string, canvas: unknown) => {
      textures.set(key, { source: canvas });
      return {};
    },
  },
};

const feature = buildFeatureRoom();
const ROOMS: Array<[string, RoomSnapshot]> = [
  ...['desert-x-7-y-3', 'cave-x-3-y-2', 'cyber-x-10-y10', 'wampos-x-11-y10', 'gothic-x-11-y8', 'backrooms-x-11-y9']
    .map((name): [string, RoomSnapshot] => [name, loadReferenceRoom(name)]),
  ['feature room without its tree', roomWith(feature, { tiles: true, customTiles: true, objects: (id) => id !== FEATURE_ROOM.tree.id })],
];

/** Loads every texture the rooms use, as BootScene and sceneArt would have before a preview. */
async function loadSceneTextures(rooms: readonly RoomSnapshot[]): Promise<void> {
  const loads = new Map<string, () => Promise<FakeTexture>>();
  for (const room of rooms) {
    for (const layer of getBackgroundGroup(room.background)?.layers ?? []) {
      loads.set(layer.key, async () => ({ source: await loadSoftwareImage(layer.path) }));
    }
    for (const value of Object.values(room.tileData).flat(2)) {
      const tileset = getTilesetByGid(decodeTileDataValue(value).gid);
      if (tileset) loads.set(tileset.key, async () => ({ source: await loadSoftwareImage(tileset.path) }));
    }
    for (const placed of room.placedObjects) {
      const config = getObjectById(placed.id);
      if (!config) continue;
      const texture = getSceneObjectTexture(config);
      const atlas = Object.values(treeAtlases).find((candidate) => candidate.key === texture.key);
      loads.set(texture.key, atlas
        ? async () => ({ source: await loadSoftwareImage(atlas.texturePath), frames: readAtlasFrames(atlas.atlasPath) })
        : async () => ({ source: await loadSoftwareImage(config.path) }));
    }
  }
  await Promise.all([...loads].map(async ([key, load]) => textures.set(key, await load())));
}

function readAtlasFrames(path: string): Map<string, AtlasFrame> {
  const atlas = JSON.parse(readFileSync(`public/${path}`, 'utf8')) as {
    frames: Record<string, { frame: { x: number; y: number; w: number; h: number }; spriteSourceSize: { x: number; y: number } }>;
  };
  return new Map(Object.entries(atlas.frames).map(([name, { frame, spriteSourceSize }]) => [name, {
    cutX: frame.x, cutY: frame.y, cutWidth: frame.w, cutHeight: frame.h, x: spriteSourceSize.x, y: spriteSourceSize.y,
  }]));
}

function drawClientTexture(room: RoomSnapshot, includeBackground = true): Raster {
  const canvas = new SoftwareCanvas();
  canvas.width = ROOM_PX_WIDTH;
  canvas.height = ROOM_PX_HEIGHT;
  const context = canvas.getContext('2d')!;
  context.imageSmoothingEnabled = false;
  drawRoomSnapshotToContext(scene as never, context as unknown as CanvasRenderingContext2D, room, TILE_SIZE, { includeBackground });
  return canvas.toRaster();
}

beforeAll(async () => {
  installSoftwareBrowser();
  await loadSceneTextures([...ROOMS.map(([, room]) => room), feature]);
}, 30_000);
afterAll(() => vi.unstubAllGlobals());

describe('client room texture and world-tile renderer draw the same room', { timeout: 30_000 }, () => {
  it.each(ROOMS)('%s, background included', async (_name, room) => {
    const client = drawClientTexture(room);
    const worldTile = await renderCanvasRoom(room, { tilePixelSize: TILE_SIZE });
    expect(diffRasters(client, worldTile).first).toEqual([]);
  });

  // The game draws trees from trimmed atlases (assets:trees:build), the world tile from the full
  // frame. At displayScale 0.5 every pixel centre falls exactly between two source pixels, so which
  // one is drawn is down to rounding (in Chrome too): a few pixels differ between the two. So each
  // is checked on its own: every pixel of the tree must be one of the 2x2 source pixels it covers.
  it('draws the atlas tree at its canonical rect from the right source pixels, like the world tile', async () => {
    const tree = roomWith(feature, { objects: (id) => id === FEATURE_ROOM.tree.id });
    const source = (await loadSoftwareImage(getObjectById(FEATURE_ROOM.tree.id)!.path)).readRaster()!;
    const rect = getRoomMetadataObjectDrawRect({ frameWidth: 192, frameHeight: 240, displayScale: 0.5, displayOffset: { x: -48, y: 73 } }, FEATURE_ROOM.tree, TILE_SIZE);
    const drawings = {
      client: drawClientTexture(tree, false),
      worldTile: await renderCanvasRoom(tree, { tilePixelSize: TILE_SIZE, includeBackground: false }),
    };
    const sourceBounds = changedBoundsFromTransparent(source)!;
    for (const [renderer, drawn] of Object.entries(drawings)) {
      const bounds = changedBoundsFromTransparent(drawn)!;
      expect(bounds.left, renderer).toBeGreaterThanOrEqual(rect.x);
      expect(bounds.top, renderer).toBeGreaterThanOrEqual(rect.y);
      expect(bounds.right, renderer).toBeLessThan(rect.x + rect.width);
      expect(bounds.bottom, renderer).toBeLessThan(rect.y + rect.height);
      expect(bounds.right - bounds.left, renderer).toBeGreaterThanOrEqual(Math.floor((sourceBounds.right - sourceBounds.left) / 2) - 1);
      const wrong: string[] = [];
      for (let y = rect.y; y < Math.min(rect.y + rect.height, ROOM_PX_HEIGHT); y += 1) {
        for (let x = rect.x; x < rect.x + rect.width; x += 1) {
          const block = [0, 1].flatMap((dy) => [0, 1].map((dx) => pixelAt(source, (x - rect.x) * 2 + dx, (y - rect.y) * 2 + dy)));
          const pixel = pixelAt(drawn, x, y);
          const matches = block.some((candidate) => (candidate[3] === 0 ? pixel[3] === 0 : candidate.every((value, channel) => value === pixel[channel])));
          if (!matches) wrong.push(`${x},${y}`);
        }
      }
      expect(wrong.slice(0, 5), renderer).toEqual([]);
    }
  });
});

/** Bounds of what was drawn on a cleared canvas. */
function changedBoundsFromTransparent(image: Raster) {
  return diffRasters({ ...image, pixels: new Uint8Array(image.pixels.length) }, image).bounds;
}

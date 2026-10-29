import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getObjectById, getObjectDisplayOffset, getObjectDisplayScale, ROOM_HEIGHT, ROOM_WIDTH, TILE_SIZE } from '../config';
import { hiddenVersionSnapshot } from '../cloudflare/worker/rooms/versionRedaction';
import { maskBlockedCustomArt } from '../customSprites/blockedArt';
import { BLOCKED_ART_COLOR } from '../customSprites/blocklist';
import { getRoomMetadataObjectDrawRect } from '../mint/roomMetadataRenderLayout';
import { markBlockedCustomSprites } from '../roomImage/roomImageRenderer';
import type { PublishedRoomSnapshot } from '../pages/shareMetadata';
import { createDefaultRoomSnapshot, type RoomSnapshot } from '../persistence/roomModel';
import {
  buildFeatureRoom, CARD_ROOM, changedBounds, composite, crop, diffRasters, FEATURE_ROOM, hexToRgba,
  installSoftwareBrowser, loadReferenceRoom, pixelAt, pixelHash, renderApiCard, renderCanvasRoom, renderPagesCard,
  renderWorldTileLeaf, roomWith, sampleRoomGrid, type Raster, type Rgba,
} from './roomRenderers.testHarness';

/**
 * F484/F269/F389: API and Pages cards share one real-art painter. These comparisons
 * keep their room content aligned with the world-tile/game canvas, including custom
 * pixels, object display scale/offset and moderation. Card-wide backgrounds are
 * intentionally framed differently from a native room image.
 */

const RENDER_TIMEOUT_MS = 30_000;
const REFERENCE_ROOMS = ['desert-x-7-y-3', 'cave-x-3-y-2', 'cyber-x-10-y10', 'wampos-x-11-y10', 'gothic-x-11-y8', 'backrooms-x-11-y9'];
/** Content is compared over one solid colour: backgrounds differ on purpose (card-wide vs room). */
const CONTENT_BACKGROUND = 'solid:#000000';
const STARFIELD = hexToRgba('#050505');

beforeAll(() => installSoftwareBrowser());
afterAll(() => vi.unstubAllGlobals());

/** Each renderer's empty room over CONTENT_BACKGROUND, which is the same for every room id. */
let emptyCards: Promise<{ pages: Raster; api: Raster; canvas: Raster }> | null = null;
function emptyContentCards(): Promise<{ pages: Raster; api: Raster; canvas: Raster }> {
  const empty = roomWith(buildFeatureRoom(), { background: CONTENT_BACKGROUND });
  emptyCards ??= Promise.all([
    renderPagesCard(empty), renderApiCard(empty), renderCanvasRoom(empty, { tilePixelSize: TILE_SIZE }),
  ]).then(([pages, api, canvas]) => ({ pages, api, canvas }));
  return emptyCards;
}

/**
 * The Pages card against the world-tile renderer, one pixel per room pixel. The canvas renderer
 * draws the room's tiles and objects with no background; that layer goes over the Pages card's own
 * empty room, so its frame and background cancel out and only drawing differences remain.
 */
async function pagesVersusWorldTileContent(room: RoomSnapshot): Promise<number> {
  const solid = { ...room, background: CONTENT_BACKGROUND };
  const pages = sampleRoomGrid(await renderPagesCard(solid));
  const content = await renderCanvasRoom(solid, { tilePixelSize: TILE_SIZE, includeBackground: false });
  return diffRasters(pages, composite(sampleRoomGrid((await emptyContentCards()).pages), content)).count;
}

const feature = buildFeatureRoom();
const onlyObjects = (match: (id: string) => boolean): RoomSnapshot => roomWith(feature, { objects: match });
const isTree = (id: string): boolean => id === FEATURE_ROOM.tree.id;
const isCustomSprite = (id: string): boolean => id.startsWith('custom_sprite:');

function mostCommonColour(image: Raster): Rgba {
  const counts = new Map<number, number>();
  for (let offset = 0; offset < image.pixels.length; offset += 4) {
    const key = (image.pixels[offset] << 16) | (image.pixels[offset + 1] << 8) | image.pixels[offset + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const [colour] = [...counts.entries()].reduce((best, entry) => (entry[1] > best[1] ? entry : best));
  return [(colour >> 16) & 0xff, (colour >> 8) & 0xff, colour & 0xff, 255];
}

const near = (left: Rgba, right: Rgba, tolerance: number): boolean => left.every((value, channel) => Math.abs(value - right[channel]) <= tolerance);

/** Room cells ("x,y") where two renders differ, for a room drawn at `tile` px per tile from (left, top). */
function changedCells(before: Raster, after: Raster, tile: number, left: number, top: number): string[] {
  const cells = new Set<string>();
  for (let y = top; y < top + ROOM_HEIGHT * tile; y += 1) {
    for (let x = left; x < left + ROOM_WIDTH * tile; x += 1) {
      const offset = (y * before.width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        if (before.pixels[offset + channel] !== after.pixels[offset + channel]) {
          cells.add(`${Math.floor((x - left) / tile)},${Math.floor((y - top) / tile)}`);
          break;
        }
      }
    }
  }
  return [...cells].sort();
}

/** One 16x16 room cell of a room-grid raster. */
const cell = (grid: Raster, x: number, y: number): Raster => crop(grid, x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);

describe('Pages card and world-tile renderer draw the same room pixels', { timeout: RENDER_TIMEOUT_MS }, () => {
  it.each(REFERENCE_ROOMS)('%s', async (name) => {
    expect(await pagesVersusWorldTileContent(loadReferenceRoom(name))).toBe(0);
  });

  it('feature room: tileset tiles on all three layers, flipped every way', async () => {
    expect(await pagesVersusWorldTileContent(roomWith(feature, { tiles: true }))).toBe(0);
  });

  it('feature room: objects and markers on terrain and foreground, and a mirrored NPC', async () => {
    expect(await pagesVersusWorldTileContent(onlyObjects((id) => !isTree(id) && !isCustomSprite(id)))).toBe(0);
  });

  it('feature room: custom tiles match the world renderer', async () => {
    expect(await pagesVersusWorldTileContent(roomWith(feature, { customTiles: true }))).toBe(0);
  });

  it('feature room: the background-layer tree uses canonical display scale and offset', async () => {
    expect(await pagesVersusWorldTileContent(onlyObjects(isTree))).toBe(0);
  });

  it('feature room: a custom sprite preserves one-pixel transparent gaps', async () => {
    expect(await pagesVersusWorldTileContent(onlyObjects(isCustomSprite))).toBe(0);
  });

  it('feature room: the world-tile renderer draws the default background as the game\'s starfield', async () => {
    const leaf = await renderCanvasRoom(roomWith(feature, {}), { tilePixelSize: TILE_SIZE });
    expect(mostCommonColour(leaf)).toEqual(STARFIELD);
  });

  it('feature room: the Pages card draws the default background as a starfield', async () => {
    const card = await renderPagesCard(roomWith(feature, {}));
    expect(near(mostCommonColour(card), STARFIELD, 24)).toBe(true);
  });
});

describe('world-tile leaf', { timeout: RENDER_TIMEOUT_MS }, () => {
  it('is the canvas renderer at 16 px per tile with a one-pixel gutter copied from its edges', async () => {
    const leaf = await renderWorldTileLeaf(feature);
    const room = await renderCanvasRoom(feature, { tilePixelSize: TILE_SIZE, strictAssets: true });
    expect([leaf.width, leaf.height]).toEqual([642, 354]);
    expect(diffRasters(crop(leaf, 1, 1, 640, 352), room).count).toBe(0);
    expect(diffRasters(crop(leaf, 1, 0, 640, 1), crop(room, 0, 0, 640, 1)).count).toBe(0);
    expect(diffRasters(crop(leaf, 1, 353, 640, 1), crop(room, 0, 351, 640, 1)).count).toBe(0);
    expect(diffRasters(crop(leaf, 0, 1, 1, 352), crop(room, 0, 0, 1, 352)).count).toBe(0);
    expect(diffRasters(crop(leaf, 641, 1, 1, 352), crop(room, 639, 0, 1, 352)).count).toBe(0);
    expect(pixelAt(leaf, 0, 0)).toEqual(pixelAt(room, 0, 0));
    expect(pixelAt(leaf, 641, 353)).toEqual(pixelAt(room, 639, 351));
  });

  it('fails instead of publishing a guess when a room uses an unknown tile or object', async () => {
    const unknownTile = roomWith(feature, {});
    unknownTile.tileData.terrain[0][0] = 9_999;
    await expect(renderWorldTileLeaf(unknownTile)).rejects.toThrow('unknown tile gid 9999');
    const unknownObject = { ...roomWith(feature, {}), placedObjects: [{ id: 'not_an_object', x: 8, y: 8, instanceId: 'x' }] };
    await expect(renderWorldTileLeaf(unknownObject)).rejects.toThrow('unknown object not_an_object');
    const missingSprite = { ...roomWith(feature, {}), placedObjects: [{ id: 'custom_sprite:missing', x: 8, y: 8, instanceId: 'x' }] };
    await expect(renderWorldTileLeaf(missingSprite)).rejects.toThrow('unknown object custom_sprite:missing');
  });
});

describe('API and Pages cards agree with the real-art room renderer', { timeout: RENDER_TIMEOUT_MS }, () => {
  const tilesOnly = { ...roomWith(feature, { tiles: true, customTiles: true }), background: 'solid:#203040' };

  it('has the same card size, room border and solid-colour margin as the Pages card', async () => {
    const [api, pages] = await Promise.all([renderApiCard(tilesOnly), renderPagesCard(tilesOnly)]);
    expect([api.width, api.height]).toEqual([pages.width, pages.height]);
    // The room's frame shading differs on purpose (dark on the API card, faint on the Pages card),
    // so compare the 3 px border at (56, 14) and everything outside the frame at (52, 10).
    const frame = { left: CARD_ROOM.left - 8, top: CARD_ROOM.top - 8, right: CARD_ROOM.left + 1088, bottom: CARD_ROOM.top + 602 };
    const border = { left: CARD_ROOM.left - 4, top: CARD_ROOM.top - 4, right: CARD_ROOM.left + 1084, bottom: CARD_ROOM.top + 598 };
    let compared = 0;
    const differing: string[] = [];
    for (let y = 0; y < api.height; y += 1) {
      for (let x = 0; x < api.width; x += 1) {
        const outsideFrame = x < frame.left || x >= frame.right || y < frame.top || y >= frame.bottom;
        const inBorder = x >= border.left && x < border.right && y >= border.top && y < border.bottom
          && (x < border.left + 3 || x >= border.right - 3 || y < border.top + 3 || y >= border.bottom - 3);
        if (!outsideFrame && !inBorder) continue;
        compared += 1;
        if (!near(pixelAt(api, x, y), pixelAt(pages, x, y), 0)) differing.push(`${x},${y}`);
      }
    }
    expect(compared).toBeGreaterThan(60_000);
    expect(differing.slice(0, 10)).toEqual([]);
    expect(pixelAt(api, 0, 0)).toEqual(hexToRgba('#203040'));
    expect(pixelAt(api, border.left, border.top)).toEqual(hexToRgba('#f5f1de'));
  });

  it.each([['feature room', feature], ['cave', loadReferenceRoom('cave-x-3-y-2')]] as const)(
    '%s: draws tiles in exactly the cells the Pages card and the world-tile renderer do',
    async (_name, room) => {
      const tiles = roomWith(room, { tiles: true, customTiles: true, background: CONTENT_BACKGROUND });
      const empty = await emptyContentCards();
      const card = (image: Raster, base: Raster) => changedCells(base, image, CARD_ROOM.tilePixelSize, CARD_ROOM.left, CARD_ROOM.top);
      const api = card(await renderApiCard(tiles), empty.api);
      const pages = card(await renderPagesCard(tiles), empty.pages);
      const canvas = changedCells(empty.canvas, await renderCanvasRoom(tiles, { tilePixelSize: TILE_SIZE }), TILE_SIZE, 0, 0);
      expect(api.length).toBeGreaterThan(20);
      expect(api).toEqual(canvas);
      expect(pages).toEqual(canvas);
    },
  );

  async function apiVersusWorldTileCustomTileCell(x: number, y: number): Promise<number> {
    const room = { ...roomWith(feature, { customTiles: true }), background: CONTENT_BACKGROUND };
    const api = sampleRoomGrid(await renderApiCard(room));
    const content = await renderCanvasRoom(room, { tilePixelSize: TILE_SIZE, includeBackground: false });
    const expected = composite(sampleRoomGrid((await emptyContentCards()).api), content);
    return diffRasters(cell(api, x, y), cell(expected, x, y)).count;
  }

  it('draws a custom tile\'s pixels like the world-tile renderer', async () => {
    const [column] = FEATURE_ROOM.customTiles.columns;
    expect(await apiVersusWorldTileCustomTileCell(column, FEATURE_ROOM.customTiles.row)).toBe(0);
  });

  it('draws flipped custom tiles like the world-tile renderer', async () => {
    const [, flipX, flipY] = FEATURE_ROOM.customTiles.columns;
    expect(await apiVersusWorldTileCustomTileCell(flipX, FEATURE_ROOM.customTiles.row)).toBe(0);
    expect(await apiVersusWorldTileCustomTileCell(flipY, FEATURE_ROOM.customTiles.row)).toBe(0);
  });

  /** An object's drawing on a card, alone in an empty room, and its canonical rect on the card. */
  async function apiObjectFootprint(id: string) {
    const placed = feature.placedObjects.find((candidate) => candidate.id === id)!;
    const alone = { ...roomWith(feature, { background: CONTENT_BACKGROUND }), placedObjects: [placed] };
    const drawn = changedBounds((await emptyContentCards()).api, await renderApiCard(alone));
    const config = getObjectById(id);
    const rect = config && getRoomMetadataObjectDrawRect({
      frameWidth: config.frameWidth, frameHeight: config.frameHeight,
      displayScale: getObjectDisplayScale(config), displayOffset: getObjectDisplayOffset(config),
    }, placed, CARD_ROOM.tilePixelSize);
    return { drawn, rect: rect && { ...rect, x: rect.x + CARD_ROOM.left, y: rect.y + CARD_ROOM.top } };
  }

  it.each([...FEATURE_ROOM.plainObjects.map((placed) => placed.id), FEATURE_ROOM.npc.id])(
    'centres its %s shape inside the object\'s canonical draw rect',
    async (id) => {
      const { drawn, rect } = await apiObjectFootprint(id);
      expect(drawn).not.toBeNull();
      const centreX = (drawn!.left + drawn!.right) / 2;
      const centreY = (drawn!.top + drawn!.bottom) / 2;
      expect(centreX).toBeGreaterThanOrEqual(rect!.x);
      expect(centreX).toBeLessThan(rect!.x + rect!.width);
      expect(centreY).toBeGreaterThanOrEqual(rect!.y);
      expect(centreY).toBeLessThan(rect!.y + rect!.height);
    },
  );

  it('draws background-layer objects and custom sprites', async () => {
    expect((await apiObjectFootprint(FEATURE_ROOM.tree.id)).drawn).not.toBeNull();
    expect((await apiObjectFootprint(`custom_sprite:${FEATURE_ROOM.customSprite.id}`)).drawn).not.toBeNull();
  });

  it('draws the default background as a dark starfield near the game\'s #050505', async () => {
    const card = await renderApiCard(roomWith(feature, {}));
    expect(near(mostCommonColour(card), STARFIELD, 24)).toBe(true);
  });
});

describe('blocked community art and hidden versions', { timeout: RENDER_TIMEOUT_MS }, () => {
  // Every server path masks a snapshot before drawing it: the API card (share/routes.ts,
  // wampOGram/preview.ts) and the world-tile Worker with maskBlockedCustomArt, the Pages card with
  // markBlockedCustomSprites. A custom tile cut from a blocked sprite becomes BLOCKED_ART_COLOR.
  const spriteId = FEATURE_ROOM.customSprite.id;
  const withBlockableArt = (): RoomSnapshot => {
    const room = { ...buildFeatureRoom(), background: CONTENT_BACKGROUND };
    room.customTiles = room.customTiles!.map((tile, index) => (index === 0 ? { ...tile, sourceSpriteId: spriteId } : tile));
    return room;
  };
  const blocked = new Set([spriteId]);
  const [tileColumn] = FEATURE_ROOM.customTiles.columns;
  const { row: tileRow } = FEATURE_ROOM.customTiles;
  const placeholder = hexToRgba(BLOCKED_ART_COLOR);
  const everyPixelIs = (image: Raster, colour: Rgba): boolean => {
    for (let offset = 0; offset < image.pixels.length; offset += 4) {
      if (!near([image.pixels[offset], image.pixels[offset + 1], image.pixels[offset + 2], image.pixels[offset + 3]], colour, 0)) return false;
    }
    return true;
  };
  const withoutSprite = (room: RoomSnapshot): RoomSnapshot => ({ ...room, placedObjects: room.placedObjects.filter((placed) => !isCustomSprite(placed.id)) });

  it('the API card paints a blocked custom tile as the placeholder', async () => {
    const card = sampleRoomGrid(await renderApiCard(maskBlockedCustomArt(withBlockableArt(), blocked)));
    expect(everyPixelIs(cell(card, tileColumn, tileRow), placeholder)).toBe(true);
  });

  // The world-tile Worker draws in strict mode, which used to throw on the blocked sprite as an
  // unknown object, so those map tiles were never redrawn.
  it('the world tile paints a blocked custom tile as the placeholder and leaves out the blocked sprite', async () => {
    const masked = maskBlockedCustomArt(withBlockableArt(), blocked);
    const leaf = crop(await renderWorldTileLeaf(masked), 1, 1, 640, 352);
    expect(everyPixelIs(cell(leaf, tileColumn, tileRow), placeholder)).toBe(true);
    const expected = crop(await renderWorldTileLeaf(withoutSprite(masked)), 1, 1, 640, 352);
    expect(diffRasters(leaf, expected).count).toBe(0);
  });

  it('the Pages card masks blocked art like the API card and world tile', async () => {
    const room = withBlockableArt();
    const card = await renderPagesCard(markBlockedCustomSprites(room as unknown as PublishedRoomSnapshot, blocked));
    expect(diffRasters(card, await renderPagesCard(withoutSprite(maskBlockedCustomArt(room, blocked)))).count).toBe(0);
  });

  it('the Pages card paints a blocked custom tile as the placeholder', async () => {
    const card = sampleRoomGrid(await renderPagesCard(maskBlockedCustomArt(withBlockableArt(), blocked)));
    expect(everyPixelIs(cell(card, tileColumn, tileRow), placeholder)).toBe(true);
  });

  it('a hidden version draws as the empty default room in every renderer', async () => {
    const hidden = hiddenVersionSnapshot(feature);
    const empty = createDefaultRoomSnapshot(feature.id, feature.coordinates);
    expect(pixelHash(await renderApiCard(hidden))).toBe(pixelHash(await renderApiCard(empty)));
    expect(pixelHash(await renderPagesCard(hidden))).toBe(pixelHash(await renderPagesCard(empty)));
    expect(pixelHash(await renderWorldTileLeaf(hidden))).toBe(pixelHash(await renderWorldTileLeaf(empty)));
  });
});

describe('room settings no image renderer draws', { timeout: RENDER_TIMEOUT_MS }, () => {
  // Only the live game shows lighting, weather and the video frame. If one renderer starts drawing
  // them, this fails so the others can follow.
  it('lighting, weather and a video frame leave every renderer\'s pixels unchanged', async () => {
    const plain = loadReferenceRoom('cave-x-3-y-2');
    const dressed: RoomSnapshot = {
      ...plain,
      lighting: { ...plain.lighting, mode: 'playerAuraDark', darkness: 80 },
      weather: { mode: 'rain', intensity: 90 },
      video: {
        youtubeId: 'dQw4w9WgXcQ', x: 64, y: 64, width: 160, aspect: 16 / 9,
        loop: true, autoplay: true, trigger: false, volume: 1, muteMusic: false, snap: true,
      },
    };
    const undressed: RoomSnapshot = { ...plain, lighting: createDefaultRoomSnapshot().lighting, weather: createDefaultRoomSnapshot().weather, video: null };
    expect(pixelHash(await renderApiCard(dressed))).toBe(pixelHash(await renderApiCard(undressed)));
    expect(pixelHash(await renderPagesCard(dressed))).toBe(pixelHash(await renderPagesCard(undressed)));
    expect(pixelHash(await renderWorldTileLeaf(dressed))).toBe(pixelHash(await renderWorldTileLeaf(undressed)));
  });
});

describe('each renderer\'s feature-room drawing, pinned', { timeout: RENDER_TIMEOUT_MS }, () => {
  // The three outputs differ on purpose (abstract card, real-art card with frame, 642x354 map tile),
  // so each is pinned to the sha256 of its decoded pixels. The known gaps above are part of these
  // pins. When a drawing changes on purpose, update its pin and the version that makes clients fetch
  // it again: API card, WAMP_O_GRAM_PREVIEW_VERSION (gram previews are kept per version, F348);
  // Pages card, ROOM_IMAGE_RENDERER_VERSION in pages/shareMetadata.ts; world tile,
  // WORLD_TILE_RENDER_CONTRACT and a new renderer version (map tiles are pinned to a deployment).
  it('API card', async () => {
    expect(pixelHash(await renderApiCard(feature))).toBe('30dcb711c5b9fe211fdf7f9ac10e4ca5f27a6108debd759374a189168c7a5073');
  });

  it('Pages card', async () => {
    expect(pixelHash(await renderPagesCard(feature))).toBe('30dcb711c5b9fe211fdf7f9ac10e4ca5f27a6108debd759374a189168c7a5073');
  });

  it('world tile (as SoftwareCanvas rasterises its draw calls)', async () => {
    expect(pixelHash(await renderWorldTileLeaf(feature))).toBe('01467c7d16c98e0f83b3d387670e8921b209864ba595e22b9b9c4c41a7444750');
  });
});

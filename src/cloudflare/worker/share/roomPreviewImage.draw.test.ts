import { describe, expect, it } from 'vitest';
import { getObjectById, TILE_FLIP_X_FLAG, TILE_FLIP_Y_FLAG, TILE_SIZE } from '../../../config';
import { createDefaultRoomSnapshot, type RoomSnapshot } from '../../../persistence/roomModel';
import {
  buildFeatureRoom, changedBounds, customTilePixel, FEATURE_ROOM, hexToRgba, pixelAt, pixelHash, renderApiCard,
  renderApiExpandedCard, roomWith, sampleRoomGrid, type Raster, type Rgba,
} from '../../../rendering/roomRenderers.testHarness';
import { renderExpandedRoomSharePreviewPng, renderRoomSharePreviewPng } from './roomPreviewImage';

/**
 * Unit tests for the API Worker's share card (F484), the abstract renderer for Expanded Room and
 * Wamp-O-Gram link previews. rendering/roomRenderers.equivalence.test.ts checks it against the
 * real-art renderers; roomPreviewImage.test.ts pins its PNG bytes.
 */

const LEFT = 60;
const TOP = 18;
const TILE = 27;
const BACKGROUND = '#203040';

const blend = (under: Rgba, colour: number, alpha: number): Rgba => [
  Math.round(under[0] * (1 - alpha) + ((colour >> 16) & 0xff) * alpha),
  Math.round(under[1] * (1 - alpha) + ((colour >> 8) & 0xff) * alpha),
  Math.round(under[2] * (1 - alpha) + (colour & 0xff) * alpha),
  255,
];
const rgb = (colour: number): Rgba => [(colour >> 16) & 0xff, (colour >> 8) & 0xff, colour & 0xff, 255];
const BACKGROUND_RGBA = hexToRgba(BACKGROUND);
/** An empty spot in the room: the background under the dark frame and the room's tint. */
const ROOM_FLOOR = blend(blend(BACKGROUND_RGBA, 0x05070c, 0.84), 0x0e1524, 0.34);

function emptyRoom(background = `solid:${BACKGROUND}`, id = 'unit-room'): RoomSnapshot {
  return { ...createDefaultRoomSnapshot(id, { x: 1, y: 1 }), background };
}

function withTile(layer: 'background' | 'terrain' | 'foreground', x: number, y: number, value: number, room = emptyRoom()): RoomSnapshot {
  const copy = structuredClone(room);
  copy.tileData[layer][y][x] = value;
  return copy;
}

const cellRect = (x: number, y: number, inset = 0) => ({
  left: LEFT + x * TILE + inset, top: TOP + y * TILE + inset,
  right: LEFT + (x + 1) * TILE - 1 - inset, bottom: TOP + (y + 1) * TILE - 1 - inset,
});

let emptyCard: Promise<Raster> | null = null;
const emptyApiCard = (): Promise<Raster> => (emptyCard ??= renderApiCard(emptyRoom()));

describe('API share card: frame and backgrounds', () => {
  it('draws a 1200x630 card: background, dark frame, tinted room and a light 3 px border', async () => {
    const card = await emptyApiCard();
    expect([card.width, card.height]).toEqual([1200, 630]);
    expect(pixelAt(card, 0, 0)).toEqual(BACKGROUND_RGBA);
    expect(pixelAt(card, 1199, 629)).toEqual(BACKGROUND_RGBA);
    expect(pixelAt(card, 53, 300)).toEqual(blend(BACKGROUND_RGBA, 0x05070c, 0.84));
    expect(pixelAt(card, 59, 300)).toEqual(blend(BACKGROUND_RGBA, 0x05070c, 0.84));
    for (const [x, y] of [[56, 300], [58, 300], [600, 14], [600, 16], [1141, 300], [1143, 300], [600, 613], [600, 615]]) {
      expect(pixelAt(card, x, y), `${x},${y}`).toEqual(hexToRgba('#f5f1de'));
    }
    expect(pixelAt(card, LEFT, TOP)).toEqual(ROOM_FLOOR);
    expect(pixelAt(card, LEFT + 1079, TOP + 593)).toEqual(ROOM_FLOOR);
  });

  it('fills a theme background with its sky and ground bands', async () => {
    const card = await renderApiCard(emptyRoom('grassland'));
    expect(pixelAt(card, 1199, 5)).toEqual(rgb(0x8bcce3));
    expect(pixelAt(card, 1199, 625)).toEqual(rgb(0x4f8b48));
    expect(pixelAt(card, 5, 5)).toEqual(rgb(0x8bcce3));
  });

  it('draws the default background as stars on #070b16, placed by the room id', async () => {
    const card = await renderApiCard(emptyRoom('none', 'stars-a'));
    const again = await renderApiCard(emptyRoom('none', 'stars-a'));
    const other = await renderApiCard(emptyRoom('none', 'stars-b'));
    expect(pixelHash(again)).toBe(pixelHash(card));
    expect(pixelHash(other)).not.toBe(pixelHash(card));
    let base = 0;
    let lighter = 0;
    for (let x = 0; x < 1200; x += 1) {
      for (const y of [2, 5, 625, 628]) {
        const [red] = pixelAt(card, x, y);
        if (red === 0x07) base += 1;
        else if (red > 0x40) lighter += 1;
      }
    }
    expect(base).toBeGreaterThan(4_500);
    expect(lighter).toBeGreaterThan(0);
  });

  it('shows a photo background, which the API Worker does not fetch, as a 40 px checkerboard', async () => {
    const card = await renderApiCard(emptyRoom('custom:abcdefgh?fit=stretch'));
    expect(pixelAt(card, 0, 0)).toEqual(rgb(0x283447));
    expect(pixelAt(card, 40, 0)).toEqual(rgb(0x1b2433));
    expect(pixelAt(card, 40, 40)).toEqual(rgb(0x283447));
    expect(pixelAt(card, 1199, 5)).toEqual(rgb(0x1b2433));
  });
});

describe('API share card: tiles', () => {
  it('fills a terrain tile\'s whole cell with a lit top edge and shaded sides', async () => {
    const card = await renderApiCard(withTile('terrain', 2, 3, 88));
    const cell = cellRect(2, 3);
    expect(changedBounds(await emptyApiCard(), card)).toEqual(cell);
    const centre = pixelAt(card, cell.left + 13, cell.top + 13);
    const brightness = (pixel: Rgba) => pixel[0] + pixel[1] + pixel[2];
    expect(brightness(pixelAt(card, cell.left + 13, cell.top))).toBeGreaterThan(brightness(centre));
    expect(brightness(pixelAt(card, cell.left + 13, cell.bottom))).toBeLessThan(brightness(centre));
    expect(brightness(pixelAt(card, cell.left, cell.top + 13))).toBeLessThan(brightness(centre));
    expect(brightness(pixelAt(card, cell.right, cell.top + 13))).toBeLessThan(brightness(centre));
  });

  it('insets back-layer tiles by 4 px and front-layer tiles by 2 px', async () => {
    expect(changedBounds(await emptyApiCard(), await renderApiCard(withTile('background', 2, 3, 88)))).toEqual(cellRect(2, 3, 4));
    expect(changedBounds(await emptyApiCard(), await renderApiCard(withTile('foreground', 2, 3, 88)))).toEqual(cellRect(2, 3, 2));
  });

  it('ignores empty and out-of-range tile values', async () => {
    let room = withTile('terrain', 0, 0, -1);
    room = withTile('terrain', 1, 0, 0, room);
    expect(pixelHash(await renderApiCard(room))).toBe(pixelHash(await emptyApiCard()));
  });

  const customTileRoom = (layer: 'background' | 'terrain' | 'foreground', value: number, collision: 'none' | 'solid' = 'none'): RoomSnapshot => {
    const room = withTile(layer, 4, 2, value);
    room.customTiles = [{ ...buildFeatureRoom().customTiles![0], collision }];
    return room;
  };
  const customTileCell = async (room: RoomSnapshot): Promise<(x: number, y: number) => Rgba> => {
    const grid = sampleRoomGrid(await renderApiCard(room));
    return (x, y) => pixelAt(grid, 4 * TILE_SIZE + x, 2 * TILE_SIZE + y);
  };

  it('scales a custom tile\'s pixels onto its cell and leaves its transparent pixels unpainted', async () => {
    const tile = await customTileCell(customTileRoom('terrain', 10_000));
    for (let y = 0; y < TILE_SIZE; y += 1) {
      for (let x = 0; x < TILE_SIZE; x += 1) {
        const colour = customTilePixel(x, y);
        expect(tile(x, y), `${x},${y}`).toEqual(colour ? hexToRgba(colour) : ROOM_FLOOR);
      }
    }
  });

  it('mirrors a flipped custom tile', async () => {
    const blue = hexToRgba(customTilePixel(0, 0)!);
    expect((await customTileCell(customTileRoom('terrain', 10_000 + TILE_FLIP_X_FLAG)))(14, 1)).toEqual(blue);
    expect((await customTileCell(customTileRoom('terrain', 10_000 + TILE_FLIP_Y_FLAG)))(1, 14)).toEqual(blue);
    expect((await customTileCell(customTileRoom('terrain', 10_000 + TILE_FLIP_Y_FLAG)))(1, 1)).toEqual(ROOM_FLOOR);
  });

  const red = customTilePixel(5, 5)!;
  const redNumber = Number.parseInt(red.slice(1), 16);

  it('shades a solid custom tile\'s edges and draws back- and front-layer custom tiles translucent', async () => {
    const solid = await customTileCell(customTileRoom('terrain', 10_000, 'solid'));
    expect(solid(5, 5)).toEqual(hexToRgba(red));
    expect(solid(5, 0)).toEqual(blend(hexToRgba(red), 0xffffff, 0.18));
    expect(solid(5, 15)).not.toEqual(ROOM_FLOOR);
    expect((await customTileCell(customTileRoom('background', 10_000)))(5, 5)).toEqual(blend(ROOM_FLOOR, redNumber, 0.5));
    expect((await customTileCell(customTileRoom('foreground', 10_000)))(5, 5)).toEqual(blend(ROOM_FLOOR, redNumber, 0.78));
  });

  // Each source pixel is filled from floor(i * 27 / 16) to ceil((i + 1) * 27 / 16), so neighbours
  // overlap by a card pixel. Opaque tiles hide that; translucent ones are blended twice there.
  it.fails('fills a translucent custom tile evenly (overlapping pixel spans leave darker seams)', async () => {
    const card = await renderApiCard(customTileRoom('background', 10_000));
    const seen = new Set<string>();
    // Card pixels 7-12 across and 7-20 down of the cell: source pixels 4-7 by 4-11, all red.
    for (let y = TOP + 2 * TILE + 7; y < TOP + 2 * TILE + 21; y += 1) {
      for (let x = LEFT + 4 * TILE + 7; x < LEFT + 4 * TILE + 13; x += 1) seen.add(pixelAt(card, x, y).join());
    }
    expect([...seen]).toEqual([blend(ROOM_FLOOR, redNumber, 0.5).join()]);
  });
});

describe('API share card: objects', () => {
  const objectRoom = (id: string, layer: 'background' | 'terrain' | 'foreground' = 'terrain'): RoomSnapshot => ({
    ...emptyRoom(), placedObjects: [{ id, x: 328, y: 168, instanceId: id, layer }],
  });
  /** The object's centre on the card and its scaled frame size, as the card computes them. */
  const geometry = (id: string) => {
    const config = getObjectById(id)!;
    const width = Math.max(10, Math.round(config.frameWidth * (TILE / TILE_SIZE)));
    const height = Math.max(10, Math.round(config.frameHeight * (TILE / TILE_SIZE)));
    const centreX = LEFT + Math.round((328 / TILE_SIZE) * TILE);
    const centreY = TOP + Math.round((168 / TILE_SIZE) * TILE);
    return { centreX, centreY, left: centreX - Math.floor(width / 2), top: centreY - Math.floor(height / 2), width, height };
  };

  it.each([
    ['collectible diamond', 'coin_gold', (g: ReturnType<typeof geometry>) => [g.centreX, g.centreY + 5], 0xffd447],
    ['hazard triangle', 'spikes', (g: ReturnType<typeof geometry>) => [g.centreX, g.top + g.height - 2], 0xff5d4d],
    ['enemy body', 'slime_blue', (g: ReturnType<typeof geometry>) => [g.centreX, g.centreY + 3], 0x4fd1c5],
    ['enemy eye', 'slime_blue', (g: ReturnType<typeof geometry>) => [g.centreX - 4, g.centreY - 3], 0x07111c],
    ['platform', 'crate', (g: ReturnType<typeof geometry>) => [g.centreX, g.centreY], 0x9a6b44],
    ['flag pole', 'flag', (g: ReturnType<typeof geometry>) => [g.centreX, g.top + g.height - 2], 0xf5f1de],
    ['flag cloth', 'flag', (g: ReturnType<typeof geometry>) => [g.centreX + 6, g.top + 4], 0x5dc16b],
    ['ladder rail', 'ladder', (g: ReturnType<typeof geometry>) => [g.left + Math.floor(g.width * 0.2) + 1, g.centreY], 0xd7ac63],
    ['door panel', 'door_locked', (g: ReturnType<typeof geometry>) => [g.centreX, g.centreY - 8], 0x6f7f96],
    ['spawn diamond', 'spawn_point', (g: ReturnType<typeof geometry>) => [g.centreX, g.centreY], 0x7fd4ff],
    ['other interactive panel', 'bounce_pad', (g: ReturnType<typeof geometry>) => [g.centreX, g.centreY], 0xf5f1de],
    ['tree trunk', 'tree', (g: ReturnType<typeof geometry>) => [g.centreX, g.centreY + Math.floor(g.height * 0.4)], 0x7a4f34],
    ['tree canopy', 'tree', (g: ReturnType<typeof geometry>) => [g.centreX, g.centreY - Math.floor(g.height * 0.22)], 0x4b9b57],
    ['sign board', 'sign', (g: ReturnType<typeof geometry>) => [g.centreX, g.top + 5], 0xd7ac63],
    ['other decoration', 'clouds_deco', (g: ReturnType<typeof geometry>) => [g.centreX, g.centreY], 0x5dc16b],
  ] as const)('draws a %s for %s', async (_shape, id, at, colour) => {
    const [x, y] = at(geometry(id));
    expect(pixelAt(await renderApiCard(objectRoom(id)), x, y)).toEqual(rgb(colour));
  });

  it('draws foreground objects too, but not background-layer objects or objects it does not know', async () => {
    const { centreX, centreY } = geometry('coin_gold');
    expect(pixelAt(await renderApiCard(objectRoom('coin_gold', 'foreground')), centreX, centreY + 5)).toEqual(rgb(0xffd447));
    const empty = pixelHash(await emptyApiCard());
    expect(pixelHash(await renderApiCard(objectRoom('coin_gold', 'background')))).toBe(empty);
    expect(pixelHash(await renderApiCard(objectRoom('not_an_object')))).toBe(empty);
    expect(pixelHash(await renderApiCard(objectRoom(`custom_sprite:${FEATURE_ROOM.customSprite.id}`)))).toBe(empty);
  });
});

describe('API share card: Expanded Rooms', () => {
  const cellAt = (x: number, y: number, room = emptyRoom()) => ({ snapshot: room, coordinates: { x, y } });

  it('draws one cell as the single-room card, and no cells (or only bad coordinates) as the default room', async () => {
    const room = roomWith(buildFeatureRoom(), { tiles: true });
    expect(await renderExpandedRoomSharePreviewPng([cellAt(5, 5, room)])).toEqual(await renderRoomSharePreviewPng(room));
    const defaultCard = await renderRoomSharePreviewPng(createDefaultRoomSnapshot());
    expect(await renderExpandedRoomSharePreviewPng([])).toEqual(defaultCard);
    expect(await renderExpandedRoomSharePreviewPng([
      { snapshot: room, coordinates: { x: Number.NaN, y: 0 } },
      { snapshot: room, coordinates: { x: 0, y: Number.POSITIVE_INFINITY } },
    ])).toEqual(defaultCard);
  });

  // Two cells side by side fit at 13 px per tile: 1040x286 from (80, 172), stroke 4 px.
  const pair = { tile: 13, left: 80, top: 172, cellWidth: 520, cellHeight: 286, stroke: 4 };

  it('lays cells side by side on one grid, with a light border around the outside only', async () => {
    const right = withTile('terrain', 0, 0, 88);
    const card = await renderApiExpandedCard([cellAt(7, 3), cellAt(8, 3, right)]);
    const plain = await renderApiExpandedCard([cellAt(7, 3), cellAt(8, 3)]);
    const tileLeft = pair.left + pair.cellWidth;
    expect(changedBounds(plain, card)).toEqual({ left: tileLeft, top: pair.top, right: tileLeft + pair.tile - 1, bottom: pair.top + pair.tile - 1 });
    const border = hexToRgba('#f5f1de');
    expect(pixelAt(card, pair.left - 1, 300)).toEqual(border);
    expect(pixelAt(card, pair.left - pair.stroke, 300)).toEqual(border);
    expect(pixelAt(card, pair.left - pair.stroke - 1, 300)).not.toEqual(border);
    expect(pixelAt(card, pair.left + 2 * pair.cellWidth, 300)).toEqual(border);
    expect(pixelAt(card, 400, pair.top - 1)).toEqual(border);
    expect(pixelAt(card, 400, pair.top + pair.cellHeight)).toEqual(border);
    expect(pixelAt(card, tileLeft - 1, 300)).not.toEqual(border);
    expect(pixelAt(card, tileLeft, 300)).not.toEqual(border);
  });

  it('sorts cells by position and takes the background from the top-left one', async () => {
    const red = emptyRoom('solid:#c02020');
    const blue = emptyRoom('solid:#2020c0');
    const inOrder = await renderExpandedRoomSharePreviewPng([cellAt(0, 0, red), cellAt(1, 0, blue)]);
    expect(await renderExpandedRoomSharePreviewPng([cellAt(1, 0, blue), cellAt(0, 0, red)])).toEqual(inOrder);
    expect(pixelAt(await renderApiExpandedCard([cellAt(1, 0, blue), cellAt(0, 0, red)]), 0, 0)).toEqual(hexToRgba('#c02020'));
  });

  it('borders the inside corner of an L-shaped room', async () => {
    const card = await renderApiExpandedCard([cellAt(0, 0), cellAt(1, 0), cellAt(0, 1)]);
    // Three cells in a 2x2 box fit at 12 px per tile: 960x528 from (120, 51), stroke 4 px.
    const [tile, left, top] = [12, 120, 51];
    const border = hexToRgba('#f5f1de');
    const cellWidth = 40 * tile;
    const cellHeight = 22 * tile;
    expect(pixelAt(card, left + cellWidth + 100, top + cellHeight)).toEqual(border);
    expect(pixelAt(card, left + cellWidth, top + cellHeight + 100)).toEqual(border);
    expect(pixelAt(card, left + cellWidth - 1, top + 100)).not.toEqual(border);
  });

  // Ten cells across fit at 3 px per tile: 1200x66 from (0, 282). Every layer still shows; a
  // front-layer tile's 3 px outline is wider than its 1 px inset square, so it reaches into the
  // next cells, which is harmless at this size.
  it.each([
    ['background', { left: 4, top: 283, right: 4 }],
    ['terrain', { left: 3, top: 282, right: 5 }],
    ['foreground', { left: 2, top: 282, right: 6 }],
  ] as const)('shrinks tiles to 3 px for a room ten cells wide and still draws %s tiles', async (layer, expected) => {
    const cells = Array.from({ length: 10 }, (_, index) => cellAt(index, 0));
    const plain = await renderApiExpandedCard(cells);
    cells[0] = cellAt(0, 0, withTile(layer, 1, 0, 88));
    const bounds = changedBounds(plain, await renderApiExpandedCard(cells));
    expect(bounds!.left).toBe(expected.left);
    expect(bounds!.top).toBe(expected.top);
    expect(bounds!.right).toBeGreaterThanOrEqual(expected.right);
  });
});

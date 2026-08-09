import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getEditorObjectConfigById: vi.fn(),
  ensureCustomSpriteTexture: vi.fn(),
  registerCustomSpritesFromSnapshot: vi.fn(),
}));

vi.mock('phaser', () => ({
  default: {
    Math: {
      Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
    },
    Textures: { FilterMode: { NEAREST: 0 } },
  },
}));
vi.mock('../customSprites/objectConfig', () => ({
  getEditorObjectConfigById: mocks.getEditorObjectConfigById,
}));
vi.mock('../customSprites/registry', () => ({
  ensureCustomSpriteTexture: mocks.ensureCustomSpriteTexture,
  registerCustomSpritesFromSnapshot: mocks.registerCustomSpritesFromSnapshot,
}));

import { ROOM_HEIGHT, ROOM_WIDTH } from '../config';
import type { RoomSnapshot } from '../persistence/roomModel';
import {
  drawRoomObjectRangeForLayerToContext,
  drawRoomTileLayerRowsToContext,
} from './roomSnapshotTexture';

function createTileLayer(): number[][] {
  return Array.from({ length: ROOM_HEIGHT }, () => Array(ROOM_WIDTH).fill(-1));
}

describe('drawRoomTileLayerRowsToContext', () => {
  const drawImage = vi.fn();
  const context = {
    drawImage,
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  const source = { width: 256, height: 256 } as CanvasImageSource;
  const scene = {
    textures: {
      get: vi.fn(() => ({ getSourceImage: () => source })),
    },
  };

  beforeEach(() => {
    drawImage.mockReset();
    mocks.getEditorObjectConfigById.mockReset();
    mocks.ensureCustomSpriteTexture.mockReset();
  });

  it('draws only tiles within the requested half-open row range', () => {
    const background = createTileLayer();
    const terrain = createTileLayer();
    const foreground = createTileLayer();
    terrain[2][1] = 1;
    terrain[5][3] = 1;
    const room = {
      tileData: { background, terrain, foreground },
      customTiles: [],
    } as unknown as RoomSnapshot;

    drawRoomTileLayerRowsToContext(
      scene as never,
      context,
      room,
      16,
      'terrain',
      2,
      3,
    );

    expect(drawImage).toHaveBeenCalledTimes(1);
  });

  it('clamps row bounds without redrawing another batch', () => {
    const background = createTileLayer();
    const terrain = createTileLayer();
    const foreground = createTileLayer();
    terrain[0][0] = 1;
    terrain[ROOM_HEIGHT - 1][0] = 1;
    const room = {
      tileData: { background, terrain, foreground },
      customTiles: [],
    } as unknown as RoomSnapshot;

    drawRoomTileLayerRowsToContext(
      scene as never,
      context,
      room,
      16,
      'terrain',
      -5,
      1,
    );

    expect(drawImage).toHaveBeenCalledTimes(1);
  });

  it('treats omitted overview rows as empty tiles', () => {
    const room = {
      tileData: {
        background: createTileLayer(),
        terrain: createTileLayer(),
        foreground: [],
      },
      customTiles: [],
    } as unknown as RoomSnapshot;

    expect(() => drawRoomTileLayerRowsToContext(
      scene as never,
      context,
      room,
      16,
      'foreground',
      0,
      1,
    )).not.toThrow();
    expect(drawImage).not.toHaveBeenCalled();
  });

  it('skips a missing custom sprite before config or texture creation in resident-only mode', () => {
    const missingScene = {
      textures: {
        exists: vi.fn(() => false),
        get: vi.fn(),
        addCanvas: vi.fn(),
      },
    };
    const room = {
      placedObjects: [{
        id: 'custom_sprite:missing-preview-art',
        x: 16,
        y: 16,
        layer: 'terrain',
      }],
    } as unknown as RoomSnapshot;

    drawRoomObjectRangeForLayerToContext(
      missingScene as never,
      context,
      room,
      4,
      'terrain',
      0,
      1,
      0,
      0,
      { ensureCustomSpriteTextures: false },
    );

    expect(missingScene.textures.exists).toHaveBeenCalledWith(
      'custom_sprite:missing-preview-art',
    );
    expect(mocks.getEditorObjectConfigById).not.toHaveBeenCalled();
    expect(mocks.ensureCustomSpriteTexture).not.toHaveBeenCalled();
    expect(missingScene.textures.addCanvas).not.toHaveBeenCalled();
  });

  it('preserves custom-sprite texture creation for the default Browse draw path', () => {
    const customSource = { width: 16, height: 16 } as CanvasImageSource;
    const browseScene = {
      textures: {
        exists: vi.fn(() => false),
        get: vi.fn(() => ({ getSourceImage: () => customSource })),
      },
    };
    mocks.getEditorObjectConfigById.mockReturnValue({
      id: 'custom_sprite:browse-art',
      frameWidth: 16,
      frameHeight: 16,
      frameCount: 1,
    });
    const room = {
      placedObjects: [{
        id: 'custom_sprite:browse-art',
        x: 16,
        y: 16,
        layer: 'terrain',
      }],
    } as unknown as RoomSnapshot;

    drawRoomObjectRangeForLayerToContext(
      browseScene as never,
      context,
      room,
      4,
      'terrain',
      0,
      1,
    );

    expect(mocks.getEditorObjectConfigById).toHaveBeenCalledWith(
      'custom_sprite:browse-art',
    );
    expect(mocks.ensureCustomSpriteTexture).toHaveBeenCalledOnce();
    expect(drawImage).toHaveBeenCalledOnce();
  });
});

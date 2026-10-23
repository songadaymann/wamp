import type Phaser from 'phaser';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('phaser', () => ({
  default: {
    CANVAS: 1,
    Display: { Canvas: { CanvasPool: { create: mocks.create, remove: mocks.remove } } },
    Math: {
      Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
    },
  },
}));
vi.mock('../customSprites/registry', () => ({
  ensureCustomSpriteTexture: vi.fn(),
  registerCustomSpritesFromSnapshot: vi.fn(),
}));

import { createDefaultRoomSnapshot } from '../persistence/roomModel';
import { buildRoomSnapshotTexture } from './roomSnapshotTexture';
import {
  addStaticCanvasTexture,
  createPooledTextureCanvas,
  releasePooledTextureCanvas,
} from './staticCanvasTexture';

function createCanvas(width: number, height: number, context: unknown = createContext()) {
  return { width, height, getContext: vi.fn(() => context) } as unknown as HTMLCanvasElement;
}

function createContext() {
  return {
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    imageSmoothingEnabled: true,
    globalAlpha: 1,
  };
}

function createTextures() {
  const keys = new Set<string>();
  return {
    keys,
    exists: vi.fn((key: string) => keys.has(key)),
    addImage: vi.fn((key: string) => {
      keys.add(key);
      return { key };
    }),
  };
}

beforeEach(() => {
  mocks.create.mockReset();
  mocks.remove.mockReset();
});

describe('static canvas textures', () => {
  it('registers a canvas as a plain texture and borrows canvases from the pool', () => {
    const textures = createTextures();
    const canvas = createCanvas(4, 4);
    mocks.create.mockReturnValue(canvas);

    expect(createPooledTextureCanvas(64, 32)).toBe(canvas);
    expect(mocks.create).toHaveBeenCalledWith(null, 64, 32, 1, true);
    addStaticCanvasTexture(textures as unknown as Phaser.Textures.TextureManager, 'room', canvas);
    expect(textures.addImage).toHaveBeenCalledWith('room', canvas);
    releasePooledTextureCanvas(canvas);
    expect(mocks.remove).toHaveBeenCalledWith(canvas);
  });
});

describe('buildRoomSnapshotTexture', () => {
  const room = createDefaultRoomSnapshot('1,2', { x: 1, y: 2 });
  const options = { includeBackground: false, includeObjects: false };

  it('draws into a pooled canvas and uploads it without a CanvasTexture copy', () => {
    const textures = createTextures();
    const context = createContext();
    const canvas = createCanvas(0, 0, context);
    mocks.create.mockReturnValue(canvas);

    buildRoomSnapshotTexture({ textures } as never, room, 'room-key', 4, options);

    expect(mocks.create).toHaveBeenCalledWith(null, expect.any(Number), expect.any(Number), 1, true);
    expect(context.clearRect).toHaveBeenCalled();
    expect(context.imageSmoothingEnabled).toBe(false);
    expect(textures.addImage).toHaveBeenCalledWith('room-key', canvas);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('leaves an existing texture alone and returns unused canvases to the pool', () => {
    const textures = createTextures();
    textures.keys.add('taken');
    buildRoomSnapshotTexture({ textures } as never, room, 'taken', 4, options);
    expect(mocks.create).not.toHaveBeenCalled();

    const noContext = createCanvas(0, 0, null);
    mocks.create.mockReturnValue(noContext);
    buildRoomSnapshotTexture({ textures } as never, room, 'no-context', 4, options);
    expect(textures.addImage).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledWith(noContext);

    const failing = createCanvas(0, 0, { ...createContext(), clearRect: () => { throw new Error('lost'); } });
    mocks.create.mockReturnValue(failing);
    expect(() => buildRoomSnapshotTexture({ textures } as never, room, 'failing', 4, options))
      .toThrow('lost');
    expect(mocks.remove).toHaveBeenCalledWith(failing);
  });
});

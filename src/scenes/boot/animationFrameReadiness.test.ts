import { describe, expect, it, vi } from 'vitest';
import { hasExactTextureFrame } from './animationFrameReadiness';

describe('hasExactTextureFrame', () => {
  it('accepts an exact frame on a loaded texture', () => {
    const texture = { has: vi.fn((frame: string) => frame === '7') };
    const manager = {
      exists: vi.fn(() => true),
      get: vi.fn(() => texture),
    };

    expect(hasExactTextureFrame(manager as never, 'coin_gold', 7)).toBe(true);
    expect(texture.has).toHaveBeenCalledWith('7');
  });

  it('rejects a missing frame even when a manager-level lookup could fall back', () => {
    const texture = { has: vi.fn(() => false) };
    const manager = {
      exists: vi.fn(() => true),
      get: vi.fn(() => texture),
      getFrame: vi.fn(() => ({ name: 0 })),
    };

    expect(hasExactTextureFrame(manager as never, 'coin_gold', 7)).toBe(false);
    expect(manager.getFrame).not.toHaveBeenCalled();
  });

  it('rejects a missing texture without retrieving it', () => {
    const manager = {
      exists: vi.fn(() => false),
      get: vi.fn(() => ({ has: vi.fn(() => true) })),
    };

    expect(hasExactTextureFrame(manager as never, 'coin_gold', 0)).toBe(false);
    expect(manager.get).not.toHaveBeenCalled();
  });

  it('rejects a texture manager that is being torn down', () => {
    const manager = {
      exists: vi.fn(() => true),
      get: vi.fn(() => {
        throw new Error('destroyed');
      }),
    };

    expect(hasExactTextureFrame(manager as never, 'coin_gold', 0)).toBe(false);
  });
});

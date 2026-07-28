import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));

import { isSceneAvatarPackLoaded } from './dynamic';

function createSceneWithTextures(textureKeys: string[]) {
  const loadedTextureKeys = new Set(textureKeys);
  return {
    textures: {
      exists: (key: string) => loadedTextureKeys.has(key),
    },
  };
}

describe('scene avatar pack readiness', () => {
  it('requires every registered color avatar atlas to exist', () => {
    const colorAtlasKeys = [
      'player-color-ff533f-base-atlas',
      'player-color-ff533f-combat-atlas',
    ];

    expect(
      isSceneAvatarPackLoaded(
        createSceneWithTextures([]) as never,
        'color-ff533f',
      ),
    ).toBe(false);
    expect(
      isSceneAvatarPackLoaded(
        createSceneWithTextures(colorAtlasKeys.slice(0, 1)) as never,
        'color-ff533f',
      ),
    ).toBe(false);
    expect(
      isSceneAvatarPackLoaded(
        createSceneWithTextures(colorAtlasKeys) as never,
        'color-ff533f',
      ),
    ).toBe(true);
  });

  it('does not report an unregistered generated avatar as loaded', () => {
    expect(
      isSceneAvatarPackLoaded(
        createSceneWithTextures([]) as never,
        'cryptopunk-920',
      ),
    ).toBe(false);
  });
});

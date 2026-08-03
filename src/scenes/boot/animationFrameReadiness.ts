import type Phaser from 'phaser';

type TextureManagerLookup = Pick<Phaser.Textures.TextureManager, 'exists' | 'get'>;

/**
 * Checks exact texture-frame membership without TextureManager.getFrame's
 * fallback-to-first-frame behavior.
 */
export function hasExactTextureFrame(
  textureManager: TextureManagerLookup | null | undefined,
  textureKey: string,
  frame: string | number,
): boolean {
  if (!textureManager || textureKey.length === 0) {
    return false;
  }

  try {
    return textureManager.exists(textureKey) && textureManager.get(textureKey).has(String(frame));
  } catch {
    // Treat a partially torn-down texture manager as unavailable.
    return false;
  }
}

import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { GAME_OBJECTS } from '../config';
import manifest from './treeAtlasManifest.json';

describe('trimmed tree atlases', () => {
  it('reconstructs every authored tree pixel at its original canvas position', async () => {
    let count = 0; let atlasBytes = 0; let originalBytes = 0;
    for (const [family, asset] of Object.entries(manifest)) {
      const atlasData = JSON.parse(readFileSync(`public/${asset.atlasPath}`, 'utf8'));
      const atlas = await sharp(`public/${asset.texturePath}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect(atlas.info.width).toBeLessThanOrEqual(2048); expect(atlas.info.height).toBeLessThanOrEqual(2048);
      atlasBytes += atlas.data.length;
      for (const object of GAME_OBJECTS.filter(object => object.id.startsWith(`tree_pack_${family}_`) && /^\d{2}$/.test(object.id.slice(`tree_pack_${family}_`.length)))) {
        const original = await sharp(`public/${object.path}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const frame = atlasData.frames[object.id];
        expect(frame.sourceSize).toEqual({ w: object.frameWidth, h: object.frameHeight });
        const restored = Buffer.alloc(original.data.length);
        for (let row = 0; row < frame.frame.h; row++) {
          const sourceOffset = ((frame.frame.y + row) * atlas.info.width + frame.frame.x) * 4;
          const targetOffset = ((frame.spriteSourceSize.y + row) * original.info.width + frame.spriteSourceSize.x) * 4;
          atlas.data.copy(restored, targetOffset, sourceOffset, sourceOffset + frame.frame.w * 4);
        }
        // RGB beneath alpha=0 is invisible and may differ after atlas compositing.
        for (let pixel = 0; pixel < restored.length; pixel += 4) {
          if (original.data[pixel + 3] === 0) original.data.fill(0, pixel, pixel + 3);
          if (restored[pixel + 3] === 0) restored.fill(0, pixel, pixel + 3);
        }
        expect(restored.equals(original.data), object.id).toBe(true);
        originalBytes += original.data.length; count++;
      }
    }
    expect(count).toBe(221); expect(atlasBytes).toBeLessThan(originalBytes * 0.5);
  }, 30000);
});

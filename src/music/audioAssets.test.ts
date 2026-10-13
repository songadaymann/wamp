import { readFileSync } from 'node:fs';
import ignore from 'ignore';
import { describe, expect, it } from 'vitest';
import manifest from './audioAssetManifest.json';
import { WAMP_V1_PACK } from './catalog';

describe('audio deployment (F023)', () => {
  const excluded = ignore().add(readFileSync(new URL('../../public/.assetsignore', import.meta.url), 'utf8'));

  it('ships all playback files and excludes only the retained audio sources', () => {
    expect(manifest.assets).toHaveLength(60);
    for (const asset of manifest.assets) {
      expect(excluded.ignores(asset.source.replace('public/', ''))).toBe(true);
      expect(excluded.ignores(asset.output.replace('public/', ''))).toBe(false);
    }
    expect(excluded.ignores('assets/music/roland-mt32/snare-01.wav')).toBe(true);
    expect(excluded.ignores('assets/sfx/progression/player-lvlUp.mp3')).toBe(false);
    expect(excluded.ignores('assets/sfx/movement/jump.ogg')).toBe(false);
    expect(excluded.ignores('assets/sfx/movement/jump.m4a')).toBe(false);
  });

  it('retains saved clip IDs and assigns all 14 stems to eight-second gapless files', () => {
    expect(WAMP_V1_PACK.clips).toHaveLength(14);
    for (const clip of WAMP_V1_PACK.clips) {
      const asset = manifest.assets.find((entry) => entry.output === `public/${clip.assetPath}`);
      expect(asset).toMatchObject({ channels: 2, sampleRate: 44100, frames: 352800 });
      expect(clip.id).toMatch(/^(drums|bass|arp|hold|melody)-[123]$/);
    }
  });
});

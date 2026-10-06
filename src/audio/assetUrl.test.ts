import { describe, expect, it } from 'vitest';
import { resolveSfxAssetUrl } from './assetUrl';

describe('sound asset routes', () => {
  it.each(['/', './', '.', ''])('uses the deployment root from deep room links with base %s', base => {
    expect(resolveSfxAssetUrl('assets/sfx/combat/player-death.ogg', base, 'https://wamp.land/r/-11/-6?welcome=0'))
      .toBe('https://wamp.land/assets/sfx/combat/player-death.ogg');
  });
  it('retains an explicit deployment prefix', () => {
    expect(resolveSfxAssetUrl('/assets/sfx/combat/player-death.m4a', '/wamp/', 'https://example.test/wamp/r/1/2'))
      .toBe('https://example.test/wamp/assets/sfx/combat/player-death.m4a');
  });
  it('retains explicit CDN assets', () => {
    expect(resolveSfxAssetUrl('https://cdn.example.test/death.ogg', './', 'https://wamp.land/r/1/2'))
      .toBe('https://cdn.example.test/death.ogg');
  });
});

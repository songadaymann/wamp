import { describe, expect, it } from 'vitest';
import { normalizeImmutablePagesDeploymentOrigin } from './rendererOrigin';

describe('immutable world tile renderer origins', () => {
  it('accepts an exact immutable Pages deployment hostname', () => {
    expect(normalizeImmutablePagesDeploymentOrigin('https://0a1b2c3d.wampland.pages.dev/')).toBe(
      'https://0a1b2c3d.wampland.pages.dev',
    );
    expect(normalizeImmutablePagesDeploymentOrigin('https://ABCDEF12.world-tile-renderer.pages.dev')).toBe(
      'https://abcdef12.world-tile-renderer.pages.dev',
    );
  });

  it.each([
    'https://main.wampland.pages.dev',
    'https://safety.wampland.pages.dev',
    'https://wampland.pages.dev',
    'https://0123456789.wampland.pages.dev',
    'https://01234xyz.wampland.pages.dev',
    'https://tiles.wamp.land',
    'http://0123abcd.wampland.pages.dev',
    'https://0123abcd.wampland.pages.dev:8443',
    'https://0123abcd.wampland.pages.dev/world-tile-render.html',
    'https://0123abcd.wampland.pages.dev/?mutable=1',
  ])('rejects mutable or non-canonical origin %s', (origin) => {
    expect(normalizeImmutablePagesDeploymentOrigin(origin)).toBeNull();
  });
});

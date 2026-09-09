import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../worlds/worldLinkResolver', () => ({ getResolvedWorldLinkCoordinates: () => null }));
import { getFocusedCoordinatesFromUrl } from './worldNavigation';

afterEach(() => vi.unstubAllGlobals());

describe('arrival room', () => {
  it.each([
    ['/', '', -11, -6],
    ['/r/0/0', '', 0, 0],
    ['/r/4/-2', '', 4, -2],
    ['/', '?x=5&y=8', 5, 8],
  ])('resolves %s %s for returning visitors', (pathname, search, x, y) => {
    vi.stubGlobal('window', {
      location: { pathname, search },
      localStorage: { getItem: () => 'visited-before' },
    });
    expect(getFocusedCoordinatesFromUrl()).toEqual({ x, y });
  });
});

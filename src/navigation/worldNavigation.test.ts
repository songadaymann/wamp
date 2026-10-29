import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../worlds/worldLinkResolver', () => ({ getResolvedWorldLinkCoordinates: () => null }));
import { getFocusedCoordinatesFromUrl, setFocusedCoordinatesInUrl } from './worldNavigation';

afterEach(() => vi.unstubAllGlobals());

describe('arrival room', () => {
  it('preserves a challenge on restart and strips it on navigation to another room',()=>{
    const replaceState=vi.fn();vi.stubGlobal('window',{location:{href:'https://wamp.land/r/1/2?from=share&vs=run'},history:{replaceState}});
    setFocusedCoordinatesInUrl({x:1,y:2});expect(String(replaceState.mock.calls[0][2])).toContain('vs=run');
    setFocusedCoordinatesInUrl({x:2,y:2});expect(String(replaceState.mock.calls[1][2])).not.toContain('vs=');
  });
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

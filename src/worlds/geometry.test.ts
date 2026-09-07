import { describe, expect, it } from 'vitest';
import {
  buildWorldSharePath,
  getWorldLatticePoint,
  getWorldOrigin,
  parseWorldSharePath,
} from './geometry';

describe('World origin geometry', () => {
  it('starts east and spirals counter-clockwise around WAMP 0', () => {
    expect(Array.from({ length: 10 }, (_, number) => getWorldLatticePoint(number))).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: -1 },
      { x: 0, y: -1 },
      { x: -1, y: -1 },
      { x: -1, y: 0 },
      { x: -1, y: 1 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ]);
  });

  it('leaves 128 empty room coordinates between adjacent lattice origins', () => {
    expect(getWorldOrigin(0)).toEqual({ x: 0, y: 0 });
    expect(getWorldOrigin(1)).toEqual({ x: 129, y: 0 });
    expect(getWorldOrigin(2)).toEqual({ x: 129, y: -129 });
  });

  it('does not repeat origins across the first ten thousand Worlds', () => {
    const origins = Array.from({ length: 10_000 }, (_, number) => {
      const point = getWorldOrigin(number);
      return `${point.x},${point.y}`;
    });
    expect(new Set(origins).size).toBe(origins.length);
  });

  it('builds and parses stable World share paths', () => {
    expect(buildWorldSharePath(17)).toBe('/w/17');
    expect(parseWorldSharePath('/w/17')).toBe(17);
    expect(parseWorldSharePath('/w/17/')).toBe(17);
    expect(parseWorldSharePath('/w/017')).toBeNull();
    expect(parseWorldSharePath('/r/17/0')).toBeNull();
  });
});

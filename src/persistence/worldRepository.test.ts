import { describe, expect, it } from 'vitest';
import { buildWorldTileManifestRequestPath } from './worldRepository';

describe('world tile repository request paths', () => {
  const bounds = { minTileX: -1, maxTileX: 2, minTileY: -3, maxTileY: 4 };

  it('preserves the compatible room-summary default', () => {
    const url = new URL(buildWorldTileManifestRequestPath(2, bounds), 'https://game.example');
    expect(url.searchParams.has('includeRooms')).toBe(false);
  });

  it('encodes explicit room-summary inclusion without sharing cache keys', () => {
    const withoutRooms = buildWorldTileManifestRequestPath(2, bounds, { includeRooms: false });
    const withRooms = buildWorldTileManifestRequestPath(2, bounds, { includeRooms: true });
    expect(new URL(withoutRooms, 'https://game.example').searchParams.get('includeRooms')).toBe('0');
    expect(new URL(withRooms, 'https://game.example').searchParams.get('includeRooms')).toBe('1');
    expect(withoutRooms).not.toBe(withRooms);
  });
});

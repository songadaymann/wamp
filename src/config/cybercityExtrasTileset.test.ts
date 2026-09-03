import { describe, expect, it } from 'vitest';
import {
  CYBERCITY_EXTRAS_NEON_LOCAL_INDICES,
  CYBERCITY_EXTRAS_TILE_COUNT,
  CYBERCITY_EXTRAS_TILESET_FIRST_GID,
  CYBERCITY_EXTRAS_TILESET_KEY,
  getTerrainCollisionProfileForGid,
  getTilesetByKey,
  isTilesetLocalTileEditorEnabled,
} from './tilesets';

describe('Cybercity extras tileset', () => {
  it('is selectable and matches Cyber neon collision and glow on the painted cells', () => {
    const extras = getTilesetByKey(CYBERCITY_EXTRAS_TILESET_KEY);
    const yellow = getTilesetByKey('cybercity yellow');
    expect(extras).toMatchObject({
      path: expect.stringMatching(/cybercity_extras\.png\?v=/),
      imageWidth: 192,
      imageHeight: 112,
      columns: 12,
      rows: 7,
      tileCount: CYBERCITY_EXTRAS_TILE_COUNT,
    });
    expect(extras?.editorHidden).not.toBe(true);

    const yellowNeonGid = yellow!.firstGid + 49;
    expect(getTerrainCollisionProfileForGid(yellowNeonGid).id).toBe('decoratedTop');
    expect(getTerrainCollisionProfileForGid(yellow!.firstGid + 6).id).toBe('decoratedTop');

    for (const localIndex of CYBERCITY_EXTRAS_NEON_LOCAL_INDICES) {
      const gid = CYBERCITY_EXTRAS_TILESET_FIRST_GID + localIndex;
      expect(getTerrainCollisionProfileForGid(gid).id).toBe('decoratedTop');
      expect(extras?.lightEmissionProfiles?.[localIndex]).toEqual(
        yellow?.lightEmissionProfiles?.[49],
      );
      expect(isTilesetLocalTileEditorEnabled(extras!, localIndex)).toBe(true);
    }
  });

  it('gives blank extras cells no collision, no glow, and hides them from the palette', () => {
    const extras = getTilesetByKey(CYBERCITY_EXTRAS_TILESET_KEY)!;
    const neon = new Set<number>(CYBERCITY_EXTRAS_NEON_LOCAL_INDICES);
    for (let localIndex = 0; localIndex < CYBERCITY_EXTRAS_TILE_COUNT; localIndex += 1) {
      if (neon.has(localIndex)) continue;
      const gid = CYBERCITY_EXTRAS_TILESET_FIRST_GID + localIndex;
      expect(getTerrainCollisionProfileForGid(gid).id).toBe('none');
      expect(extras.lightEmissionProfiles?.[localIndex]).toBeUndefined();
      expect(isTilesetLocalTileEditorEnabled(extras, localIndex)).toBe(false);
    }
  });
});

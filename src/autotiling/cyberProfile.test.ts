import { describe, expect, it } from 'vitest';
import {
  CYBER_DECO_ONLY_LOCAL_INDICES,
  CYBER_STYLE_PROFILES,
  applyCyberRubbleVariety,
  CYBER_RUBBLE_PINK_PERIOD,
  cyberRubbleEdgeFlipAxes,
  resolveCyberFenceCell,
  resolveCyberNeonStrip,
  resolveCyberPlatformSpan,
  resolveCyberRubbleBorderTile,
  resolveCyberRubbleColumn,
  resolveCyberStructureTieTile,
  resolveCyberSupportSpan,
  resolveCyberTunnelOutlineTile,
  type CyberResolvedTile,
} from './cyberProfile';

function token(tile: CyberResolvedTile): string {
  return `${tile.localIndex}${tile.flipX ? 'X' : ''}${tile.flipY ? 'Y' : ''}`;
}

function tokens(tiles: readonly CyberResolvedTile[]): string[] {
  return tiles.map(token);
}

const DECO_ONLY = new Set<number>(CYBER_DECO_ONLY_LOCAL_INDICES);

describe('Cyber Smart profile', () => {
  it('binds both colorways to identical 12 x 7 atlas geometry', () => {
    expect(CYBER_STYLE_PROFILES).toEqual({
      'cyber-yellow': {
        label: 'Cyber Yellow',
        tilesetKey: 'cybercity yellow',
        columns: 12,
        rows: 7,
        tileCount: 84,
      },
      'cyber-pink': {
        label: 'Cyber Pink',
        tilesetKey: 'cybercity pink',
        columns: 12,
        rows: 7,
        tileCount: 84,
      },
    });
  });
  it('keeps transformed diagonal ties on Foreground', () => {
    expect(tokens([
      resolveCyberStructureTieTile('cyber-yellow', 'topLeft'),
      resolveCyberStructureTieTile('cyber-yellow', 'topRight'),
      resolveCyberStructureTieTile('cyber-yellow', 'bottomLeft'),
      resolveCyberStructureTieTile('cyber-yellow', 'bottomRight'),
    ])).toEqual(['9XY', '9Y', '9X', '9']);
    expect(resolveCyberStructureTieTile('cyber-yellow', 'topLeft').layer).toBe('foreground');
  });

  it('repeats only neutral Cyber F9 between mirrored F12 caps', () => {
    expect(tokens(resolveCyberPlatformSpan('cyber-yellow', 5))).toEqual([
      '71X', '68', '68', '68', '71',
    ]);
    expect(tokens(resolveCyberPlatformSpan('cyber-pink', 5))).toEqual([
      '71X', '68', '68', '68', '71',
    ]);
    expect(tokens(resolveCyberPlatformSpan('cyber-pink', 8))).toEqual([
      '71X', '68', '68', '68', '68', '68', '68', '71',
    ]);
    expect(resolveCyberPlatformSpan('cyber-yellow', 5).every((tile) => tile.layer === 'terrain')).toBe(true);
    expect(tokens(resolveCyberPlatformSpan('cyber-yellow', 2))).toEqual(['71X', '71']);
    expect(() => resolveCyberPlatformSpan('cyber-yellow', 1)).toThrow(/at least 2/);
  });

  it('fills rubble with local 12 and exposes the Feature-style border vocabulary', () => {
    expect(tokens(resolveCyberRubbleColumn('cyber-yellow', 5))).toEqual([
      '12', '12', '12', '12', '12',
    ]);
    expect(token(resolveCyberRubbleBorderTile('cyber-yellow', 'top'))).toBe('0');
    expect(token(resolveCyberRubbleBorderTile('cyber-yellow', 'bottom'))).toBe('24');
    expect(token(resolveCyberRubbleBorderTile('cyber-yellow', 'left'))).toBe('1');
    expect(token(resolveCyberRubbleBorderTile('cyber-yellow', 'right'))).toBe('13');
    expect(token(resolveCyberRubbleBorderTile('cyber-yellow', 'topLeft', true))).toBe('10X');
    expect(token(resolveCyberRubbleBorderTile(
      'cyber-yellow', 'bottomRight', false, 'background',
    ))).toBe('22');

    const samples = Array.from({ length: 256 }, (_, index) => applyCyberRubbleVariety(
      resolveCyberRubbleColumn('cyber-yellow', 1)[0]!,
      index % 16,
      Math.floor(index / 16),
    ));
    const pinkCount = samples.filter((tile) => tile.styleId === 'cyber-pink').length;
    expect(pinkCount).toBeGreaterThan(0);
    expect(pinkCount).toBeLessThan(samples.length / 2);
    expect(samples.some((tile) => tile.flipX || tile.flipY)).toBe(true);
    expect(applyCyberRubbleVariety(samples[0]!, 0, 0)).toEqual(
      applyCyberRubbleVariety(samples[0]!, 0, 0),
    );
    expect(CYBER_RUBBLE_PINK_PERIOD).toBe(8);
    const tops = Array.from({ length: 64 }, (_, index) => applyCyberRubbleVariety(
      resolveCyberRubbleBorderTile('cyber-yellow', 'top'),
      index,
      0,
      0,
      1,
      cyberRubbleEdgeFlipAxes('top'),
    ));
    expect(tops.every((tile) => !tile.flipY)).toBe(true);
    const sides = Array.from({ length: 64 }, (_, index) => applyCyberRubbleVariety(
      resolveCyberRubbleBorderTile('cyber-yellow', 'left'),
      0,
      index,
      0,
      3,
      cyberRubbleEdgeFlipAxes('left'),
    ));
    expect(sides.every((tile) => !tile.flipX)).toBe(true);
    const corner = applyCyberRubbleVariety(
      resolveCyberRubbleBorderTile('cyber-yellow', 'topLeft', true),
      4,
      7,
      0,
      5,
      cyberRubbleEdgeFlipAxes('topLeft'),
    );
    expect(corner.localIndex).toBe(10);
    expect(corner.flipX).toBe(true);
    expect(corner.flipY).toBe(false);
  });

  it('uses C11Y for window ceilings and transformed A10 Foreground ties', () => {
    expect(tokens([
      resolveCyberTunnelOutlineTile('cyber-yellow', 'ceilingLeft'),
      resolveCyberTunnelOutlineTile('cyber-yellow', 'ceiling'),
      resolveCyberTunnelOutlineTile('cyber-yellow', 'ceilingRight'),
    ])).toEqual(['9', '34Y', '9X']);
    expect([
      resolveCyberTunnelOutlineTile('cyber-yellow', 'ceilingLeft').layer,
      resolveCyberTunnelOutlineTile('cyber-yellow', 'ceiling').layer,
      resolveCyberTunnelOutlineTile('cyber-yellow', 'ceilingRight').layer,
    ]).toEqual(['foreground', 'terrain', 'foreground']);
    expect(tokens([
      resolveCyberTunnelOutlineTile('cyber-yellow', 'left'),
      resolveCyberTunnelOutlineTile('cyber-yellow', 'right'),
      resolveCyberTunnelOutlineTile('cyber-yellow', 'floorLeft'),
      resolveCyberTunnelOutlineTile('cyber-yellow', 'floor'),
      resolveCyberTunnelOutlineTile('cyber-yellow', 'floorRight'),
    ])).toEqual(['21', '23', '9Y', '34', '9XY']);
    expect([
      resolveCyberTunnelOutlineTile('cyber-yellow', 'floorLeft').layer,
      resolveCyberTunnelOutlineTile('cyber-yellow', 'floor').layer,
      resolveCyberTunnelOutlineTile('cyber-yellow', 'floorRight').layer,
    ]).toEqual(['foreground', 'terrain', 'foreground']);
  });

  it('uses exact short fallbacks and repeats 48 in longer vertical support paths', () => {
    expect(tokens(resolveCyberSupportSpan('cyber-yellow', 1))).toEqual(['72']);
    expect(tokens(resolveCyberSupportSpan('cyber-yellow', 2))).toEqual(['60', '72']);
    expect(tokens(resolveCyberSupportSpan('cyber-yellow', 3))).toEqual(['36', '60', '72']);
    expect(tokens(resolveCyberSupportSpan('cyber-yellow', 4))).toEqual(['36', '48', '60', '72']);
    expect(tokens(resolveCyberSupportSpan('cyber-yellow', 6))).toEqual([
      '36', '48', '48', '48', '60', '72',
    ]);
    expect(tokens(resolveCyberSupportSpan('cyber-pink', 3, true))).toEqual(['36X', '60X', '72X']);
    expect(tokens(resolveCyberSupportSpan('cyber-yellow', 4, false, true))).toEqual([
      '36X', '48', '60', '72',
    ]);
    expect(resolveCyberSupportSpan('cyber-yellow', 3).every((tile) => tile.layer === 'background')).toBe(true);
  });

  it('resolves colliding neon strips and foreground fence cells', () => {
    const neon = resolveCyberNeonStrip('cyber-yellow', 5);
    expect(tokens(resolveCyberNeonStrip('cyber-yellow', 3))).toEqual(['49', '50', '51']);
    expect(tokens(neon)).toEqual(['49', '50', '73', '74', '51']);
    expect(tokens(resolveCyberNeonStrip('cyber-pink', 8))).toEqual([
      '49', '50', '73', '74', '75', '76', '50', '51',
    ]);
    expect(neon.every((tile) => tile.layer === 'terrain')).toBe(true);

    expect(() => resolveCyberNeonStrip('cyber-yellow', 2)).toThrow(/at least 3/);
    expect(tokens([
      resolveCyberFenceCell('cyber-yellow', { left: false, right: false, above: false }),
      resolveCyberFenceCell('cyber-yellow', { left: false, right: true, above: true }),
      resolveCyberFenceCell('cyber-yellow', { left: true, right: false, above: true }),
    ])).toEqual(['45', '56', '58']);
  });

  it('never emits a deco-only tile from structural resolvers', () => {
    const structuralTiles = [
      ...resolveCyberPlatformSpan('cyber-yellow', 20),
      ...resolveCyberRubbleColumn('cyber-yellow', 20),
      ...resolveCyberNeonStrip('cyber-yellow', 20),
    ];
    expect(structuralTiles.every((tile) => !DECO_ONLY.has(tile.localIndex))).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import {
  CYBER_DECO_ONLY_LOCAL_INDICES,
  CYBER_FAMILY_DEFINITIONS,
  CYBER_STYLE_PROFILES,
  countCyberEmitters,
  cyberFamiliesConnect,
  getCyberConnectivityKey,
  getCyberDetailEmitterCap,
  getCyberMinimumSize,
  isCyberDecoOnlyLocalIndex,
  isCyberDetailAllowed,
  isCyberEmitterLocalIndex,
  resolveCyberFramedPanel,
  resolveCyberNeonStrip,
  resolveCyberPlatformSpan,
  resolveCyberRubbleArea,
  resolveCyberRubbleBorderTile,
  resolveCyberRubbleColumn,
  resolveCyberStructureRectangle,
  resolveCyberStructureTieTile,
  resolveCyberStructureUnderground,
  resolveCyberStructureTile,
  resolveCyberStructureTile8,
  resolveCyberStructureTopology,
  resolveCyberStructureTopology8,
  resolveCyberSupportSpan,
  resolveCyberTunnelOutlineTile,
  selectCyberDetailCandidates,
  validateCyberFootprint,
  type CyberDetailCandidate,
  type CyberResolvedTile,
  type CyberStyleId,
} from './cyberProfile';

function token(tile: CyberResolvedTile): string {
  return `${tile.localIndex}${tile.flipX ? 'X' : ''}${tile.flipY ? 'Y' : ''}`;
}

function tokens(tiles: readonly CyberResolvedTile[]): string[] {
  return tiles.map(token);
}

function candidate(
  styleId: CyberStyleId,
  localIndex: number,
  x: number,
  y: number,
): CyberDetailCandidate {
  return {
    x,
    y,
    tile: {
      tilesetKey: CYBER_STYLE_PROFILES[styleId].tilesetKey,
      localIndex,
      flipX: false,
      flipY: false,
      layer: 'foreground',
      styleId,
    },
  };
}

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

  it('keeps connectivity separated by both style and family', () => {
    expect(getCyberConnectivityKey('cyber-yellow', 'structure')).toBe('cyber-yellow:structure');
    expect(cyberFamiliesConnect(
      { styleId: 'cyber-yellow', familyId: 'structure' },
      { styleId: 'cyber-yellow', familyId: 'structure' },
    )).toBe(true);
    expect(cyberFamiliesConnect(
      { styleId: 'cyber-yellow', familyId: 'structure' },
      { styleId: 'cyber-pink', familyId: 'structure' },
    )).toBe(false);
    expect(cyberFamiliesConnect(
      { styleId: 'cyber-yellow', familyId: 'structure' },
      { styleId: 'cyber-yellow', familyId: 'rubble' },
    )).toBe(false);
  });

  it('covers all sixteen structure masks with safe terrain outputs', () => {
    const expected = [
      '64', '64', '71X', '25Y',
      '14', '64', '14', '21X',
      '71', '30Y', '15', '62',
      '14X', '23X', '15', '64',
    ];
    for (const styleId of ['cyber-yellow', 'cyber-pink'] as const) {
      const resolved = Array.from({ length: 16 }, (_, neighborMask) => (
        resolveCyberStructureTile({ styleId, neighborMask })
      ));
      expect(tokens(resolved)).toEqual(expected);
      expect(resolved.every((tile) => tile.layer === 'terrain' && tile.styleId === styleId)).toBe(true);
      expect(resolved.every((tile) => !isCyberDecoOnlyLocalIndex(tile.localIndex))).toBe(true);
    }
  });

  it('keeps legacy facade names neutral and rejects malformed masks', () => {
    expect(resolveCyberStructureTopology(6)).toEqual({ neighborMask: 6, role: 'topLeft' });
    expect(token(resolveCyberStructureTile({
      styleId: 'cyber-yellow',
      neighborMask: 6,
      facade: 'plain',
    }))).toBe('14');
    expect(token(resolveCyberStructureTile({
      styleId: 'cyber-yellow',
      neighborMask: 6,
      facade: 'tower',
    }))).toBe('14');
    expect(() => resolveCyberStructureTopology(-1)).toThrow(/0 through 15/);
    expect(() => resolveCyberStructureTopology(16)).toThrow(/0 through 15/);
    expect(() => resolveCyberStructureTopology(1.5)).toThrow(/0 through 15/);
  });

  it('covers every 8-neighbor mask while keeping diagonal ties out of Terrain', () => {
    for (const styleId of ['cyber-yellow', 'cyber-pink'] as const) {
      const resolved = Array.from({ length: 256 }, (_, neighborMask8) => (
        resolveCyberStructureTile8({ styleId, neighborMask8 })
      ));
      expect(resolved).toHaveLength(256);
      expect(resolved.every((tile) => (
        tile.styleId === styleId
        && tile.layer === 'terrain'
        && !isCyberDecoOnlyLocalIndex(tile.localIndex)
      ))).toBe(true);
    }

    expect(resolveCyberStructureTopology8(127).concaveCorner).toBe('topLeft');
    expect(resolveCyberStructureTopology8(253).concaveCorner).toBe('topRight');
    expect(resolveCyberStructureTopology8(223).concaveCorner).toBe('bottomLeft');
    expect(resolveCyberStructureTopology8(247).concaveCorner).toBe('bottomRight');
    expect(token(resolveCyberStructureTile8({ styleId: 'cyber-yellow', neighborMask8: 127 }))).toBe('64');
    expect(token(resolveCyberStructureTile8({ styleId: 'cyber-yellow', neighborMask8: 253 }))).toBe('64');
    expect(token(resolveCyberStructureTile8({ styleId: 'cyber-yellow', neighborMask8: 223 }))).toBe('64');
    expect(token(resolveCyberStructureTile8({ styleId: 'cyber-yellow', neighborMask8: 247 }))).toBe('64');
    expect(tokens([
      resolveCyberStructureTieTile('cyber-yellow', 'topLeft'),
      resolveCyberStructureTieTile('cyber-yellow', 'topRight'),
      resolveCyberStructureTieTile('cyber-yellow', 'bottomLeft'),
      resolveCyberStructureTieTile('cyber-yellow', 'bottomRight'),
    ])).toEqual(['9XY', '9Y', '9X', '9']);
    expect(resolveCyberStructureTieTile('cyber-yellow', 'topLeft').layer).toBe('foreground');
    expect(() => resolveCyberStructureTopology8(256)).toThrow(/0 through 255/);
  });

  it('builds a neutral rectangle from the user-audited Cyber cells', () => {
    const rightTower = resolveCyberStructureRectangle({
      styleId: 'cyber-yellow',
      width: 8,
      height: 16,
      facade: 'tower',
    });
    expect(rightTower.map(tokens)).toEqual([
      ['14', '15', '15', '15', '15', '15', '15', '14X'],
      ...Array.from({ length: 14 }, () => (
        ['21X', '64', '64', '64', '64', '64', '64', '23X']
      )),
      ['25Y', '62', '62', '62', '62', '62', '62', '30Y'],
    ]);
    expect(rightTower.flat().every((tile) => (
      tile.styleId === 'cyber-yellow'
      && tile.layer === 'terrain'
      && !isCyberDecoOnlyLocalIndex(tile.localIndex)
    ))).toBe(true);

    const pinkTower = resolveCyberStructureRectangle({
      styleId: 'cyber-pink',
      width: 8,
      height: 16,
      facade: 'tower',
    });
    expect(pinkTower.map(tokens)).toEqual(rightTower.map(tokens));
    expect(pinkTower.flat().every((tile) => tile.styleId === 'cyber-pink')).toBe(true);

    const worldPhasedReference = resolveCyberStructureRectangle({
      styleId: 'cyber-yellow',
      width: 8,
      height: 16,
      facade: 'tower',
      worldX: 32,
      worldY: 2,
    });
    expect(worldPhasedReference.flat().filter((tile) => [64, 82, 83].includes(tile.localIndex)).length)
      .toBeGreaterThan(0);
    expect(worldPhasedReference.flat().every((tile) => (
      !['19', '31', '37', '38', '41', '61'].includes(String(tile.localIndex))
    ))).toBe(true);
  });

  it('keeps neutral underground variation stable when bounds grow around a world-positioned tile', () => {
    const original = resolveCyberStructureTile8({
      styleId: 'cyber-yellow',
      neighborMask8: 255,
      facade: 'tower',
      x: 2,
      y: 2,
      width: 8,
      height: 16,
      worldX: 34,
      worldY: 4,
    });
    const afterBoundsGrow = resolveCyberStructureTile8({
      styleId: 'cyber-yellow',
      neighborMask8: 255,
      facade: 'tower',
      x: 4,
      y: 5,
      width: 12,
      height: 20,
      worldX: 34,
      worldY: 4,
    });
    expect(afterBoundsGrow).toEqual(original);

    const localPhaseAfterGrowth = resolveCyberStructureTile8({
      styleId: 'cyber-yellow',
      neighborMask8: 255,
      facade: 'tower',
      x: 4,
      y: 5,
      width: 12,
      height: 20,
    });
    expect([64, 82, 83]).toContain(localPhaseAfterGrowth.localIndex);
  });

  it('lets topology own irregular ground edges while center art remains neutral', () => {
    const context = {
      styleId: 'cyber-yellow' as const,
      facade: 'tower' as const,
      y: 1,
      width: 8,
      height: 4,
    };
    const insetLeftEdge = resolveCyberStructureTile({
      ...context,
      neighborMask: 7,
      x: 3,
    });
    const insetRightEdge = resolveCyberStructureTile({
      ...context,
      neighborMask: 13,
      x: 4,
    });
    const centerAtBoundsEdge = resolveCyberStructureTile({
      ...context,
      neighborMask: 15,
      x: 0,
    });

    expect(token(insetLeftEdge)).toBe('21X');
    expect(token(insetRightEdge)).toBe('23X');
    expect(token(centerAtBoundsEdge)).toBe('64');
  });

  it('gives a one-cell-thick roof complete F12 end caps without rotation', () => {
    expect(resolveCyberStructureRectangle({
      styleId: 'cyber-yellow',
      width: 6,
      height: 1,
      facade: 'plain',
    }).map(tokens)).toEqual([
      ['71X', '15', '15', '15', '15', '71'],
    ]);
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
    expect(resolveCyberRubbleArea('cyber-pink', 4, 3).map(tokens)).toEqual([
      ['12', '12', '12', '12'],
      ['12', '12', '12', '12'],
      ['12', '12', '12', '12'],
    ]);
    expect(token(resolveCyberRubbleBorderTile('cyber-yellow', 'top'))).toBe('0');
    expect(token(resolveCyberRubbleBorderTile('cyber-yellow', 'bottom'))).toBe('24');
    expect(token(resolveCyberRubbleBorderTile('cyber-yellow', 'left'))).toBe('1');
    expect(token(resolveCyberRubbleBorderTile('cyber-yellow', 'right'))).toBe('13');
    expect(token(resolveCyberRubbleBorderTile('cyber-yellow', 'topLeft', true))).toBe('10X');
    expect(token(resolveCyberRubbleBorderTile(
      'cyber-yellow', 'bottomRight', false, 'background',
    ))).toBe('22');
  });

  it('uses C11Y for window ceilings and transformed A10 Foreground ties', () => {
    expect([64, 82, 83]).toContain(resolveCyberStructureUnderground('cyber-yellow', 12, 8).localIndex);
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
    expect(tokens(resolveCyberSupportSpan('cyber-yellow', 1))).toEqual(['36']);
    expect(tokens(resolveCyberSupportSpan('cyber-yellow', 2))).toEqual(['36', '60']);
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

  it('resolves colliding neon strips and two-row foreground panels', () => {
    const neon = resolveCyberNeonStrip('cyber-yellow', 5);
    expect(tokens(resolveCyberNeonStrip('cyber-yellow', 3))).toEqual(['49', '50', '51']);
    expect(tokens(neon)).toEqual(['49', '50', '73', '74', '51']);
    expect(tokens(resolveCyberNeonStrip('cyber-pink', 8))).toEqual([
      '49', '50', '73', '74', '75', '76', '50', '51',
    ]);
    expect(neon.every((tile) => tile.layer === 'terrain')).toBe(true);

    const panel = resolveCyberFramedPanel('cyber-pink', 5);
    expect(panel.map(tokens)).toEqual([
      ['44', '45', '45', '45', '46'],
      ['56', '57', '57', '57', '58'],
    ]);
    expect(panel.flat().every((tile) => (
      tile.layer === 'foreground' && isCyberDecoOnlyLocalIndex(tile.localIndex)
    ))).toBe(true);
    expect(() => resolveCyberNeonStrip('cyber-yellow', 2)).toThrow(/at least 3/);
    expect(() => resolveCyberFramedPanel('cyber-pink', 2)).toThrow(/at least 3/);
  });

  it('publishes and validates family minimum footprints', () => {
    expect(getCyberMinimumSize('platform')).toEqual({ width: 2, height: 1 });
    expect(getCyberMinimumSize('framed-panel')).toEqual({ width: 3, height: 2 });
    expect(validateCyberFootprint('structure', 1, 1)).toBeNull();
    expect(validateCyberFootprint('platform', 1, 1)).toMatch(/at least 2 x 1/);
    expect(validateCyberFootprint('platform', 2, 2)).toMatch(/exactly 1 cell tall/);
    expect(validateCyberFootprint('framed-panel', 3, 1)).toMatch(/at least 3 x 2/);
    expect(validateCyberFootprint('framed-panel', 3, 3)).toMatch(/exactly 2 cells tall/);
    expect(validateCyberFootprint('support', 1, 8)).toBeNull();
    expect(validateCyberFootprint('rubble', 0, 1)).toMatch(/positive integers/);
    expect(Object.values(CYBER_FAMILY_DEFINITIONS)).toHaveLength(6);
  });

  it('never emits a deco-only tile from structural resolvers', () => {
    const structuralTiles = [
      ...Array.from({ length: 16 }, (_, neighborMask) => (
        resolveCyberStructureTile({ styleId: 'cyber-yellow', neighborMask })
      )),
      ...resolveCyberStructureRectangle({ styleId: 'cyber-pink', width: 11, height: 19 }).flat(),
      ...resolveCyberPlatformSpan('cyber-yellow', 20),
      ...resolveCyberRubbleColumn('cyber-yellow', 20),
      ...resolveCyberSupportSpan('cyber-pink', 20),
      ...resolveCyberNeonStrip('cyber-yellow', 20),
    ];
    expect(structuralTiles.every((tile) => !CYBER_DECO_ONLY_LOCAL_INDICES.includes(
      tile.localIndex as typeof CYBER_DECO_ONLY_LOCAL_INDICES[number],
    ))).toBe(true);
  });

  it('uses a curated detail allowlist and style-aware emission metadata', () => {
    expect(isCyberDetailAllowed('cyber-yellow', 2)).toBe(true);
    expect(isCyberDetailAllowed('cyber-pink', 4)).toBe(true);
    expect(isCyberDetailAllowed('cyber-pink', 58)).toBe(false);
    expect(isCyberDetailAllowed('cyber-yellow', 12)).toBe(false);
    expect(isCyberDetailAllowed('cyber-yellow', 24)).toBe(false);
    expect(isCyberDetailAllowed('cyber-yellow', 38)).toBe(false);
    expect(isCyberEmitterLocalIndex('cyber-yellow', 44)).toBe(false);
    expect(isCyberEmitterLocalIndex('cyber-pink', 44)).toBe(true);
    expect(isCyberEmitterLocalIndex('cyber-yellow', 50)).toBe(true);
  });

  it('caps optional emitters deterministically while preserving non-emitting details', () => {
    const candidates = [
      candidate('cyber-pink', 2, 1, 1),
      candidate('cyber-pink', 3, 2, 1),
      candidate('cyber-pink', 2, 3, 1),
      candidate('cyber-pink', 3, 1, 2),
      candidate('cyber-pink', 2, 2, 2),
      candidate('cyber-pink', 3, 3, 2),
      candidate('cyber-pink', 4, 4, 1),
      candidate('cyber-yellow', 5, 5, 1),
      candidate('cyber-pink', 44, 5, 2),
      candidate('cyber-yellow', 38, 6, 1),
    ];
    const selected = selectCyberDetailCandidates(candidates, 129);
    const reversed = selectCyberDetailCandidates([...candidates].reverse(), 129);
    const keys = (values: readonly CyberDetailCandidate[]) => values
      .map(({ x, y, tile }) => `${x},${y}:${tile.styleId}:${tile.localIndex}`)
      .sort();

    expect(keys(selected)).toEqual(keys(reversed));
    expect(countCyberEmitters(selected)).toBe(3);
    expect(selected.some(({ tile }) => tile.styleId === 'cyber-pink' && tile.localIndex === 4)).toBe(true);
    expect(selected.some(({ tile }) => tile.styleId === 'cyber-yellow' && tile.localIndex === 5)).toBe(true);
    expect(selected.some(({ tile }) => tile.localIndex === 44)).toBe(false);
    expect(selected.some(({ tile }) => tile.localIndex === 38)).toBe(false);
    expect(countCyberEmitters(selectCyberDetailCandidates(candidates, 0))).toBe(0);
    expect(getCyberDetailEmitterCap(0)).toBe(0);
    expect(getCyberDetailEmitterCap(1)).toBe(1);
    expect(getCyberDetailEmitterCap(64)).toBe(1);
    expect(getCyberDetailEmitterCap(65)).toBe(2);
    expect(getCyberDetailEmitterCap(128)).toBe(2);
    expect(getCyberDetailEmitterCap(129)).toBe(3);
    expect(() => selectCyberDetailCandidates(candidates, -1)).toThrow(/non-negative integer/);
  });
});

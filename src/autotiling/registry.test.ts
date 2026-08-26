import { describe, expect, it } from 'vitest';
import { TILE_FLIP_X_FLAG, TILE_FLIP_Y_FLAG } from '../config/room';
import { getTilesetByKey } from '../config/tilesets';
import {
  SMART_RULE_KINDS,
  SMART_STYLE_DEFINITIONS,
  getSmartThemeDefinition,
  getSmartBrushDefinition,
  getSmartBrushesForTheme,
  getSmartStylesForTheme,
  isSmartBrushToolSupported,
  isSmartStyleLocalIndex,
  resolveSmartTileValue,
} from './registry';

describe('smart authoring registry', () => {
  it('derives style geometry from each registered tileset instead of assuming 72 tiles', () => {
    expect(SMART_STYLE_DEFINITIONS.forest).toMatchObject({ columns: 12, rows: 6, tileCount: 72 });
    expect(SMART_STYLE_DEFINITIONS['cyber-yellow']).toMatchObject({
      tilesetKey: 'cybercity yellow',
      columns: 12,
      rows: 7,
      tileCount: 84,
    });
    expect(SMART_STYLE_DEFINITIONS['cyber-pink']).toMatchObject({
      tilesetKey: 'cybercity pink',
      columns: 12,
      rows: 7,
      tileCount: 84,
    });
    expect(getTilesetByKey('backrooms')).toMatchObject({
      columns: 12,
      rows: 10,
      tileCount: 120,
    });
    expect(getTilesetByKey('wampos95')).toMatchObject({
      columns: 12,
      rows: 27,
      tileCount: 324,
    });
  });

  it('validates local indices against each style tile count', () => {
    expect(isSmartStyleLocalIndex('cyber-yellow', 83)).toBe(true);
    expect(isSmartStyleLocalIndex('cyber-yellow', 84)).toBe(false);
    expect(isSmartStyleLocalIndex('forest', 71)).toBe(true);
    expect(isSmartStyleLocalIndex('forest', 72)).toBe(false);
    expect(isSmartStyleLocalIndex('forest', 1.5)).toBe(false);
  });

  it('encodes style overrides and independent X/Y flips in resolved output', () => {
    const pinkFirstGid = getTilesetByKey('cybercity pink')!.firstGid;
    expect(resolveSmartTileValue('cyber-yellow', {
      styleId: 'cyber-pink',
      tilesetKey: 'cybercity pink',
      layer: 'terrain',
      localIndex: 64,
      flipX: true,
      flipY: true,
    })).toBe(pinkFirstGid + 64 + TILE_FLIP_X_FLAG + TILE_FLIP_Y_FLAG);
    expect(() => resolveSmartTileValue('forest', {
      tilesetKey: 'forest',
      layer: 'terrain',
      localIndex: 82,
    })).toThrow(RangeError);
    expect(() => resolveSmartTileValue('cyber-yellow', {
      tilesetKey: 'cybercity pink',
      layer: 'terrain',
      localIndex: 15,
    })).toThrow(/requested tileset/);
  });

  it('uses the public rule vocabulary and exposes runtime resolver metadata', () => {
    expect(SMART_RULE_KINDS).toEqual(['terrain', 'path', 'span', 'rectangle', 'stamp']);
    expect(getSmartBrushDefinition('cyber.concrete')).toMatchObject({
      label: 'Concrete',
      ruleKind: 'terrain',
      algorithm: 'blob-8way',
      resolverKey: 'cyber.concrete',
      collisionRole: 'solid',
      defaultLayer: 'terrain',
      compatibleLegacyLocalIndices: expect.arrayContaining([14, 15, 20, 64, 83]),
      outputLayers: ['terrain', 'foreground'],
    });
    expect(getSmartBrushDefinition('cyber.rubble').outputLayers).toEqual(['terrain', 'foreground']);
  });

  it('declares Cyber layers and authoring tools for Theme to Brush to Color UI', () => {
    expect(getSmartStylesForTheme('cyber').map(({ id }) => id)).toEqual(['cyber-yellow', 'cyber-pink']);
    expect(getSmartBrushesForTheme('cyber').map(({ id }) => id)).toEqual([
      'cyber.concrete',
      'cyber.windows',
      'cyber.shell',
      'cyber.rubble',
      'cyber.support',
      'cyber.neon',
      'cyber.fence',
    ]);
    expect(getSmartBrushDefinition('cyber.support')).toMatchObject({
      defaultLayer: 'background',
      supportedLayers: ['background', 'terrain', 'foreground'],
      outputLayers: ['background'],
    });
    expect(getSmartBrushDefinition('cyber.neon')).toMatchObject({
      defaultLayer: 'terrain',
      supportedLayers: ['background', 'terrain', 'foreground'],
      outputLayers: ['terrain', 'foreground'],
    });
    expect(getSmartBrushDefinition('cyber.fence')).toMatchObject({
      defaultLayer: 'foreground',
      supportedLayers: ['background', 'terrain', 'foreground'],
      outputLayers: ['foreground'],
    });
    expect(isSmartBrushToolSupported('cyber.concrete', 'fill')).toBe(true);
    expect(isSmartBrushToolSupported('cyber.windows', 'fill')).toBe(true);
    expect(isSmartBrushToolSupported('cyber.fence', 'line')).toBe(true);
  });

  it('lists only theme-qualified canonical brushes for every legacy theme', () => {
    expect(getSmartThemeDefinition('forest')).toMatchObject({
      defaultBrushId: 'forest.ground',
      brushIds: ['forest.ground', 'forest.platform', 'forest.feature'],
    });
    expect(getSmartThemeDefinition('desert')).toMatchObject({
      defaultBrushId: 'desert.ground',
      brushIds: ['desert.ground', 'desert.platform', 'desert.feature'],
    });
    expect(getSmartThemeDefinition('cave').brushIds).toEqual([
      'cave.ground', 'cave.platform', 'cave.feature',
    ]);
    expect(getSmartThemeDefinition('gothic').brushIds).toEqual([
      'gothic.ground', 'gothic.platform', 'gothic.feature',
    ]);
    expect(getSmartThemeDefinition('water')).toMatchObject({
      defaultBrushId: 'water.tunnel',
      brushIds: ['water.tunnel'],
    });
    expect(getSmartBrushDefinition('desert.ground')).toMatchObject({
      id: 'desert.ground',
      resolverKey: 'legacy.ground',
      supportedThemeIds: ['desert'],
      supportedStyleIds: ['desert'],
    });
  });
});

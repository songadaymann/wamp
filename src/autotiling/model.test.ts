import { describe, expect, it } from 'vitest';
import { TILE_FLIP_X_FLAG, TILE_FLIP_Y_FLAG } from '../config/room';
import {
  SMART_LEGACY_BRUSH_IDS,
  SMART_TERRAIN_VERSION,
  cloneRoomSmartTerrainState,
  createRoomSmartTerrainState,
  getLegacySmartBrushIdentity,
  getSmartLegacyBrushId,
  isRoomSmartTerrainEditingDisabled,
  migrateRoomSmartTerrainStateV1,
  normalizeRoomSmartTerrainState,
  serializeRoomSmartTerrainState,
  smartOwnedOutputKey,
  smartSemanticCellKey,
} from './model';

describe('smart authoring persistence model', () => {
  it('creates an editable, empty v2 state with compatibility views', () => {
    expect(createRoomSmartTerrainState()).toEqual({
      version: SMART_TERRAIN_VERSION,
      editingDisabled: false,
      detailsEnabled: true,
      semanticCells: {},
      recipes: {},
      ownedOutputs: {},
      suppressedOutputParts: [],
      cells: {},
      backdropCells: {},
      generatedDecorations: {},
      generatedBackgroundDecorations: {},
      suppressedDecorationSlots: [],
    });
  });

  it('explicitly migrates v1 cells and generated decorations to layer-aware v2 mirrors', () => {
    const lockedValue = 25 + TILE_FLIP_X_FLAG;
    const shapeValue = 41 + TILE_FLIP_Y_FLAG;
    const decorationValue = 50 + TILE_FLIP_X_FLAG + TILE_FLIP_Y_FLAG;
    const migrated = migrateRoomSmartTerrainStateV1({
      version: 1,
      detailsEnabled: false,
      cells: {
        '4,5': { theme: 'desert', material: 'ground', lockedGid: lockedValue, shapeGid: shapeValue },
      },
      backdropCells: {
        '6,7': { theme: 'water', material: 'tunnel' },
      },
      generatedDecorations: {
        '4,4': { ownerKey: '4,5', slot: 'top', gid: 50, value: decorationValue },
      },
      generatedBackgroundDecorations: {},
      suppressedDecorationSlots: ['4,5:top'],
    });

    expect(migrated.version).toBe(2);
    expect(migrated.detailsEnabled).toBe(false);
    expect(migrated.cells['4,5']).toMatchObject({
      styleId: 'desert',
      brushId: 'desert.ground',
      lockedGid: lockedValue,
      lockedValue,
      shapeGid: shapeValue,
      shapeValue,
    });
    expect(migrated.semanticCells[smartSemanticCellKey('terrain', 4, 5)]).toEqual({
      styleId: 'desert',
      brushId: 'desert.ground',
      lockedValue,
      shapeValue,
      legacySource: true,
    });
    expect(migrated.semanticCells[smartSemanticCellKey('background', 6, 7)]).toEqual({
      styleId: 'water',
      brushId: 'water.tunnel',
      legacySource: true,
    });
    expect(migrated.ownedOutputs[smartOwnedOutputKey('foreground', 4, 4)]).toEqual({
      ownerId: 'legacy-cell:4,5',
      partId: 'top',
      kind: 'legacy-decoration',
      layer: 'foreground',
      value: decorationValue,
    });
    expect(migrated.suppressedOutputParts).toEqual(['legacy-cell:4,5:top']);
  });

  it('canonicalizes transient generic v2 aliases when the style identifies one legacy brush', () => {
    const normalized = normalizeRoomSmartTerrainState({
      version: 2,
      semanticCells: {
        'terrain:1,1': { styleId: 'desert', brushId: 'ground' },
        'terrain:2,1': { styleId: 'gothic', brushId: 'platform' },
        'background:3,1': { styleId: 'water', brushId: 'tunnel' },
        'terrain:4,1': { styleId: 'cyber-yellow', brushId: 'ground' },
      },
      recipes: {
        feature: {
          recipeId: 'legacy.feature',
          styleId: 'cave',
          brushId: 'feature',
          anchor: { layer: 'terrain', x: 5, y: 1 },
          sourceCells: [{ layer: 'terrain', x: 5, y: 1 }],
          parameters: {},
        },
      },
    });

    expect(normalized.semanticCells['terrain:1,1']?.brushId).toBe('desert.ground');
    expect(normalized.semanticCells['terrain:2,1']?.brushId).toBe('gothic.platform');
    expect(normalized.semanticCells['background:3,1']?.brushId).toBe('water.tunnel');
    expect(normalized.semanticCells['terrain:4,1']).toBeUndefined();
    expect(normalized.recipes.feature?.brushId).toBe('cave.feature');
  });

  it('exports explicit canonical legacy brush mappings in both directions', () => {
    expect(SMART_LEGACY_BRUSH_IDS).toEqual([
      'forest.ground', 'forest.platform', 'forest.feature',
      'desert.ground', 'desert.platform', 'desert.feature',
      'cave.ground', 'cave.platform', 'cave.feature',
      'gothic.ground', 'gothic.platform', 'gothic.feature',
      'water.tunnel',
    ]);
    expect(getSmartLegacyBrushId('forest', 'feature')).toBe('forest.feature');
    expect(getSmartLegacyBrushId('water', 'tunnel')).toBe('water.tunnel');
    expect(getSmartLegacyBrushId('desert', 'tunnel')).toBeNull();
    expect(getLegacySmartBrushIdentity('gothic.platform')).toEqual({
      theme: 'gothic',
      material: 'platform',
    });
    expect(getLegacySmartBrushIdentity('cyber.structure')).toBeNull();
  });

  it('keeps three semantic sources at one coordinate distinct by layer', () => {
    const input = createRoomSmartTerrainState();
    input.semanticCells = {
      'background:8,9': { styleId: 'cyber-pink', brushId: 'cyber.support' },
      'terrain:8,9': { styleId: 'cyber-yellow', brushId: 'cyber.structure' },
      'foreground:8,9': { styleId: 'cyber-pink', brushId: 'cyber.framed-panel' },
    };

    const normalized = normalizeRoomSmartTerrainState(input);
    expect(Object.keys(normalized.semanticCells)).toEqual([
      'background:8,9',
      'terrain:8,9',
      'foreground:8,9',
    ]);
  });

  it('filters known v2 semantic cells with incompatible brush, style, or source layers', () => {
    const invalidLockedValue = 1633 + 37 + TILE_FLIP_X_FLAG;
    const normalized = normalizeRoomSmartTerrainState({
      version: 2,
      semanticCells: {
        'background:1,1': {
          styleId: 'cyber-yellow',
          brushId: 'cyber.structure',
          lockedValue: invalidLockedValue,
        },
        'terrain:2,1': { styleId: 'desert', brushId: 'cyber.structure' },
        'terrain:3,1': { styleId: 'desert', brushId: 'forest.ground' },
        'terrain:4,1': { styleId: 'cyber-pink', brushId: 'desert.ground' },
        'terrain:5,1': {
          styleId: 'cyber-pink',
          brushId: 'cyber.structure',
          lockedValue: 1717 + 37 + TILE_FLIP_Y_FLAG,
        },
        'background:6,1': { styleId: 'cyber-yellow', brushId: 'cyber.support' },
        'foreground:7,1': { styleId: 'cyber-pink', brushId: 'cyber.framed-panel' },
        'terrain:8,1': { styleId: 'gothic', brushId: 'gothic.ground' },
      },
    });

    expect(normalized.semanticCells).toEqual({
      'terrain:5,1': {
        styleId: 'cyber-pink',
        brushId: 'cyber.structure',
        lockedValue: 1717 + 37 + TILE_FLIP_Y_FLAG,
      },
      'background:6,1': { styleId: 'cyber-yellow', brushId: 'cyber.support' },
      'foreground:7,1': { styleId: 'cyber-pink', brushId: 'cyber.framed-panel' },
      'terrain:8,1': { styleId: 'gothic', brushId: 'gothic.ground' },
    });
    expect(normalized.backdropCells['1,1']).toBeUndefined();
  });

  it('rejects recipes whose brush, style, anchor, or source-cell layer is incompatible', () => {
    const panel = {
      recipeId: 'cyber.framed-panel',
      styleId: 'cyber-pink',
      brushId: 'cyber.framed-panel',
      anchor: { layer: 'foreground', x: 4, y: 5 },
      sourceCells: [4, 5, 6].map((x) => ({ layer: 'foreground', x, y: 5 })),
      parameters: { width: 3, height: 2 },
    };
    const normalized = normalizeRoomSmartTerrainState({
      version: 2,
      recipes: {
        validPanel: panel,
        wrongAnchorLayer: {
          ...panel,
          anchor: { layer: 'terrain', x: 4, y: 5 },
        },
        wrongSourceLayer: {
          ...panel,
          sourceCells: [{ layer: 'terrain', x: 4, y: 5 }],
        },
        wrongCyberStyle: {
          ...panel,
          styleId: 'desert',
        },
        wrongLegacyStyle: {
          recipeId: 'legacy.feature',
          styleId: 'cave',
          brushId: 'desert.feature',
          anchor: { layer: 'terrain', x: 8, y: 5 },
          sourceCells: [{ layer: 'terrain', x: 8, y: 5 }],
          parameters: {},
        },
        validLegacyAlias: {
          recipeId: 'legacy.feature',
          styleId: 'cave',
          brushId: 'feature',
          anchor: { layer: 'terrain', x: 9, y: 5 },
          sourceCells: [{ layer: 'terrain', x: 9, y: 5 }],
          parameters: {},
        },
      },
    });

    expect(Object.keys(normalized.recipes)).toEqual(['validPanel', 'validLegacyAlias']);
    expect(normalized.recipes.validPanel).toEqual(panel);
    expect(normalized.recipes.validLegacyAlias?.brushId).toBe('cave.feature');
  });

  it('preserves an unknown future payload and disables editing without nesting on reclone', () => {
    const raw = {
      version: 99,
      detailsEnabled: false,
      futureFeature: { nested: ['kept'] },
      semanticCells: { 'terrain:1,2': { styleId: 'future', brushId: 'future' } },
    };
    const normalized = normalizeRoomSmartTerrainState(raw);

    expect(normalized.version).toBe(99);
    expect(isRoomSmartTerrainEditingDisabled(normalized)).toBe(true);
    expect(normalized.editingDisabledReason).toContain('newer than supported version 2');
    expect(normalized.preservedFutureState).toEqual(raw);
    expect(normalized.semanticCells).toEqual({});

    raw.futureFeature.nested[0] = 'mutated';
    expect(normalized.preservedFutureState?.futureFeature).toEqual({ nested: ['kept'] });
    const cloned = cloneRoomSmartTerrainState(normalized);
    expect(cloned.preservedFutureState).toEqual(normalized.preservedFutureState);
    expect((cloned.preservedFutureState as Record<string, unknown>).preservedFutureState).toBeUndefined();
    expect(serializeRoomSmartTerrainState(cloned)).toEqual({
      version: 99,
      detailsEnabled: false,
      futureFeature: { nested: ['kept'] },
      semanticCells: { 'terrain:1,2': { styleId: 'future', brushId: 'future' } },
    });
  });

  it('rebuilds stale legacy mirrors and gives the legacy writable alias precedence', () => {
    const state = migrateRoomSmartTerrainStateV1({
      version: 1,
      cells: {
        '1,1': { theme: 'forest', material: 'ground', lockedGid: 17, lockedValue: 29 },
      },
    });
    expect(state.semanticCells['terrain:1,1']?.lockedValue).toBe(17);

    delete state.cells['1,1'];
    const normalized = normalizeRoomSmartTerrainState(state);
    expect(normalized.semanticCells['terrain:1,1']).toBeUndefined();
  });

  it('normalizes and deeply clones recipe state and exact owned output values', () => {
    const encodedValue = 1633 + 64 + TILE_FLIP_Y_FLAG;
    const state = createRoomSmartTerrainState();
    state.recipes.tower = {
      recipeId: 'cyber.structure.tower',
      styleId: 'cyber-yellow',
      brushId: 'cyber.structure',
      anchor: { layer: 'terrain', x: 2, y: 3 },
      sourceCells: [{ layer: 'terrain', x: 2, y: 3 }],
      parameters: { width: 8, facade: 'tower', details: true },
    };
    state.ownedOutputs['terrain:2,3'] = {
      ownerId: 'tower',
      partId: 'top-left',
      kind: 'recipe',
      layer: 'terrain',
      value: encodedValue,
    };

    const cloned = cloneRoomSmartTerrainState(state);
    expect(cloned.recipes.tower).toEqual(state.recipes.tower);
    expect(cloned.recipes.tower).not.toBe(state.recipes.tower);
    expect(cloned.recipes.tower.anchor).not.toBe(state.recipes.tower.anchor);
    expect(cloned.ownedOutputs['terrain:2,3']?.value).toBe(encodedValue);
  });
});

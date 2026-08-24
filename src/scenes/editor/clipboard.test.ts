import { describe, expect, it } from 'vitest';
import {
  createRoomSmartTerrainState,
  smartOwnedOutputKey,
  smartOwnedOutputPartKey,
  smartSemanticCellKey,
} from '../../autotiling/model';
import {
  buildEditorClipboardState,
  cloneEditorClipboardState,
  planEditorClipboardPaste,
  planEditorSmartClipboardPaste,
} from './clipboard';

describe('editor clipboard planning', () => {
  it('normalizes reversed bounds, clamps to the room, and retains sparse cells', () => {
    const state = buildEditorClipboardState('terrain', 3, 2, -2, -1, (x, y) =>
      x === 1 && y === 1 ? -1 : y * 100 + x,
    );
    expect(state).toEqual({
      sourceLayer: 'terrain',
      width: 4,
      height: 3,
      tiles: [[0, 1, 2, 3], [100, -1, 102, 103], [200, 201, 202, 203]],
      occupiedMask: [
        [true, true, true, true],
        [true, false, true, true],
        [true, true, true, true],
      ],
    });
  });

  it('rejects an empty selection and plans only occupied in-bounds paste writes', () => {
    expect(buildEditorClipboardState('foreground', 0, 0, 1, 1, () => -1)).toBeNull();
    const state = buildEditorClipboardState('terrain', 0, 0, 1, 1, (x, y) =>
      x === 0 && y === 0 ? -1 : y * 10 + x + 1,
    );
    expect(planEditorClipboardPaste(state!, 39, 20)).toEqual([
      { x: 39, y: 21, encodedTileValue: 11 },
    ]);
  });

  it('deep-clones clipboard rows for cross-room reuse', () => {
    const state = buildEditorClipboardState(
      'terrain', 0, 0, 1, 0, (x) => x + 1,
      (x) => x === 0 ? { theme: 'forest', material: 'ground', lockedGid: 61 } : undefined,
    )!;
    const clone = cloneEditorClipboardState(state)!;
    clone.tiles[0][0] = 999;
    clone.occupiedMask[0][0] = false;
    clone.smartCells!['0,0'].lockedGid = 99;
    expect(state.tiles[0][0]).toBe(1);
    expect(state.occupiedMask[0][0]).toBe(true);
    expect(state.smartCells).toEqual({
      '0,0': { theme: 'forest', material: 'ground', lockedGid: 61 },
    });
  });

  it('copies native Cyber semantics relative to normalized bounds with full encoded transforms', () => {
    const smartTerrain = createRoomSmartTerrainState();
    const lockedValue = 0xc000004d;
    const sourceKey = smartSemanticCellKey('terrain', 5, 6);
    smartTerrain.semanticCells[sourceKey] = {
      styleId: 'cyber-yellow',
      brushId: 'cyber.structure',
      lockedValue,
      shapeValue: 0x4000004e,
    };
    smartTerrain.suppressedOutputParts = [
      smartOwnedOutputPartKey(`cyber:cell:${sourceKey}`, 'detail'),
    ];

    const state = buildEditorClipboardState(
      'terrain', 6, 7, 4, 5, () => 100, undefined, smartTerrain,
    )!;
    expect(state.smartSemanticCells).toEqual({
      '1,1': {
        styleId: 'cyber-yellow',
        brushId: 'cyber.structure',
        lockedValue,
        shapeValue: 0x4000004e,
      },
    });
    expect(state.smartSemanticSuppressions).toEqual({ '1,1': ['detail'] });

    expect(planEditorSmartClipboardPaste(state, 10, 11, 'terrain')).toEqual({
      semanticCells: [{
        layer: 'terrain',
        x: 11,
        y: 12,
        cell: {
          styleId: 'cyber-yellow',
          brushId: 'cyber.structure',
          lockedValue,
          shapeValue: 0x4000004e,
        },
        suppressedPartIds: ['detail'],
      }],
      recipes: [],
    });
    expect(planEditorSmartClipboardPaste(state, 10, 11, 'background')).toEqual({
      semanticCells: [], recipes: [],
    });
  });

  it('keeps a complete framed-panel recipe but treats partial selections as baked manual tiles', () => {
    const smartTerrain = createRoomSmartTerrainState();
    smartTerrain.recipes['cyber-panel-7'] = {
      recipeId: 'cyber.framed-panel',
      styleId: 'cyber-pink',
      brushId: 'cyber.framed-panel',
      anchor: { layer: 'foreground', x: 4, y: 5 },
      sourceCells: [4, 5, 6].map((x) => ({ layer: 'foreground' as const, x, y: 5 })),
      parameters: { width: 3, height: 2 },
    };
    for (let dy = 0; dy < 2; dy += 1) {
      for (let dx = 0; dx < 3; dx += 1) {
        const partId = `row-${dy}:column-${dx}`;
        smartTerrain.ownedOutputs[smartOwnedOutputKey('foreground', 4 + dx, 5 + dy)] = {
          ownerId: 'cyber:recipe:cyber-panel-7',
          partId,
          kind: 'recipe',
          layer: 'foreground',
          value: 200 + dy * 10 + dx,
        };
      }
    }
    smartTerrain.suppressedOutputParts = [
      smartOwnedOutputPartKey('cyber:recipe:cyber-panel-7', 'row-1:column-1'),
    ];

    const complete = buildEditorClipboardState(
      'foreground', 4, 5, 6, 6, (x, y) => 200 + (y - 5) * 10 + (x - 4),
      undefined, smartTerrain,
    )!;
    expect(complete.smartRecipes).toHaveLength(1);
    expect(complete.smartRecipes?.[0]).toMatchObject({
      sourceInstanceId: 'cyber-panel-7',
      sourceOwnerId: 'cyber:recipe:cyber-panel-7',
      recipe: {
        anchor: { layer: 'foreground', x: 0, y: 0 },
        sourceCells: [
          { layer: 'foreground', x: 0, y: 0 },
          { layer: 'foreground', x: 1, y: 0 },
          { layer: 'foreground', x: 2, y: 0 },
        ],
      },
      suppressedPartIds: ['row-1:column-1'],
    });
    expect(complete.smartRecipes?.[0]?.footprint).toHaveLength(6);

    const paste = planEditorSmartClipboardPaste(complete, 20, 10, 'foreground');
    expect(paste.recipes).toHaveLength(1);
    expect(paste.recipes[0]?.recipe.anchor).toEqual({ layer: 'foreground', x: 20, y: 10 });
    expect(paste.recipes[0]?.recipe.sourceCells).toEqual([
      { layer: 'foreground', x: 20, y: 10 },
      { layer: 'foreground', x: 21, y: 10 },
      { layer: 'foreground', x: 22, y: 10 },
    ]);

    const missingBottomRow = buildEditorClipboardState(
      'foreground', 4, 5, 6, 5, (x) => 200 + x, undefined, smartTerrain,
    )!;
    expect(missingBottomRow.smartRecipes).toBeUndefined();
    expect(missingBottomRow.tiles).toEqual([[204, 205, 206]]);

    const missingRightEdge = buildEditorClipboardState(
      'foreground', 4, 5, 5, 6, () => 200, undefined, smartTerrain,
    )!;
    expect(missingRightEdge.smartRecipes).toBeUndefined();

    expect(planEditorSmartClipboardPaste(complete, 39, 21, 'foreground').recipes).toEqual([]);
  });

  it('deep-clones v2 semantic, suppression, and recipe payloads', () => {
    const smartTerrain = createRoomSmartTerrainState();
    smartTerrain.semanticCells[smartSemanticCellKey('foreground', 1, 1)] = {
      styleId: 'cyber-pink', brushId: 'cyber.framed-panel', lockedValue: 123,
    };
    smartTerrain.recipes.panel = {
      recipeId: 'cyber.framed-panel',
      styleId: 'cyber-pink',
      brushId: 'cyber.framed-panel',
      anchor: { layer: 'foreground', x: 1, y: 1 },
      sourceCells: [{ layer: 'foreground', x: 1, y: 1 }],
      parameters: { width: 1, height: 1 },
    };
    smartTerrain.ownedOutputs[smartOwnedOutputKey('foreground', 1, 1)] = {
      ownerId: 'cyber:recipe:panel', partId: 'only', kind: 'recipe', layer: 'foreground', value: 123,
    };
    smartTerrain.suppressedOutputParts = [
      smartOwnedOutputPartKey(
        `cyber:cell:${smartSemanticCellKey('foreground', 1, 1)}`,
        'detail',
      ),
      smartOwnedOutputPartKey('cyber:recipe:panel', 'only'),
    ];
    const state = buildEditorClipboardState(
      'foreground', 1, 1, 1, 1, () => 123, undefined, smartTerrain,
    )!;
    const clone = cloneEditorClipboardState(state)!;
    clone.smartSemanticCells!['0,0']!.lockedValue = 999;
    clone.smartSemanticSuppressions!['0,0']![0] = 'changed';
    clone.smartRecipes![0]!.recipe.anchor.x = 9;
    clone.smartRecipes![0]!.recipe.sourceCells[0]!.x = 9;
    clone.smartRecipes![0]!.recipe.parameters.width = 9;
    clone.smartRecipes![0]!.footprint[0]!.x = 9;
    clone.smartRecipes![0]!.suppressedPartIds[0] = 'changed';

    expect(state.smartSemanticCells!['0,0']!.lockedValue).toBe(123);
    expect(state.smartSemanticSuppressions!['0,0']).toEqual(['detail']);
    expect(state.smartRecipes![0]!.recipe.anchor.x).toBe(0);
    expect(state.smartRecipes![0]!.recipe.sourceCells[0]!.x).toBe(0);
    expect(state.smartRecipes![0]!.recipe.parameters.width).toBe(1);
    expect(state.smartRecipes![0]!.footprint[0]!.x).toBe(0);
    expect(state.smartRecipes![0]!.suppressedPartIds).toEqual(['only']);
  });
});

/** Cyber span, support, and panel recipe rendering. */
import type { RoomTileData } from '../persistence/roomModel';
import type { CyberStyleId } from './cyberProfile';
import {
  CYBER_PANEL_RECIPE_ID,
  isCyberSpanBrushId,
  isCyberStyleId,
} from './cyberRecipeFamily';
import {
  getCyberFamilyMinimumWidth,
  resolveCyberFramedPanelTiles,
  resolveCyberHorizontalMiddleTile,
  resolveCyberLinearFamilyTiles,
} from './cyberSpanResolver';
import { isCyberLetterBrushId } from './cyberEdgeMatcher';
import {
  smartSemanticCellKey,
  type RoomSmartTerrainState,
  type SmartRecipeInstanceState,
} from './model';
import {
  addOwnedOutput,
  clearOwnerSuppressions,
  inBounds,
  type Bounds,
  type CyberSemanticEntry,
} from './cyberRecipeState';
import {
  contiguousRuns,
  extendRunThroughLegacy,
} from './cyberSemanticResolver';

export function recipeBounds(recipe: SmartRecipeInstanceState): Bounds | null {
  return recipe.sourceCells.length > 0 ? recipe.bounds : null;
}
function recipeEntries(recipe: SmartRecipeInstanceState): CyberSemanticEntry[] {
  return recipe.sourceCells.map(({ layer, x, y }) => ({
    semanticKey: smartSemanticCellKey(layer, x, y),
    layer,
    x,
    y,
    cell: { styleId: recipe.styleId, brushId: recipe.brushId },
  }));
}

function resolveHorizontalSpanRecipe(
  tileData: RoomTileData,
  state: RoomSmartTerrainState,
  recipe: SmartRecipeInstanceState,
  familyId: 'platform' | 'neon-strip',
): void {
  const bounds = recipe.bounds;
  for (const run of contiguousRuns(recipeEntries(recipe), 'horizontal')) {
    const { before, after } = extendRunThroughLegacy(tileData, state, run, 'horizontal');
    const totalLength = before + run.length + after;
    const minimum = getCyberFamilyMinimumWidth(familyId);
    if (totalLength < minimum) continue;
    const resolved = resolveCyberLinearFamilyTiles(
      familyId,
      recipe.styleId as CyberStyleId,
      totalLength,
    );
    run.forEach((entry, index) => {
      const isLeftEnd = index === 0 && before === 0;
      const isRightEnd = index === run.length - 1 && after === 0;
      const sourceOffset = entry.x - bounds.minX;
      const tile = isLeftEnd
        ? resolved[0]!
        : isRightEnd
          ? resolved[resolved.length - 1]!
          : resolveCyberHorizontalMiddleTile(
              familyId,
              recipe.styleId as CyberStyleId,
              sourceOffset,
            );
      addOwnedOutput(
        tileData,
        state,
        recipe.ownerId,
        `row-${entry.y - bounds.minY}:column-${sourceOffset}`,
        'recipe',
        entry.x,
        entry.y,
        tile,
        true,
        { brushId: recipe.brushId, sourceLayer: recipe.anchor.layer },
      );
    });
  }
}

function resolveSupportRecipe(
  tileData: RoomTileData,
  state: RoomSmartTerrainState,
  recipe: SmartRecipeInstanceState,
): void {
  const bounds = recipe.bounds;
  const entries = recipeEntries(recipe);
  const isMultiColumn = bounds.width > 1;
  for (const run of contiguousRuns(entries, 'vertical')) {
    const normalizedColumn = run[0]!.x - bounds.minX;
    const pairIndex = Math.floor(normalizedColumn / 2);
    const pairColumn = normalizedColumn % 2;
    const flipX = isMultiColumn && pairColumn === 1;
    const capFlipX = isMultiColumn && ((pairColumn === 1) !== (pairIndex % 2 === 1));
    const { before, after } = extendRunThroughLegacy(tileData, state, run, 'vertical');
    const resolved = resolveCyberLinearFamilyTiles(
      'support',
      recipe.styleId as CyberStyleId,
      before + run.length + after,
      { flipX, capFlipX },
    );
    run.forEach((entry, index) => addOwnedOutput(
      tileData,
      state,
      recipe.ownerId,
      `row-${entry.y - bounds.minY}:column-${normalizedColumn}`,
      'recipe',
      entry.x,
      entry.y,
      resolved[before + index]!,
      true,
      { brushId: recipe.brushId, sourceLayer: recipe.anchor.layer },
    ));
  }
}

export function flattenLetterSpanRecipes(state: RoomSmartTerrainState): void {
  for (const [instanceId, recipe] of Object.entries(state.recipes)) {
    if (
      !isCyberStyleId(recipe.styleId)
      || !isCyberLetterBrushId(recipe.brushId)
      || isCyberSpanBrushId(recipe.brushId)
    ) continue;
    for (const source of recipe.sourceCells) {
      if (!inBounds(source.x, source.y)) continue;
      const semanticKey = smartSemanticCellKey(source.layer, source.x, source.y);
      if (!state.semanticCells[semanticKey]) {
        state.semanticCells[semanticKey] = {
          styleId: recipe.styleId,
          brushId: recipe.brushId,
        };
      }
    }
    clearOwnerSuppressions(state, recipe.ownerId);
    delete state.recipes[instanceId];
  }
}

export function resolveCyberRecipes(tileData: RoomTileData, state: RoomSmartTerrainState): void {
  for (const recipe of Object.values(state.recipes)) {
    if (!isCyberStyleId(recipe.styleId)) continue;
    if (recipe.brushId === 'cyber.support') {
      resolveSupportRecipe(tileData, state, recipe);
      continue;
    }
    if (recipe.brushId === 'cyber.neon') {
      resolveHorizontalSpanRecipe(tileData, state, recipe, 'neon-strip');
      continue;
    }
    if (recipe.brushId !== 'cyber.fence' && recipe.recipeId !== CYBER_PANEL_RECIPE_ID && recipe.recipeId !== 'cyber.framed-panel') {
      continue;
    }
    const bounds = recipeBounds(recipe);
    if (!bounds || bounds.width < getCyberFamilyMinimumWidth('framed-panel')) continue;
    const rows = resolveCyberFramedPanelTiles(recipe.styleId, bounds.width);
    for (let row = 0; row < rows.length; row += 1) {
      for (let column = 0; column < rows[row]!.length; column += 1) {
        addOwnedOutput(
          tileData,
          state,
          recipe.ownerId,
          `row-${row}:column-${column}`,
          'recipe',
          bounds.minX + column,
          bounds.minY + row,
          rows[row]![column]!,
          true,
          { brushId: recipe.brushId, sourceLayer: recipe.anchor.layer },
        );
      }
    }
  }
}

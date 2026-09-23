import { ROOM_HEIGHT, ROOM_WIDTH, type LayerName } from '../config/room';
import {
  cloneRoomSmartTerrainState,
  isSmartWamposBrush,
  smartCellKey,
  smartOwnedOutputKey,
  smartOwnedOutputPartKey,
  smartSemanticCellKey,
  type RoomSmartTerrainState,
  type SmartCellCoordinate,
} from './model';
import {
  getSmartRecipeEngineAdapter,
  type ApplySmartBrushCellsOptions,
  type ApplySmartBrushOutlineCellsOptions,
  type SmartRecipeDocument,
} from './recipeSolver';
import { getSmartBrushDefinition, resolveSmartTileValue } from './registry';
import { setSmartTerrainDetailsEnabled } from './solver';
import { getWamposMinimumSize, resolveWamposTile } from './wamposWindowProfile';

export const wamposWindowOwnerId = (instanceId: string): string => `wampos95:recipe:${instanceId}`;
const inBounds = ({ x, y }: SmartCellCoordinate): boolean => (
  Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < ROOM_WIDTH && y < ROOM_HEIGHT
);

function cloneDocument(document: SmartRecipeDocument): SmartRecipeDocument {
  return {
    tileData: {
      background: document.tileData.background.map((row) => [...row]),
      terrain: document.tileData.terrain.map((row) => [...row]),
      foreground: document.tileData.foreground.map((row) => [...row]),
    },
    smartTerrain: cloneRoomSmartTerrainState(document.smartTerrain),
  };
}

function suppress(state: RoomSmartTerrainState, ownerId: string, partId: string): void {
  const key = smartOwnedOutputPartKey(ownerId, partId);
  if (!state.suppressedOutputParts.includes(key)) state.suppressedOutputParts.push(key);
}

/** Clear only exact owned values. Manual replacements and erasures stay suppressed. */
export function resolveWamposWindowDocument(document: SmartRecipeDocument): SmartRecipeDocument {
  if (!Object.values(document.smartTerrain.recipes).some((recipe) => isSmartWamposBrush(recipe.brushId))
    && !Object.values(document.smartTerrain.ownedOutputs).some((output) => output.ownerId.startsWith('wampos95:'))) {
    return document;
  }
  const next = cloneDocument(document);
  const { tileData, smartTerrain: state } = next;
  if (state.editingDisabled) return next;
  const otherSources = new Set(Object.values(state.recipes)
    .filter((recipe) => !isSmartWamposBrush(recipe.brushId))
    .flatMap((recipe) => recipe.sourceCells.map((cell) => smartSemanticCellKey(cell.layer, cell.x, cell.y))));
  for (const [id, recipe] of Object.entries(state.recipes)) {
    if (!isSmartWamposBrush(recipe.brushId)) continue;
    recipe.sourceCells = recipe.sourceCells.filter((cell) => {
      const key = smartSemanticCellKey(cell.layer, cell.x, cell.y);
      return !state.semanticCells[key] && !otherSources.has(key);
    });
    if (recipe.sourceCells.length === 0) delete state.recipes[id];
  }
  for (const [key, output] of Object.entries(state.ownedOutputs)) {
    if (!output.ownerId.startsWith('wampos95:')) continue;
    const [x, y] = key.slice(key.indexOf(':') + 1).split(',').map(Number);
    if (inBounds({ x, y })) {
      if (tileData[output.layer][y][x] === output.value) tileData[output.layer][y][x] = -1;
      else suppress(state, output.ownerId, output.partId);
    }
    delete state.ownedOutputs[key];
  }
  for (const recipe of Object.values(state.recipes)) {
    if (!isSmartWamposBrush(recipe.brushId) || recipe.styleId !== 'wampos95') continue;
    const { width, height, minX, minY } = recipe.bounds;
    const minimum = getWamposMinimumSize(recipe.brushId);
    if (width < minimum.width || height < minimum.height || (recipe.brushId === 'wampos95.start-bar' && height !== 1)) continue;
    for (const cell of recipe.sourceCells) {
      if (!inBounds(cell)) continue;
      const dx = cell.x - minX;
      const dy = cell.y - minY;
      const partId = `row-${dy}:column-${dx}`;
      if (state.suppressedOutputParts.includes(smartOwnedOutputPartKey(recipe.ownerId, partId))) continue;
      const tile = resolveWamposTile(recipe.brushId, dx, dy, width, height, recipe.anchor.layer);
      const key = smartOwnedOutputKey(tile.layer, cell.x, cell.y);
      // A later manual tile, other Smart brush, or independent Background owner wins.
      const value = resolveSmartTileValue('wampos95', { ...tile, tilesetKey: 'wampos95' });
      const currentValue = tileData[tile.layer][cell.y][cell.x];
      if ((currentValue > 0 && currentValue !== value) || state.ownedOutputs[key]) continue;
      tileData[tile.layer][cell.y][cell.x] = value;
      state.ownedOutputs[key] = { ownerId: recipe.ownerId, partId, kind: 'recipe', layer: tile.layer, value };
    }
  }
  const activeOwnerPrefixes = Object.values(state.recipes)
    .filter((recipe) => isSmartWamposBrush(recipe.brushId))
    .map((recipe) => `${recipe.ownerId}:`);
  state.suppressedOutputParts = state.suppressedOutputParts.filter((part) => (
    !part.startsWith('wampos95:') || activeOwnerPrefixes.some((prefix) => part.startsWith(prefix))
  ));
  return next;
}

/** Release replaced sources and their companions without deleting manual artwork. */
function detachSources(document: SmartRecipeDocument, layer: LayerName, cells: readonly SmartCellCoordinate[]): void {
  const { smartTerrain: state, tileData } = document;
  const targets = new Set(cells.map(({ x, y }) => smartCellKey(x, y)));
  const removedOwners = new Set<string>();
  const touchedRecipes = new Set<string>();
  const legacyOwners = new Set<string>();
  for (const { x, y } of cells) {
    const key = smartCellKey(x, y);
    const semanticKey = smartSemanticCellKey(layer, x, y);
    const semantic = state.semanticCells[semanticKey];
    if (semantic) {
      const brush = getSmartBrushDefinition(semantic.brushId);
      removedOwners.add(brush.engine === 'legacy-terrain'
        ? `legacy-semantic:${semanticKey}`
        : getSmartRecipeEngineAdapter(semantic.brushId).semanticOwnerId(semanticKey));
      delete state.semanticCells[semanticKey];
    }
    if (layer === 'terrain' && state.cells[key]) {
      delete state.cells[key];
      legacyOwners.add(key);
      removedOwners.add(`legacy-cell:${key}`);
      // Legacy primary cells predate ownedOutputs.
      tileData.terrain[y][x] = -1;
    }
    if (layer === 'background' && state.backdropCells[key]) {
      delete state.backdropCells[key];
      tileData.background[y][x] = -1;
    }
  }
  for (const [id, recipe] of Object.entries(state.recipes)) {
    const remaining = recipe.sourceCells.filter((cell) => cell.layer !== layer || !targets.has(smartCellKey(cell.x, cell.y)));
    if (remaining.length === recipe.sourceCells.length) continue;
    touchedRecipes.add(recipe.ownerId);
    recipe.sourceCells = remaining;
    if (remaining.length === 0) {
      removedOwners.add(recipe.ownerId);
      delete state.recipes[id];
    }
  }
  for (const [key, output] of Object.entries(state.ownedOutputs)) {
    const coordinate = key.slice(key.indexOf(':') + 1);
    if (!removedOwners.has(output.ownerId) && !(touchedRecipes.has(output.ownerId) && targets.has(coordinate))) continue;
    const [x, y] = coordinate.split(',').map(Number);
    if (inBounds({ x, y }) && tileData[output.layer][y][x] === output.value) tileData[output.layer][y][x] = -1;
    delete state.ownedOutputs[key];
  }
  for (const decorations of [state.generatedDecorations, state.generatedBackgroundDecorations]) {
    for (const [key, decoration] of Object.entries(decorations)) {
      if (!legacyOwners.has(decoration.ownerKey)) continue;
      const [x, y] = key.split(',').map(Number);
      if (inBounds({ x, y }) && tileData[decoration.layer][y][x] === (decoration.value ?? decoration.gid)) {
        tileData[decoration.layer][y][x] = -1;
      }
      delete decorations[key];
    }
  }
  state.suppressedOutputParts = state.suppressedOutputParts.filter((part) => (
    ![...removedOwners].some((owner) => part.startsWith(`${owner}:`))
  ));
  state.suppressedDecorationSlots = state.suppressedDecorationSlots.filter((slot) => (
    ![...legacyOwners].some((owner) => slot.startsWith(`${owner}:`))
  ));
}

export function applyWamposWindowCells(document: SmartRecipeDocument, options: ApplySmartBrushCellsOptions): SmartRecipeDocument {
  const next = cloneDocument(document);
  const { smartTerrain: state, tileData } = next;
  if (state.editingDisabled) return next;
  if (!isSmartWamposBrush(options.brushId) || options.styleId !== 'wampos95') throw new RangeError('Invalid WampOS brush/style.');
  const minimum = getWamposMinimumSize(options.brushId);
  const layer = options.layer ?? 'terrain';
  const cells = [...new Map([...options.cells].filter(inBounds).map((cell) => [smartCellKey(cell.x, cell.y), cell])).values()];
  if (cells.length === 0) return next;
  if (options.mode === 'erase') {
    detachSources(next, layer, cells);
    for (const { x, y } of cells) tileData[layer][y][x] = -1;
    return setSmartTerrainDetailsEnabled(next, state.detailsEnabled);
  }
  const minX = Math.min(...cells.map((cell) => cell.x));
  const minY = Math.min(...cells.map((cell) => cell.y));
  const maxX = Math.max(...cells.map((cell) => cell.x));
  const maxY = Math.max(...cells.map((cell) => cell.y));
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  // Never expand a tiny/partial gesture into tiles outside the requested bounds.
  if (width < minimum.width || height < minimum.height || cells.length !== width * height
    || (options.brushId === 'wampos95.start-bar' && height !== 1)) return next;
  // Redrawing from the same top-left resizes that window, including shrinking it.
  for (const recipe of Object.values(state.recipes)) {
    if (isSmartWamposBrush(recipe.brushId) && recipe.anchor.layer === layer
      && recipe.anchor.x === minX && recipe.anchor.y === minY) {
      detachSources(next, layer, recipe.sourceCells);
    }
  }
  detachSources(next, layer, cells);
  let index = 1;
  while (state.recipes[`wampos-window-${index}`]) index += 1;
  const id = `wampos-window-${index}`;
  state.recipes[id] = {
    recipeId: options.brushId, ownerId: wamposWindowOwnerId(id), brushId: options.brushId, styleId: 'wampos95',
    anchor: { layer, x: minX, y: minY }, bounds: { minX, minY, maxX, maxY, width, height },
    sourceCells: cells.map((cell) => ({ ...cell, layer })), parameters: { width, height },
  };
  for (const { x, y } of cells) {
    const tile = resolveWamposTile(options.brushId, x - minX, y - minY, width, height, layer);
    // Painting explicitly replaces primary frame art; companion fill respects
    // independent Background art, and manual Terrain contents are left intact.
    if (tile.layer === layer) tileData[layer][y][x] = -1;
  }
  return setSmartTerrainDetailsEnabled(next, state.detailsEnabled);
}

export function applyWamposWindowOutline(document: SmartRecipeDocument, options: ApplySmartBrushOutlineCellsOptions): SmartRecipeDocument {
  return applyWamposWindowCells(document, { ...options, cells: options.filledCells, mode: 'paint' });
}

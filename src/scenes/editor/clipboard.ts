import { ROOM_HEIGHT, ROOM_WIDTH, type LayerName } from '../../config';
import {
  smartSemanticCellKey,
  type RoomSmartTerrainState,
  type SmartLayerCellCoordinate,
  type SmartRecipeInstanceState,
  type SmartSemanticCellState,
  type SmartTerrainCellState,
} from '../../autotiling/model';
import {
  getRegisteredSmartRecipeOwnerId,
  getRegisteredSmartSemanticOwnerId,
  isRegisteredSmartRecipeBrush,
} from '../../autotiling/brushEngine';

export interface EditorClipboardRecipeState {
  /** The source room's stable instance ID. Paste reuses it when available. */
  sourceInstanceId: string;
  /** The source solver owner ID, retained so part suppressions can be translated. */
  sourceOwnerId: string;
  /** Anchor and source-cell coordinates are relative to the normalized copy bounds. */
  recipe: SmartRecipeInstanceState;
  /** Complete rendered footprint, also relative to the normalized copy bounds. */
  footprint: SmartLayerCellCoordinate[];
  /** Suppressed part IDs without their source owner prefix. */
  suppressedPartIds: string[];
}

export interface EditorClipboardState {
  sourceLayer: LayerName;
  width: number;
  height: number;
  tiles: number[][];
  occupiedMask: boolean[][];
  smartCells?: Record<string, SmartTerrainCellState>;
  /** Native v2 semantic cells keyed by a coordinate relative to the copied bounds. */
  smartSemanticCells?: Record<string, SmartSemanticCellState>;
  /** Suppressed semantic output part IDs keyed by the same relative coordinate. */
  smartSemanticSuppressions?: Record<string, string[]>;
  /** Only recipes whose complete rendered footprint was selected are included. */
  smartRecipes?: EditorClipboardRecipeState[];
}

export interface ClipboardTileWrite {
  x: number;
  y: number;
  encodedTileValue: number;
}

export interface ClipboardSmartSemanticWrite {
  layer: LayerName;
  x: number;
  y: number;
  cell: SmartSemanticCellState;
  suppressedPartIds: string[];
}

export interface ClipboardSmartRecipeWrite {
  sourceInstanceId: string;
  sourceOwnerId: string;
  recipe: SmartRecipeInstanceState;
  footprint: SmartLayerCellCoordinate[];
  suppressedPartIds: string[];
}

export interface ClipboardSmartPastePlan {
  semanticCells: ClipboardSmartSemanticWrite[];
  recipes: ClipboardSmartRecipeWrite[];
}

function cloneLayerCoordinate(coordinate: SmartLayerCellCoordinate): SmartLayerCellCoordinate {
  return { ...coordinate };
}

function cloneRecipe(recipe: SmartRecipeInstanceState): SmartRecipeInstanceState {
  return {
    ...recipe,
    anchor: cloneLayerCoordinate(recipe.anchor),
    bounds: { ...recipe.bounds },
    sourceCells: recipe.sourceCells.map(cloneLayerCoordinate),
    parameters: { ...recipe.parameters },
  };
}

function cloneClipboardRecipe(recipe: EditorClipboardRecipeState): EditorClipboardRecipeState {
  return {
    sourceInstanceId: recipe.sourceInstanceId,
    sourceOwnerId: recipe.sourceOwnerId,
    recipe: cloneRecipe(recipe.recipe),
    footprint: recipe.footprint.map(cloneLayerCoordinate),
    suppressedPartIds: [...recipe.suppressedPartIds],
  };
}

export function cloneEditorClipboardState(
  state: EditorClipboardState | null,
): EditorClipboardState | null {
  return state
    ? {
        sourceLayer: state.sourceLayer,
        width: state.width,
        height: state.height,
        tiles: state.tiles.map((row) => [...row]),
        occupiedMask: state.occupiedMask.map((row) => [...row]),
        smartCells: state.smartCells
          ? Object.fromEntries(Object.entries(state.smartCells).map(([key, cell]) => [key, { ...cell }]))
          : undefined,
        smartSemanticCells: state.smartSemanticCells
          ? Object.fromEntries(
              Object.entries(state.smartSemanticCells).map(([key, cell]) => [key, { ...cell }]),
            )
          : undefined,
        smartSemanticSuppressions: state.smartSemanticSuppressions
          ? Object.fromEntries(
              Object.entries(state.smartSemanticSuppressions).map(([key, parts]) => [key, [...parts]]),
            )
          : undefined,
        smartRecipes: state.smartRecipes?.map(cloneClipboardRecipe),
      }
    : null;
}

function parseOwnedOutputCoordinate(key: string): SmartLayerCellCoordinate | null {
  const match = /^(background|terrain|foreground):(\d+),(\d+)$/.exec(key);
  if (!match) return null;
  return { layer: match[1] as LayerName, x: Number(match[2]), y: Number(match[3]) };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function getRecipeOwnerId(
  state: RoomSmartTerrainState,
  instanceId: string,
  recipe: SmartRecipeInstanceState,
): string {
  if (recipe.ownerId) return recipe.ownerId;
  const matchingOutput = Object.values(state.ownedOutputs).find((output) => (
    output.kind === 'recipe'
      && (output.ownerId === instanceId || output.ownerId.endsWith(`:${instanceId}`))
  ));
  if (matchingOutput) return matchingOutput.ownerId;
  return getRegisteredSmartRecipeOwnerId(recipe.brushId, instanceId);
}

function getSuppressedPartIds(state: RoomSmartTerrainState, ownerId: string): string[] {
  const prefix = `${ownerId}:`;
  return state.suppressedOutputParts
    .filter((part) => part.startsWith(prefix))
    .map((part) => part.slice(prefix.length));
}

function getRecipeFootprint(
  state: RoomSmartTerrainState,
  instanceId: string,
  ownerId: string,
  recipe: SmartRecipeInstanceState,
): SmartLayerCellCoordinate[] {
  const footprint = new Map<string, SmartLayerCellCoordinate>();
  const add = (coordinate: SmartLayerCellCoordinate): void => {
    footprint.set(`${coordinate.layer}:${coordinate.x},${coordinate.y}`, cloneLayerCoordinate(coordinate));
  };
  recipe.sourceCells.forEach(add);

  for (const [key, output] of Object.entries(state.ownedOutputs)) {
    if (
      output.kind !== 'recipe'
      || (output.ownerId !== ownerId
        && output.ownerId !== instanceId
        && !output.ownerId.endsWith(`:${instanceId}`))
    ) continue;
    const coordinate = parseOwnedOutputCoordinate(key);
    if (coordinate) add(coordinate);
  }

  const width = isPositiveInteger(recipe.bounds.width) ? recipe.bounds.width : 1;
  const height = isPositiveInteger(recipe.bounds.height) ? recipe.bounds.height : 1;
  for (let dy = 0; dy < height; dy += 1) {
    for (let dx = 0; dx < width; dx += 1) {
      add({
        layer: recipe.anchor.layer,
        x: recipe.bounds.minX + dx,
        y: recipe.bounds.minY + dy,
      });
    }
  }

  return [...footprint.values()];
}

function buildSmartClipboardFields(
  sourceLayer: LayerName,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  state: RoomSmartTerrainState,
): Pick<
  EditorClipboardState,
  'smartSemanticCells' | 'smartSemanticSuppressions' | 'smartRecipes'
> {
  const smartSemanticCells: Record<string, SmartSemanticCellState> = {};
  const smartSemanticSuppressions: Record<string, string[]> = {};
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const semanticKey = smartSemanticCellKey(sourceLayer, x, y);
      const cell = state.semanticCells[semanticKey];
      if (!cell || cell.legacySource) continue;
      const relativeKey = `${x - minX},${y - minY}`;
      smartSemanticCells[relativeKey] = { ...cell };
      const ownerId = getRegisteredSmartSemanticOwnerId(cell.brushId, semanticKey);
      const suppressedPartIds = getSuppressedPartIds(state, ownerId);
      if (suppressedPartIds.length > 0) smartSemanticSuppressions[relativeKey] = suppressedPartIds;
    }
  }

  const smartRecipes: EditorClipboardRecipeState[] = [];
  for (const [instanceId, sourceRecipe] of Object.entries(state.recipes)) {
    if (
      sourceRecipe.anchor.layer !== sourceLayer
      || !isRegisteredSmartRecipeBrush(sourceRecipe.brushId)
    ) continue;
    const sourceOwnerId = getRecipeOwnerId(state, instanceId, sourceRecipe);
    const footprint = getRecipeFootprint(state, instanceId, sourceOwnerId, sourceRecipe);
    const complete = footprint.length > 0 && footprint.every((coordinate) => (
      coordinate.layer === sourceLayer
        && coordinate.x >= minX && coordinate.x <= maxX
        && coordinate.y >= minY && coordinate.y <= maxY
    ));
    if (!complete) continue;
    const relativize = (coordinate: SmartLayerCellCoordinate): SmartLayerCellCoordinate => ({
      ...coordinate,
      x: coordinate.x - minX,
      y: coordinate.y - minY,
    });
    const recipe = cloneRecipe(sourceRecipe);
    recipe.anchor = relativize(recipe.anchor);
    recipe.bounds = {
      ...recipe.bounds,
      minX: recipe.bounds.minX - minX,
      minY: recipe.bounds.minY - minY,
      maxX: recipe.bounds.maxX - minX,
      maxY: recipe.bounds.maxY - minY,
    };
    recipe.sourceCells = recipe.sourceCells.map(relativize);
    smartRecipes.push({
      sourceInstanceId: instanceId,
      sourceOwnerId,
      recipe,
      footprint: footprint.map(relativize),
      suppressedPartIds: getSuppressedPartIds(state, sourceOwnerId),
    });
  }

  return {
    ...(Object.keys(smartSemanticCells).length > 0 ? { smartSemanticCells } : {}),
    ...(Object.keys(smartSemanticSuppressions).length > 0 ? { smartSemanticSuppressions } : {}),
    ...(smartRecipes.length > 0 ? { smartRecipes } : {}),
  };
}

export function buildEditorClipboardState(
  sourceLayer: LayerName,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  getEncodedTileValue: (x: number, y: number) => number,
  getSmartCell?: (x: number, y: number) => SmartTerrainCellState | undefined,
  smartTerrainState?: RoomSmartTerrainState,
): EditorClipboardState | null {
  const minX = Math.max(0, Math.min(x1, x2));
  const minY = Math.max(0, Math.min(y1, y2));
  const maxX = Math.min(ROOM_WIDTH - 1, Math.max(x1, x2));
  const maxY = Math.min(ROOM_HEIGHT - 1, Math.max(y1, y2));
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  if (width <= 0 || height <= 0) return null;

  const tiles: number[][] = [];
  const occupiedMask: boolean[][] = [];
  let hasOccupiedTiles = false;
  const smartCells: Record<string, SmartTerrainCellState> = {};
  for (let dy = 0; dy < height; dy += 1) {
    const tileRow: number[] = [];
    const occupiedRow: boolean[] = [];
    for (let dx = 0; dx < width; dx += 1) {
      const encodedTileValue = getEncodedTileValue(minX + dx, minY + dy);
      const occupied = encodedTileValue >= 0;
      tileRow.push(encodedTileValue);
      occupiedRow.push(occupied);
      hasOccupiedTiles ||= occupied;
      const smartCell = getSmartCell?.(minX + dx, minY + dy);
      if (smartCell) smartCells[`${dx},${dy}`] = { ...smartCell };
    }
    tiles.push(tileRow);
    occupiedMask.push(occupiedRow);
  }

  const smartFields = smartTerrainState
    ? buildSmartClipboardFields(sourceLayer, minX, minY, maxX, maxY, smartTerrainState)
    : {};
  const hasSmartPayload = Object.keys(smartCells).length > 0
    || Boolean(smartFields.smartSemanticCells)
    || Boolean(smartFields.smartRecipes);
  if (!hasOccupiedTiles && !hasSmartPayload) return null;
  return {
    sourceLayer, width, height, tiles, occupiedMask,
    ...(Object.keys(smartCells).length > 0 ? { smartCells } : {}),
    ...smartFields,
  };
}

export function planEditorClipboardPaste(
  state: EditorClipboardState,
  baseTileX: number,
  baseTileY: number,
): ClipboardTileWrite[] {
  const writes: ClipboardTileWrite[] = [];
  for (let dy = 0; dy < state.height; dy += 1) {
    for (let dx = 0; dx < state.width; dx += 1) {
      if (!state.occupiedMask[dy]?.[dx]) continue;
      const x = baseTileX + dx;
      const y = baseTileY + dy;
      if (x < 0 || x >= ROOM_WIDTH || y < 0 || y >= ROOM_HEIGHT) continue;
      const encodedTileValue = state.tiles[dy]?.[dx] ?? -1;
      if (encodedTileValue < 0) continue;
      writes.push({ x, y, encodedTileValue });
    }
  }
  return writes;
}

export function planEditorSmartClipboardPaste(
  state: EditorClipboardState,
  baseTileX: number,
  baseTileY: number,
  targetLayer: LayerName,
): ClipboardSmartPastePlan {
  if (targetLayer !== state.sourceLayer) return { semanticCells: [], recipes: [] };

  const semanticCells: ClipboardSmartSemanticWrite[] = [];
  for (const [relativeKey, cell] of Object.entries(state.smartSemanticCells ?? {})) {
    const match = /^(\d+),(\d+)$/.exec(relativeKey);
    if (!match) continue;
    const x = baseTileX + Number(match[1]);
    const y = baseTileY + Number(match[2]);
    if (x < 0 || x >= ROOM_WIDTH || y < 0 || y >= ROOM_HEIGHT) continue;
    semanticCells.push({
      layer: targetLayer,
      x,
      y,
      cell: { ...cell },
      suppressedPartIds: [...(state.smartSemanticSuppressions?.[relativeKey] ?? [])],
    });
  }

  const recipes: ClipboardSmartRecipeWrite[] = [];
  for (const clipboardRecipe of state.smartRecipes ?? []) {
    const translate = (coordinate: SmartLayerCellCoordinate): SmartLayerCellCoordinate => ({
      ...coordinate,
      x: coordinate.x + baseTileX,
      y: coordinate.y + baseTileY,
    });
    const footprint = clipboardRecipe.footprint.map(translate);
    const completeInTargetRoom = footprint.every((coordinate) => (
      coordinate.layer === targetLayer
        && coordinate.x >= 0 && coordinate.x < ROOM_WIDTH
        && coordinate.y >= 0 && coordinate.y < ROOM_HEIGHT
    ));
    if (!completeInTargetRoom) continue;
    const recipe = cloneRecipe(clipboardRecipe.recipe);
    recipe.anchor = translate(recipe.anchor);
    recipe.bounds = {
      ...recipe.bounds,
      minX: recipe.bounds.minX + baseTileX,
      minY: recipe.bounds.minY + baseTileY,
      maxX: recipe.bounds.maxX + baseTileX,
      maxY: recipe.bounds.maxY + baseTileY,
    };
    recipe.sourceCells = recipe.sourceCells.map(translate);
    recipes.push({
      sourceInstanceId: clipboardRecipe.sourceInstanceId,
      sourceOwnerId: clipboardRecipe.sourceOwnerId,
      recipe,
      footprint,
      suppressedPartIds: [...clipboardRecipe.suppressedPartIds],
    });
  }

  return { semanticCells, recipes };
}

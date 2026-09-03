import { LAYER_NAMES, type LayerName } from '../config/room';

export const SMART_TERRAIN_LEGACY_VERSION = 1 as const;
export const SMART_TERRAIN_VERSION = 2 as const;

export const SMART_TERRAIN_THEMES = ['forest', 'desert', 'cave', 'gothic', 'water'] as const;
export type SmartTerrainTheme = typeof SMART_TERRAIN_THEMES[number];

export const SMART_TERRAIN_MATERIALS = ['ground', 'platform', 'feature', 'tunnel'] as const;
export type SmartTerrainMaterial = typeof SMART_TERRAIN_MATERIALS[number];

export const SMART_STYLE_IDS = [
  'forest', 'desert', 'cave', 'gothic', 'water', 'cyber-yellow', 'cyber-pink',
] as const;
export type SmartStyleId = typeof SMART_STYLE_IDS[number];

export const SMART_LEGACY_BRUSH_IDS = [
  'forest.ground', 'forest.platform', 'forest.feature',
  'desert.ground', 'desert.platform', 'desert.feature',
  'cave.ground', 'cave.platform', 'cave.feature',
  'gothic.ground', 'gothic.platform', 'gothic.feature',
  'water.tunnel',
] as const;
export type SmartLegacyBrushId = typeof SMART_LEGACY_BRUSH_IDS[number];

export const SMART_CYBER_BRUSH_IDS = [
  'cyber.concrete', 'cyber.windows', 'cyber.shell', 'cyber.neon', 'cyber.fence',
  'cyber.rubble', 'cyber.support',
] as const;
export type SmartCyberBrushId = typeof SMART_CYBER_BRUSH_IDS[number];

export const SMART_BRUSH_IDS = [
  ...SMART_LEGACY_BRUSH_IDS,
  ...SMART_CYBER_BRUSH_IDS,
] as const;
export type SmartBrushId = typeof SMART_BRUSH_IDS[number];

/** Accepted only while normalizing transient v2 payloads from pre-contract builds. */
export const SMART_TRANSIENT_BRUSH_ALIASES = ['ground', 'platform', 'feature', 'tunnel'] as const;
export type SmartTransientBrushAlias = typeof SMART_TRANSIENT_BRUSH_ALIASES[number];

/** A complete room tile value: gid plus any encoded flip flags. */
export type SmartEncodedTileValue = number;

export interface SmartTerrainCellState {
  theme: SmartTerrainTheme;
  material: SmartTerrainMaterial;
  /** Runtime resolver context for native v2 cells authored off the legacy layer. */
  sourceLayer?: LayerName;
  /** Stable v2 aliases. Legacy callers may continue to use theme/material. */
  styleId?: SmartStyleId;
  brushId?: SmartBrushId;
  lockedValue?: SmartEncodedTileValue;
  shapeValue?: SmartEncodedTileValue;
  /** @deprecated Compatibility alias for lockedValue. */
  lockedGid?: SmartEncodedTileValue;
  /** @deprecated Compatibility alias for shapeValue. */
  shapeGid?: SmartEncodedTileValue;
}

export interface SmartSemanticCellState {
  styleId: SmartStyleId;
  brushId: SmartBrushId;
  /** Full encoded tile value, including flip flags. */
  lockedValue?: SmartEncodedTileValue;
  /** Full encoded tile value, including flip flags. */
  shapeValue?: SmartEncodedTileValue;
  /** Increments when the same brush is painted again so catalog variety cycles to the next look. */
  varietySalt?: number;
  /** Compatibility mirror rebuilt from cells/backdropCells on normalization. */
  legacySource?: true;
}

export interface SmartCellCoordinate {
  x: number;
  y: number;
}

export interface SmartLayerCellCoordinate extends SmartCellCoordinate {
  layer: LayerName;
}

export type SmartSemanticCellKey = `${LayerName}:${number},${number}`;
export type SmartRecipeParameterValue = string | number | boolean;

export interface SmartRecipeBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface SmartRecipeInstanceState {
  /** Stable recipe/profile ID. */
  recipeId: string;
  /** Stable rendered-output owner ID; recipe record renames must also replace this value. */
  ownerId: string;
  styleId: SmartStyleId;
  brushId: SmartBrushId;
  /** Canonical top-left source/output anchor. */
  anchor: SmartLayerCellCoordinate;
  /** Canonical absolute bounds for this recipe's authored footprint. */
  bounds: SmartRecipeBounds;
  sourceCells: SmartLayerCellCoordinate[];
  parameters: Record<string, SmartRecipeParameterValue>;
}

export const SMART_OWNED_OUTPUT_KINDS = ['semantic', 'recipe', 'legacy-decoration'] as const;
export type SmartOwnedOutputKind = typeof SMART_OWNED_OUTPUT_KINDS[number];

export interface SmartOwnedOutputState {
  ownerId: string;
  partId: string;
  kind: SmartOwnedOutputKind;
  layer: LayerName;
  /** Full encoded tile value, including flip flags. */
  value: SmartEncodedTileValue;
}

export type SmartOwnedOutputKey = `${LayerName}:${number},${number}`;

export interface SmartGeneratedDecorationState {
  ownerKey: string;
  slot: 'top' | 'bottom' | 'left' | 'right' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
  gid: number;
  /** Optional full encoded tile value; gid remains for legacy consumers. */
  value?: SmartEncodedTileValue;
  /** Actual room layer holding the generated tile. Older snapshots omit this and normalize by map. */
  layer: 'background' | 'terrain' | 'foreground';
}

/** v2 is a superset of v1 so the current editor/solver can migrate incrementally. */
export interface RoomSmartTerrainState {
  /** Unknown future versions retain their source number and are opened read-only. */
  version: number;
  editingDisabled: boolean;
  editingDisabledReason?: string;
  /** Original unknown payload for lossless round-tripping by a newer client. */
  preservedFutureState?: Record<string, unknown>;
  detailsEnabled: boolean;
  /** Canonical, layer-qualified sources keyed as `layer:x,y`. */
  semanticCells: Record<string, SmartSemanticCellState>;
  /** Recipe instances keyed by stable instance/owner ID. */
  recipes: Record<string, SmartRecipeInstanceState>;
  /** Engine-owned rendered outputs keyed as `layer:x,y`. */
  ownedOutputs: Record<string, SmartOwnedOutputState>;
  /** Owner/part IDs deliberately removed by a manual edit. */
  suppressedOutputParts: string[];
  /** @deprecated Terrain-layer compatibility cells keyed as `x,y`. */
  cells: Record<string, SmartTerrainCellState>;
  /** @deprecated Background-layer compatibility cells keyed as `x,y`. */
  backdropCells: Record<string, SmartTerrainCellState>;
  /** @deprecated Sparse engine-owned primary detail cells keyed as `x,y`. */
  generatedDecorations: Record<string, SmartGeneratedDecorationState>;
  /** @deprecated Sparse engine-owned secondary detail cells keyed as `x,y`. */
  generatedBackgroundDecorations: Record<string, SmartGeneratedDecorationState>;
  /** @deprecated Owner/slot keys deliberately removed by a manual edit. */
  suppressedDecorationSlots: string[];
}

interface RoomSmartTerrainStateV1 {
  version?: typeof SMART_TERRAIN_LEGACY_VERSION;
  detailsEnabled?: boolean;
  cells?: unknown;
  backdropCells?: unknown;
  generatedDecorations?: unknown;
  generatedBackgroundDecorations?: unknown;
  suppressedDecorationSlots?: unknown;
}

const CELL_KEY_PATTERN = /^\d+,\d+$/;
const LAYER_CELL_KEY_PATTERN = /^(background|terrain|foreground):\d+,\d+$/;
const DECORATION_SLOT_PATTERN = /^\d+,\d+:(top|bottom|left|right|topLeft|topRight|bottomLeft|bottomRight)$/;
const LEGACY_SEMANTIC_OWNER_PREFIX = 'legacy-cell:';

const LEGACY_STYLE_TO_THEME: Readonly<Partial<Record<SmartStyleId, SmartTerrainTheme>>> = {
  forest: 'forest', desert: 'desert', cave: 'cave', gothic: 'gothic', water: 'water',
};

export interface LegacySmartBrushIdentity {
  theme: SmartTerrainTheme;
  material: SmartTerrainMaterial;
}

const LEGACY_BRUSH_IDENTITIES: Readonly<Record<SmartLegacyBrushId, LegacySmartBrushIdentity>> = {
  'forest.ground': { theme: 'forest', material: 'ground' },
  'forest.platform': { theme: 'forest', material: 'platform' },
  'forest.feature': { theme: 'forest', material: 'feature' },
  'desert.ground': { theme: 'desert', material: 'ground' },
  'desert.platform': { theme: 'desert', material: 'platform' },
  'desert.feature': { theme: 'desert', material: 'feature' },
  'cave.ground': { theme: 'cave', material: 'ground' },
  'cave.platform': { theme: 'cave', material: 'platform' },
  'cave.feature': { theme: 'cave', material: 'feature' },
  'gothic.ground': { theme: 'gothic', material: 'ground' },
  'gothic.platform': { theme: 'gothic', material: 'platform' },
  'gothic.feature': { theme: 'gothic', material: 'feature' },
  'water.tunnel': { theme: 'water', material: 'tunnel' },
};

/** Maps the v1 theme/material pair to its stable v2 brush ID. */
export function getSmartLegacyBrushId(
  theme: SmartTerrainTheme,
  material: SmartTerrainMaterial,
): SmartLegacyBrushId | null {
  const candidate = `${theme}.${material}`;
  return SMART_LEGACY_BRUSH_IDS.includes(candidate as SmartLegacyBrushId)
    ? candidate as SmartLegacyBrushId
    : null;
}

/** Maps a canonical legacy brush ID back to the existing solver vocabulary. */
export function getLegacySmartBrushIdentity(brushId: SmartBrushId): LegacySmartBrushIdentity | null {
  return LEGACY_BRUSH_IDENTITIES[brushId as SmartLegacyBrushId] ?? null;
}

const CYBER_BRUSH_ALIASES: Readonly<Record<string, SmartCyberBrushId>> = {
  'cyber.structure': 'cyber.concrete',
  'cyber.platform': 'cyber.concrete',
  'cyber.neon-strip': 'cyber.neon',
  'cyber.framed-panel': 'cyber.fence',
};

/** Canonicalizes a persisted brush ID, including the four short-lived generic v2 aliases. */
export function normalizeSmartBrushId(styleId: SmartStyleId, value: unknown): SmartBrushId | null {
  if (typeof value === 'string' && value in CYBER_BRUSH_ALIASES) {
    return CYBER_BRUSH_ALIASES[value]!;
  }
  if (SMART_BRUSH_IDS.includes(value as SmartBrushId)) return value as SmartBrushId;
  if (!SMART_TRANSIENT_BRUSH_ALIASES.includes(value as SmartTransientBrushAlias)) return null;
  const theme = LEGACY_STYLE_TO_THEME[styleId];
  return theme ? getSmartLegacyBrushId(theme, value as SmartTerrainMaterial) : null;
}

/**
 * Validates persisted style/brush compatibility. Source layers are deliberately
 * unrestricted in v2: Advanced authoring may place any Smart brush on any room
 * layer, while Beginner mode continues to choose the authored default.
 */
function isSmartBrushSourceCompatible(
  styleId: SmartStyleId,
  brushId: SmartBrushId,
  layer: LayerName,
): boolean {
  const legacyIdentity = getLegacySmartBrushIdentity(brushId);
  if (legacyIdentity) {
    return styleId === legacyIdentity.theme && isLayerName(layer);
  }
  if (styleId !== 'cyber-yellow' && styleId !== 'cyber-pink') return false;
  return isLayerName(layer) && (
    brushId === 'cyber.concrete'
    || brushId === 'cyber.windows'
    || brushId === 'cyber.shell'
    || brushId === 'cyber.neon'
    || brushId === 'cyber.rubble'
    || brushId === 'cyber.support'
    || brushId === 'cyber.fence'
  );
}

export function smartCellKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function smartSemanticCellKey(layer: LayerName, x: number, y: number): SmartSemanticCellKey {
  return `${layer}:${x},${y}`;
}

export function smartOwnedOutputKey(layer: LayerName, x: number, y: number): SmartOwnedOutputKey {
  return `${layer}:${x},${y}`;
}

export function smartOwnedOutputPartKey(ownerId: string, partId: string): string {
  return `${ownerId}:${partId}`;
}

/** Canonical owner ID for a native Cyber recipe instance. */
export function smartRecipeOwnerId(instanceId: string): string {
  return `cyber:recipe:${instanceId}`;
}

export function smartDecorationSlotKey(ownerKey: string, slot: SmartGeneratedDecorationState['slot']): string {
  return `${ownerKey}:${slot}`;
}

export function createRoomSmartTerrainState(): RoomSmartTerrainState {
  return {
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
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJsonRecord(value: Record<string, unknown>): Record<string, unknown> {
  if (typeof structuredClone === 'function') {
    return structuredClone(value) as Record<string, unknown>;
  }
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function isEncodedTileValue(value: unknown): value is SmartEncodedTileValue {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isLayerName(value: unknown): value is LayerName {
  return LAYER_NAMES.includes(value as LayerName);
}

function isLayerCoordinate(value: unknown): value is SmartLayerCellCoordinate {
  if (!isRecord(value)) return false;
  return isLayerName(value.layer)
    && Number.isInteger(value.x) && (value.x as number) >= 0
    && Number.isInteger(value.y) && (value.y as number) >= 0;
}

function normalizeSmartCells(value: unknown, expectedLayer: 'terrain' | 'background'): Record<string, SmartTerrainCellState> {
  const cells: Record<string, SmartTerrainCellState> = {};
  if (!isRecord(value)) return cells;
  for (const [key, cell] of Object.entries(value)) {
    if (!CELL_KEY_PATTERN.test(key) || !isRecord(cell)) continue;
    const theme = cell.theme;
    const material = cell.material === 'platform' ? 'ground' : cell.material;
    if (
      !SMART_TERRAIN_THEMES.includes(theme as SmartTerrainTheme)
      || !SMART_TERRAIN_MATERIALS.includes(cell.material as SmartTerrainMaterial)
      || (expectedLayer === 'background') !== (material === 'tunnel')
      || (theme === 'water') !== (material === 'tunnel')
    ) continue;
    const lockedValue = isEncodedTileValue(cell.lockedGid)
      ? cell.lockedGid
      : isEncodedTileValue(cell.lockedValue) ? cell.lockedValue : undefined;
    const shapeValue = isEncodedTileValue(cell.shapeGid)
      ? cell.shapeGid
      : isEncodedTileValue(cell.shapeValue) ? cell.shapeValue : undefined;
    const canonicalTheme = theme as SmartTerrainTheme;
    const canonicalMaterial = material as SmartTerrainMaterial;
    const brushId = getSmartLegacyBrushId(canonicalTheme, canonicalMaterial);
    if (!brushId) continue;
    cells[key] = {
      theme: canonicalTheme,
      material: canonicalMaterial,
      styleId: canonicalTheme,
      brushId,
      ...(lockedValue === undefined ? {} : { lockedValue, lockedGid: lockedValue }),
      ...(shapeValue === undefined ? {} : { shapeValue, shapeGid: shapeValue }),
    };
  }
  return cells;
}

function normalizeSemanticCells(value: unknown): Record<string, SmartSemanticCellState> {
  const cells: Record<string, SmartSemanticCellState> = {};
  if (!isRecord(value)) return cells;
  for (const [key, cell] of Object.entries(value)) {
    if (!LAYER_CELL_KEY_PATTERN.test(key) || !isRecord(cell)) continue;
    if (!SMART_STYLE_IDS.includes(cell.styleId as SmartStyleId)) continue;
    const styleId = cell.styleId as SmartStyleId;
    const brushId = normalizeSmartBrushId(styleId, cell.brushId);
    if (!brushId) continue;
    const layer = key.slice(0, key.indexOf(':')) as LayerName;
    if (!isSmartBrushSourceCompatible(styleId, brushId, layer)) continue;
    const lockedValue = isEncodedTileValue(cell.lockedValue) ? cell.lockedValue : undefined;
    const shapeValue = isEncodedTileValue(cell.shapeValue) ? cell.shapeValue : undefined;
    const varietySalt = isPositiveInteger(cell.varietySalt) ? cell.varietySalt : undefined;
    cells[key] = {
      styleId,
      brushId,
      ...(lockedValue === undefined ? {} : { lockedValue }),
      ...(shapeValue === undefined ? {} : { shapeValue }),
      ...(varietySalt === undefined ? {} : { varietySalt }),
      ...(cell.legacySource === true ? { legacySource: true as const } : {}),
    };
  }
  return cells;
}

function normalizeGeneratedDecorations(
  value: unknown,
  legacyLayer: SmartGeneratedDecorationState['layer'],
): Record<string, SmartGeneratedDecorationState> {
  const decorations: Record<string, SmartGeneratedDecorationState> = {};
  if (!isRecord(value)) return decorations;
  for (const [key, decoration] of Object.entries(value)) {
    if (!CELL_KEY_PATTERN.test(key) || !isRecord(decoration)) continue;
    const slot = typeof decoration.slot === 'string' ? decoration.slot : '';
    if (
      typeof decoration.ownerKey !== 'string' || !CELL_KEY_PATTERN.test(decoration.ownerKey)
      || !['top', 'bottom', 'left', 'right', 'topLeft', 'topRight', 'bottomLeft', 'bottomRight'].includes(slot)
      || !isEncodedTileValue(decoration.gid)
    ) continue;
    decorations[key] = {
      ownerKey: decoration.ownerKey,
      slot: slot as SmartGeneratedDecorationState['slot'],
      gid: decoration.gid,
      ...(isEncodedTileValue(decoration.value) ? { value: decoration.value } : {}),
      layer: isLayerName(decoration.layer)
        ? decoration.layer
        : legacyLayer,
    };
  }
  return decorations;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function normalizeRecipeSourceCells(
  sourceCells: readonly SmartLayerCellCoordinate[],
): SmartLayerCellCoordinate[] {
  const unique = new Map<string, SmartLayerCellCoordinate>();
  for (const cell of sourceCells) {
    unique.set(`${cell.layer}:${cell.x},${cell.y}`, { ...cell });
  }
  return [...unique.values()].sort((left, right) => (
    LAYER_NAMES.indexOf(left.layer) - LAYER_NAMES.indexOf(right.layer)
      || left.y - right.y
      || left.x - right.x
  ));
}

function getNormalizedRecipeBounds(
  sourceCells: readonly SmartLayerCellCoordinate[],
  parameters: Readonly<Record<string, SmartRecipeParameterValue>>,
  persistedBounds: unknown,
): SmartRecipeBounds {
  const sourceMinX = Math.min(...sourceCells.map(({ x }) => x));
  const sourceMinY = Math.min(...sourceCells.map(({ y }) => y));
  const sourceMaxX = Math.max(...sourceCells.map(({ x }) => x));
  const sourceMaxY = Math.max(...sourceCells.map(({ y }) => y));
  const sourceWidth = sourceMaxX - sourceMinX + 1;
  const sourceHeight = sourceMaxY - sourceMinY + 1;
  const bounds = isRecord(persistedBounds) ? persistedBounds : {};
  const hasCanonicalPersistedBounds = Number.isInteger(bounds.minX) && (bounds.minX as number) >= 0
    && Number.isInteger(bounds.minY) && (bounds.minY as number) >= 0
    && Number.isInteger(bounds.maxX) && (bounds.maxX as number) >= (bounds.minX as number)
    && Number.isInteger(bounds.maxY) && (bounds.maxY as number) >= (bounds.minY as number)
    && isPositiveInteger(bounds.width)
    && isPositiveInteger(bounds.height)
    && (bounds.maxX as number) - (bounds.minX as number) + 1 === bounds.width
    && (bounds.maxY as number) - (bounds.minY as number) + 1 === bounds.height
    && sourceMinX >= (bounds.minX as number)
    && sourceMaxX <= (bounds.maxX as number)
    && sourceMinY >= (bounds.minY as number)
    && sourceMaxY <= (bounds.maxY as number);
  if (hasCanonicalPersistedBounds) {
    return {
      minX: bounds.minX as number,
      minY: bounds.minY as number,
      maxX: bounds.maxX as number,
      maxY: bounds.maxY as number,
      width: bounds.width as number,
      height: bounds.height as number,
    };
  }
  const requestedWidth = isPositiveInteger(bounds.width)
    ? bounds.width
    : isPositiveInteger(parameters.width) ? parameters.width : sourceWidth;
  const requestedHeight = isPositiveInteger(bounds.height)
    ? bounds.height
    : isPositiveInteger(parameters.height) ? parameters.height : sourceHeight;
  const width = Math.max(sourceWidth, requestedWidth);
  const height = Math.max(sourceHeight, requestedHeight);
  return {
    minX: sourceMinX,
    minY: sourceMinY,
    maxX: sourceMinX + width - 1,
    maxY: sourceMinY + height - 1,
    width,
    height,
  };
}

function normalizeRecipes(value: unknown): Record<string, SmartRecipeInstanceState> {
  const recipes: Record<string, SmartRecipeInstanceState> = {};
  if (!isRecord(value)) return recipes;
  for (const [instanceId, recipe] of Object.entries(value)) {
    if (!instanceId || !isRecord(recipe) || typeof recipe.recipeId !== 'string' || !recipe.recipeId) continue;
    if (!SMART_STYLE_IDS.includes(recipe.styleId as SmartStyleId)) continue;
    const styleId = recipe.styleId as SmartStyleId;
    const brushId = normalizeSmartBrushId(styleId, recipe.brushId);
    if (!brushId) continue;
    if (!isLayerCoordinate(recipe.anchor) || !Array.isArray(recipe.sourceCells)) continue;
    if (!recipe.sourceCells.every(isLayerCoordinate) || recipe.sourceCells.length === 0) continue;
    const sourceCells = normalizeRecipeSourceCells(recipe.sourceCells as SmartLayerCellCoordinate[]);
    const sourceLayer = sourceCells[0]!.layer;
    if (recipe.anchor.layer !== sourceLayer) continue;
    if (!isSmartBrushSourceCompatible(styleId, brushId, sourceLayer)) continue;
    if (!sourceCells.every((cell) => (
      cell.layer === sourceLayer && isSmartBrushSourceCompatible(styleId, brushId, cell.layer)
    ))) continue;
    const parameters: Record<string, SmartRecipeParameterValue> = {};
    if (isRecord(recipe.parameters)) {
      for (const [key, parameter] of Object.entries(recipe.parameters)) {
        if (typeof parameter === 'string' || typeof parameter === 'number' || typeof parameter === 'boolean') {
          parameters[key] = parameter;
        }
      }
    }
    const bounds = getNormalizedRecipeBounds(sourceCells, parameters, recipe.bounds);
    const recipeId = recipe.recipeId;
    const ownerId = recipeId.startsWith('cyber.')
      ? smartRecipeOwnerId(instanceId)
      : typeof recipe.ownerId === 'string' && recipe.ownerId.length > 0
        ? recipe.ownerId
        : instanceId;
    recipes[instanceId] = {
      recipeId,
      ownerId,
      styleId,
      brushId,
      anchor: { layer: sourceLayer, x: bounds.minX, y: bounds.minY },
      bounds,
      sourceCells,
      parameters,
    };
  }
  return recipes;
}

function normalizeOwnedOutputs(value: unknown): Record<string, SmartOwnedOutputState> {
  const outputs: Record<string, SmartOwnedOutputState> = {};
  if (!isRecord(value)) return outputs;
  for (const [key, output] of Object.entries(value)) {
    if (!LAYER_CELL_KEY_PATTERN.test(key) || !isRecord(output)) continue;
    if (typeof output.ownerId !== 'string' || !output.ownerId || typeof output.partId !== 'string' || !output.partId) continue;
    if (!SMART_OWNED_OUTPUT_KINDS.includes(output.kind as SmartOwnedOutputKind)) continue;
    if (!isLayerName(output.layer) || !key.startsWith(`${output.layer}:`) || !isEncodedTileValue(output.value)) continue;
    outputs[key] = {
      ownerId: output.ownerId,
      partId: output.partId,
      kind: output.kind as SmartOwnedOutputKind,
      layer: output.layer,
      value: output.value,
    };
  }
  return outputs;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)))
    : [];
}

function getRecipeOwnerAliases(
  candidateRecipes: unknown,
  recipes: Readonly<Record<string, SmartRecipeInstanceState>>,
): Map<string, string> {
  const aliases = new Map<string, string>();
  const persistedRecipes = isRecord(candidateRecipes) ? candidateRecipes : {};
  for (const [instanceId, recipe] of Object.entries(recipes)) {
    aliases.set(instanceId, recipe.ownerId);
    aliases.set(recipe.ownerId, recipe.ownerId);
    const persisted = persistedRecipes[instanceId];
    if (isRecord(persisted) && typeof persisted.ownerId === 'string' && persisted.ownerId) {
      aliases.set(persisted.ownerId, recipe.ownerId);
    }
  }
  return aliases;
}

function canonicalizeRecipeOwnerReferences(
  outputs: Record<string, SmartOwnedOutputState>,
  suppressedParts: readonly string[],
  aliases: ReadonlyMap<string, string>,
): string[] {
  for (const output of Object.values(outputs)) {
    if (output.kind !== 'recipe') continue;
    const ownerId = aliases.get(output.ownerId);
    if (ownerId) output.ownerId = ownerId;
  }
  const orderedAliases = [...aliases.entries()].sort((left, right) => right[0].length - left[0].length);
  return Array.from(new Set(suppressedParts.map((part) => {
    const alias = orderedAliases.find(([ownerId]) => part.startsWith(`${ownerId}:`));
    return alias ? `${alias[1]}:${part.slice(alias[0].length + 1)}` : part;
  })));
}

function applyLegacyCellMirrors(
  semanticCells: Record<string, SmartSemanticCellState>,
  cells: Record<string, SmartTerrainCellState>,
  backdropCells: Record<string, SmartTerrainCellState>,
): void {
  for (const [key, cell] of Object.entries(cells)) {
    const semanticKey = `terrain:${key}`;
    if (!semanticCells[semanticKey]) {
      semanticCells[semanticKey] = {
        styleId: cell.theme,
        brushId: cell.brushId ?? getSmartLegacyBrushId(cell.theme, cell.material)!,
        ...(cell.lockedValue === undefined ? {} : { lockedValue: cell.lockedValue }),
        ...(cell.shapeValue === undefined ? {} : { shapeValue: cell.shapeValue }),
        legacySource: true,
      };
    }
  }
  for (const [key, cell] of Object.entries(backdropCells)) {
    const semanticKey = `background:${key}`;
    if (!semanticCells[semanticKey]) {
      semanticCells[semanticKey] = {
        styleId: cell.theme,
        brushId: cell.brushId ?? getSmartLegacyBrushId(cell.theme, cell.material)!,
        ...(cell.lockedValue === undefined ? {} : { lockedValue: cell.lockedValue }),
        ...(cell.shapeValue === undefined ? {} : { shapeValue: cell.shapeValue }),
        legacySource: true,
      };
    }
  }
}

function applySemanticCompatibilityViews(
  semanticCells: Record<string, SmartSemanticCellState>,
  cells: Record<string, SmartTerrainCellState>,
  backdropCells: Record<string, SmartTerrainCellState>,
): void {
  for (const [semanticKey, semanticCell] of Object.entries(semanticCells)) {
    if (semanticCell.legacySource) continue;
    const separator = semanticKey.indexOf(':');
    const layer = semanticKey.slice(0, separator) as LayerName;
    const key = semanticKey.slice(separator + 1);
    const theme = LEGACY_STYLE_TO_THEME[semanticCell.styleId];
    const identity = getLegacySmartBrushIdentity(semanticCell.brushId);
    if (!theme || !identity || identity.theme !== theme) continue;
    const material = identity.material;
    if ((layer === 'background') !== (material === 'tunnel')) continue;
    if ((theme === 'water') !== (material === 'tunnel') || (layer !== 'terrain' && layer !== 'background')) continue;
    const compatibilityCell: SmartTerrainCellState = {
      theme,
      material,
      styleId: semanticCell.styleId,
      brushId: semanticCell.brushId,
      ...(semanticCell.lockedValue === undefined ? {} : {
        lockedValue: semanticCell.lockedValue,
        lockedGid: semanticCell.lockedValue,
      }),
      ...(semanticCell.shapeValue === undefined ? {} : {
        shapeValue: semanticCell.shapeValue,
        shapeGid: semanticCell.shapeValue,
      }),
    };
    (layer === 'background' ? backdropCells : cells)[key] = compatibilityCell;
  }
}

function applyLegacyOutputMirrors(
  outputs: Record<string, SmartOwnedOutputState>,
  decorations: Record<string, SmartGeneratedDecorationState>,
): void {
  for (const [key, decoration] of Object.entries(decorations)) {
    const layer = decoration.layer;
    const outputKey = `${layer}:${key}`;
    if (outputs[outputKey]) continue;
    outputs[outputKey] = {
      ownerId: `${LEGACY_SEMANTIC_OWNER_PREFIX}${decoration.ownerKey}`,
      partId: decoration.slot,
      kind: 'legacy-decoration',
      layer,
      value: decoration.value ?? decoration.gid,
    };
  }
}

function normalizeKnownState(candidate: Record<string, unknown>): RoomSmartTerrainState {
  const cells = normalizeSmartCells(candidate.cells, 'terrain');
  const backdropCells = normalizeSmartCells(candidate.backdropCells, 'background');
  const semanticCells: Record<string, SmartSemanticCellState> = Object.fromEntries(
    Object.entries(normalizeSemanticCells(candidate.semanticCells)).filter(([, cell]) => !cell.legacySource),
  );
  applyLegacyCellMirrors(semanticCells, cells, backdropCells);
  applySemanticCompatibilityViews(semanticCells, cells, backdropCells);

  const recipes = normalizeRecipes(candidate.recipes);
  const recipeOwnerAliases = getRecipeOwnerAliases(candidate.recipes, recipes);
  const generatedDecorations = normalizeGeneratedDecorations(candidate.generatedDecorations, 'foreground');
  const generatedBackgroundDecorations = normalizeGeneratedDecorations(
    candidate.generatedBackgroundDecorations,
    'background',
  );
  const ownedOutputs: Record<string, SmartOwnedOutputState> = Object.fromEntries(
    Object.entries(normalizeOwnedOutputs(candidate.ownedOutputs)).filter(([, output]) => output.kind !== 'legacy-decoration'),
  );
  applyLegacyOutputMirrors(ownedOutputs, generatedDecorations);
  applyLegacyOutputMirrors(ownedOutputs, generatedBackgroundDecorations);

  const suppressedDecorationSlots = normalizeStringArray(candidate.suppressedDecorationSlots)
    .filter((entry) => DECORATION_SLOT_PATTERN.test(entry));
  const nativeSuppressedParts = normalizeStringArray(candidate.suppressedOutputParts)
    .filter((entry) => !entry.startsWith(LEGACY_SEMANTIC_OWNER_PREFIX));
  const legacySuppressedParts = suppressedDecorationSlots.map((slot) => `${LEGACY_SEMANTIC_OWNER_PREFIX}${slot}`);
  const suppressedOutputParts = canonicalizeRecipeOwnerReferences(
    ownedOutputs,
    [...nativeSuppressedParts, ...legacySuppressedParts],
    recipeOwnerAliases,
  );

  return {
    version: SMART_TERRAIN_VERSION,
    editingDisabled: false,
    detailsEnabled: candidate.detailsEnabled !== false,
    semanticCells,
    recipes,
    ownedOutputs,
    suppressedOutputParts,
    cells,
    backdropCells,
    generatedDecorations,
    generatedBackgroundDecorations,
    suppressedDecorationSlots,
  };
}

/** Explicit v1 -> v2 migration entry point. */
export function migrateRoomSmartTerrainStateV1(value: unknown): RoomSmartTerrainState {
  const candidate: RoomSmartTerrainStateV1 = isRecord(value) ? value : {};
  return normalizeKnownState(candidate as Record<string, unknown>);
}

function preserveFutureState(candidate: Record<string, unknown>, version: number): RoomSmartTerrainState {
  const preserved = isRecord(candidate.preservedFutureState)
    ? cloneJsonRecord(candidate.preservedFutureState)
    : cloneJsonRecord(candidate);
  return {
    ...createRoomSmartTerrainState(),
    version,
    editingDisabled: true,
    editingDisabledReason: `Smart terrain version ${version} is newer than supported version ${SMART_TERRAIN_VERSION}.`,
    preservedFutureState: preserved,
    detailsEnabled: candidate.detailsEnabled !== false,
  };
}

export function normalizeRoomSmartTerrainState(value: unknown): RoomSmartTerrainState {
  if (!isRecord(value)) return createRoomSmartTerrainState();
  const version = value.version;
  if (typeof version === 'number' && Number.isInteger(version) && version > SMART_TERRAIN_VERSION) {
    return preserveFutureState(value, version);
  }
  if (version === undefined || version === SMART_TERRAIN_LEGACY_VERSION) {
    return migrateRoomSmartTerrainStateV1(value);
  }
  if (version !== SMART_TERRAIN_VERSION) return createRoomSmartTerrainState();
  return normalizeKnownState(value);
}

export function isRoomSmartTerrainEditingDisabled(state: RoomSmartTerrainState): boolean {
  return state.editingDisabled;
}

export function cloneRoomSmartTerrainState(value: unknown): RoomSmartTerrainState {
  return normalizeRoomSmartTerrainState(value);
}

/**
 * Returns the persisted wire value. Future-version payloads are emitted exactly
 * as received so opening a room in an older editor cannot rewrite newer data.
 */
export function serializeRoomSmartTerrainState(value: unknown): RoomSmartTerrainState {
  const normalized = normalizeRoomSmartTerrainState(value);
  if (normalized.editingDisabled && normalized.preservedFutureState) {
    return cloneJsonRecord(normalized.preservedFutureState) as unknown as RoomSmartTerrainState;
  }
  return normalized;
}

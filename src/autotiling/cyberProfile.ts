import type { LayerName } from '../config/room';
import type { SmartStyleId } from './model';
import type { SmartResolvedTile } from './registry';

export const CYBER_STYLE_IDS = ['cyber-yellow', 'cyber-pink'] as const;
export type CyberStyleId = Extract<SmartStyleId, typeof CYBER_STYLE_IDS[number]>;

export const CYBER_FAMILY_IDS = [
  'structure',
  'platform',
  'rubble',
  'support',
  'neon-strip',
  'framed-panel',
] as const;
export type CyberFamilyId = typeof CYBER_FAMILY_IDS[number];

export const CYBER_NEIGHBOR = {
  north: 1,
  northEast: 2,
  east: 4,
  southEast: 8,
  south: 16,
  southWest: 32,
  west: 64,
  northWest: 128,
} as const;

export const CYBER_CARDINAL_NEIGHBOR = {
  north: 1,
  east: 2,
  south: 4,
  west: 8,
} as const;

export type CyberStructureFacade = 'plain' | 'tower';

export const CYBER_TOWER_REFERENCE_ORIGIN = { x: 32, y: 2 } as const;

export interface CyberResolvedTile extends Omit<SmartResolvedTile, 'flipX' | 'flipY' | 'styleId'> {
  flipX: boolean;
  flipY: boolean;
  layer: LayerName;
  styleId: CyberStyleId;
}

export interface CyberFamilyDefinition {
  id: CyberFamilyId;
  label: string;
  layer: LayerName;
  minimumWidth: number;
  minimumHeight: number;
  maximumHeight?: number;
  structural: boolean;
}

export const CYBER_STYLE_PROFILES = {
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
} as const satisfies Record<CyberStyleId, {
  label: string;
  tilesetKey: string;
  columns: number;
  rows: number;
  tileCount: number;
}>;

export const CYBER_FAMILY_DEFINITIONS = {
  structure: {
    id: 'structure',
    label: 'Structure',
    layer: 'terrain',
    minimumWidth: 1,
    minimumHeight: 1,
    structural: true,
  },
  platform: {
    id: 'platform',
    label: 'Platform',
    layer: 'terrain',
    minimumWidth: 2,
    minimumHeight: 1,
    maximumHeight: 1,
    structural: true,
  },
  rubble: {
    id: 'rubble',
    label: 'Rubble',
    layer: 'terrain',
    minimumWidth: 1,
    minimumHeight: 1,
    structural: true,
  },
  support: {
    id: 'support',
    label: 'Support',
    layer: 'background',
    minimumWidth: 1,
    minimumHeight: 1,
    structural: true,
  },
  'neon-strip': {
    id: 'neon-strip',
    label: 'Neon Strip',
    layer: 'terrain',
    minimumWidth: 3,
    minimumHeight: 1,
    maximumHeight: 1,
    structural: true,
  },
  'framed-panel': {
    id: 'framed-panel',
    label: 'Framed Panel',
    layer: 'foreground',
    minimumWidth: 3,
    minimumHeight: 2,
    maximumHeight: 2,
    structural: false,
  },
} as const satisfies Record<CyberFamilyId, CyberFamilyDefinition>;

/** Tiles declared non-colliding by the Cybercity atlas contract. */
export const CYBER_DECO_ONLY_LOCAL_INDICES = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  13, 18, 22, 24, 32,
  44, 45, 46, 47,
  56, 57, 58, 59,
] as const;

const CYBER_DECO_ONLY = new Set<number>(CYBER_DECO_ONLY_LOCAL_INDICES);

/** Audited optional Structure details. Panel and rubble fragments are separate recipes. */
export const CYBER_DETAIL_ALLOWLIST = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  13, 18, 22, 32,
] as const;

export const CYBER_RUBBLE_DETAIL_LOCAL_INDICES = [12, 24] as const;
export const CYBER_RUBBLE_DETAIL_CELL_INTERVAL = 8;

const CYBER_DETAILS = new Set<number>(CYBER_DETAIL_ALLOWLIST);

export const CYBER_EMISSIVE_LOCAL_INDICES = {
  'cyber-yellow': [2, 3, 49, 50, 51, 73, 74, 75, 76],
  'cyber-pink': [2, 3, 44, 45, 46, 49, 50, 51, 56, 57, 58, 73, 74, 75, 76],
} as const satisfies Record<CyberStyleId, readonly number[]>;

const CYBER_EMITTERS = Object.fromEntries(
  Object.entries(CYBER_EMISSIVE_LOCAL_INDICES).map(([styleId, indices]) => [styleId, new Set(indices)]),
) as Record<CyberStyleId, Set<number>>;

export const CYBER_DETAIL_EMITTER_CELL_INTERVAL = 64;

type CyberStructureRole =
  | 'isolated'
  | 'topLeft'
  | 'top'
  | 'topRight'
  | 'left'
  | 'center'
  | 'right'
  | 'bottomLeft'
  | 'bottom'
  | 'bottomRight'
  | 'vertical';

export interface CyberStructureTopology {
  neighborMask: number;
  role: CyberStructureRole;
  concaveCorner?: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
}

export interface CyberStructureFacadeContext {
  facade?: CyberStructureFacade;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** Absolute room/grid coordinates used to keep facade variation stable as bounds grow. */
  worldX?: number;
  worldY?: number;
}

export interface ResolveCyberStructureTileOptions extends CyberStructureFacadeContext {
  styleId: CyberStyleId;
  neighborMask: number;
}

export interface ResolveCyberStructureTile8Options extends CyberStructureFacadeContext {
  styleId: CyberStyleId;
  neighborMask8: number;
}

export interface ResolveCyberStructureRectangleOptions {
  styleId: CyberStyleId;
  width: number;
  height: number;
  facade?: CyberStructureFacade;
  worldX?: number;
  worldY?: number;
}

export interface CyberDetailCandidate {
  x: number;
  y: number;
  tile: CyberResolvedTile;
}

interface TileSpec {
  localIndex: number;
  flipX?: boolean;
  flipY?: boolean;
}

const STRUCTURE_ROLE_TILES = {
  isolated: { localIndex: 23 },
  topLeft: { localIndex: 17, flipX: true },
  top: { localIndex: 15 },
  topRight: { localIndex: 17 },
  left: { localIndex: 37 },
  center: { localIndex: 38 },
  right: { localIndex: 37, flipX: true },
  bottomLeft: { localIndex: 61 },
  bottom: { localIndex: 15, flipY: true },
  bottomRight: { localIndex: 61, flipX: true },
  // Cyber has no 90-degree rotation bit. A neutral side-wall tile is the safe
  // fallback for a one-cell-wide vertical run.
  vertical: { localIndex: 37 },
} as const satisfies Record<CyberStructureRole, TileSpec>;

const TOWER_TOP_ROLE_TILES: Partial<Record<CyberStructureRole, TileSpec>> = {
  topLeft: { localIndex: 25 },
  top: { localIndex: 15 },
  topRight: { localIndex: 30 },
};

const STRUCTURE_CONCAVE_TILES = {
  topLeft: { localIndex: 26 },
  topRight: { localIndex: 29 },
  bottomLeft: { localIndex: 38 },
  bottomRight: { localIndex: 41 },
} as const satisfies Record<NonNullable<CyberStructureTopology['concaveCorner']>, TileSpec>;

/**
 * The repeating facade vocabulary sampled from the live Cyber tower. For an
 * eight-cell-wide tower these rows reproduce its shell/panel rhythm exactly,
 * while wider rectangles cycle the six interior cells deterministically.
 */
const TOWER_BODY_ROWS: readonly (readonly TileSpec[])[] = [
  [
    { localIndex: 37 },
    { localIndex: 38 }, { localIndex: 38 }, { localIndex: 38 },
    { localIndex: 38 }, { localIndex: 38 }, { localIndex: 38 },
    { localIndex: 37, flipX: true },
  ],
  [
    { localIndex: 21, flipX: true },
    { localIndex: 64, flipX: true }, { localIndex: 19 }, { localIndex: 83, flipX: true, flipY: true },
    { localIndex: 64, flipX: true }, { localIndex: 64, flipX: true }, { localIndex: 82, flipX: true },
    { localIndex: 21 },
  ],
  [
    { localIndex: 37 },
    { localIndex: 38, flipX: true }, { localIndex: 31 }, { localIndex: 38, flipX: true },
    { localIndex: 38, flipX: true }, { localIndex: 38 }, { localIndex: 38 },
    { localIndex: 37, flipX: true },
  ],
  [
    { localIndex: 21, flipX: true },
    { localIndex: 64, flipX: true }, { localIndex: 31, flipX: true }, { localIndex: 64, flipX: true },
    { localIndex: 19 }, { localIndex: 64, flipX: true }, { localIndex: 64, flipX: true },
    { localIndex: 21 },
  ],
  [
    { localIndex: 37 },
    { localIndex: 38 }, { localIndex: 31, flipY: true }, { localIndex: 38, flipX: true },
    { localIndex: 31, flipX: true }, { localIndex: 38, flipX: true }, { localIndex: 38, flipX: true },
    { localIndex: 37, flipX: true },
  ],
  [
    { localIndex: 21, flipX: true },
    { localIndex: 64, flipX: true }, { localIndex: 31, flipX: true, flipY: true }, { localIndex: 64, flipX: true },
    { localIndex: 31 }, { localIndex: 82 }, { localIndex: 19 },
    { localIndex: 21 },
  ],
  [
    { localIndex: 37 },
    { localIndex: 38, flipX: true }, { localIndex: 31 }, { localIndex: 38, flipX: true },
    { localIndex: 31, flipY: true }, { localIndex: 38, flipX: true }, { localIndex: 31 },
    { localIndex: 37, flipX: true },
  ],
  [
    { localIndex: 23 },
    { localIndex: 83 }, { localIndex: 19, flipY: true }, { localIndex: 64, flipX: true },
    { localIndex: 31, flipX: true, flipY: true }, { localIndex: 64, flipX: true }, { localIndex: 31, flipY: true },
    { localIndex: 21 },
  ],
  [
    { localIndex: 37 },
    { localIndex: 38 }, { localIndex: 38 }, { localIndex: 38, flipX: true },
    { localIndex: 31 }, { localIndex: 38, flipX: true }, { localIndex: 31 },
    { localIndex: 37, flipX: true },
  ],
  [
    { localIndex: 21, flipX: true },
    { localIndex: 64, flipX: true }, { localIndex: 64, flipX: true }, { localIndex: 82 },
    { localIndex: 19, flipY: true }, { localIndex: 83, flipX: true }, { localIndex: 31, flipX: true },
    { localIndex: 21 },
  ],
  [
    { localIndex: 37 },
    { localIndex: 38 }, { localIndex: 38 }, { localIndex: 38 },
    { localIndex: 38 }, { localIndex: 38 }, { localIndex: 31, flipX: true, flipY: true },
    { localIndex: 37, flipX: true },
  ],
  [
    { localIndex: 21, flipX: true },
    { localIndex: 64, flipX: true }, { localIndex: 82, flipX: true }, { localIndex: 83, flipY: true },
    { localIndex: 64, flipX: true }, { localIndex: 64, flipX: true }, { localIndex: 19, flipY: true },
    { localIndex: 21 },
  ],
  [
    { localIndex: 37 },
    { localIndex: 38 }, { localIndex: 38 }, { localIndex: 38 },
    { localIndex: 38 }, { localIndex: 38 }, { localIndex: 38 },
    { localIndex: 37, flipX: true },
  ],
  [
    { localIndex: 21, flipX: true },
    { localIndex: 64 }, { localIndex: 64 }, { localIndex: 64 },
    { localIndex: 64 }, { localIndex: 64 }, { localIndex: 64 },
    { localIndex: 21 },
  ],
] as const;

function assertCyberStyle(styleId: CyberStyleId): void {
  if (!CYBER_STYLE_IDS.includes(styleId)) {
    throw new RangeError(`Unknown Cyber style: ${styleId}`);
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive integer.`);
  }
}

function makeTile(
  styleId: CyberStyleId,
  localIndex: number,
  layer: LayerName,
  flipX = false,
  flipY = false,
): CyberResolvedTile {
  assertCyberStyle(styleId);
  if (!Number.isInteger(localIndex) || localIndex < 0 || localIndex >= 84) {
    throw new RangeError(`Cyber local index ${localIndex} is outside the 84-tile atlas.`);
  }
  return {
    tilesetKey: CYBER_STYLE_PROFILES[styleId].tilesetKey,
    localIndex,
    flipX,
    flipY,
    layer,
    styleId,
  };
}

function makeSpecTile(styleId: CyberStyleId, spec: TileSpec, layer: LayerName): CyberResolvedTile {
  return makeTile(styleId, spec.localIndex, layer, spec.flipX ?? false, spec.flipY ?? false);
}

function makeStructuralTile(styleId: CyberStyleId, spec: TileSpec, layer: LayerName): CyberResolvedTile {
  if (CYBER_DECO_ONLY.has(spec.localIndex)) {
    throw new Error(`Cyber structural resolver cannot emit deco-only tile ${spec.localIndex}.`);
  }
  return makeSpecTile(styleId, spec, layer);
}

function assertSpanLength(familyId: CyberFamilyId, length: number, minimum: number): void {
  assertPositiveInteger(length, `${CYBER_FAMILY_DEFINITIONS[familyId].label} length`);
  if (length < minimum) {
    throw new RangeError(`${CYBER_FAMILY_DEFINITIONS[familyId].label} requires at least ${minimum} cells.`);
  }
}

function repeatSpan(
  styleId: CyberStyleId,
  length: number,
  left: TileSpec,
  middle: readonly TileSpec[],
  right: TileSpec,
  layer: LayerName,
  structural: boolean,
): CyberResolvedTile[] {
  const create = structural ? makeStructuralTile : makeSpecTile;
  return Array.from({ length }, (_, index) => {
    const spec = index === 0
      ? left
      : index === length - 1
        ? right
        : middle[(index - 1) % middle.length]!;
    return create(styleId, spec, layer);
  });
}

export function isCyberDecoOnlyLocalIndex(localIndex: number): boolean {
  return CYBER_DECO_ONLY.has(localIndex);
}

export function isCyberDetailAllowed(styleId: CyberStyleId, localIndex: number): boolean {
  assertCyberStyle(styleId);
  return CYBER_DETAILS.has(localIndex);
}

export function isCyberEmitterLocalIndex(styleId: CyberStyleId, localIndex: number): boolean {
  assertCyberStyle(styleId);
  return CYBER_EMITTERS[styleId].has(localIndex);
}

export function getCyberConnectivityKey(styleId: CyberStyleId, familyId: CyberFamilyId): string {
  assertCyberStyle(styleId);
  return `${styleId}:${familyId}`;
}

export function cyberFamiliesConnect(
  first: { styleId: CyberStyleId; familyId: CyberFamilyId },
  second: { styleId: CyberStyleId; familyId: CyberFamilyId },
): boolean {
  return getCyberConnectivityKey(first.styleId, first.familyId)
    === getCyberConnectivityKey(second.styleId, second.familyId);
}

export function getCyberMinimumSize(familyId: CyberFamilyId): { width: number; height: number } {
  const definition: CyberFamilyDefinition = CYBER_FAMILY_DEFINITIONS[familyId];
  return { width: definition.minimumWidth, height: definition.minimumHeight };
}

export function validateCyberFootprint(
  familyId: CyberFamilyId,
  width: number,
  height: number,
): string | null {
  const definition: CyberFamilyDefinition = CYBER_FAMILY_DEFINITIONS[familyId];
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    return 'Width and height must be positive integers.';
  }
  if (width < definition.minimumWidth || height < definition.minimumHeight) {
    return `${definition.label} requires at least ${definition.minimumWidth} x ${definition.minimumHeight} cells.`;
  }
  if (definition.maximumHeight !== undefined && height > definition.maximumHeight) {
    return `${definition.label} must be exactly ${definition.maximumHeight} cell${definition.maximumHeight === 1 ? '' : 's'} tall.`;
  }
  return null;
}

/** Pass one: classify all sixteen cardinal masks without consulting facade art. */
export function resolveCyberStructureTopology(neighborMask: number): CyberStructureTopology {
  if (!Number.isInteger(neighborMask) || neighborMask < 0 || neighborMask > 15) {
    throw new RangeError('Cyber neighbor mask must be an integer from 0 through 15.');
  }
  const roles: readonly CyberStructureRole[] = [
    'isolated',
    'vertical',
    'topLeft',
    'bottomLeft',
    'topLeft',
    'vertical',
    'topLeft',
    'left',
    'topRight',
    'bottomRight',
    'top',
    'bottom',
    'topRight',
    'right',
    'top',
    'center',
  ];
  return { neighborMask, role: roles[neighborMask]! };
}

/**
 * Diagonal-aware topology used by Cyber Structure. The four cardinal bits are
 * reduced to the stable shell roles above, then a missing supported diagonal
 * becomes a concave corner. This covers every 0..255 neighbor mask.
 */
export function resolveCyberStructureTopology8(neighborMask8: number): CyberStructureTopology {
  if (!Number.isInteger(neighborMask8) || neighborMask8 < 0 || neighborMask8 > 255) {
    throw new RangeError('Cyber 8-neighbor mask must be an integer from 0 through 255.');
  }
  const north = (neighborMask8 & CYBER_NEIGHBOR.north) !== 0;
  const east = (neighborMask8 & CYBER_NEIGHBOR.east) !== 0;
  const south = (neighborMask8 & CYBER_NEIGHBOR.south) !== 0;
  const west = (neighborMask8 & CYBER_NEIGHBOR.west) !== 0;
  const cardinalMask = (north ? CYBER_CARDINAL_NEIGHBOR.north : 0)
    | (east ? CYBER_CARDINAL_NEIGHBOR.east : 0)
    | (south ? CYBER_CARDINAL_NEIGHBOR.south : 0)
    | (west ? CYBER_CARDINAL_NEIGHBOR.west : 0);
  const topology = resolveCyberStructureTopology(cardinalMask);
  let concaveCorner: CyberStructureTopology['concaveCorner'];
  if (north && west && (neighborMask8 & CYBER_NEIGHBOR.northWest) === 0) {
    concaveCorner = 'topLeft';
  } else if (north && east && (neighborMask8 & CYBER_NEIGHBOR.northEast) === 0) {
    concaveCorner = 'topRight';
  } else if (south && west && (neighborMask8 & CYBER_NEIGHBOR.southWest) === 0) {
    concaveCorner = 'bottomLeft';
  } else if (south && east && (neighborMask8 & CYBER_NEIGHBOR.southEast) === 0) {
    concaveCorner = 'bottomRight';
  }
  return {
    neighborMask: neighborMask8,
    role: topology.role,
    ...(concaveCorner ? { concaveCorner } : {}),
  };
}

function resolveTowerBodySpec(
  topology: CyberStructureTopology,
  context: CyberStructureFacadeContext,
): TileSpec | null {
  const { x, y, width, height, worldX, worldY } = context;
  if (
    x === undefined || y === undefined || width === undefined || height === undefined
    || width < 2 || height < 3
    || x < 0 || x >= width || y <= 0 || y >= height - 1
    || !['left', 'center', 'right'].includes(topology.role)
  ) {
    return null;
  }
  const positiveModulo = (value: number, divisor: number) => ((value % divisor) + divisor) % divisor;
  const bodyRowIndex = worldY === undefined
    ? y - 1
    : worldY - (CYBER_TOWER_REFERENCE_ORIGIN.y + 1);
  const recipe = TOWER_BODY_ROWS[positiveModulo(bodyRowIndex, TOWER_BODY_ROWS.length)]!;
  // Irregular silhouettes can have a shell edge inside their component's
  // rectangular bounds. Topology is authoritative for those edges; bounds are
  // used only to phase genuinely interior facade art.
  if (topology.role === 'left') return recipe[0]!;
  if (topology.role === 'right') return recipe[recipe.length - 1]!;
  const interiorColumnIndex = worldX === undefined
    ? x - 1
    : worldX - (CYBER_TOWER_REFERENCE_ORIGIN.x + 1);
  return recipe[1 + positiveModulo(interiorColumnIndex, recipe.length - 2)]!;
}

/** Pass two: apply a style/facade recipe to a topology classification. */
export function resolveCyberStructureFacade(
  styleId: CyberStyleId,
  topology: CyberStructureTopology,
  context: CyberStructureFacadeContext = {},
): CyberResolvedTile {
  assertCyberStyle(styleId);
  const facade = context.facade ?? 'plain';
  if (topology.concaveCorner) {
    return makeStructuralTile(
      styleId,
      STRUCTURE_CONCAVE_TILES[topology.concaveCorner],
      CYBER_FAMILY_DEFINITIONS.structure.layer,
    );
  }
  const towerBody = facade === 'tower' ? resolveTowerBodySpec(topology, context) : null;
  const towerTop = facade === 'tower' ? TOWER_TOP_ROLE_TILES[topology.role] : undefined;
  const spec = towerBody ?? towerTop ?? STRUCTURE_ROLE_TILES[topology.role];
  return makeStructuralTile(styleId, spec, CYBER_FAMILY_DEFINITIONS.structure.layer);
}

export function resolveCyberStructureTile(options: ResolveCyberStructureTileOptions): CyberResolvedTile {
  const topology = resolveCyberStructureTopology(options.neighborMask);
  return resolveCyberStructureFacade(options.styleId, topology, options);
}

export function resolveCyberStructureTile8(options: ResolveCyberStructureTile8Options): CyberResolvedTile {
  const topology = resolveCyberStructureTopology8(options.neighborMask8);
  return resolveCyberStructureFacade(options.styleId, topology, options);
}

export function resolveCyberStructureRectangle(
  options: ResolveCyberStructureRectangleOptions,
): CyberResolvedTile[][] {
  assertCyberStyle(options.styleId);
  assertPositiveInteger(options.width, 'Structure width');
  assertPositiveInteger(options.height, 'Structure height');
  return Array.from({ length: options.height }, (_, y) => (
    Array.from({ length: options.width }, (_, x) => {
      let neighborMask = 0;
      if (y > 0) neighborMask |= CYBER_NEIGHBOR.north;
      if (y > 0 && x < options.width - 1) neighborMask |= CYBER_NEIGHBOR.northEast;
      if (x < options.width - 1) neighborMask |= CYBER_NEIGHBOR.east;
      if (y < options.height - 1 && x < options.width - 1) neighborMask |= CYBER_NEIGHBOR.southEast;
      if (y < options.height - 1) neighborMask |= CYBER_NEIGHBOR.south;
      if (y < options.height - 1 && x > 0) neighborMask |= CYBER_NEIGHBOR.southWest;
      if (x > 0) neighborMask |= CYBER_NEIGHBOR.west;
      if (y > 0 && x > 0) neighborMask |= CYBER_NEIGHBOR.northWest;
      return resolveCyberStructureTile8({
        styleId: options.styleId,
        neighborMask8: neighborMask,
        facade: options.facade ?? 'tower',
        x,
        y,
        width: options.width,
        height: options.height,
        ...(options.worldX === undefined ? {} : { worldX: options.worldX + x }),
        ...(options.worldY === undefined ? {} : { worldY: options.worldY + y }),
      });
    })
  ));
}

const CYBER_PLATFORM_MIDDLES = {
  'cyber-yellow': [{ localIndex: 68 }, { localIndex: 69 }, { localIndex: 68 }, { localIndex: 70 }],
  'cyber-pink': [{ localIndex: 69 }, { localIndex: 70 }, { localIndex: 68 }],
} as const satisfies Record<CyberStyleId, readonly TileSpec[]>;

/** Live Cyber platforms: mirrored 71 end caps around color-specific cycles. */
export function resolveCyberPlatformSpan(styleId: CyberStyleId, length: number): CyberResolvedTile[] {
  assertSpanLength('platform', length, 2);
  return repeatSpan(
    styleId,
    length,
    { localIndex: 71, flipX: true },
    CYBER_PLATFORM_MIDDLES[styleId],
    { localIndex: 71 },
    CYBER_FAMILY_DEFINITIONS.platform.layer,
    true,
  );
}

export function resolveCyberRubbleColumn(
  styleId: CyberStyleId,
  length: number,
): CyberResolvedTile[] {
  assertSpanLength('rubble', length, 1);
  return Array.from({ length }, () => (
    makeStructuralTile(styleId, { localIndex: 12 }, CYBER_FAMILY_DEFINITIONS.rubble.layer)
  ));
}

export function resolveCyberRubbleArea(
  styleId: CyberStyleId,
  width: number,
  height: number,
): CyberResolvedTile[][] {
  assertPositiveInteger(width, 'Rubble width');
  assertPositiveInteger(height, 'Rubble height');
  return Array.from({ length: height }, () => resolveCyberRubbleColumn(styleId, width));
}

/** Sparse owned foreground fragments for a local-12 rubble field. */
export function resolveCyberRubbleDetail(
  styleId: CyberStyleId,
  x: number,
  y: number,
): CyberResolvedTile {
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    throw new RangeError('Cyber rubble detail coordinates must be integers.');
  }
  const hash = Math.abs(
    Math.imul(x + 31, 73856093)
      ^ Math.imul(y + 17, 19349663),
  );
  return makeTile(
    styleId,
    hash % 2 === 0 ? 12 : 24,
    'foreground',
    (hash & 2) !== 0,
    (hash & 4) !== 0,
  );
}

export function resolveOptionalCyberRubbleDetail(
  styleId: CyberStyleId,
  x: number,
  y: number,
): CyberResolvedTile | null {
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    throw new RangeError('Cyber rubble detail coordinates must be integers.');
  }
  const densityHash = Math.abs(
    Math.imul(x + 11, 83492791)
      ^ Math.imul(y + 23, 2654435761),
  );
  return densityHash % CYBER_RUBBLE_DETAIL_CELL_INTERVAL === 0
    ? resolveCyberRubbleDetail(styleId, x, y)
    : null;
}

/**
 * Cyber support is a vertical foundation path. Short paths use explicit cap
 * fallbacks; runs of four or more repeat 48 above the 60/72 lower/base pair.
 */
export function resolveCyberSupportSpan(
  styleId: CyberStyleId,
  length: number,
  flipX = false,
  capFlipX = flipX,
): CyberResolvedTile[] {
  assertSpanLength('support', length, 1);
  if (length === 1) {
    return [makeStructuralTile(
      styleId,
      { localIndex: 36, flipX: capFlipX },
      CYBER_FAMILY_DEFINITIONS.support.layer,
    )];
  }
  if (length === 2) {
    return [
      makeStructuralTile(
        styleId,
        { localIndex: 36, flipX: capFlipX },
        CYBER_FAMILY_DEFINITIONS.support.layer,
      ),
      makeStructuralTile(
        styleId,
        { localIndex: 60, flipX },
        CYBER_FAMILY_DEFINITIONS.support.layer,
      ),
    ];
  }
  return Array.from({ length }, (_, index) => {
    const localIndex = index === 0
      ? 36
      : index === length - 1
        ? 72
        : index === length - 2
          ? 60
          : 48;
    return makeStructuralTile(
      styleId,
      { localIndex, flipX: index === 0 ? capFlipX : flipX },
      CYBER_FAMILY_DEFINITIONS.support.layer,
    );
  });
}

export function resolveCyberNeonStrip(styleId: CyberStyleId, length: number): CyberResolvedTile[] {
  assertSpanLength('neon-strip', length, 3);
  return repeatSpan(
    styleId,
    length,
    { localIndex: 49 },
    [
      { localIndex: 50 },
      { localIndex: 73 },
      { localIndex: 74 },
      { localIndex: 75 },
      { localIndex: 76 },
    ],
    { localIndex: 51 },
    CYBER_FAMILY_DEFINITIONS['neon-strip'].layer,
    true,
  );
}

/** Two-row 44/45/46 + 56/57/58 grille/window macro. */
export function resolveCyberFramedPanel(styleId: CyberStyleId, width: number): CyberResolvedTile[][] {
  assertSpanLength('framed-panel', width, 3);
  const layer = CYBER_FAMILY_DEFINITIONS['framed-panel'].layer;
  return [
    repeatSpan(styleId, width, { localIndex: 44 }, [{ localIndex: 45 }], { localIndex: 46 }, layer, false),
    repeatSpan(styleId, width, { localIndex: 56 }, [{ localIndex: 57 }], { localIndex: 58 }, layer, false),
  ];
}

function detailCandidateKey(candidate: CyberDetailCandidate): string {
  return `${candidate.x},${candidate.y}:${candidate.tile.styleId}:${candidate.tile.localIndex}`;
}

function detailCandidateRank(candidate: CyberDetailCandidate): number {
  return Math.abs(
    Math.imul(candidate.x + 31, 73856093)
      ^ Math.imul(candidate.y + 17, 19349663)
      ^ Math.imul(candidate.tile.localIndex + 7, 83492791),
  );
}

/**
 * Filters to the curated detail allowlist and keeps at most one emitting
 * detail per 64 eligible structure cells. Selection is input-order stable.
 */
export function selectCyberDetailCandidates(
  candidates: readonly CyberDetailCandidate[],
  eligibleStructureCellCount: number,
): CyberDetailCandidate[] {
  const emitterCap = getCyberDetailEmitterCap(eligibleStructureCellCount);
  const allowedByKey = new Map<string, CyberDetailCandidate>();
  for (const candidate of candidates) {
    if (isCyberDetailAllowed(candidate.tile.styleId, candidate.tile.localIndex)) {
      const key = detailCandidateKey(candidate);
      if (!allowedByKey.has(key)) allowedByKey.set(key, candidate);
    }
  }
  const allowed = Array.from(allowedByKey.values());
  const selectedEmitterKeys = new Set(
    allowed
      .filter(({ tile }) => isCyberEmitterLocalIndex(tile.styleId, tile.localIndex))
      .map((candidate) => ({ candidate, rank: detailCandidateRank(candidate) }))
      .sort((first, second) => (
        first.rank - second.rank
        || detailCandidateKey(first.candidate).localeCompare(detailCandidateKey(second.candidate))
      ))
      .slice(0, emitterCap)
      .map(({ candidate }) => detailCandidateKey(candidate)),
  );
  return allowed.filter((candidate) => (
    !isCyberEmitterLocalIndex(candidate.tile.styleId, candidate.tile.localIndex)
    || selectedEmitterKeys.has(detailCandidateKey(candidate))
  ));
}

export function getCyberDetailEmitterCap(eligibleStructureCellCount: number): number {
  if (!Number.isInteger(eligibleStructureCellCount) || eligibleStructureCellCount < 0) {
    throw new RangeError('Eligible Cyber structure cell count must be a non-negative integer.');
  }
  return eligibleStructureCellCount === 0
    ? 0
    : Math.ceil(eligibleStructureCellCount / CYBER_DETAIL_EMITTER_CELL_INTERVAL);
}

export function countCyberEmitters(candidates: readonly CyberDetailCandidate[]): number {
  return candidates.reduce((count, { tile }) => (
    count + (isCyberEmitterLocalIndex(tile.styleId, tile.localIndex) ? 1 : 0)
  ), 0);
}

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

/**
 * Retained for v2 recipe compatibility. Cyber Ground now deliberately uses
 * the same neutral art for both values; decorative tower facades stay manual.
 */
export type CyberStructureFacade = 'plain' | 'tower';

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
    label: 'Ground',
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

export const CYBER_RUBBLE_BORDER_LOCAL_INDICES = {
  top: 0,
  bottom: 24,
  left: 1,
  right: 13,
  topLeft: 10,
  bottomRight: 22,
} as const;

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
  // Cyber F5 is the safest neutral fallback for a one-cell island/run.
  isolated: { localIndex: 64 },
  // Cyber B3 is the only neutral square top corner; mirror it for the right.
  topLeft: { localIndex: 14 },
  top: { localIndex: 15 },
  topRight: { localIndex: 14, flipX: true },
  // The neutral outer walls are the horizontally mirrored Cyber B10/B12.
  left: { localIndex: 21, flipX: true },
  center: { localIndex: 64 },
  right: { localIndex: 23, flipX: true },
  // Cyber C2/C7 become the neutral lower corners when flipped vertically.
  bottomLeft: { localIndex: 25, flipY: true },
  bottom: { localIndex: 62 },
  bottomRight: { localIndex: 30, flipY: true },
  // Cyber has no 90-degree rotation bit. A neutral side-wall tile is the safe
  // fallback for a one-cell-wide vertical run.
  vertical: { localIndex: 64 },
} as const satisfies Record<CyberStructureRole, TileSpec>;

const STRUCTURE_CONCAVE_TILES = {
  topLeft: { localIndex: 25 },
  topRight: { localIndex: 30 },
  bottomLeft: { localIndex: 25, flipY: true },
  bottomRight: { localIndex: 30, flipY: true },
} as const satisfies Record<NonNullable<CyberStructureTopology['concaveCorner']>, TileSpec>;

/** Cyber F5, G11, and G12 are the only neutral underground fill cells. */
const STRUCTURE_UNDERGROUND_TILES = [64, 82, 83] as const;

export type CyberTunnelOutlineRole =
  | 'ceilingLeft'
  | 'ceiling'
  | 'ceilingRight'
  | 'left'
  | 'right'
  | 'floorLeft'
  | 'floor'
  | 'floorRight';

const TUNNEL_OUTLINE_TILES = {
  // Cyber A12 contains a paint burst, so the neutral right corner is A10X.
  ceilingLeft: { localIndex: 9, layer: 'foreground' },
  ceiling: { localIndex: 10, layer: 'foreground' },
  ceilingRight: { localIndex: 9, flipX: true, layer: 'foreground' },
  left: { localIndex: 21, layer: 'terrain' },
  right: { localIndex: 23, layer: 'terrain' },
  floorLeft: { localIndex: 33, layer: 'terrain' },
  floor: { localIndex: 34, layer: 'terrain' },
  floorRight: { localIndex: 35, layer: 'terrain' },
} as const satisfies Record<CyberTunnelOutlineRole, TileSpec & { layer: LayerName }>;

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

function stableNeutralIndex(
  values: readonly number[],
  worldX: number | undefined,
  worldY: number | undefined,
  salt: number,
): number {
  if (worldX === undefined || worldY === undefined || values.length === 1) return values[0]!;
  const hash = Math.abs(
    Math.imul(worldX + 31, 73856093)
      ^ Math.imul(worldY + 17, 19349663)
      ^ salt,
  );
  return values[hash % values.length]!;
}

/** Pass two: apply a style/facade recipe to a topology classification. */
export function resolveCyberStructureFacade(
  styleId: CyberStyleId,
  topology: CyberStructureTopology,
  context: CyberStructureFacadeContext = {},
): CyberResolvedTile {
  assertCyberStyle(styleId);
  if (topology.concaveCorner) {
    return makeStructuralTile(
      styleId,
      STRUCTURE_CONCAVE_TILES[topology.concaveCorner],
      CYBER_FAMILY_DEFINITIONS.structure.layer,
    );
  }
  let spec: TileSpec = STRUCTURE_ROLE_TILES[topology.role];
  if (topology.role === 'center') {
    spec = {
      localIndex: stableNeutralIndex(
        STRUCTURE_UNDERGROUND_TILES,
        context.worldX,
        context.worldY,
        23,
      ),
    };
  } else if (topology.role === 'bottom') {
    // Cyber F3/F4 are the only neutral straight lower-edge cells.
    spec = {
      localIndex: stableNeutralIndex([62, 63], context.worldX, context.worldY, 13),
    };
  }
  return makeStructuralTile(styleId, spec, CYBER_FAMILY_DEFINITIONS.structure.layer);
}

export function resolveCyberStructureUnderground(
  styleId: CyberStyleId,
  worldX?: number,
  worldY?: number,
): CyberResolvedTile {
  return makeStructuralTile(
    styleId,
    { localIndex: stableNeutralIndex(STRUCTURE_UNDERGROUND_TILES, worldX, worldY, 23) },
    CYBER_FAMILY_DEFINITIONS.structure.layer,
  );
}

/**
 * Resolves the authored Cyber A10/A11/A10X, B10/B12, C10/C11/C12 tunnel frame.
 * The A-row trim is intentionally non-colliding Foreground art.
 */
export function resolveCyberTunnelOutlineTile(
  styleId: CyberStyleId,
  role: CyberTunnelOutlineRole,
): CyberResolvedTile {
  const spec = TUNNEL_OUTLINE_TILES[role];
  return spec.layer === 'terrain'
    ? makeStructuralTile(styleId, spec, spec.layer)
    : makeSpecTile(styleId, spec, spec.layer);
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
        facade: options.facade ?? 'plain',
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
  // Cyber F9 is neutral. F10 (paint spill) and F11 (open bottom) remain manual accents.
  'cyber-yellow': [{ localIndex: 68 }],
  'cyber-pink': [{ localIndex: 68 }],
} as const satisfies Record<CyberStyleId, readonly TileSpec[]>;

/** Cyber F12 mirrored end caps around a repeating neutral F9 middle. */
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

/** Feature-style, non-colliding outline art for a local-12 rubble field. */
export function resolveCyberRubbleBorderTile(
  styleId: CyberStyleId,
  part: keyof typeof CYBER_RUBBLE_BORDER_LOCAL_INDICES,
  flipX = false,
  layer: Extract<LayerName, 'foreground' | 'background'> = 'foreground',
): CyberResolvedTile {
  return makeTile(
    styleId,
    CYBER_RUBBLE_BORDER_LOCAL_INDICES[part],
    layer,
    flipX,
  );
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

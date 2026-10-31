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
    label: 'Fence',
    layer: 'foreground',
    minimumWidth: 1,
    minimumHeight: 1,
    structural: false,
  },
} as const satisfies Record<CyberFamilyId, CyberFamilyDefinition>;

/** Tiles declared non-colliding by the Cybercity atlas contract. */
export const CYBER_DECO_ONLY_LOCAL_INDICES = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  13, 18, 22, 24, 32,
  44, 45, 46, 47, 48,
  56, 57, 58, 59, 60,
] as const;

const CYBER_DECO_ONLY = new Set<number>(CYBER_DECO_ONLY_LOCAL_INDICES);

export const CYBER_RUBBLE_BORDER_LOCAL_INDICES = {
  top: 0,
  bottom: 24,
  left: 1,
  right: 13,
  topLeft: 10,
  bottomRight: 22,
} as const;

type CyberConcaveCorner = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';

interface TileSpec {
  localIndex: number;
  flipX?: boolean;
  flipY?: boolean;
}

const STRUCTURE_TIE_TILES = {
  // Cyber A10 is transparent except for one corner. Keeping it on Foreground
  // lets the cardinal Terrain tile retain its own top/side/bottom edge.
  topLeft: { localIndex: 9, flipX: true, flipY: true },
  topRight: { localIndex: 9, flipY: true },
  bottomLeft: { localIndex: 9, flipX: true },
  bottomRight: { localIndex: 9 },
} as const satisfies Record<CyberConcaveCorner, TileSpec>;

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
  // Diagonal ties all use transparent Cyber A10 on Foreground. The straight
  // interior-window ceiling is Cyber C11 flipped vertically on Terrain.
  ceilingLeft: { localIndex: 9, layer: 'foreground' },
  ceiling: { localIndex: 34, flipY: true, layer: 'terrain' },
  ceilingRight: { localIndex: 9, flipX: true, layer: 'foreground' },
  left: { localIndex: 21, layer: 'terrain' },
  right: { localIndex: 23, layer: 'terrain' },
  floorLeft: { localIndex: 9, flipY: true, layer: 'foreground' },
  floor: { localIndex: 34, layer: 'terrain' },
  floorRight: { localIndex: 9, flipX: true, flipY: true, layer: 'foreground' },
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

/** A diagonal tie is a separate non-colliding Cyber A10 Foreground overlay. */
export function resolveCyberStructureTieTile(
  styleId: CyberStyleId,
  corner: CyberConcaveCorner,
): CyberResolvedTile {
  return makeSpecTile(styleId, STRUCTURE_TIE_TILES[corner], 'foreground');
}

/**
 * Resolves the authored Cyber A10 ties, B10/B12 sides, and C11Y/C11
 * interior-window frame. A10 is intentionally non-colliding Foreground art.
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

export const CYBER_RUBBLE_PINK_PERIOD = 8;

function rubbleVarietyHash(x: number, y: number, salt: number, channel: number): number {
  return Math.abs(
    Math.imul(x + 13, 73856093)
    ^ Math.imul(y + 37, 19349663)
    ^ Math.imul((salt | 0) + 1, 83492791)
    ^ Math.imul(channel + 11, 50331653),
  ) >>> 0;
}

/**
 * Rubble is color-interchangeable. Fill and edges shuffle yellow/pink (pink rare)
 * and random H/V flips, stable for a given cell and variety salt.
 * Side edges never flip X; top/bottom edges never flip Y.
 */
export function cyberRubbleEdgeFlipAxes(
  part: keyof typeof CYBER_RUBBLE_BORDER_LOCAL_INDICES,
): { flipX: boolean; flipY: boolean } {
  if (part === 'left' || part === 'right') return { flipX: false, flipY: true };
  if (part === 'top' || part === 'bottom') return { flipX: true, flipY: false };
  return { flipX: false, flipY: false };
}

export function applyCyberRubbleVariety(
  tile: CyberResolvedTile,
  x: number,
  y: number,
  salt = 0,
  channel = 0,
  axes: { flipX?: boolean; flipY?: boolean } = {},
): CyberResolvedTile {
  const hash = rubbleVarietyHash(x, y, salt, channel);
  const styleId: CyberStyleId = hash % CYBER_RUBBLE_PINK_PERIOD === 0
    ? 'cyber-pink'
    : 'cyber-yellow';
  const allowFlipX = axes.flipX !== false;
  const allowFlipY = axes.flipY !== false;
  return makeTile(
    styleId,
    tile.localIndex,
    tile.layer,
    allowFlipX ? Boolean(hash & 8) !== tile.flipX : tile.flipX,
    allowFlipY ? Boolean(hash & 16) !== tile.flipY : tile.flipY,
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
 * Cyber support is a vertical foundation column that grows upward from a base.
 * 1 tile: 72 (base). 2 tiles: 60, 72. 3 tiles: 36, 60, 72.
 * 4+: 36 (top cap), 48 (fill), 60, 72 (base). Atlas cells: 36, 48, 60, 72.
 */
export function resolveCyberSupportSpan(
  styleId: CyberStyleId,
  length: number,
  flipX = false,
  capFlipX = flipX,
): CyberResolvedTile[] {
  assertSpanLength('support', length, 1);
  if (length === 1) {
    return [makeSpecTile(
      styleId,
      { localIndex: 72, flipX },
      CYBER_FAMILY_DEFINITIONS.support.layer,
    )];
  }
  if (length === 2) {
    return [
      makeSpecTile(
        styleId,
        { localIndex: 60, flipX },
        CYBER_FAMILY_DEFINITIONS.support.layer,
      ),
      makeSpecTile(
        styleId,
        { localIndex: 72, flipX },
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
    return makeSpecTile(
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

/**
 * Fence cell from cardinal occupancy. Only painted neighbors count —
 * holes and uneven outlines stay empty.
 *
 * Top (no fence above): 44 left, 45 middle/single, 46 right.
 * Lower: 56 left, 57 middle/single, 58 right. No flipping.
 */
export function resolveCyberFenceCell(
  styleId: CyberStyleId,
  neighbors: { left: boolean; right: boolean; above: boolean },
): CyberResolvedTile {
  const layer = CYBER_FAMILY_DEFINITIONS['framed-panel'].layer;
  const { left, right, above } = neighbors;
  const localIndex = !above
    ? (!left && right ? 44 : left && !right ? 46 : 45)
    : (!left && right ? 56 : left && !right ? 58 : 57);
  return makeSpecTile(styleId, { localIndex }, layer);
}

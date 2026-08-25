import {
  TILE_FLIP_X_FLAG,
  TILE_FLIP_Y_FLAG,
  type LayerName,
  type ToolName,
} from '../config/room';
import { getTilesetByKey } from '../config/tilesets';
import { catalogLocalIndicesForBrush } from './cyberEdgeCatalog';
import {
  getSmartLegacyBrushId,
  type SmartBrushId,
  type SmartLegacyBrushId,
  type SmartStyleId,
} from './model';

export const SMART_RULE_KINDS = [
  'terrain',
  'path',
  'span',
  'rectangle',
  'stamp',
] as const;
export type SmartRuleKind = typeof SMART_RULE_KINDS[number];

export const SMART_RULE_ALGORITHMS = [
  'blob-8way', 'horizontal-strip', 'vertical-strip', 'rectangle-section', 'recipe',
] as const;
export type SmartRuleAlgorithm = typeof SMART_RULE_ALGORITHMS[number];

export const SMART_THEME_IDS = ['forest', 'desert', 'cave', 'gothic', 'cyber', 'water'] as const;
export type SmartThemeId = typeof SMART_THEME_IDS[number];
export type SmartBrushTool = Extract<ToolName, 'pencil' | 'fill' | 'rect' | 'ellipse' | 'line'>;

const FULL_PAINT_TOOLS: readonly SmartBrushTool[] = ['pencil', 'fill', 'rect', 'ellipse', 'line'];
export type SmartCollisionRole = 'solid' | 'non-colliding' | 'mixed';

/** A tileset-local solver result. Rotation is deliberately not part of the room format. */
export interface SmartResolvedTile {
  /** Stable configured tileset key; resolution never depends on global gid ranges. */
  tilesetKey: string;
  localIndex: number;
  layer: LayerName;
  flipX?: boolean;
  flipY?: boolean;
  /** Optional per-output style override for multi-style recipes. */
  styleId?: SmartStyleId;
}

export interface SmartStyleDefinition {
  id: SmartStyleId;
  themeId: SmartThemeId;
  label: string;
  colorLabel: string;
  tilesetKey: string;
  firstGid: number;
  columns: number;
  rows: number;
  tileCount: number;
}

export interface SmartThemeDefinition {
  id: SmartThemeId;
  label: string;
  defaultStyleId: SmartStyleId;
  defaultBrushId: SmartBrushId;
  styleIds: readonly SmartStyleId[];
  brushIds: readonly SmartBrushId[];
}

export interface SmartBrushDefinition {
  id: SmartBrushId;
  label: string;
  description: string;
  ruleKind: SmartRuleKind;
  algorithm: SmartRuleAlgorithm;
  resolverKey: string;
  supportedTools: readonly SmartBrushTool[];
  collisionRole: SmartCollisionRole;
  defaultLayer: LayerName;
  supportedLayers: readonly LayerName[];
  supportedThemeIds: readonly SmartThemeId[];
  supportedStyleIds: readonly SmartStyleId[];
  /** Tiles a manual/legacy room may contribute as neighbors without gaining Smart semantics. */
  compatibleLegacyLocalIndices: readonly number[];
  /** Layers a rule or recipe is allowed to own, including secondary output. */
  outputLayers: readonly LayerName[];
}

interface StyleSeed {
  id: SmartStyleId;
  themeId: SmartThemeId;
  label: string;
  colorLabel: string;
  tilesetKey: string;
}

const STYLE_SEEDS: readonly StyleSeed[] = [
  { id: 'forest', themeId: 'forest', label: 'Forest', colorLabel: 'Default', tilesetKey: 'forest' },
  { id: 'desert', themeId: 'desert', label: 'Desert', colorLabel: 'Default', tilesetKey: 'desert' },
  { id: 'cave', themeId: 'cave', label: 'Cave', colorLabel: 'Default', tilesetKey: 'cave' },
  { id: 'gothic', themeId: 'gothic', label: 'Gothic', colorLabel: 'Default', tilesetKey: 'gothic' },
  { id: 'water', themeId: 'water', label: 'Water', colorLabel: 'Default', tilesetKey: 'water' },
  { id: 'cyber-yellow', themeId: 'cyber', label: 'Cyber Yellow', colorLabel: 'Yellow', tilesetKey: 'cybercity yellow' },
  { id: 'cyber-pink', themeId: 'cyber', label: 'Cyber Pink', colorLabel: 'Pink', tilesetKey: 'cybercity pink' },
];

function createStyleDefinition(seed: StyleSeed): SmartStyleDefinition {
  const tileset = getTilesetByKey(seed.tilesetKey);
  if (!tileset) {
    throw new Error(`Smart style ${seed.id} references missing tileset ${seed.tilesetKey}.`);
  }
  return {
    ...seed,
    firstGid: tileset.firstGid,
    columns: tileset.columns,
    rows: tileset.rows,
    tileCount: tileset.tileCount,
  };
}

export const SMART_STYLE_DEFINITIONS: Readonly<Record<SmartStyleId, SmartStyleDefinition>> =
  Object.fromEntries(STYLE_SEEDS.map((seed) => [seed.id, createStyleDefinition(seed)])) as Record<
    SmartStyleId,
    SmartStyleDefinition
  >;

const LEGACY_SOLID_STYLE_IDS = ['forest', 'desert', 'cave', 'gothic'] as const;
const CYBER_STYLE_IDS = ['cyber-yellow', 'cyber-pink'] as const;

interface LegacyBrushTemplate {
  material: 'ground' | 'platform' | 'feature';
  label: string;
  description: string;
  ruleKind: SmartRuleKind;
  algorithm: SmartRuleAlgorithm;
  resolverKey: string;
  supportedTools: readonly SmartBrushTool[];
  collisionRole: SmartCollisionRole;
  compatibleLegacyLocalIndices: readonly number[];
  outputLayers: readonly LayerName[];
}

const LEGACY_BRUSH_TEMPLATES: readonly LegacyBrushTemplate[] = [
  {
    material: 'ground',
    label: 'Ground',
    description: 'Connected solid terrain with edges, corners, and fill.',
    ruleKind: 'terrain',
    algorithm: 'blob-8way',
    resolverKey: 'legacy.ground',
    supportedTools: FULL_PAINT_TOOLS,
    collisionRole: 'solid',
    compatibleLegacyLocalIndices: [14, 15, 16, 17, 26, 27, 28, 29, 33, 34, 35, 37, 38, 39, 40, 41, 42, 47, 49, 50, 51, 52, 53, 54],
    outputLayers: ['terrain', 'background', 'foreground'],
  },
  {
    material: 'platform',
    label: 'Platform',
    description: 'One-cell-high walkable strips with authored ends.',
    ruleKind: 'path',
    algorithm: 'horizontal-strip',
    resolverKey: 'legacy.platform',
    supportedTools: ['pencil', 'rect'],
    collisionRole: 'solid',
    compatibleLegacyLocalIndices: [44, 45, 46],
    outputLayers: ['terrain', 'foreground'],
  },
  {
    material: 'feature',
    label: 'Feature',
    description: 'Connected structural accents within a terrain style.',
    ruleKind: 'terrain',
    algorithm: 'blob-8way',
    resolverKey: 'legacy.feature',
    supportedTools: FULL_PAINT_TOOLS,
    collisionRole: 'mixed',
    compatibleLegacyLocalIndices: [0, 1, 10, 12, 13, 22, 24],
    outputLayers: ['terrain', 'background', 'foreground'],
  },
];

const LEGACY_BRUSH_DEFINITIONS: SmartBrushDefinition[] = LEGACY_SOLID_STYLE_IDS.flatMap((styleId) =>
  LEGACY_BRUSH_TEMPLATES.map((template) => ({
    ...template,
    id: getSmartLegacyBrushId(styleId, template.material) as SmartLegacyBrushId,
    defaultLayer: 'terrain',
    supportedLayers: ['terrain'],
    supportedThemeIds: [styleId],
    supportedStyleIds: [styleId],
  })),
);

const BRUSH_DEFINITIONS: readonly SmartBrushDefinition[] = [
  ...LEGACY_BRUSH_DEFINITIONS,
  {
    id: 'water.tunnel',
    label: 'Tunnel',
    description: 'Water tunnel backdrop authored behind the player.',
    ruleKind: 'terrain',
    algorithm: 'blob-8way',
    resolverKey: 'legacy.tunnel',
    supportedTools: FULL_PAINT_TOOLS,
    collisionRole: 'non-colliding',
    defaultLayer: 'background',
    supportedLayers: ['background'],
    supportedThemeIds: ['water'],
    supportedStyleIds: ['water'],
    compatibleLegacyLocalIndices: [14, 15, 16, 17, 26, 27, 28, 29, 33, 34, 35, 37, 38, 39, 40, 41, 42, 47, 49, 50, 51, 52, 53, 54],
    outputLayers: ['background', 'foreground'],
  },
  {
    id: 'cyber.concrete',
    label: 'Concrete',
    description: 'Letter-matched Cyber concrete that joins Windows, Shell, and Neon.',
    ruleKind: 'terrain',
    algorithm: 'blob-8way',
    resolverKey: 'cyber.concrete',
    supportedTools: FULL_PAINT_TOOLS,
    collisionRole: 'solid',
    defaultLayer: 'terrain',
    supportedLayers: ['terrain'],
    supportedThemeIds: ['cyber'],
    supportedStyleIds: CYBER_STYLE_IDS,
    compatibleLegacyLocalIndices: catalogLocalIndicesForBrush('cyber.concrete'),
    outputLayers: ['terrain', 'foreground'],
  },
  {
    id: 'cyber.windows',
    label: 'Windows',
    description: 'Window strips that start on a Concrete edge and join Shell and Neon.',
    ruleKind: 'terrain',
    algorithm: 'blob-8way',
    resolverKey: 'cyber.windows',
    supportedTools: FULL_PAINT_TOOLS,
    collisionRole: 'solid',
    defaultLayer: 'terrain',
    supportedLayers: ['terrain'],
    supportedThemeIds: ['cyber'],
    supportedStyleIds: CYBER_STYLE_IDS,
    compatibleLegacyLocalIndices: catalogLocalIndicesForBrush('cyber.windows'),
    outputLayers: ['terrain', 'foreground'],
  },
  {
    id: 'cyber.shell',
    label: 'Shell',
    description: 'Shell cladding that joins Concrete and Windows.',
    ruleKind: 'terrain',
    algorithm: 'blob-8way',
    resolverKey: 'cyber.shell',
    supportedTools: FULL_PAINT_TOOLS,
    collisionRole: 'solid',
    defaultLayer: 'terrain',
    supportedLayers: ['terrain'],
    supportedThemeIds: ['cyber'],
    supportedStyleIds: CYBER_STYLE_IDS,
    compatibleLegacyLocalIndices: catalogLocalIndicesForBrush('cyber.shell'),
    outputLayers: ['terrain', 'foreground'],
  },
  {
    id: 'cyber.rubble',
    label: 'Cyber Rubble',
    description: 'Small colliding Cyber terrain clusters with a structural edge outline.',
    ruleKind: 'stamp',
    algorithm: 'recipe',
    resolverKey: 'cyber.rubble',
    supportedTools: FULL_PAINT_TOOLS,
    collisionRole: 'solid',
    defaultLayer: 'terrain',
    supportedLayers: ['terrain'],
    supportedThemeIds: ['cyber'],
    supportedStyleIds: CYBER_STYLE_IDS,
    compatibleLegacyLocalIndices: [12],
    outputLayers: ['terrain', 'foreground'],
  },
  {
    id: 'cyber.support',
    label: 'Cyber Support',
    description: 'Background support strips and columns.',
    ruleKind: 'span',
    algorithm: 'vertical-strip',
    resolverKey: 'cyber.support',
    supportedTools: FULL_PAINT_TOOLS,
    collisionRole: 'non-colliding',
    defaultLayer: 'background',
    supportedLayers: ['background'],
    supportedThemeIds: ['cyber'],
    supportedStyleIds: CYBER_STYLE_IDS,
    compatibleLegacyLocalIndices: [36, 48, 60, 72],
    outputLayers: ['background'],
  },
  {
    id: 'cyber.neon',
    label: 'Neon',
    description: 'Neon runs that start on a Concrete edge and join Windows and Shell.',
    ruleKind: 'terrain',
    algorithm: 'blob-8way',
    resolverKey: 'cyber.neon',
    supportedTools: FULL_PAINT_TOOLS,
    collisionRole: 'solid',
    defaultLayer: 'terrain',
    supportedLayers: ['terrain'],
    supportedThemeIds: ['cyber'],
    supportedStyleIds: CYBER_STYLE_IDS,
    compatibleLegacyLocalIndices: catalogLocalIndicesForBrush('cyber.neon'),
    outputLayers: ['terrain', 'foreground'],
  },
  {
    id: 'cyber.fence',
    label: 'Fence',
    description: 'Foreground fence stamp emitted as a two-row recipe.',
    ruleKind: 'rectangle',
    algorithm: 'rectangle-section',
    resolverKey: 'cyber.fence',
    supportedTools: FULL_PAINT_TOOLS,
    collisionRole: 'non-colliding',
    defaultLayer: 'foreground',
    supportedLayers: ['foreground'],
    supportedThemeIds: ['cyber'],
    supportedStyleIds: CYBER_STYLE_IDS,
    compatibleLegacyLocalIndices: [44, 45, 46, 56, 57, 58, 59],
    outputLayers: ['foreground'],
  },
];

export const SMART_BRUSH_DEFINITIONS: Readonly<Record<SmartBrushId, SmartBrushDefinition>> =
  Object.fromEntries(BRUSH_DEFINITIONS.map((definition) => [definition.id, definition])) as Record<
    SmartBrushId,
    SmartBrushDefinition
  >;

interface ThemeSeed {
  id: SmartThemeId;
  label: string;
  defaultStyleId: SmartStyleId;
  defaultBrushId: SmartBrushId;
}

const THEME_SEEDS: readonly ThemeSeed[] = [
  { id: 'forest', label: 'Forest', defaultStyleId: 'forest', defaultBrushId: 'forest.ground' },
  { id: 'desert', label: 'Desert', defaultStyleId: 'desert', defaultBrushId: 'desert.ground' },
  { id: 'cave', label: 'Cave', defaultStyleId: 'cave', defaultBrushId: 'cave.ground' },
  { id: 'gothic', label: 'Gothic', defaultStyleId: 'gothic', defaultBrushId: 'gothic.ground' },
  { id: 'cyber', label: 'Cyber', defaultStyleId: 'cyber-yellow', defaultBrushId: 'cyber.concrete' },
  { id: 'water', label: 'Water', defaultStyleId: 'water', defaultBrushId: 'water.tunnel' },
];

export const SMART_THEME_DEFINITIONS: Readonly<Record<SmartThemeId, SmartThemeDefinition>> =
  Object.fromEntries(THEME_SEEDS.map((theme) => [theme.id, {
    ...theme,
    styleIds: STYLE_SEEDS.filter((style) => style.themeId === theme.id).map((style) => style.id),
    brushIds: BRUSH_DEFINITIONS
      .filter((brush) => brush.supportedThemeIds.includes(theme.id))
      .map((brush) => brush.id),
  }])) as unknown as Record<SmartThemeId, SmartThemeDefinition>;

export function listSmartThemeDefinitions(): SmartThemeDefinition[] {
  return SMART_THEME_IDS.map((id) => SMART_THEME_DEFINITIONS[id]);
}

export function getSmartThemeDefinition(id: SmartThemeId): SmartThemeDefinition {
  return SMART_THEME_DEFINITIONS[id];
}

export function getSmartStylesForTheme(id: SmartThemeId): SmartStyleDefinition[] {
  return SMART_THEME_DEFINITIONS[id].styleIds.map((styleId) => SMART_STYLE_DEFINITIONS[styleId]);
}

export function getSmartBrushesForTheme(id: SmartThemeId): SmartBrushDefinition[] {
  return SMART_THEME_DEFINITIONS[id].brushIds.map((brushId) => SMART_BRUSH_DEFINITIONS[brushId]);
}

export function getSmartStylesForBrush(id: SmartBrushId): SmartStyleDefinition[] {
  return SMART_BRUSH_DEFINITIONS[id].supportedStyleIds.map((styleId) => SMART_STYLE_DEFINITIONS[styleId]);
}

export function isSmartBrushToolSupported(id: SmartBrushId, tool: ToolName): boolean {
  return SMART_BRUSH_DEFINITIONS[id].supportedTools.includes(tool as SmartBrushTool);
}

export function getSmartStyleDefinition(id: SmartStyleId): SmartStyleDefinition {
  return SMART_STYLE_DEFINITIONS[id];
}

export function getSmartBrushDefinition(id: SmartBrushId): SmartBrushDefinition {
  return SMART_BRUSH_DEFINITIONS[id];
}

export function isSmartStyleLocalIndex(styleId: SmartStyleId, localIndex: number): boolean {
  return Number.isInteger(localIndex)
    && localIndex >= 0
    && localIndex < getSmartStyleDefinition(styleId).tileCount;
}

/** Resolve a tileset-local result to the room's full encoded gid value. */
export function resolveSmartTileValue(defaultStyleId: SmartStyleId, tile: SmartResolvedTile): number {
  const style = getSmartStyleDefinition(tile.styleId ?? defaultStyleId);
  if (tile.tilesetKey !== style.tilesetKey) {
    throw new RangeError(
      `Smart tile requested tileset ${tile.tilesetKey}, but style ${style.id} uses ${style.tilesetKey}.`,
    );
  }
  if (!isSmartStyleLocalIndex(style.id, tile.localIndex)) {
    throw new RangeError(
      `Smart tile local index ${tile.localIndex} is outside ${style.id}'s 0-${style.tileCount - 1} range.`,
    );
  }
  return style.firstGid
    + tile.localIndex
    + (tile.flipX ? TILE_FLIP_X_FLAG : 0)
    + (tile.flipY ? TILE_FLIP_Y_FLAG : 0);
}

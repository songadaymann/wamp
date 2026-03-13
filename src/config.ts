// ── Room Dimensions ──
export const TILE_SIZE = 16;
export const ROOM_WIDTH = 40;   // tiles
export const ROOM_HEIGHT = 22;  // tiles
export const ROOM_PX_WIDTH = ROOM_WIDTH * TILE_SIZE;   // 640
export const ROOM_PX_HEIGHT = ROOM_HEIGHT * TILE_SIZE;  // 352

// ── Layer Names ──
export const LAYER_NAMES = ['background', 'terrain', 'foreground'] as const;
export type LayerName = typeof LAYER_NAMES[number];

// ── Tools ──
export const TOOLS = ['pencil', 'rect', 'fill', 'eraser'] as const;
export type ToolName = typeof TOOLS[number];

// ── Palette Modes ──
export type PaletteMode = 'tiles' | 'objects';

// ── Tile Selection (multi-tile from palette) ──
export interface TileSelection {
  tilesetKey: string;
  startCol: number;
  startRow: number;
  width: number;   // in tiles
  height: number;  // in tiles
  occupiedMask: boolean[][];
}

// ── Tileset Configs ──
export interface TilesetConfig {
  key: string;
  name: string;
  path: string;
  imageWidth: number;
  imageHeight: number;
  columns: number;
  rows: number;
  tileCount: number;
  firstGid: number;
}

// firstGid assignments: 0 = empty, then sequential per tileset
export const TILESETS: TilesetConfig[] = [
  {
    key: 'forest',
    name: 'Forest',
    path: 'assets/tilesets/tileset_forest.png',
    imageWidth: 192,
    imageHeight: 96,
    columns: 12,
    rows: 6,
    tileCount: 72,
    firstGid: 1,
  },
  {
    key: 'desert',
    name: 'Desert',
    path: 'assets/tilesets/tileset_desert.png',
    imageWidth: 192,
    imageHeight: 96,
    columns: 12,
    rows: 6,
    tileCount: 72,
    firstGid: 73,
  },
  {
    key: 'dirt',
    name: 'Dirt',
    path: 'assets/tilesets/tileset_dirt.png',
    imageWidth: 192,
    imageHeight: 96,
    columns: 12,
    rows: 6,
    tileCount: 72,
    firstGid: 145,
  },
  {
    key: 'lava',
    name: 'Lava',
    path: 'assets/tilesets/tileset_lava.png',
    imageWidth: 240,
    imageHeight: 112,
    columns: 15,
    rows: 7,
    tileCount: 105,
    firstGid: 217,
  },
  {
    key: 'snow',
    name: 'Snow',
    path: 'assets/tilesets/tileset_snow.png',
    imageWidth: 176,
    imageHeight: 96,
    columns: 11,
    rows: 6,
    tileCount: 66,
    firstGid: 322,
  },
  {
    key: 'water',
    name: 'Water',
    path: 'assets/tilesets/tileset_water.png',
    imageWidth: 192,
    imageHeight: 96,
    columns: 12,
    rows: 6,
    tileCount: 72,
    firstGid: 388,
  },
];

export function getTilesetByKey(key: string): TilesetConfig | undefined {
  return TILESETS.find(ts => ts.key === key);
}

// ══════════════════════════════════════
// BACKGROUNDS (parallax layer groups)
// ══════════════════════════════════════

export interface BackgroundLayer {
  key: string;           // Phaser texture key
  path: string;          // asset path
  width: number;
  height: number;
  scrollFactor: number;  // 0 = fixed, 0.1-0.9 = parallax, 1.0 = moves with world
}

export interface BackgroundGroup {
  id: string;
  name: string;
  bgColor?: string;    // Solid color behind all layers (hex, e.g. '#87CEEB')
  layers: BackgroundLayer[];
}

export const BACKGROUND_GROUPS: BackgroundGroup[] = [
  { id: 'none', name: 'None', layers: [] },
  {
    id: 'forest',
    name: 'Forest',
    layers: [
      { key: 'forest_1',  path: 'assets/backgrounds/forest/1.png',  width: 576, height: 324, scrollFactor: 0.0 },
      { key: 'forest_2',  path: 'assets/backgrounds/forest/2.png',  width: 576, height: 324, scrollFactor: 0.05 },
      { key: 'forest_3',  path: 'assets/backgrounds/forest/3.png',  width: 576, height: 324, scrollFactor: 0.1 },
      { key: 'forest_5',  path: 'assets/backgrounds/forest/5.png',  width: 576, height: 324, scrollFactor: 0.2 },
      { key: 'forest_6',  path: 'assets/backgrounds/forest/6.png',  width: 576, height: 324, scrollFactor: 0.3 },
      { key: 'forest_10', path: 'assets/backgrounds/forest/10.png', width: 576, height: 324, scrollFactor: 0.4 },
      { key: 'forest_7',  path: 'assets/backgrounds/forest/7.png',  width: 576, height: 324, scrollFactor: 0.5 },
      { key: 'forest_8',  path: 'assets/backgrounds/forest/8.png',  width: 576, height: 324, scrollFactor: 0.6 },
    ],
  },
  {
    id: 'dark_forest',
    name: 'Dark Forest',
    layers: [
      { key: 'dkforest_1', path: 'assets/backgrounds/dark_forest/1.png', width: 576, height: 324, scrollFactor: 0.0 },
      { key: 'dkforest_2', path: 'assets/backgrounds/dark_forest/2.png', width: 576, height: 324, scrollFactor: 0.05 },
      { key: 'dkforest_3', path: 'assets/backgrounds/dark_forest/3.png', width: 576, height: 324, scrollFactor: 0.1 },
      { key: 'dkforest_4', path: 'assets/backgrounds/dark_forest/4.png', width: 576, height: 324, scrollFactor: 0.2 },
      { key: 'dkforest_5', path: 'assets/backgrounds/dark_forest/5.png', width: 576, height: 324, scrollFactor: 0.35 },
      { key: 'dkforest_6', path: 'assets/backgrounds/dark_forest/6.png', width: 576, height: 324, scrollFactor: 0.5 },
      { key: 'dkforest_7', path: 'assets/backgrounds/dark_forest/7.png', width: 576, height: 324, scrollFactor: 0.6 },
    ],
  },
  {
    id: 'grassland',
    name: 'Grassland',
    layers: [
      { key: 'grass_1', path: 'assets/backgrounds/grassland/1.png', width: 576, height: 324, scrollFactor: 0.0 },
      { key: 'grass_2', path: 'assets/backgrounds/grassland/2.png', width: 576, height: 324, scrollFactor: 0.15 },
      { key: 'grass_3', path: 'assets/backgrounds/grassland/3.png', width: 576, height: 324, scrollFactor: 0.35 },
      { key: 'grass_4', path: 'assets/backgrounds/grassland/4.png', width: 576, height: 324, scrollFactor: 0.6 },
    ],
  },
  {
    id: 'mountains',
    name: 'Mountains',
    layers: [
      { key: 'mtn_1', path: 'assets/backgrounds/mountains/1.png', width: 576, height: 324, scrollFactor: 0.0 },
      { key: 'mtn_2', path: 'assets/backgrounds/mountains/2.png', width: 576, height: 324, scrollFactor: 0.15 },
      { key: 'mtn_3', path: 'assets/backgrounds/mountains/3.png', width: 576, height: 324, scrollFactor: 0.35 },
      { key: 'mtn_4', path: 'assets/backgrounds/mountains/4.png', width: 576, height: 324, scrollFactor: 0.6 },
    ],
  },
  {
    id: 'meadow',
    name: 'Meadow',
    layers: [
      { key: 'meadow_1', path: 'assets/backgrounds/meadow/1.png', width: 576, height: 324, scrollFactor: 0.0 },
      { key: 'meadow_2', path: 'assets/backgrounds/meadow/2.png', width: 576, height: 324, scrollFactor: 0.1 },
      { key: 'meadow_3', path: 'assets/backgrounds/meadow/3.png', width: 576, height: 324, scrollFactor: 0.25 },
      { key: 'meadow_4', path: 'assets/backgrounds/meadow/4.png', width: 576, height: 324, scrollFactor: 0.45 },
      { key: 'meadow_5', path: 'assets/backgrounds/meadow/5.png', width: 576, height: 324, scrollFactor: 0.6 },
    ],
  },
  {
    id: 'aurora',
    name: 'Aurora',
    layers: [
      { key: 'aurora_1', path: 'assets/backgrounds/aurora/1.png', width: 576, height: 324, scrollFactor: 0.0 },
      { key: 'aurora_2', path: 'assets/backgrounds/aurora/2.png', width: 576, height: 324, scrollFactor: 0.2 },
      { key: 'aurora_3', path: 'assets/backgrounds/aurora/3.png', width: 576, height: 324, scrollFactor: 0.5 },
    ],
  },
  {
    id: 'cave',
    name: 'Cave',
    layers: [
      { key: 'cave_far',  path: 'assets/backgrounds/cave/layer1_far.png',  width: 960, height: 480, scrollFactor: 0.0 },
      { key: 'cave_mid',  path: 'assets/backgrounds/cave/layer2_mid.png',  width: 960, height: 480, scrollFactor: 0.2 },
      { key: 'cave_near', path: 'assets/backgrounds/cave/layer3_near.png', width: 960, height: 480, scrollFactor: 0.5 },
    ],
  },
];

export function getBackgroundGroup(id: string): BackgroundGroup | undefined {
  return BACKGROUND_GROUPS.find(g => g.id === id);
}

// ══════════════════════════════════════
// GAME OBJECTS (enemies, collectibles, hazards, decorations)
// ══════════════════════════════════════

export type ObjectCategory = 'collectible' | 'hazard' | 'enemy' | 'platform' | 'decoration' | 'interactive';

export interface GameObjectConfig {
  id: string;
  name: string;
  category: ObjectCategory;
  path: string;
  /** width of a single frame in pixels */
  frameWidth: number;
  /** height of a single frame in pixels */
  frameHeight: number;
  /** total frames in the spritesheet (0 or 1 = static image) */
  frameCount: number;
  /** frames per second for animation */
  fps: number;
  /** explicit animation frame order, when it should not just be 0..frameCount-1 */
  animationFrames?: number[];
  /** frame to show for non-animated placement/preview rendering */
  defaultFrame?: number;
  /** horizontal direction the unflipped sprite art naturally faces */
  facingDirection?: 'left' | 'right';
  /** collision body width (0 = no collision / decoration) */
  bodyWidth: number;
  /** collision body height (0 = no collision / decoration) */
  bodyHeight: number;
  /** explicit collision body offset inside the frame */
  bodyOffsetX?: number;
  /** explicit collision body offset inside the frame */
  bodyOffsetY?: number;
  /** optional editor preview width override */
  previewWidth?: number;
  /** optional editor preview height override */
  previewHeight?: number;
  /** optional editor preview x offset inside the frame */
  previewOffsetX?: number;
  /** optional editor preview y offset inside the frame */
  previewOffsetY?: number;
  /** behavior hint for runtime object logic */
  behavior: 'static' | 'patrol' | 'fly' | 'bounce' | 'animated' | 'shooter';
  /** short tooltip description for the editor palette */
  description: string;
}

export const GAME_OBJECTS: GameObjectConfig[] = [
  // ── Collectibles ──
  { id: 'coin_gold',   name: 'Gold Coin',   category: 'collectible', path: 'assets/objects/coin_gold.png',   frameWidth: 16, frameHeight: 16, frameCount: 8,  fps: 10, bodyWidth: 12, bodyHeight: 12, behavior: 'animated', description: 'Collect for points. Disappears on contact.' },
  { id: 'coin_silver', name: 'Silver Coin', category: 'collectible', path: 'assets/objects/coin_silver.png', frameWidth: 16, frameHeight: 16, frameCount: 8,  fps: 10, bodyWidth: 12, bodyHeight: 12, behavior: 'animated', description: 'Collect for points. Worth less than gold.' },
  { id: 'gem',         name: 'Gem',         category: 'collectible', path: 'assets/objects/gem.png',         frameWidth: 16, frameHeight: 16, frameCount: 5,  fps: 8,  bodyWidth: 12, bodyHeight: 12, behavior: 'animated', description: 'Premium collectible. High point value.' },
  { id: 'heart',       name: 'Heart',       category: 'collectible', path: 'assets/objects/heart.png',       frameWidth: 16, frameHeight: 16, frameCount: 3,  fps: 6,  bodyWidth: 12, bodyHeight: 12, behavior: 'animated', description: 'Restores health on pickup.' },
  { id: 'key',         name: 'Key',         category: 'collectible', path: 'assets/objects/key.png',         frameWidth: 16, frameHeight: 16, frameCount: 5,  fps: 6,  bodyWidth: 12, bodyHeight: 12, behavior: 'animated', description: 'Unlocks matching lock gates.' },
  { id: 'apple',       name: 'Apple',       category: 'collectible', path: 'assets/objects/apple.png',       frameWidth: 16, frameHeight: 16, frameCount: 1,  fps: 0,  bodyWidth: 12, bodyHeight: 12, behavior: 'static',   description: 'Collectible fruit.' },
  { id: 'banana',      name: 'Banana',      category: 'collectible', path: 'assets/objects/banana.png',      frameWidth: 16, frameHeight: 16, frameCount: 1,  fps: 0,  bodyWidth: 12, bodyHeight: 12, behavior: 'static',   description: 'Collectible fruit.' },

  // ── Hazards ──
  { id: 'spikes',      name: 'Spikes',      category: 'hazard',      path: 'assets/enemies/spikes.png',      frameWidth: 16, frameHeight: 16, frameCount: 4,  fps: 8,  bodyWidth: 14, bodyHeight: 10, behavior: 'animated', description: 'Animated spike trap. Kills on contact.' },
  { id: 'saw',         name: 'Saw',         category: 'hazard',      path: 'assets/enemies/saw.png',         frameWidth: 34, frameHeight: 34, frameCount: 4,  fps: 8,  animationFrames: [0, 2, 3, 2], bodyWidth: 30, bodyHeight: 30, behavior: 'animated', description: 'Spinning blade. Orbits in a circle.' },
  { id: 'fire',        name: 'Fire',        category: 'hazard',      path: 'assets/enemies/fire.png',        frameWidth: 16, frameHeight: 16, frameCount: 6,  fps: 10, bodyWidth: 12, bodyHeight: 14, behavior: 'animated', description: 'Stationary flame. Burns on contact.' },
  { id: 'fireball',    name: 'Fireball',    category: 'hazard',      path: 'assets/enemies/fireball.png',    frameWidth: 16, frameHeight: 16, frameCount: 4,  fps: 10, bodyWidth: 12, bodyHeight: 12, behavior: 'animated', description: 'Shoots in a direction. Kills on contact.' },
  { id: 'wood_stakes', name: 'Wood Stakes', category: 'hazard',      path: 'assets/enemies/wood_stakes.png', frameWidth: 32, frameHeight: 32, frameCount: 1,  fps: 0,  bodyWidth: 28, bodyHeight: 28, behavior: 'static',   description: 'Sharpened stakes. Kills on contact.' },
  { id: 'cannon',      name: 'Cannon',      category: 'hazard',      path: 'assets/enemies/cannon.png',      frameWidth: 32, frameHeight: 32, frameCount: 1,  fps: 0,  defaultFrame: 2, facingDirection: 'left', bodyWidth: 24, bodyHeight: 18, behavior: 'shooter',  description: 'Shoots bullets in the direction it faces.' },
  { id: 'cactus',      name: 'Cactus',      category: 'hazard',      path: 'assets/enemies/cactus.png',      frameWidth: 32, frameHeight: 32, frameCount: 6,  fps: 8,  bodyWidth: 16, bodyHeight: 26, behavior: 'animated', description: 'Animated cactus hazard. Hurts on contact.' },
  { id: 'tornado',     name: 'Tornado',     category: 'hazard',      path: 'assets/enemies/tornado.png',     frameWidth: 48, frameHeight: 48, frameCount: 8,  fps: 10, bodyWidth: 28, bodyHeight: 40, behavior: 'animated', description: 'Animated whirlwind hazard. Hurts on contact.' },

  // ── Enemies ──
  { id: 'slime_blue',  name: 'Blue Slime',  category: 'enemy',       path: 'assets/enemies/slime_blue.png',  frameWidth: 16, frameHeight: 16, frameCount: 5,  fps: 6,  facingDirection: 'left', bodyWidth: 12, bodyHeight: 10, behavior: 'patrol',   description: 'Patrols back and forth. Kills on contact.' },
  { id: 'slime_red',   name: 'Red Slime',   category: 'enemy',       path: 'assets/enemies/slime_red.png',   frameWidth: 16, frameHeight: 16, frameCount: 5,  fps: 6,  facingDirection: 'left', bodyWidth: 12, bodyHeight: 10, behavior: 'patrol',   description: 'Patrols back and forth. Kills on contact.' },
  { id: 'bat',         name: 'Bat',         category: 'enemy',       path: 'assets/enemies/bat.png',         frameWidth: 32, frameHeight: 32, frameCount: 8,  fps: 8,  animationFrames: [4, 5, 6, 7, 6, 5], defaultFrame: 6, facingDirection: 'left', bodyWidth: 24, bodyHeight: 20, behavior: 'fly',      description: 'Flies in a wave pattern. Kills on contact.' },
  { id: 'crab',        name: 'Crab',        category: 'enemy',       path: 'assets/enemies/crab.png',        frameWidth: 32, frameHeight: 16, frameCount: 9,  fps: 8,  animationFrames: [0, 1, 2, 1], defaultFrame: 1, facingDirection: 'left', bodyWidth: 24, bodyHeight: 10, behavior: 'patrol',   description: 'Patrols back and forth. Kills on contact.' },
  { id: 'bird',        name: 'Bird',        category: 'enemy',       path: 'assets/enemies/bird.png',        frameWidth: 32, frameHeight: 32, frameCount: 4,  fps: 10, facingDirection: 'left', bodyWidth: 24, bodyHeight: 20, behavior: 'fly',      description: 'Flies in a wave pattern. Kills on contact.' },
  { id: 'fish',        name: 'Fish',        category: 'enemy',       path: 'assets/enemies/fish.png',        frameWidth: 16, frameHeight: 16, frameCount: 6,  fps: 8,  animationFrames: [0, 2, 4, 2], defaultFrame: 2, facingDirection: 'left', bodyWidth: 14, bodyHeight: 12, behavior: 'bounce',   description: 'Jumps up and down. Kills on contact.' },
  { id: 'frog',        name: 'Frog',        category: 'enemy',       path: 'assets/enemies/frog.png',        frameWidth: 32, frameHeight: 32, frameCount: 4,  fps: 6,  facingDirection: 'right', bodyWidth: 24, bodyHeight: 24, behavior: 'bounce',   description: 'Hops around periodically. Kills on contact.' },
  { id: 'snake',       name: 'Snake',       category: 'enemy',       path: 'assets/enemies/snake.png',       frameWidth: 32, frameHeight: 32, frameCount: 4,  fps: 6,  facingDirection: 'left', bodyWidth: 24, bodyHeight: 20, behavior: 'patrol',   description: 'Patrols back and forth. Kills on contact.' },
  { id: 'penguin',     name: 'Penguin',     category: 'enemy',       path: 'assets/enemies/penguin.png',     frameWidth: 32, frameHeight: 32, frameCount: 4,  fps: 6,  facingDirection: 'right', bodyWidth: 24, bodyHeight: 28, behavior: 'patrol',   description: 'Patrols back and forth. Kills on contact.' },

  // ── Interactive ──
  { id: 'bounce_pad',  name: 'Bounce Pad',  category: 'interactive', path: 'assets/objects/bounce_pad.png',  frameWidth: 16, frameHeight: 32, frameCount: 4,  fps: 0,  bodyWidth: 16, bodyHeight: 8,  behavior: 'bounce',   description: 'Launches player upward on contact.' },
  { id: 'spawn_point', name: 'Spawn Point', category: 'interactive', path: 'assets/objects/sign_arrow.png',  frameWidth: 16, frameHeight: 32, frameCount: 1,  fps: 0,  bodyWidth: 0,  bodyHeight: 0,  behavior: 'static',   description: 'Player spawn marker. Only one is stored per room.' },
  { id: 'flag',        name: 'Flag',        category: 'interactive', path: 'assets/objects/flag.png',        frameWidth: 32, frameHeight: 32, frameCount: 9,  fps: 8,  bodyWidth: 8,  bodyHeight: 28, behavior: 'animated', description: 'Goal marker. Reach to complete the room.' },
  { id: 'crate',       name: 'Crate',       category: 'platform',    path: 'assets/objects/crate_static.png', frameWidth: 32, frameHeight: 32, frameCount: 1,  fps: 0,  bodyWidth: 16, bodyHeight: 16, bodyOffsetX: 0, bodyOffsetY: 16, previewWidth: 16, previewHeight: 16, previewOffsetX: 0, previewOffsetY: 16, behavior: 'static',   description: 'Solid block. Stand on it or push it.' },
  { id: 'sign',        name: 'Sign',        category: 'decoration',  path: 'assets/objects/sign.png',        frameWidth: 16, frameHeight: 32, frameCount: 1,  fps: 0,  bodyWidth: 0,  bodyHeight: 0,  behavior: 'static',   description: 'Decorative signpost. No collision.' },
  { id: 'sign_arrow',  name: 'Arrow Sign',  category: 'decoration',  path: 'assets/objects/sign_arrow.png',  frameWidth: 16, frameHeight: 32, frameCount: 1,  fps: 0,  bodyWidth: 0,  bodyHeight: 0,  behavior: 'static',   description: 'Decorative arrow sign. No collision.' },
  { id: 'ladder',      name: 'Ladder',      category: 'interactive', path: 'assets/objects/ladder.png',      frameWidth: 16, frameHeight: 64, frameCount: 1,  fps: 0,  bodyWidth: 14, bodyHeight: 60, behavior: 'static',   description: 'Climbable surface. Press up to climb.' },

  // ── Decorations ──
  { id: 'bush',        name: 'Bush',        category: 'decoration',  path: 'assets/deco/bush.png',           frameWidth: 32, frameHeight: 16, frameCount: 1,  fps: 0,  bodyWidth: 0,  bodyHeight: 0,  behavior: 'static',   description: 'Decorative bush. No collision.' },
  { id: 'rock',        name: 'Rock',        category: 'decoration',  path: 'assets/deco/rock.png',           frameWidth: 16, frameHeight: 16, frameCount: 1,  fps: 0,  bodyWidth: 0,  bodyHeight: 0,  behavior: 'static',   description: 'Decorative rock. No collision.' },
  { id: 'tree',        name: 'Tree',        category: 'decoration',  path: 'assets/deco/tree.png',           frameWidth: 48, frameHeight: 48, frameCount: 1,  fps: 0,  bodyWidth: 0,  bodyHeight: 0,  behavior: 'static',   description: 'Decorative tree. No collision.' },
  { id: 'tree_b',      name: 'Tree B',      category: 'decoration',  path: 'assets/deco/tree_b.png',         frameWidth: 48, frameHeight: 64, frameCount: 1,  fps: 0,  bodyWidth: 0,  bodyHeight: 0,  behavior: 'static',   description: 'Large decorative tree. No collision.' },
  { id: 'sun',         name: 'Sun',         category: 'decoration',  path: 'assets/deco/sun.png',            frameWidth: 32, frameHeight: 32, frameCount: 6,  fps: 4,  bodyWidth: 0,  bodyHeight: 0,  behavior: 'animated', description: 'Animated sun. Purely decorative.' },
  { id: 'clouds_deco', name: 'Clouds',      category: 'decoration',  path: 'assets/deco/clouds.png',         frameWidth: 64, frameHeight: 24, frameCount: 2,  fps: 0,  bodyWidth: 0,  bodyHeight: 0,  behavior: 'static',   description: 'Cloud decoration. No collision.' },
];

export function getObjectById(id: string): GameObjectConfig | undefined {
  return GAME_OBJECTS.find(obj => obj.id === id);
}

export function getObjectAnimationFrames(config: GameObjectConfig): number[] {
  if (config.animationFrames && config.animationFrames.length > 0) {
    return [...config.animationFrames];
  }

  return Array.from({ length: config.frameCount }, (_, index) => index);
}

export function getObjectDefaultFrame(config: GameObjectConfig): number {
  if (typeof config.defaultFrame === 'number') {
    return config.defaultFrame;
  }

  return getObjectAnimationFrames(config)[0] ?? 0;
}

// ── Placed Object Instance ──
export interface PlacedObject {
  id: string;        // GameObjectConfig.id
  x: number;         // world pixel x
  y: number;         // world pixel y
  facing?: 'left' | 'right';
}

// ── Editor State (shared between Phaser and HTML UI) ──
export interface EditorState {
  activeTool: ToolName;
  activeLayer: LayerName;
  selectedTilesetKey: string;
  selectedTileGid: number;  // global tile ID of top-left of selection
  selection: TileSelection;
  zoom: number;
  isPlaying: boolean;
  paletteMode: PaletteMode;
  selectedObjectId: string | null;
  objectFacing: 'left' | 'right';
  selectedBackground: string;        // BackgroundGroup.id
  placedObjects: PlacedObject[];
}

export const editorState: EditorState = {
  activeTool: 'pencil',
  activeLayer: 'terrain',
  selectedTilesetKey: 'forest',
  selectedTileGid: 1,  // first tile of forest
  selection: {
    tilesetKey: 'forest',
    startCol: 0,
    startRow: 0,
    width: 1,
    height: 1,
    occupiedMask: [[true]],
  },
  zoom: 2,
  isPlaying: false,
  paletteMode: 'tiles',
  selectedObjectId: null,
  objectFacing: 'right',
  selectedBackground: 'none',
  placedObjects: [],
};

export function selectionCellIsOccupied(dx: number, dy: number): boolean {
  const row = editorState.selection.occupiedMask[dy];
  if (!row) return true;
  return row[dx] ?? true;
}

// Helper: get the GID for a position within the current selection
export function getSelectionGid(dx: number, dy: number): number {
  const ts = getTilesetByKey(editorState.selection.tilesetKey);
  if (!ts) return editorState.selectedTileGid;
  if (!selectionCellIsOccupied(dx, dy)) return -1;
  const col = editorState.selection.startCol + dx;
  const row = editorState.selection.startRow + dy;
  return ts.firstGid + row * ts.columns + col;
}

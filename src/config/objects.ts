import type { LightEmissionConfig } from '../lighting/model';
import {
  getCustomSpriteCategory,
  isCustomSpriteObjectId,
  type CustomSpriteKind,
} from '../customSprites/model';
import { GHOST_OBJECT_ID } from '../enemies/ghost';
import { SWORDSMAN_AI_OBJECT_ID } from '../enemies/swordsmanAi';
import type { SwordsmanDefeatMode, SwordsmanObjectiveMode } from '../enemies/swordsmanObjectives';
import { TILE_SIZE, type LayerName } from './room';
import {
  FIRE_BIG_LIGHT_EMISSION,
  FIRE_LIGHT_EMISSION,
  LAVA_OBJECT_LIGHT_EMISSION,
} from './tilesets';

// ══════════════════════════════════════
// GAME OBJECTS (enemies, collectibles, hazards, decorations)
// ══════════════════════════════════════

export type ObjectCategory = 'collectible' | 'hazard' | 'enemy' | 'platform' | 'decoration' | 'interactive';
export type ObjectInteraction = 'pushable';

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
  /** visual scale applied when drawing this object's sprite */
  displayScale?: number;
  /** visual x offset applied when drawing this object's sprite */
  displayOffsetX?: number;
  /** visual y offset applied when drawing this object's sprite */
  displayOffsetY?: number;
  /** optional editor preview width override */
  previewWidth?: number;
  /** optional editor preview height override */
  previewHeight?: number;
  /** optional editor preview x offset inside the frame */
  previewOffsetX?: number;
  /** optional editor preview y offset inside the frame */
  previewOffsetY?: number;
  /** align placement to the preview bounds rather than the full frame box */
  placeUsingPreviewBounds?: boolean;
  /** behavior hint for runtime object logic */
  behavior: 'static' | 'patrol' | 'fly' | 'bounce' | 'animated' | 'shooter';
  /** optional runtime interaction capability shared across object categories */
  interaction?: ObjectInteraction;
  /** false for actors that keep overlap bodies but pass through terrain and solid objects */
  collidesWithWorld?: boolean;
  /** optional emissive lighting behavior for dark rooms */
  lightEmission?: LightEmissionConfig;
  /** short tooltip description for the editor palette */
  description: string;
}

export const PRESSURE_PLATE_TARGET_OBJECT_IDS = [
  'door_locked',
  'door_metal',
  'cage',
  'treasure_chest',
  'trapdoor_locked',
  'trapdoor_metal',
] as const;

export type PressurePlateTargetObjectId = (typeof PRESSURE_PLATE_TARGET_OBJECT_IDS)[number];
export const CONTAINER_OBJECT_IDS = ['cage', 'treasure_chest'] as const;
export type ContainerObjectId = (typeof CONTAINER_OBJECT_IDS)[number];
export const BLOCK_SWITCH_OBJECT_ID = 'block_switch' as const;
export const SWITCH_BLOCK_ON_OBJECT_ID = 'switch_block_on' as const;
export const SWITCH_BLOCK_OFF_OBJECT_ID = 'switch_block_off' as const;
export const BLOCK_SWITCH_RED_ACTIVE_TEXTURE_KEY = 'block_switch_red_active' as const;
export const BLOCK_SWITCH_ACTIVE_TEXTURES = [
  {
    key: BLOCK_SWITCH_RED_ACTIVE_TEXTURE_KEY,
    path: 'assets/objects/switch-block-red-active.png',
  },
] as const;
export const SWITCH_BLOCK_OBJECT_IDS = [
  SWITCH_BLOCK_ON_OBJECT_ID,
  SWITCH_BLOCK_OFF_OBJECT_ID,
] as const;
export type SwitchBlockObjectId = (typeof SWITCH_BLOCK_OBJECT_IDS)[number];

export const GAME_OBJECTS: GameObjectConfig[] = [
  // ── Collectibles ──
  { id: 'coin_gold',   name: 'Gold Coin',   category: 'collectible', path: 'assets/objects/coin_gold.png',   frameWidth: 16, frameHeight: 16, frameCount: 8,  fps: 10, bodyWidth: 12, bodyHeight: 12, behavior: 'animated', description: 'Collect for points. Disappears on contact.' },
  { id: 'coin_silver', name: 'Silver Coin', category: 'collectible', path: 'assets/objects/coin_silver.png', frameWidth: 16, frameHeight: 16, frameCount: 8,  fps: 10, bodyWidth: 12, bodyHeight: 12, behavior: 'animated', description: 'Collect for points. Worth less than gold.' },
  { id: 'gem',         name: 'Gem',         category: 'collectible', path: 'assets/objects/gem.png',         frameWidth: 16, frameHeight: 16, frameCount: 5,  fps: 8,  bodyWidth: 12, bodyHeight: 12, behavior: 'animated', description: 'Premium collectible. High point value.' },
  { id: 'blue_gem',    name: 'Blue Gem',    category: 'collectible', path: 'assets/objects/blue_gem.png',    frameWidth: 16, frameHeight: 16, frameCount: 8,  fps: 8,  bodyWidth: 12, bodyHeight: 12, behavior: 'animated', description: 'Blue gemstone collectible. High point value.' },
  { id: 'orange_gem',  name: 'Orange Gem',  category: 'collectible', path: 'assets/objects/orange_gem.png',  frameWidth: 16, frameHeight: 16, frameCount: 4,  fps: 8,  bodyWidth: 12, bodyHeight: 12, behavior: 'animated', description: 'Orange gemstone collectible. High point value.' },
  { id: 'red_gem',     name: 'Red Gem',     category: 'collectible', path: 'assets/objects/red_gem.png',     frameWidth: 16, frameHeight: 16, frameCount: 4,  fps: 8,  bodyWidth: 12, bodyHeight: 12, behavior: 'animated', description: 'Red gemstone collectible. High point value.' },
  { id: 'black_pearl', name: 'Black Pearl', category: 'collectible', path: 'assets/objects/black_pearl.png', frameWidth: 16, frameHeight: 16, frameCount: 4,  fps: 8,  bodyWidth: 12, bodyHeight: 12, behavior: 'animated', description: 'Rare pearl collectible. High point value.' },
  { id: 'crown',       name: 'Crown',       category: 'collectible', path: 'assets/objects/crown.png',       frameWidth: 16, frameHeight: 16, frameCount: 8,  fps: 8,  bodyWidth: 12, bodyHeight: 12, behavior: 'animated', description: 'Royal treasure collectible. High point value.' },
  { id: 'ring',        name: 'Ring',        category: 'collectible', path: 'assets/objects/ring.png',        frameWidth: 16, frameHeight: 16, frameCount: 4,  fps: 8,  bodyWidth: 12, bodyHeight: 12, behavior: 'animated', description: 'Treasure ring collectible.' },
  { id: 'star',        name: 'Star',        category: 'collectible', path: 'assets/objects/star.png',        frameWidth: 16, frameHeight: 16, frameCount: 8,  fps: 8,  bodyWidth: 12, bodyHeight: 12, behavior: 'animated', description: 'Bright star collectible. High point value.' },
  { id: 'heart',       name: 'Heart',       category: 'collectible', path: 'assets/objects/heart.png',       frameWidth: 16, frameHeight: 16, frameCount: 8,  fps: 8,  bodyWidth: 12, bodyHeight: 12, behavior: 'animated', description: 'Restores health on pickup.' },
  { id: 'key',         name: 'Key',         category: 'collectible', path: 'assets/objects/key.png',         frameWidth: 16, frameHeight: 16, frameCount: 8,  fps: 8,  bodyWidth: 12, bodyHeight: 12, behavior: 'animated', description: 'Unlocks matching lock gates.' },
  { id: 'health_potion', name: 'Health Potion', category: 'collectible', path: 'assets/objects/health_potion.png', frameWidth: 16, frameHeight: 16, frameCount: 8, fps: 8, bodyWidth: 12, bodyHeight: 12, behavior: 'animated', description: 'Red potion collectible.' },
  { id: 'mana_potion', name: 'Mana Potion', category: 'collectible', path: 'assets/objects/mana_potion.png', frameWidth: 16, frameHeight: 16, frameCount: 8, fps: 8, bodyWidth: 12, bodyHeight: 12, behavior: 'animated', description: 'Blue potion collectible.' },
  { id: 'mushroom',    name: 'Mushroom',    category: 'collectible', path: 'assets/objects/mushroom.png',    frameWidth: 16, frameHeight: 16, frameCount: 8,  fps: 8,  bodyWidth: 12, bodyHeight: 12, behavior: 'animated', description: 'Mushroom collectible.' },
  { id: 'egg',         name: 'Egg',         category: 'collectible', path: 'assets/objects/egg.png',         frameWidth: 16, frameHeight: 16, frameCount: 8,  fps: 8,  bodyWidth: 12, bodyHeight: 12, behavior: 'animated', description: 'Egg collectible.' },
  { id: 'bone',        name: 'Bone',        category: 'collectible', path: 'assets/objects/bone.png',        frameWidth: 16, frameHeight: 16, frameCount: 8,  fps: 8,  bodyWidth: 12, bodyHeight: 12, behavior: 'animated', description: 'Bone collectible.' },
  { id: 'book',        name: 'Book',        category: 'collectible', path: 'assets/objects/book.png',        frameWidth: 16, frameHeight: 16, frameCount: 8,  fps: 8,  bodyWidth: 12, bodyHeight: 12, behavior: 'animated', description: 'Book collectible.' },
  { id: 'scroll',      name: 'Scroll',      category: 'collectible', path: 'assets/objects/scroll.png',      frameWidth: 16, frameHeight: 16, frameCount: 8,  fps: 8,  bodyWidth: 12, bodyHeight: 12, behavior: 'animated', description: 'Scroll collectible.' },
  { id: 'skull',       name: 'Skull',       category: 'collectible', path: 'assets/objects/skull.png',       frameWidth: 16, frameHeight: 16, frameCount: 8,  fps: 8,  bodyWidth: 12, bodyHeight: 12, behavior: 'animated', description: 'Skull collectible.' },
  { id: 'bomb_pickup', name: 'Bomb Pickup', category: 'collectible', path: 'assets/objects/bomb_pickup.png', frameWidth: 16, frameHeight: 16, frameCount: 8,  fps: 8,  bodyWidth: 12, bodyHeight: 12, behavior: 'animated', description: 'Bomb-shaped collectible. Safe to pick up.' },
  { id: 'apple',       name: 'Apple',       category: 'collectible', path: 'assets/objects/apple.png',       frameWidth: 16, frameHeight: 16, frameCount: 1,  fps: 0,  bodyWidth: 12, bodyHeight: 12, behavior: 'static',   description: 'Collectible fruit.' },
  { id: 'banana',      name: 'Banana',      category: 'collectible', path: 'assets/objects/banana.png',      frameWidth: 16, frameHeight: 16, frameCount: 1,  fps: 0,  bodyWidth: 12, bodyHeight: 12, behavior: 'static',   description: 'Collectible fruit.' },
  { id: 'kitkat',      name: 'KitKat',      category: 'collectible', path: 'assets/objects/kitkat.png',      frameWidth: 16, frameHeight: 16, frameCount: 12,  fps: 10,  bodyWidth: 12, bodyHeight: 12, behavior: 'animated',   description: 'Collectible candy bar.' },
  { id: 'poop',        name: 'Poop',        category: 'collectible', path: 'assets/objects/poop.png',        frameWidth: 16, frameHeight: 16, frameCount: 1,   fps: 0,   bodyWidth: 12, bodyHeight: 12, behavior: 'static',     description: 'Collectible poop.' },
  { id: 'cake',        name: 'Cake',        category: 'collectible', path: 'assets/objects/cake.png',        frameWidth: 32, frameHeight: 32, frameCount: 6,   fps: 10,   bodyWidth: 32, bodyHeight: 32, behavior: 'animated',     description: 'Collectible cake.' },
  { id: 'coin_small_gold',   name: 'Small Gold Coin',   category: 'collectible', path: 'assets/objects/coin_small_gold.png',   frameWidth: 16, frameHeight: 16, frameCount: 6,  fps: 10, bodyWidth: 10, bodyHeight: 10, behavior: 'animated', description: 'Smaller gold coin. Quick pickup for points.' },
  { id: 'coin_small_silver', name: 'Small Silver Coin', category: 'collectible', path: 'assets/objects/coin_small_silver.png', frameWidth: 16, frameHeight: 16, frameCount: 6,  fps: 10, bodyWidth: 10, bodyHeight: 10, behavior: 'animated', description: 'Smaller silver coin. Quick pickup for points.' },

  // ── Hazards ──
  { id: 'spikes',      name: 'Spikes',      category: 'hazard',      path: 'assets/enemies/spikes.png',      frameWidth: 16, frameHeight: 16, frameCount: 4,  fps: 8,  bodyWidth: 14, bodyHeight: 10, behavior: 'animated', description: 'Animated spike trap. Kills on contact.' },
  { id: 'saw',         name: 'Saw',         category: 'hazard',      path: 'assets/enemies/saw.png',         frameWidth: 34, frameHeight: 34, frameCount: 4,  fps: 8,  animationFrames: [0, 2, 3, 2], bodyWidth: 24, bodyHeight: 24, previewWidth: 24, previewHeight: 24, previewOffsetX: 5, previewOffsetY: 5, behavior: 'animated', description: 'Spinning blade. Orbits in a circle.' },
  { id: 'fire',        name: 'Fire',        category: 'hazard',      path: 'assets/enemies/fire.png',        frameWidth: 16, frameHeight: 16, frameCount: 6,  fps: 10, bodyWidth: 12, bodyHeight: 14, behavior: 'animated', lightEmission: FIRE_LIGHT_EMISSION, description: 'Stationary flame. Burns on contact.' },
  { id: 'fireball',    name: 'Fireball',    category: 'hazard',      path: 'assets/enemies/fireball.png',    frameWidth: 16, frameHeight: 16, frameCount: 4,  fps: 10, bodyWidth: 12, bodyHeight: 12, behavior: 'animated', description: 'Shoots in a direction. Kills on contact.' },
  { id: 'bomb',        name: 'Bomb',        category: 'hazard',      path: 'assets/enemies/bomb.png',        frameWidth: 32, frameHeight: 48, frameCount: 15, fps: 8,  bodyWidth: 18, bodyHeight: 22, bodyOffsetX: 7, bodyOffsetY: 18, behavior: 'animated', description: 'Bomb hazard. Touching it is lethal.' },
  { id: 'wood_stakes', name: 'Wood Stakes', category: 'hazard',      path: 'assets/enemies/wood_stakes.png', frameWidth: 32, frameHeight: 32, frameCount: 1,  fps: 0,  bodyWidth: 28, bodyHeight: 28, behavior: 'static',   description: 'Sharpened stakes. Kills on contact.' },
  { id: 'cannon',      name: 'Cannon',      category: 'hazard',      path: 'assets/enemies/cannon.png',      frameWidth: 32, frameHeight: 32, frameCount: 6,  fps: 10, animationFrames: [0, 1, 2, 0], facingDirection: 'left', bodyWidth: 24, bodyHeight: 18, behavior: 'shooter',  description: 'Shoots bullets in the direction it faces.' },
  { id: 'cactus',      name: 'Cactus',      category: 'hazard',      path: 'assets/enemies/cactus.png',      frameWidth: 32, frameHeight: 32, frameCount: 6,  fps: 8,  bodyWidth: 16, bodyHeight: 26, behavior: 'animated', description: 'Animated cactus hazard. Hurts on contact.' },
  { id: 'tornado',     name: 'Tornado',     category: 'hazard',      path: 'assets/enemies/tornado.png',     frameWidth: 48, frameHeight: 48, frameCount: 8,  fps: 10, bodyWidth: 28, bodyHeight: 40, behavior: 'animated', description: 'Launches player in air.' },
  { id: 'fire_big',    name: 'Big Fire',    category: 'hazard',      path: 'assets/enemies/fire_big.png',    frameWidth: 32, frameHeight: 32, frameCount: 6,  fps: 10, bodyWidth: 18, bodyHeight: 20, behavior: 'animated', lightEmission: FIRE_BIG_LIGHT_EMISSION, description: 'Large flame hazard. Burns on contact.' },
  { id: 'ice_spikes',  name: 'Ice Spikes',  category: 'hazard',      path: 'assets/enemies/ice_spikes.png',  frameWidth: 16, frameHeight: 16, frameCount: 8,  fps: 8,  bodyWidth: 14, bodyHeight: 10, behavior: 'animated', description: 'Frozen spike trap. Kills on contact.' },
  { id: 'icicle',      name: 'Icicle',      category: 'hazard',      path: 'assets/enemies/icicle.png',      frameWidth: 48, frameHeight: 48, frameCount: 6,  fps: 8,  animationFrames: [0, 1, 2, 3], bodyWidth: 14, bodyHeight: 40, bodyOffsetX: 17, bodyOffsetY: 4, behavior: 'animated', description: 'Hanging icicle. Touching it is lethal.' },
  { id: 'lightning',   name: 'Lightning',   category: 'hazard',      path: 'assets/enemies/lightning.png',   frameWidth: 64, frameHeight: 96, frameCount: 4,  fps: 10, animationFrames: [0, 1], defaultFrame: 1, bodyWidth: 18, bodyHeight: 84, bodyOffsetX: 23, bodyOffsetY: 6, behavior: 'animated', description: 'Lightning strike hazard. Periodically flashes and is deadly while active.' },
  { id: 'propeller',   name: 'Propeller',   category: 'hazard',      path: 'assets/enemies/propeller.png',   frameWidth: 16, frameHeight: 16, frameCount: 4,  fps: 12, bodyWidth: 14, bodyHeight: 14, behavior: 'animated', description: 'Spinning blade propeller. Kills on contact.' },
  { id: 'quicksand',   name: 'Quicksand',   category: 'hazard',      path: 'assets/enemies/quicksand.png',   frameWidth: 32, frameHeight: 32, frameCount: 8,  fps: 8,  bodyWidth: 28, bodyHeight: 18, behavior: 'animated', description: 'Viscous sand that drags you down and slows movement.' },
  { id: 'cactus_spike',name: 'Cactus Spike',category: 'hazard',      path: 'assets/enemies/cactus_spike.png',frameWidth: 16, frameHeight: 16, frameCount: 1,  fps: 0,  bodyWidth: 8,  bodyHeight: 7,  bodyOffsetX: 4, bodyOffsetY: 5, previewWidth: 8, previewHeight: 7, previewOffsetX: 4, previewOffsetY: 5, behavior: 'static',   description: 'Single cactus spike. Kills on contact.' },
  { id: 'tornado_sand',name: 'Sand Tornado',category: 'hazard',      path: 'assets/enemies/tornado_sand.png',frameWidth: 48, frameHeight: 48, frameCount: 8,  fps: 10, bodyWidth: 28, bodyHeight: 40, behavior: 'animated', description: 'Launches player in air.' },
  { id: 'lava_surface',name: 'Lava Pool',   category: 'hazard',      path: 'assets/deco/lava_surface.png',   frameWidth: 48, frameHeight: 48, frameCount: 8,  fps: 8,  bodyWidth: 44, bodyHeight: 22, bodyOffsetX: 2, bodyOffsetY: 24, behavior: 'animated', lightEmission: LAVA_OBJECT_LIGHT_EMISSION, description: 'Animated lava surface. There is no swimming, only death.' },
  { id: 'water_surface_a', name: 'Water Pool', category: 'hazard',   path: 'assets/deco/water_surface_a.png',frameWidth: 32, frameHeight: 32, frameCount: 8,  fps: 8,  bodyWidth: 28, bodyHeight: 16, bodyOffsetX: 2, bodyOffsetY: 16, behavior: 'animated', description: 'Animated water surface. No swim move exists yet, so it is lethal.' },
  { id: 'water_surface_b', name: 'Water Ripple', category: 'hazard', path: 'assets/deco/water_surface_b.png',frameWidth: 16, frameHeight: 16, frameCount: 5,  fps: 8,  bodyWidth: 14, bodyHeight: 8,  bodyOffsetX: 1, bodyOffsetY: 8,  behavior: 'animated', description: 'Small water hazard. Touching it is lethal for now.' },

  // ── Enemies ──
  { id: 'slime_blue',  name: 'Blue Slime',  category: 'enemy',       path: 'assets/enemies/slime_blue.png',  frameWidth: 16, frameHeight: 16, frameCount: 5,  fps: 6,  facingDirection: 'left', bodyWidth: 12, bodyHeight: 10, behavior: 'patrol',   description: 'Patrols back and forth. Kills on contact.' },
  { id: 'slime_red',   name: 'Red Slime',   category: 'enemy',       path: 'assets/enemies/slime_red.png',   frameWidth: 16, frameHeight: 16, frameCount: 5,  fps: 6,  facingDirection: 'left', bodyWidth: 12, bodyHeight: 10, behavior: 'patrol',   description: 'Patrols back and forth. Kills on contact.' },
  { id: 'bat',         name: 'Bat',         category: 'enemy',       path: 'assets/enemies/bat.png',         frameWidth: 32, frameHeight: 32, frameCount: 8,  fps: 8,  animationFrames: [4, 5, 6, 7, 6, 5], defaultFrame: 6, facingDirection: 'right', bodyWidth: 24, bodyHeight: 20, behavior: 'fly',      description: 'Flies in a wave pattern. Kills on contact.' },
  { id: GHOST_OBJECT_ID, name: 'Ghost',     category: 'enemy',       path: 'assets/enemies/ghost/idle.png',  frameWidth: 48, frameHeight: 48, frameCount: 8,  fps: 8,  defaultFrame: 0, facingDirection: 'right', bodyWidth: 22, bodyHeight: 20, bodyOffsetX: 11, bodyOffsetY: 13, previewWidth: 24, previewHeight: 22, previewOffsetX: 10, previewOffsetY: 12, placeUsingPreviewBounds: true, collidesWithWorld: false, behavior: 'fly', description: 'Phases through walls while drifting in the air. Kills on contact.' },
  { id: 'crab',        name: 'Crab',        category: 'enemy',       path: 'assets/enemies/crab.png',        frameWidth: 32, frameHeight: 16, frameCount: 9,  fps: 8,  animationFrames: [0, 1, 2, 1], defaultFrame: 1, facingDirection: 'left', bodyWidth: 24, bodyHeight: 10, behavior: 'patrol',   description: 'Patrols back and forth. Kills on contact.' },
  { id: 'bird',        name: 'Bird',        category: 'enemy',       path: 'assets/enemies/bird.png',        frameWidth: 32, frameHeight: 32, frameCount: 4,  fps: 10, facingDirection: 'left', bodyWidth: 24, bodyHeight: 20, behavior: 'fly',      description: 'Flies in a wave pattern. Kills on contact.' },
  { id: 'fish',        name: 'Fish',        category: 'enemy',       path: 'assets/enemies/fish.png',        frameWidth: 32, frameHeight: 16, frameCount: 3,  fps: 8,  animationFrames: [0, 1, 2, 1], defaultFrame: 1, facingDirection: 'right', bodyWidth: 22, bodyHeight: 10, behavior: 'fly',      description: 'Swims left and right in a gentle wave. Kills on contact.' },
  { id: 'frog',        name: 'Frog',        category: 'enemy',       path: 'assets/enemies/frog.png',        frameWidth: 32, frameHeight: 32, frameCount: 4,  fps: 6,  facingDirection: 'right', bodyWidth: 24, bodyHeight: 24, behavior: 'bounce',   description: 'Hops around periodically. Kills on contact.' },
  { id: 'snake',       name: 'Snake',       category: 'enemy',       path: 'assets/enemies/snake.png',       frameWidth: 32, frameHeight: 32, frameCount: 4,  fps: 6,  facingDirection: 'left', bodyWidth: 24, bodyHeight: 20, behavior: 'patrol',   description: 'Patrols back and forth. Kills on contact.' },
  { id: 'penguin',     name: 'Penguin',     category: 'enemy',       path: 'assets/enemies/penguin.png',     frameWidth: 32, frameHeight: 32, frameCount: 4,  fps: 6,  facingDirection: 'right', bodyWidth: 24, bodyHeight: 28, behavior: 'patrol',   description: 'Patrols back and forth. Kills on contact.' },
  { id: 'bear_brown',  name: 'Brown Mouse', category: 'enemy',       path: 'assets/enemies/bear_brown.png',  frameWidth: 32, frameHeight: 32, frameCount: 8,  fps: 6,  animationFrames: [4, 5, 6, 7, 6, 5], defaultFrame: 5, facingDirection: 'right', bodyWidth: 24, bodyHeight: 22, behavior: 'patrol',   description: 'Small patrol mouse. Kills on contact.' },
  { id: 'bear_polar',  name: 'White Mouse', category: 'enemy',       path: 'assets/enemies/bear_polar.png',  frameWidth: 32, frameHeight: 32, frameCount: 8,  fps: 6,  animationFrames: [4, 5, 6, 7, 6, 5], defaultFrame: 5, facingDirection: 'right', bodyWidth: 24, bodyHeight: 22, behavior: 'patrol',   description: 'Small patrol mouse. Kills on contact.' },
  { id: 'chicken',     name: 'Chicken',     category: 'enemy',       path: 'assets/enemies/chicken.png',     frameWidth: 32, frameHeight: 32, frameCount: 14, fps: 8,  animationFrames: [7, 8, 9, 10, 11, 12, 13], defaultFrame: 7, facingDirection: 'left', bodyWidth: 18, bodyHeight: 16, behavior: 'patrol',   description: 'Quick patrol enemy. Kills on contact.' },
  { id: 'shark',       name: 'Shark',       category: 'enemy',       path: 'assets/enemies/shark.png',       frameWidth: 64, frameHeight: 32, frameCount: 4,  fps: 8,  animationFrames: [0, 1, 2, 3, 2, 1], defaultFrame: 1, facingDirection: 'left', bodyWidth: 48, bodyHeight: 18, behavior: 'fly',      description: 'Cruises left and right in a wave pattern. Kills on contact.' },
  { id: SWORDSMAN_AI_OBJECT_ID, name: 'Sword Hunter', category: 'enemy', path: 'assets/enemies/swordsman_ai/sword_idle.png', frameWidth: 48, frameHeight: 48, frameCount: 10, fps: 8, defaultFrame: 0, facingDirection: 'right', bodyWidth: 10, bodyHeight: 14, bodyOffsetX: 19, bodyOffsetY: 26, displayScale: 1.12, displayOffsetY: 8, previewWidth: 18, previewHeight: 28, previewOffsetX: 15, previewOffsetY: 20, placeUsingPreviewBounds: true, behavior: 'patrol', description: 'Smart sword enemy. Patrols, chases nearby players, and attacks with a timed slash.' },

  // ── Interactive ──
  { id: 'bounce_pad',  name: 'Bounce Pad',  category: 'interactive', path: 'assets/objects/bounce_pad.png',  frameWidth: 16, frameHeight: 32, frameCount: 4,  fps: 0,  bodyWidth: 16, bodyHeight: 8,  behavior: 'bounce',   description: 'Launches player upward on contact.' },
  { id: 'spawn_point', name: 'Spawn Point', category: 'interactive', path: 'assets/objects/sign_arrow.png',  frameWidth: 16, frameHeight: 32, frameCount: 1,  fps: 0,  bodyWidth: 0,  bodyHeight: 0,  behavior: 'static',   description: 'Player spawn marker. Only one is stored per room.' },
  { id: 'flag',        name: 'Flag',        category: 'interactive', path: 'assets/objects/flag.png',        frameWidth: 32, frameHeight: 32, frameCount: 9,  fps: 8,  bodyWidth: 8,  bodyHeight: 28, behavior: 'animated', description: 'Goal marker. Reach to complete the room.' },
  { id: 'door_locked', name: 'Locked Door', category: 'interactive', path: 'assets/objects/door_locked.png', frameWidth: 32, frameHeight: 48, frameCount: 1,  fps: 0,  bodyWidth: 28, bodyHeight: 44, bodyOffsetX: 2, bodyOffsetY: 4, behavior: 'static',   description: 'A key-gated door. Collect a key to unlock and pass through.' },
  { id: 'door_metal',  name: 'Metal Door',  category: 'platform',    path: 'assets/objects/metal_door_locked.png', frameWidth: 32, frameHeight: 48, frameCount: 1,  fps: 0,  bodyWidth: 28, bodyHeight: 44, bodyOffsetX: 2, bodyOffsetY: 4, behavior: 'static',   description: 'Pressure-plate door. Opens while its linked plate stays pressed.' },
  { id: 'trapdoor_locked', name: 'Locked Trapdoor', category: 'interactive', path: 'assets/objects/trapdoor.png', frameWidth: 16, frameHeight: 16, frameCount: 1,  fps: 0,  bodyWidth: 16, bodyHeight: 16, bodyOffsetX: 0, bodyOffsetY: 0, behavior: 'static',   description: 'A key-gated trapdoor. Collect a key to unlock and pass through.' },
  { id: 'trapdoor_metal',  name: 'Metal Trapoor',  category: 'platform',    path: 'assets/objects/trapdoor2.png', frameWidth: 16, frameHeight: 16, frameCount: 1,  fps: 0,  bodyWidth: 16, bodyHeight: 16, bodyOffsetX: 0, bodyOffsetY: 0, behavior: 'static',   description: 'Pressure-plate trapdoor. Opens while its linked plate stays pressed.' },
  { id: 'crate',       name: 'Crate',       category: 'platform',    path: 'assets/objects/crate_static.png', frameWidth: 32, frameHeight: 32, frameCount: 1,  fps: 0,  bodyWidth: 16, bodyHeight: 16, bodyOffsetX: 0, bodyOffsetY: 16, previewWidth: 16, previewHeight: 16, previewOffsetX: 0, previewOffsetY: 16, behavior: 'static',   interaction: 'pushable', description: 'Solid block. Stand on it or push it.' },
  { id: 'brick_box',   name: 'Brick Box',   category: 'platform',    path: 'assets/objects/brick_box.png',   frameWidth: 32, frameHeight: 32, frameCount: 6,  fps: 0,  defaultFrame: 5, bodyWidth: 16, bodyHeight: 16, bodyOffsetX: 8, bodyOffsetY: 8, previewWidth: 16, previewHeight: 16, previewOffsetX: 8, previewOffsetY: 8, placeUsingPreviewBounds: true, behavior: 'static',   description: 'Solid brick block. Stand on it like a platform.' },
  { id: BLOCK_SWITCH_OBJECT_ID, name: 'Block Switch', category: 'platform', path: 'assets/objects/switch-block-blue-active.png', frameWidth: 16, frameHeight: 16, frameCount: 1, fps: 0, bodyWidth: 16, bodyHeight: 16, behavior: 'static', description: 'Hit this active-color block from below, or bump it with certain enemies/projectiles, to swap red and blue switch blocks in this room.' },
  { id: SWITCH_BLOCK_ON_OBJECT_ID, name: 'Blue Switch Block', category: 'platform', path: 'assets/objects/switch-block-blue.png', frameWidth: 16, frameHeight: 16, frameCount: 1, fps: 0, bodyWidth: 16, bodyHeight: 16, behavior: 'static', description: 'Blue platform block. Starts solid, then toggles with a Block Switch.' },
  { id: SWITCH_BLOCK_OFF_OBJECT_ID, name: 'Red Switch Block', category: 'platform', path: 'assets/objects/switch-block-red.png', frameWidth: 16, frameHeight: 16, frameCount: 1, fps: 0, bodyWidth: 16, bodyHeight: 16, behavior: 'static', description: 'Red platform block. Starts inactive, then toggles with a Block Switch.' },
  { id: 'treasure_chest', name: 'Treasure Chest', category: 'platform', path: 'assets/objects/treasure_chest.png', frameWidth: 32, frameHeight: 32, frameCount: 4, fps: 0, defaultFrame: 0, bodyWidth: 28, bodyHeight: 18, bodyOffsetX: 2, bodyOffsetY: 14, behavior: 'static', description: 'Solid chest prop. Good for treasure rooms.' },
  { id: 'log_wall',    name: 'Log Wall',    category: 'platform',    path: 'assets/deco/log_wall.png',       frameWidth: 32, frameHeight: 48, frameCount: 1,  fps: 0,  bodyWidth: 28, bodyHeight: 44, bodyOffsetX: 2, bodyOffsetY: 4, behavior: 'static',   description: 'Tall wooden wall segment. Solid collision.' },
  { id: 'cage',        name: 'Cage',        category: 'platform',    path: 'assets/objects/cage.png',        frameWidth: 18, frameHeight: 32, frameCount: 5,  fps: 0,  defaultFrame: 0, bodyWidth: 16, bodyHeight: 16, bodyOffsetX: 1, bodyOffsetY: 16, behavior: 'static', description: 'Tall cage prop. Solid collision.' },
  { id: 'sign',        name: 'Sign',        category: 'decoration',  path: 'assets/objects/sign.png',        frameWidth: 16, frameHeight: 32, frameCount: 1,  fps: 0,  bodyWidth: 0,  bodyHeight: 0,  behavior: 'static',   description: 'Decorative signpost. No collision.' },
  { id: 'sign_arrow',  name: 'Arrow Sign',  category: 'decoration',  path: 'assets/objects/sign_arrow.png',  frameWidth: 16, frameHeight: 32, frameCount: 1,  fps: 0,  bodyWidth: 0,  bodyHeight: 0,  behavior: 'static',   description: 'Decorative arrow sign. No collision.' },
  { id: 'ladder',      name: 'Ladder',      category: 'interactive', path: 'assets/objects/ladder.png',      frameWidth: 16, frameHeight: 64, frameCount: 1,  fps: 0,  bodyWidth: 16, bodyHeight: 51, bodyOffsetX: 0, bodyOffsetY: 13, previewWidth: 16, previewHeight: 51, previewOffsetX: 0, previewOffsetY: 13, behavior: 'static',   description: 'Climbable surface. Press up to climb.' },
  { id: 'floor_trigger', name: 'Pressure Plate', category: 'interactive', path: 'assets/objects/floor_trigger.png', frameWidth: 16, frameHeight: 16, frameCount: 2, fps: 0, defaultFrame: 0, bodyWidth: 0, bodyHeight: 0, behavior: 'static', description: 'Link this plate to a door, cage, or chest, then press it with a player, monster, or crate.' },
  { id: 'button',      name: 'Button',      category: 'decoration',  path: 'assets/objects/button.png',      frameWidth: 16, frameHeight: 16, frameCount: 4,  fps: 0,  defaultFrame: 0, bodyWidth: 0,  bodyHeight: 0,  behavior: 'static',   description: 'Floor button prop. No collision.' },

  // ── Decorations ──
  { id: 'bush',        name: 'Bush',        category: 'decoration',  path: 'assets/deco/bush.png',           frameWidth: 32, frameHeight: 16, frameCount: 1,  fps: 0,  bodyWidth: 0,  bodyHeight: 0,  behavior: 'static',   description: 'Decorative bush. No collision.' },
  { id: 'rock',        name: 'Rock',        category: 'decoration',  path: 'assets/deco/rock.png',           frameWidth: 16, frameHeight: 16, frameCount: 1,  fps: 0,  bodyWidth: 0,  bodyHeight: 0,  behavior: 'static',   description: 'Decorative rock. No collision.' },
  { id: 'tree',        name: 'Tree',        category: 'decoration',  path: 'assets/deco/tree.png',           frameWidth: 48, frameHeight: 48, frameCount: 1,  fps: 0,  bodyWidth: 0,  bodyHeight: 0,  behavior: 'static',   description: 'Decorative tree. No collision.' },
  { id: 'tree_b',      name: 'Tree B',      category: 'decoration',  path: 'assets/deco/tree_b.png',         frameWidth: 48, frameHeight: 64, frameCount: 1,  fps: 0,  bodyWidth: 0,  bodyHeight: 0,  behavior: 'static',   description: 'Large decorative tree. No collision.' },
  { id: 'tree_c',      name: 'Tree C',      category: 'decoration',  path: 'assets/deco/tree_c.png',         frameWidth: 48, frameHeight: 48, frameCount: 1,  fps: 0,  bodyWidth: 0,  bodyHeight: 0,  behavior: 'static',   description: 'Extra palm-like tree decoration.' },
  { id: 'tree_trunk',  name: 'Tree Trunk',  category: 'decoration',  path: 'assets/deco/tree_trunk.png',     frameWidth: 16, frameHeight: 16, frameCount: 1,  fps: 0,  bodyWidth: 0,  bodyHeight: 0,  behavior: 'static',   description: 'Cut stump or trunk decoration.' },
  { id: 'sun',         name: 'Sun',         category: 'decoration',  path: 'assets/deco/sun.png',            frameWidth: 32, frameHeight: 32, frameCount: 6,  fps: 4,  bodyWidth: 0,  bodyHeight: 0,  behavior: 'animated', description: 'Animated sun. Purely decorative.' },
  { id: 'clouds_deco', name: 'Clouds',      category: 'decoration',  path: 'assets/deco/clouds.png',         frameWidth: 48, frameHeight: 16, frameCount: 1,  fps: 0,  bodyWidth: 0,  bodyHeight: 0,  behavior: 'static',   description: 'Cloud decoration. No collision.' },
];

export function getObjectById(id: string): GameObjectConfig | undefined {
  return GAME_OBJECTS.find(obj => obj.id === id);
}

export function isPushableObjectConfig(
  config: Pick<GameObjectConfig, 'interaction'> | null | undefined,
): boolean {
  return config?.interaction === 'pushable';
}

export function isDynamicRuntimeObjectConfig(
  config: Pick<GameObjectConfig, 'id' | 'interaction' | 'behavior'> | null | undefined,
): boolean {
  if (!config) {
    return false;
  }

  return (
    isPushableObjectConfig(config)
    || config.behavior === 'fly'
    || config.id === 'cannon_bullet'
    || config.id === 'crab'
    || config.id === 'slime_blue'
    || config.id === 'slime_red'
    || config.id === 'snake'
    || config.id === 'penguin'
    || config.id === 'frog'
    || config.id === 'bear_brown'
    || config.id === 'bear_polar'
    || config.id === 'chicken'
    || config.id === SWORDSMAN_AI_OBJECT_ID
  );
}

export function isSolidRuntimeObjectConfig(
  config: Pick<GameObjectConfig, 'category' | 'id' | 'interaction'> | null | undefined,
): boolean {
  if (!config) {
    return false;
  }

  return (
    config.category === 'platform'
    || config.id === 'door_locked'
    || isPushableObjectConfig(config)
  );
}

export function objectCollidesWithWorld(
  config: Pick<GameObjectConfig, 'collidesWithWorld'> | null | undefined,
): boolean {
  return config?.collidesWithWorld !== false;
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

export function getObjectPreviewBounds(config: GameObjectConfig): {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
} {
  return {
    width: config.previewWidth ?? config.frameWidth,
    height: config.previewHeight ?? config.frameHeight,
    offsetX: config.previewOffsetX ?? 0,
    offsetY: config.previewOffsetY ?? 0,
  };
}

export function getObjectDisplayScale(config: GameObjectConfig): number {
  const scale = config.displayScale ?? 1;
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

export function getObjectDisplayOffset(config: GameObjectConfig): { x: number; y: number } {
  return {
    x: config.displayOffsetX ?? 0,
    y: config.displayOffsetY ?? 0,
  };
}

export function getObjectPlacementPointForTile(
  config: GameObjectConfig,
  tileX: number,
  tileY: number,
): { x: number; y: number } {
  if (!config.placeUsingPreviewBounds) {
    return {
      x: tileX * TILE_SIZE + config.frameWidth / 2,
      y: tileY * TILE_SIZE + TILE_SIZE - config.frameHeight / 2,
    };
  }

  const preview = getObjectPreviewBounds(config);
  const previewLeft = tileX * TILE_SIZE + Math.max(0, (TILE_SIZE - preview.width) / 2);
  const previewTop = tileY * TILE_SIZE + TILE_SIZE - preview.height;

  return {
    x: previewLeft + config.frameWidth / 2 - preview.offsetX,
    y: previewTop + config.frameHeight / 2 - preview.offsetY,
  };
}

export function getObjectPreviewRectForTile(
  config: GameObjectConfig,
  tileX: number,
  tileY: number,
): { x: number; y: number; width: number; height: number } {
  const preview = getObjectPreviewBounds(config);
  const displayScale = getObjectDisplayScale(config);
  const displayOffset = getObjectDisplayOffset(config);
  const placementPoint = getObjectPlacementPointForTile(config, tileX, tileY);

  return {
    x:
      placementPoint.x +
      displayOffset.x -
      config.frameWidth * displayScale * 0.5 +
      preview.offsetX * displayScale,
    y:
      placementPoint.y +
      displayOffset.y -
      config.frameHeight * displayScale * 0.5 +
      preview.offsetY * displayScale,
    width: preview.width * displayScale,
    height: preview.height * displayScale,
  };
}

export function getObjectFrameSourceRect(
  config: GameObjectConfig,
  frame: number,
  sheetWidth: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const columns = Math.max(1, Math.floor(sheetWidth / config.frameWidth));
  const normalizedFrame = Math.max(0, frame);
  const column = normalizedFrame % columns;
  const row = Math.floor(normalizedFrame / columns);
  return {
    sx: column * config.frameWidth,
    sy: row * config.frameHeight,
    sw: config.frameWidth,
    sh: config.frameHeight,
  };
}

// ── Placed Object Instance ──
export interface PlacedObject {
  id: string;        // GameObjectConfig.id
  x: number;         // world pixel x
  y: number;         // world pixel y
  instanceId: string;
  customSpriteKind?: CustomSpriteKind | null;
  facing?: 'left' | 'right';
  layer?: LayerName;
  triggerTargetInstanceId?: string | null;
  containedObjectId?: string | null;
  signText?: string | null;
  swordsmanObjectiveMode?: SwordsmanObjectiveMode | null;
  swordsmanDefeatMode?: SwordsmanDefeatMode | null;
}

export function getPlacedObjectLayer(
  placed: Pick<PlacedObject, 'layer'> | null | undefined
): LayerName {
  if (placed?.layer === 'background' || placed?.layer === 'terrain' || placed?.layer === 'foreground') {
    return placed.layer;
  }

  return 'terrain';
}

export function createPlacedObjectInstanceId(): string {
  const maybeCrypto = (globalThis as { crypto?: Crypto }).crypto;
  if (maybeCrypto?.randomUUID) {
    return `obj_${maybeCrypto.randomUUID()}`;
  }

  return `obj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createLegacyPlacedObjectInstanceId(
  placed: Pick<PlacedObject, 'id' | 'x' | 'y' | 'facing' | 'layer'>,
  index: number,
): string {
  const facing = placed.facing === 'left' || placed.facing === 'right' ? placed.facing : 'none';
  return `legacy_${index}_${placed.id}_${Math.round(placed.x)}_${Math.round(placed.y)}_${facing}_${getPlacedObjectLayer(placed)}`;
}

export function getPlacedObjectInstanceId(
  placed: Pick<PlacedObject, 'id' | 'x' | 'y' | 'facing' | 'layer' | 'instanceId'>,
  index: number,
): string {
  if (typeof placed.instanceId === 'string' && placed.instanceId.trim()) {
    return placed.instanceId;
  }

  return createLegacyPlacedObjectInstanceId(placed, index);
}

export function isPressurePlateTriggerId(id: string): id is 'floor_trigger' {
  return id === 'floor_trigger';
}

export function isBlockSwitchObjectId(id: string): id is typeof BLOCK_SWITCH_OBJECT_ID {
  return id === BLOCK_SWITCH_OBJECT_ID;
}

export function isSwitchBlockObjectId(id: string): id is SwitchBlockObjectId {
  return (SWITCH_BLOCK_OBJECT_IDS as readonly string[]).includes(id);
}

export function isSwitchBlockInitiallyActive(id: string): boolean {
  return id === SWITCH_BLOCK_ON_OBJECT_ID;
}

export function getBlockSwitchRuntimeTextureKey(redActive: boolean): string {
  return redActive ? BLOCK_SWITCH_RED_ACTIVE_TEXTURE_KEY : BLOCK_SWITCH_OBJECT_ID;
}

export function canPlacedObjectTriggerOtherObjects(
  placed: Pick<PlacedObject, 'id'> | null | undefined
): boolean {
  return isPressurePlateTriggerId(placed?.id ?? '');
}

export function canPlacedObjectBePressurePlateTarget(
  placed: Pick<PlacedObject, 'id'> | null | undefined
): placed is Pick<PlacedObject, 'id'> & { id: PressurePlateTargetObjectId } {
  if (!placed) {
    return false;
  }

  return (PRESSURE_PLATE_TARGET_OBJECT_IDS as readonly string[]).includes(placed.id);
}

export function canPlacedObjectBeContainer<T extends Pick<PlacedObject, 'id'>>(
  placed: T | null | undefined
): placed is T & { id: ContainerObjectId } {
  if (!placed) {
    return false;
  }

  return (CONTAINER_OBJECT_IDS as readonly string[]).includes(placed.id);
}

export function canObjectBeStoredInContainer(
  containerId: string,
  objectConfig: Pick<GameObjectConfig, 'category'> | null | undefined,
): boolean {
  if (!objectConfig) {
    return false;
  }

  if (containerId === 'cage') {
    return objectConfig.category === 'enemy';
  }
  if (containerId === 'treasure_chest') {
    return objectConfig.category === 'collectible';
  }

  return false;
}

export function placedObjectContributesToCategory(
  placed: Pick<PlacedObject, 'id' | 'containedObjectId' | 'customSpriteKind'>,
  category: ObjectCategory,
): boolean {
  const directConfig = getObjectById(placed.id);
  if (directConfig?.category === category) {
    return true;
  }
  if (
    isCustomSpriteObjectId(placed.id) &&
    placed.customSpriteKind &&
    getCustomSpriteCategory(placed.customSpriteKind) === category
  ) {
    return true;
  }

  if (!canPlacedObjectBeContainer(placed) || !placed.containedObjectId) {
    return false;
  }

  const containedConfig = getObjectById(placed.containedObjectId);
  return containedConfig?.category === category;
}

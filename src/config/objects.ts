import type { LayerName } from './room';

export type ObjectCategory =
  | 'collectible'
  | 'hazard'
  | 'enemy'
  | 'platform'
  | 'decoration'
  | 'interactive';

export interface GameObjectConfig {
  id: string;
  name: string;
  category: ObjectCategory;
  path: string;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  fps: number;
  animationFrames?: number[];
  defaultFrame?: number;
  facingDirection?: 'left' | 'right';
  bodyWidth: number;
  bodyHeight: number;
  bodyOffsetX?: number;
  bodyOffsetY?: number;
  previewWidth?: number;
  previewHeight?: number;
  previewOffsetX?: number;
  previewOffsetY?: number;
  behavior: 'static' | 'patrol' | 'fly' | 'bounce' | 'animated' | 'shooter';
  description: string;
}

export const PRESSURE_PLATE_TARGET_OBJECT_IDS = [
  'door_locked',
  'door_metal',
  'cage',
  'treasure_chest',
] as const;

export type PressurePlateTargetObjectId = (typeof PRESSURE_PLATE_TARGET_OBJECT_IDS)[number];
export const CONTAINER_OBJECT_IDS = ['cage', 'treasure_chest'] as const;
export type ContainerObjectId = (typeof CONTAINER_OBJECT_IDS)[number];

export const GAME_OBJECTS: GameObjectConfig[] = [
  { id: 'coin_gold', name: 'Gold Coin', category: 'collectible', path: 'assets/objects/coin_gold.png', frameWidth: 16, frameHeight: 16, frameCount: 8, fps: 10, bodyWidth: 12, bodyHeight: 12, behavior: 'animated', description: 'Collect for points. Disappears on contact.' },
  { id: 'coin_silver', name: 'Silver Coin', category: 'collectible', path: 'assets/objects/coin_silver.png', frameWidth: 16, frameHeight: 16, frameCount: 8, fps: 10, bodyWidth: 12, bodyHeight: 12, behavior: 'animated', description: 'Collect for points. Worth less than gold.' },
  { id: 'gem', name: 'Gem', category: 'collectible', path: 'assets/objects/gem.png', frameWidth: 16, frameHeight: 16, frameCount: 5, fps: 8, bodyWidth: 12, bodyHeight: 12, behavior: 'animated', description: 'Premium collectible. High point value.' },
  { id: 'heart', name: 'Heart', category: 'collectible', path: 'assets/objects/heart.png', frameWidth: 16, frameHeight: 16, frameCount: 3, fps: 6, bodyWidth: 12, bodyHeight: 12, behavior: 'animated', description: 'Restores health on pickup.' },
  { id: 'key', name: 'Key', category: 'collectible', path: 'assets/objects/key.png', frameWidth: 16, frameHeight: 16, frameCount: 5, fps: 6, bodyWidth: 12, bodyHeight: 12, behavior: 'animated', description: 'Unlocks matching lock gates.' },
  { id: 'apple', name: 'Apple', category: 'collectible', path: 'assets/objects/apple.png', frameWidth: 16, frameHeight: 16, frameCount: 1, fps: 0, bodyWidth: 12, bodyHeight: 12, behavior: 'static', description: 'Collectible fruit.' },
  { id: 'banana', name: 'Banana', category: 'collectible', path: 'assets/objects/banana.png', frameWidth: 16, frameHeight: 16, frameCount: 1, fps: 0, bodyWidth: 12, bodyHeight: 12, behavior: 'static', description: 'Collectible fruit.' },
  { id: 'coin_small_gold', name: 'Small Gold Coin', category: 'collectible', path: 'assets/objects/coin_small_gold.png', frameWidth: 16, frameHeight: 16, frameCount: 6, fps: 10, bodyWidth: 10, bodyHeight: 10, behavior: 'animated', description: 'Smaller gold coin. Quick pickup for points.' },
  { id: 'coin_small_silver', name: 'Small Silver Coin', category: 'collectible', path: 'assets/objects/coin_small_silver.png', frameWidth: 16, frameHeight: 16, frameCount: 6, fps: 10, bodyWidth: 10, bodyHeight: 10, behavior: 'animated', description: 'Smaller silver coin. Quick pickup for points.' },

  { id: 'spikes', name: 'Spikes', category: 'hazard', path: 'assets/enemies/spikes.png', frameWidth: 16, frameHeight: 16, frameCount: 4, fps: 8, bodyWidth: 14, bodyHeight: 10, behavior: 'animated', description: 'Animated spike trap. Kills on contact.' },
  { id: 'saw', name: 'Saw', category: 'hazard', path: 'assets/enemies/saw.png', frameWidth: 34, frameHeight: 34, frameCount: 4, fps: 8, animationFrames: [0, 2, 3, 2], bodyWidth: 24, bodyHeight: 24, previewWidth: 24, previewHeight: 24, previewOffsetX: 5, previewOffsetY: 5, behavior: 'animated', description: 'Spinning blade. Orbits in a circle.' },
  { id: 'fire', name: 'Fire', category: 'hazard', path: 'assets/enemies/fire.png', frameWidth: 16, frameHeight: 16, frameCount: 6, fps: 10, bodyWidth: 12, bodyHeight: 14, behavior: 'animated', description: 'Stationary flame. Burns on contact.' },
  { id: 'fireball', name: 'Fireball', category: 'hazard', path: 'assets/enemies/fireball.png', frameWidth: 16, frameHeight: 16, frameCount: 4, fps: 10, bodyWidth: 12, bodyHeight: 12, behavior: 'animated', description: 'Shoots in a direction. Kills on contact.' },
  { id: 'bomb', name: 'Bomb', category: 'hazard', path: 'assets/enemies/bomb.png', frameWidth: 32, frameHeight: 48, frameCount: 15, fps: 8, bodyWidth: 18, bodyHeight: 22, bodyOffsetX: 7, bodyOffsetY: 18, behavior: 'animated', description: 'Bomb hazard. Touching it is lethal.' },
  { id: 'wood_stakes', name: 'Wood Stakes', category: 'hazard', path: 'assets/enemies/wood_stakes.png', frameWidth: 32, frameHeight: 32, frameCount: 1, fps: 0, bodyWidth: 28, bodyHeight: 28, behavior: 'static', description: 'Sharpened stakes. Kills on contact.' },
  { id: 'cannon', name: 'Cannon', category: 'hazard', path: 'assets/enemies/cannon.png', frameWidth: 32, frameHeight: 32, frameCount: 1, fps: 0, defaultFrame: 2, facingDirection: 'left', bodyWidth: 24, bodyHeight: 18, behavior: 'shooter', description: 'Shoots bullets in the direction it faces.' },
  { id: 'cactus', name: 'Cactus', category: 'hazard', path: 'assets/enemies/cactus.png', frameWidth: 32, frameHeight: 32, frameCount: 6, fps: 8, bodyWidth: 16, bodyHeight: 26, behavior: 'animated', description: 'Animated cactus hazard. Hurts on contact.' },
  { id: 'tornado', name: 'Tornado', category: 'hazard', path: 'assets/enemies/tornado.png', frameWidth: 48, frameHeight: 48, frameCount: 8, fps: 10, bodyWidth: 28, bodyHeight: 40, behavior: 'animated', description: 'Animated whirlwind hazard. Hurts on contact.' },
  { id: 'fire_big', name: 'Big Fire', category: 'hazard', path: 'assets/enemies/fire_big.png', frameWidth: 32, frameHeight: 32, frameCount: 6, fps: 10, bodyWidth: 18, bodyHeight: 20, behavior: 'animated', description: 'Large flame hazard. Burns on contact.' },
  { id: 'ice_spikes', name: 'Ice Spikes', category: 'hazard', path: 'assets/enemies/ice_spikes.png', frameWidth: 16, frameHeight: 16, frameCount: 8, fps: 8, bodyWidth: 14, bodyHeight: 10, behavior: 'animated', description: 'Frozen spike trap. Kills on contact.' },
  { id: 'icicle', name: 'Icicle', category: 'hazard', path: 'assets/enemies/icicle.png', frameWidth: 48, frameHeight: 48, frameCount: 6, fps: 8, animationFrames: [0, 1, 2, 3], bodyWidth: 14, bodyHeight: 40, bodyOffsetX: 17, bodyOffsetY: 4, behavior: 'animated', description: 'Hanging icicle. Touching it is lethal.' },
  { id: 'lightning', name: 'Lightning', category: 'hazard', path: 'assets/enemies/lightning.png', frameWidth: 64, frameHeight: 96, frameCount: 4, fps: 10, animationFrames: [0, 1], defaultFrame: 1, bodyWidth: 18, bodyHeight: 84, bodyOffsetX: 23, bodyOffsetY: 6, behavior: 'animated', description: 'Lightning strike hazard. Periodically flashes and is deadly while active.' },
  { id: 'propeller', name: 'Propeller', category: 'hazard', path: 'assets/enemies/propeller.png', frameWidth: 16, frameHeight: 16, frameCount: 4, fps: 12, bodyWidth: 14, bodyHeight: 14, behavior: 'animated', description: 'Spinning blade propeller. Kills on contact.' },
  { id: 'quicksand', name: 'Quicksand', category: 'hazard', path: 'assets/enemies/quicksand.png', frameWidth: 32, frameHeight: 32, frameCount: 8, fps: 8, bodyWidth: 28, bodyHeight: 18, behavior: 'animated', description: 'Viscous sand that drags you down and slows movement.' },
  { id: 'cactus_spike', name: 'Cactus Spike', category: 'hazard', path: 'assets/enemies/cactus_spike.png', frameWidth: 16, frameHeight: 16, frameCount: 1, fps: 0, bodyWidth: 8, bodyHeight: 7, bodyOffsetX: 4, bodyOffsetY: 5, previewWidth: 8, previewHeight: 7, previewOffsetX: 4, previewOffsetY: 5, behavior: 'static', description: 'Single cactus spike. Kills on contact.' },
  { id: 'tornado_sand', name: 'Sand Tornado', category: 'hazard', path: 'assets/enemies/tornado_sand.png', frameWidth: 48, frameHeight: 48, frameCount: 8, fps: 10, bodyWidth: 28, bodyHeight: 40, behavior: 'animated', description: 'Desert whirlwind. Launches and kills on contact.' },
  { id: 'lava_surface', name: 'Lava Pool', category: 'hazard', path: 'assets/deco/lava_surface.png', frameWidth: 48, frameHeight: 48, frameCount: 8, fps: 8, bodyWidth: 44, bodyHeight: 22, bodyOffsetX: 2, bodyOffsetY: 24, behavior: 'animated', description: 'Animated lava surface. There is no swimming, only death.' },
  { id: 'water_surface_a', name: 'Water Pool', category: 'hazard', path: 'assets/deco/water_surface_a.png', frameWidth: 32, frameHeight: 32, frameCount: 8, fps: 8, bodyWidth: 28, bodyHeight: 16, bodyOffsetX: 2, bodyOffsetY: 16, behavior: 'animated', description: 'Animated water surface. No swim move exists yet, so it is lethal.' },
  { id: 'water_surface_b', name: 'Water Ripple', category: 'hazard', path: 'assets/deco/water_surface_b.png', frameWidth: 16, frameHeight: 16, frameCount: 5, fps: 8, bodyWidth: 14, bodyHeight: 8, bodyOffsetX: 1, bodyOffsetY: 8, behavior: 'animated', description: 'Small water hazard. Touching it is lethal for now.' },

  { id: 'slime_blue', name: 'Blue Slime', category: 'enemy', path: 'assets/enemies/slime_blue.png', frameWidth: 16, frameHeight: 16, frameCount: 5, fps: 6, facingDirection: 'left', bodyWidth: 12, bodyHeight: 10, behavior: 'patrol', description: 'Patrols back and forth. Kills on contact.' },
  { id: 'slime_red', name: 'Red Slime', category: 'enemy', path: 'assets/enemies/slime_red.png', frameWidth: 16, frameHeight: 16, frameCount: 5, fps: 6, facingDirection: 'left', bodyWidth: 12, bodyHeight: 10, behavior: 'patrol', description: 'Patrols back and forth. Kills on contact.' },
  { id: 'bat', name: 'Bat', category: 'enemy', path: 'assets/enemies/bat.png', frameWidth: 32, frameHeight: 32, frameCount: 8, fps: 8, animationFrames: [4, 5, 6, 7, 6, 5], defaultFrame: 6, facingDirection: 'right', bodyWidth: 24, bodyHeight: 20, behavior: 'fly', description: 'Flies in a wave pattern. Kills on contact.' },
  { id: 'crab', name: 'Crab', category: 'enemy', path: 'assets/enemies/crab.png', frameWidth: 32, frameHeight: 16, frameCount: 9, fps: 8, animationFrames: [0, 1, 2, 1], defaultFrame: 1, facingDirection: 'left', bodyWidth: 24, bodyHeight: 10, behavior: 'patrol', description: 'Patrols back and forth. Kills on contact.' },
  { id: 'bird', name: 'Bird', category: 'enemy', path: 'assets/enemies/bird.png', frameWidth: 32, frameHeight: 32, frameCount: 4, fps: 10, facingDirection: 'left', bodyWidth: 24, bodyHeight: 20, behavior: 'fly', description: 'Flies in a wave pattern. Kills on contact.' },
  { id: 'fish', name: 'Fish', category: 'enemy', path: 'assets/enemies/fish.png', frameWidth: 32, frameHeight: 16, frameCount: 3, fps: 8, animationFrames: [0, 1, 2, 1], defaultFrame: 1, facingDirection: 'right', bodyWidth: 22, bodyHeight: 10, behavior: 'fly', description: 'Swims left and right in a gentle wave. Kills on contact.' },
  { id: 'frog', name: 'Frog', category: 'enemy', path: 'assets/enemies/frog.png', frameWidth: 32, frameHeight: 32, frameCount: 4, fps: 6, facingDirection: 'right', bodyWidth: 24, bodyHeight: 24, behavior: 'bounce', description: 'Hops around periodically. Kills on contact.' },
  { id: 'snake', name: 'Snake', category: 'enemy', path: 'assets/enemies/snake.png', frameWidth: 32, frameHeight: 32, frameCount: 4, fps: 6, facingDirection: 'left', bodyWidth: 24, bodyHeight: 20, behavior: 'patrol', description: 'Patrols back and forth. Kills on contact.' },
  { id: 'penguin', name: 'Penguin', category: 'enemy', path: 'assets/enemies/penguin.png', frameWidth: 32, frameHeight: 32, frameCount: 4, fps: 6, facingDirection: 'right', bodyWidth: 24, bodyHeight: 28, behavior: 'patrol', description: 'Patrols back and forth. Kills on contact.' },
  { id: 'bear_brown', name: 'Brown Mouse', category: 'enemy', path: 'assets/enemies/bear_brown.png', frameWidth: 32, frameHeight: 32, frameCount: 8, fps: 6, animationFrames: [4, 5, 6, 7, 6, 5], defaultFrame: 5, facingDirection: 'right', bodyWidth: 24, bodyHeight: 22, behavior: 'patrol', description: 'Small patrol mouse. Kills on contact.' },
  { id: 'bear_polar', name: 'White Mouse', category: 'enemy', path: 'assets/enemies/bear_polar.png', frameWidth: 32, frameHeight: 32, frameCount: 8, fps: 6, animationFrames: [4, 5, 6, 7, 6, 5], defaultFrame: 5, facingDirection: 'right', bodyWidth: 24, bodyHeight: 22, behavior: 'patrol', description: 'Small patrol mouse. Kills on contact.' },
  { id: 'chicken', name: 'Chicken', category: 'enemy', path: 'assets/enemies/chicken.png', frameWidth: 32, frameHeight: 32, frameCount: 14, fps: 8, animationFrames: [7, 8, 9, 10, 11, 12, 13], defaultFrame: 7, facingDirection: 'left', bodyWidth: 18, bodyHeight: 16, behavior: 'patrol', description: 'Quick patrol enemy. Kills on contact.' },
  { id: 'shark', name: 'Shark', category: 'enemy', path: 'assets/enemies/shark.png', frameWidth: 64, frameHeight: 32, frameCount: 4, fps: 8, animationFrames: [0, 1, 2, 3, 2, 1], defaultFrame: 1, facingDirection: 'left', bodyWidth: 48, bodyHeight: 18, behavior: 'fly', description: 'Cruises left and right in a wave pattern. Kills on contact.' },

  { id: 'bounce_pad', name: 'Bounce Pad', category: 'interactive', path: 'assets/objects/bounce_pad.png', frameWidth: 16, frameHeight: 32, frameCount: 4, fps: 0, bodyWidth: 16, bodyHeight: 8, behavior: 'bounce', description: 'Launches player upward on contact.' },
  { id: 'spawn_point', name: 'Spawn Point', category: 'interactive', path: 'assets/objects/sign_arrow.png', frameWidth: 16, frameHeight: 32, frameCount: 1, fps: 0, bodyWidth: 0, bodyHeight: 0, behavior: 'static', description: 'Player spawn marker. Only one is stored per room.' },
  { id: 'flag', name: 'Flag', category: 'interactive', path: 'assets/objects/flag.png', frameWidth: 32, frameHeight: 32, frameCount: 9, fps: 8, bodyWidth: 8, bodyHeight: 28, behavior: 'animated', description: 'Goal marker. Reach to complete the room.' },
  { id: 'door_locked', name: 'Locked Door', category: 'interactive', path: 'assets/objects/door_locked.png', frameWidth: 32, frameHeight: 48, frameCount: 1, fps: 0, bodyWidth: 28, bodyHeight: 44, bodyOffsetX: 2, bodyOffsetY: 4, behavior: 'static', description: 'A key-gated door. Collect a key to unlock and pass through.' },
  { id: 'door_metal', name: 'Metal Door', category: 'platform', path: 'assets/objects/door_locked.png', frameWidth: 32, frameHeight: 48, frameCount: 1, fps: 0, bodyWidth: 28, bodyHeight: 44, bodyOffsetX: 2, bodyOffsetY: 4, behavior: 'static', description: 'Pressure-plate door. Opens while its linked plate stays pressed.' },
  { id: 'crate', name: 'Crate', category: 'platform', path: 'assets/objects/crate_static.png', frameWidth: 32, frameHeight: 32, frameCount: 1, fps: 0, bodyWidth: 16, bodyHeight: 16, bodyOffsetX: 0, bodyOffsetY: 16, previewWidth: 16, previewHeight: 16, previewOffsetX: 0, previewOffsetY: 16, behavior: 'static', description: 'Solid block. Stand on it or push it.' },
  { id: 'brick_box', name: 'Brick Box', category: 'platform', path: 'assets/objects/brick_box.png', frameWidth: 32, frameHeight: 32, frameCount: 6, fps: 0, defaultFrame: 3, bodyWidth: 16, bodyHeight: 17, bodyOffsetX: 8, bodyOffsetY: 7, previewWidth: 16, previewHeight: 17, previewOffsetX: 8, previewOffsetY: 7, behavior: 'static', description: 'Solid brick block. Stand on it like a platform.' },
  { id: 'treasure_chest', name: 'Treasure Chest', category: 'platform', path: 'assets/objects/treasure_chest.png', frameWidth: 32, frameHeight: 32, frameCount: 4, fps: 0, defaultFrame: 0, bodyWidth: 28, bodyHeight: 18, bodyOffsetX: 2, bodyOffsetY: 14, behavior: 'static', description: 'Solid chest prop. Good for treasure rooms.' },
  { id: 'log_wall', name: 'Log Wall', category: 'platform', path: 'assets/deco/log_wall.png', frameWidth: 32, frameHeight: 48, frameCount: 1, fps: 0, bodyWidth: 28, bodyHeight: 44, bodyOffsetX: 2, bodyOffsetY: 4, behavior: 'static', description: 'Tall wooden wall segment. Solid collision.' },
  { id: 'cage', name: 'Cage', category: 'platform', path: 'assets/objects/cage.png', frameWidth: 16, frameHeight: 32, frameCount: 5, fps: 0, defaultFrame: 0, bodyWidth: 14, bodyHeight: 30, bodyOffsetX: 1, bodyOffsetY: 2, behavior: 'static', description: 'Tall cage prop. Solid collision.' },
  { id: 'sign', name: 'Sign', category: 'decoration', path: 'assets/objects/sign.png', frameWidth: 16, frameHeight: 32, frameCount: 1, fps: 0, bodyWidth: 0, bodyHeight: 0, behavior: 'static', description: 'Decorative signpost. No collision.' },
  { id: 'sign_arrow', name: 'Arrow Sign', category: 'decoration', path: 'assets/objects/sign_arrow.png', frameWidth: 16, frameHeight: 32, frameCount: 1, fps: 0, bodyWidth: 0, bodyHeight: 0, behavior: 'static', description: 'Decorative arrow sign. No collision.' },
  { id: 'ladder', name: 'Ladder', category: 'interactive', path: 'assets/objects/ladder.png', frameWidth: 16, frameHeight: 64, frameCount: 1, fps: 0, bodyWidth: 16, bodyHeight: 51, bodyOffsetX: 0, bodyOffsetY: 13, previewWidth: 16, previewHeight: 51, previewOffsetX: 0, previewOffsetY: 13, behavior: 'static', description: 'Climbable surface. Press up to climb.' },
  { id: 'floor_trigger', name: 'Pressure Plate', category: 'interactive', path: 'assets/objects/floor_trigger.png', frameWidth: 8, frameHeight: 16, frameCount: 4, fps: 0, defaultFrame: 0, bodyWidth: 0, bodyHeight: 0, behavior: 'static', description: 'Link this plate to a door, cage, or chest, then press it with a player, monster, or crate.' },
  { id: 'button', name: 'Button', category: 'decoration', path: 'assets/objects/button.png', frameWidth: 16, frameHeight: 16, frameCount: 4, fps: 0, defaultFrame: 0, bodyWidth: 0, bodyHeight: 0, behavior: 'static', description: 'Floor button prop. Logic can be added later.' },

  { id: 'bush', name: 'Bush', category: 'decoration', path: 'assets/deco/bush.png', frameWidth: 32, frameHeight: 16, frameCount: 1, fps: 0, bodyWidth: 0, bodyHeight: 0, behavior: 'static', description: 'Decorative bush. No collision.' },
  { id: 'rock', name: 'Rock', category: 'decoration', path: 'assets/deco/rock.png', frameWidth: 16, frameHeight: 16, frameCount: 1, fps: 0, bodyWidth: 0, bodyHeight: 0, behavior: 'static', description: 'Decorative rock. No collision.' },
  { id: 'tree', name: 'Tree', category: 'decoration', path: 'assets/deco/tree.png', frameWidth: 48, frameHeight: 48, frameCount: 1, fps: 0, bodyWidth: 0, bodyHeight: 0, behavior: 'static', description: 'Decorative tree. No collision.' },
  { id: 'tree_b', name: 'Tree B', category: 'decoration', path: 'assets/deco/tree_b.png', frameWidth: 48, frameHeight: 64, frameCount: 1, fps: 0, bodyWidth: 0, bodyHeight: 0, behavior: 'static', description: 'Large decorative tree. No collision.' },
  { id: 'tree_c', name: 'Tree C', category: 'decoration', path: 'assets/deco/tree_c.png', frameWidth: 48, frameHeight: 48, frameCount: 1, fps: 0, bodyWidth: 0, bodyHeight: 0, behavior: 'static', description: 'Extra palm-like tree decoration.' },
  { id: 'tree_trunk', name: 'Tree Trunk', category: 'decoration', path: 'assets/deco/tree_trunk.png', frameWidth: 16, frameHeight: 16, frameCount: 1, fps: 0, bodyWidth: 0, bodyHeight: 0, behavior: 'static', description: 'Cut stump or trunk decoration.' },
  { id: 'sun', name: 'Sun', category: 'decoration', path: 'assets/deco/sun.png', frameWidth: 32, frameHeight: 32, frameCount: 6, fps: 4, bodyWidth: 0, bodyHeight: 0, behavior: 'animated', description: 'Animated sun. Purely decorative.' },
  { id: 'clouds_deco', name: 'Clouds', category: 'decoration', path: 'assets/deco/clouds.png', frameWidth: 64, frameHeight: 24, frameCount: 2, fps: 0, bodyWidth: 0, bodyHeight: 0, behavior: 'static', description: 'Cloud decoration. No collision.' },
];

export function getObjectById(id: string): GameObjectConfig | undefined {
  return GAME_OBJECTS.find((gameObject) => gameObject.id === id);
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

export function getObjectFrameSourceRect(
  config: GameObjectConfig,
  frame: number,
  sheetWidth: number
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

export interface PlacedObject {
  id: string;
  x: number;
  y: number;
  instanceId: string;
  facing?: 'left' | 'right';
  layer?: LayerName;
  triggerTargetInstanceId?: string | null;
  containedObjectId?: string | null;
}

export function getPlacedObjectLayer(
  placed: Pick<PlacedObject, 'layer'> | null | undefined
): LayerName {
  if (
    placed?.layer === 'background' ||
    placed?.layer === 'terrain' ||
    placed?.layer === 'foreground'
  ) {
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
  index: number
): string {
  const facing = placed.facing === 'left' || placed.facing === 'right' ? placed.facing : 'none';
  return `legacy_${index}_${placed.id}_${Math.round(placed.x)}_${Math.round(placed.y)}_${facing}_${getPlacedObjectLayer(placed)}`;
}

export function getPlacedObjectInstanceId(
  placed: Pick<PlacedObject, 'id' | 'x' | 'y' | 'facing' | 'layer' | 'instanceId'>,
  index: number
): string {
  if (typeof placed.instanceId === 'string' && placed.instanceId.trim()) {
    return placed.instanceId;
  }

  return createLegacyPlacedObjectInstanceId(placed, index);
}

export function isPressurePlateTriggerId(id: string): id is 'floor_trigger' {
  return id === 'floor_trigger';
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
  objectConfig: Pick<GameObjectConfig, 'category'> | null | undefined
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
  placed: Pick<PlacedObject, 'id' | 'containedObjectId'>,
  category: ObjectCategory
): boolean {
  const directConfig = getObjectById(placed.id);
  if (directConfig?.category === category) {
    return true;
  }

  if (!canPlacedObjectBeContainer(placed) || !placed.containedObjectId) {
    return false;
  }

  const containedConfig = getObjectById(placed.containedObjectId);
  return containedConfig?.category === category;
}

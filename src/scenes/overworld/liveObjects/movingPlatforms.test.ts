import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';

vi.mock('phaser', () => ({ default: { Geom: { Rectangle: class {
  constructor(public x: number, public y: number, public width: number, public height: number) {}
  get left() { return this.x; } get right() { return this.x + this.width; }
  get top() { return this.y; } get bottom() { return this.y + this.height; }
  get centerX() { return this.x + this.width / 2; } get centerY() { return this.y + this.height / 2; }
} } } }));
import { carryMovingPlatformRiders } from './movingPlatforms';

const requirePhaser = createRequire(import.meta.url);
const World = requirePhaser('phaser/src/physics/arcade/World.js') as typeof Phaser.Physics.Arcade.World;
const Body = requirePhaser('phaser/src/physics/arcade/Body.js') as typeof Phaser.Physics.Arcade.Body;

function fixture() {
  const world = new World({ sys: { scale: { width: 640, height: 352 } } } as never, { debug: false });
  const sprite = { x: 50, y: 50, angle: 0, scaleX: 1, scaleY: 1, displayOriginX: 5, displayOriginY: 13,
    displayWidth: 10, displayHeight: 26, active: true,
    setPosition(x: number, y: number) { this.x = x; this.y = y; } };
  const rider = new Body(world, sprite as never);
  rider.setSize(10, 14, false); rider.setOffset(0, 12); rider.updateFromGameObject();
  rider.prevFrame.copy(rider.position); rider.prev.copy(rider.position);
  // Simulate unposted motion between World.step and World.postUpdate.
  rider.x += 3; rider.y += 2; rider.updateCenter(); rider.setVelocity(20, 0);
  const platform = new Body(world); platform.setSize(32, 8, false); platform.reset(40, 65);
  const platformSprite = { x: 42, y: 65, body: platform };
  const platformObject = { config: { id: 'moving_platform', category: 'platform' }, sprite: platformSprite,
    runtime: { previousX: 40, previousY: 65 } };
  return { world, sprite, rider, platform, platformObject };
}

describe('moving platform carry during physics catch-up', () => {
  it('preserves unposted player motion and the airborne body offset', () => {
    const f = fixture();
    try {
      carryMovingPlatformRiders([{ liveObjects: [f.platformObject] }] as never, {
        getDynamicBody: () => f.platform, getPlayerBody: () => f.rider,
      });
      expect(f.sprite.x).toBe(55); expect(f.sprite.y).toBe(52);
      expect(f.rider.bottom).toBe(f.platform.top); expect(f.rider.velocity.x).toBe(20);
      const position = { x: f.sprite.x, y: f.sprite.y };
      f.rider.postUpdate();
      expect({ x: f.sprite.x, y: f.sprite.y }).toEqual(position);
    } finally { f.world.destroy(); }
  });

  it('carries an NPC without losing its motion or applying it again in postUpdate', () => {
    const f = fixture();
    try {
      const npc = { config: { id: 'jimothy', category: 'npc' }, sprite: { ...f.sprite, body: f.rider },
        layer: 'terrain', runtime: { npcMode: 'patrol', npcPushable: true } };
      // Use the actual game object, not a copy, for body/sprite ownership.
      npc.sprite = Object.assign(f.sprite, { body: f.rider });
      const moved = vi.fn();
      carryMovingPlatformRiders([{ liveObjects: [f.platformObject, npc] }] as never, {
        getDynamicBody: () => f.platform, getPlayerBody: () => null, onLiveObjectMoved: moved,
      });
      expect(f.sprite.x).toBe(55); expect(f.sprite.y).toBe(52);
      expect(f.rider.bottom).toBe(f.platform.top); expect(f.rider.velocity.x).toBe(20);
      expect(moved).toHaveBeenCalledOnce();
      f.rider.postUpdate(); expect(f.sprite.x).toBe(55); expect(f.sprite.y).toBe(52);
    } finally { f.world.destroy(); }
  });
});

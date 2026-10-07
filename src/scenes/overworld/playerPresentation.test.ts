import { describe, expect, it, vi } from 'vitest';
import type { PlayerGravityDirection, SpecialTilePlayerEnvironment } from './specialTiles';
import { OverworldPlayerPresentationController } from './playerPresentation';

vi.mock('phaser', () => ({ default: {} }));
vi.mock('../../player/avatar/runtime', () => ({
  resolveActivePlayerAvatarPack: () => ({ animationKeys: { run: 'run', idle: 'idle' } }),
}));
vi.mock('./playerAnimation', () => ({ playPlayerAnimationIfReady: vi.fn() }));

function harness(gravityDirection: PlayerGravityDirection = 'down') {
  const player = { x: 100, y: 200 };
  const body = { center: { x: 100, y: 200 }, left: 96, right: 104, top: 193, bottom: 207,
    velocity: { x: 150, y: 0 } };
  const sprite = { x: 0, y: 0, scaleX: 1, scaleY: 1, anims: { currentAnim: { key: 'run' } },
    setPosition(x: number, y: number) { this.x = x; this.y = y; },
    setRotation: vi.fn(), setFlipX: vi.fn(), setScale: vi.fn() };
  const environment = { gravityDirection, conveyorX: 0, onIce: false, windX: 0 } as SpecialTilePlayerEnvironment;
  const movement = { isCrouching: false, isButtStomping: false, buttStompFlipUntil: 0,
    activeCrateInteractionMode: null, activeCrateInteractionFacing: null,
    weaponKnockbackUntil: 0, isClimbingLadder: false, isWallSliding: false,
    wallContactSide: 0 as const, wallJumpActive: false };
  const controller = new OverworldPlayerPresentationController({
    state: { animationState: 'run', facing: 1, wasGrounded: true, landAnimationUntil: 0 },
    getCurrentTime: () => 1000, getPlayer: () => player as never,
    getPlayerBody: () => body as never, getPlayerSprite: () => sprite as never,
    getPlayerPickupSensor: () => null, getPlayerPickupSensorBody: () => null,
    getSpecialTileEnvironment: () => environment, getLastMovementInput: () => ({ horizontalInput: 1, verticalInput: 0 }),
    getQuicksandVisualSink: () => 0, getMovementPresentationState: () => movement,
    getGroundedOverride: () => true, getCurrentAttackAnimation: () => null, playLandingDustFx: vi.fn(),
  }, { playerPickupSensorExtraHeight: 4, playerVisualFeetOffset: 1, landingAnimationMs: 100,
    facingVelocityThreshold: 1, jumpRiseVelocityThreshold: -1, crouchMoveVelocityThreshold: 1, runVelocityThreshold: 1 });
  return { controller, player, body, sprite };
}

describe('player presentation during the Arcade update handoff', () => {
  it.each([-1, 1])('keeps the rendered avatar aligned across uneven physics steps while running %s', direction => {
    const { controller, player, body, sprite } = harness();
    body.velocity.x = direction * 150;
    for (const steps of [1, 0, 2, 1, 3, 0, 1]) {
      // Arcade advances its body before Scene.update, then its game object in postUpdate.
      body.center.x = player.x + direction * 2.5 * steps;
      controller.syncPlayerVisual(false);
      player.x = body.center.x;
      expect(sprite.x).toBe(Math.round(player.x));
      expect(sprite.y).toBe(body.bottom + 1);
      expect(body.velocity.x).toBe(direction * 150);
    }
  });

  it('uses collision-corrected position and keeps rounding confined to the artwork', () => {
    const { controller, player, body, sprite } = harness();
    body.center.x = 104.375;
    body.velocity.x = 0;
    controller.syncPlayerVisual(false);
    expect(sprite.x).toBe(104);
    expect(player.x).toBe(100);
    expect(body.center.x).toBe(104.375);
    expect(body.velocity.x).toBe(0);
  });

  it.each(['up', 'left', 'right'] as const)('preserves feet placement for %s gravity', gravity => {
    const { controller, body, sprite } = harness(gravity);
    controller.syncPlayerVisual(false);
    const expected = gravity === 'up' ? [body.center.x, body.top - 1]
      : gravity === 'left' ? [body.left - 1, body.center.y] : [body.right + 1, body.center.y];
    expect([sprite.x, sprite.y]).toEqual(expected);
  });
});

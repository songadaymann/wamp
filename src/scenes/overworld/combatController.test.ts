import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {
  Geom: { Rectangle: class {
    constructor(public x: number, public y: number, public width: number, public height: number) {}
  } },
  Math: { Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)) },
} }));
vi.mock('../../audio/sfx', () => ({ playSfx: vi.fn() }));

import { OverworldCombatController } from './combatController';

function harness(height: number, facing: -1 | 1 = 1) {
  const body = { top: 272 - height, bottom: 272, height, center: { x: 100, y: 272 - height * 0.5 },
    velocity: { x: 0, y: -100 }, setVelocityY: vi.fn() };
  const host = {
    getCurrentTime: () => 1000, getPlayer: () => ({ x: 100 }), getPlayerBody: () => body,
    getPlayerFacing: () => facing, isPlayerCrouching: () => height === 14,
    attackEnemiesInRect: vi.fn<(rect: unknown, maxHits: number) => never[]>(() => []),
    attackPeerInRect: vi.fn<(rect: unknown, source: string) => null>(() => null),
    presentCombatEvent: vi.fn<(event: unknown) => null>(() => null), publishCombatAction: vi.fn(),
  };
  const controller = new OverworldCombatController(host as never, {
    playerStandingHeight: 26, swordCooldownMs: 260, swordAttackMs: 170, swordHitDamage: 3,
  } as never);
  return { controller, host, body };
}

describe('forward sword geometry', () => {
  it.each([14, 26])('uses the standing reach and torso presentation with a %ipx body', (height) => {
    const { controller, host, body } = harness(height);
    controller.handleCombatInput({ swordPressed: true, gunPressed: false, downHeld: false, grounded: height === 26 });
    const rect = host.attackEnemiesInRect.mock.calls[0][0];
    expect(rect).toEqual({ x: 94, y: 246, width: 28, height: 30 });
    expect(host.attackPeerInRect).toHaveBeenCalledWith(rect, 'sword');
    expect(host.presentCombatEvent).toHaveBeenCalledWith(expect.objectContaining({ effectX: 100, effectY: 259, downward: false }));
    expect(host.publishCombatAction).toHaveBeenCalledWith(host.presentCombatEvent.mock.calls[0][0]);
    expect(body).toMatchObject({ height, top: 272 - height, bottom: 272, velocity: { y: -100 } });
  });

  it('keeps a left-facing slash mirrored and crouched forward attacks at the same height', () => {
    const { controller, host } = harness(14, -1);
    controller.handleCombatInput({ swordPressed: true, gunPressed: false, downHeld: true, grounded: true });
    expect(host.attackEnemiesInRect.mock.calls[0][0]).toEqual({ x: 78, y: 246, width: 28, height: 30 });
    expect(host.presentCombatEvent).toHaveBeenCalledWith(expect.objectContaining({ effectY: 259, facing: -1, downward: false }));
  });

  it('keeps the downward slash below the feet with its existing falling impulse', () => {
    const { controller, host, body } = harness(14);
    controller.handleCombatInput({ swordPressed: true, gunPressed: false, downHeld: true, grounded: false });
    expect(host.attackEnemiesInRect.mock.calls[0][0]).toEqual({ x: 88, y: 270, width: 24, height: 28 });
    expect(host.presentCombatEvent).toHaveBeenCalledWith(expect.objectContaining({ effectY: 270, downward: true }));
    expect(body.setVelocityY).toHaveBeenCalledWith(120);
  });
});

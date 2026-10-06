import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {
  Geom: { Rectangle: class {
    constructor(public x: number, public y: number, public width: number, public height: number) {}
  } },
  Math: { Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)), Linear: (a: number, b: number, t: number) => a + (b - a) * t },
} }));
vi.mock('../../audio/sfx', () => ({ playSfx: vi.fn() }));

import { OverworldCombatController } from './combatController';
import { playSfx } from '../../audio/sfx';
import type { WeaponHitResult } from './liveObjects';
import type { PresentedProjectile } from './combatPresentation';

beforeEach(() => vi.clearAllMocks());

function harness(height: number, initialFacing: -1 | 1 = 1) {
  let now = 1000;
  let facing = initialFacing;
  const player = { x: 100 };
  const body = { top: 272 - height, bottom: 272, height, center: { x: 100, y: 272 - height * 0.5 },
    velocity: { x: 0, y: -100 }, setVelocityY: vi.fn<(y: number) => void>() };
  body.setVelocityY.mockImplementation(y => { body.velocity.y = y; });
  const host = {
    getCurrentTime: () => now, getPlayer: () => player, getPlayerBody: vi.fn(() => body),
    getPlayerFacing: () => facing, isPlayerCrouching: () => height === 14,
    attackEnemiesInRect: vi.fn<(rect: unknown, maxHits: number, hitKeys: Set<string>) => WeaponHitResult[]>(() => []),
    attackPeerInRect: vi.fn<(rect: unknown, source: string) => WeaponHitResult | null>(() => null),
    attackEnemyAtPoint: vi.fn<(x: number, y: number, radius: number) => WeaponHitResult | null>(() => null),
    attackPeerAtPoint: vi.fn(() => null), isProjectileBlocked: vi.fn(() => false),
    presentCombatEvent: vi.fn<(event: unknown, options?: unknown) => PresentedProjectile | null>(() => null),
    publishCombatAction: vi.fn(), applyWeaponKnockback: vi.fn(), shakeCamera: vi.fn(),
    playPeerHitFx: vi.fn(), playBulletImpactFx: vi.fn(), destroyPresentedProjectile: vi.fn(),
  };
  const controller = new OverworldCombatController(host as never, {
    playerStandingHeight: 26, swordCooldownMs: 220, swordAttackMs: 170, swordActiveMs: 100,
    swordMaxHitsPerSwing: 3, swordHitLungeVelocity: 80, downwardSlashBounceVelocity: -245,
    gunCooldownMs: 200, gunAttackMs: 120, gunHitRadius: 5, gunRecoilVelocity: 50,
    projectileSpeed: 1000, projectileLifetimeMs: 1000, playerSpeed: 180,
  });
  return { controller, host, body, player, timeTo: (time: number) => { now = time; },
    face: (direction: -1 | 1) => { facing = direction; } };
}
const hit = { roomId: '0,0', enemyName: 'Blue Slime', x: 125, y: 265 };
const swordInput = { swordPressed: true, gunPressed: false, downHeld: false, grounded: true };

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


describe('active sword swing', () => {
  it('connects after a press-frame miss, follows the current body and retains the original facing', () => {
    const h = harness(26);
    h.controller.handleCombatInput(swordInput);
    expect(playSfx).not.toHaveBeenCalled();
    expect(h.host.applyWeaponKnockback).not.toHaveBeenCalled();
    expect(h.host.shakeCamera).not.toHaveBeenCalled();
    h.timeTo(1050); h.face(-1); h.body.center.x = 120; h.body.bottom = 268;
    h.host.attackEnemiesInRect.mockReturnValue([hit]);
    h.controller.updateSwordSwing();
    expect(h.host.attackEnemiesInRect.mock.calls[1][0]).toEqual({ x: 114, y: 242, width: 28, height: 30 });
    expect(h.controller.getSwordSwingState(1050)).toMatchObject({ remainingMs: 50, connected: true, facing: 1 });
    expect(playSfx).toHaveBeenCalledExactlyOnceWith('enemy-hit');
    expect(h.host.applyWeaponKnockback).toHaveBeenCalledExactlyOnceWith(80);
    expect(h.host.shakeCamera).toHaveBeenCalledExactlyOnceWith(50, 0.002);
    expect(h.host.presentCombatEvent).toHaveBeenCalledTimes(1);
    expect(h.host.publishCombatAction).toHaveBeenCalledTimes(1);
  });

  it('allows a contact at 99ms and expires at 100ms while the 170ms visual animation continues', () => {
    const h = harness(26); h.controller.handleCombatInput(swordInput);
    h.timeTo(1099); h.host.attackEnemiesInRect.mockReturnValue([hit]); h.controller.updateSwordSwing();
    expect(h.host.attackEnemiesInRect).toHaveBeenCalledTimes(2);
    h.timeTo(1100); h.controller.updateSwordSwing();
    expect(h.host.attackEnemiesInRect).toHaveBeenCalledTimes(2);
    expect(h.controller.getSwordSwingState(1100)).toBeNull();
    expect(h.controller.getCurrentAttackAnimation(1100)).toBe('sword-slash');
    expect(h.controller.getCurrentAttackAnimation(1170)).toBeNull();
  });

  it('retains the three-enemy budget and contact set across frames without checking twice at the same time', () => {
    const h = harness(26); h.host.attackEnemiesInRect.mockReturnValueOnce([hit, hit]);
    h.controller.handleCombatInput(swordInput); h.controller.updateSwordSwing();
    expect(h.host.attackEnemiesInRect).toHaveBeenCalledTimes(1);
    const keys = h.host.attackEnemiesInRect.mock.calls[0][2]; keys.add('0,0:slime-one');
    h.timeTo(1040); h.host.attackEnemiesInRect.mockReturnValueOnce([hit]); h.controller.updateSwordSwing();
    expect(h.host.attackEnemiesInRect.mock.calls[1].slice(1)).toEqual([1, keys]);
    h.timeTo(1070); h.controller.updateSwordSwing();
    expect(h.host.attackEnemiesInRect).toHaveBeenCalledTimes(2);
    expect(h.controller.getSwordSwingState(1070)).toMatchObject({ remainingEnemyHits: 0, enemyContacts: 1 });
    expect(playSfx).toHaveBeenCalledTimes(1);
    expect(h.host.applyWeaponKnockback).toHaveBeenCalledTimes(1);
    expect(h.host.shakeCamera).toHaveBeenCalledTimes(1);
  });

  it('checks a late PvP opponent once after contact, including when a later enemy is defeated', () => {
    const h = harness(26); h.controller.handleCombatInput(swordInput);
    h.timeTo(1040); h.host.attackPeerInRect.mockReturnValue(hit); h.controller.updateSwordSwing();
    h.timeTo(1070); h.host.attackEnemiesInRect.mockReturnValue([hit]); h.controller.updateSwordSwing();
    expect(h.host.attackPeerInRect).toHaveBeenCalledTimes(2);
    expect(h.host.playPeerHitFx).toHaveBeenCalledExactlyOnceWith(hit.x, hit.y);
    expect(playSfx).toHaveBeenCalledTimes(1);
    expect(h.host.applyWeaponKnockback).toHaveBeenCalledTimes(1);
    expect(h.host.shakeCamera).toHaveBeenCalledTimes(1);
  });

  it('recomputes downward reach and applies its bounce only on the first connection', () => {
    const h = harness(14); h.controller.handleCombatInput({ ...swordInput, downHeld: true, grounded: false });
    expect(h.body.setVelocityY).toHaveBeenCalledExactlyOnceWith(120);
    h.timeTo(1040); h.body.bottom = 260; h.host.attackEnemiesInRect.mockReturnValue([hit]); h.controller.updateSwordSwing();
    expect(h.host.attackEnemiesInRect.mock.calls[1][0]).toEqual({ x: 88, y: 258, width: 24, height: 28 });
    expect(h.body.velocity.y).toBe(-245);
    h.timeTo(1070); h.controller.updateSwordSwing();
    expect(h.body.setVelocityY).toHaveBeenCalledTimes(2);
    expect(h.host.applyWeaponKnockback).not.toHaveBeenCalled();
    expect(h.host.shakeCamera).toHaveBeenCalledTimes(1);
  });

  it.each(['clearAttackAnimation', 'reset'] as const)('cancels pending contacts through %s', (method) => {
    const h = harness(26); h.controller.handleCombatInput(swordInput); h.controller[method]();
    h.timeTo(1040); h.host.attackEnemiesInRect.mockReturnValue([hit]); h.controller.updateSwordSwing();
    expect(h.host.attackEnemiesInRect).toHaveBeenCalledTimes(1);
    expect(h.controller.getSwordSwingState(1040)).toBeNull();
    expect(playSfx).not.toHaveBeenCalled();
  });

  it('cancels the swing when a gun attack replaces the sword presentation', () => {
    const h = harness(26); h.controller.handleCombatInput(swordInput); h.timeTo(1020);
    h.controller.handleCombatInput({ ...swordInput, swordPressed: false, gunPressed: true });
    h.timeTo(1040); h.host.attackEnemiesInRect.mockReturnValue([hit]); h.controller.updateSwordSwing();
    expect(h.host.attackEnemiesInRect).toHaveBeenCalledTimes(1);
    expect(h.controller.getSwordSwingState(1040)).toBeNull();
    expect(h.controller.getCurrentAttackAnimation(1040)).toBe('gun-fire');
  });

  it('cancels on a missing player and cannot resume after the body is restored', () => {
    const h = harness(26); h.controller.handleCombatInput(swordInput); h.timeTo(1020);
    h.host.getPlayerBody.mockReturnValueOnce(null as never); h.controller.updateSwordSwing();
    h.timeTo(1040); h.controller.updateSwordSwing();
    expect(h.host.attackEnemiesInRect).toHaveBeenCalledTimes(1);
    expect(h.controller.getSwordSwingState(1040)).toBeNull();
  });

  it('does not report another target after a defeat callback stops the swing', () => {
    const h = harness(26);
    h.host.attackEnemiesInRect.mockImplementation(() => { h.controller.clearAttackAnimation(); return [hit]; });
    h.controller.handleCombatInput(swordInput);
    expect(h.host.attackPeerInRect).not.toHaveBeenCalled();
    expect(h.host.shakeCamera).not.toHaveBeenCalled();
    expect(h.controller.getSwordSwingState(1000)).toBeNull();
  });

  it('keeps the cooldown and gives the next swing a fresh contact set', () => {
    const h = harness(26); h.controller.handleCombatInput(swordInput);
    const keys = h.host.attackEnemiesInRect.mock.calls[0][2]; keys.add('already-contacted');
    h.timeTo(1040); h.controller.handleCombatInput(swordInput);
    expect(h.host.presentCombatEvent).toHaveBeenCalledTimes(1);
    h.timeTo(1220); h.controller.handleCombatInput(swordInput);
    expect(h.host.presentCombatEvent).toHaveBeenCalledTimes(2);
    expect(h.host.attackEnemiesInRect.mock.calls[1][2]).not.toBe(keys);
    expect(h.host.attackEnemiesInRect.mock.calls[1][2].size).toBe(0);
  });

  it('retains the bullet radius, first impact and projectile cleanup', () => {
    const h = harness(26);
    const projectile = { rect: { x: 110, y: 254, active: true } } as never;
    h.host.presentCombatEvent.mockReturnValueOnce(projectile);
    h.controller.handleCombatInput({ ...swordInput, swordPressed: false, gunPressed: true });
    h.host.attackEnemyAtPoint.mockReturnValueOnce(hit); h.controller.updateProjectiles(16);
    expect(h.host.attackEnemyAtPoint).toHaveBeenCalledExactlyOnceWith(expect.any(Number), 254, 5);
    expect(h.host.destroyPresentedProjectile).toHaveBeenCalledExactlyOnceWith(projectile);
    expect(h.controller.getProjectileCount()).toBe(0);
    expect(h.host.playBulletImpactFx).toHaveBeenCalledExactlyOnceWith(hit.x, hit.y - 2);
  });
});

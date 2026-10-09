import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));
const display = vi.hoisted(() => ({ setHearts: vi.fn(), setPosition: vi.fn(), setVisible: vi.fn(),
  getGameObject: vi.fn(() => ({})), destroy: vi.fn() }));
vi.mock('./pvpHeartDisplay', () => ({ PVP_HEART_HEAD_CLEARANCE_PX: 12,
  PvpHeartDisplay: class { constructor() { return display; } } }));
import { OverworldPlayerHealthController } from './playerHealth';

function fixture() {
  const state = { maximum: 3, active: true, pvp: false, pending: false, now: 1000 };
  const sprite = { active: true, y: 100, displayHeight: 84, scaleY: 1,
    setAlpha: vi.fn(), setTintFill: vi.fn(), clearTint: vi.fn() };
  const body = { center: { x: 40 }, top: 72 };
  const host = { scene: {} as never, getMaximumHearts: () => state.maximum,
    isActive: () => state.active, isPvpActive: () => state.pvp, isDeathPending: () => state.pending,
    getCurrentTime: () => state.now, getPlayerBody: () => body as never,
    getPlayerSprite: () => sprite as never, onHurt: vi.fn(), onDisplayObjectsChanged: vi.fn() };
  const controller = new OverworldPlayerHealthController(host);
  return { controller, state, sprite, host };
}

describe('room health lifecycle and display ownership', () => {
  it('protects contacts, expires its own blink, and retains the missing heart until healed', () => {
    const f = fixture(); f.controller.refillForSpawn();
    // Full atlas padding must not push the icons far above the visible head.
    expect(display.setPosition).toHaveBeenLastCalledWith(40, 44);
    expect(f.controller.absorbDamage()).toBe(true);
    expect(f.controller.absorbDamage()).toBe(true);
    expect(f.host.onHurt).toHaveBeenCalledOnce();
    expect(f.controller.describe()).toMatchObject({ current: 2, invulnerableMs: 1000 });
    f.state.now = 2000; f.controller.sync();
    expect(f.sprite.clearTint).toHaveBeenCalledOnce();
    expect(f.controller.describe().current).toBe(2);
    expect(f.controller.heal()).toBe(true); expect(f.controller.heal()).toBe(false);
    expect(f.controller.describe().current).toBe(3);
  });

  it('clamps without healing at boundaries and refills only at a new spawn', () => {
    const f = fixture(); f.controller.refillForSpawn(); f.controller.absorbDamage();
    f.state.maximum = 1; f.controller.sync();
    expect(f.controller.describe()).toMatchObject({ current: 1, maximum: 1, visible: false });
    f.state.maximum = 3; f.controller.sync(); expect(f.controller.describe().current).toBe(1);
    f.controller.refillForSpawn(); expect(f.controller.describe()).toMatchObject({ current: 3, invulnerableMs: 0 });
    f.controller.die(); f.state.pending = true;
    expect(f.controller.heal()).toBe(false); expect(f.controller.describe().visible).toBe(false);
    f.state.pending = false; f.controller.refillForSpawn(); expect(f.controller.describe().current).toBe(3);
  });

  it('leaves Room Rush deaths and PvP damage/tint to their existing owners', () => {
    const f = fixture(); f.state.active = false; f.controller.refillForSpawn();
    expect(f.controller.absorbDamage()).toBe(false); expect(f.controller.heal()).toBe(false);
    expect(f.controller.describe()).toMatchObject({ current: 1, enabled: false, visible: false });
    f.state.active = true; f.controller.refillForSpawn(); f.controller.absorbDamage();
    f.sprite.clearTint.mockClear(); f.sprite.setAlpha.mockClear();
    f.state.active = false; f.state.pvp = true; f.controller.sync();
    expect(f.sprite.clearTint).not.toHaveBeenCalled(); expect(f.sprite.setAlpha).not.toHaveBeenCalled();
    expect(f.controller.absorbDamage()).toBe(false); f.controller.destroy();
    expect(f.sprite.clearTint).not.toHaveBeenCalled();
  });
});

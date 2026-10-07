import { describe, expect, it, vi } from 'vitest';
import { LiveObjectJumpFeatherController, JUMP_FEATHER_RESPAWN_MS } from './jumpFeather';
import type { LoadedRoomObject } from './model';

function harness() {
  let now = 0, charge = false, overlap: () => void = () => {};
  const sprite = { active: true, visible: true, body: { enable: true },
    setVisible(value: boolean) { this.visible = value; }, setAlpha: vi.fn() };
  const object = { sprite, interactions: [], runtime: { cooldownUntil: 0 } } as unknown as LoadedRoomObject;
  const host = { scene: { physics: { add: { overlap: vi.fn((_player, _sprite, callback) => { overlap = callback; return {}; }) } } },
    getCurrentTime: () => now, grantAirJump: vi.fn(() => { if (charge) return false; charge = true; return true; }),
    showTransientStatus: vi.fn(), playPickupFx: vi.fn() };
  const controller = new LiveObjectJumpFeatherController(host as never);
  controller.addInteraction(object, {} as never, { x: 4, y: -2 });
  return { controller, object, host, sprite, touch: () => overlap(), setNow: (value: number) => { now = value; },
    consume: () => { charge = false; } };
}

describe('jump feather pickup', () => {
  it('hides sprite and overlap body, gives one charge, and respawns after three seconds', () => {
    const h = harness(); h.touch(); h.touch();
    expect(h.sprite.visible).toBe(false); expect(h.sprite.body.enable).toBe(false);
    expect(h.host.grantAirJump).toHaveBeenCalledOnce(); expect(h.host.playPickupFx).toHaveBeenCalledOnce();
    h.setNow(JUMP_FEATHER_RESPAWN_MS - 1); h.controller.update(h.object);
    expect(h.sprite.visible).toBe(false);
    h.setNow(JUMP_FEATHER_RESPAWN_MS); h.controller.update(h.object);
    expect(h.sprite.visible).toBe(true); expect(h.sprite.body.enable).toBe(true);
    h.touch(); expect(h.sprite.visible).toBe(true); // An unused charge never wastes the feather.
    h.consume(); h.touch(); expect(h.sprite.visible).toBe(false);
    expect(h.host.playPickupFx).toHaveBeenCalledTimes(2);
  });

  it('ignores destroyed and invisible objects', () => {
    const h = harness(); h.sprite.active = false; h.touch();
    expect(h.host.grantAirJump).not.toHaveBeenCalled(); h.sprite.active = true; h.sprite.visible = false; h.touch();
    expect(h.host.grantAirJump).not.toHaveBeenCalled();
  });
});

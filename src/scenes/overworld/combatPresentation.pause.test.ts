import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: {} }));
import { OverworldCombatPresentationController, type CombatPresentationEvent } from './combatPresentation';

function fixture() {
  let localTime = 1000;
  const rect = { active: true, setDepth: vi.fn(), setPosition: vi.fn(), destroy: vi.fn(() => { rect.active = false; }) };
  const controller = new OverworldCombatPresentationController({
    scene: { add: { rectangle: () => rect } } as never,
    getLocalTime: () => localTime, playSwordSlashFx: vi.fn(), playMuzzleFlashFx: vi.fn(),
  });
  const event: CombatPresentationEvent = { id: 'pause-shot', owner: 'local', source: 'gun', x: 80, y: 100,
    facing: 1, startedAt: 100000, durationMs: 200, effectX: 80, effectY: 100, downward: false,
    projectile: { x: 80, y: 100, velocityX: 200, lifetimeMs: 1000 } };
  return { controller, rect, event, advance: (delta: number) => { localTime += delta; } };
}
describe('projectile pause clocks', () => {
  it('preserves local projectiles across a wall-clock break, then expires them in simulation time', () => {
    const f = fixture(); f.controller.present(f.event);
    f.controller.update(160000); expect(f.rect.active).toBe(true);
    f.advance(999); f.controller.update(160999); expect(f.rect.active).toBe(true);
    f.advance(1); f.controller.update(161000); expect(f.rect.active).toBe(false);
  });
  it('keeps remote projectile presentation on the shared wall clock', () => {
    const f = fixture(); f.controller.present({ ...f.event, owner: 'remote' }, { autoUpdateProjectile: true });
    f.controller.update(100500); expect(f.rect.setPosition).toHaveBeenCalledWith(180, 100);
    f.controller.update(101000); expect(f.rect.active).toBe(false);
  });
});

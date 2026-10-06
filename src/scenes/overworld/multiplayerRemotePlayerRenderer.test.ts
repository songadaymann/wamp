import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Geom: { Rectangle: class {
  constructor(public x: number, public y: number, public width: number, public height: number) {}
  get bottom() { return this.y + this.height; }
} } } }));

import { MultiplayerRemotePlayerRenderer } from './multiplayerRemotePlayerRenderer';

function harness(height = 14) {
  const renderer = new MultiplayerRemotePlayerRenderer({
    scene: {} as never, playerWidth: 10, playerHeight: height, playerStandingHeight: 26,
    presentCombatEvent: vi.fn(),
  });
  const opponent = { sprite: { visible: true, x: 100, y: 220 }, facing: 1,
    action: 'sword', actionUntil: Date.now() + 1000, actionDownward: false };
  (renderer as unknown as { opponent: unknown }).opponent = opponent;
  return { renderer, opponent };
}

describe('instance remote attack geometry', () => {
  it.each([14, 26])('keeps forward sword reach aligned with a %ipx presence body', (height) => {
    expect(harness(height).renderer.getRemoteActionDamageRect())
      .toEqual({ x: 80, y: 186, width: 56, height: 46 });
  });

  it('mirrors the forward swing for a left-facing peer', () => {
    const { renderer, opponent } = harness(); opponent.facing = -1;
    expect(renderer.getRemoteActionDamageRect()).toEqual({ x: 64, y: 186, width: 56, height: 46 });
  });

  it('retains the downward envelope', () => {
    const { renderer, opponent } = harness(); opponent.actionDownward = true;
    expect(renderer.getRemoteActionDamageRect()).toEqual({ x: 74, y: 210, width: 52, height: 44 });
  });

  it('retains the gun envelope', () => {
    const { renderer, opponent } = harness(); opponent.action = 'gun';
    expect(renderer.getRemoteActionDamageRect()).toEqual({ x: 92, y: 197, width: 104, height: 32 });
  });

  it('does not create damage bounds for hidden or expired opponents', () => {
    const { renderer, opponent } = harness(); opponent.sprite.visible = false;
    expect(renderer.getRemoteActionDamageRect()).toBeNull();
    opponent.sprite.visible = true; opponent.actionUntil = Date.now() - 161;
    expect(renderer.getRemoteActionDamageRect()).toBeNull();
  });
});

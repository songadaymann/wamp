import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({
  default: {},
}));
import {
  OverworldPresenceController,
  type LocalPresenceInput,
} from './presence';

function createInput(overrides: Partial<LocalPresenceInput> = {}): LocalPresenceInput {
  return {
    mode: 'play',
    roomCoordinates: { x: 0, y: 0 },
    x: 100,
    y: 120,
    velocityX: 0,
    velocityY: 0,
    facing: 1,
    animationState: 'idle',
    pvp: null,
    ...overrides,
  };
}

function createHarness(): OverworldPresenceController {
  const controller = new OverworldPresenceController({} as never);
  Object.assign(controller, {
    client: {
      updateLocalPresence: vi.fn(),
    },
  });
  return controller;
}

describe('overworld presence deadlines', () => {
  it('uses movement and idle deadlines without rebuilding every frame', () => {
    const controller = createHarness();
    const idle = createInput();

    expect(controller.isLocalPresenceDue(idle, false, 1_000)).toBe(true);
    controller.updateLocalPresence(idle, 1_000);
    expect(controller.isLocalPresenceDue(idle, false, 5_999)).toBe(false);
    expect(controller.isLocalPresenceDue(idle, false, 6_000)).toBe(true);

    const moving = createInput({ x: 101, velocityX: 80, animationState: 'run' });
    expect(controller.isLocalPresenceDue(moving, false, 1_199)).toBe(false);
    expect(controller.isLocalPresenceDue(moving, false, 1_200)).toBe(true);
  });

  it('forces structural and PvP action changes immediately', () => {
    const controller = createHarness();
    const initial = createInput();
    controller.updateLocalPresence(initial, 1_000);

    expect(controller.isLocalPresenceDue(createInput({
      roomCoordinates: { x: 1, y: 0 },
    }), false, 1_001)).toBe(true);
    expect(controller.isLocalPresenceDue(initial, true, 1_001)).toBe(true);

    const pvp = createInput({
      pvp: { matchId: 'match-1', action: 'sword', actionUntil: 2_000 },
    });
    expect(controller.isLocalPresenceDue(pvp, false, 1_001)).toBe(true);
    controller.updateLocalPresence(pvp, 1_001);
    const movedPvp = createInput({
      x: 101,
      pvp: { matchId: 'match-1', action: 'sword', actionUntil: 2_000 },
    });
    expect(controller.isLocalPresenceDue(movedPvp, false, 1_025)).toBe(false);
    expect(controller.isLocalPresenceDue(movedPvp, false, 1_026)).toBe(true);
  });
});

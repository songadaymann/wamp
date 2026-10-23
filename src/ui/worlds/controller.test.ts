import { describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({ scene: null as Record<string, unknown> | null }));
const context = vi.hoisted(() => ({ setActiveWorldContext: vi.fn() }));
vi.mock('../setup/sceneBridge', () => ({ getActiveOverworldScene: () => bridge.scene }));
vi.mock('../../worlds/clientContext', () => context);
vi.mock('./view', () => ({ WorldsView: class {} }));

import { WorldsController } from './controller';

describe('Worlds warp during a Room Rush', () => {
  it('keeps the current world, since the Rush result would take the jump\'s place', async () => {
    const jumpToCoordinates = vi.fn(async () => false);
    bridge.scene = { jumpToCoordinates, isRoomRushRunActive: () => true };
    const controller = new WorldsController({} as never);
    const setStatus = vi.fn();
    const recordWarp = vi.fn(async () => undefined);
    Object.assign(controller, { view: { setStatus }, repository: { recordWarp } });

    await (controller as unknown as { warp(world: object): Promise<void> }).warp({
      id: 'world-7', number: 7, origin: { x: 0, y: 0 }, sharePath: '/w/7',
    });

    expect(setStatus).toHaveBeenCalledWith('End your Room Rush before warping.', true);
    expect(context.setActiveWorldContext).not.toHaveBeenCalled();
    expect(recordWarp).not.toHaveBeenCalled();
    expect(jumpToCoordinates).not.toHaveBeenCalled();
  });
});

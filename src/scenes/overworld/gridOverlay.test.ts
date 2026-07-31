import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {},
}));

import { OverworldGridOverlayController } from './gridOverlay';

function createHarness() {
  const graphics = {
    setDepth: vi.fn(),
    clear: vi.fn(),
    fillStyle: vi.fn(),
    fillRect: vi.fn(),
    destroy: vi.fn(),
  };
  const getExpandedRoomIdAt = vi.fn(() => null);
  const host = {
    scene: {
      add: { graphics: vi.fn(() => graphics) },
      cameras: {
        main: {
          worldView: {
            left: 0,
            right: 640,
            top: 0,
            bottom: 352,
          },
        },
      },
    },
    getWorldWindow: vi.fn(() => ({})),
    getZoom: vi.fn(() => 2),
    getExpandedRoomIdAt,
  };
  const controller = new OverworldGridOverlayController(host as never);
  controller.create();
  return { controller, getExpandedRoomIdAt, graphics };
}

describe('OverworldGridOverlayController redraw caching', () => {
  it('skips unchanged content and redraws after invalidation', () => {
    const { controller, getExpandedRoomIdAt, graphics } = createHarness();

    controller.redraw();
    const expandedRoomChecks = getExpandedRoomIdAt.mock.calls.length;
    const fillCalls = graphics.fillRect.mock.calls.length;

    controller.redraw();
    expect(getExpandedRoomIdAt).toHaveBeenCalledTimes(expandedRoomChecks);
    expect(graphics.fillRect).toHaveBeenCalledTimes(fillCalls);

    controller.invalidateContent();
    controller.redraw();
    expect(getExpandedRoomIdAt.mock.calls.length).toBeGreaterThan(expandedRoomChecks);
    expect(graphics.fillRect.mock.calls.length).toBeGreaterThan(fillCalls);
  });
});

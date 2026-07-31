import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {},
}));

import { OverworldRuntimeController } from './runtimeController';
import type { SelectedCellState } from './hudViewModel';

function createHydrationHarness(selectedState: SelectedCellState) {
  const host = {
    getMode: vi.fn(() => 'play' as const),
    getCurrentRoomSnapshot: vi.fn(() => null),
    getSelectedCoordinates: vi.fn(() => ({ x: 1, y: 0 })),
    getCellStateAt: vi.fn(() => selectedState),
    setMode: vi.fn(),
    setCameraMode: vi.fn(),
    syncAppMode: vi.fn(),
    syncCameraBoundsUsage: vi.fn(),
    syncGoalRunForRoom: vi.fn(),
    destroyPlayer: vi.fn(),
    syncGhostVisibility: vi.fn(),
  };
  return {
    host,
    controller: new OverworldRuntimeController(
      host as never,
      { edgeWallThickness: 4 },
    ),
  };
}

function createReachabilityHarness(
  neighborState: SelectedCellState,
  roomRushActive = false,
) {
  const host = {
    isRoomTransitionLocked: vi.fn(() => false),
    getExpandedRoomIdAt: vi.fn(() => null),
    getActiveCourseSnapshot: vi.fn(() => null),
    getCellStateAt: vi.fn(() => neighborState),
    getActiveRoomRushRun: vi.fn(() => roomRushActive ? {} : null),
  };
  return new OverworldRuntimeController(
    host as never,
    { edgeWallThickness: 4 },
  );
}

describe('overworld runtime room hydration', () => {
  it.each<SelectedCellState>([
    'published',
    'draft',
    'claimed_unpublished',
  ])('keeps Play mode while a %s room snapshot hydrates', (selectedState) => {
    const { controller, host } = createHydrationHarness(selectedState);

    controller.syncModeRuntime();

    expect(host.setMode).not.toHaveBeenCalled();
    expect(host.setCameraMode).not.toHaveBeenCalled();
    expect(host.syncGoalRunForRoom).not.toHaveBeenCalled();
    expect(host.destroyPlayer).not.toHaveBeenCalled();
  });

  it.each<SelectedCellState>([
    'frontier',
    'empty',
  ])('returns to Browse when the missing room is genuinely %s', (selectedState) => {
    const { controller, host } = createHydrationHarness(selectedState);

    controller.syncModeRuntime();

    expect(host.setMode).toHaveBeenCalledWith('browse');
    expect(host.setCameraMode).toHaveBeenCalledWith('inspect');
    expect(host.syncGoalRunForRoom).toHaveBeenCalledWith(null);
    expect(host.destroyPlayer).toHaveBeenCalledTimes(1);
  });
});

describe('overworld room seam reachability', () => {
  it.each<SelectedCellState>([
    'published',
    'draft',
    'claimed_unpublished',
  ])('allows normal play to enter a %s neighbor', (neighborState) => {
    const controller = createReachabilityHarness(neighborState);

    expect(controller.isNeighborReachable({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(true);
  });

  it.each<SelectedCellState>([
    'frontier',
    'empty',
  ])('keeps a wall against a %s neighbor', (neighborState) => {
    const controller = createReachabilityHarness(neighborState);

    expect(controller.isNeighborReachable({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(false);
  });

  it('keeps Room Rush traversal restricted to published neighbors', () => {
    const controller = createReachabilityHarness('claimed_unpublished', true);

    expect(controller.isNeighborReachable({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(false);
  });
});

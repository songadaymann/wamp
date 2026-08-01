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
  collisionReady = true,
) {
  const host = {
    isRoomTransitionLocked: vi.fn(() => false),
    getExpandedRoomIdAt: vi.fn(() => null),
    getActiveCourseSnapshot: vi.fn(() => null),
    getCellStateAt: vi.fn(() => neighborState),
    getActiveRoomRushRun: vi.fn(() => roomRushActive ? {} : null),
    isPlayableRoomCollisionReady: vi.fn(() => collisionReady),
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

  function createCollisionReadySpawnHarness(options: {
    collisionReady: boolean;
    player?: object | null;
    shouldRespawn?: boolean;
  }) {
    const room = { id: '-2,0', coordinates: { x: -2, y: 0 } };
    const host = {
      getMode: vi.fn(() => 'play' as const),
      getCurrentRoomSnapshot: vi.fn(() => room),
      getPlayer: vi.fn(() => options.player ?? null),
      getPlayerBody: vi.fn(() => options.player ? {} : null),
      getShouldRespawnPlayer: vi.fn(() => options.shouldRespawn ?? false),
      setShouldRespawnPlayer: vi.fn(),
      isPlayableRoomCollisionReady: vi.fn(() => options.collisionReady),
      destroyPlayer: vi.fn(),
      createPlayer: vi.fn(),
      getActiveCourseRun: vi.fn(() => null),
      getActiveRoomRushRun: vi.fn(() => null),
      clearCurrentGoalRun: vi.fn(),
      redrawGoalMarkers: vi.fn(),
      syncGoalRunForRoom: vi.fn(),
      getLoadedFullRooms: vi.fn(() => []),
      syncLiveObjectWorldColliders: vi.fn(),
      syncLiveObjectInteractions: vi.fn(),
      getShouldCenterCamera: vi.fn(() => false),
      setShouldCenterCamera: vi.fn(),
      applyCameraMode: vi.fn(),
      syncGhostVisibility: vi.fn(),
      syncBackdropCameraIgnores: vi.fn(),
    };
    return {
      host,
      controller: new OverworldRuntimeController(host as never, { edgeWallThickness: 4 }),
    };
  }

  it('does not create a gravity-enabled player before current-room collision is ready', () => {
    const { controller, host } = createCollisionReadySpawnHarness({
      collisionReady: false,
      shouldRespawn: true,
    });

    controller.syncModeRuntime();

    expect(host.createPlayer).not.toHaveBeenCalled();
    expect(host.setShouldRespawnPlayer).not.toHaveBeenCalled();
  });

  it('destroys an old warp player while waiting for destination collision', () => {
    const { controller, host } = createCollisionReadySpawnHarness({
      collisionReady: false,
      player: {},
      shouldRespawn: true,
    });

    controller.syncModeRuntime();

    expect(host.destroyPlayer).toHaveBeenCalledTimes(1);
    expect(host.createPlayer).not.toHaveBeenCalled();
    expect(host.setShouldRespawnPlayer).not.toHaveBeenCalled();
  });

  it('creates the player and clears the held respawn once collision is ready', () => {
    const { controller, host } = createCollisionReadySpawnHarness({
      collisionReady: true,
      shouldRespawn: true,
    });

    controller.syncModeRuntime();

    expect(host.destroyPlayer).toHaveBeenCalledTimes(1);
    expect(host.createPlayer).toHaveBeenCalledWith({
      id: '-2,0',
      coordinates: { x: -2, y: 0 },
    });
    expect(host.setShouldRespawnPlayer).toHaveBeenCalledWith(false);
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

  it('keeps the seam closed until a reachable neighbor collider is active', () => {
    const controller = createReachabilityHarness('published', false, false);

    expect(controller.isNeighborReachable({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(true);
    expect(controller.isNeighborTraversalReady({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(false);
  });

  it('opens the seam once the reachable neighbor collider is active', () => {
    const controller = createReachabilityHarness('published', false, true);

    expect(controller.isNeighborTraversalReady({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(true);
  });

  it('keeps an out-of-window seam closed and requests a window refresh', () => {
    const requestWindowRefreshForUnknownNeighbor = vi.fn();
    const getCellStateAt = vi.fn(() => 'published' as const);
    const host = {
      isRoomTransitionLocked: vi.fn(() => false),
      getExpandedRoomIdAt: vi.fn(() => null),
      getActiveCourseSnapshot: vi.fn(() => null),
      getCellStateAt,
      getActiveRoomRushRun: vi.fn(() => null),
      isPlayableRoomCollisionReady: vi.fn(() => false),
      getCurrentRoomCoordinates: vi.fn(() => ({ x: -2, y: 0 })),
      isWithinLoadedRoomBounds: vi.fn(() => false),
      requestWindowRefreshForUnknownNeighbor,
    };
    const controller = new OverworldRuntimeController(host as never, { edgeWallThickness: 4 });

    expect(controller.isNeighborReachable({ x: -2, y: 0 }, { x: -3, y: 0 })).toBe(false);
    expect(requestWindowRefreshForUnknownNeighbor).toHaveBeenCalledWith(
      { x: -2, y: 0 },
      { x: -3, y: 0 },
    );
    expect(getCellStateAt).not.toHaveBeenCalled();
  });

  it('does not recenter the window while reconciling a non-current room edge', () => {
    const requestWindowRefreshForUnknownNeighbor = vi.fn();
    const getCellStateAt = vi.fn(() => 'published' as const);
    const host = {
      isRoomTransitionLocked: vi.fn(() => false),
      getExpandedRoomIdAt: vi.fn(() => null),
      getActiveCourseSnapshot: vi.fn(() => null),
      getCellStateAt,
      getActiveRoomRushRun: vi.fn(() => null),
      isPlayableRoomCollisionReady: vi.fn(() => false),
      getCurrentRoomCoordinates: vi.fn(() => ({ x: -2, y: 0 })),
      isWithinLoadedRoomBounds: vi.fn(() => false),
      requestWindowRefreshForUnknownNeighbor,
    };
    const controller = new OverworldRuntimeController(host as never, { edgeWallThickness: 4 });

    expect(controller.isNeighborReachable({ x: 4, y: 4 }, { x: 5, y: 4 })).toBe(false);
    expect(requestWindowRefreshForUnknownNeighbor).not.toHaveBeenCalled();
    expect(getCellStateAt).not.toHaveBeenCalled();
  });
});

describe('overworld room seam reconciliation', () => {
  it('rebuilds only the changed room and its orthogonal loaded neighbors', () => {
    const loadedRooms = [
      { room: { id: '0,0', coordinates: { x: 0, y: 0 } }, edgeWalls: [] },
      { room: { id: '1,0', coordinates: { x: 1, y: 0 } }, edgeWalls: [] },
      { room: { id: '3,0', coordinates: { x: 3, y: 0 } }, edgeWalls: [] },
    ];
    const host = {
      getLoadedFullRooms: vi.fn(() => loadedRooms),
      destroyRoomEdgeWalls: vi.fn(),
      getPlayerBody: vi.fn(() => null),
      getMode: vi.fn(() => 'play' as const),
      syncBackdropCameraIgnores: vi.fn(),
    };
    const controller = new OverworldRuntimeController(
      host as never,
      { edgeWallThickness: 4 },
    );

    controller.syncEdgeWallsForCoordinates([{ x: 0, y: 0 }]);

    expect(host.destroyRoomEdgeWalls).toHaveBeenCalledTimes(2);
    expect(host.destroyRoomEdgeWalls).toHaveBeenCalledWith(loadedRooms[0]);
    expect(host.destroyRoomEdgeWalls).toHaveBeenCalledWith(loadedRooms[1]);
    expect(host.destroyRoomEdgeWalls).not.toHaveBeenCalledWith(loadedRooms[2]);
    expect(host.syncBackdropCameraIgnores).toHaveBeenCalledTimes(1);
  });

  it('batches backdrop ownership refresh across a full edge-wall rebuild', () => {
    const loadedRooms = [
      { room: { id: '0,0', coordinates: { x: 0, y: 0 } }, edgeWalls: [] },
      { room: { id: '1,0', coordinates: { x: 1, y: 0 } }, edgeWalls: [] },
    ];
    const host = {
      getLoadedFullRooms: vi.fn(() => loadedRooms),
      destroyRoomEdgeWalls: vi.fn(),
      getPlayerBody: vi.fn(() => null),
      getMode: vi.fn(() => 'play' as const),
      syncBackdropCameraIgnores: vi.fn(),
    };
    const controller = new OverworldRuntimeController(
      host as never,
      { edgeWallThickness: 4 },
    );

    controller.syncEdgeWalls();

    expect(host.destroyRoomEdgeWalls).toHaveBeenCalledTimes(2);
    expect(host.syncBackdropCameraIgnores).toHaveBeenCalledTimes(1);
  });
});

describe('overworld focused-room runtime synchronization', () => {
  function createFocusHarness(options: {
    shouldRespawn?: boolean;
    collisionReady?: boolean;
    roomAvailable?: boolean;
  } = {}) {
    const host = {
      getMode: vi.fn(() => 'play' as const),
      getCurrentRoomSnapshot: vi.fn(() => options.roomAvailable === false
        ? null
        : { id: '1,0', coordinates: { x: 1, y: 0 } }),
      getPlayer: vi.fn(() => ({})),
      getPlayerBody: vi.fn(() => ({})),
      getShouldRespawnPlayer: vi.fn(() => options.shouldRespawn ?? false),
      isPlayableRoomCollisionReady: vi.fn(() => options.collisionReady ?? true),
      applyCameraMode: vi.fn(),
      syncGhostVisibility: vi.fn(),
      syncLiveObjectWorldColliders: vi.fn(),
      syncLiveObjectInteractions: vi.fn(),
    };
    const controller = new OverworldRuntimeController(
      host as never,
      { edgeWallThickness: 4 },
    );
    const edgeWallSpy = vi
      .spyOn(controller, 'syncEdgeWallsForCoordinates')
      .mockImplementation(() => undefined);
    return { controller, edgeWallSpy, host };
  }

  it('updates only seams and camera follow for a ready focus change', () => {
    const { controller, edgeWallSpy, host } = createFocusHarness();

    controller.syncFocusedRoomRuntime({ x: 0, y: 0 }, { x: 1, y: 0 });

    expect(edgeWallSpy).toHaveBeenCalledWith([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    expect(host.applyCameraMode).toHaveBeenCalledWith(false);
    expect(host.syncGhostVisibility).not.toHaveBeenCalled();
    expect(host.syncLiveObjectWorldColliders).not.toHaveBeenCalled();
    expect(host.syncLiveObjectInteractions).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'player respawn', options: { shouldRespawn: true } },
    { name: 'missing room hydration', options: { roomAvailable: false } },
    { name: 'missing destination collision', options: { collisionReady: false } },
  ])('falls back to full synchronization for $name', ({ options }) => {
    const { controller, edgeWallSpy } = createFocusHarness(options);
    const fullSyncSpy = vi
      .spyOn(controller, 'syncModeRuntime')
      .mockImplementation(() => undefined);

    controller.syncFocusedRoomRuntime({ x: 0, y: 0 }, { x: 1, y: 0 });

    expect(fullSyncSpy).toHaveBeenCalledTimes(1);
    expect(edgeWallSpy).not.toHaveBeenCalled();
  });
});

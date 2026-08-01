import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {},
}));

import { OverworldRoomTransitionController } from './roomTransition';

function createHarness() {
  const player = {
    x: 600,
    y: 176,
    setPosition: vi.fn((x: number, y: number) => {
      player.x = x;
      player.y = y;
    }),
  };
  const body = {
    width: 16,
    height: 24,
    velocity: { x: 150, y: 0 },
    reset: vi.fn((x: number, y: number) => {
      player.x = x;
      player.y = y;
      body.velocity.x = 0;
      body.velocity.y = 0;
    }),
    setVelocity: vi.fn((x: number, y: number) => {
      body.velocity.x = x;
      body.velocity.y = y;
    }),
  };
  const host = {
    getMode: vi.fn(() => 'play' as const),
    getPlayer: vi.fn(() => player),
    getPlayerBody: vi.fn(() => body),
    getPlayerFacing: vi.fn(() => 1 as const),
    getCurrentRoomCoordinates: vi.fn(() => ({ x: 0, y: 0 })),
    setCurrentRoomCoordinates: vi.fn(),
    setSelectedCoordinates: vi.fn(),
    getWindowCenterCoordinates: vi.fn(() => ({ x: 0, y: 0 })),
    getRoomCoordinatesForPoint: vi.fn((x: number, y: number) => ({
      x: Math.floor(x / 640),
      y: Math.floor(y / 352),
    })),
    isNeighborReachable: vi.fn((
      _roomCoordinates: { x: number; y: number },
      _neighborCoordinates: { x: number; y: number },
    ) => true),
    prefetchPlayableRoomForTransition: vi.fn(),
    clearPredictedPlayableRoomForTransition: vi.fn(),
    preparePlayableRoomForTransition: vi.fn(() => true),
    isRoomTransitionLocked: vi.fn(() => false),
    resetChallengeStateForRoomExit: vi.fn(),
    updateSelectedSummary: vi.fn(),
    getActiveCourseRun: vi.fn(() => null),
    syncGoalRunForRoom: vi.fn(),
    getRoomSnapshotForCoordinates: vi.fn(() => null),
    refreshLeaderboardForSelection: vi.fn(async () => undefined),
    refreshCourseComposerSelectedRoomState: vi.fn(async () => undefined),
    setFocusedCoordinates: vi.fn(),
    getActiveRoomRushRun: vi.fn(() => null),
    recordRoomRushVisit: vi.fn(),
    refreshAround: vi.fn(async () => undefined),
    refreshAroundIfNeededOrFromCache: vi.fn(),
    redrawWorld: vi.fn(),
    renderHud: vi.fn(),
    getRoomOrigin: vi.fn(() => ({ x: 0, y: 0 })),
    clearLadderState: vi.fn(),
    syncPlayerPickupSensor: vi.fn(),
  };
  return {
    body,
    controller: new OverworldRoomTransitionController(host as never),
    host,
    player,
  };
}

describe('overworld room transition hydration', () => {
  it('prefetches and promotes a playable neighbor while approaching its seam', () => {
    const { controller, host } = createHarness();

    controller.maybeAdvancePlayerRoom();

    expect(host.prefetchPlayableRoomForTransition).toHaveBeenCalledWith({ x: 1, y: 0 });
    expect(host.preparePlayableRoomForTransition).toHaveBeenCalledWith({ x: 1, y: 0 });
  });

  it('starts predicted destination preparation from the middle of the room', () => {
    const { controller, host, player } = createHarness();
    player.x = 320;

    controller.maybeAdvancePlayerRoom();

    expect(host.prefetchPlayableRoomForTransition).toHaveBeenCalledWith({ x: 1, y: 0 });
    expect(host.preparePlayableRoomForTransition).not.toHaveBeenCalled();
  });

  it('uses facing to warm one destination while the player is idle', () => {
    const { body, controller, host, player } = createHarness();
    player.x = 320;
    body.velocity.x = 0;

    controller.maybeAdvancePlayerRoom();

    expect(host.prefetchPlayableRoomForTransition).toHaveBeenCalledWith({ x: 1, y: 0 });
    expect(host.preparePlayableRoomForTransition).not.toHaveBeenCalled();
  });

  it('expires predicted intent as soon as no reachable neighbor remains', () => {
    const { body, controller, host } = createHarness();
    controller.maybeAdvancePlayerRoom();
    host.isNeighborReachable.mockReturnValue(false);
    body.velocity.x = 0;

    controller.maybeAdvancePlayerRoom();

    expect(host.clearPredictedPlayableRoomForTransition).toHaveBeenCalledOnce();
  });

  it('replaces predicted intent immediately when movement reverses', () => {
    const { body, controller, host, player } = createHarness();
    player.x = 320;
    controller.maybeAdvancePlayerRoom();
    body.velocity.x = -150;

    controller.maybeAdvancePlayerRoom();

    expect(host.prefetchPlayableRoomForTransition).toHaveBeenNthCalledWith(1, { x: 1, y: 0 });
    expect(host.prefetchPlayableRoomForTransition).toHaveBeenNthCalledWith(2, { x: -1, y: 0 });
    expect(host.clearPredictedPlayableRoomForTransition).not.toHaveBeenCalled();
  });

  it('drops an unresolved old prediction when reversal points at an unreachable room', () => {
    const { body, controller, host, player } = createHarness();
    player.x = 600;
    host.preparePlayableRoomForTransition.mockReturnValue(false);
    host.isNeighborReachable.mockImplementation(
      (_current, neighbor) => neighbor.x >= 0,
    );
    controller.maybeAdvancePlayerRoom();
    body.velocity.x = -150;

    controller.maybeAdvancePlayerRoom();

    expect(host.prefetchPlayableRoomForTransition).toHaveBeenCalledOnce();
    expect(host.prefetchPlayableRoomForTransition).toHaveBeenCalledWith({ x: 1, y: 0 });
    expect(host.clearPredictedPlayableRoomForTransition).toHaveBeenCalledOnce();
  });

  it('holds the player inside the source room until destination collision is ready', () => {
    const { controller, host, player, body } = createHarness();
    controller.maybeAdvancePlayerRoom();
    host.preparePlayableRoomForTransition.mockReturnValue(false);
    player.x = 645;

    controller.maybeAdvancePlayerRoom();

    expect(host.setCurrentRoomCoordinates).not.toHaveBeenCalled();
    expect(body.reset).toHaveBeenLastCalledWith(631, 176);
    expect(player.x).toBe(631);
  });

  it('preserves tangential jump velocity while holding a side seam closed', () => {
    const { body, controller, host, player } = createHarness();
    body.velocity.y = -180;
    controller.maybeAdvancePlayerRoom();
    host.preparePlayableRoomForTransition.mockReturnValue(false);
    player.x = 645;

    controller.maybeAdvancePlayerRoom();

    expect(body.setVelocity).toHaveBeenLastCalledWith(0, -180);
  });

  it('commits a cardinal transition once destination collision is ready', () => {
    const { controller, host, player } = createHarness();
    controller.maybeAdvancePlayerRoom();
    player.x = 645;

    controller.maybeAdvancePlayerRoom();

    expect(host.preparePlayableRoomForTransition).toHaveBeenLastCalledWith({ x: 1, y: 0 });
    expect(host.setCurrentRoomCoordinates).toHaveBeenCalledWith({ x: 1, y: 0 });
    expect(host.refreshAroundIfNeededOrFromCache).toHaveBeenCalledWith(
      { x: 1, y: 0 },
      {
        refreshLeaderboards: false,
        preferCachedWindow: true,
        focusChangeFrom: { x: 0, y: 0 },
      },
    );
  });

  it('restores the last safe transform after a multi-room physics skip', () => {
    const { controller, host, player, body } = createHarness();
    controller.maybeAdvancePlayerRoom();
    player.x = 1_300;

    controller.maybeAdvancePlayerRoom();

    expect(host.setCurrentRoomCoordinates).not.toHaveBeenCalled();
    expect(body.reset).toHaveBeenLastCalledWith(600, 176);
    expect(player.x).toBe(600);
  });

  it('allows an explicitly authorized non-adjacent portal teleport', () => {
    const { controller, host, player } = createHarness();
    controller.maybeAdvancePlayerRoom();
    host.isNeighborReachable.mockReturnValue(false);
    controller.authorizeTeleportTransition({ x: 2, y: 0 });
    player.x = 1_300;

    controller.maybeAdvancePlayerRoom();

    expect(host.preparePlayableRoomForTransition).toHaveBeenLastCalledWith({ x: 2, y: 0 }, true);
    expect(host.setCurrentRoomCoordinates).toHaveBeenCalledWith({ x: 2, y: 0 });
  });

  it('does not let an authorized portal bypass a room-transition lock', () => {
    const { body, controller, host, player } = createHarness();
    controller.maybeAdvancePlayerRoom();
    host.isRoomTransitionLocked.mockReturnValue(true);
    controller.authorizeTeleportTransition({ x: 2, y: 0 });
    player.x = 1_300;

    controller.maybeAdvancePlayerRoom();

    expect(host.setCurrentRoomCoordinates).not.toHaveBeenCalled();
    expect(body.reset).toHaveBeenLastCalledWith(600, 176);
  });

  it('keeps polling a delayed vertical room after the seam wall stops velocity', () => {
    const { body, controller, host, player } = createHarness();
    player.x = 320;
    player.y = 340;
    body.velocity.x = 0;
    body.velocity.y = 150;
    host.preparePlayableRoomForTransition.mockReturnValue(false);

    controller.maybeAdvancePlayerRoom();
    body.velocity.y = 0;
    controller.maybeAdvancePlayerRoom();

    expect(host.preparePlayableRoomForTransition).toHaveBeenCalledTimes(2);
    expect(host.preparePlayableRoomForTransition).toHaveBeenNthCalledWith(2, { x: 0, y: 1 });
  });

  it('expires a stopped vertical prediction after the player moves away from its seam', () => {
    const { body, controller, host, player } = createHarness();
    player.x = 320;
    player.y = 340;
    body.velocity.x = 0;
    body.velocity.y = 150;
    host.preparePlayableRoomForTransition.mockReturnValue(false);
    host.isNeighborReachable.mockImplementation(
      (_current, neighbor) => neighbor.x === 0,
    );

    controller.maybeAdvancePlayerRoom();
    body.velocity.y = 0;
    player.y = 176;
    controller.maybeAdvancePlayerRoom();

    expect(host.prefetchPlayableRoomForTransition).toHaveBeenCalledOnce();
    expect(host.clearPredictedPlayableRoomForTransition).toHaveBeenCalledOnce();
  });

  it('prefetches both corner neighbors but promotes at most one heavy room per update', () => {
    const { body, controller, host, player } = createHarness();
    player.y = 340;
    body.velocity.y = 150;

    controller.maybeAdvancePlayerRoom();

    expect(host.prefetchPlayableRoomForTransition).toHaveBeenCalledWith({ x: 1, y: 0 });
    expect(host.prefetchPlayableRoomForTransition).toHaveBeenCalledWith({ x: 0, y: 1 });
    expect(host.preparePlayableRoomForTransition).toHaveBeenCalledTimes(1);
  });
});

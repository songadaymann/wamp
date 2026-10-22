import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {},
}));

import { createDefaultRoomSnapshot, type RoomSnapshot } from '../../persistence/roomModel';
import { createDefaultCourseSnapshot, type CourseSnapshot } from '../../courses/model';
import type { ExpandedRoomMembershipSummary } from '../../expandedRooms/model';
import { OverworldRoomTransitionController } from './roomTransition';
import {
  PERFORMANCE_ADVISOR_THRESHOLDS,
  RuntimePerformanceAdvisor,
} from '../../performance/performanceAdvisor';

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
    bottomOffsetY: 0,
    get bottom() { return player.y + body.height * 0.5 + body.bottomOffsetY; },
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
    getRoomSnapshotForCoordinates: vi.fn((): RoomSnapshot | null => null),
    getActiveCourseSnapshot: vi.fn((): CourseSnapshot | null => null),
    getExpandedRoomMembershipAt: vi.fn((): ExpandedRoomMembershipSummary | null => null),
    handlePlayerDeath: vi.fn(),
    refreshLeaderboardForSelection: vi.fn(async () => undefined),
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
    recordPerformanceTransitionGate: vi.fn(),
    clearPerformanceTransitionGate: vi.fn(),
    onRoomTransitionCompleted: vi.fn(),
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

  it('keeps one unprepared advisor episode alive across seam clamps and retry frames', () => {
    const { body, controller, host, player } = createHarness();
    const readyAtMs = PERFORMANCE_ADVISOR_THRESHOLDS.startupIgnoreMs;
    const advisor = new RuntimePerformanceAdvisor({ startedAtMs: 0 });
    let now = readyAtMs;
    advisor.tick(now);
    host.preparePlayableRoomForTransition.mockReturnValue(false);
    host.recordPerformanceTransitionGate.mockImplementation((reason, from, to) => {
      advisor.recordTransitionGate({
        atMs: now,
        fromRoomId: `${from.x},${from.y}`,
        toRoomId: `${to.x},${to.y}`,
        reason,
        generation: 1,
        progressRevision: 0,
        urgentWorkQueued: true,
        schedulerStarved: true,
      });
    });
    host.clearPerformanceTransitionGate.mockImplementation(() => {
      advisor.clearTransitionGate(now);
    });

    controller.maybeAdvancePlayerRoom();
    player.x = 645;
    controller.maybeAdvancePlayerRoom();

    now += 250;
    body.velocity.x = 0;
    controller.maybeAdvancePlayerRoom();
    now += 250;
    body.velocity.x = 150;
    player.x = 645;
    controller.maybeAdvancePlayerRoom();
    now = readyAtMs + PERFORMANCE_ADVISOR_THRESHOLDS.transitionStallMs - 1;
    body.velocity.x = 0;
    controller.maybeAdvancePlayerRoom();
    advisor.tick(now);

    expect(advisor.getSuggestion()).toBeNull();
    expect(host.clearPerformanceTransitionGate).not.toHaveBeenCalled();

    now += 1;
    body.velocity.x = 150;
    player.x = 645;
    controller.maybeAdvancePlayerRoom();

    expect(advisor.getSuggestion()?.reason).toBe('transition-starvation');
    expect(host.recordPerformanceTransitionGate).toHaveBeenCalledTimes(3);
    expect(host.clearPerformanceTransitionGate).not.toHaveBeenCalled();
  });

  it('clears an unprepared episode only after the player abandons that seam', () => {
    const { body, controller, host, player } = createHarness();
    host.preparePlayableRoomForTransition.mockReturnValue(false);

    controller.maybeAdvancePlayerRoom();
    player.x = 645;
    controller.maybeAdvancePlayerRoom();
    expect(host.clearPerformanceTransitionGate).not.toHaveBeenCalled();

    player.x = 500;
    body.velocity.x = -150;
    controller.maybeAdvancePlayerRoom();
    controller.maybeAdvancePlayerRoom();

    expect(host.clearPerformanceTransitionGate).toHaveBeenCalledOnce();
  });

  it('clears an unprepared episode when a source-room retry becomes ready', () => {
    const { body, controller, host, player } = createHarness();
    host.preparePlayableRoomForTransition.mockReturnValue(false);

    controller.maybeAdvancePlayerRoom();
    player.x = 645;
    controller.maybeAdvancePlayerRoom();
    expect(host.clearPerformanceTransitionGate).not.toHaveBeenCalled();

    host.preparePlayableRoomForTransition.mockReturnValue(true);
    body.velocity.x = 0;
    controller.maybeAdvancePlayerRoom();

    expect(host.clearPerformanceTransitionGate).toHaveBeenCalledOnce();
  });

  it('lets a non-unprepared gate reason clear the advisor episode itself', () => {
    const { body, controller, host, player } = createHarness();
    host.preparePlayableRoomForTransition.mockReturnValue(false);

    controller.maybeAdvancePlayerRoom();
    player.x = 645;
    controller.maybeAdvancePlayerRoom();

    host.isRoomTransitionLocked.mockReturnValue(true);
    body.velocity.x = 150;
    player.x = 645;
    controller.maybeAdvancePlayerRoom();

    expect(host.recordPerformanceTransitionGate).toHaveBeenLastCalledWith(
      'locked',
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    );
    expect(host.clearPerformanceTransitionGate).not.toHaveBeenCalled();
  });

  it('replaces a retry episode with an unreachable gate through the advisor', () => {
    const { body, controller, host, player } = createHarness();
    host.preparePlayableRoomForTransition.mockReturnValue(false);

    controller.maybeAdvancePlayerRoom();
    player.x = 645;
    controller.maybeAdvancePlayerRoom();

    host.isNeighborReachable.mockReturnValue(false);
    body.velocity.x = 0;
    controller.maybeAdvancePlayerRoom();

    expect(host.recordPerformanceTransitionGate).toHaveBeenLastCalledWith(
      'unreachable',
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    );
    expect(host.clearPerformanceTransitionGate).not.toHaveBeenCalled();
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


describe('opt-in bottom falls before navigation', () => {
  it.each([true, false])('kills even when the lower room readiness is %s, retaining the active room', ready => {
    const { controller, host, player, body } = createHarness();
    host.getRoomSnapshotForCoordinates.mockReturnValue({ ...createDefaultRoomSnapshot(), pitsAreDeadly: true });
    host.isNeighborReachable.mockReturnValue(ready);
    host.preparePlayableRoomForTransition.mockReturnValue(ready);
    player.y = 353; body.velocity.y = 400;
    controller.maybeAdvancePlayerRoom();
    expect(host.handlePlayerDeath).toHaveBeenCalledExactlyOnceWith('You fell.', true);
    expect(host.resetChallengeStateForRoomExit).not.toHaveBeenCalled();
    expect(host.preparePlayableRoomForTransition).not.toHaveBeenCalled();
    expect(host.setCurrentRoomCoordinates).not.toHaveBeenCalled();
  });
  it('detects feet at the seam even if a lower top-row platform catches the body', () => {
    const { controller, host, player, body } = createHarness();
    host.getRoomSnapshotForCoordinates.mockReturnValue({ ...createDefaultRoomSnapshot(), pitsAreDeadly: true });
    player.y = 334; body.bottomOffsetY = 6; body.velocity.y = 0;
    controller.maybeAdvancePlayerRoom();
    expect(host.handlePlayerDeath).toHaveBeenCalledExactlyOnceWith('You fell.', true);
    expect(host.resetChallengeStateForRoomExit).not.toHaveBeenCalled();
  });
  it('preserves ordinary downward navigation with pits disabled', () => {
    const { controller, host, player } = createHarness();
    host.getRoomSnapshotForCoordinates.mockReturnValue(createDefaultRoomSnapshot()); player.y = 353;
    controller.maybeAdvancePlayerRoom();
    expect(host.handlePlayerDeath).not.toHaveBeenCalled();
    expect(host.setCurrentRoomCoordinates).toHaveBeenCalledWith({ x: 0, y: 1 });
  });
  it('preserves an internal vertical drop with the root setting enabled', () => {
    const { controller, host, player } = createHarness();
    const course = createDefaultCourseSnapshot('vertical'); course.pitsAreDeadly = true;
    course.roomRefs = [0, 1].map(y => ({ roomId: `0,${y}`, coordinates: { x: 0, y }, roomVersion: 1, roomTitle: null }));
    host.getActiveCourseSnapshot.mockReturnValue(course);
    host.getRoomSnapshotForCoordinates.mockReturnValue(createDefaultRoomSnapshot()); player.y = 353;
    controller.maybeAdvancePlayerRoom();
    expect(host.handlePlayerDeath).not.toHaveBeenCalled();
    expect(host.setCurrentRoomCoordinates).toHaveBeenCalledWith({ x: 0, y: 1 });
  });
  it('allows an authorized downward portal to bypass the natural-fall rule', () => {
    const { controller, host, player } = createHarness();
    host.getRoomSnapshotForCoordinates.mockReturnValue({ ...createDefaultRoomSnapshot(), pitsAreDeadly: true });
    controller.authorizeTeleportTransition({ x: 0, y: 1 }); player.y = 353;
    controller.maybeAdvancePlayerRoom();
    expect(host.handlePlayerDeath).not.toHaveBeenCalled();
    expect(host.preparePlayableRoomForTransition).toHaveBeenCalledWith({ x: 0, y: 1 }, true);
    expect(host.setCurrentRoomCoordinates).toHaveBeenCalledWith({ x: 0, y: 1 });
  });
});

describe('transition prediction follows reachable seams (F350)', () => {
  const FRAME_SECONDS = 1 / 60;
  const GRAVITY = 700;
  const LOW_FLOOR_FEET_Y = 352 - 16;

  function createPhysicalHarness() {
    const harness = createHarness();
    const physicalBody = Object.assign(harness.body, {
      allowGravity: true,
      gravity: { y: 0 },
      world: { gravity: { y: GRAVITY } },
      blocked: { up: false, down: false },
      get top() { return harness.player.y - harness.body.height * 0.5; },
    });
    const requested = (coordinates: { x: number; y: number }) =>
      harness.host.prefetchPlayableRoomForTransition.mock.calls
        .filter(([call]) => call.x === coordinates.x && call.y === coordinates.y).length;
    const stand = (feetY: number) => {
      harness.player.y = feetY - physicalBody.height * 0.5;
      physicalBody.velocity.y = 0;
      physicalBody.blocked.down = true;
    };
    // One 60 Hz Arcade step: integrate gravity, then land on `floorFeetY`.
    const step = (floorFeetY: number) => {
      physicalBody.blocked.down = false;
      physicalBody.velocity.y += GRAVITY * FRAME_SECONDS;
      harness.player.x += physicalBody.velocity.x * FRAME_SECONDS;
      harness.player.y += physicalBody.velocity.y * FRAME_SECONDS;
      if (physicalBody.bottom >= floorFeetY && physicalBody.velocity.y > 0) stand(floorFeetY);
      harness.controller.maybeAdvancePlayerRoom();
    };
    return { ...harness, physicalBody, requested, stand, step };
  }

  it('drops the room below after landing on a low floor and keeps the room ahead', () => {
    const { host, physicalBody, player, requested, step } = createPhysicalHarness();
    host.preparePlayableRoomForTransition.mockReturnValue(false);
    player.x = 300;
    player.y = 300;
    physicalBody.velocity.y = 120;

    for (let frame = 0; frame < 60 && !physicalBody.blocked.down; frame += 1) step(LOW_FLOOR_FEET_Y);
    expect(physicalBody.blocked.down).toBe(true);
    expect(requested({ x: 0, y: 1 })).toBeGreaterThan(0);
    host.prefetchPlayableRoomForTransition.mockClear();
    host.preparePlayableRoomForTransition.mockClear();

    for (let frame = 0; frame < 30; frame += 1) step(LOW_FLOOR_FEET_Y);

    expect(requested({ x: 0, y: 1 })).toBe(0);
    expect(requested({ x: 1, y: 0 })).toBe(30);
    expect(host.preparePlayableRoomForTransition).not.toHaveBeenCalledWith({ x: 0, y: 1 });
  });

  it('keeps the room ahead through a running hop that cannot reach another room', () => {
    const { host, physicalBody, player, requested, stand, step } = createPhysicalHarness();
    player.x = 200;
    stand(LOW_FLOOR_FEET_Y);
    for (let frame = 0; frame < 5; frame += 1) step(LOW_FLOOR_FEET_Y);

    physicalBody.velocity.y = -280;
    let airborneFrames = 0;
    do {
      step(LOW_FLOOR_FEET_Y);
      airborneFrames += 1;
    } while (!physicalBody.blocked.down && airborneFrames < 120);

    expect(airborneFrames).toBeGreaterThan(40);
    expect(requested({ x: 0, y: -1 })).toBe(0);
    expect(requested({ x: 0, y: 1 })).toBe(0);
    expect(requested({ x: 1, y: 0 })).toBe(5 + airborneFrames);
    expect(host.clearPredictedPlayableRoomForTransition).not.toHaveBeenCalled();
  });

  it('keeps the facing room through a standing hop', () => {
    const { host, physicalBody, requested, stand, step } = createPhysicalHarness();
    physicalBody.velocity.x = 0;
    stand(200);
    step(200);
    physicalBody.velocity.y = -280;
    for (let frame = 0; frame < 20; frame += 1) step(200);

    expect(requested({ x: 1, y: 0 })).toBe(21);
    expect(requested({ x: 0, y: -1 })).toBe(0);
    expect(host.clearPredictedPlayableRoomForTransition).not.toHaveBeenCalled();
  });

  it.each([
    ['a spring launch from mid-room', 176, -700],
    ['a normal jump just under the top seam', 50, -280],
  ])('still predicts the room above for %s', (_label, centerY, launchVelocity) => {
    const { physicalBody, requested, stand, step } = createPhysicalHarness();
    stand(centerY + 12);
    step(centerY + 12);
    physicalBody.velocity.y = launchVelocity;

    step(centerY + 12);

    expect(requested({ x: 0, y: -1 })).toBe(1);
  });

  it('predicts the room below once a run carries the player off a ledge', () => {
    const { physicalBody, requested, stand, step } = createPhysicalHarness();
    stand(200);
    step(200);
    expect(requested({ x: 0, y: 1 })).toBe(0);

    for (let frame = 0; frame < 12; frame += 1) step(Number.POSITIVE_INFINITY);

    expect(physicalBody.velocity.y).toBeGreaterThan(0);
    expect(requested({ x: 0, y: 1 })).toBeGreaterThan(0);
  });

  it('keeps polling the room below while the player stands on its seam edge wall', () => {
    const { controller, host, physicalBody, player, stand } = createPhysicalHarness();
    host.preparePlayableRoomForTransition.mockReturnValue(false);
    host.isNeighborReachable.mockImplementation((_current, neighbor) => neighbor.x === 0);
    player.x = 320;
    player.y = 320;
    physicalBody.velocity.x = 0;
    physicalBody.velocity.y = 150;

    controller.maybeAdvancePlayerRoom();
    stand(352 - 12);
    controller.maybeAdvancePlayerRoom();
    controller.maybeAdvancePlayerRoom();

    expect(host.preparePlayableRoomForTransition).toHaveBeenCalledTimes(3);
    expect(host.preparePlayableRoomForTransition).toHaveBeenLastCalledWith({ x: 0, y: 1 });
  });

  it('keeps swimming predictions on the direction of travel', () => {
    const { host, physicalBody, requested, step } = createPhysicalHarness();
    Object.assign(host, {
      getPlayerGravityEnvironment: vi.fn(() => ({ gravityDirection: 'down' as const, inWater: true })),
    });
    physicalBody.velocity.x = 0;
    physicalBody.velocity.y = -168;

    step(Number.POSITIVE_INFINITY);

    expect(requested({ x: 0, y: -1 })).toBe(1);
  });
});

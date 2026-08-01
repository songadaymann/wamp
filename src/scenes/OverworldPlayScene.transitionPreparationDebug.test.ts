import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import { OverworldPlayScene } from './OverworldPlayScene';

describe('OverworldPlayScene transition preparation debug action', () => {
  it('stages an explicit cardinal neighbor through a retained activation owner', () => {
    const preparePortalTargetRoomForTransition = vi.fn(() => false);
    const harness = Object.assign(
      Object.create(OverworldPlayScene.prototype),
      {
        currentRoomCoordinates: { x: 5, y: 7 },
        mode: 'play',
        worldStreamingController: {
          preparePortalTargetRoomForTransition,
        },
      },
    );

    expect(harness.debugPrepareTransitionDestination('5,6')).toEqual({
      ok: true,
      roomId: '5,6',
      coordinates: { x: 5, y: 6 },
      collisionReady: false,
    });
    expect(preparePortalTargetRoomForTransition).toHaveBeenCalledWith({ x: 5, y: 6 });
  });

  it('rejects malformed and non-neighbor room ids', () => {
    const harness = Object.assign(
      Object.create(OverworldPlayScene.prototype),
      {
        currentRoomCoordinates: { x: 5, y: 7 },
        mode: 'play',
        worldStreamingController: {
          preparePortalTargetRoomForTransition: vi.fn(),
        },
      },
    );

    expect(harness.debugPrepareTransitionDestination('bad')).toEqual({
      ok: false,
      reason: 'invalid-room-id',
    });
    expect(harness.debugPrepareTransitionDestination('7,7')).toEqual({
      ok: false,
      reason: 'destination-not-cardinal-neighbor',
    });
  });

  it('releases the retained preparation owner by normalized room id', () => {
    const clearPortalTargetRoomPreparation = vi.fn();
    const harness = Object.assign(
      Object.create(OverworldPlayScene.prototype),
      {
        worldStreamingController: { clearPortalTargetRoomPreparation },
      },
    );

    expect(harness.debugClearTransitionDestinationPreparation('05,07')).toEqual({
      ok: true,
      roomId: '5,7',
    });
    expect(clearPortalTargetRoomPreparation).toHaveBeenCalledWith('5,7');
  });
});

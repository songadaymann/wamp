import { describe, expect, it, vi } from 'vitest';
import type { OverworldRuntimeTransitionProbe } from '../scenes/OverworldPlayScene';
import { getRuntimeTransitionProbe } from './runtimeTransitionProbe';

describe('getRuntimeTransitionProbe', () => {
  it('reads only the dedicated constant-size scene probe', () => {
    const probe: OverworldRuntimeTransitionProbe = {
      scene: 'overworld-play',
      mode: 'play',
      currentRoomId: '5,7',
      selectedRoomId: '5,7',
      destinationRoomId: '6,7',
      destinationLoaded: true,
      destinationPreparationIdentity: null,
      destinationPreparationPhase: null,
      destinationDormantReady: false,
      currentFullRoomLoaded: true,
      currentCollisionReady: true,
      currentTerrainColliderActive: true,
      player: {
        x: 3_830,
        y: 2_755,
        velocityX: 150,
        velocityY: 0,
        bodyWidth: 10,
        bodyHeight: 26,
      },
    };
    const getRuntimeTransitionProbeForScene = vi.fn(() => probe);
    const game = {
      scene: {
        isActive: vi.fn(() => true),
        getScene: vi.fn(() => ({
          getRuntimeTransitionProbe: getRuntimeTransitionProbeForScene,
          describeState: vi.fn(() => {
            throw new Error('full debug state must not be read');
          }),
        })),
      },
    };

    expect(getRuntimeTransitionProbe(game as never, '6,7')).toBe(probe);
    expect(getRuntimeTransitionProbeForScene).toHaveBeenCalledWith('6,7');
  });

  it('returns null without reading a dormant scene', () => {
    const getScene = vi.fn();
    const game = {
      scene: {
        isActive: vi.fn(() => false),
        getScene,
      },
    };

    expect(getRuntimeTransitionProbe(game as never, '6,7')).toBeNull();
    expect(getScene).not.toHaveBeenCalled();
  });
});

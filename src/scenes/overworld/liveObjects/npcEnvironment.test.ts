import { describe, expect, it } from 'vitest';
import {
  getNpcEnvironmentalObjectInteraction,
  resolveNpcRoomBoundaryCorrection,
  resolveNpcHorizontalVelocity,
} from './npcEnvironment';

describe('NPC environmental object interactions', () => {
  it('separates forces from lethal hazards', () => {
    expect(getNpcEnvironmentalObjectInteraction({
      id: 'tornado',
      category: 'interactive',
    })).toBe('tornado');
    expect(getNpcEnvironmentalObjectInteraction({
      id: 'quicksand',
      category: 'hazard',
    })).toBe('quicksand');
    expect(getNpcEnvironmentalObjectInteraction({
      id: 'spikes',
      category: 'hazard',
    })).toBe('lethal');
    expect(getNpcEnvironmentalObjectInteraction({
      id: 'slime_blue',
      category: 'enemy',
    })).toBe('lethal');
  });
});

describe('NPC special-tile movement', () => {
  const baseInput = {
    currentVelocityX: 0,
    directionX: 1,
    baseSpeed: 70,
    deltaMs: 16,
    walking: true,
    externallyLaunched: false,
    onIce: false,
    onSticky: false,
    inQuicksand: false,
    windX: 0 as const,
  };

  it('slows walking on sticky tiles and quicksand', () => {
    expect(resolveNpcHorizontalVelocity({
      ...baseInput,
      onSticky: true,
    })).toBeCloseTo(33.6);
    expect(resolveNpcHorizontalVelocity({
      ...baseInput,
      inQuicksand: true,
    })).toBeCloseTo(39.2);
  });

  it('coasts instead of stopping immediately on ice', () => {
    expect(resolveNpcHorizontalVelocity({
      ...baseInput,
      currentVelocityX: 70,
      walking: false,
      onIce: true,
    })).toBeCloseTo(68.95);
  });

  it('preserves a tornado or bounce launch while airborne', () => {
    expect(resolveNpcHorizontalVelocity({
      ...baseInput,
      currentVelocityX: 240,
      externallyLaunched: true,
    })).toBe(240);
  });
});

describe('NPC room boundary containment', () => {
  const roomBounds = {
    left: 0,
    right: 640,
    top: 0,
    bottom: 352,
  };

  it('pushes a wandering NPC back inside a horizontal room edge', () => {
    expect(resolveNpcRoomBoundaryCorrection({
      roomBounds,
      bodyBounds: {
        left: 638,
        right: 662,
        top: 96,
        bottom: 112,
      },
      velocityX: 70,
      velocityY: 0,
    })).toEqual({
      deltaX: -23,
      deltaY: 0,
      hitLeft: false,
      hitRight: true,
      hitTop: false,
      hitBottom: false,
    });
  });

  it('stops downward movement at the bottom edge instead of entering the room below', () => {
    expect(resolveNpcRoomBoundaryCorrection({
      roomBounds,
      bodyBounds: {
        left: 120,
        right: 144,
        top: 344,
        bottom: 360,
      },
      velocityX: 0,
      velocityY: 180,
    })).toEqual({
      deltaX: 0,
      deltaY: -9,
      hitLeft: false,
      hitRight: false,
      hitTop: false,
      hitBottom: true,
    });
  });

  it('does nothing while the NPC remains inside its room', () => {
    expect(resolveNpcRoomBoundaryCorrection({
      roomBounds,
      bodyBounds: {
        left: 120,
        right: 144,
        top: 96,
        bottom: 112,
      },
      velocityX: 70,
      velocityY: 0,
    })).toBeNull();
  });

  it('blocks outward velocity when the NPC is already touching an edge', () => {
    expect(resolveNpcRoomBoundaryCorrection({
      roomBounds,
      bodyBounds: {
        left: 615,
        right: 639,
        top: 96,
        bottom: 112,
      },
      velocityX: 70,
      velocityY: 0,
    })).toEqual({
      deltaX: 0,
      deltaY: 0,
      hitLeft: false,
      hitRight: true,
      hitTop: false,
      hitBottom: false,
    });
  });
});

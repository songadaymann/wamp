import { describe, expect, it } from 'vitest';
import {
  getNpcEnvironmentalObjectInteraction,
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

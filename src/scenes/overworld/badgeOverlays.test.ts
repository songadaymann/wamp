import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Math: {
      Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
      Linear: (start: number, end: number, amount: number) => start + (end - start) * amount,
    },
  },
}));

import {
  syncBadgePlacements,
  type OverworldBadgePlacement,
  type RoomBadgeScaleConfig,
} from './badgeOverlays';

const config: RoomBadgeScaleConfig = {
  hideZoom: 0.1,
  fadeStartZoom: 0.5,
  scaleFullZoom: 1,
  layoutFullZoom: 1,
  minScreenScale: 0.5,
  maxScreenScale: 1,
  dotTierMaxZoom: 0.4,
  compactTierMaxZoom: 0.8,
  tierFadeSpan: 0.1,
};

describe('syncBadgePlacements', () => {
  it('accepts a map-values iterable without materializing an array', () => {
    const container = {
      setPosition: vi.fn(),
      setScale: vi.fn(),
      setAlpha: vi.fn(),
      setVisible: vi.fn(),
    };
    const badges = new Map<string, OverworldBadgePlacement>([
      ['badge', {
        container: container as never,
        zoomedInPosition: { x: 20, y: 30 },
        zoomedOutPosition: { x: 10, y: 15 },
      }],
    ]);

    syncBadgePlacements(badges.values(), 1, config);

    expect(container.setPosition).toHaveBeenCalledWith(20, 30);
    expect(container.setVisible).toHaveBeenCalledWith(true);
  });
});

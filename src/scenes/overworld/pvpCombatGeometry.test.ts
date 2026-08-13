import { describe, expect, it } from 'vitest';
import {
  createPvpGhostBodyRect,
  createPvpGhostHitRect,
  createPvpPointHitRect,
  createPvpRemoteActionDamageRect,
  isPvpStompContact,
  isPvpStompVerticalContact,
  pvpCombatRectsIntersect,
  resolvePvpPeerCollision,
} from './pvpCombatGeometry';

describe('PvP combat geometry', () => {
  it('preserves body, inflated hit, and point-hit geometry', () => {
    const body = createPvpGhostBodyRect({
      x: 100,
      feetY: 220,
      playerWidth: 18,
      playerHeight: 30,
    });

    expect(body).toEqual({ x: 91, y: 190, width: 18, height: 30 });
    expect(createPvpGhostHitRect(body)).toEqual({ x: 79, y: 182, width: 42, height: 46 });
    expect(createPvpPointHitRect(100, 200)).toEqual({ x: 96, y: 197, width: 8, height: 6 });
    expect(pvpCombatRectsIntersect(createPvpPointHitRect(100, 200), body)).toBe(true);
  });

  it('builds the exact sword, downward sword, and gun damage envelopes', () => {
    const body = { x: 91, y: 190, width: 18, height: 30 };

    expect(createPvpRemoteActionDamageRect({ bodyRect: body, facing: 1, action: 'sword' }))
      .toEqual({ x: 80, y: 184, width: 56, height: 56 });
    expect(createPvpRemoteActionDamageRect({
      bodyRect: body,
      facing: -1,
      action: 'sword',
      downward: true,
    })).toEqual({ x: 74, y: 210, width: 52, height: 44 });
    expect(createPvpRemoteActionDamageRect({ bodyRect: body, facing: -1, action: 'gun' }))
      .toEqual({ x: 4, y: 189, width: 104, height: 32 });
  });

  it('requires descending top contact and preserves the ten-pixel stomp tolerance', () => {
    const targetRect = { x: 100, y: 100, width: 20, height: 30 };

    expect(isPvpStompContact({
      playerRect: { x: 102, y: 75, width: 16, height: 30 },
      targetRect,
      playerVelocityY: 41,
    })).toBe(true);
    expect(isPvpStompContact({
      playerRect: { x: 102, y: 75, width: 16, height: 30 },
      targetRect,
      playerVelocityY: 40,
    })).toBe(false);
    expect(isPvpStompContact({
      playerRect: { x: 88, y: 75, width: 10, height: 30 },
      targetRect,
      playerVelocityY: 80,
    })).toBe(false);
    expect(isPvpStompVerticalContact({
      playerRect: { x: 88, y: 75, width: 10, height: 30 },
      targetRect,
      playerVelocityY: 80,
    })).toBe(true);
    expect(isPvpStompContact({
      playerRect: { x: 102, y: 81, width: 16, height: 30 },
      targetRect,
      playerVelocityY: 80,
    })).toBe(false);
  });

  it('separates falling players vertically and side collisions horizontally', () => {
    expect(resolvePvpPeerCollision({
      playerRect: { x: 100, y: 80, width: 20, height: 24 },
      targetRect: { x: 104, y: 100, width: 20, height: 30 },
      velocity: { x: 30, y: 90 },
    })).toEqual({ offsetX: 0, offsetY: -4.5, velocityX: 30, velocityY: 0 });

    expect(resolvePvpPeerCollision({
      playerRect: { x: 90, y: 100, width: 20, height: 30 },
      targetRect: { x: 104, y: 100, width: 20, height: 30 },
      velocity: { x: 55, y: 0 },
    })).toEqual({ offsetX: -6.5, offsetY: 0, velocityX: 0, velocityY: 0 });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { playPlayerAnimationIfReady } from './playerAnimation';

function createFrame(): Record<string, unknown> {
  return {
    duration: 0,
    frame: {
      texture: {},
    },
  };
}

function createSprite(animationKey: string, frames: Array<Record<string, unknown>>) {
  const animation: Record<string, unknown> = {
    key: animationKey,
    frames,
    getTotalFrames: vi.fn(() => frames.length),
  };
  const animationManager = {
    exists: vi.fn(() => true),
    get: vi.fn(() => animation),
  };
  animation.manager = animationManager;

  return {
    sprite: {
      anims: { animationManager },
      play: vi.fn(),
    },
    animationManager,
  };
}

describe('playPlayerAnimationIfReady', () => {
  it('does not ask Phaser to play a registered animation with no frames', () => {
    const { sprite } = createSprite('player-default-idle', []);

    expect(playPlayerAnimationIfReady(sprite as never, 'player-default-idle')).toBe(false);
    expect(sprite.play).not.toHaveBeenCalled();
  });

  it('plays a complete animation and preserves the ignore-if-playing option', () => {
    const { sprite } = createSprite('player-default-run', [createFrame()]);

    expect(playPlayerAnimationIfReady(sprite as never, 'player-default-run', true)).toBe(true);
    expect(sprite.play).toHaveBeenCalledWith('player-default-run', true);
  });
});

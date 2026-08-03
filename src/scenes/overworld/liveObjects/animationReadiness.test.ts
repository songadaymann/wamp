import { describe, expect, it, vi } from 'vitest';
import { isAnimationSafelyPlayable } from './animationReadiness';

interface AnimationManagerStub {
  exists: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
}

function createManager(animation?: Record<string, unknown>): AnimationManagerStub {
  const manager: AnimationManagerStub = {
    exists: vi.fn(() => animation !== undefined),
    get: vi.fn(() => animation),
  };

  if (animation) {
    animation.manager = manager;
  }

  return manager;
}

function createFrame(duration = 0): Record<string, unknown> {
  return {
    duration,
    frame: {
      texture: {},
    },
  };
}

function createAnimation(
  key: string,
  frames: Array<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    key,
    frames,
    getTotalFrames: vi.fn(() => frames.length),
  };
}

describe('isAnimationSafelyPlayable', () => {
  it('rejects a missing animation without attempting to retrieve it', () => {
    const manager = createManager();

    expect(isAnimationSafelyPlayable(manager as never, 'coin_gold_anim')).toBe(false);
    expect(manager.exists).toHaveBeenCalledWith('coin_gold_anim');
    expect(manager.get).not.toHaveBeenCalled();
  });

  it('rejects a registered animation with no frames', () => {
    const animation = createAnimation('coin_gold_anim', []);
    const manager = createManager(animation);

    expect(isAnimationSafelyPlayable(manager as never, 'coin_gold_anim')).toBe(false);
  });

  it('rejects a destroyed animation even if a stale manager still returns it', () => {
    const animation = createAnimation('coin_gold_anim', [createFrame()]);
    const manager = createManager(animation);
    animation.manager = null;

    expect(isAnimationSafelyPlayable(manager as never, 'coin_gold_anim')).toBe(false);
  });

  it('rejects an animation containing a destroyed or otherwise invalid frame', () => {
    const destroyedFrame = createFrame();
    destroyedFrame.frame = undefined;
    const animation = createAnimation('coin_gold_anim', [destroyedFrame]);
    const manager = createManager(animation);

    expect(isAnimationSafelyPlayable(manager as never, 'coin_gold_anim')).toBe(false);
  });

  it('accepts a current animation with nonempty, usable frames', () => {
    const frames = [createFrame(), createFrame(25)];
    const animation = createAnimation('coin_gold_anim', frames);
    const manager = createManager(animation);

    expect(isAnimationSafelyPlayable(manager as never, 'coin_gold_anim')).toBe(true);
    expect(animation.getTotalFrames).toHaveBeenCalledTimes(1);
  });
});

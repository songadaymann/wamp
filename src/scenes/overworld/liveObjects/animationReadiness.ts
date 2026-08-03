import type Phaser from 'phaser';

type AnimationManagerLookup = Pick<Phaser.Animations.AnimationManager, 'exists' | 'get'>;

interface RuntimeAnimationShape {
  key?: unknown;
  manager?: unknown;
  frames?: unknown;
  getTotalFrames?: unknown;
}

interface RuntimeAnimationFrameShape {
  duration?: unknown;
  frame?: unknown;
}

interface RuntimeTextureFrameShape {
  texture?: unknown;
}

function isUsableAnimationFrame(candidate: unknown): boolean {
  if (!candidate || typeof candidate !== 'object') {
    return false;
  }

  const animationFrame = candidate as RuntimeAnimationFrameShape;
  if (
    typeof animationFrame.duration !== 'number'
    || !Number.isFinite(animationFrame.duration)
    || animationFrame.duration < 0
  ) {
    return false;
  }

  if (!animationFrame.frame || typeof animationFrame.frame !== 'object') {
    return false;
  }

  const textureFrame = animationFrame.frame as RuntimeTextureFrameShape;
  return Boolean(textureFrame.texture && typeof textureFrame.texture === 'object');
}

/**
 * Returns true only when a registered global animation still has the runtime
 * data Phaser dereferences while starting and advancing playback.
 *
 * Phaser can retain an animation key whose spritesheet produced no frames, and
 * destroyed AnimationFrames retain their wrapper while dropping `frame`. Both
 * states pass AnimationManager.exists but throw when Sprite.play is called.
 */
export function isAnimationSafelyPlayable(
  animationManager: AnimationManagerLookup | null | undefined,
  animationKey: string,
): boolean {
  if (!animationManager || animationKey.length === 0) {
    return false;
  }

  try {
    if (!animationManager.exists(animationKey)) {
      return false;
    }

    const animation = animationManager.get(animationKey);
    if (!animation || typeof animation !== 'object') {
      return false;
    }

    const runtimeAnimation = animation as unknown as RuntimeAnimationShape;
    if (
      runtimeAnimation.key !== animationKey
      || runtimeAnimation.manager !== animationManager
      || !Array.isArray(runtimeAnimation.frames)
      || typeof runtimeAnimation.getTotalFrames !== 'function'
    ) {
      return false;
    }

    const totalFrames = runtimeAnimation.getTotalFrames.call(animation);
    if (
      !Number.isSafeInteger(totalFrames)
      || totalFrames <= 0
      || totalFrames !== runtimeAnimation.frames.length
    ) {
      return false;
    }

    return runtimeAnimation.frames.every(isUsableAnimationFrame);
  } catch {
    // Treat partially torn-down managers and animation getters as unavailable.
    return false;
  }
}

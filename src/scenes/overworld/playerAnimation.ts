import type Phaser from 'phaser';
import { isAnimationSafelyPlayable } from './liveObjects/animationReadiness';

/**
 * Starts a player animation only when Phaser still has a complete runtime
 * animation. A dev reload or failed atlas can leave a registered key with no
 * usable frames; calling Sprite.play in that state throws before Play begins.
 */
export function playPlayerAnimationIfReady(
  sprite: Phaser.GameObjects.Sprite,
  animationKey: string,
  ignoreIfPlaying = false,
): boolean {
  if (!isAnimationSafelyPlayable(sprite.anims.animationManager, animationKey)) {
    return false;
  }

  sprite.play(animationKey, ignoreIfPlaying);
  return true;
}

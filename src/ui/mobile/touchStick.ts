import type { TouchStickInputState } from './touchControls';

export interface TouchStickDirections {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
}

/**
 * The stick axes that count at their plain thresholds: the one the hero walks along (up and
 * down in left or right gravity), or both on a ladder or in water, where up and down move too.
 */
export type TouchStickPrimaryAxis = 'horizontal' | 'vertical' | 'both';

const HORIZONTAL_THRESHOLD = 0.28;
const VERTICAL_THRESHOLD = 0.42;
// A push off the primary axis (crouch, or the jump side in tilted gravity) counts only when
// the thumb points clearly along it, about 50 degrees or steeper. A thumb that drifts while
// walking keeps walking instead of crouching, crawling or jumping. Keys forwarded by the
// mann.cool shell are all-or-nothing and have no angle, so they keep the plain thresholds.
const CROSS_AXIS_RATIO = 1.2;

const NO_DIRECTIONS: Readonly<TouchStickDirections> = Object.freeze({
  left: false, right: false, up: false, down: false,
});

export function resolveTouchStickDirections(
  touch: Pick<TouchStickInputState, 'active' | 'stickMoveX' | 'stickMoveY' | 'stickDirectionX' | 'stickDirectionY'
    | 'forwardedMoveX' | 'forwardedMoveY'>,
  primaryAxis: TouchStickPrimaryAxis = 'horizontal',
): TouchStickDirections {
  if (!touch.active) {
    return { ...NO_DIRECTIONS };
  }

  const pushX = Math.abs(touch.stickDirectionX);
  const pushY = Math.abs(touch.stickDirectionY);
  const stickX = primaryAxis !== 'vertical' || pushX > pushY * CROSS_AXIS_RATIO;
  const stickY = primaryAxis !== 'horizontal' || pushY > pushX * CROSS_AXIS_RATIO;
  return {
    left: (stickX && touch.stickMoveX <= -HORIZONTAL_THRESHOLD) || touch.forwardedMoveX <= -HORIZONTAL_THRESHOLD,
    right: (stickX && touch.stickMoveX >= HORIZONTAL_THRESHOLD) || touch.forwardedMoveX >= HORIZONTAL_THRESHOLD,
    up: (stickY && touch.stickMoveY <= -VERTICAL_THRESHOLD) || touch.forwardedMoveY <= -VERTICAL_THRESHOLD,
    down: (stickY && touch.stickMoveY >= VERTICAL_THRESHOLD) || touch.forwardedMoveY >= VERTICAL_THRESHOLD,
  };
}

/**
 * Turns held stick directions into presses, like the keyboard's key-down edge: a direction
 * presses once, on the physics step it starts, so a held or drifting stick does not repeat.
 */
export class TouchStickPresses {
  private held: TouchStickDirections = { ...NO_DIRECTIONS };

  step(current: Readonly<TouchStickDirections>): TouchStickDirections {
    const pressed = {
      left: current.left && !this.held.left,
      right: current.right && !this.held.right,
      up: current.up && !this.held.up,
      down: current.down && !this.held.down,
    };
    this.held = { ...current };
    return pressed;
  }
}

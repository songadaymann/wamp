import type { TouchStickInputState } from './touchControls';

export interface TouchStickDirections {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
}

/** The stick axis the hero walks along: across the screen, or up and down in left/right gravity. */
export type TouchStickWalkAxis = 'horizontal' | 'vertical';

const HORIZONTAL_THRESHOLD = 0.28;
const VERTICAL_THRESHOLD = 0.42;
// A push off the walking axis (crouch, climb, or the jump side in tilted gravity) counts only
// when the thumb points clearly along it, about 50 degrees or steeper. A thumb that drifts
// while walking keeps walking instead of crouching, crawling or jumping.
const CROSS_AXIS_RATIO = 1.2;

const NO_DIRECTIONS: Readonly<TouchStickDirections> = Object.freeze({
  left: false, right: false, up: false, down: false,
});

export function resolveTouchStickDirections(
  touch: Pick<TouchStickInputState, 'active' | 'moveX' | 'moveY' | 'directionX' | 'directionY'>,
  walkAxis: TouchStickWalkAxis = 'horizontal',
): TouchStickDirections {
  if (!touch.active) {
    return { ...NO_DIRECTIONS };
  }

  const pushX = Math.abs(touch.directionX);
  const pushY = Math.abs(touch.directionY);
  const horizontalCounts = walkAxis === 'horizontal' || pushX > pushY * CROSS_AXIS_RATIO;
  const verticalCounts = walkAxis === 'vertical' || pushY > pushX * CROSS_AXIS_RATIO;
  return {
    left: horizontalCounts && touch.moveX <= -HORIZONTAL_THRESHOLD,
    right: horizontalCounts && touch.moveX >= HORIZONTAL_THRESHOLD,
    up: verticalCounts && touch.moveY <= -VERTICAL_THRESHOLD,
    down: verticalCounts && touch.moveY >= VERTICAL_THRESHOLD,
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

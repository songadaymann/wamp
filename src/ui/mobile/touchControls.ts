export type TouchActionName = 'jump' | 'slash' | 'shoot' | 'cameraToggle' | 'stop';

export interface TouchInputState {
  active: boolean;
  moveX: number;
  moveY: number;
  jumpHeld: boolean;
  slashHeld: boolean;
  shootHeld: boolean;
}

const state: TouchInputState = {
  active: false,
  moveX: 0,
  moveY: 0,
  jumpHeld: false,
  slashHeld: false,
  shootHeld: false,
};

const pressedActions: Record<TouchActionName, boolean> = {
  jump: false,
  slash: false,
  shoot: false,
  cameraToggle: false,
  stop: false,
};

export function setTouchControlsActive(active: boolean): void {
  state.active = active;
  if (!active) {
    resetTouchInputState();
  }
}

export function setTouchMove(moveX: number, moveY: number): void {
  state.moveX = Math.max(-1, Math.min(1, moveX));
  state.moveY = Math.max(-1, Math.min(1, moveY));
}

export function setTouchActionHeld(action: TouchActionName, held: boolean): void {
  switch (action) {
    case 'jump':
      state.jumpHeld = held;
      break;
    case 'slash':
      state.slashHeld = held;
      break;
    case 'shoot':
      state.shootHeld = held;
      break;
    default:
      break;
  }
}

export function pressTouchAction(action: TouchActionName): void {
  pressedActions[action] = true;
}

export function consumeTouchAction(action: TouchActionName): boolean {
  if (!pressedActions[action]) {
    return false;
  }

  pressedActions[action] = false;
  return true;
}

export function getTouchInputState(): TouchInputState {
  return { ...state };
}

export function resetTouchInputState(): void {
  state.moveX = 0;
  state.moveY = 0;
  state.jumpHeld = false;
  state.slashHeld = false;
  state.shootHeld = false;

  for (const key of Object.keys(pressedActions) as TouchActionName[]) {
    pressedActions[key] = false;
  }
}

export function getTouchInputDebugState(): Record<string, unknown> {
  return {
    ...state,
    pressed: { ...pressedActions },
  };
}

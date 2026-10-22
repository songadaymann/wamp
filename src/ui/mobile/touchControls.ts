import { consumeMannCoolAction, readMannCoolInput } from '../../integrations/mannCoolInput';

export type TouchActionName = 'jump' | 'slash' | 'shoot' | 'cameraToggle' | 'stop' | 'restart';

export interface TouchInputState {
  active: boolean;
  moveX: number;
  moveY: number;
  jumpHeld: boolean;
  slashHeld: boolean;
  shootHeld: boolean;
}

export interface TouchStickInputState extends TouchInputState {
  // The stick's push direction before each axis's own dead zone and full-tilt scaling,
  // so direction sectors judge how steeply the thumb really points (any length).
  directionX: number;
  directionY: number;
}

const state: TouchStickInputState = {
  active: false,
  moveX: 0,
  moveY: 0,
  directionX: 0,
  directionY: 0,
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
  restart: false,
};

export function setTouchControlsActive(active: boolean): void {
  state.active = active;
  if (!active) {
    resetTouchInputState();
  }
}

export function setTouchMove(moveX: number, moveY: number, directionX = moveX, directionY = moveY): void {
  state.moveX = Math.max(-1, Math.min(1, moveX));
  state.moveY = Math.max(-1, Math.min(1, moveY));
  state.directionX = directionX;
  state.directionY = directionY;
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
  const nativePressed = pressedActions[action];
  pressedActions[action] = false;
  const parentPressed = consumeMannCoolAction(action);
  return nativePressed || parentPressed;
}

export function getTouchInputState(): TouchStickInputState {
  const parent = readMannCoolInput();
  return {
    active: state.active || parent.active,
    moveX: Math.max(-1, Math.min(1, state.moveX + parent.moveX)),
    moveY: Math.max(-1, Math.min(1, state.moveY + parent.moveY)),
    directionX: state.directionX + parent.moveX,
    directionY: state.directionY + parent.moveY,
    jumpHeld: state.jumpHeld || parent.jumpHeld,
    slashHeld: state.slashHeld || parent.slashHeld,
    shootHeld: state.shootHeld || parent.shootHeld,
  };
}

export function resetTouchInputState(): void {
  state.moveX = 0;
  state.moveY = 0;
  state.directionX = 0;
  state.directionY = 0;
  state.jumpHeld = false;
  state.slashHeld = false;
  state.shootHeld = false;

  for (const key of Object.keys(pressedActions) as TouchActionName[]) {
    pressedActions[key] = false;
  }
}

export function getTouchInputDebugState(): Record<string, unknown> {
  return {
    ...getTouchInputState(),
    pressed: { ...pressedActions },
  };
}

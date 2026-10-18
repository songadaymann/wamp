import Phaser from 'phaser';
import type { TouchInputState } from '../../ui/mobile/touchControls';
import type { GamepadControls } from './gamepadInput';
import type { OverworldMovementInput } from './physicsCadence';
export type { GamepadControls } from './gamepadInput';

export function consumePressedAliases(first: Phaser.Input.Keyboard.Key, second: Phaser.Input.Keyboard.Key): boolean {
  // Consume both aliases even when the first is pressed, so the second cannot replay next frame.
  const firstPressed = Phaser.Input.Keyboard.JustDown(first);
  const secondPressed = Phaser.Input.Keyboard.JustDown(second);
  return firstPressed || secondPressed;
}

export function mergeGamepadMovement(input: OverworldMovementInput, pad: GamepadControls | undefined): OverworldMovementInput {
  if (!pad) return input;
  input.left ||= pad.held('left'); input.right ||= pad.held('right');
  input.upKeyHeld ||= pad.held('up'); input.downHeld ||= pad.held('down');
  input.spaceHeld ||= pad.held('jump');
  input.upPressed ||= pad.pressed('up'); input.downPressed ||= pad.pressed('down');
  input.leftPressed ||= pad.pressed('left'); input.rightPressed ||= pad.pressed('right');
  input.spacePressed ||= pad.pressed('jump');
  return input;
}

export function createOverworldGameplayKeys(keyboard: Phaser.Input.Keyboard.KeyboardPlugin) {
  return {
    cursors: keyboard.createCursorKeys(),
    wasd: {
      W: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W), A: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      S: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S), D: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    },
    attackKeys: {
      Q: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q), E: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E),
    },
    cameraToggleKey: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.NINE),
  };
}

/** Shared held-input check keeps presentation prompts out of active movement/combat. */
export function hasGameplayInputHeld(
  keys: readonly ({ isDown: boolean } | undefined)[],
  gamepadHeld: boolean,
  movement: { horizontalInput: number; verticalInput: number },
  touch: Pick<TouchInputState, 'moveX' | 'moveY' | 'jumpHeld' | 'slashHeld' | 'shootHeld'>,
): boolean {
  return keys.some(key => key?.isDown) || gamepadHeld
    || Math.abs(movement.horizontalInput) > 0.001 || Math.abs(movement.verticalInput) > 0.001
    || Math.abs(touch.moveX) > 0.001 || Math.abs(touch.moveY) > 0.001
    || touch.jumpHeld || touch.slashHeld || touch.shootHeld;
}

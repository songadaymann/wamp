import type { TouchStickDirections } from '../../ui/mobile/touchStick';
import type { PlayerGravityDirection } from './specialTiles';

export interface DirectionalGravityControls {
  tangentInput: number;
  crouchHeld: boolean;
  jumpPressed: boolean;
  jumpHeld: boolean;
  stompPressed: boolean;
  horizontalInput: number;
  verticalInput: number;
}

export function resolveDirectionalGravityControls(
  gravityDirection: PlayerGravityDirection,
  input: {
    horizontalInput: number;
    verticalInput: number;
    left: boolean;
    right: boolean;
    upHeld: boolean;
    downHeld: boolean;
    upPressed: boolean;
    downPressed: boolean;
    leftPressed: boolean;
    rightPressed: boolean;
    spacePressed: boolean;
    spaceHeld: boolean;
    touchPressed: TouchStickDirections;
  },
): DirectionalGravityControls {
  switch (gravityDirection) {
    case 'up':
      return {
        tangentInput: -input.horizontalInput,
        crouchHeld: input.upHeld,
        jumpPressed: input.spacePressed || input.downPressed || input.touchPressed.down,
        jumpHeld: input.spaceHeld || input.downHeld,
        stompPressed: input.upPressed || input.touchPressed.up,
        horizontalInput: input.horizontalInput,
        verticalInput: input.verticalInput,
      };
    case 'left':
      return {
        tangentInput: -input.verticalInput,
        crouchHeld: input.left,
        jumpPressed: input.spacePressed || input.rightPressed || input.touchPressed.right,
        jumpHeld: input.spaceHeld || input.right,
        stompPressed: input.leftPressed || input.touchPressed.left,
        horizontalInput: -input.verticalInput,
        verticalInput: input.verticalInput,
      };
    case 'right':
      return {
        tangentInput: input.verticalInput,
        crouchHeld: input.right,
        jumpPressed: input.spacePressed || input.leftPressed || input.touchPressed.left,
        jumpHeld: input.spaceHeld || input.left,
        stompPressed: input.rightPressed || input.touchPressed.right,
        horizontalInput: input.verticalInput,
        verticalInput: input.verticalInput,
      };
    case 'down':
    default:
      return {
        tangentInput: input.horizontalInput,
        crouchHeld: input.downHeld,
        jumpPressed: input.spacePressed || input.upPressed || input.touchPressed.up,
        jumpHeld: input.spaceHeld || input.upHeld,
        stompPressed: input.downPressed || input.touchPressed.down,
        horizontalInput: input.horizontalInput,
        verticalInput: input.verticalInput,
      };
  }
}

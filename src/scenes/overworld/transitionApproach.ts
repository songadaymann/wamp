import type { RoomCoordinates } from '../../persistence/roomModel';
import { EDGE_WALL_THICKNESS } from './composition/settings';
import type { PlayerGravityDirection } from './specialTiles';

// Which vertical neighbour can the player actually move into? Phones keep one
// predicted room, so predicting the room below a floor the player runs or hops
// on, or the room above a jump that peaks short of the seam, throws away the
// room they are running toward (F350).

// Feet this close to a seam rest on that seam's edge wall or transition clamp.
// Both exist only until the neighbour is ready, so it stays a real destination.
export const SEAM_SUPPORT_TOLERANCE_PX = EDGE_WALL_THICKNESS + 1;
const FLOOR_HEIGHT_TOLERANCE_PX = 1;
// More than any single frame of movement: the player was placed, not moved.
const FLOOR_MEMORY_DISCONTINUITY_PX = 64;
const VELOCITY_EPSILON = 1;

interface ApproachCollisionFlags {
  readonly up?: boolean;
  readonly down?: boolean;
}

export interface TransitionApproachBody {
  readonly velocity: { readonly x: number; readonly y: number };
  readonly top?: number;
  readonly bottom?: number;
  readonly allowGravity?: boolean;
  readonly gravity?: { readonly y: number };
  readonly world?: { readonly gravity?: { readonly y: number } };
  readonly blocked?: ApproachCollisionFlags;
  readonly touching?: ApproachCollisionFlags;
}

export interface TransitionApproachEnvironment {
  readonly gravityDirection: PlayerGravityDirection;
  readonly inWater: boolean;
}

/**
 * True when the body rests on a surface on the `direction` side (1 = floor
 * under it, -1 = ceiling over it) that is not the seam itself, so it cannot
 * cross that seam now. A body still moving toward the seam (riding a
 * descending platform, sinking) keeps approaching it.
 */
export function isBodySupportedAwayFromVerticalSeam(
  body: TransitionApproachBody | null | undefined,
  direction: 1 | -1,
  seamY: number,
): boolean {
  if (!body) return false;
  const side = direction > 0 ? 'down' : 'up';
  if (!body.blocked?.[side] && !body.touching?.[side]) return false;
  if (body.velocity.y * direction > VELOCITY_EPSILON) return false;
  const edge = direction > 0 ? body.bottom : body.top;
  if (typeof edge !== 'number' || !Number.isFinite(edge)) return false;
  return direction > 0
    ? edge < seamY - SEAM_SUPPORT_TOLERANCE_PX
    : edge > seamY + SEAM_SUPPORT_TOLERANCE_PX;
}

/** Downward acceleration Arcade applies to the body, in px/s². */
export function getBodyGravityY(body: TransitionApproachBody): number {
  if (body.allowGravity !== true) return 0;
  return (body.world?.gravity?.y ?? 0) + (body.gravity?.y ?? 0);
}

/**
 * Whether an upward move at `velocityY` (negative = up) carries the player
 * `distancePx` to the seam before gravity stops it: the ballistic peak v²/2g.
 * Springs and bounce pads clear it; an ordinary hop mid-room does not.
 */
export function canRiseToSeam(distancePx: number, velocityY: number, gravityY: number): boolean {
  if (velocityY >= -VELOCITY_EPSILON) return false;
  if (gravityY <= 0) return true;
  return (velocityY * velocityY) / (2 * gravityY) >= distancePx;
}

/**
 * Remembers the floor the player last stood on in this room, so a hop that
 * comes back down onto it does not predict the room below. Only a fall past
 * that floor (off a ledge, into a pit) makes the room below reachable.
 */
export class TransitionFloorMemory {
  private roomKey: string | null = null;
  private floorFeetY: number | null = null;
  private lastFeetY: number | null = null;

  reset(): void {
    this.roomKey = null;
    this.floorFeetY = null;
    this.lastFeetY = null;
  }

  observe(
    roomCoordinates: RoomCoordinates,
    body: TransitionApproachBody,
    feetY: number,
    roomBottom: number,
  ): void {
    const roomKey = `${roomCoordinates.x},${roomCoordinates.y}`;
    if (
      roomKey !== this.roomKey
      || !Number.isFinite(feetY)
      || this.lastFeetY === null
      || Math.abs(feetY - this.lastFeetY) > FLOOR_MEMORY_DISCONTINUITY_PX
    ) {
      this.floorFeetY = null;
    }
    this.roomKey = roomKey;
    this.lastFeetY = Number.isFinite(feetY) ? feetY : null;
    if (
      (body.blocked?.down || body.touching?.down)
      && Math.abs(body.velocity.y) <= VELOCITY_EPSILON
      && Number.isFinite(feetY)
      && feetY < roomBottom - SEAM_SUPPORT_TOLERANCE_PX
    ) {
      this.floorFeetY = feetY;
    }
  }

  isBelowRememberedFloor(feetY: number): boolean {
    return this.floorFeetY === null || feetY > this.floorFeetY + FLOOR_HEIGHT_TOLERANCE_PX;
  }
}

export interface VerticalApproachInput {
  readonly body: TransitionApproachBody;
  readonly environment: TransitionApproachEnvironment | null;
  readonly playerY: number;
  readonly feetY: number;
  readonly roomTop: number;
  readonly roomBottom: number;
  readonly floorMemory: TransitionFloorMemory;
}

/**
 * The vertical neighbour the player is moving into (1 = below, -1 = above),
 * or 0. Outside normal downward gravity (swimming, gravity zones) the plain
 * direction of travel is kept, since motion there is not an arc we project.
 */
export function resolveVerticalApproach(input: VerticalApproachInput): 1 | -1 | 0 {
  const { body } = input;
  const direction = body.velocity.y > VELOCITY_EPSILON
    ? 1
    : body.velocity.y < -VELOCITY_EPSILON
      ? -1
      : 0;
  if (direction === 0) return 0;
  const seamY = direction > 0 ? input.roomBottom : input.roomTop;
  if (isBodySupportedAwayFromVerticalSeam(body, direction, seamY)) return 0;
  const environment = input.environment;
  const ballistic = !environment || (environment.gravityDirection === 'down' && !environment.inWater);
  if (!ballistic) return direction;
  if (direction > 0) {
    return input.floorMemory.isBelowRememberedFloor(input.feetY) ? 1 : 0;
  }
  return canRiseToSeam(input.playerY - input.roomTop, body.velocity.y, getBodyGravityY(body))
    ? -1
    : 0;
}

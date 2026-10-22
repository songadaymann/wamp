import { ROOM_PX_HEIGHT } from '../../config';
import type { RoomCoordinates } from '../../persistence/roomModel';
import { EDGE_WALL_THICKNESS } from './composition/settings';
import type { PlayerGravityDirection } from './specialTiles';

// Which vertical neighbour can the player actually move into? Phones keep one
// predicted room, so predicting the room below a floor the player runs or hops
// on, or the room above a jump that peaks far short of the seam, throws away
// the room they are running toward (F350).

// Feet this close to a seam rest on that seam's edge wall or transition clamp.
// Both exist only until the neighbour is ready, so it stays a real destination.
export const SEAM_SUPPORT_TOLERANCE_PX = EDGE_WALL_THICKNESS + 1;
const FLOOR_HEIGHT_TOLERANCE_PX = 1;
// A climb (wall jumps, springs in a shaft) gets the room above as soon as it
// rises into the top quarter, or once its peak lands within one more normal
// jump (280² / 2·700 = 56 px) of the seam, so the build has a lead.
const CLIMB_LEAD_DISTANCE_PX = ROOM_PX_HEIGHT / 4;
const CLIMB_LEAD_JUMP_HEIGHT_PX = 56;
const OPEN_DROP_SAMPLE_STEP_PX = 4;
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
 * Vertical gravity the player feels (positive = down), or null when it is not
 * a ballistic pull (swimming). Gravity zones apply the world's strength by
 * hand (movementController: jump velocity × 2.5 = GRAVITY); sideways zones
 * leave vertical motion free.
 */
export function getEffectiveGravityY(
  body: TransitionApproachBody,
  environment: TransitionApproachEnvironment | null,
): number | null {
  if (environment?.inWater) return null;
  switch (environment?.gravityDirection ?? 'down') {
    case 'down':
      return getBodyGravityY(body);
    case 'up':
      return -Math.abs(body.world?.gravity?.y ?? 0);
    case 'left':
    case 'right':
      return 0;
  }
}

/**
 * Whether a move against gravity at `speed` toward a seam `distancePx` away
 * gets close enough to predict that room: its ballistic peak v²/2g plus one
 * more jump, or any rise into the top quarter of the room. Springs, bounce
 * pads and climbing wall jumps qualify; an ordinary hop mid-room does not.
 */
export function canClimbToSeam(distancePx: number, speed: number, deceleration: number): boolean {
  if (speed <= VELOCITY_EPSILON) return false;
  if (distancePx <= CLIMB_LEAD_DISTANCE_PX || deceleration <= 0) return true;
  return (speed * speed) / (2 * deceleration) + CLIMB_LEAD_JUMP_HEIGHT_PX >= distancePx;
}

/**
 * True when nothing solid lies under the body's span from its feet down to
 * the bottom seam, so a fall here drops straight into the room below.
 */
export function hasOpenDropBelow(
  isSolidAt: (worldX: number, worldY: number) => boolean,
  left: number,
  right: number,
  feetY: number,
  roomBottom: number,
): boolean {
  if (![left, right, feetY].every(Number.isFinite)) return false;
  const columns = [left + 1, (left + right) * 0.5, right - 1];
  const rows: number[] = [];
  for (let y = feetY + 1; y < roomBottom - 1; y += OPEN_DROP_SAMPLE_STEP_PX) rows.push(y);
  rows.push(roomBottom - 1);
  return !rows.some((y) => columns.some((x) => isSolidAt(x, y)));
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
  /** Whether the body's columns are clear down to the bottom seam. */
  readonly hasOpenDropBelow?: () => boolean;
}

/**
 * The vertical neighbour the player is moving into (1 = below, -1 = above),
 * or 0. A move against gravity must climb close to its seam; a fall must pass
 * the floor the player left or be over an open drop to the room below.
 * Swimming, ladders and sideways gravity keep the plain direction of travel.
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
  const gravityY = getEffectiveGravityY(body, input.environment);
  if (gravityY === null || gravityY === 0) return direction;
  if (direction * gravityY < 0) {
    const distance = direction > 0 ? input.roomBottom - input.playerY : input.playerY - input.roomTop;
    return canClimbToSeam(distance, Math.abs(body.velocity.y), Math.abs(gravityY)) ? direction : 0;
  }
  if (direction < 0) return direction;
  return input.floorMemory.isBelowRememberedFloor(input.feetY) || input.hasOpenDropBelow?.() === true
    ? 1
    : 0;
}

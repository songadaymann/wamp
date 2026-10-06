import Phaser from 'phaser';
import { ROOM_HEIGHT, ROOM_WIDTH, TILE_SIZE } from '../../config';
import type { RoomCoordinates, RoomSnapshot } from '../../persistence/roomModel';
import type { ArcadeObjectBody, LoadedRoomObject } from './liveObjects';
import { liveObjectBlocksPlayerMovement } from './playerCollisionObjects';
import {
  getBodyVelocityAlongVector, getGravityRightVector, getGravityVector,
  setBodyVelocityAlongVector, type PlayerGravityDirection,
} from './specialTiles';

interface CornerCorrectionHost {
  getCurrentRoomCoordinates(): RoomCoordinates;
  getRoomOrigin(coordinates: RoomCoordinates): { x: number; y: number };
  getRoomSnapshotForCoordinates(coordinates: RoomCoordinates): RoomSnapshot | null;
  isSolidTerrainAtWorldPoint(room: RoomSnapshot, x: number, y: number): boolean;
  getRuntimeSolidLiveObjectsInBounds(bounds: Phaser.Geom.Rectangle): Iterable<LoadedRoomObject>;
  getArcadeBodyBounds(body: ArcadeObjectBody): Phaser.Geom.Rectangle;
}

/** Runs after Arcade separation, retaining the previous step's rising velocity. */
export class OverworldJumpCornerCorrection {
  private previousBody: Phaser.Physics.Arcade.Body | null = null;
  private previousGravity: PlayerGravityDirection = 'down';
  private previousRiseVelocity = 0;
  private corrections = 0;
  private lastShift = 0;

  constructor(private readonly host: CornerCorrectionHost) {}

  reset(): void {
    this.previousBody = null;
    this.previousRiseVelocity = 0;
    this.corrections = 0;
    this.lastShift = 0;
  }

  describe() { return { cornerCorrections: this.corrections, lastCornerShiftPx: this.lastShift }; }

  remember(body: Phaser.Physics.Arcade.Body | null, gravity: PlayerGravityDirection): void {
    this.previousBody = body;
    this.previousGravity = gravity;
    this.previousRiseVelocity = body ? getBodyVelocityAlongVector(body, getGravityVector(gravity)) : 0;
  }

  correct(player: Phaser.GameObjects.Rectangle, body: Phaser.Physics.Arcade.Body,
    gravity: PlayerGravityDirection, deltaMs = 1000 / 60): boolean {
    const head = gravity === 'down' ? 'up' : gravity === 'up' ? 'down' : gravity === 'left' ? 'right' : 'left';
    const normal = getGravityVector(gravity);
    if (body !== this.previousBody || gravity !== this.previousGravity || this.previousRiseVelocity >= 0 ||
      !body.blocked[head] || getBodyVelocityAlongVector(body, normal) > 0) return false;
    const room = this.host.getRoomSnapshotForCoordinates(this.host.getCurrentRoomCoordinates());
    if (!room) return false;
    const tangent = getGravityRightVector(gravity);
    const preferred = getBodyVelocityAlongVector(body, tangent) > 0 ? 1 : -1;
    for (let distance = 1; distance <= 4; distance += 1) {
      for (const sign of [preferred, -preferred]) {
        const dx = tangent.x * sign * distance, dy = tangent.y * sign * distance;
        // Include one pixel of headroom, so the next step can actually continue rising.
        const bounds = new Phaser.Geom.Rectangle(
          body.left + dx - Math.max(0, normal.x), body.top + dy - Math.max(0, normal.y),
          body.width + Math.abs(normal.x), body.height + Math.abs(normal.y),
        );
        if (!this.isClear(room, bounds)) continue;
        body.x += dx; body.y += dy;
        body.prev.x += dx; body.prev.y += dy;
        body.prevFrame.x += dx; body.prevFrame.y += dy;
        player.x += dx; player.y += dy;
        body.updateCenter();
        const acceleration = body.allowGravity
          ? (body.world.gravity.x + body.gravity.x) * normal.x +
            (body.world.gravity.y + body.gravity.y) * normal.y
          : 0;
        setBodyVelocityAlongVector(body, normal, Math.min(0, this.previousRiseVelocity + acceleration * deltaMs / 1000));
        body.blocked[head] = false;
        body.touching[head] = false;
        this.corrections += 1;
        this.lastShift = sign * distance;
        return true;
      }
    }
    return false;
  }

  private isClear(room: RoomSnapshot, bounds: Phaser.Geom.Rectangle): boolean {
    const origin = this.host.getRoomOrigin(room.coordinates);
    if (bounds.left <= origin.x || bounds.top <= origin.y ||
      bounds.right >= origin.x + ROOM_WIDTH * TILE_SIZE ||
      bounds.bottom >= origin.y + ROOM_HEIGHT * TILE_SIZE) return false;
    // Terrain has inset collision profiles. Sample the interior at pixel intervals,
    // including both fractional edges, rather than assuming every tile is solid.
    const samples = (start: number, end: number) => {
      const values = [start + 0.001, end - 0.001];
      for (let value = Math.ceil(start); value < end; value += 1) values.push(value);
      return values;
    };
    for (const x of samples(bounds.left, bounds.right)) {
      for (const y of samples(bounds.top, bounds.bottom)) {
        if (this.host.isSolidTerrainAtWorldPoint(room, x, y)) return false;
      }
    }
    for (const object of this.host.getRuntimeSolidLiveObjectsInBounds(bounds)) {
      const body = object.sprite.body as ArcadeObjectBody | null;
      if (!liveObjectBlocksPlayerMovement(object) || !object.sprite.active || !body?.enable) continue;
      const other = this.host.getArcadeBodyBounds(body);
      if (bounds.left < other.right && bounds.right > other.left &&
        bounds.top < other.bottom && bounds.bottom > other.top) return false;
    }
    return true;
  }
}

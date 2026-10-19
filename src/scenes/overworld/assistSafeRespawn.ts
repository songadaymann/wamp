import type Phaser from 'phaser';
import { decodeTileDataValue, getSpecialTileKindForGid, ROOM_PX_HEIGHT, ROOM_PX_WIDTH, TILE_SIZE } from '../../config';
import { getSafeRespawnEnabled } from '../../settings/assistSettings';
import type { RespawnCheckpoint } from '../../goals/respawnCheckpoints';
import type { RoomSnapshot } from '../../persistence/roomModel';
import type { LoadedFullRoom } from './worldStreaming';
import type { LoadedRoomObject } from './liveObjects/model';
import { getTerrainTileCollisionProfile } from './terrainCollision';
interface Point { x: number; y: number }
interface Obstacle { left: number; right: number; top: number; bottom: number }
/** Use standing clearance, full-width static support and a tile of hazard clearance. */
export function isSafeAssistGround(room: RoomSnapshot, point: Point, width: number, height: number, obstacles: Iterable<Obstacle>): boolean {
  const left = point.x - width / 2, right = point.x + width / 2, top = point.y - height;
  if (left < TILE_SIZE || right > ROOM_PX_WIDTH - TILE_SIZE || top < TILE_SIZE || point.y > ROOM_PX_HEIGHT - TILE_SIZE) return false;
  const firstX = Math.floor(left / TILE_SIZE), lastX = Math.floor((right - 0.1) / TILE_SIZE);
  const supportY = Math.floor((point.y + 2) / TILE_SIZE);
  for (let x = firstX - 1; x <= lastX + 1; x += 1) {
    const support = getTerrainTileCollisionProfile(room, x, supportY);
    if (!support.hasCollision || Math.abs(supportY * TILE_SIZE + support.topInset - point.y) > 3) return false;
  }
  for (let y = Math.floor((top - TILE_SIZE) / TILE_SIZE); y <= supportY; y += 1) {
    for (let x = firstX - 1; x <= lastX + 1; x += 1) {
      const gid = decodeTileDataValue(room.tileData.terrain[y]?.[x] ?? -1).gid;
      if (getSpecialTileKindForGid(gid)) return false;
      if (x < firstX || x > lastX || y === supportY) continue;
      const tile = getTerrainTileCollisionProfile(room, x, y);
      if (tile.hasCollision && y * TILE_SIZE + tile.topInset < point.y - 1
        && y * TILE_SIZE + TILE_SIZE - tile.bottomInset > top) return false;
    }
  }
  for (const b of obstacles) {
    if (b.left < right + TILE_SIZE && b.right > left - TILE_SIZE && b.top < point.y + TILE_SIZE && b.bottom > top - TILE_SIZE) return false;
  }
  return true;
}
interface SafeHost {
  active(): boolean;
  owner(): object | null;
  now(): number;
  getBody(): Phaser.Physics.Arcade.Body | null;
  getRoom(): LoadedFullRoom<LoadedRoomObject> | null;
  allRooms(): Iterable<LoadedFullRoom<LoadedRoomObject>>;
  findRoom(id: string): LoadedFullRoom<LoadedRoomObject> | null;
  getOrigin(room: RoomSnapshot): Point;
  standingHeight: number;
}
export class OverworldAssistSafeRespawn {
  private anchor: { owner: object; room: RoomSnapshot; point: RespawnCheckpoint; width: number } | null = null;
  private nextSampleAt = 0;
  private protectedUntil = 0;
  constructor(private readonly host: SafeHost) {}
  capture(): void {
    if (!this.enabled()) { this.reset(); return; }
    const owner = this.host.owner();
    if (!owner || this.anchor?.owner !== owner) this.anchor = null;
    const now = this.host.now();
    if (now < this.nextSampleAt) return;
    this.nextSampleAt = now + 150;
    const body = this.host.getBody(), room = this.host.getRoom();
    if (!owner || !body || !room || !body.enable || !(body.blocked.down || body.touching.down) || Math.abs(body.velocity.y) > 1) return;
    const origin = this.host.getOrigin(room.room);
    const point: RespawnCheckpoint = { kind: 'goal', instanceId: null, checkpointIndex: 0,
      roomId: room.room.id, roomCoordinates: { ...room.room.coordinates }, x: body.center.x - origin.x, y: body.bottom - origin.y };
    if (this.safe(room, point, body.width)) this.anchor = { owner, room: room.room, point, width: body.width };
  }
  getCheckpoint(): RespawnCheckpoint | null {
    if (!this.enabled() || !this.anchor || this.anchor.owner !== this.host.owner()) return null;
    const room = this.host.findRoom(this.anchor.point.roomId);
    if (!room || room.room !== this.anchor.room || !this.safe(room, this.anchor.point, this.anchor.width)) { this.anchor = null; return null; }
    return this.anchor.point;
  }
  grantProtection(): void { if (this.enabled()) this.protectedUntil = this.host.now() + 1000; }
  isProtected(): boolean { return this.enabled() && this.host.now() < this.protectedUntil; }
  reset(): void { this.anchor = null; this.nextSampleAt = 0; this.protectedUntil = 0; }
  describe() { return { checkpoint: this.getCheckpoint(), protected: this.isProtected() }; }
  private enabled(): boolean { return this.host.active() && getSafeRespawnEnabled(); }
  private safe(room: LoadedFullRoom<LoadedRoomObject>, point: Point, width: number): boolean {
    const origin = this.host.getOrigin(room.room);
    // Dynamic hazards can enter from the neighboring cell, so the scene supplies all loaded objects.
    const obstacles: Obstacle[] = [];
    for (const neighbor of this.host.allRooms()) for (const object of neighbor.liveObjects) {
      if (!object.sprite.active || ['collectible', 'decoration'].includes(object.config.category)) continue;
      const b = object.sprite.getBounds();
      obstacles.push({ left: b.left - origin.x, right: b.right - origin.x, top: b.top - origin.y, bottom: b.bottom - origin.y });
    }
    // Never anchor to a removed/crumbling support even if the authored snapshot still contains it.
    const tile = room.terrainLayer.getTileAtWorldXY(origin.x + point.x, origin.y + point.y + 2);
    const support = getTerrainTileCollisionProfile(room.room, Math.floor(point.x / TILE_SIZE), Math.floor((point.y + 2) / TILE_SIZE));
    return Boolean((tile && tile.index >= 0) || support.isSmartBackgroundSurface) && isSafeAssistGround(room.room, point, width, this.host.standingHeight, obstacles);
  }
}

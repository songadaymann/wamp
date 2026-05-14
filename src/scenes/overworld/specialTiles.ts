import Phaser from 'phaser';
import {
  decodeTileDataValue,
  isSpecialBreakableBrickGid,
  ROOM_HEIGHT,
  ROOM_WIDTH,
  TILE_SIZE,
} from '../../config';
import {
  cloneRoomSnapshot,
  roomIdFromCoordinates,
  type RoomCoordinates,
  type RoomSnapshot,
} from '../../persistence/roomModel';
import { buildRoomSnapshotTexture } from '../../visuals/roomSnapshotTexture';
import type { OverworldMode } from '../sceneData';
import { getTerrainTileCollisionProfile } from './terrainCollision';
import type { LoadedFullRoom } from './worldStreaming';

interface OverworldSpecialTilesControllerHost<TLiveObject, TEdgeWall> {
  getMode: () => OverworldMode;
  getPlayerBody: () => Phaser.Physics.Arcade.Body | null;
  getLoadedFullRooms: () => Iterable<LoadedFullRoom<TLiveObject, TEdgeWall>>;
  getLoadedFullRoomById: (roomId: string) => LoadedFullRoom<TLiveObject, TEdgeWall> | null;
  getRoomCoordinatesForPoint: (x: number, y: number) => RoomCoordinates;
  getRoomOrigin: (coordinates: RoomCoordinates) => { x: number; y: number };
}

export class OverworldSpecialTilesController<TLiveObject = unknown, TEdgeWall = unknown> {
  private runtimeRoomTextureRevision = 0;
  private readonly brokenSpecialBrickTileKeysByRoomId = new Map<string, Set<string>>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly host: OverworldSpecialTilesControllerHost<TLiveObject, TEdgeWall>,
  ) {}

  update(): void {
    if (this.host.getMode() !== 'play') {
      return;
    }

    this.maybeBreakSpecialBrickTile();
  }

  handleFullRoomDestroyed(roomId: string): void {
    this.brokenSpecialBrickTileKeysByRoomId.delete(roomId);
  }

  resetAll(): void {
    for (const loadedRoom of this.host.getLoadedFullRooms()) {
      this.resetForRoom(loadedRoom);
    }
    this.brokenSpecialBrickTileKeysByRoomId.clear();
  }

  resetForRoom(loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>): void {
    const brokenTiles = this.brokenSpecialBrickTileKeysByRoomId.get(loadedRoom.room.id);
    if (!brokenTiles || brokenTiles.size === 0) {
      return;
    }

    for (const tileKey of brokenTiles) {
      const parsed = this.parseSpecialBrickTileKey(tileKey);
      if (!parsed) {
        continue;
      }

      const { tileX, tileY } = parsed;
      const decoded = decodeTileDataValue(loadedRoom.room.tileData.terrain[tileY][tileX]);
      if (!isSpecialBreakableBrickGid(decoded.gid)) {
        continue;
      }

      const restoredTile = loadedRoom.terrainLayer.putTileAt(decoded.gid, tileX, tileY);
      if (!restoredTile) {
        continue;
      }

      restoredTile.flipX = decoded.flipX;
      restoredTile.flipY = decoded.flipY;
      const collisionProfile = getTerrainTileCollisionProfile(loadedRoom.room, tileX, tileY);
      restoredTile.setCollision(
        collisionProfile.hasCollision,
        collisionProfile.hasCollision,
        collisionProfile.hasCollision,
        collisionProfile.hasCollision,
      );
    }

    loadedRoom.terrainLayer.calculateFacesWithin(0, 0, ROOM_WIDTH, ROOM_HEIGHT);
    this.brokenSpecialBrickTileKeysByRoomId.delete(loadedRoom.room.id);
    this.refreshLoadedRoomTerrainTexture(loadedRoom);
  }

  private maybeBreakSpecialBrickTile(): void {
    const playerBody = this.host.getPlayerBody();
    if (!playerBody) {
      return;
    }

    const upwardDelta =
      typeof playerBody.deltaY === 'function'
        ? playerBody.deltaY()
        : playerBody.y - (playerBody.prev?.y ?? playerBody.y);
    const separatedUp = Boolean(playerBody.blocked?.up) || Boolean(playerBody.touching?.up);
    const hitFromBelow = upwardDelta < -0.5 || playerBody.velocity.y < -20 || separatedUp;
    if (!hitFromBelow) {
      return;
    }

    const sampleY = playerBody.top - 1;
    const sampleXs = [
      playerBody.center.x,
      playerBody.left + 2,
      playerBody.right - 2,
    ].filter((value, index, values) => values.indexOf(value) === index);

    for (const sampleX of sampleXs) {
      const match = this.findSpecialBreakableBrickTileAtWorldPoint(sampleX, sampleY);
      if (!match) {
        continue;
      }

      if (playerBody.velocity.y < -40) {
        playerBody.setVelocityY(-40);
      }
      this.breakSpecialBrickTile(match.loadedRoom, match.tileX, match.tileY);
      return;
    }
  }

  private findSpecialBreakableBrickTileAtWorldPoint(
    worldX: number,
    worldY: number,
  ): { loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>; tileX: number; tileY: number } | null {
    const coordinates = this.host.getRoomCoordinatesForPoint(worldX, worldY);
    const roomId = roomIdFromCoordinates(coordinates);
    const loadedRoom = this.host.getLoadedFullRoomById(roomId);
    if (!loadedRoom) {
      return null;
    }

    const origin = this.host.getRoomOrigin(coordinates);
    const tileX = Math.floor((worldX - origin.x) / TILE_SIZE);
    const tileY = Math.floor((worldY - origin.y) / TILE_SIZE);
    if (tileX < 0 || tileX >= ROOM_WIDTH || tileY < 0 || tileY >= ROOM_HEIGHT) {
      return null;
    }

    if (this.isSpecialBrickTileBroken(roomId, tileX, tileY)) {
      return null;
    }

    const { gid } = decodeTileDataValue(loadedRoom.room.tileData.terrain[tileY][tileX]);
    if (!isSpecialBreakableBrickGid(gid)) {
      return null;
    }
    if (!loadedRoom.terrainLayer.getTileAt(tileX, tileY)) {
      return null;
    }

    return { loadedRoom, tileX, tileY };
  }

  private breakSpecialBrickTile(
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
    tileX: number,
    tileY: number,
  ): void {
    const { gid } = decodeTileDataValue(loadedRoom.room.tileData.terrain[tileY][tileX]);
    if (!isSpecialBreakableBrickGid(gid)) {
      return;
    }

    const tileKey = this.getSpecialBrickTileKey(tileX, tileY);
    let brokenTiles = this.brokenSpecialBrickTileKeysByRoomId.get(loadedRoom.room.id);
    if (!brokenTiles) {
      brokenTiles = new Set<string>();
      this.brokenSpecialBrickTileKeysByRoomId.set(loadedRoom.room.id, brokenTiles);
    }
    if (brokenTiles.has(tileKey)) {
      return;
    }

    brokenTiles.add(tileKey);
    loadedRoom.terrainLayer.removeTileAt(tileX, tileY, true, true);
    this.refreshLoadedRoomTerrainTexture(loadedRoom);
    this.playSpecialBrickBreakAnimation(loadedRoom, tileX, tileY);
  }

  private isSpecialBrickTileBroken(roomId: string, tileX: number, tileY: number): boolean {
    return this.brokenSpecialBrickTileKeysByRoomId.get(roomId)?.has(
      this.getSpecialBrickTileKey(tileX, tileY),
    ) === true;
  }

  private getSpecialBrickTileKey(tileX: number, tileY: number): string {
    return `${tileX},${tileY}`;
  }

  private parseSpecialBrickTileKey(tileKey: string): { tileX: number; tileY: number } | null {
    const [tileXText, tileYText] = tileKey.split(',');
    const tileX = Number(tileXText);
    const tileY = Number(tileYText);
    if (!Number.isInteger(tileX) || !Number.isInteger(tileY)) {
      return null;
    }
    if (tileX < 0 || tileX >= ROOM_WIDTH || tileY < 0 || tileY >= ROOM_HEIGHT) {
      return null;
    }
    return { tileX, tileY };
  }

  private createLoadedRoomTerrainTextureSnapshot(
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
  ): RoomSnapshot {
    const brokenTiles = this.brokenSpecialBrickTileKeysByRoomId.get(loadedRoom.room.id);
    if (!brokenTiles || brokenTiles.size === 0) {
      return loadedRoom.room;
    }

    const snapshot = cloneRoomSnapshot(loadedRoom.room);
    for (const tileKey of brokenTiles) {
      const parsed = this.parseSpecialBrickTileKey(tileKey);
      if (!parsed) {
        continue;
      }
      snapshot.tileData.terrain[parsed.tileY][parsed.tileX] = -1;
    }
    return snapshot;
  }

  private refreshLoadedRoomTerrainTexture(
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
  ): void {
    const oldTextureKey = loadedRoom.textureKey;
    this.runtimeRoomTextureRevision += 1;
    const baseTextureKey = oldTextureKey.replace(/(?:-runtime-\d+)+$/, '');
    const nextTextureKey = `${baseTextureKey}-runtime-${this.runtimeRoomTextureRevision}`;

    if (this.scene.textures.exists(nextTextureKey)) {
      this.scene.textures.remove(nextTextureKey);
    }

    buildRoomSnapshotTexture(
      this.scene,
      this.createLoadedRoomTerrainTextureSnapshot(loadedRoom),
      nextTextureKey,
      TILE_SIZE,
      {
        includeBackground: false,
        includeObjects: false,
        includedLayers: ['background', 'terrain'],
      },
    );

    loadedRoom.image.setTexture(nextTextureKey);
    loadedRoom.textureKey = nextTextureKey;

    const oldTextureStillUsed = Array.from(this.host.getLoadedFullRooms()).some(
      (candidate) => candidate !== loadedRoom && candidate.textureKey === oldTextureKey,
    );
    if (!oldTextureStillUsed && this.scene.textures.exists(oldTextureKey)) {
      this.scene.textures.remove(oldTextureKey);
    }
  }

  private playSpecialBrickBreakAnimation(
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
    tileX: number,
    tileY: number,
  ): void {
    const origin = this.host.getRoomOrigin(loadedRoom.room.coordinates);
    const sprite = this.scene.add.sprite(
      origin.x + tileX * TILE_SIZE + TILE_SIZE / 2,
      origin.y + tileY * TILE_SIZE + TILE_SIZE / 2,
      'brick_box',
      5,
    );
    sprite.setDepth(26);

    if (this.scene.anims.exists('brick_box_break_anim')) {
      sprite.play('brick_box_break_anim');
      sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
        sprite.destroy();
      });
      return;
    }

    sprite.destroy();
  }
}

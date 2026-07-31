import Phaser from 'phaser';
import {
  decodeTileDataValue,
  getSpecialTileKindForGid,
  isSpecialBreakableBrickGid,
  isSpecialTileKindGid,
  LAYER_NAMES,
  ROOM_HEIGHT,
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
  ROOM_WIDTH,
  TILE_SIZE,
  type LayerName,
  type SpecialTileKind,
} from '../../config';
import {
  cloneRoomSnapshot,
  roomIdFromCoordinates,
  type RoomCoordinates,
  type RoomSnapshot,
} from '../../persistence/roomModel';
import { buildRoomSnapshotTexture } from '../../visuals/roomSnapshotTexture';
import type { SfxCue } from '../../audio/sfx';
import type { OverworldMode } from '../sceneData';
import { getTerrainTileCollisionProfile } from './terrainCollision';
import type { LoadedFullRoom } from './worldStreaming';

export type PlayerGravityDirection = 'down' | 'up' | 'left' | 'right';

export interface DirectionVector {
  x: -1 | 0 | 1;
  y: -1 | 0 | 1;
}

export interface SpecialTilePlayerEnvironment {
  gravityDirection: PlayerGravityDirection;
  inWater: boolean;
  windX: -1 | 0 | 1;
  conveyorX: -1 | 0 | 1;
  onIce: boolean;
  onSticky: boolean;
  onBounce: boolean;
  onDamage: boolean;
}

const DEFAULT_PLAYER_ENVIRONMENT: Readonly<SpecialTilePlayerEnvironment> = Object.freeze({
  gravityDirection: 'down',
  inWater: false,
  windX: 0,
  conveyorX: 0,
  onIce: false,
  onSticky: false,
  onBounce: false,
  onDamage: false,
});

const BOUNCE_TILE_VELOCITY = -392;
const BOUNCE_TILE_COOLDOWN_MS = 180;
const BOUNCE_TILE_LAUNCH_GRACE_MS = 180;
const DAMAGE_TILE_COOLDOWN_MS = 600;
const ONE_WAY_DROP_THROUGH_MS = 240;
const ONE_WAY_DROP_THROUGH_VELOCITY = 86;
const WIND_ZONE_SCAN_PADDING_PX = 8;
const BUTT_STOMP_BRICK_BOUNCE_VELOCITY = -150;
const BUTT_STOMP_BRICK_TOP_TOLERANCE_PX = 12;
const BUTT_STOMP_BRICK_MIN_HORIZONTAL_OVERLAP_PX = 3;

const GRAVITY_DIRECTION_BY_TILE_KIND: Partial<Record<SpecialTileKind, PlayerGravityDirection>> = {
  gravityUp: 'up',
  gravityDown: 'down',
  gravityLeft: 'left',
  gravityRight: 'right',
};

interface OverworldSpecialTilesControllerHost<TLiveObject, TEdgeWall> {
  getMode: () => OverworldMode;
  getCurrentTime: () => number;
  getPlayerBody: () => Phaser.Physics.Arcade.Body | null;
  getLoadedFullRooms: () => Iterable<LoadedFullRoom<TLiveObject, TEdgeWall>>;
  getLoadedFullRoomById: (roomId: string) => LoadedFullRoom<TLiveObject, TEdgeWall> | null;
  getRoomCoordinatesForPoint: (x: number, y: number) => RoomCoordinates;
  getRoomOrigin: (coordinates: RoomCoordinates) => { x: number; y: number };
  grantExternalLaunchGrace: (durationMs: number) => void;
  isPlayerButtStomping: () => boolean;
  handlePlayerButtStompImpact: (bounceVelocity: number) => void;
  handlePlayerDeath: (reason: string) => void;
  playBounceFx: (
    x: number,
    y: number,
    roomCoordinates: RoomCoordinates,
    cue?: SfxCue | null
  ) => void;
}

interface SpecialTileMatch<TLiveObject, TEdgeWall> {
  loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>;
  layerName: LayerName;
  tileX: number;
  tileY: number;
  kind: SpecialTileKind;
}

export function getGravityVector(direction: PlayerGravityDirection): DirectionVector {
  switch (direction) {
    case 'up':
      return { x: 0, y: -1 };
    case 'left':
      return { x: -1, y: 0 };
    case 'right':
      return { x: 1, y: 0 };
    case 'down':
    default:
      return { x: 0, y: 1 };
  }
}

export function getGravityRightVector(direction: PlayerGravityDirection): DirectionVector {
  switch (direction) {
    case 'up':
      return { x: -1, y: 0 };
    case 'left':
      return { x: 0, y: -1 };
    case 'right':
      return { x: 0, y: 1 };
    case 'down':
    default:
      return { x: 1, y: 0 };
  }
}

export function getGravityAngle(direction: PlayerGravityDirection): number {
  switch (direction) {
    case 'up':
      return Math.PI;
    case 'left':
      return Math.PI / 2;
    case 'right':
      return -Math.PI / 2;
    case 'down':
    default:
      return 0;
  }
}

export function getBodyVelocityAlongVector(
  body: Phaser.Physics.Arcade.Body,
  vector: DirectionVector,
): number {
  return body.velocity.x * vector.x + body.velocity.y * vector.y;
}

export function setBodyVelocityAlongVector(
  body: Phaser.Physics.Arcade.Body,
  vector: DirectionVector,
  velocity: number,
): void {
  const current = getBodyVelocityAlongVector(body, vector);
  body.setVelocity(
    body.velocity.x + (velocity - current) * vector.x,
    body.velocity.y + (velocity - current) * vector.y,
  );
}

export function bodyIsBlockedInGravityDirection(
  body: Phaser.Physics.Arcade.Body,
  direction: PlayerGravityDirection,
): boolean {
  switch (direction) {
    case 'up':
      return Boolean(body.blocked.up || body.touching.up);
    case 'left':
      return Boolean(body.blocked.left || body.touching.left);
    case 'right':
      return Boolean(body.blocked.right || body.touching.right);
    case 'down':
    default:
      return Boolean(body.blocked.down || body.touching.down);
  }
}

function resetEnvironment(
  environment: SpecialTilePlayerEnvironment,
  gravityDirection: PlayerGravityDirection,
): SpecialTilePlayerEnvironment {
  environment.gravityDirection = gravityDirection;
  environment.inWater = false;
  environment.windX = 0;
  environment.conveyorX = 0;
  environment.onIce = false;
  environment.onSticky = false;
  environment.onBounce = false;
  environment.onDamage = false;
  return environment;
}

export class OverworldSpecialTilesController<TLiveObject = unknown, TEdgeWall = unknown> {
  private runtimeRoomTextureRevision = 0;
  private bounceCooldownUntil = 0;
  private damageCooldownUntil = 0;
  private oneWayDropThroughUntil = 0;
  private readonly playerEnvironment: SpecialTilePlayerEnvironment = {
    ...DEFAULT_PLAYER_ENVIRONMENT,
  };
  private readonly bodyEnvironments = new WeakMap<
    Phaser.Physics.Arcade.Body,
    SpecialTilePlayerEnvironment
  >();
  private latchedGravityDirection: PlayerGravityDirection = 'down';
  private latchedGravityRoomId: string | null = null;
  private readonly brokenSpecialBrickTileKeysByRoomId = new Map<string, Set<string>>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly host: OverworldSpecialTilesControllerHost<TLiveObject, TEdgeWall>,
  ) {}

  update(): void {
    if (this.host.getMode() !== 'play') {
      resetEnvironment(this.playerEnvironment, 'down');
      this.resetGravityLatch();
      return;
    }

    this.scanPlayerEnvironment(this.playerEnvironment);
    this.applyImmediatePlayerEffects();
    this.maybeBreakSpecialBrickTile();
  }

  getPlayerEnvironment(): Readonly<SpecialTilePlayerEnvironment> {
    return this.playerEnvironment;
  }

  getEnvironmentForBody(
    body: Phaser.Physics.Arcade.Body,
    currentGravityDirection: PlayerGravityDirection = 'down',
  ): Readonly<SpecialTilePlayerEnvironment> {
    if (this.host.getMode() !== 'play') {
      return DEFAULT_PLAYER_ENVIRONMENT;
    }

    let environment = this.bodyEnvironments.get(body);
    if (!environment) {
      environment = { ...DEFAULT_PLAYER_ENVIRONMENT };
      this.bodyEnvironments.set(body, environment);
    }
    return this.scanBodyEnvironment(body, currentGravityDirection, environment);
  }

  getConveyorDirectionForBody(
    body: Phaser.Physics.Arcade.Body,
    gravityDirection: PlayerGravityDirection = 'down',
  ): -1 | 0 | 1 {
    if (this.host.getMode() !== 'play') {
      return 0;
    }

    let direction: -1 | 0 | 1 = 0;
    for (const match of this.findSpecialTilesAtGravityContact(body, gravityDirection)) {
      if (match.kind === 'conveyorLeft') {
        direction = -1;
      } else if (match.kind === 'conveyorRight') {
        direction = 1;
      }
    }
    return direction;
  }

  getBodyRoomId(body: Phaser.Physics.Arcade.Body): string {
    return roomIdFromCoordinates(
      this.host.getRoomCoordinatesForPoint(body.center.x, body.center.y),
    );
  }

  getGravityPlateDirectionForBody(
    body: Phaser.Physics.Arcade.Body,
    currentGravityDirection: PlayerGravityDirection,
  ): PlayerGravityDirection | null {
    if (this.host.getMode() !== 'play') {
      return null;
    }

    const overlapDirection = this.getGravityDirectionFromMatches(
      this.findSpecialTilesOverlappingBody(body),
    );
    if (overlapDirection) {
      return overlapDirection;
    }

    return this.getGravityDirectionFromMatches(
      this.findSpecialTilesAtGravityContact(body, currentGravityDirection),
    );
  }

  isBodyInWater(body: Phaser.Physics.Arcade.Body): boolean {
    if (this.host.getMode() !== 'play') {
      return false;
    }

    return this.findSpecialTilesOverlappingBody(body).some((match) => match.kind === 'water');
  }

  beginOneWayDropThrough(): void {
    const playerBody = this.host.getPlayerBody();
    if (!playerBody) {
      return;
    }

    this.oneWayDropThroughUntil = this.host.getCurrentTime() + ONE_WAY_DROP_THROUGH_MS;
    const gravityVector = getGravityVector(this.playerEnvironment.gravityDirection);
    const currentGravityVelocity = getBodyVelocityAlongVector(playerBody, gravityVector);
    if (currentGravityVelocity < ONE_WAY_DROP_THROUGH_VELOCITY) {
      setBodyVelocityAlongVector(playerBody, gravityVector, ONE_WAY_DROP_THROUGH_VELOCITY);
    }
  }

  shouldCollidePlayerWithTerrainTile(tile: Phaser.Tilemaps.Tile): boolean {
    const gid = tile.index;
    if (!isSpecialTileKindGid(gid, 'oneWayPlatform')) {
      return true;
    }

    if (this.host.getCurrentTime() < this.oneWayDropThroughUntil) {
      return false;
    }

    const playerBody = this.host.getPlayerBody();
    if (!playerBody) {
      return false;
    }

    const bounds = this.getTileWorldBounds(tile);
    switch (this.playerEnvironment.gravityDirection) {
      case 'down': {
        const previousBottom = (playerBody.prev?.y ?? playerBody.y) + playerBody.height;
        return (
          playerBody.velocity.y >= -12 &&
          previousBottom <= bounds.top + 6 &&
          playerBody.bottom <= bounds.top + 12
        );
      }
      case 'up': {
        const previousTop = playerBody.prev?.y ?? playerBody.y;
        return (
          playerBody.velocity.y <= 12 &&
          previousTop >= bounds.bottom - 6 &&
          playerBody.top >= bounds.bottom - 12
        );
      }
      case 'left':
      case 'right':
      default:
        return false;
    }
  }

  handleFullRoomDestroyed(roomId: string): void {
    this.brokenSpecialBrickTileKeysByRoomId.delete(roomId);
    if (this.latchedGravityRoomId === roomId) {
      this.resetGravityLatch();
    }
  }

  resetAll(): void {
    for (const loadedRoom of this.host.getLoadedFullRooms()) {
      this.resetForRoom(loadedRoom);
    }
    this.brokenSpecialBrickTileKeysByRoomId.clear();
    resetEnvironment(this.playerEnvironment, 'down');
    this.resetGravityLatch();
    this.bounceCooldownUntil = 0;
    this.damageCooldownUntil = 0;
    this.oneWayDropThroughUntil = 0;
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

  private scanPlayerEnvironment(
    environment: SpecialTilePlayerEnvironment,
  ): SpecialTilePlayerEnvironment {
    const playerBody = this.host.getPlayerBody();
    if (!playerBody) {
      this.resetGravityLatch();
      return resetEnvironment(environment, 'down');
    }

    const currentGravityRoomId = this.getPlayerGravityRoomId(playerBody);
    if (this.latchedGravityRoomId !== currentGravityRoomId) {
      this.latchedGravityRoomId = currentGravityRoomId;
      this.latchedGravityDirection = 'down';
    }

    this.scanBodyEnvironment(
      playerBody,
      this.latchedGravityDirection,
      environment,
    );
    this.latchedGravityDirection = environment.gravityDirection;
    this.latchedGravityRoomId = currentGravityRoomId;
    return environment;
  }

  private scanBodyEnvironment(
    body: Phaser.Physics.Arcade.Body,
    currentGravityDirection: PlayerGravityDirection,
    environment: SpecialTilePlayerEnvironment,
  ): SpecialTilePlayerEnvironment {
    resetEnvironment(environment, currentGravityDirection);
    const overlaps = this.findSpecialTilesOverlappingBody(body);
    environment.gravityDirection =
      this.getGravityDirectionFromMatches(overlaps) ?? environment.gravityDirection;
    for (const match of overlaps) {
      switch (match.kind) {
        case 'water':
          environment.inWater = true;
          break;
        case 'damage':
          environment.onDamage = true;
          break;
        default:
          break;
      }
    }

    for (const match of this.findSpecialTilesNearBody(body, WIND_ZONE_SCAN_PADDING_PX)) {
      if (match.kind === 'windLeft') {
        environment.windX = -1;
      } else if (match.kind === 'windRight') {
        environment.windX = 1;
      }
    }

    let surfaceMatches = this.findSpecialTilesAtGravityContact(
      body,
      environment.gravityDirection,
    );
    const contactGravityDirection = this.getGravityDirectionFromMatches(surfaceMatches);
    if (contactGravityDirection && contactGravityDirection !== environment.gravityDirection) {
      environment.gravityDirection = contactGravityDirection;
      surfaceMatches = this.findSpecialTilesAtGravityContact(
        body,
        environment.gravityDirection,
      );
    }
    for (const match of surfaceMatches) {
      switch (match.kind) {
        case 'conveyorLeft':
          environment.conveyorX = -1;
          break;
        case 'conveyorRight':
          environment.conveyorX = 1;
          break;
        case 'ice':
          environment.onIce = true;
          break;
        case 'sticky':
          environment.onSticky = true;
          break;
        case 'bounce':
          environment.onBounce = true;
          break;
        case 'damage':
          environment.onDamage = true;
          break;
        default:
          break;
      }
    }

    return environment;
  }

  private getGravityDirectionFromMatches(
    matches: Array<SpecialTileMatch<TLiveObject, TEdgeWall>>,
  ): PlayerGravityDirection | null {
    let gravityDirection: PlayerGravityDirection | null = null;
    for (const match of matches) {
      gravityDirection = GRAVITY_DIRECTION_BY_TILE_KIND[match.kind] ?? gravityDirection;
    }
    return gravityDirection;
  }

  private resetGravityLatch(): void {
    this.latchedGravityDirection = 'down';
    this.latchedGravityRoomId = null;
  }

  private getPlayerGravityRoomId(playerBody: Phaser.Physics.Arcade.Body): string {
    return roomIdFromCoordinates(
      this.host.getRoomCoordinatesForPoint(playerBody.center.x, playerBody.center.y),
    );
  }

  private applyImmediatePlayerEffects(): void {
    const playerBody = this.host.getPlayerBody();
    if (!playerBody) {
      return;
    }

    if (
      this.playerEnvironment.onDamage &&
      this.host.getCurrentTime() >= this.damageCooldownUntil
    ) {
      this.damageCooldownUntil = this.host.getCurrentTime() + DAMAGE_TILE_COOLDOWN_MS;
      this.host.handlePlayerDeath('Hazard tile hit you.');
      return;
    }

    if (!this.playerEnvironment.onBounce || this.host.getCurrentTime() < this.bounceCooldownUntil) {
      return;
    }

    const gravityVector = getGravityVector(this.playerEnvironment.gravityDirection);
    const gravityVelocity = getBodyVelocityAlongVector(playerBody, gravityVector);
    if (gravityVelocity < -24) {
      return;
    }

    this.bounceCooldownUntil = this.host.getCurrentTime() + BOUNCE_TILE_COOLDOWN_MS;
    setBodyVelocityAlongVector(playerBody, gravityVector, BOUNCE_TILE_VELOCITY);
    this.host.grantExternalLaunchGrace(BOUNCE_TILE_LAUNCH_GRACE_MS);

    const roomCoordinates = this.host.getRoomCoordinatesForPoint(playerBody.center.x, playerBody.center.y);
    this.host.playBounceFx(playerBody.center.x, playerBody.center.y, roomCoordinates, 'bounce');
  }

  private findSpecialTilesOverlappingBody(
    body: Phaser.Physics.Arcade.Body,
  ): Array<SpecialTileMatch<TLiveObject, TEdgeWall>> {
    const bounds = this.getBodyScanBounds(body, -1);
    return this.findSpecialTilesInWorldRect(bounds);
  }

  private findSpecialTilesNearBody(
    body: Phaser.Physics.Arcade.Body,
    padding: number,
  ): Array<SpecialTileMatch<TLiveObject, TEdgeWall>> {
    const bounds = this.getBodyScanBounds(body, padding);
    return this.findSpecialTilesInWorldRect(bounds);
  }

  private getBodyScanBounds(
    body: Phaser.Physics.Arcade.Body,
    padding: number,
  ): { left: number; right: number; top: number; bottom: number } {
    return {
      left: body.left - padding,
      right: body.right + padding,
      top: body.top - padding,
      bottom: body.bottom + padding,
    };
  }

  private findSpecialTilesAtGravityContact(
    body: Phaser.Physics.Arcade.Body,
    gravityDirection: PlayerGravityDirection,
  ): Array<SpecialTileMatch<TLiveObject, TEdgeWall>> {
    const inset = 2;
    const points: Array<{ x: number; y: number }> = [];
    switch (gravityDirection) {
      case 'up': {
        const y = body.top - 1;
        points.push(
          { x: body.left + inset, y },
          { x: body.center.x, y },
          { x: body.right - inset, y },
        );
        break;
      }
      case 'left': {
        const x = body.left - 1;
        points.push(
          { x, y: body.top + inset },
          { x, y: body.center.y },
          { x, y: body.bottom - inset },
        );
        break;
      }
      case 'right': {
        const x = body.right + 1;
        points.push(
          { x, y: body.top + inset },
          { x, y: body.center.y },
          { x, y: body.bottom - inset },
        );
        break;
      }
      case 'down':
      default: {
        const y = body.bottom + 1;
        points.push(
          { x: body.left + inset, y },
          { x: body.center.x, y },
          { x: body.right - inset, y },
        );
        break;
      }
    }

    const seen = new Set<string>();
    const matches: Array<SpecialTileMatch<TLiveObject, TEdgeWall>> = [];
    for (const point of points) {
      for (const match of this.findSpecialTilesAtWorldPoint(point.x, point.y)) {
        const key = `${match.loadedRoom.room.id}:${match.layerName}:${match.tileX}:${match.tileY}:${match.kind}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        matches.push(match);
      }
    }
    return matches;
  }

  private findSpecialTilesAtWorldPoint(
    worldX: number,
    worldY: number,
  ): Array<SpecialTileMatch<TLiveObject, TEdgeWall>> {
    const coordinates = this.host.getRoomCoordinatesForPoint(worldX, worldY);
    const roomId = roomIdFromCoordinates(coordinates);
    const loadedRoom = this.host.getLoadedFullRoomById(roomId);
    if (!loadedRoom) {
      return [];
    }

    const origin = this.host.getRoomOrigin(coordinates);
    const tileX = Math.floor((worldX - origin.x) / TILE_SIZE);
    const tileY = Math.floor((worldY - origin.y) / TILE_SIZE);
    if (tileX < 0 || tileX >= ROOM_WIDTH || tileY < 0 || tileY >= ROOM_HEIGHT) {
      return [];
    }

    return this.findSpecialTilesAtRoomCell(loadedRoom, tileX, tileY);
  }

  private findSpecialTilesInWorldRect(bounds: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  }): Array<SpecialTileMatch<TLiveObject, TEdgeWall>> {
    const matches: Array<SpecialTileMatch<TLiveObject, TEdgeWall>> = [];
    for (const loadedRoom of this.host.getLoadedFullRooms()) {
      const origin = this.host.getRoomOrigin(loadedRoom.room.coordinates);
      const roomLeft = origin.x;
      const roomTop = origin.y;
      const roomRight = roomLeft + ROOM_PX_WIDTH;
      const roomBottom = roomTop + ROOM_PX_HEIGHT;
      if (
        bounds.right < roomLeft ||
        bounds.left > roomRight ||
        bounds.bottom < roomTop ||
        bounds.top > roomBottom
      ) {
        continue;
      }

      const minTileX = Phaser.Math.Clamp(Math.floor((bounds.left - origin.x) / TILE_SIZE), 0, ROOM_WIDTH - 1);
      const maxTileX = Phaser.Math.Clamp(Math.floor((bounds.right - origin.x) / TILE_SIZE), 0, ROOM_WIDTH - 1);
      const minTileY = Phaser.Math.Clamp(Math.floor((bounds.top - origin.y) / TILE_SIZE), 0, ROOM_HEIGHT - 1);
      const maxTileY = Phaser.Math.Clamp(Math.floor((bounds.bottom - origin.y) / TILE_SIZE), 0, ROOM_HEIGHT - 1);

      for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
        for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
          matches.push(...this.findSpecialTilesAtRoomCell(loadedRoom, tileX, tileY));
        }
      }
    }
    return matches;
  }

  private findSpecialTilesAtRoomCell(
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
    tileX: number,
    tileY: number,
  ): Array<SpecialTileMatch<TLiveObject, TEdgeWall>> {
    const matches: Array<SpecialTileMatch<TLiveObject, TEdgeWall>> = [];
    for (const layerName of LAYER_NAMES) {
      const decoded = decodeTileDataValue(loadedRoom.room.tileData[layerName][tileY][tileX]);
      const kind = getSpecialTileKindForGid(decoded.gid);
      if (!kind) {
        continue;
      }
      matches.push({ loadedRoom, layerName, tileX, tileY, kind });
    }
    return matches;
  }

  private maybeBreakSpecialBrickTile(): void {
    const playerBody = this.host.getPlayerBody();
    if (!playerBody) {
      return;
    }
    if (this.maybeBreakSpecialBrickTileFromButtStomp(playerBody)) {
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

  private maybeBreakSpecialBrickTileFromButtStomp(
    playerBody: Phaser.Physics.Arcade.Body,
  ): boolean {
    if (!this.host.isPlayerButtStomping()) {
      return false;
    }

    const downwardDelta =
      typeof playerBody.deltaY === 'function'
        ? playerBody.deltaY()
        : playerBody.y - (playerBody.prev?.y ?? playerBody.y);
    const separatedDown = Boolean(playerBody.blocked?.down) || Boolean(playerBody.touching?.down);
    const hitFromAbove = downwardDelta > 0.5 || playerBody.velocity.y > 40 || separatedDown;
    if (!hitFromAbove) {
      return false;
    }

    const sampleY = playerBody.bottom + 1;
    const sampleXs = [
      playerBody.center.x,
      playerBody.left + 2,
      playerBody.right - 2,
    ].filter((value, index, values) => values.indexOf(value) === index);

    for (const sampleX of sampleXs) {
      const match = this.findSpecialBreakableBrickTileAtWorldPoint(sampleX, sampleY);
      if (
        !match ||
        !this.isPlayerButtStompImpactFromAbove(playerBody, match.loadedRoom, match.tileX, match.tileY)
      ) {
        continue;
      }

      this.host.handlePlayerButtStompImpact(BUTT_STOMP_BRICK_BOUNCE_VELOCITY);
      this.breakSpecialBrickTileStack(match.loadedRoom, match.tileX, match.tileY);
      return true;
    }

    return false;
  }

  private isPlayerButtStompImpactFromAbove(
    playerBody: Phaser.Physics.Arcade.Body,
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
    tileX: number,
    tileY: number,
  ): boolean {
    const bounds = this.getSpecialBrickTileWorldBounds(loadedRoom, tileX, tileY);
    const horizontalOverlap =
      Math.min(playerBody.right, bounds.right) -
      Math.max(playerBody.left, bounds.left);
    return (
      horizontalOverlap >= BUTT_STOMP_BRICK_MIN_HORIZONTAL_OVERLAP_PX &&
      playerBody.center.y < bounds.top + TILE_SIZE / 2 &&
      playerBody.bottom <= bounds.top + BUTT_STOMP_BRICK_TOP_TOLERANCE_PX
    );
  }

  private breakSpecialBrickTileStack(
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
    tileX: number,
    topTileY: number,
  ): void {
    for (let tileY = topTileY; tileY < ROOM_HEIGHT; tileY += 1) {
      if (!this.canBreakSpecialBrickTile(loadedRoom, tileX, tileY)) {
        break;
      }

      this.breakSpecialBrickTile(loadedRoom, tileX, tileY);
    }
  }

  private canBreakSpecialBrickTile(
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
    tileX: number,
    tileY: number,
  ): boolean {
    if (tileX < 0 || tileX >= ROOM_WIDTH || tileY < 0 || tileY >= ROOM_HEIGHT) {
      return false;
    }
    if (this.isSpecialBrickTileBroken(loadedRoom.room.id, tileX, tileY)) {
      return false;
    }

    const { gid } = decodeTileDataValue(loadedRoom.room.tileData.terrain[tileY][tileX]);
    return isSpecialBreakableBrickGid(gid) && Boolean(loadedRoom.terrainLayer.getTileAt(tileX, tileY));
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

    if (!this.canBreakSpecialBrickTile(loadedRoom, tileX, tileY)) {
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

  private getSpecialBrickTileWorldBounds(
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
    tileX: number,
    tileY: number,
  ): {
    left: number;
    right: number;
    top: number;
    bottom: number;
  } {
    const origin = this.host.getRoomOrigin(loadedRoom.room.coordinates);
    const left = origin.x + tileX * TILE_SIZE;
    const top = origin.y + tileY * TILE_SIZE;
    return {
      left,
      right: left + TILE_SIZE,
      top,
      bottom: top + TILE_SIZE,
    };
  }

  private getTileWorldBounds(tile: Phaser.Tilemaps.Tile): {
    left: number;
    right: number;
    top: number;
    bottom: number;
  } {
    const tileWithLayer = tile as Phaser.Tilemaps.Tile & {
      tilemapLayer?: Phaser.Tilemaps.TilemapLayer;
    };
    const layerX = tileWithLayer.tilemapLayer?.x ?? 0;
    const layerY = tileWithLayer.tilemapLayer?.y ?? 0;
    const left = tile.pixelX + layerX;
    const top = tile.pixelY + layerY;
    return {
      left,
      right: left + TILE_SIZE,
      top,
      bottom: top + TILE_SIZE,
    };
  }
}

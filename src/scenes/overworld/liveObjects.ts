import Phaser from 'phaser';
import type { SfxCue } from '../../audio/sfx';
import {
  getObjectById,
  getObjectDefaultFrame,
  getPlacedObjectLayer,
  ROOM_HEIGHT,
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
  ROOM_WIDTH,
  TILE_SIZE,
  type GameObjectConfig,
  type LayerName,
  type PlacedObject,
} from '../../config';
import type { RoomCoordinates, RoomSnapshot } from '../../persistence/roomModel';
import type { LoadedFullRoom } from './worldStreaming';
import { terrainTileCollidesAtLocalPixel } from './terrainCollision';

export type ArcadeObjectBody = Phaser.Physics.Arcade.Body | Phaser.Physics.Arcade.StaticBody;

export interface LoadedRoomObjectRuntimeState {
  baseX: number;
  baseY: number;
  initialDirectionX: number;
  directionX: number;
  elapsedMs: number;
  nextActionAt: number;
  cooldownUntil: number;
  activatedUntil: number;
  pressureActive: boolean;
  triggerLatched: boolean;
}

export interface LoadedRoomObject {
  key: string;
  placedInstanceId: string | null;
  linkedTargetInstanceId: string | null;
  containedObjectId: string | null;
  countsTowardGoals: boolean;
  config: GameObjectConfig;
  sprite: Phaser.GameObjects.Sprite;
  helpers: Phaser.GameObjects.GameObject[];
  interactions: Phaser.Physics.Arcade.Collider[];
  worldColliders: Phaser.Physics.Arcade.Collider[];
  runtime: LoadedRoomObjectRuntimeState;
}

interface OverworldLiveObjectSettings {
  bouncePadVelocity: number;
  bouncePadCooldownMs: number;
  bouncePadActiveMs: number;
  batSpeed: number;
  batWaveAmplitude: number;
  batWaveSpeed: number;
  birdSpeed: number;
  birdWaveAmplitude: number;
  birdWaveSpeed: number;
  crabSpeed: number;
  snakeSpeed: number;
  slimeSpeed: number;
  penguinSpeed: number;
  frogHopSpeed: number;
  frogHopVelocity: number;
  frogHopDelayMs: number;
  cannonFireDelayMs: number;
  cannonBulletSpeed: number;
  cannonBulletLifetimeMs: number;
  tornadoLiftVelocity: number;
  tornadoSideVelocity: number;
  tornadoCooldownMs: number;
  respawnFallDistance: number;
  enemyStompBounceVelocity: number;
}

interface OverworldLiveObjectControllerOptions {
  scene: Phaser.Scene;
  settings: OverworldLiveObjectSettings;
  getRoomOrigin: (coordinates: RoomCoordinates) => { x: number; y: number };
  getPlacedObjectRuntimeKey: (
    roomId: string,
    placedObject: RoomSnapshot['placedObjects'][number],
    placedIndex: number
  ) => string;
  isCollectedObjectKey: (key: string) => boolean;
  markCollectedObjectKey: (key: string) => void;
  getPlayer: () => Phaser.GameObjects.GameObject | null;
  getPlayerPickupSensor: () => Phaser.GameObjects.GameObject | null;
  getPlayerBody: () => Phaser.Physics.Arcade.Body | null;
  isPlayerClimbingLadder: () => boolean;
  isLadderDropRequested: () => boolean;
  getCurrentTime: () => number;
  addScore: (delta: number) => void;
  onKeyCollected: () => void;
  tryConsumeHeldKey: () => boolean;
  touchQuicksand: () => void;
  grantExternalLaunchGrace: (durationMs: number) => void;
  showTransientStatus: (message: string) => void;
  handlePlayerDeath: (reason: string) => void;
  onEnemyDefeated: (roomId: string, enemyName: string) => boolean;
  onCollectibleCollected: (roomId: string) => void;
  playEnemyKillFx: (x: number, y: number) => void;
  playCollectFx: (x: number, y: number, scoreDelta: number, cue?: SfxCue) => void;
  playBounceFx: (x: number, y: number) => void;
  playBombExplosionFx: (x: number, y: number) => void;
}

interface CreateLiveObjectEntryOptions {
  key: string;
  config: GameObjectConfig;
  x: number;
  y: number;
  facing?: 'left' | 'right';
  layer?: LayerName;
  baseTimeSeed?: number;
  placedInstanceId: string | null;
  linkedTargetInstanceId: string | null;
  containedObjectId: string | null;
  countsTowardGoals: boolean;
}

export function isDynamicArcadeBody(body: ArcadeObjectBody | null): body is Phaser.Physics.Arcade.Body {
  return Boolean(body && 'velocity' in body);
}

export interface WeaponHitResult {
  roomId: string;
  enemyName: string;
  x: number;
  y: number;
}

const CANNON_BULLET_CONFIG: GameObjectConfig = {
  id: 'cannon_bullet',
  name: 'Cannon Bullet',
  category: 'hazard',
  path: 'assets/enemies/bullet.png',
  frameWidth: 16,
  frameHeight: 16,
  frameCount: 1,
  fps: 0,
  defaultFrame: 0,
  facingDirection: 'left',
  bodyWidth: 10,
  bodyHeight: 10,
  behavior: 'animated',
  description: 'Internal cannon projectile.',
};

const BOUNCE_PAD_LAUNCH_GRACE_MS = 180;
const TORNADO_LAUNCH_GRACE_MS = 280;
const LIGHTNING_ACTIVE_MS = 190;
const LIGHTNING_COOLDOWN_MS = 1150;

export class OverworldLiveObjectController<TEdgeWall = unknown> {
  constructor(private readonly options: OverworldLiveObjectControllerOptions) {}

  createLiveObjects(loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>): void {
    for (let index = 0; index < loadedRoom.room.placedObjects.length; index += 1) {
      const placedObject = loadedRoom.room.placedObjects[index];
      const config = getObjectById(placedObject.id);
      if (!config) {
        continue;
      }

      const objectKey = this.options.getPlacedObjectRuntimeKey(loadedRoom.room.id, placedObject, index);
      if (this.options.isCollectedObjectKey(objectKey)) {
        continue;
      }

      const liveObject = this.createLiveObjectEntry(loadedRoom, {
        key: objectKey,
        config,
        x: placedObject.x,
        y: placedObject.y,
        facing: placedObject.facing,
        layer: placedObject.layer,
        baseTimeSeed: placedObject.x + placedObject.y,
        placedInstanceId: placedObject.instanceId,
        linkedTargetInstanceId: placedObject.triggerTargetInstanceId ?? null,
        containedObjectId: placedObject.containedObjectId ?? null,
        countsTowardGoals: true,
      });
      if (liveObject) {
        loadedRoom.liveObjects.push(liveObject);
      }
    }

    this.syncRoomObjectWorldColliders(loadedRoom);
  }

  destroyLiveObjects(loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>): void {
    for (const liveObject of loadedRoom.liveObjects) {
      this.destroyLiveObjectInteractions(liveObject);
      this.destroyLiveObjectWorldColliders(liveObject);
      this.destroyLiveObjectHelpers(liveObject);
      liveObject.sprite.destroy();
    }

    loadedRoom.liveObjects = [];
  }

  clearRoomInteractions(loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>): void {
    for (const liveObject of loadedRoom.liveObjects) {
      this.destroyLiveObjectInteractions(liveObject);
    }
  }

  private createLiveObjectEntry(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    options: CreateLiveObjectEntryOptions,
  ): LoadedRoomObject | null {
    const roomOrigin = this.options.getRoomOrigin(loadedRoom.room.coordinates);
    const {
      key,
      config,
      x,
      y,
      facing,
      layer,
      baseTimeSeed = 0,
      placedInstanceId,
      linkedTargetInstanceId,
      containedObjectId,
      countsTowardGoals,
    } = options;
    const sprite = this.options.scene.add.sprite(
      roomOrigin.x + x,
      roomOrigin.y + y,
      config.id,
      getObjectDefaultFrame(config)
    );
    sprite.setOrigin(0.5, 0.5);
    sprite.setDepth(this.getPlacedObjectRuntimeDepth({ layer }));

    if (config.frameCount > 1 && config.fps > 0) {
      const animationKey = `${config.id}_anim`;
      if (this.options.scene.anims.exists(animationKey)) {
        sprite.play(animationKey);
      }
    }

    if (config.id === 'lightning') {
      sprite.stop();
      sprite.setVisible(false);
    }
    if (config.id === 'door_metal') {
      sprite.setTint(0xb8c4d8);
    }

    if (config.bodyWidth > 0 && config.bodyHeight > 0) {
      if (this.usesDynamicObjectBody(config)) {
        this.options.scene.physics.add.existing(sprite);
        const body = sprite.body as Phaser.Physics.Arcade.Body;
        body.setSize(config.bodyWidth, config.bodyHeight, true);
        body.setOffset(...this.getObjectBodyOffset(config));
        body.setCollideWorldBounds(false);
        body.setAllowGravity(this.objectUsesGravity(config));
        if (config.id === 'crate') {
          body.setBounce(0, 0);
          body.setDragX(900);
          body.setMaxVelocity(120, 500);
        }
      } else {
        this.options.scene.physics.add.existing(sprite, true);
        const body = sprite.body as Phaser.Physics.Arcade.StaticBody;
        body.updateFromGameObject();
        body.setSize(config.bodyWidth, config.bodyHeight);
        body.setOffset(...this.getObjectBodyOffset(config));
      }
    }

    const initialDirectionX =
      facing === 'right'
        ? 1
        : facing === 'left'
          ? -1
          : x <= ROOM_PX_WIDTH * 0.5
            ? 1
            : -1;
    this.applyDirectionalFacing(sprite, config, initialDirectionX);
    const helpers: Phaser.GameObjects.GameObject[] = [];
    if (config.id === 'ladder') {
      const supportZone = this.createLadderTopSupport(sprite);
      if (supportZone) {
        helpers.push(supportZone);
      }
    }

    return {
      key,
      placedInstanceId,
      linkedTargetInstanceId,
      containedObjectId,
      countsTowardGoals,
      config,
      sprite,
      helpers,
      interactions: [],
      worldColliders: [],
      runtime: {
        baseX: sprite.x,
        baseY: sprite.y,
        initialDirectionX,
        directionX: initialDirectionX,
        elapsedMs: 0,
        nextActionAt:
          config.id === 'frog'
            ? this.options.getCurrentTime() + 250
            : config.id === 'cannon'
              ? this.options.getCurrentTime() + 700
              : config.id === 'lightning'
                ? this.options.getCurrentTime() + (baseTimeSeed % 500)
                : this.options.getCurrentTime(),
        cooldownUntil: 0,
        activatedUntil: 0,
        pressureActive: false,
        triggerLatched: false,
      },
    };
  }

  syncLiveObjectInteractions(loadedRooms: Iterable<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>): void {
    for (const loadedRoom of loadedRooms) {
      for (const liveObject of loadedRoom.liveObjects) {
        this.destroyLiveObjectInteractions(liveObject);

        const player = this.options.getPlayer();
        const playerPickupSensor = this.options.getPlayerPickupSensor();
        const playerBody = this.options.getPlayerBody();
        if (!player || !playerBody || !liveObject.sprite.active || !liveObject.sprite.body) {
          continue;
        }

        switch (liveObject.config.category) {
          case 'collectible':
            if (!playerPickupSensor) {
              break;
            }
            liveObject.interactions.push(
              this.options.scene.physics.add.overlap(playerPickupSensor, liveObject.sprite, () => {
                this.collectLiveObject(loadedRoom, liveObject);
              })
            );
            break;
          case 'hazard':
            if (liveObject.config.id === 'quicksand') {
              liveObject.interactions.push(
                this.options.scene.physics.add.overlap(player, liveObject.sprite, () => {
                  this.options.touchQuicksand();
                })
              );
            } else if (liveObject.config.id === 'bomb') {
              liveObject.interactions.push(
                this.options.scene.physics.add.overlap(player, liveObject.sprite, () => {
                  this.triggerBombExplosion(liveObject);
                })
              );
            } else if (liveObject.config.id === 'tornado' || liveObject.config.id === 'tornado_sand') {
              liveObject.interactions.push(
                this.options.scene.physics.add.overlap(player, liveObject.sprite, () => {
                  this.triggerTornadoLaunch(liveObject);
                })
              );
            } else {
              liveObject.interactions.push(
                this.options.scene.physics.add.overlap(player, liveObject.sprite, () => {
                  this.options.handlePlayerDeath(`${liveObject.config.name} hit you.`);
                })
              );
            }
            break;
          case 'enemy':
            liveObject.interactions.push(
              this.options.scene.physics.add.overlap(player, liveObject.sprite, () => {
                this.handleEnemyContact(loadedRoom, liveObject);
              })
            );
            break;
          case 'platform':
            liveObject.interactions.push(this.options.scene.physics.add.collider(player, liveObject.sprite));
            break;
          case 'interactive':
            if (liveObject.config.id === 'ladder') {
              const supportZone = liveObject.helpers[0];
              if (supportZone && supportZone.body) {
                liveObject.interactions.push(
                  this.options.scene.physics.add.collider(
                    player,
                    supportZone,
                    undefined,
                    () => this.shouldCollideWithLadderTopSupport(playerBody, supportZone.body as ArcadeObjectBody),
                  )
                );
              }
            } else if (liveObject.config.id === 'bounce_pad') {
              liveObject.interactions.push(
                this.options.scene.physics.add.overlap(player, liveObject.sprite, () => {
                  const padBody = liveObject.sprite.body as ArcadeObjectBody | null;
                  const activePlayerBody = this.options.getPlayerBody();
                  if (!activePlayerBody || !padBody) {
                    return;
                  }

                  if (
                    this.options.getCurrentTime() < liveObject.runtime.cooldownUntil ||
                    activePlayerBody.velocity.y < -24
                  ) {
                    return;
                  }

                  const playerBottom = activePlayerBody.bottom;
                  const padTop = padBody.top;
                  if (playerBottom > padTop + 12) {
                    return;
                  }

                  liveObject.runtime.cooldownUntil =
                    this.options.getCurrentTime() + this.options.settings.bouncePadCooldownMs;
                  liveObject.runtime.activatedUntil =
                    this.options.getCurrentTime() + this.options.settings.bouncePadActiveMs;
                  activePlayerBody.setVelocityY(this.options.settings.bouncePadVelocity);
                  this.options.grantExternalLaunchGrace(BOUNCE_PAD_LAUNCH_GRACE_MS);
                  this.options.playBounceFx(liveObject.sprite.x, liveObject.sprite.y - 2);
                  this.options.showTransientStatus('Bounce pad launched you.');
                })
              );
            } else if (liveObject.config.id === 'door_locked') {
              liveObject.interactions.push(
                this.options.scene.physics.add.collider(player, liveObject.sprite, () => {
                  if (this.options.tryConsumeHeldKey()) {
                    this.options.playBounceFx(liveObject.sprite.x, liveObject.sprite.y - 6);
                    this.options.showTransientStatus('Unlocked the door.');
                    this.removeLiveObject(loadedRoom, liveObject);
                    return;
                  }

                  if (this.options.getCurrentTime() >= liveObject.runtime.cooldownUntil) {
                    liveObject.runtime.cooldownUntil = this.options.getCurrentTime() + 900;
                    this.options.showTransientStatus('Need a key.');
                  }
                })
              );
            }
            break;
          default:
            break;
        }
      }
    }
  }

  updateLiveObjects(
    loadedRooms: Iterable<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>,
    delta: number
  ): void {
    const rooms = Array.from(loadedRooms);

    for (const loadedRoom of rooms) {
      for (const liveObject of loadedRoom.liveObjects) {
        if (!liveObject.sprite.active) {
          continue;
        }

        switch (liveObject.config.id) {
          case 'bat':
            this.updateFlyingEnemyObject(
              loadedRoom.room,
              liveObject,
              delta,
              this.options.settings.batSpeed,
              this.options.settings.batWaveAmplitude,
              this.options.settings.batWaveSpeed
            );
            break;
          case 'bird':
            this.updateFlyingEnemyObject(
              loadedRoom.room,
              liveObject,
              delta,
              this.options.settings.birdSpeed,
              this.options.settings.birdWaveAmplitude,
              this.options.settings.birdWaveSpeed
            );
            break;
          case 'fish':
            this.updateFlyingEnemyObject(
              loadedRoom.room,
              liveObject,
              delta,
              this.options.settings.birdSpeed * 0.58,
              3,
              0.008
            );
            break;
          case 'shark':
            this.updateFlyingEnemyObject(
              loadedRoom.room,
              liveObject,
              delta,
              this.options.settings.birdSpeed * 0.82,
              3,
              0.006
            );
            break;
          case 'crab':
          case 'slime_blue':
          case 'slime_red':
          case 'snake':
          case 'penguin':
          case 'bear_brown':
          case 'bear_polar':
          case 'chicken':
            this.updatePatrolEnemy(loadedRoom.room, liveObject);
            break;
          case 'frog':
            this.updateFrogEnemy(loadedRoom.room, liveObject);
            break;
          case 'cannon':
            this.updateCannonObject(loadedRoom, liveObject);
            break;
          case 'cannon_bullet':
            this.updateCannonBullet(loadedRoom, liveObject);
            break;
          case 'bomb':
            this.updateBombObject(liveObject);
            break;
          case 'lightning':
            this.updateLightningObject(liveObject);
            break;
          case 'bounce_pad':
            this.updateBouncePadObject(liveObject);
            break;
          default:
            break;
        }
      }
    }

    this.updatePressurePlates(rooms);
  }

  findOverlappingLadder(
    loadedRooms: Iterable<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>
  ): LoadedRoomObject | null {
    const playerBody = this.options.getPlayerBody();
    if (!playerBody) {
      return null;
    }

    const playerBounds = this.getArcadeBodyBounds(playerBody);
    let closestLadder: LoadedRoomObject | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const loadedRoom of loadedRooms) {
      for (const liveObject of loadedRoom.liveObjects) {
        if (liveObject.config.id !== 'ladder' || !liveObject.sprite.active || !liveObject.sprite.body) {
          continue;
        }

        const ladderBounds = this.getArcadeBodyBounds(liveObject.sprite.body as ArcadeObjectBody);
        if (!Phaser.Geom.Intersects.RectangleToRectangle(playerBounds, ladderBounds)) {
          continue;
        }

        const distance =
          Math.abs(liveObject.sprite.x - playerBody.center.x) +
          Math.abs(liveObject.sprite.y - playerBody.center.y);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestLadder = liveObject;
        }
      }
    }

    return closestLadder;
  }

  attackEnemiesInRect(
    loadedRooms: Iterable<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>,
    attackRect: Phaser.Geom.Rectangle,
    maxHits = Number.POSITIVE_INFINITY
  ): WeaponHitResult[] {
    const hits: WeaponHitResult[] = [];

    for (const loadedRoom of loadedRooms) {
      for (const liveObject of [...loadedRoom.liveObjects]) {
        if (
          liveObject.config.category !== 'enemy' ||
          !liveObject.sprite.active ||
          !liveObject.sprite.body
        ) {
          continue;
        }

        const enemyBounds = this.getArcadeBodyBounds(liveObject.sprite.body as ArcadeObjectBody);
        if (!Phaser.Geom.Intersects.RectangleToRectangle(attackRect, enemyBounds)) {
          continue;
        }

        const hit = this.defeatEnemy(loadedRoom, liveObject);
        if (!hit) {
          continue;
        }

        hits.push(hit);
        if (hits.length >= maxHits) {
          return hits;
        }
      }
    }

    return hits;
  }

  attackEnemyAtPoint(
    loadedRooms: Iterable<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>,
    x: number,
    y: number,
    radius = 6
  ): WeaponHitResult | null {
    const attackRect = new Phaser.Geom.Rectangle(x - radius, y - radius, radius * 2, radius * 2);
    return this.attackEnemiesInRect(loadedRooms, attackRect, 1)[0] ?? null;
  }

  private updatePressurePlates(
    loadedRooms: LoadedFullRoom<LoadedRoomObject, TEdgeWall>[]
  ): void {
    const activeTargetIds = new Set<string>();

    for (const loadedRoom of loadedRooms) {
      for (const liveObject of loadedRoom.liveObjects) {
        if (liveObject.config.id !== 'floor_trigger' || !liveObject.sprite.active) {
          continue;
        }

        const pressed = this.isPressurePlatePressed(liveObject, loadedRooms);
        liveObject.runtime.pressureActive = pressed;
        if (liveObject.config.frameCount > 1) {
          liveObject.sprite.setFrame(pressed ? 1 : 0);
        }
        if (pressed && liveObject.linkedTargetInstanceId) {
          activeTargetIds.add(liveObject.linkedTargetInstanceId);
        }
      }
    }

    for (const loadedRoom of loadedRooms) {
      for (const liveObject of [...loadedRoom.liveObjects]) {
        const placedInstanceId = liveObject.placedInstanceId;
        const active = placedInstanceId ? activeTargetIds.has(placedInstanceId) : false;

        switch (liveObject.config.id) {
          case 'door_metal':
            this.applyPressureDoorState(liveObject, active);
            break;
          case 'door_locked':
            if (active) {
              this.triggerLinkedLockedDoor(loadedRoom, liveObject);
            }
            break;
          case 'cage':
            if (active) {
              this.openTriggeredCage(loadedRoom, liveObject);
            }
            break;
          case 'treasure_chest':
            if (active) {
              this.openTriggeredChest(loadedRoom, liveObject);
            }
            break;
          default:
            break;
        }
      }
    }
  }

  private isPressurePlatePressed(
    trigger: LoadedRoomObject,
    loadedRooms: LoadedFullRoom<LoadedRoomObject, TEdgeWall>[]
  ): boolean {
    const triggerBounds = this.getPressurePlateBounds(trigger);
    const playerBody = this.options.getPlayerBody();
    if (playerBody && Phaser.Geom.Intersects.RectangleToRectangle(triggerBounds, this.getArcadeBodyBounds(playerBody))) {
      return true;
    }

    for (const loadedRoom of loadedRooms) {
      for (const liveObject of loadedRoom.liveObjects) {
        if (
          liveObject === trigger ||
          !liveObject.sprite.active ||
          !liveObject.sprite.body ||
          !this.canActivatePressurePlate(liveObject)
        ) {
          continue;
        }

        const body = liveObject.sprite.body as ArcadeObjectBody;
        if (
          Phaser.Geom.Intersects.RectangleToRectangle(
            triggerBounds,
            this.getArcadeBodyBounds(body)
          )
        ) {
          return true;
        }
      }
    }

    return false;
  }

  private canActivatePressurePlate(liveObject: LoadedRoomObject): boolean {
    return liveObject.config.id === 'crate' || liveObject.config.category === 'enemy';
  }

  private getPressurePlateBounds(liveObject: LoadedRoomObject): Phaser.Geom.Rectangle {
    return new Phaser.Geom.Rectangle(liveObject.sprite.x - 8, liveObject.sprite.y + 2, 16, 8);
  }

  private applyPressureDoorState(liveObject: LoadedRoomObject, open: boolean): void {
    const body = liveObject.sprite.body as ArcadeObjectBody | null;
    if (body) {
      body.enable = !open;
      if (!open && 'updateFromGameObject' in body) {
        body.updateFromGameObject();
      }
    }

    liveObject.sprite.setAlpha(open ? 0.28 : 1);
    liveObject.sprite.setTint(open ? 0x8ea0ba : 0xb8c4d8);
  }

  private triggerLinkedLockedDoor(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject
  ): void {
    if (liveObject.runtime.triggerLatched) {
      return;
    }

    liveObject.runtime.triggerLatched = true;
    this.options.playBounceFx(liveObject.sprite.x, liveObject.sprite.y - 6);
    this.removeLiveObject(loadedRoom, liveObject);
  }

  private openTriggeredCage(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject
  ): void {
    if (liveObject.runtime.triggerLatched) {
      return;
    }

    liveObject.runtime.triggerLatched = true;
    if (liveObject.config.frameCount > 0) {
      liveObject.sprite.setFrame(Math.max(0, liveObject.config.frameCount - 1));
    }
    this.setLiveObjectBodyEnabled(liveObject, false);
    if (liveObject.containedObjectId && getObjectById(liveObject.containedObjectId)?.category === 'enemy') {
      this.spawnTriggeredObject(loadedRoom, liveObject.containedObjectId, {
        x: liveObject.sprite.x - this.options.getRoomOrigin(loadedRoom.room.coordinates).x,
        y: liveObject.sprite.y + 2 - this.options.getRoomOrigin(loadedRoom.room.coordinates).y,
        facing: 'right',
        countsTowardGoals: true,
      });
    }
    this.syncRoomObjectWorldColliders(loadedRoom);
  }

  private openTriggeredChest(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject
  ): void {
    if (liveObject.runtime.triggerLatched) {
      return;
    }

    liveObject.runtime.triggerLatched = true;
    if (liveObject.config.frameCount > 0) {
      liveObject.sprite.setFrame(Math.max(0, liveObject.config.frameCount - 1));
    }
    if (
      liveObject.containedObjectId &&
      getObjectById(liveObject.containedObjectId)?.category === 'collectible'
    ) {
      const roomOrigin = this.options.getRoomOrigin(loadedRoom.room.coordinates);
      this.spawnTriggeredObject(loadedRoom, liveObject.containedObjectId, {
        x: liveObject.sprite.x - roomOrigin.x,
        y: liveObject.sprite.y - roomOrigin.y - 12,
        countsTowardGoals: true,
      });
    }
  }

  private setLiveObjectBodyEnabled(liveObject: LoadedRoomObject, enabled: boolean): void {
    const body = liveObject.sprite.body as ArcadeObjectBody | null;
    if (!body) {
      return;
    }

    body.enable = enabled;
    if (enabled && 'updateFromGameObject' in body) {
      body.updateFromGameObject();
    }
  }

  private spawnTriggeredObject(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    objectId: string,
    options: {
      x: number;
      y: number;
      facing?: 'left' | 'right';
      countsTowardGoals: boolean;
    }
  ): void {
    const config = getObjectById(objectId);
    if (!config) {
      return;
    }

    const liveObject = this.createLiveObjectEntry(loadedRoom, {
      key: `trigger:${objectId}:${this.options.getCurrentTime()}:${Math.round(options.x)}:${Math.round(options.y)}`,
      config,
      x: options.x,
      y: options.y,
      facing: options.facing,
      layer: 'terrain',
      baseTimeSeed: options.x + options.y,
      placedInstanceId: null,
      linkedTargetInstanceId: null,
      containedObjectId: null,
      countsTowardGoals: options.countsTowardGoals,
    });
    if (!liveObject) {
      return;
    }

    loadedRoom.liveObjects.push(liveObject);
    this.syncRoomObjectWorldColliders(loadedRoom);
  }

  private destroyLiveObjectInteractions(liveObject: LoadedRoomObject): void {
    for (const interaction of liveObject.interactions) {
      interaction.destroy();
    }
    liveObject.interactions = [];
  }

  private destroyLiveObjectHelpers(liveObject: LoadedRoomObject): void {
    for (const helper of liveObject.helpers) {
      helper.destroy();
    }
    liveObject.helpers = [];
  }

  private destroyLiveObjectWorldColliders(liveObject: LoadedRoomObject): void {
    for (const collider of liveObject.worldColliders) {
      collider.destroy();
    }
    liveObject.worldColliders = [];
  }

  private syncRoomObjectWorldColliders(loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>): void {
    const solidPlatforms = loadedRoom.liveObjects.filter(
      (candidate) => candidate.config.category === 'platform' && candidate.sprite.body
    );

    for (const liveObject of loadedRoom.liveObjects) {
      this.destroyLiveObjectWorldColliders(liveObject);

      if (!this.usesDynamicObjectBody(liveObject.config) || !liveObject.sprite.body) {
        continue;
      }

      liveObject.worldColliders.push(
        this.options.scene.physics.add.collider(liveObject.sprite, loadedRoom.terrainLayer)
      );
      if (loadedRoom.terrainInsetBodies) {
        liveObject.worldColliders.push(
          this.options.scene.physics.add.collider(liveObject.sprite, loadedRoom.terrainInsetBodies)
        );
      }
      for (const platform of solidPlatforms) {
        if (!platform.sprite.active || !platform.sprite.body) {
          continue;
        }

        if (platform === liveObject) {
          continue;
        }

        liveObject.worldColliders.push(
          this.options.scene.physics.add.collider(liveObject.sprite, platform.sprite)
        );
      }
    }
  }

  private updateFlyingEnemyObject(
    room: RoomSnapshot,
    liveObject: LoadedRoomObject,
    delta: number,
    speed: number,
    waveAmplitude: number,
    waveSpeed: number
  ): void {
    const body = liveObject.sprite.body as Phaser.Physics.Arcade.StaticBody | null;
    if (!body) {
      return;
    }

    const bounds = this.getObjectHorizontalTravelBounds(room, liveObject.config);
    liveObject.runtime.elapsedMs += delta;

    let nextX = liveObject.sprite.x + liveObject.runtime.directionX * speed * (delta / 1000);
    if (nextX <= bounds.left || nextX >= bounds.right) {
      nextX = Phaser.Math.Clamp(nextX, bounds.left, bounds.right);
      liveObject.runtime.directionX *= -1;
    }

    const nextY =
      liveObject.runtime.baseY +
      Math.sin(liveObject.runtime.elapsedMs * waveSpeed) * waveAmplitude;
    liveObject.sprite.setPosition(nextX, nextY);
    this.applyDirectionalFacing(liveObject.sprite, liveObject.config, liveObject.runtime.directionX);
    body.updateFromGameObject();
  }

  private updatePatrolEnemy(room: RoomSnapshot, liveObject: LoadedRoomObject): void {
    const body = this.getDynamicBody(liveObject.sprite);
    if (!body) {
      return;
    }

    if (this.resetDynamicObjectIfOutOfBounds(room, liveObject, body)) {
      return;
    }

    this.maybeReverseGroundEnemy(room, liveObject, body);
    this.applyDirectionalFacing(liveObject.sprite, liveObject.config, liveObject.runtime.directionX);
    body.setVelocityX(liveObject.runtime.directionX * this.getGroundEnemySpeed(liveObject.config.id));
  }

  private updateFrogEnemy(room: RoomSnapshot, liveObject: LoadedRoomObject): void {
    const body = this.getDynamicBody(liveObject.sprite);
    if (!body) {
      return;
    }

    if (this.resetDynamicObjectIfOutOfBounds(room, liveObject, body)) {
      return;
    }

    this.maybeReverseGroundEnemy(room, liveObject, body);
    const onFloor = body.blocked.down || body.touching.down;

    if (onFloor) {
      this.applyDirectionalFacing(liveObject.sprite, liveObject.config, liveObject.runtime.directionX);
      if (this.options.getCurrentTime() >= liveObject.runtime.nextActionAt) {
        body.setVelocityX(liveObject.runtime.directionX * this.options.settings.frogHopSpeed);
        body.setVelocityY(this.options.settings.frogHopVelocity);
        liveObject.runtime.nextActionAt =
          this.options.getCurrentTime() + this.options.settings.frogHopDelayMs;
      } else {
        body.setVelocityX(0);
      }
      return;
    }

    this.applyDirectionalFacing(liveObject.sprite, liveObject.config, liveObject.runtime.directionX);
    if (Math.abs(body.velocity.x) < this.options.settings.frogHopSpeed * 0.8) {
      body.setVelocityX(liveObject.runtime.directionX * this.options.settings.frogHopSpeed);
    }
  }

  private updateCannonObject(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject
  ): void {
    this.applyDirectionalFacing(liveObject.sprite, liveObject.config, liveObject.runtime.directionX);

    if (this.options.getCurrentTime() < liveObject.runtime.nextActionAt) {
      return;
    }

    liveObject.runtime.nextActionAt =
      this.options.getCurrentTime() + this.options.settings.cannonFireDelayMs;
    this.spawnCannonBullet(loadedRoom, liveObject);
  }

  private updateCannonBullet(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject
  ): void {
    const body = this.getDynamicBody(liveObject.sprite);
    if (!body) {
      this.removeLiveObject(loadedRoom, liveObject);
      return;
    }

    if (this.options.getCurrentTime() >= liveObject.runtime.activatedUntil) {
      this.removeLiveObject(loadedRoom, liveObject);
      return;
    }

    body.setVelocityX(liveObject.runtime.directionX * this.options.settings.cannonBulletSpeed);
    this.applyDirectionalFacing(liveObject.sprite, liveObject.config, liveObject.runtime.directionX);

    const roomOrigin = this.options.getRoomOrigin(loadedRoom.room.coordinates);
    if (
      liveObject.sprite.x < roomOrigin.x - TILE_SIZE ||
      liveObject.sprite.x > roomOrigin.x + ROOM_PX_WIDTH + TILE_SIZE
    ) {
      this.removeLiveObject(loadedRoom, liveObject);
    }
  }

  private updateBouncePadObject(liveObject: LoadedRoomObject): void {
    if (liveObject.config.frameCount <= 1) {
      return;
    }

    const nextFrame = this.options.getCurrentTime() < liveObject.runtime.activatedUntil ? 1 : 0;
    if (Number(liveObject.sprite.frame.name) !== nextFrame) {
      liveObject.sprite.setFrame(nextFrame);
    }
  }

  private updateBombObject(liveObject: LoadedRoomObject): void {
    const body = liveObject.sprite.body as ArcadeObjectBody | null;
    const exploded = this.options.getCurrentTime() < liveObject.runtime.cooldownUntil;
    const shouldBeVisible = !exploded;
    if (liveObject.sprite.visible !== shouldBeVisible) {
      liveObject.sprite.setVisible(shouldBeVisible);
    }

    if (body) {
      body.enable = shouldBeVisible;
      if (shouldBeVisible && 'updateFromGameObject' in body) {
        body.updateFromGameObject();
      }
    }
  }

  private updateLightningObject(liveObject: LoadedRoomObject): void {
    const now = this.options.getCurrentTime();
    const body = liveObject.sprite.body as ArcadeObjectBody | null;
    const active = now < liveObject.runtime.activatedUntil;

    if (!active && now >= liveObject.runtime.nextActionAt) {
      liveObject.runtime.activatedUntil = now + LIGHTNING_ACTIVE_MS;
      liveObject.runtime.nextActionAt = liveObject.runtime.activatedUntil + LIGHTNING_COOLDOWN_MS;
    }

    const currentlyActive = now < liveObject.runtime.activatedUntil;
    if (currentlyActive) {
      const frameElapsed = now % 120;
      liveObject.sprite.setVisible(true);
      liveObject.sprite.setFrame(frameElapsed < 60 ? 0 : 1);
    } else {
      liveObject.sprite.setVisible(false);
      liveObject.sprite.setFrame(1);
    }

    if (body) {
      body.enable = currentlyActive;
      if (currentlyActive && 'updateFromGameObject' in body) {
        body.updateFromGameObject();
      }
    }
  }

  private triggerTornadoLaunch(liveObject: LoadedRoomObject): void {
    if (this.options.getCurrentTime() < liveObject.runtime.cooldownUntil) {
      return;
    }

    const playerBody = this.options.getPlayerBody();
    if (!playerBody) {
      return;
    }

    const relativeDirection =
      Math.abs(playerBody.center.x - liveObject.sprite.x) < 4
        ? liveObject.runtime.directionX || 1
        : playerBody.center.x >= liveObject.sprite.x
          ? 1
          : -1;

    liveObject.runtime.cooldownUntil =
      this.options.getCurrentTime() + this.options.settings.tornadoCooldownMs;
    playerBody.setVelocityX(
      playerBody.velocity.x * 0.22 + relativeDirection * this.options.settings.tornadoSideVelocity
    );
    playerBody.setVelocityY(
      Math.min(
        this.options.settings.tornadoLiftVelocity,
        playerBody.velocity.y + this.options.settings.tornadoLiftVelocity * 0.32
      )
    );
    this.options.grantExternalLaunchGrace(TORNADO_LAUNCH_GRACE_MS);
    this.options.playBounceFx(liveObject.sprite.x, liveObject.sprite.y - 4);
    this.options.showTransientStatus('Tornado tossed you.');
  }

  private triggerBombExplosion(liveObject: LoadedRoomObject): void {
    if (this.options.getCurrentTime() < liveObject.runtime.cooldownUntil) {
      return;
    }

    liveObject.runtime.activatedUntil = this.options.getCurrentTime() + 240;
    liveObject.runtime.cooldownUntil = this.options.getCurrentTime() + 1500;
    this.options.playBombExplosionFx(liveObject.sprite.x, liveObject.sprite.y);
    this.options.handlePlayerDeath('Bomb exploded.');
  }

  private spawnCannonBullet(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    cannon: LoadedRoomObject
  ): void {
    const directionX = cannon.runtime.directionX || 1;
    const spawnX = cannon.sprite.x + directionX * 18;
    const spawnY = cannon.sprite.y + 2;
    const sprite = this.options.scene.add.sprite(
      spawnX,
      spawnY,
      CANNON_BULLET_CONFIG.id,
      getObjectDefaultFrame(CANNON_BULLET_CONFIG)
    );
    sprite.setOrigin(0.5, 0.5);
    sprite.setDepth(19);
    this.applyDirectionalFacing(sprite, CANNON_BULLET_CONFIG, directionX);

    this.options.scene.physics.add.existing(sprite);
    const body = sprite.body as Phaser.Physics.Arcade.Body;
    body.setSize(CANNON_BULLET_CONFIG.bodyWidth, CANNON_BULLET_CONFIG.bodyHeight, true);
    body.setOffset(...this.getObjectBodyOffset(CANNON_BULLET_CONFIG));
    body.setAllowGravity(false);
    body.setCollideWorldBounds(false);
    body.setVelocityX(directionX * this.options.settings.cannonBulletSpeed);

    const bullet: LoadedRoomObject = {
      key: `${cannon.key}:bullet:${this.options.getCurrentTime()}`,
      placedInstanceId: null,
      linkedTargetInstanceId: null,
      containedObjectId: null,
      countsTowardGoals: false,
      config: CANNON_BULLET_CONFIG,
      sprite,
      helpers: [],
      interactions: [],
      worldColliders: [],
      runtime: {
        baseX: spawnX,
        baseY: spawnY,
        initialDirectionX: directionX,
        directionX,
        elapsedMs: 0,
        nextActionAt: 0,
        cooldownUntil: 0,
        activatedUntil: this.options.getCurrentTime() + this.options.settings.cannonBulletLifetimeMs,
        pressureActive: false,
        triggerLatched: false,
      },
    };

    const player = this.options.getPlayer();
    if (player) {
      bullet.interactions.push(
        this.options.scene.physics.add.collider(player, sprite, () => {
          this.handleCannonBulletContact(loadedRoom, bullet);
        }),
      );
    }

    bullet.worldColliders.push(
      this.options.scene.physics.add.collider(sprite, loadedRoom.terrainLayer, () => {
        this.removeLiveObject(loadedRoom, bullet);
      }),
    );
    if (loadedRoom.terrainInsetBodies) {
      bullet.worldColliders.push(
        this.options.scene.physics.add.collider(sprite, loadedRoom.terrainInsetBodies, () => {
          this.removeLiveObject(loadedRoom, bullet);
        }),
      );
    }
    for (const platform of loadedRoom.liveObjects) {
      if (
        platform === bullet ||
        platform.config.category !== 'platform' ||
        !platform.sprite.active ||
        !platform.sprite.body
      ) {
        continue;
      }

      bullet.worldColliders.push(
        this.options.scene.physics.add.collider(sprite, platform.sprite, () => {
          this.removeLiveObject(loadedRoom, bullet);
        }),
      );
    }

    loadedRoom.liveObjects.push(bullet);
  }

  private handleCannonBulletContact(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    bullet: LoadedRoomObject
  ): void {
    const playerBody = this.options.getPlayerBody();
    const bulletBody = this.getDynamicBody(bullet.sprite);
    if (!playerBody || !bulletBody || !bullet.sprite.active) {
      return;
    }

    const stomped = playerBody.velocity.y > 40 && playerBody.bottom <= bulletBody.top + 8;
    if (stomped) {
      playerBody.setVelocityY(this.options.settings.enemyStompBounceVelocity);
      this.options.playBounceFx(bullet.sprite.x, bullet.sprite.y);
      this.removeLiveObject(loadedRoom, bullet);
      return;
    }

    this.options.handlePlayerDeath('Cannonball hit you.');
  }

  private maybeReverseGroundEnemy(
    room: RoomSnapshot,
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body
  ): void {
    const bounds = this.getObjectHorizontalTravelBounds(room, liveObject.config);
    const touchingWall =
      (body.blocked.left && liveObject.runtime.directionX < 0) ||
      (body.blocked.right && liveObject.runtime.directionX > 0);
    const reachedBounds =
      (liveObject.sprite.x <= bounds.left && liveObject.runtime.directionX < 0) ||
      (liveObject.sprite.x >= bounds.right && liveObject.runtime.directionX > 0);
    const onFloor = body.blocked.down || body.touching.down;
    const missingGroundAhead =
      onFloor && !this.hasSolidTerrainAhead(room, body, liveObject.runtime.directionX);

    if (touchingWall || reachedBounds || missingGroundAhead) {
      liveObject.runtime.directionX *= -1;
    }
  }

  private applyDirectionalFacing(
    sprite: Phaser.GameObjects.Sprite,
    config: GameObjectConfig,
    directionX: number
  ): void {
    if (!config.facingDirection || directionX === 0) {
      return;
    }

    const facingRight = directionX > 0;
    sprite.setFlipX(config.facingDirection === 'right' ? !facingRight : facingRight);
  }

  private getPlacedObjectRuntimeDepth(placedObject: Pick<RoomSnapshot['placedObjects'][number], 'layer'>): number {
    switch (getPlacedObjectLayer(placedObject)) {
      case 'background':
        return 9.5;
      case 'foreground':
        return 28;
      case 'terrain':
      default:
        return 18;
    }
  }

  private resetDynamicObjectIfOutOfBounds(
    room: RoomSnapshot,
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body
  ): boolean {
    const roomOrigin = this.options.getRoomOrigin(room.coordinates);
    if (liveObject.sprite.y <= roomOrigin.y + ROOM_PX_HEIGHT + this.options.settings.respawnFallDistance) {
      return false;
    }

    liveObject.runtime.directionX = liveObject.runtime.initialDirectionX;
    liveObject.runtime.elapsedMs = 0;
    liveObject.runtime.nextActionAt = this.options.getCurrentTime() + 250;
    body.reset(liveObject.runtime.baseX, liveObject.runtime.baseY);
    liveObject.sprite.setPosition(liveObject.runtime.baseX, liveObject.runtime.baseY);
    this.applyDirectionalFacing(
      liveObject.sprite,
      liveObject.config,
      liveObject.runtime.initialDirectionX
    );
    body.setVelocity(0, 0);
    return true;
  }

  private hasSolidTerrainAhead(
    room: RoomSnapshot,
    body: Phaser.Physics.Arcade.Body,
    directionX: number
  ): boolean {
    const probeX = body.center.x + directionX * (body.halfWidth + 4);
    const probeY = body.bottom + 2;
    return this.hasSolidTerrainAtWorldPoint(room, probeX, probeY);
  }

  private hasSolidTerrainAtWorldPoint(room: RoomSnapshot, worldX: number, worldY: number): boolean {
    const roomOrigin = this.options.getRoomOrigin(room.coordinates);
    const localX = Math.floor((worldX - roomOrigin.x) / TILE_SIZE);
    const localY = Math.floor((worldY - roomOrigin.y) / TILE_SIZE);

    if (localX < 0 || localX >= ROOM_WIDTH || localY < 0 || localY >= ROOM_HEIGHT) {
      return false;
    }

    const localPixelY = worldY - roomOrigin.y - localY * TILE_SIZE;
    return terrainTileCollidesAtLocalPixel(room, localX, localY, localPixelY);
  }

  private getObjectHorizontalTravelBounds(
    room: RoomSnapshot,
    config: GameObjectConfig
  ): { left: number; right: number } {
    const roomOrigin = this.options.getRoomOrigin(room.coordinates);
    const halfWidth = Math.max(4, (config.bodyWidth > 0 ? config.bodyWidth : config.frameWidth) * 0.5);
    return {
      left: roomOrigin.x + halfWidth + 2,
      right: roomOrigin.x + ROOM_PX_WIDTH - halfWidth - 2,
    };
  }

  private usesDynamicObjectBody(config: GameObjectConfig): boolean {
    return (
      config.id === 'crate' ||
      config.id === 'cannon_bullet' ||
      config.id === 'crab' ||
      config.id === 'slime_blue' ||
      config.id === 'slime_red' ||
      config.id === 'snake' ||
      config.id === 'penguin' ||
      config.id === 'frog' ||
      config.id === 'bear_brown' ||
      config.id === 'bear_polar' ||
      config.id === 'chicken'
    );
  }

  private objectUsesGravity(config: GameObjectConfig): boolean {
    return config.id !== 'bird' && config.id !== 'cannon_bullet';
  }

  private createLadderTopSupport(sprite: Phaser.GameObjects.Sprite): Phaser.GameObjects.Zone | null {
    const ladderBody = sprite.body as ArcadeObjectBody | null;
    if (!ladderBody) {
      return null;
    }

    const width = Math.max(16, ladderBody.width + 2);
    const height = 6;
    const centerX = sprite.x;
    const top = ladderBody.top + 2;
    const centerY = top + height * 0.5;
    const supportZone = this.options.scene.add.zone(centerX, centerY, width, height);
    this.options.scene.physics.add.existing(supportZone, true);
    const supportBody = supportZone.body as Phaser.Physics.Arcade.StaticBody | null;
    supportBody?.setSize(width, height);
    supportBody?.updateFromGameObject();
    return supportZone;
  }

  private shouldCollideWithLadderTopSupport(
    playerBody: Phaser.Physics.Arcade.Body,
    supportBody: ArcadeObjectBody
  ): boolean {
    if (this.options.isPlayerClimbingLadder() || this.options.isLadderDropRequested()) {
      return false;
    }

    if (playerBody.velocity.y < -4) {
      return false;
    }

    return playerBody.bottom <= supportBody.top + 10;
  }

  private getObjectBodyOffset(config: GameObjectConfig): [number, number] {
    if (typeof config.bodyOffsetX === 'number' || typeof config.bodyOffsetY === 'number') {
      return [config.bodyOffsetX ?? 0, config.bodyOffsetY ?? 0];
    }

    const centeredX = Math.max(0, (config.frameWidth - config.bodyWidth) * 0.5);
    let offsetY = Math.max(0, (config.frameHeight - config.bodyHeight) * 0.5);

    switch (config.id) {
      case 'bounce_pad':
      case 'crab':
      case 'slime_blue':
      case 'slime_red':
      case 'snake':
      case 'penguin':
      case 'frog':
      case 'spikes':
      case 'ice_spikes':
      case 'cannon':
      case 'cactus':
      case 'tornado':
      case 'tornado_sand':
      case 'fire_big':
      case 'quicksand':
      case 'cactus_spike':
      case 'lava_surface':
      case 'water_surface_a':
      case 'water_surface_b':
      case 'brick_box':
      case 'treasure_chest':
      case 'door_locked':
      case 'log_wall':
      case 'bear_brown':
      case 'bear_polar':
      case 'chicken':
        offsetY = Math.max(0, config.frameHeight - config.bodyHeight);
        break;
      default:
        break;
    }

    return [centeredX, offsetY];
  }

  private getDynamicBody(sprite: Phaser.GameObjects.Sprite): Phaser.Physics.Arcade.Body | null {
    const body = sprite.body as ArcadeObjectBody | null;
    return isDynamicArcadeBody(body) ? body : null;
  }

  private getGroundEnemySpeed(objectId: string): number {
    switch (objectId) {
      case 'crab':
        return this.options.settings.crabSpeed;
      case 'slime_blue':
      case 'slime_red':
        return this.options.settings.slimeSpeed;
      case 'bear_brown':
      case 'bear_polar':
        return this.options.settings.penguinSpeed * 0.76;
      case 'chicken':
        return this.options.settings.penguinSpeed * 1.1;
      case 'penguin':
        return this.options.settings.penguinSpeed;
      case 'snake':
      default:
        return this.options.settings.snakeSpeed;
    }
  }

  private removeLiveObject(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject
  ): void {
    this.destroyLiveObjectInteractions(liveObject);
    this.destroyLiveObjectWorldColliders(liveObject);
    this.destroyLiveObjectHelpers(liveObject);
    liveObject.sprite.destroy();
    loadedRoom.liveObjects = loadedRoom.liveObjects.filter((candidate) => candidate !== liveObject);
  }

  private getArcadeBodyBounds(body: ArcadeObjectBody): Phaser.Geom.Rectangle {
    return new Phaser.Geom.Rectangle(body.left, body.top, body.width, body.height);
  }

  private handleEnemyContact(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject
  ): void {
    const playerBody = this.options.getPlayerBody();
    const player = this.options.getPlayer();
    if (!playerBody || !player || !liveObject.sprite.body) {
      return;
    }

    const enemyBody = liveObject.sprite.body as ArcadeObjectBody;
    const stomped = playerBody.velocity.y > 40 && playerBody.bottom <= enemyBody.top + 10;

    if (!stomped) {
      this.options.handlePlayerDeath(`${liveObject.config.name} hit you.`);
      return;
    }

    playerBody.setVelocityY(this.options.settings.enemyStompBounceVelocity);
    this.defeatEnemy(loadedRoom, liveObject);
  }

  private collectLiveObject(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject
  ): void {
    if (this.options.isCollectedObjectKey(liveObject.key)) {
      return;
    }

    this.options.markCollectedObjectKey(liveObject.key);
    const scoreDelta = this.getCollectibleScoreValue(liveObject.config.id);
    this.options.addScore(scoreDelta);
    if (liveObject.config.id === 'key') {
      this.options.onKeyCollected();
    }
    this.options.playCollectFx(
      liveObject.sprite.x,
      liveObject.sprite.y,
      scoreDelta,
      this.getCollectibleCue(liveObject.config.id)
    );
    this.options.showTransientStatus(`${liveObject.config.name} collected.`);
    this.destroyLiveObjectInteractions(liveObject);

    const startY = liveObject.sprite.y;
    this.options.scene.tweens.add({
      targets: liveObject.sprite,
      y: startY - 16,
      scaleX: 1.5,
      scaleY: 1.5,
      alpha: 0,
      duration: 300,
      ease: 'Quad.easeOut',
      onComplete: () => {
        liveObject.sprite.destroy();
      },
    });

    loadedRoom.liveObjects = loadedRoom.liveObjects.filter((candidate) => candidate !== liveObject);
    if (liveObject.countsTowardGoals) {
      this.options.onCollectibleCollected(loadedRoom.room.id);
    }
  }

  private getCollectibleScoreValue(objectId: string): number {
    switch (objectId) {
      case 'gem':
        return 5;
      case 'coin_gold':
        return 3;
      case 'coin_silver':
        return 2;
      case 'coin_small_gold':
        return 2;
      case 'coin_small_silver':
        return 1;
      default:
        return 1;
    }
  }

  private getCollectibleCue(objectId: string): SfxCue {
    switch (objectId) {
      case 'gem':
        return 'collect-gem';
      case 'key':
        return 'collect-key';
      case 'apple':
      case 'banana':
      case 'heart':
        return 'collect-fruit';
      default:
        return 'collect';
    }
  }

  private defeatEnemy(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject
  ): WeaponHitResult | null {
    if (!liveObject.sprite.active) {
      return null;
    }

    const x = liveObject.sprite.x;
    const y = liveObject.sprite.y;
    const enemyName = liveObject.config.name;

    this.options.addScore(10);
    this.options.playEnemyKillFx(x, y);
    this.destroyLiveObjectInteractions(liveObject);
    this.destroyLiveObjectWorldColliders(liveObject);
    liveObject.sprite.destroy();
    loadedRoom.liveObjects = loadedRoom.liveObjects.filter((candidate) => candidate !== liveObject);

    const handledStatus = liveObject.countsTowardGoals
      ? this.options.onEnemyDefeated(loadedRoom.room.id, enemyName)
      : false;
    if (!handledStatus) {
      this.options.showTransientStatus(`${enemyName} defeated.`);
    }

    return {
      roomId: loadedRoom.room.id,
      enemyName,
      x,
      y,
    };
  }
}

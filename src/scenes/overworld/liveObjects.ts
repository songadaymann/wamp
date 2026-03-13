import Phaser from 'phaser';
import type { SfxCue } from '../../audio/sfx';
import {
  getObjectById,
  getObjectDefaultFrame,
  ROOM_HEIGHT,
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
  ROOM_WIDTH,
  TILE_SIZE,
  type GameObjectConfig,
} from '../../config';
import type { RoomCoordinates, RoomSnapshot } from '../../persistence/roomModel';
import type { LoadedFullRoom } from './worldStreaming';

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
}

export interface LoadedRoomObject {
  key: string;
  config: GameObjectConfig;
  sprite: Phaser.GameObjects.Sprite;
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
  getPlacedObjectRuntimeKey: (roomId: string, placedIndex: number) => string;
  isCollectedObjectKey: (key: string) => boolean;
  markCollectedObjectKey: (key: string) => void;
  getPlayer: () => Phaser.GameObjects.GameObject | null;
  getPlayerBody: () => Phaser.Physics.Arcade.Body | null;
  getCurrentTime: () => number;
  addScore: (delta: number) => void;
  grantExternalLaunchGrace: (durationMs: number) => void;
  showTransientStatus: (message: string) => void;
  handlePlayerDeath: (reason: string) => void;
  onEnemyDefeated: (roomId: string, enemyName: string) => boolean;
  onCollectibleCollected: (roomId: string) => void;
  playEnemyKillFx: (x: number, y: number) => void;
  playCollectFx: (x: number, y: number, scoreDelta: number, cue?: SfxCue) => void;
  playBounceFx: (x: number, y: number) => void;
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

export class OverworldLiveObjectController<TEdgeWall = unknown> {
  constructor(private readonly options: OverworldLiveObjectControllerOptions) {}

  createLiveObjects(loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>): void {
    const roomOrigin = this.options.getRoomOrigin(loadedRoom.room.coordinates);

    for (let index = 0; index < loadedRoom.room.placedObjects.length; index += 1) {
      const placedObject = loadedRoom.room.placedObjects[index];
      const config = getObjectById(placedObject.id);
      if (!config) {
        continue;
      }

      const objectKey = this.options.getPlacedObjectRuntimeKey(loadedRoom.room.id, index);
      if (this.options.isCollectedObjectKey(objectKey)) {
        continue;
      }

      const sprite = this.options.scene.add.sprite(
        roomOrigin.x + placedObject.x,
        roomOrigin.y + placedObject.y,
        config.id,
        getObjectDefaultFrame(config)
      );
      sprite.setOrigin(0.5, 0.5);
      sprite.setDepth(18);

      if (config.frameCount > 1 && config.fps > 0) {
        const animationKey = `${config.id}_anim`;
        if (this.options.scene.anims.exists(animationKey)) {
          sprite.play(animationKey);
        }
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
        placedObject.facing === 'right'
          ? 1
          : placedObject.facing === 'left'
            ? -1
            : placedObject.x <= ROOM_PX_WIDTH * 0.5
              ? 1
              : -1;
      this.applyDirectionalFacing(sprite, config, initialDirectionX);
      loadedRoom.liveObjects.push({
        key: objectKey,
        config,
        sprite,
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
                : this.options.getCurrentTime(),
          cooldownUntil: 0,
          activatedUntil: 0,
        },
      });
    }

    this.syncRoomObjectWorldColliders(loadedRoom);
  }

  destroyLiveObjects(loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>): void {
    for (const liveObject of loadedRoom.liveObjects) {
      this.destroyLiveObjectInteractions(liveObject);
      this.destroyLiveObjectWorldColliders(liveObject);
      liveObject.sprite.destroy();
    }

    loadedRoom.liveObjects = [];
  }

  clearRoomInteractions(loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>): void {
    for (const liveObject of loadedRoom.liveObjects) {
      this.destroyLiveObjectInteractions(liveObject);
    }
  }

  syncLiveObjectInteractions(loadedRooms: Iterable<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>): void {
    for (const loadedRoom of loadedRooms) {
      for (const liveObject of loadedRoom.liveObjects) {
        this.destroyLiveObjectInteractions(liveObject);

        const player = this.options.getPlayer();
        const playerBody = this.options.getPlayerBody();
        if (!player || !playerBody || !liveObject.sprite.active || !liveObject.sprite.body) {
          continue;
        }

        switch (liveObject.config.category) {
          case 'collectible':
            liveObject.interactions.push(
              this.options.scene.physics.add.overlap(player, liveObject.sprite, () => {
                this.collectLiveObject(loadedRoom, liveObject);
              })
            );
            break;
          case 'hazard':
            if (liveObject.config.id === 'tornado') {
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
            if (liveObject.config.id === 'bounce_pad') {
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
    for (const loadedRoom of loadedRooms) {
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
          case 'crab':
          case 'slime_blue':
          case 'slime_red':
          case 'snake':
          case 'penguin':
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
          case 'bounce_pad':
            this.updateBouncePadObject(liveObject);
            break;
          default:
            break;
        }
      }
    }
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

  private destroyLiveObjectInteractions(liveObject: LoadedRoomObject): void {
    for (const interaction of liveObject.interactions) {
      interaction.destroy();
    }
    liveObject.interactions = [];
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
      config: CANNON_BULLET_CONFIG,
      sprite,
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

    return room.tileData.terrain[localY][localX] > 0;
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
      config.id === 'frog'
    );
  }

  private objectUsesGravity(config: GameObjectConfig): boolean {
    return config.id !== 'bird' && config.id !== 'cannon_bullet';
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
      case 'cannon':
      case 'cactus':
      case 'tornado':
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
    this.options.onCollectibleCollected(loadedRoom.room.id);
  }

  private getCollectibleScoreValue(objectId: string): number {
    switch (objectId) {
      case 'gem':
        return 5;
      case 'coin_gold':
        return 3;
      case 'coin_silver':
        return 2;
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

    const handledStatus = this.options.onEnemyDefeated(loadedRoom.room.id, enemyName);
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

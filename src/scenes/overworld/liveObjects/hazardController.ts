import Phaser from 'phaser';
import {
  getObjectDefaultFrame,
  isBlockSwitchObjectId,
  isSolidRuntimeObjectConfig,
  ROOM_PX_WIDTH,
  TILE_SIZE,
  type GameObjectConfig,
} from '../../../config';
import type { RoomCoordinates } from '../../../persistence/roomModel';
import type { SfxCue } from '../../../audio/sfx';
import type { LoadedRoomObject } from '../liveObjects';
import type { LoadedFullRoom } from '../worldStreaming';
import { isDynamicArcadeBody } from './bodies';
import type { ArcadeObjectBody } from './bodies';
import { CANNON_BULLET_CONFIG } from './projectiles';

const BOUNCE_PAD_LAUNCH_GRACE_MS = 180;
const TORNADO_LAUNCH_GRACE_MS = 280;
const LIGHTNING_ACTIVE_MS = 190;
const LIGHTNING_COOLDOWN_MS = 1150;

interface LiveObjectHazardSettings {
  bouncePadVelocity: number;
  bouncePadCooldownMs: number;
  bouncePadActiveMs: number;
  cannonFireDelayMs: number;
  cannonBulletSpeed: number;
  cannonBulletLifetimeMs: number;
  tornadoLiftVelocity: number;
  tornadoSideVelocity: number;
  tornadoCooldownMs: number;
  enemyStompBounceVelocity: number;
}

interface LiveObjectHazardControllerOptions<TEdgeWall> {
  scene: Phaser.Scene;
  settings: LiveObjectHazardSettings;
  getCurrentTime: () => number;
  getRoomOrigin: (coordinates: RoomCoordinates) => { x: number; y: number };
  getPlayer: () => Phaser.GameObjects.GameObject | null;
  getPlayerBody: () => Phaser.Physics.Arcade.Body | null;
  grantExternalLaunchGrace: (durationMs: number) => void;
  touchQuicksand: () => void;
  handlePlayerDeath: (reason: string) => void;
  playBounceFx: (
    x: number,
    y: number,
    roomCoordinates: RoomCoordinates,
    cue?: SfxCue | null
  ) => void;
  playBombExplosionFx: (x: number, y: number, roomCoordinates: RoomCoordinates) => void;
  showTransientStatus: (message: string) => void;
  applyDirectionalFacing: (
    sprite: Phaser.GameObjects.Sprite,
    config: GameObjectConfig,
    directionX: number,
  ) => void;
  getObjectBodyOffset: (config: GameObjectConfig) => [number, number];
  removeLiveObject: (
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
  ) => void;
  triggerBlockSwitch: (
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    switchObject: LoadedRoomObject,
  ) => void;
}

export class LiveObjectHazardController<TEdgeWall = unknown> {
  constructor(private readonly options: LiveObjectHazardControllerOptions<TEdgeWall>) {}

  addHazardInteraction(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
    player: Phaser.GameObjects.GameObject,
  ): void {
    if (liveObject.config.id === 'quicksand') {
      liveObject.interactions.push(
        this.options.scene.physics.add.overlap(player, liveObject.sprite, () => {
          this.options.touchQuicksand();
        })
      );
    } else if (liveObject.config.id === 'bomb') {
      liveObject.interactions.push(
        this.options.scene.physics.add.overlap(player, liveObject.sprite, () => {
          this.triggerBombExplosion(loadedRoom, liveObject);
        })
      );
    } else if (liveObject.config.id === 'tornado' || liveObject.config.id === 'tornado_sand') {
      liveObject.interactions.push(
        this.options.scene.physics.add.overlap(player, liveObject.sprite, () => {
          this.triggerTornadoLaunch(loadedRoom, liveObject);
        })
      );
    } else {
      liveObject.interactions.push(
        this.options.scene.physics.add.overlap(player, liveObject.sprite, () => {
          this.options.handlePlayerDeath(`${liveObject.config.name} hit you.`);
        })
      );
    }
  }

  addBouncePadInteraction(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
    player: Phaser.GameObjects.GameObject,
  ): void {
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
        this.options.playBounceFx(
          liveObject.sprite.x,
          liveObject.sprite.y - 2,
          loadedRoom.room.coordinates
        );
        this.options.showTransientStatus('Bounce pad launched you.');
      })
    );
  }

  updateCannonObject(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject
  ): void {
    this.options.applyDirectionalFacing(
      liveObject.sprite,
      liveObject.config,
      liveObject.runtime.directionX,
    );

    if (this.options.getCurrentTime() < liveObject.runtime.nextActionAt) {
      return;
    }

    liveObject.runtime.nextActionAt =
      this.options.getCurrentTime() + this.options.settings.cannonFireDelayMs;
    this.spawnCannonBullet(loadedRoom, liveObject);
  }

  updateTravelingProjectile(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject
  ): void {
    const body = this.getDynamicBody(liveObject.sprite);
    if (!body) {
      this.options.removeLiveObject(loadedRoom, liveObject);
      return;
    }

    if (
      liveObject.runtime.activatedUntil > 0 &&
      this.options.getCurrentTime() >= liveObject.runtime.activatedUntil
    ) {
      this.options.removeLiveObject(loadedRoom, liveObject);
      return;
    }

    const directionX = liveObject.runtime.directionX || 1;
    const hitHorizontalObstacle =
      (directionX < 0 && (body.blocked.left || body.touching.left)) ||
      (directionX > 0 && (body.blocked.right || body.touching.right));
    if (hitHorizontalObstacle) {
      this.options.removeLiveObject(loadedRoom, liveObject);
      return;
    }

    body.setVelocityX(directionX * this.options.settings.cannonBulletSpeed);
    this.options.applyDirectionalFacing(liveObject.sprite, liveObject.config, directionX);

    const roomOrigin = this.options.getRoomOrigin(loadedRoom.room.coordinates);
    if (
      liveObject.sprite.x < roomOrigin.x - TILE_SIZE ||
      liveObject.sprite.x > roomOrigin.x + ROOM_PX_WIDTH + TILE_SIZE
    ) {
      this.options.removeLiveObject(loadedRoom, liveObject);
    }
  }

  updateBouncePadObject(liveObject: LoadedRoomObject): void {
    if (liveObject.config.frameCount <= 1) {
      return;
    }

    const nextFrame = this.options.getCurrentTime() < liveObject.runtime.activatedUntil ? 1 : 0;
    if (Number(liveObject.sprite.frame.name) !== nextFrame) {
      liveObject.sprite.setFrame(nextFrame);
    }
  }

  updateBombObject(liveObject: LoadedRoomObject): void {
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

  updateLightningObject(liveObject: LoadedRoomObject): void {
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

  private triggerTornadoLaunch(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject
  ): void {
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
    this.options.playBounceFx(
      liveObject.sprite.x,
      liveObject.sprite.y - 4,
      loadedRoom.room.coordinates
    );
    this.options.showTransientStatus('Tornado tossed you.');
  }

  private triggerBombExplosion(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject
  ): void {
    if (this.options.getCurrentTime() < liveObject.runtime.cooldownUntil) {
      return;
    }

    liveObject.runtime.activatedUntil = this.options.getCurrentTime() + 240;
    liveObject.runtime.cooldownUntil = this.options.getCurrentTime() + 1500;
    this.options.playBombExplosionFx(
      liveObject.sprite.x,
      liveObject.sprite.y,
      loadedRoom.room.coordinates
    );
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
    this.options.applyDirectionalFacing(sprite, CANNON_BULLET_CONFIG, directionX);

    this.options.scene.physics.add.existing(sprite);
    const body = sprite.body as Phaser.Physics.Arcade.Body;
    body.setSize(CANNON_BULLET_CONFIG.bodyWidth, CANNON_BULLET_CONFIG.bodyHeight, true);
    body.setOffset(...this.options.getObjectBodyOffset(CANNON_BULLET_CONFIG));
    body.setAllowGravity(false);
    body.setCollideWorldBounds(false);
    body.setVelocityX(directionX * this.options.settings.cannonBulletSpeed);

    const bullet: LoadedRoomObject = {
      key: `${cannon.key}:bullet:${this.options.getCurrentTime()}`,
      placedInstanceId: null,
      linkedTargetRoomId: null,
      linkedTargetInstanceId: null,
      linkedTargetWorldX: null,
      linkedTargetWorldY: null,
      containedObjectId: null,
      signText: null,
      layer: 'terrain',
      countsTowardGoals: false,
      config: CANNON_BULLET_CONFIG,
      sprite,
      helpers: [],
      interactions: [],
      worldColliders: [],
      runtime: {
        baseX: spawnX,
        baseY: spawnY,
        previousX: spawnX,
        previousY: spawnY,
        gravityDirection: 'down',
        gravityRoomId: loadedRoom.room.id,
        inWater: false,
        initialDirectionX: directionX,
        directionX,
        aiFacingDirectionX: directionX,
        aiFacingLastFlipAt: this.options.getCurrentTime(),
        aiFacingLastFlipX: spawnX,
        elapsedMs: 0,
        nextActionAt: 0,
        actionStartedAt: this.options.getCurrentTime(),
        aiTraversalCooldownUntil: 0,
        cooldownUntil: 0,
        activatedUntil: this.options.getCurrentTime() + this.options.settings.cannonBulletLifetimeMs,
        aiState: null,
        aiObjectiveMode: null,
        aiDefeatMode: null,
        aiIntent: null,
        aiTargetX: null,
        aiCurrentSegmentId: null,
        aiTargetSegmentId: null,
        aiTraversalEdgeId: null,
        aiTraversalBlockedEdges: [],
        aiTraversalLastBlockReason: null,
        aiActiveTraversalEdgeId: null,
        aiActiveTraversalNextNodeId: null,
        aiActiveTraversalStartedAt: 0,
        aiActiveTraversalStartBottom: 0,
        aiLadderTraversalEdgeId: null,
        aiFallbackTraversalEdgeId: null,
        aiFallbackTraversalSegmentId: null,
        aiFallbackTraversalLastProgressAt: 0,
        aiFallbackTraversalBestMetric: Number.POSITIVE_INFINITY,
        aiRouteLoopSignature: null,
        aiRouteLoopCount: 0,
        aiRouteLoopLastProgressAt: 0,
        aiRouteLoopBestMetric: Number.POSITIVE_INFINITY,
        aiPlannerMode: null,
        aiPlannerFallback: false,
        aiPlannerPlanMs: 0,
        aiPlannerExpandedStates: 0,
        aiPlannerSimulatedEdges: 0,
        aiPlannedTraversalEdgeIds: [],
        aiPlannedTraversalTargetNodeId: null,
        aiPlannedTraversalExpiresAt: 0,
        aiPlannedTraversalReason: null,
        aiCollectState: null,
        aiCollectRouteTargetNodeId: null,
        aiCollectRouteExpiresAt: 0,
        aiCollectRouteScore: null,
        aiCollectRouteValue: 0,
        aiCollectRoutePenalty: 0,
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
        this.options.removeLiveObject(loadedRoom, bullet);
      }),
    );
    if (loadedRoom.terrainInsetBodies) {
      bullet.worldColliders.push(
        this.options.scene.physics.add.collider(sprite, loadedRoom.terrainInsetBodies, () => {
          this.options.removeLiveObject(loadedRoom, bullet);
        }),
      );
    }
    for (const platform of loadedRoom.liveObjects) {
      if (
        platform === bullet ||
        !isSolidRuntimeObjectConfig(platform.config) ||
        !platform.sprite.active ||
        !platform.sprite.body
      ) {
        continue;
      }

      const hitsBlockSwitch = isBlockSwitchObjectId(platform.config.id);
      bullet.worldColliders.push(
        this.options.scene.physics.add.collider(sprite, platform.sprite, () => {
          if (hitsBlockSwitch) {
            this.options.triggerBlockSwitch(loadedRoom, platform);
          }
          this.options.removeLiveObject(loadedRoom, bullet);
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
      this.options.playBounceFx(bullet.sprite.x, bullet.sprite.y, loadedRoom.room.coordinates);
      this.options.removeLiveObject(loadedRoom, bullet);
      return;
    }

    this.options.handlePlayerDeath('Cannonball hit you.');
  }

  private getDynamicBody(sprite: Phaser.GameObjects.Sprite): Phaser.Physics.Arcade.Body | null {
    const body = sprite.body as ArcadeObjectBody | null;
    return isDynamicArcadeBody(body) ? body : null;
  }
}

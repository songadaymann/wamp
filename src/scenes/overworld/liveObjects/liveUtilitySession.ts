import Phaser from 'phaser';
import { isRollingBallObjectId } from '../../../config';
import { getRollingBallGraphic, rollingBallFrame } from '../../../config/rollingBall';
import type { RollingBallSettings } from '../../../config/rollingBall';
import type { RoomCoordinates, RoomSnapshot } from '../../../persistence/roomModel';
import type { PlayerGravityDirection, SpecialTilePlayerEnvironment } from '../specialTiles';
import type { LoadedFullRoom } from '../worldStreaming';
import { createBallState, resetBallMotion, type BallSimState } from './rollingBallPhysics';
import { placeTriangleSprite } from './triangleTexture';
import { stepUtilityObjects } from './utilityObjects';
import type { LoadedRoomObject } from './model';

interface LiveUtilityOptions<TEdgeWall> {
  getLoadedFullRooms: () => Iterable<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>;
  getPlacedObjectRuntimeKey: (
    roomId: string,
    placedObject: RoomSnapshot['placedObjects'][number],
    placedIndex: number,
  ) => string;
  getPlayerBody: () => Phaser.Physics.Arcade.Body | null;
  getSpecialTileEnvironmentForBody: (
    body: Phaser.Physics.Arcade.Body,
    currentGravityDirection: PlayerGravityDirection,
  ) => Readonly<SpecialTilePlayerEnvironment>;
  getBodyRoomId: (body: Phaser.Physics.Arcade.Body) => string;
  supportCrumblingTiles?: (
    body: Phaser.Physics.Arcade.Body,
    gravityDirection: PlayerGravityDirection,
  ) => void;
  getCurrentTime: () => number;
  settings: {
    bouncePadVelocity: number;
    bouncePadCooldownMs: number;
    bouncePadActiveMs: number;
  };
  handlePlayerDeath: (reason: string) => void;
  playBounceFx: (x: number, y: number, roomCoordinates: RoomCoordinates) => void;
}

interface LiveUtilityHooks<TEdgeWall> {
  createBatch: (
    room: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    start: number,
    end: number,
    dormant: boolean,
  ) => void;
  finalize: (room: LoadedFullRoom<LoadedRoomObject, TEdgeWall>, dormant: boolean) => void;
  remove: (room: LoadedFullRoom<LoadedRoomObject, TEdgeWall>, liveObject: LoadedRoomObject) => void;
  defeat: (room: LoadedFullRoom<LoadedRoomObject, TEdgeWall>, liveObject: LoadedRoomObject) => void;
}

export function presentUtilityObject(
  liveObject: LoadedRoomObject,
  sprite: Phaser.GameObjects.Sprite,
  ball: RollingBallSettings | null,
  triangle: { legX: number; legY: number; fill: string; stroke: string } | null,
  anchorX: number,
  anchorY: number,
): void {
  liveObject.ball = ball;
  if (triangle) {
    liveObject.triangle = {
      anchorX,
      anchorY,
      legX: triangle.legX,
      legY: triangle.legY,
      fill: triangle.fill,
      stroke: triangle.stroke,
    };
    placeTriangleSprite(sprite, anchorX, anchorY, triangle.legX, triangle.legY, triangle.fill, triangle.stroke);
  } else if (ball) {
    sprite.setFrame(rollingBallFrame(getRollingBallGraphic(ball.graphicId).column, 0));
  }
}

export class LiveUtilitySession<TEdgeWall> {
  private readonly ballStates = new WeakMap<LoadedRoomObject, BallSimState>();
  private playerOnTriangle = false;
  private readonly playerSlopeSlide = { active: false };

  constructor(
    private readonly options: LiveUtilityOptions<TEdgeWall>,
    private readonly hooks: LiveUtilityHooks<TEdgeWall>,
  ) {}

  isPlayerOnTriangle(): boolean {
    return this.playerOnTriangle;
  }

  resetRollingBalls(): void {
    for (const room of this.options.getLoadedFullRooms()) {
      const liveKeys = new Set(room.liveObjects.map((liveObject) => liveObject.key));
      let created = false;
      for (let index = 0; index < room.room.placedObjects.length; index += 1) {
        const placed = room.room.placedObjects[index];
        if (!isRollingBallObjectId(placed.id)) continue;
        const key = this.options.getPlacedObjectRuntimeKey(room.room.id, placed, index);
        if (liveKeys.has(key)) continue;
        this.hooks.createBatch(room, index, index + 1, false);
        created = true;
      }
      if (created) this.hooks.finalize(room, false);
      for (const liveObject of room.liveObjects) {
        if (!isRollingBallObjectId(liveObject.config.id) || !liveObject.ball || !liveObject.sprite.active) continue;
        const state = this.ballStates.get(liveObject) ?? createBallState(
          liveObject.runtime.baseX,
          liveObject.runtime.baseY,
          liveObject.ball,
        );
        resetBallMotion(state, liveObject.runtime.baseX, liveObject.runtime.baseY);
        this.ballStates.set(liveObject, state);
        liveObject.sprite.setPosition(state.x, state.y);
        liveObject.sprite.rotation = 0;
      }
    }
  }

  step(delta: number, playerIntent: number, playerButtStomping = false): void {
    const rooms = [...this.options.getLoadedFullRooms()];
    this.playerOnTriangle = stepUtilityObjects({
      rooms,
      delta,
      playerBody: this.options.getPlayerBody(),
      playerIntent,
      playerButtStomping,
      slopeSlide: this.playerSlopeSlide,
      states: this.ballStates,
      sampleEnvironment: (probe, gravityDirection) => ({
        environment: this.options.getSpecialTileEnvironmentForBody(probe, gravityDirection),
        roomId: this.options.getBodyRoomId(probe),
      }),
      onDestroy: (room, liveObject) => {
        this.hooks.remove(room as LoadedFullRoom<LoadedRoomObject, TEdgeWall>, liveObject);
      },
      supportCrumbling: this.options.supportCrumblingTiles,
      now: this.options.getCurrentTime(),
      bounceSpeed: this.options.settings.bouncePadVelocity,
      bounceCooldownMs: this.options.settings.bouncePadCooldownMs,
      bounceActiveMs: this.options.settings.bouncePadActiveMs,
      onPlayerHurt: () => this.options.handlePlayerDeath('A rolling ball hit you.'),
      onDefeat: (room, liveObject) => {
        this.hooks.defeat(room as LoadedFullRoom<LoadedRoomObject, TEdgeWall>, liveObject);
      },
      onBounce: (x, y, coordinates) => this.options.playBounceFx(x, y, coordinates),
    });
  }
}

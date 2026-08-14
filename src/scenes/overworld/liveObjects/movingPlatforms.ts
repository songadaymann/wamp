import Phaser from 'phaser';
import { isMovingPlatformObjectId } from '../../../config';
import {
  getArcadeBodyBounds,
  isDynamicArcadeBody,
  type ArcadeObjectBody,
} from './bodies';
import type { LoadedRoomObject } from './model';

const MOVING_PLATFORM_CARRY_MAX_UPWARD_PLAYER_SPEED = -60;
const MOVING_PLATFORM_CARRY_EDGE_INSET_PX = 1;
const MOVING_PLATFORM_CARRY_HOVER_TOLERANCE_PX = 10;
const MOVING_PLATFORM_CARRY_PENETRATION_TOLERANCE_PX = 8;
const MOVING_PLATFORM_OBJECT_CARRY_HOVER_TOLERANCE_PX = 18;
const MOVING_PLATFORM_OBJECT_CARRY_PENETRATION_TOLERANCE_PX = 8;

interface MovingPlatformRoom {
  liveObjects: LoadedRoomObject[];
}

export function carryMovingPlatformRiders(
  rooms: MovingPlatformRoom[],
  options: {
    getDynamicBody(sprite: Phaser.GameObjects.Sprite): Phaser.Physics.Arcade.Body | null;
    getPlayerBody(): Phaser.Physics.Arcade.Body | null;
    onLiveObjectMoved?(liveObject: LoadedRoomObject): void;
  },
): void {
  for (const loadedRoom of rooms) {
    for (const liveObject of loadedRoom.liveObjects) {
      if (!isMovingPlatformObjectId(liveObject.config.id)) {
        continue;
      }

      const body = options.getDynamicBody(liveObject.sprite);
      if (!body) {
        continue;
      }

      const deltaX = liveObject.sprite.x - liveObject.runtime.previousX;
      const deltaY = liveObject.sprite.y - liveObject.runtime.previousY;
      carryPlayerOnMovingPlatform(options.getPlayerBody(), body, deltaX, deltaY);
      carryObjectsOnMovingPlatform(rooms, liveObject, body, deltaX, deltaY, options);
    }
  }
}

function carryPlayerOnMovingPlatform(
  playerBody: Phaser.Physics.Arcade.Body | null,
  platformBody: Phaser.Physics.Arcade.Body,
  deltaX: number,
  deltaY: number,
): void {
  if (deltaX === 0 && deltaY === 0) {
    return;
  }

  if (!playerBody || playerBody.velocity.y < MOVING_PLATFORM_CARRY_MAX_UPWARD_PLAYER_SPEED) {
    return;
  }

  if (!bodyIsOnMovingPlatformTop(playerBody, platformBody, {
    edgeInsetPx: MOVING_PLATFORM_CARRY_EDGE_INSET_PX,
    hoverTolerancePx: MOVING_PLATFORM_CARRY_HOVER_TOLERANCE_PX,
    penetrationTolerancePx: MOVING_PLATFORM_CARRY_PENETRATION_TOLERANCE_PX,
  })) {
    return;
  }

  const velocityX = playerBody.velocity.x;
  const playerBounds = getArcadeBodyBounds(playerBody);
  playerBody.reset(
    playerBounds.centerX + deltaX,
    platformBody.top - playerBounds.height * 0.5,
  );
  playerBody.setVelocity(velocityX, 0);
}

function carryObjectsOnMovingPlatform(
  rooms: MovingPlatformRoom[],
  platformObject: LoadedRoomObject,
  platformBody: Phaser.Physics.Arcade.Body,
  deltaX: number,
  deltaY: number,
  options: {
    onLiveObjectMoved?(liveObject: LoadedRoomObject): void;
  },
): void {
  if (deltaX === 0 && deltaY === 0) {
    return;
  }

  for (const loadedRoom of rooms) {
    for (const liveObject of loadedRoom.liveObjects) {
      if (
        liveObject === platformObject ||
        !shouldCarryObjectOnMovingPlatform(liveObject) ||
        !liveObject.sprite.active ||
        !liveObject.sprite.body
      ) {
        continue;
      }

      const body = liveObject.sprite.body as ArcadeObjectBody;
      if (
        !body.enable ||
        (
          isDynamicArcadeBody(body) &&
          body.velocity.y < MOVING_PLATFORM_CARRY_MAX_UPWARD_PLAYER_SPEED
        ) ||
        !bodyIsOnMovingPlatformTop(body, platformBody, {
          edgeInsetPx: MOVING_PLATFORM_CARRY_EDGE_INSET_PX,
          hoverTolerancePx: MOVING_PLATFORM_OBJECT_CARRY_HOVER_TOLERANCE_PX,
          penetrationTolerancePx: MOVING_PLATFORM_OBJECT_CARRY_PENETRATION_TOLERANCE_PX,
        })
      ) {
        continue;
      }

      moveCarriedLiveObjectToPlatformTop(liveObject, body, platformBody, deltaX);
      options.onLiveObjectMoved?.(liveObject);
    }
  }
}

function shouldCarryObjectOnMovingPlatform(liveObject: LoadedRoomObject): boolean {
  return (
    liveObject.config.category === 'collectible' ||
    liveObject.config.category === 'enemy' ||
    (
      liveObject.config.category === 'npc' &&
      liveObject.layer === 'terrain' &&
      (liveObject.runtime.npcMode !== 'idle' || liveObject.runtime.npcPushable)
    )
  );
}

function bodyIsOnMovingPlatformTop(
  body: ArcadeObjectBody,
  platformBody: Phaser.Physics.Arcade.Body,
  options: {
    edgeInsetPx: number;
    hoverTolerancePx: number;
    penetrationTolerancePx: number;
  },
): boolean {
  const bodyBounds = getArcadeBodyBounds(body);
  const platformBounds = getArcadeBodyBounds(platformBody);
  const horizontalOverlap =
    bodyBounds.right - options.edgeInsetPx > platformBounds.left + options.edgeInsetPx &&
    bodyBounds.left + options.edgeInsetPx < platformBounds.right - options.edgeInsetPx;
  const footDistanceFromTop = bodyBounds.bottom - platformBounds.top;

  return (
    horizontalOverlap &&
    footDistanceFromTop >= -options.hoverTolerancePx &&
    footDistanceFromTop <= options.penetrationTolerancePx &&
    bodyBounds.top < platformBounds.top
  );
}

function moveCarriedLiveObjectToPlatformTop(
  liveObject: LoadedRoomObject,
  body: ArcadeObjectBody,
  platformBody: Phaser.Physics.Arcade.Body,
  deltaX: number,
): void {
  const bodyBounds = getArcadeBodyBounds(body);
  const targetBodyCenterX = bodyBounds.centerX + deltaX;
  const targetBodyCenterY = platformBody.top - bodyBounds.height * 0.5;
  const nextSpriteX = liveObject.sprite.x + targetBodyCenterX - bodyBounds.centerX;
  const nextSpriteY = liveObject.sprite.y + targetBodyCenterY - bodyBounds.centerY;

  if (isDynamicArcadeBody(body)) {
    const velocityX = body.velocity.x;
    body.reset(nextSpriteX, nextSpriteY);
    body.updateFromGameObject();
    body.setVelocity(velocityX, 0);
    liveObject.sprite.setPosition(nextSpriteX, nextSpriteY);
    return;
  }

  body.reset(nextSpriteX, nextSpriteY);
}

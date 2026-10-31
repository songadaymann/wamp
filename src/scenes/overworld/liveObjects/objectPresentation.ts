import Phaser from 'phaser';
import { getPlacedObjectLayer, type PlacedObject } from '../../../config';
import { SWORDSMAN_AI_OBJECT_ID } from '../../../enemies/swordsmanAi';
import {
  getBodyVelocityAlongVector,
  getGravityAngle,
  getGravityRightVector,
  type PlayerGravityDirection,
} from '../specialTiles';
import type { LoadedRoomObject } from './model';

export function placedObjectRuntimeDepth(placedObject: Pick<PlacedObject, 'layer'>): number {
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

export function syncGravityPresentation(
  liveObject: LoadedRoomObject,
  host: {
    special(object: LoadedRoomObject): boolean;
    gravity(object: LoadedRoomObject): PlayerGravityDirection;
    body(sprite: Phaser.GameObjects.Sprite): Phaser.Physics.Arcade.Body | null;
    face(sprite: Phaser.GameObjects.Sprite, config: LoadedRoomObject['config'], directionX: number): void;
    screen(directionX: number, gravity: PlayerGravityDirection): number;
  },
): void {
  const shouldRotateWithGravity = liveObject.config.category === 'enemy' && host.special(liveObject);
  const gravityDirection = shouldRotateWithGravity ? host.gravity(liveObject) : 'down';
  liveObject.sprite.setRotation(getGravityAngle(gravityDirection));
  if (!shouldRotateWithGravity || !liveObject.config.facingDirection) return;

  const body = host.body(liveObject.sprite);
  const tangentVelocity = body ? getBodyVelocityAlongVector(body, getGravityRightVector(gravityDirection)) : 0;
  const fallbackDirectionX = liveObject.config.id === SWORDSMAN_AI_OBJECT_ID
    ? liveObject.runtime.aiFacingDirectionX
    : liveObject.runtime.directionX;
  const directionX = Math.abs(tangentVelocity) > 4 ? Math.sign(tangentVelocity) : fallbackDirectionX;
  host.face(liveObject.sprite, liveObject.config, host.screen(directionX, gravityDirection));
}

import Phaser from 'phaser';
import { isPushableObjectConfig } from '../../../config';
import { SWORDSMAN_AI_OBJECT_ID } from '../../../enemies/swordsmanAi';
import type { LoadedFullRoom } from '../worldStreaming';
import type { LoadedRoomObject } from './model';

export interface PressurePlateScanIndex<TEdgeWall = unknown> {
  triggers: Array<{
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>;
    liveObject: LoadedRoomObject;
  }>;
  controlledObjects: Array<{
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>;
    liveObject: LoadedRoomObject;
  }>;
  pressCandidates: LoadedRoomObject[];
}

export function getLinkedTargetKey(roomId: string, instanceId: string): string {
  return `${roomId}:${instanceId}`;
}

export function canActorTriggerBlockSwitchByContact(liveObject: LoadedRoomObject): boolean {
  return (
    liveObject.config.id === SWORDSMAN_AI_OBJECT_ID ||
    liveObject.config.id === 'bird' ||
    liveObject.config.id === 'bat' ||
    liveObject.config.id === 'fish' ||
    liveObject.config.id === 'shark' ||
    liveObject.config.id === 'fireball' ||
    liveObject.config.id === 'cannon_bullet'
  );
}

export function isPressureControlledObject(liveObject: LoadedRoomObject): boolean {
  switch (liveObject.config.id) {
    case 'door_metal':
    case 'door_metal_narrow':
    case 'door_locked':
    case 'door_locked_narrow':
    case 'cage':
    case 'treasure_chest':
    case 'trapdoor_metal':
    case 'trapdoor_locked':
    case 'blast_door':
    case 'barricade':
    case 'wooden_bridge':
      return true;
    default:
      return false;
  }
}

export function canActivatePressurePlate(liveObject: LoadedRoomObject): boolean {
  return isPushableObjectConfig(liveObject.config) || liveObject.config.category === 'enemy';
}

export function getPressurePlateBounds(liveObject: LoadedRoomObject): Phaser.Geom.Rectangle {
  return new Phaser.Geom.Rectangle(liveObject.sprite.x - 8, liveObject.sprite.y + 2, 16, 8);
}

export function buildPressurePlateScanIndex<TEdgeWall>(
  loadedRooms: LoadedFullRoom<LoadedRoomObject, TEdgeWall>[],
): PressurePlateScanIndex<TEdgeWall> {
  const index: PressurePlateScanIndex<TEdgeWall> = {
    triggers: [],
    controlledObjects: [],
    pressCandidates: [],
  };

  for (const loadedRoom of loadedRooms) {
    for (const liveObject of loadedRoom.liveObjects) {
      if (!liveObject.sprite.active) {
        continue;
      }

      if (liveObject.config.id === 'floor_trigger') {
        index.triggers.push({ loadedRoom, liveObject });
      }
      if (isPressureControlledObject(liveObject)) {
        index.controlledObjects.push({ loadedRoom, liveObject });
      }
      if (liveObject.sprite.body && canActivatePressurePlate(liveObject)) {
        index.pressCandidates.push(liveObject);
      }
    }
  }

  return index;
}

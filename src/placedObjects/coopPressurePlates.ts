import { getPlacedObjectLayer, type PlacedObject } from '../config';

export const COOP_ROOM_PRACTICE_MESSAGE = 'Co-op practice. Clears here do not go on solo leaderboards.';

export function canConfigureCoopPlate(placed: Partial<Pick<PlacedObject, 'id' | 'layer'>>): boolean {
  return placed.id === 'floor_trigger' && getPlacedObjectLayer(placed) === 'terrain';
}

export function isCoopPressurePlate(placed: Partial<Pick<PlacedObject, 'id' | 'layer' | 'coopPlate'>>): boolean {
  return canConfigureCoopPlate(placed) && placed.coopPlate === true;
}

export function hasCoopPressurePlates(placedObjects: readonly PlacedObject[]): boolean {
  return placedObjects.some(isCoopPressurePlate);
}

export interface CoopPlateActor {
  roomId: string;
  x: number;
  feetY: number;
}

export function coopPlateActorTouches(
  actor: CoopPlateActor, roomId: string,
  bounds: { x: number; y: number; width: number; height: number },
): boolean {
  return actor.roomId === roomId && Number.isFinite(actor.x) && Number.isFinite(actor.feetY)
    && actor.x + 5 >= bounds.x && actor.x - 5 <= bounds.x + bounds.width
    && actor.feetY >= bounds.y && actor.feetY - 6 <= bounds.y + bounds.height;
}

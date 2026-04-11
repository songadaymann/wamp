import type { PlacedObject } from '../../../config';
import type { CourseSnapshot } from '../../../courses/model';
import type { RoomSnapshot } from '../../../persistence/roomModel';

function computeTileLayerChangeRatio(
  beforeLayer: (number | -1)[][],
  afterLayer: (number | -1)[][],
): number {
  const rows = Math.max(beforeLayer.length, afterLayer.length);
  let changed = 0;
  let total = 0;
  for (let y = 0; y < rows; y += 1) {
    const beforeRow = beforeLayer[y] ?? [];
    const afterRow = afterLayer[y] ?? [];
    const cols = Math.max(beforeRow.length, afterRow.length);
    for (let x = 0; x < cols; x += 1) {
      total += 1;
      if ((beforeRow[x] ?? -1) !== (afterRow[x] ?? -1)) {
        changed += 1;
      }
    }
  }

  return total > 0 ? changed / total : 0;
}

function serializePlacedObjectFingerprint(object: PlacedObject): string {
  return [
    object.id,
    object.x,
    object.y,
    object.facing ?? '',
    object.layer ?? '',
    object.triggerTargetInstanceId ?? '',
    object.containedObjectId ?? '',
    object.instanceId ?? '',
  ].join(':');
}

function computePlacedObjectsChangeRatio(
  beforeObjects: PlacedObject[],
  afterObjects: PlacedObject[],
): number {
  const beforeFingerprints = beforeObjects.map(serializePlacedObjectFingerprint).sort();
  const afterFingerprints = afterObjects.map(serializePlacedObjectFingerprint).sort();
  const size = Math.max(beforeFingerprints.length, afterFingerprints.length);
  if (size === 0) {
    return 0;
  }

  let changed = 0;
  for (let index = 0; index < size; index += 1) {
    if (beforeFingerprints[index] !== afterFingerprints[index]) {
      changed += 1;
    }
  }

  return changed / size;
}

export function computeRoomWeightedChange(
  previous: RoomSnapshot | null,
  next: RoomSnapshot,
): number {
  if (!previous) {
    return 1;
  }

  const tileWeights = {
    background: 0.08,
    terrain: 0.24,
    foreground: 0.08,
  } as const;
  let score = 0;
  score += computeTileLayerChangeRatio(previous.tileData.background, next.tileData.background) * tileWeights.background;
  score += computeTileLayerChangeRatio(previous.tileData.terrain, next.tileData.terrain) * tileWeights.terrain;
  score += computeTileLayerChangeRatio(previous.tileData.foreground, next.tileData.foreground) * tileWeights.foreground;
  score += computePlacedObjectsChangeRatio(previous.placedObjects, next.placedObjects) * 0.28;
  score += (JSON.stringify(previous.goal) === JSON.stringify(next.goal) ? 0 : 0.16);
  score += (JSON.stringify(previous.spawnPoint) === JSON.stringify(next.spawnPoint) ? 0 : 0.08);
  score += (previous.background === next.background ? 0 : 0.04);
  score += (JSON.stringify(previous.lighting) === JSON.stringify(next.lighting) ? 0 : 0.04);

  return Math.max(0, Math.min(1, score));
}

export function computeCourseWeightedChange(
  previous: CourseSnapshot | null,
  next: CourseSnapshot,
): number {
  if (!previous) {
    return 1;
  }

  const previousRooms = previous.roomRefs.map((room) => `${room.roomId}:${room.roomVersion}`).join('|');
  const nextRooms = next.roomRefs.map((room) => `${room.roomId}:${room.roomVersion}`).join('|');
  const previousLinks = previous.pressurePlateLinks
    .map((link) => `${link.triggerRoomId}:${link.triggerInstanceId}:${link.targetRoomId}:${link.targetInstanceId}`)
    .sort()
    .join('|');
  const nextLinks = next.pressurePlateLinks
    .map((link) => `${link.triggerRoomId}:${link.triggerInstanceId}:${link.targetRoomId}:${link.targetInstanceId}`)
    .sort()
    .join('|');

  let score = 0;
  score += previousRooms === nextRooms ? 0 : 0.42;
  score += JSON.stringify(previous.startPoint) === JSON.stringify(next.startPoint) ? 0 : 0.14;
  score += JSON.stringify(previous.goal) === JSON.stringify(next.goal) ? 0 : 0.24;
  score += previousLinks === nextLinks ? 0 : 0.2;

  return Math.max(0, Math.min(1, score));
}

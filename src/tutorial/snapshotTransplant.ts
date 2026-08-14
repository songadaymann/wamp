import {
  cloneRoomSnapshot,
  roomIdFromCoordinates,
  type RoomCoordinates,
  type RoomSnapshot,
} from '../persistence/roomModel';

export function rewriteTutorialSnapshotForClaim(
  source: RoomSnapshot,
  coordinates: RoomCoordinates,
  nowIso: string = new Date().toISOString(),
): RoomSnapshot {
  const result = cloneRoomSnapshot(source);
  result.id = roomIdFromCoordinates(coordinates);
  result.coordinates = { ...coordinates };
  result.version = 1;
  result.status = 'draft';
  result.createdAt = nowIso;
  result.updatedAt = nowIso;
  result.publishedAt = null;
  return result;
}

export function tutorialSnapshotContentMatches(
  expected: RoomSnapshot,
  actual: RoomSnapshot,
): boolean {
  return JSON.stringify(selectTutorialSnapshotContent(expected))
    === JSON.stringify(selectTutorialSnapshotContent(actual));
}

function selectTutorialSnapshotContent(snapshot: RoomSnapshot): object {
  const normalized = cloneRoomSnapshot(snapshot);
  return {
    title: normalized.title,
    goalIntroText: normalized.goalIntroText,
    background: normalized.background,
    lighting: normalized.lighting,
    weather: normalized.weather,
    music: normalized.music,
    goal: normalized.goal,
    spawnPoint: normalized.spawnPoint,
    tileData: normalized.tileData,
    placedObjects: normalized.placedObjects,
    customSprites: normalized.customSprites ?? [],
    customTiles: normalized.customTiles ?? [],
  };
}

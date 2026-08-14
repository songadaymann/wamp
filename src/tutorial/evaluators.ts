import {
  decodeTileDataValue,
  placedObjectContributesToCategory,
} from '../config';
import { DEFAULT_ROOM_BACKGROUND } from '../backgrounds/model';
import type { RoomSnapshot } from '../persistence/roomModel';
import { TUTORIAL_BRIDGE_ROOM } from './config';
import {
  CREATIVE_CHECKLIST_ITEMS,
  cloneCreativeChecklist,
  type CreativeChecklistState,
} from './model';

export interface BridgeSnapshotEvaluation {
  addedTerrainTiles: number;
  readyToPlaytest: boolean;
}

export function evaluateBridgeSnapshot(
  template: RoomSnapshot,
  working: RoomSnapshot,
): BridgeSnapshotEvaluation {
  const region = TUTORIAL_BRIDGE_ROOM.bridgeRegion;
  let addedTerrainTiles = 0;
  for (let y = region.minTileY; y <= region.maxTileY; y += 1) {
    for (let x = region.minTileX; x <= region.maxTileX; x += 1) {
      const before = decodeTileDataValue(template.tileData.terrain[y]?.[x] ?? -1).gid;
      const after = decodeTileDataValue(working.tileData.terrain[y]?.[x] ?? -1).gid;
      if (before <= 0 && after > 0) addedTerrainTiles += 1;
    }
  }
  return {
    addedTerrainTiles,
    readyToPlaytest: addedTerrainTiles >= region.minimumAddedTerrainTiles,
  };
}

export function evaluateCreativeChecklist(
  snapshot: RoomSnapshot,
  previous: CreativeChecklistState,
): CreativeChecklistState {
  const detected = {
    background: snapshot.background !== DEFAULT_ROOM_BACKGROUND,
    ground: snapshot.tileData.terrain.some((row) =>
      row.some((value) => decodeTileDataValue(value).gid > 0)),
    decoration: snapshot.placedObjects.some((placed) =>
      placedObjectContributesToCategory(placed, 'decoration')),
    collectible: snapshot.placedObjects.some((placed) =>
      placedObjectContributesToCategory(placed, 'collectible')),
    enemy: snapshot.placedObjects.some((placed) =>
      placedObjectContributesToCategory(placed, 'enemy')),
    spawn_and_goal: Boolean(
      snapshot.spawnPoint
      && snapshot.goal?.type === 'reach_exit'
      && snapshot.goal.exit,
    ),
  } satisfies Record<keyof CreativeChecklistState, boolean>;

  const result = cloneCreativeChecklist(previous);
  for (const item of CREATIVE_CHECKLIST_ITEMS) {
    if (detected[item]) result[item] = 'done';
    else if (result[item] === 'done') result[item] = 'pending';
  }
  return result;
}

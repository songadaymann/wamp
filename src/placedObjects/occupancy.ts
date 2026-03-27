import {
  TILE_SIZE,
  getObjectById,
  getPlacedObjectLayer,
  type LayerName,
  type PlacedObject,
} from '../config';

export interface PlacedObjectAnchorCell {
  tileX: number;
  tileY: number;
  layer: LayerName;
}

export interface DedupePlacedObjectsResult {
  placedObjects: PlacedObject[];
  replacedInstanceIds: Map<string, string>;
}

export function createPlacedObjectAnchorCell(
  tileX: number,
  tileY: number,
  layer: LayerName,
): PlacedObjectAnchorCell {
  return { tileX, tileY, layer };
}

export function getPlacedObjectAnchorCell(
  placed: Pick<PlacedObject, 'id' | 'x' | 'y' | 'layer'> | null | undefined,
): PlacedObjectAnchorCell | null {
  if (!placed) {
    return null;
  }

  const objectConfig = getObjectById(placed.id);
  if (!objectConfig) {
    return null;
  }

  return {
    tileX: Math.round((placed.x - objectConfig.frameWidth * 0.5) / TILE_SIZE),
    tileY: Math.round((placed.y + objectConfig.frameHeight * 0.5 - TILE_SIZE) / TILE_SIZE),
    layer: getPlacedObjectLayer(placed),
  };
}

export function canPlacedObjectsShareAnchorCell(
  _left: Pick<PlacedObject, 'id'>,
  _right: Pick<PlacedObject, 'id'>,
): boolean {
  // Default policy: one placed object per anchor cell per layer.
  // If future design needs exceptions, define them here.
  return false;
}

export function findConflictingPlacedObjectAtAnchorCell(
  placedObjects: PlacedObject[],
  targetCell: PlacedObjectAnchorCell,
  candidate: Pick<PlacedObject, 'id'>,
): { index: number; placed: PlacedObject } | null {
  for (let index = placedObjects.length - 1; index >= 0; index -= 1) {
    const placed = placedObjects[index];
    const placedCell = getPlacedObjectAnchorCell(placed);
    if (!anchorCellsMatch(placedCell, targetCell)) {
      continue;
    }
    if (canPlacedObjectsShareAnchorCell(placed, candidate)) {
      continue;
    }
    return { index, placed };
  }

  return null;
}

export function dedupePlacedObjectsByAnchorCell(placedObjects: PlacedObject[]): DedupePlacedObjectsResult {
  const deduped: PlacedObject[] = [];
  const replacedInstanceIds = new Map<string, string>();

  for (const placed of placedObjects) {
    const targetCell = getPlacedObjectAnchorCell(placed);
    if (!targetCell) {
      deduped.push(placed);
      continue;
    }

    const conflict = findConflictingPlacedObjectAtAnchorCell(deduped, targetCell, placed);
    if (!conflict) {
      deduped.push(placed);
      continue;
    }

    const merged = mergeDuplicatePlacedObjects(conflict.placed, placed);
    deduped[conflict.index] = merged;
    if (conflict.placed.instanceId !== merged.instanceId) {
      registerReplacementInstanceId(replacedInstanceIds, conflict.placed.instanceId, merged.instanceId);
    }
  }

  return { placedObjects: deduped, replacedInstanceIds };
}

export function resolvePlacedObjectInstanceAlias(
  instanceId: string | null | undefined,
  replacedInstanceIds: Map<string, string>,
): string | null {
  if (!instanceId) {
    return null;
  }

  let resolved = instanceId;
  const visited = new Set<string>();
  while (replacedInstanceIds.has(resolved) && !visited.has(resolved)) {
    visited.add(resolved);
    resolved = replacedInstanceIds.get(resolved) ?? resolved;
  }
  return resolved;
}

function anchorCellsMatch(
  left: PlacedObjectAnchorCell | null,
  right: PlacedObjectAnchorCell | null,
): boolean {
  return Boolean(
    left &&
      right &&
      left.layer === right.layer &&
      left.tileX === right.tileX &&
      left.tileY === right.tileY
  );
}

function mergeDuplicatePlacedObjects(existing: PlacedObject, incoming: PlacedObject): PlacedObject {
  if (existing.id !== incoming.id) {
    return incoming;
  }

  return {
    ...incoming,
    triggerTargetInstanceId: incoming.triggerTargetInstanceId ?? existing.triggerTargetInstanceId ?? null,
    containedObjectId: incoming.containedObjectId ?? existing.containedObjectId ?? null,
  };
}

function registerReplacementInstanceId(
  replacedInstanceIds: Map<string, string>,
  previousInstanceId: string,
  nextInstanceId: string,
): void {
  replacedInstanceIds.set(previousInstanceId, nextInstanceId);
  for (const [candidate, target] of replacedInstanceIds) {
    if (target === previousInstanceId) {
      replacedInstanceIds.set(candidate, nextInstanceId);
    }
  }
}

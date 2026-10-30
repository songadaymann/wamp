import type { PlacedObject } from '../../config';
import { canPlacedObjectUseObjectPath, withPlacedObjectPathTargets } from '../../placedObjects/objectPaths';

export function clonePlacedObjectDocument(
  placedObjects: readonly PlacedObject[],
): PlacedObject[] {
  return placedObjects.map((placed) => ({
    ...placed,
    linkedTargetInstanceIds: placed.linkedTargetInstanceIds
      ? [...placed.linkedTargetInstanceIds]
      : placed.linkedTargetInstanceIds,
  }));
}

export function removePlacedObjectFromDocument(
  placedObjects: readonly PlacedObject[],
  instanceId: string,
): { removed: PlacedObject | null; placedObjects: PlacedObject[] } {
  const removed = placedObjects.find((placed) => placed.instanceId === instanceId) ?? null;
  if (!removed) {
    return { removed: null, placedObjects: clonePlacedObjectDocument(placedObjects) };
  }
  return {
    removed: clonePlacedObjectDocument([removed])[0],
    placedObjects: placedObjects
      .filter((placed) => placed.instanceId !== instanceId)
      .map((placed) => removeLinkedTargetFromPlacedObject(placed, instanceId)),
  };
}

function removeLinkedTargetFromPlacedObject(
  placed: PlacedObject,
  targetInstanceId: string,
): PlacedObject {
  if (canPlacedObjectUseObjectPath(placed)) {
    const currentIds = placed.linkedTargetInstanceIds ?? [];
    const nextIds = currentIds.filter((candidateId) => candidateId !== targetInstanceId);
    if (nextIds.length !== currentIds.length) return withPlacedObjectPathTargets(placed, nextIds);
  }
  return placed.triggerTargetInstanceId === targetInstanceId
    ? { ...placed, triggerTargetInstanceId: null, linkedTargetInstanceIds: null }
    : clonePlacedObjectDocument([placed])[0];
}

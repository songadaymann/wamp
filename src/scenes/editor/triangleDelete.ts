import {
  getPlacedObjectLayer,
  type LayerName,
  type PlacedObject,
} from '../../config';
import { isTrianglePieceObjectId } from '../../config/trianglePiece';
import {
  clonePlacedObjectDocument,
  removePlacedObjectFromDocument,
} from './placedObjectDocument';

/** Drop every triangle whose layer is in `layers`. Returns null when none matched. */
export function removeTrianglesFromPlacedObjects(
  placedObjects: readonly PlacedObject[],
  layers: readonly LayerName[],
): { previous: PlacedObject[]; next: PlacedObject[] } | null {
  const previous = clonePlacedObjectDocument(placedObjects);
  const layerSet = new Set(layers);
  const ids = previous
    .filter((placed) => isTrianglePieceObjectId(placed.id) && layerSet.has(getPlacedObjectLayer(placed)))
    .map((placed) => placed.instanceId)
    .filter((id): id is string => Boolean(id));
  if (ids.length === 0) return null;
  let next = previous;
  for (const id of ids) next = removePlacedObjectFromDocument(next, id).placedObjects;
  return { previous, next };
}

/** Delete the currently pinned triangle via remove + notify. */
export function deletePinnedTriangleObject(host: {
  getPinnedTriangleId(): string | null;
  removePlacedObjectByInstanceId(instanceId: string): PlacedObject | null;
  handleObjectRemoved(removed: PlacedObject): void;
}): boolean {
  const instanceId = host.getPinnedTriangleId();
  if (!instanceId) return false;
  const removed = host.removePlacedObjectByInstanceId(instanceId);
  if (!removed) return false;
  host.handleObjectRemoved(removed);
  return true;
}

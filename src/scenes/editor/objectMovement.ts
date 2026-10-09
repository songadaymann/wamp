import { ROOM_HEIGHT, ROOM_WIDTH, TILE_SIZE, type PlacedObject } from '../../config';
import { clonePlacedObjectDocument } from './placedObjectDocument';
import { findConflictingPlacedObjectAtAnchorCell, getPlacedObjectAnchorCell } from '../../placedObjects/occupancy';

export type ObjectMoveResult = { objects: PlacedObject[]; error: null } | { objects: null; error: string | null };

/** Keep the original anchor alignment while snapping the drag to whole tile offsets. */
export function snapObjectMove(start: { x: number; y: number }, delta: { x: number; y: number }): { x: number; y: number } {
  return { x: start.x + Math.round(delta.x / TILE_SIZE) * TILE_SIZE, y: start.y + Math.round(delta.y / TILE_SIZE) * TILE_SIZE };
}

export function buildMovedObjectDocument(objects: PlacedObject[], instanceId: string, point: { x: number; y: number }, expected?: { x: number; y: number }): ObjectMoveResult {
  const index = objects.findIndex(object => object.instanceId === instanceId);
  const original = objects[index];
  if (!original || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return { objects: null, error: 'That object is no longer available.' };
  if (expected && (original.x !== expected.x || original.y !== expected.y)) return { objects: null, error: 'The object changed while moving. Try again.' };
  if (original.x === point.x && original.y === point.y) return { objects: null, error: null };
  const moved = { ...original, ...point };
  const anchor = getPlacedObjectAnchorCell(moved);
  if (!anchor || anchor.tileX < 0 || anchor.tileX >= ROOM_WIDTH || anchor.tileY < 0 || anchor.tileY >= ROOM_HEIGHT) return { objects: null, error: 'Move within this room cell.' };
  if (findConflictingPlacedObjectAtAnchorCell(objects.filter(object => object.instanceId !== instanceId), anchor, moved)) return { objects: null, error: 'Another object is already in that spot.' };
  const next = clonePlacedObjectDocument(objects);
  next[index] = { ...next[index], ...point };
  return { objects: next, error: null };
}

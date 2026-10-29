import { editorState, TILE_SIZE } from '../../config';
import { isPencilStampPlacement } from './editorToolSelection';
import { forEachDraggedTileCell, resolvePencilStampOrigin } from './stampDrag';
import type { TilePoint } from './shapeTiles';

/** Both editors snap the same selection grid, in slice-local tile coordinates. */
export function resolveEditorPencilOrigin(start: TilePoint | null, current: TilePoint): TilePoint {
  if (!start) return current;
  const stamp = isPencilStampPlacement();
  return resolvePencilStampOrigin(start, current,
    editorState.paletteMode === 'smart' || !stamp ? 1 : Math.max(1, editorState.selection.width),
    editorState.paletteMode === 'smart' || !stamp ? 1 : Math.max(1, editorState.selection.height),
    editorState.pencilContinuousStamping || !stamp);
}

interface PencilStrokeTarget {
  placeTileAt(x: number, y: number): void;
  placeTileStroke(points: readonly TilePoint[]): void;
}

/** Smart terrain needs the whole sampled segment so connected tiles have no gaps. */
export function placeEditorPencilStroke(
  target: PencilStrokeTarget, previous: TilePoint | null, current: TilePoint,
  worldOrigin: TilePoint = { x: 0, y: 0 },
): void {
  if (previous?.x === current.x && previous.y === current.y) return;
  if (editorState.paletteMode !== 'smart' || !previous) {
    target.placeTileAt(worldOrigin.x + current.x * TILE_SIZE, worldOrigin.y + current.y * TILE_SIZE);
    return;
  }
  const points: TilePoint[] = [];
  forEachDraggedTileCell(previous, current, (x, y) => {
    points.push({ x: worldOrigin.x + x * TILE_SIZE, y: worldOrigin.y + y * TILE_SIZE });
  });
  target.placeTileStroke(points);
}

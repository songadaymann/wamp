export function resolvePencilStampOrigin(
  start: { x: number; y: number },
  current: { x: number; y: number },
  width: number,
  height: number,
  continuous: boolean,
): { x: number; y: number } {
  if (continuous || (width <= 1 && height <= 1)) {
    return { x: current.x, y: current.y };
  }

  return {
    x: start.x + Math.floor((current.x - start.x) / width) * width,
    y: start.y + Math.floor((current.y - start.y) / height) * height,
  };
}

/** Visits each newly crossed tile, excluding the start, even when pointer events skip cells. */
export function forEachDraggedTileCell(
  start: { x: number; y: number },
  end: { x: number; y: number },
  visit: (x: number, y: number) => void,
): void {
  let { x, y } = start;
  const dx = Math.abs(end.x - x);
  const sx = x < end.x ? 1 : -1;
  const dy = -Math.abs(end.y - y);
  const sy = y < end.y ? 1 : -1;
  let error = dx + dy;
  while (x !== end.x || y !== end.y) {
    const doubled = error * 2;
    if (doubled >= dy) { error += dy; x += sx; }
    if (doubled <= dx) { error += dx; y += sy; }
    visit(x, y);
  }
}

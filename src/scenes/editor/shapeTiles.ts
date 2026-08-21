export interface TilePoint {
  x: number;
  y: number;
}

export type EditorShapeKind = 'rect' | 'ellipse';

export function constrainToSquare(start: TilePoint, current: TilePoint): TilePoint {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  const size = Math.min(Math.abs(dx), Math.abs(dy));
  return {
    x: start.x + Math.sign(dx) * size,
    y: start.y + Math.sign(dy) * size,
  };
}

export function resolveShapeEnd(start: TilePoint, current: TilePoint, constrain: boolean): TilePoint {
  return constrain ? constrainToSquare(start, current) : current;
}

export function iterateShapeTiles(
  kind: EditorShapeKind,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  outline: boolean,
): TilePoint[] {
  return kind === 'ellipse'
    ? iterateEllipseTiles(x1, y1, x2, y2, outline)
    : iterateRectTiles(x1, y1, x2, y2, outline);
}

export function iterateRectTiles(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  outline: boolean,
): TilePoint[] {
  const bounds = normalizeBounds(x1, y1, x2, y2);
  const tiles: TilePoint[] = [];
  for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
      if (!outline || isRectOutlineTile(x, y, bounds)) {
        tiles.push({ x, y });
      }
    }
  }
  return tiles;
}

export function iterateEllipseTiles(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  outline: boolean,
): TilePoint[] {
  const bounds = normalizeBounds(x1, y1, x2, y2);
  const tiles: TilePoint[] = [];
  for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
      if (!isInsideEllipse(x, y, bounds)) {
        continue;
      }
      if (!outline || isEllipseOutlineTile(x, y, bounds)) {
        tiles.push({ x, y });
      }
    }
  }
  return tiles;
}

interface TileBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function normalizeBounds(x1: number, y1: number, x2: number, y2: number): TileBounds {
  return {
    minX: Math.min(x1, x2),
    minY: Math.min(y1, y2),
    maxX: Math.max(x1, x2),
    maxY: Math.max(y1, y2),
  };
}

function isRectOutlineTile(x: number, y: number, bounds: TileBounds): boolean {
  return x === bounds.minX || x === bounds.maxX || y === bounds.minY || y === bounds.maxY;
}

function isInsideEllipse(x: number, y: number, bounds: TileBounds): boolean {
  const width = bounds.maxX - bounds.minX + 1;
  const height = bounds.maxY - bounds.minY + 1;
  const radiusX = width / 2;
  const radiusY = height / 2;
  if (radiusX <= 0.5 || radiusY <= 0.5) {
    return true;
  }

  const centerX = (bounds.minX + bounds.maxX + 1) / 2;
  const centerY = (bounds.minY + bounds.maxY + 1) / 2;
  const nx = (x + 0.5 - centerX) / radiusX;
  const ny = (y + 0.5 - centerY) / radiusY;
  return nx * nx + ny * ny <= 1;
}

function isEllipseOutlineTile(x: number, y: number, bounds: TileBounds): boolean {
  const neighbors = [
    { x: x - 1, y },
    { x: x + 1, y },
    { x, y: y - 1 },
    { x, y: y + 1 },
  ];
  return neighbors.some((neighbor) => !isInsideEllipse(neighbor.x, neighbor.y, bounds));
}

export interface TilePoint {
  x: number;
  y: number;
}

export type EditorShapeKind = 'rect' | 'ellipse' | 'line' | 'curve';

const LINE_SNAP_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

export function constrainToSquare(start: TilePoint, current: TilePoint): TilePoint {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  const size = Math.min(Math.abs(dx), Math.abs(dy));
  return {
    x: start.x + Math.sign(dx) * size,
    y: start.y + Math.sign(dy) * size,
  };
}

export function snapLineEnd(start: TilePoint, current: TilePoint): TilePoint {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  if (dx === 0 && dy === 0) {
    return { x: current.x, y: current.y };
  }

  const octant = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  const index = ((octant % 8) + 8) % 8;
  const [stepX, stepY] = LINE_SNAP_DIRS[index]!;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  return {
    x: start.x + stepX * steps,
    y: start.y + stepY * steps,
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
  mid?: TilePoint,
): TilePoint[] {
  if (kind === 'line') {
    return iterateLineTiles(x1, y1, x2, y2);
  }
  if (kind === 'curve') {
    return iterateCurveTiles(x1, y1, x2, y2, mid ?? { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) });
  }
  return kind === 'ellipse'
    ? iterateEllipseTiles(x1, y1, x2, y2, outline)
    : iterateRectTiles(x1, y1, x2, y2, outline);
}

export function iterateLineTiles(x1: number, y1: number, x2: number, y2: number): TilePoint[] {
  const tiles: TilePoint[] = [];
  let x = x1;
  let y = y1;
  const deltaX = Math.abs(x2 - x1);
  const deltaY = Math.abs(y2 - y1);
  const stepX = x1 < x2 ? 1 : -1;
  const stepY = y1 < y2 ? 1 : -1;
  let error = deltaX - deltaY;

  while (true) {
    tiles.push({ x, y });
    if (x === x2 && y === y2) {
      break;
    }
    const error2 = error * 2;
    if (error2 > -deltaY) {
      error -= deltaY;
      x += stepX;
    }
    if (error2 < deltaX) {
      error += deltaX;
      y += stepY;
    }
  }

  return tiles;
}

export function iterateCurveTiles(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  mid: TilePoint,
): TilePoint[] {
  const control = {
    x: 2 * mid.x - (x1 + x2) / 2,
    y: 2 * mid.y - (y1 + y2) / 2,
  };
  const span = Math.hypot(x2 - x1, y2 - y1) + Math.hypot(mid.x - x1, mid.y - y1);
  const samples = Math.max(8, Math.ceil(span) * 4);
  const seen = new Set<string>();
  const tiles: TilePoint[] = [];
  let previous: TilePoint | null = null;

  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    const inverse = 1 - t;
    const sample = {
      x: Math.round(inverse * inverse * x1 + 2 * inverse * t * control.x + t * t * x2),
      y: Math.round(inverse * inverse * y1 + 2 * inverse * t * control.y + t * t * y2),
    };
    const segment = previous
      ? iterateLineTiles(previous.x, previous.y, sample.x, sample.y)
      : [sample];
    for (const tile of segment) {
      const key = `${tile.x},${tile.y}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      tiles.push(tile);
    }
    previous = sample;
  }

  return tiles;
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

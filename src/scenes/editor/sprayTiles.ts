import { diagonalPatternIndex } from './selectionPattern';

export const SPRAY_BRUSH_SIZES = [5, 6, 7, 8, 9, 10] as const;
export type SprayBrushSize = (typeof SPRAY_BRUSH_SIZES)[number];

export const SPRAY_FILLED_MATCH_RATIO = 0.9;

export type SprayRng = () => number;

export function clampSprayBrushSize(size: number): SprayBrushSize {
  const next = Math.min(10, Math.max(5, Math.round(size)));
  return next as SprayBrushSize;
}

export function clampSprayRate(rate: number): number {
  if (!Number.isFinite(rate)) {
    return 0;
  }
  return Math.min(1, Math.max(0, rate));
}

export function createCircleBrushMask(size: number): boolean[][] {
  const n = Math.max(1, Math.round(size));
  const center = (n - 1) / 2;
  const radius = n / 2;
  const radiusSq = radius * radius;
  return Array.from({ length: n }, (_, y) => (
    Array.from({ length: n }, (_, x) => {
      const dx = x - center;
      const dy = y - center;
      return dx * dx + dy * dy <= radiusSq;
    })
  ));
}

export function listCircleBrushOffsets(size: number): Array<{ dx: number; dy: number }> {
  const mask = createCircleBrushMask(size);
  const offsets: Array<{ dx: number; dy: number }> = [];
  for (let dy = 0; dy < mask.length; dy += 1) {
    for (let dx = 0; dx < mask[dy]!.length; dx += 1) {
      if (mask[dy]![dx]) {
        offsets.push({ dx, dy });
      }
    }
  }
  return offsets;
}

export function getSprayTilesPerSecond(size: number, rate: number): number {
  const cells = Math.max(1, listCircleBrushOffsets(size).length);
  const minRate = (cells / 5) * 2;
  const maxRate = cells * 2;
  return minRate + clampSprayRate(rate) * (maxRate - minRate);
}

function pickFrom(
  pool: ReadonlyArray<{ dx: number; dy: number }>,
  random: SprayRng,
): { dx: number; dy: number } | null {
  if (pool.length === 0) {
    return null;
  }
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))] ?? null;
}

export function pickSprayOffset(
  offsets: ReadonlyArray<{ dx: number; dy: number }>,
  isMatch: (dx: number, dy: number) => boolean,
  random: SprayRng = Math.random,
  filledRatio: number = SPRAY_FILLED_MATCH_RATIO,
): { dx: number; dy: number } | null {
  if (offsets.length === 0) {
    return null;
  }
  const unmatched = offsets.filter((cell) => !isMatch(cell.dx, cell.dy));
  const matchRatio = (offsets.length - unmatched.length) / offsets.length;
  const pool = unmatched.length > 0 && matchRatio >= filledRatio
    ? unmatched
    : offsets;
  return pickFrom(pool, random);
}

export function pickSprayEraseOffset(
  offsets: ReadonlyArray<{ dx: number; dy: number }>,
  isOccupied: (dx: number, dy: number) => boolean,
  random: SprayRng = Math.random,
  isPreferred?: (dx: number, dy: number) => boolean,
): { dx: number; dy: number } | null {
  if (offsets.length === 0) {
    return null;
  }
  const occupied = offsets.filter((cell) => isOccupied(cell.dx, cell.dy));
  if (occupied.length === 0) {
    return null;
  }
  const preferred = isPreferred
    ? occupied.filter((cell) => isPreferred(cell.dx, cell.dy))
    : occupied;
  return pickFrom(preferred.length > 0 ? preferred : occupied, random);
}

export function sampleSprayTileValue(
  tileX: number,
  tileY: number,
  pool: readonly number[],
  mode: 'pattern' | 'shuffle',
  random: SprayRng = Math.random,
): number {
  if (pool.length === 0) {
    return -1;
  }
  if (mode === 'pattern') {
    return pool[diagonalPatternIndex(tileX, tileY, pool.length)] ?? -1;
  }
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))] ?? -1;
}

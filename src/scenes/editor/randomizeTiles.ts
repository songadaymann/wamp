import {
  decodeTileDataValue,
  encodeTileDataValue,
  editorState,
  type RandomizeBrushSize,
  type TileFlipMode,
  type TileSelection,
} from '../../config';
import { diagonalPatternIndex } from './selectionPattern';

export type RandomizeRng = () => number;

export function clampRandomizeBrushSize(size: number): RandomizeBrushSize {
  const next = Math.min(5, Math.max(1, Math.round(size)));
  return next as RandomizeBrushSize;
}

export function isScrambleOneByOne(size: number): boolean {
  return clampRandomizeBrushSize(size) === 1;
}

export function applyEditorTileFlipModes(
  encoded: number,
  options?: { forceRandom?: boolean; random?: RandomizeRng },
): number {
  if (encoded < 0) {
    return encoded;
  }
  const random = options?.random ?? Math.random;
  const decoded = decodeTileDataValue(encoded);
  return encodeTileDataValue(
    decoded.gid,
    resolveFlip(decoded.flipX, editorState.tileFlipXMode, Boolean(options?.forceRandom), random),
    resolveFlip(decoded.flipY, editorState.tileFlipYMode, Boolean(options?.forceRandom), random),
  );
}

function resolveFlip(
  current: boolean,
  mode: TileFlipMode,
  forceRandom: boolean,
  random: RandomizeRng,
): boolean {
  if (forceRandom || mode === 'rand') {
    return random() < 0.5;
  }
  if (mode === 'on') {
    return true;
  }
  return current;
}

export function collectOccupiedSelectionValues(
  selection: TileSelection,
  readValue: (dx: number, dy: number) => number,
): number[] {
  const values: number[] = [];
  for (let dy = 0; dy < selection.height; dy += 1) {
    for (let dx = 0; dx < selection.width; dx += 1) {
      if (!selection.occupiedMask[dy]?.[dx]) {
        continue;
      }
      const value = readValue(dx, dy);
      if (value >= 0) {
        values.push(value);
      }
    }
  }
  return values;
}

export function sampleDrawWindow(
  size: number,
  pool: number[],
  random: RandomizeRng = Math.random,
): number[][] {
  const grid = Array.from({ length: size }, () => Array.from({ length: size }, () => -1));
  if (pool.length === 0 || size <= 0) {
    return grid;
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      grid[y]![x] = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))] ?? -1;
    }
  }
  return grid;
}

export function samplePatternWindow(
  size: number,
  originX: number,
  originY: number,
  pool: number[],
): number[][] {
  const grid = Array.from({ length: size }, () => Array.from({ length: size }, () => -1));
  if (pool.length === 0 || size <= 0) {
    return grid;
  }
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      grid[y]![x] = pool[diagonalPatternIndex(originX + x, originY + y, pool.length)] ?? -1;
    }
  }
  return grid;
}

export function scrambleWindow(
  grid: number[][],
  random: RandomizeRng = Math.random,
): number[][] {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  const next = grid.map((row) => row.slice());
  if (height === 0 || width === 0) {
    return next;
  }

  const flat = shuffle(next.flat(), random);
  let index = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      next[y]![x] = flat[index] ?? -1;
      index += 1;
    }
  }
  return next;
}

export function applyRandomizeFlips(
  encoded: number,
  flipHorizontal: boolean,
  flipVertical: boolean,
  random: RandomizeRng = Math.random,
): number {
  if (encoded < 0 || (!flipHorizontal && !flipVertical)) {
    return encoded;
  }
  const decoded = decodeTileDataValue(encoded);
  return encodeTileDataValue(
    decoded.gid,
    flipHorizontal ? random() < 0.5 : decoded.flipX,
    flipVertical ? random() < 0.5 : decoded.flipY,
  );
}

export function applyRandomizeFlipsToWindow(
  grid: number[][],
  flipHorizontal: boolean,
  flipVertical: boolean,
  random: RandomizeRng = Math.random,
): number[][] {
  return grid.map((row) => row.map((value) => (
    applyRandomizeFlips(value, flipHorizontal, flipVertical, random)
  )));
}

function shuffle<T>(items: T[], random: RandomizeRng): T[] {
  const next = items.slice();
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = next[index];
    next[index] = next[swapIndex] as T;
    next[swapIndex] = current as T;
  }
  return next;
}

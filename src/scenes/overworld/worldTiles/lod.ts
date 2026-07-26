import type { WorldTileLevel } from './types';

const PROMOTE_THRESHOLDS: readonly number[] = [0.108, 0.216, 0.432, 0.864];
const DEMOTE_THRESHOLDS: readonly number[] = [0.092, 0.184, 0.368, 0.736];
export const WORLD_TILE_LOD_IDLE_COMMIT_MS = 80;

export interface WorldTileLodDecision {
  level: WorldTileLevel;
  changed: boolean;
}

export interface WorldTileDisplayLevelDecision {
  committedLevel: WorldTileLevel;
  displayLevel: WorldTileLevel;
  committed: boolean;
}

export function getInitialWorldTileLevel(zoom: number): WorldTileLevel {
  assertValidZoom(zoom);
  if (zoom < 0.1) return 0;
  if (zoom < 0.2) return 1;
  if (zoom < 0.4) return 2;
  if (zoom < 0.8) return 3;
  return 4;
}

export function selectWorldTileLevel(
  zoom: number,
  currentLevel: WorldTileLevel | null,
): WorldTileLodDecision {
  assertValidZoom(zoom);
  if (currentLevel === null) {
    return { level: getInitialWorldTileLevel(zoom), changed: true };
  }

  let nextLevel: WorldTileLevel = currentLevel;
  while (nextLevel < 4 && zoom >= PROMOTE_THRESHOLDS[nextLevel]) {
    nextLevel = (nextLevel + 1) as WorldTileLevel;
  }
  while (nextLevel > 0 && zoom <= DEMOTE_THRESHOLDS[nextLevel - 1]) {
    nextLevel = (nextLevel - 1) as WorldTileLevel;
  }

  return { level: nextLevel, changed: nextLevel !== currentLevel };
}

export function canCommitWorldTileLevel(input: {
  nowMs: number;
  lastGestureAtMs: number;
  replacementCoverageComplete: boolean;
  idleCommitMs?: number;
}): boolean {
  const idleCommitMs = input.idleCommitMs ?? WORLD_TILE_LOD_IDLE_COMMIT_MS;
  if (![input.nowMs, input.lastGestureAtMs, idleCommitMs].every(Number.isFinite)) {
    throw new RangeError('LOD commit timing values must be finite.');
  }
  if (idleCommitMs < 0 || input.nowMs < input.lastGestureAtMs) {
    return false;
  }
  return input.replacementCoverageComplete &&
    input.nowMs - input.lastGestureAtMs >= idleCommitMs;
}

export function shouldDeferWorldTileTargetRefinement(input: {
  nowMs: number;
  lastGestureAtMs: number;
  committedLevel: WorldTileLevel;
  desiredLevel: WorldTileLevel;
  idleCommitMs?: number;
}): boolean {
  const idleCommitMs = input.idleCommitMs ?? WORLD_TILE_LOD_IDLE_COMMIT_MS;
  if (![input.nowMs, input.lastGestureAtMs, idleCommitMs].every(Number.isFinite)) {
    throw new RangeError('LOD refinement timing values must be finite.');
  }
  return input.desiredLevel !== input.committedLevel
    && input.nowMs >= input.lastGestureAtMs
    && input.nowMs - input.lastGestureAtMs < idleCommitMs;
}

export function selectWorldTileDisplayLevel(input: {
  committedLevel: WorldTileLevel;
  desiredLevel: WorldTileLevel;
  nowMs: number;
  lastGestureAtMs: number;
  replacementCoverageComplete: boolean;
}): WorldTileDisplayLevelDecision {
  const committed = input.desiredLevel !== input.committedLevel && canCommitWorldTileLevel({
    nowMs: input.nowMs,
    lastGestureAtMs: input.lastGestureAtMs,
    replacementCoverageComplete: input.replacementCoverageComplete,
  });
  const committedLevel = committed ? input.desiredLevel : input.committedLevel;
  return {
    committedLevel,
    displayLevel: committedLevel,
    committed,
  };
}

export function getWorldTileLodThresholds(): {
  promote: readonly number[];
  demote: readonly number[];
} {
  return { promote: PROMOTE_THRESHOLDS, demote: DEMOTE_THRESHOLDS };
}

function assertValidZoom(zoom: number): void {
  if (!Number.isFinite(zoom) || zoom <= 0) {
    throw new RangeError(`Zoom must be a positive finite number; received ${zoom}.`);
  }
}

import {
  enumerateWorldTileBounds,
  getWorldTileParent,
  worldRectToTileBounds,
} from './geometry';
import {
  worldTileAddressKey,
  type WorldRect,
  type WorldTileAddress,
  type WorldTileLevel,
  type WorldTileBounds,
  type WorldVelocity,
} from './types';

export const WORLD_TILE_GUARD_RATIO = 0.25;
export const WORLD_TILE_DIRECTIONAL_GUARD_RATIO = 0.5;
export const WORLD_TILE_VELOCITY_PROJECTION_MS = 250;

export interface WorldTileViewportCoverage {
  visibleRect: WorldRect;
  guardRect: WorldRect;
  visibleTiles: WorldTileAddress[];
  guardTiles: WorldTileAddress[];
  siblingClosure: WorldTileAddress[];
  ancestorClosure: WorldTileAddress[];
}

export function clampWorldTileManifestBounds(input: {
  visible: WorldTileBounds;
  guard: WorldTileBounds;
  maxAxis?: number;
}): WorldTileBounds {
  const maxAxis = input.maxAxis ?? 16;
  if (!Number.isSafeInteger(maxAxis) || maxAxis <= 0) {
    throw new RangeError('Manifest maximum axis must be a positive safe integer.');
  }
  const x = clampAxis(
      input.visible.minTileX,
      input.visible.maxTileX,
      input.guard.minTileX,
      input.guard.maxTileX,
      maxAxis,
      'X',
    );
  const y = clampAxis(
      input.visible.minTileY,
      input.visible.maxTileY,
      input.guard.minTileY,
      input.guard.maxTileY,
      maxAxis,
      'Y',
    );
  return {
    minTileX: x.min,
    maxTileX: x.max,
    minTileY: y.min,
    maxTileY: y.max,
  };
}

export function calculateDirectionalGuardRect(input: {
  viewport: WorldRect;
  velocity: WorldVelocity;
  guardRatio?: number;
  directionalGuardRatio?: number;
  projectionMs?: number;
}): WorldRect {
  const { viewport, velocity } = input;
  assertWorldRect(viewport);
  if (!Number.isFinite(velocity.x) || !Number.isFinite(velocity.y)) {
    throw new RangeError('Camera velocity must be finite.');
  }

  const guardRatio = input.guardRatio ?? WORLD_TILE_GUARD_RATIO;
  const directionalGuardRatio = input.directionalGuardRatio ?? WORLD_TILE_DIRECTIONAL_GUARD_RATIO;
  const projectionMs = input.projectionMs ?? WORLD_TILE_VELOCITY_PROJECTION_MS;
  if (guardRatio < 0 || directionalGuardRatio < 0 || projectionMs < 0) {
    throw new RangeError('Guard ratios and projection time cannot be negative.');
  }

  const width = viewport.right - viewport.left;
  const height = viewport.bottom - viewport.top;
  const projectedX = velocity.x * (projectionMs / 1_000);
  const projectedY = velocity.y * (projectionMs / 1_000);
  const rect: WorldRect = {
    left: viewport.left - width * guardRatio,
    right: viewport.right + width * guardRatio,
    top: viewport.top - height * guardRatio,
    bottom: viewport.bottom + height * guardRatio,
  };

  if (projectedX > 0) {
    rect.right += width * directionalGuardRatio + projectedX;
  } else if (projectedX < 0) {
    rect.left -= width * directionalGuardRatio - projectedX;
  }

  if (projectedY > 0) {
    rect.bottom += height * directionalGuardRatio + projectedY;
  } else if (projectedY < 0) {
    rect.top -= height * directionalGuardRatio - projectedY;
  }

  return rect;
}

export function calculateWorldTileViewportCoverage(input: {
  rendererVersion: string;
  level: WorldTileLevel;
  viewport: WorldRect;
  velocity: WorldVelocity;
}): WorldTileViewportCoverage {
  const guardRect = calculateDirectionalGuardRect({
    viewport: input.viewport,
    velocity: input.velocity,
  });
  const visibleTiles = enumerateWorldTileBounds(
    input.rendererVersion,
    input.level,
    worldRectToTileBounds(input.level, input.viewport),
  );
  const guardTiles = enumerateWorldTileBounds(
    input.rendererVersion,
    input.level,
    worldRectToTileBounds(input.level, guardRect),
  );
  const siblingClosure = getWorldTileSiblingClosure(visibleTiles);
  const ancestorClosure = getWorldTileAncestorClosure([
    ...visibleTiles,
    ...siblingClosure,
  ]);

  return {
    visibleRect: { ...input.viewport },
    guardRect,
    visibleTiles,
    guardTiles,
    siblingClosure,
    ancestorClosure,
  };
}

export function getWorldTileSiblingClosure(addresses: readonly WorldTileAddress[]): WorldTileAddress[] {
  const requestedKeys = new Set(addresses.map(worldTileAddressKey));
  const result = new Map<string, WorldTileAddress>();

  for (const address of addresses) {
    const parent = getWorldTileParent(address);
    if (parent === null) {
      continue;
    }

    const baseX = parent.x * 2;
    const baseY = parent.y * 2;
    for (const [xOffset, yOffset] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      const sibling: WorldTileAddress = {
        rendererVersion: address.rendererVersion,
        level: address.level,
        x: baseX + xOffset,
        y: baseY + yOffset,
      };
      const key = worldTileAddressKey(sibling);
      if (!requestedKeys.has(key)) {
        result.set(key, sibling);
      }
    }
  }

  return sortWorldTileAddresses(result.values());
}

export function getWorldTileAncestorClosure(addresses: readonly WorldTileAddress[]): WorldTileAddress[] {
  const requestedKeys = new Set(addresses.map(worldTileAddressKey));
  const result = new Map<string, WorldTileAddress>();

  for (const address of addresses) {
    let ancestor = getWorldTileParent(address);
    while (ancestor !== null) {
      const key = worldTileAddressKey(ancestor);
      if (!requestedKeys.has(key)) {
        result.set(key, ancestor);
      }
      ancestor = getWorldTileParent(ancestor);
    }
  }

  return sortWorldTileAddresses(result.values());
}

export function sortWorldTileAddresses(
  addresses: Iterable<WorldTileAddress>,
): WorldTileAddress[] {
  return Array.from(addresses).sort((left, right) =>
    left.level - right.level ||
    left.y - right.y ||
    left.x - right.x ||
    left.rendererVersion.localeCompare(right.rendererVersion)
  );
}

function assertWorldRect(rect: WorldRect): void {
  if (![rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite)) {
    throw new RangeError('Viewport values must be finite.');
  }
  if (rect.right <= rect.left || rect.bottom <= rect.top) {
    throw new RangeError('Viewport must have positive width and height.');
  }
}

function clampAxis(
  visibleMin: number,
  visibleMax: number,
  guardMin: number,
  guardMax: number,
  maxAxis: number,
  axis: 'X' | 'Y',
): { min: number; max: number } {
  const visibleSize = visibleMax - visibleMin + 1;
  if (visibleSize > maxAxis) {
    throw new RangeError(`Visible world tile ${axis} axis exceeds the manifest limit.`);
  }
  const guardSize = guardMax - guardMin + 1;
  let min = guardMin;
  let max = guardMax;
  if (guardSize > maxAxis) {
    const centeredMin = Math.floor((guardMin + guardMax - maxAxis + 1) / 2);
    min = Math.min(centeredMin, visibleMin);
    max = min + maxAxis - 1;
    if (max < visibleMax) {
      max = visibleMax;
      min = max - maxAxis + 1;
    }
    if (min < guardMin) {
      min = guardMin;
      max = min + maxAxis - 1;
    }
    if (max > guardMax) {
      max = guardMax;
      min = max - maxAxis + 1;
    }
  }
  return { min, max };
}

import { getWorldTileChildren, getWorldTileParent } from './geometry';
import {
  worldTileAddressKey,
  type WorldTileAddress,
  type WorldTileLevel,
} from './types';

export type WorldTileAvailability =
  | { state: 'pending' }
  | { state: 'failed' }
  | { state: 'ready-empty' }
  | { state: 'ready-image'; decoded: boolean; gpuReady: boolean; stale?: boolean };

export interface WorldTileSiblingReplacementPlan {
  parentKey: string;
  canCommit: boolean;
  keepParent: boolean;
  attachChildKeys: string[];
  missingChildKeys: string[];
  readyEmptyChildKeys: string[];
  detachKeys: string[];
}

export interface WorldTileVisibleCoverage {
  visibleCount: number;
  coveredCount: number;
  staleCount: number;
  coveragePercentage: number;
  fallbackKeys: string[];
  uncoveredKeys: string[];
}

export function planWorldTileSiblingReplacement(input: {
  parent: WorldTileAddress;
  availabilityByKey: ReadonlyMap<string, WorldTileAvailability>;
  parentIsAttached: boolean;
}): WorldTileSiblingReplacementPlan {
  const children = getWorldTileChildren(input.parent);
  if (children.length !== 4) {
    throw new RangeError('Only a four-child non-leaf tile can be replacement-planned.');
  }

  const attachChildKeys: string[] = [];
  const missingChildKeys: string[] = [];
  const readyEmptyChildKeys: string[] = [];
  for (const child of children) {
    const key = worldTileAddressKey(child);
    const availability = input.availabilityByKey.get(key);
    if (availability?.state === 'ready-empty') {
      readyEmptyChildKeys.push(key);
    } else if (
      availability?.state === 'ready-image' &&
      availability.decoded &&
      availability.gpuReady
    ) {
      attachChildKeys.push(key);
    } else {
      missingChildKeys.push(key);
    }
  }

  const canCommit = missingChildKeys.length === 0;
  const parentKey = worldTileAddressKey(input.parent);
  return {
    parentKey,
    canCommit,
    keepParent: input.parentIsAttached && !canCommit,
    attachChildKeys: canCommit ? attachChildKeys : [],
    missingChildKeys,
    readyEmptyChildKeys: canCommit ? readyEmptyChildKeys : [],
    detachKeys: canCommit && input.parentIsAttached ? [parentKey] : [],
  };
}

export function resolveVisibleWorldTileCoverage(input: {
  visibleTargets: readonly WorldTileAddress[];
  availabilityByKey: ReadonlyMap<string, WorldTileAvailability>;
}): WorldTileVisibleCoverage {
  const fallbackKeys = new Set<string>();
  const uncoveredKeys: string[] = [];
  let coveredCount = 0;
  let staleCount = 0;

  for (const target of input.visibleTargets) {
    let candidate: WorldTileAddress | null = target;
    let covered = false;
    while (candidate !== null) {
      const key = worldTileAddressKey(candidate);
      const availability = input.availabilityByKey.get(key);
      if (isWorldTileDisplayable(availability)) {
        covered = true;
        coveredCount += 1;
        if (candidate.level !== target.level) {
          fallbackKeys.add(key);
        }
        if (availability.state === 'ready-image' && availability.stale) {
          staleCount += 1;
        }
        break;
      }
      candidate = getWorldTileParent(candidate);
    }

    if (!covered) {
      uncoveredKeys.push(worldTileAddressKey(target));
    }
  }

  const visibleCount = input.visibleTargets.length;
  return {
    visibleCount,
    coveredCount,
    staleCount,
    coveragePercentage: visibleCount === 0 ? 100 : (coveredCount / visibleCount) * 100,
    fallbackKeys: Array.from(fallbackKeys).sort(),
    uncoveredKeys,
  };
}

export function isWorldTileDisplayable(
  availability: WorldTileAvailability | undefined,
): availability is Extract<WorldTileAvailability, { state: 'ready-empty' | 'ready-image' }> {
  return availability?.state === 'ready-empty' || (
    availability?.state === 'ready-image' &&
    availability.decoded &&
    availability.gpuReady
  );
}

export function getWorldTileAncestorAtLevel(
  address: WorldTileAddress,
  level: WorldTileLevel,
): WorldTileAddress | null {
  if (level > address.level) {
    return null;
  }

  let ancestor: WorldTileAddress | null = address;
  while (ancestor !== null && ancestor.level > level) {
    ancestor = getWorldTileParent(ancestor);
  }
  return ancestor;
}

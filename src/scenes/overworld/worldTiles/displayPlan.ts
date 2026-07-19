import { getWorldTileChildren, getWorldTileParent } from './geometry';
import { isWorldTileDisplayable, type WorldTileAvailability } from './coverage';
import { worldTileAddressKey, type WorldTileAddress } from './types';

export interface WorldTileDisplayPlan {
  displayImageKeys: string[];
  coveredTargetKeys: string[];
  uncoveredTargetKeys: string[];
  fallbackKeys: string[];
  staleCount: number;
}

export function isWorldTileTargetReplacementComplete(plan: WorldTileDisplayPlan): boolean {
  return plan.uncoveredTargetKeys.length === 0 && plan.fallbackKeys.length === 0;
}

export function shouldUseWorldTileBrowseCutover(input: {
  rolloutEnabled: boolean;
  shadow: boolean;
  browse: boolean;
  coarseCoverageComplete: boolean;
  fallbackActive: boolean;
}): boolean {
  // Once coarse coverage establishes the cutover, transient viewport gaps stay
  // behind existing tile imagery. Only the sticky fallback controller may
  // reactivate compact published-room rendering.
  return input.rolloutEnabled
    && !input.shadow
    && input.browse
    && input.coarseCoverageComplete
    && !input.fallbackActive;
}

export function resolveWorldTileDisplayPlan(input: {
  targets: readonly WorldTileAddress[];
  availabilityByKey: ReadonlyMap<string, WorldTileAvailability>;
  previousRendererVersion?: string | null;
}): WorldTileDisplayPlan {
  const displayImageKeys = new Set<string>();
  const coveredTargetKeys: string[] = [];
  const uncoveredTargetKeys: string[] = [];
  const fallbackKeys = new Set<string>();
  let staleCount = 0;

  for (const target of input.targets) {
    const resolved = resolveTarget(target, input.availabilityByKey)
      ?? (input.previousRendererVersion
        ? resolveTarget(
            { ...target, rendererVersion: input.previousRendererVersion },
            input.availabilityByKey,
          )
        : null);
    const targetKey = worldTileAddressKey(target);
    if (!resolved) {
      uncoveredTargetKeys.push(targetKey);
      continue;
    }

    coveredTargetKeys.push(targetKey);
    if (
      resolved.address.level !== target.level
      || resolved.address.rendererVersion !== target.rendererVersion
    ) {
      fallbackKeys.add(worldTileAddressKey(resolved.address));
    }
    if (resolved.stale) staleCount += 1;
    for (const address of resolved.atomicGroup) {
      const key = worldTileAddressKey(address);
      if (input.availabilityByKey.get(key)?.state === 'ready-image') {
        displayImageKeys.add(key);
      }
    }
  }

  return {
    displayImageKeys: [...displayImageKeys].sort(),
    coveredTargetKeys,
    uncoveredTargetKeys,
    fallbackKeys: [...fallbackKeys].sort(),
    staleCount,
  };
}

function resolveTarget(
  target: WorldTileAddress,
  availabilityByKey: ReadonlyMap<string, WorldTileAvailability>,
): { address: WorldTileAddress; atomicGroup: WorldTileAddress[]; stale: boolean } | null {
  let candidate: WorldTileAddress | null = target;
  let isTargetLevel = true;
  while (candidate) {
    const group = getAtomicGroup(candidate);
    const candidateReady = isWorldTileDisplayable(
      availabilityByKey.get(worldTileAddressKey(candidate)),
    );
    const groupReady = group.every((address) => (
      isWorldTileDisplayable(availabilityByKey.get(worldTileAddressKey(address)))
    ));
    if (candidateReady && (!isTargetLevel || groupReady)) {
      const availability = availabilityByKey.get(worldTileAddressKey(candidate));
      return {
        address: candidate,
        atomicGroup: isTargetLevel ? group : [candidate],
        stale: availability?.state === 'ready-image' && availability.stale === true,
      };
    }
    candidate = getWorldTileParent(candidate);
    isTargetLevel = false;
  }
  return null;
}

function getAtomicGroup(address: WorldTileAddress): WorldTileAddress[] {
  const parent = getWorldTileParent(address);
  return parent ? getWorldTileChildren(parent) : [address];
}

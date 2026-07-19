export const WORLD_TILE_REPLACEMENT_READY_EVENT = 'wamp:world-tiles-replacement-ready';
export const WORLD_TILE_REPLACEMENT_INVALIDATED_EVENT = 'wamp:world-tiles-replacement-invalidated';

export type WorldReplacementCoverageSource = 'tiled' | 'compact' | 'legacy';

export interface WorldReplacementCoverageReadyState {
  schemaVersion: 1;
  key: string;
  source: WorldReplacementCoverageSource;
  generation: number;
  readyAtMs: number;
  rendererVersion?: string;
  targetLevel?: number;
}

export interface WorldReplacementCoverageInvalidatedEventDetail {
  schemaVersion: 1;
  key: string;
  source: WorldReplacementCoverageSource;
  generation: number;
}

export interface WorldReplacementCoverageEventTarget {
  dispatchEvent(event: Event): boolean;
  __wampWorldReplacementCoverage?: WorldReplacementCoverageReadyState | null;
}

declare global {
  interface Window {
    __wampWorldReplacementCoverage?: WorldReplacementCoverageReadyState | null;
  }
}

export function getWorldReplacementCoverageState(
  target: WorldReplacementCoverageEventTarget | null = getDefaultTarget(),
): WorldReplacementCoverageReadyState | null {
  return target?.__wampWorldReplacementCoverage ?? null;
}

export function publishWorldReplacementCoverageReady(
  state: WorldReplacementCoverageReadyState,
  target: WorldReplacementCoverageEventTarget | null = getDefaultTarget(),
): boolean {
  if (!target) return false;
  const current = getWorldReplacementCoverageState(target);
  if (
    current?.key === state.key
    && current.source === state.source
    && current.generation === state.generation
  ) return false;

  const publishedState = Object.freeze({ ...state });
  target.__wampWorldReplacementCoverage = publishedState;
  target.dispatchEvent(new CustomEvent<WorldReplacementCoverageReadyState>(
    WORLD_TILE_REPLACEMENT_READY_EVENT,
    { detail: publishedState },
  ));
  return true;
}

export function clearWorldReplacementCoverage(
  expectedKey: string,
  target: WorldReplacementCoverageEventTarget | null = getDefaultTarget(),
): boolean {
  if (!target) return false;
  const current = getWorldReplacementCoverageState(target);
  if (!current || current.key !== expectedKey) return false;

  target.__wampWorldReplacementCoverage = null;
  const detail: WorldReplacementCoverageInvalidatedEventDetail = {
    schemaVersion: 1,
    key: current.key,
    source: current.source,
    generation: current.generation,
  };
  target.dispatchEvent(new CustomEvent<WorldReplacementCoverageInvalidatedEventDetail>(
    WORLD_TILE_REPLACEMENT_INVALIDATED_EVENT,
    { detail },
  ));
  return true;
}

function getDefaultTarget(): WorldReplacementCoverageEventTarget | null {
  return typeof window === 'undefined' ? null : window;
}

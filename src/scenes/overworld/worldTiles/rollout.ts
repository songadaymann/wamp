import type { WorldTileConfig } from './types';

const WORLD_TILE_COHORT_STORAGE_KEY = 'wamp_world_tile_cohort_v1';
const WORLD_TILE_ROLLOUT_OVERRIDES = new Set(['force', 'shadow', 'off']);

export type WorldTileRolloutDecision =
  | { enabled: true; forced: boolean; shadow: boolean; cohortId: string; bucket: number }
  | { enabled: false; forced: boolean; shadow: false; cohortId: string; bucket: number; reason: string };

export function getOrCreateWorldTileCohortId(storage: Pick<Storage, 'getItem' | 'setItem'>): string {
  const existing = storage.getItem(WORLD_TILE_COHORT_STORAGE_KEY)?.trim();
  if (existing && existing.length >= 8 && existing.length <= 128) {
    return existing;
  }

  const cohortId = createCohortId();
  try {
    storage.setItem(WORLD_TILE_COHORT_STORAGE_KEY, cohortId);
  } catch {
    // Private browsing and quota failures still get a stable value for this page session.
  }
  return cohortId;
}

export function getWorldTileCohortBucket(cohortId: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < cohortId.length; index += 1) {
    hash ^= cohortId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0x1_0000_0000 * 100;
}

export function captureWorldTileRolloutSearch(search: string): string {
  const override = new URLSearchParams(search).get('worldTiles')?.trim().toLowerCase() ?? '';
  if (!WORLD_TILE_ROLLOUT_OVERRIDES.has(override)) return '';
  return `?worldTiles=${encodeURIComponent(override)}`;
}

export function decideWorldTileRollout(input: {
  config: WorldTileConfig;
  cohortId: string;
  search?: string;
}): WorldTileRolloutDecision {
  const params = new URLSearchParams(input.search ?? '');
  const override = params.get('worldTiles')?.trim().toLowerCase() ?? null;
  const forced = override === 'force';
  const shadow = override === 'shadow';
  const bucket = getWorldTileCohortBucket(input.cohortId);

  if (input.config.schemaVersion !== 1) {
    return { enabled: false, forced, shadow: false, cohortId: input.cohortId, bucket, reason: 'schema-incompatible' };
  }
  if (override === 'off') {
    return { enabled: false, forced: false, shadow: false, cohortId: input.cohortId, bucket, reason: 'query-disabled' };
  }
  if (!input.config.available || !input.config.activeRendererVersion) {
    return { enabled: false, forced, shadow: false, cohortId: input.cohortId, bucket, reason: 'unavailable' };
  }
  if (forced) {
    return { enabled: true, forced: true, shadow: false, cohortId: input.cohortId, bucket };
  }
  if (shadow) {
    return { enabled: true, forced: false, shadow: true, cohortId: input.cohortId, bucket };
  }
  if (bucket >= input.config.rolloutPercentage) {
    return { enabled: false, forced: false, shadow: false, cohortId: input.cohortId, bucket, reason: 'outside-cohort' };
  }
  return { enabled: true, forced: false, shadow: false, cohortId: input.cohortId, bucket };
}

function createCohortId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const random = Math.random().toString(36).slice(2);
  return `tile-${Date.now().toString(36)}-${random}`;
}

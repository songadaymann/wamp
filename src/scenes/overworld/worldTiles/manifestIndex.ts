import { getWorldTileAncestorClosure, getWorldTileSiblingClosure } from './viewport';
import { worldTileAddressKey, type WorldTileAddress, type WorldTileManifestEntry, type WorldTileBounds, type WorldTileLevel } from './types';
import { enumerateWorldTileBounds } from './geometry';

const entryKeys = new WeakMap<WorldTileManifestEntry, { address: string; task: string }>();

function keysFor(entry: WorldTileManifestEntry): { address: string; task: string } {
  let keys = entryKeys.get(entry);
  if (!keys) {
    const address = worldTileAddressKey(entry.address);
    keys = { address, task: `${address}:${entry.ready?.contentHash ?? 'empty'}` };
    entryKeys.set(entry, keys);
  }
  return keys;
}

export const getWorldTileEntryAddressKey = (entry: WorldTileManifestEntry): string => keysFor(entry).address;
export const getWorldTileEntryTaskKey = (entry: WorldTileManifestEntry): string => keysFor(entry).task;

/** Manifest metadata is cheaper than textures, but should not grow for a whole session. */
export class WorldTileManifestIndex {
  readonly entries = new Map<string, WorldTileManifestEntry>();

  constructor(private readonly capacity = 2_048) {}

  set(entry: WorldTileManifestEntry): void {
    const key = getWorldTileEntryAddressKey(entry);
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  touch(keys: Iterable<string>): void {
    for (const key of keys) {
      const entry = this.entries.get(key);
      if (!entry) continue;
      this.entries.delete(key);
      this.entries.set(key, entry);
    }
  }

  /** Called on manifest ingestion, never on every frame. Critical imagery may exceed the cap. */
  prune(protectedKeys: ReadonlySet<string>): string[] {
    const removed: string[] = [];
    if (this.entries.size <= this.capacity) return removed;
    for (const key of this.entries.keys()) {
      if (protectedKeys.has(key)) continue;
      this.entries.delete(key);
      removed.push(key);
      if (this.entries.size <= this.capacity) break;
    }
    return removed;
  }
}

interface CandidateKeys {
  visibleKeys: Set<string>;
  siblingKeys: Set<string>;
  ancestorKeys: Set<string>;
  guardKeys: Set<string>;
  keys: Set<string>;
}

/** Reuses closures while the tile bounds and selected address remain unchanged. */
export class WorldTileCoverageCandidates {
  private inputs: readonly unknown[] = [];
  private cached: CandidateKeys | null = null;

  resolve(
    desiredVisible: readonly WorldTileAddress[], desiredGuards: readonly WorldTileAddress[],
    displayVisible: readonly WorldTileAddress[], displayGuards: readonly WorldTileAddress[],
    selectedKey: string | null,
  ): CandidateKeys {
    const inputs = [desiredVisible, desiredGuards, displayVisible, displayGuards, selectedKey];
    if (this.cached && inputs.every((input, index) => input === this.inputs[index])) return this.cached;
    const visible = [...desiredVisible, ...displayVisible];
    const siblings = getWorldTileSiblingClosure(visible);
    const visibleKeys = new Set(visible.map(worldTileAddressKey));
    const siblingKeys = new Set(siblings.map(worldTileAddressKey));
    const ancestorKeys = new Set(getWorldTileAncestorClosure([...visible, ...siblings]).map(worldTileAddressKey));
    const guardKeys = new Set([...desiredGuards, ...displayGuards].map(worldTileAddressKey));
    const keys = new Set([...visibleKeys, ...siblingKeys, ...ancestorKeys, ...guardKeys]);
    if (selectedKey) keys.add(selectedKey);
    this.inputs = inputs;
    return this.cached = { visibleKeys, siblingKeys, ancestorKeys, guardKeys, keys };
  }
}

interface CachedCoverage {
  visible: WorldTileAddress[];
  guard: WorldTileAddress[];
  visibleBounds: WorldTileBounds;
  manifestBounds: WorldTileBounds;
}

/** Five level slots keep stable geometry reusable without retaining past viewports. */
export class WorldTileCoverageCache {
  private readonly levels = new Map<WorldTileLevel, { renderer: string; coverage: CachedCoverage }>();

  resolve(renderer: string, level: WorldTileLevel, visible: WorldTileBounds, guard: WorldTileBounds): CachedCoverage {
    const cached = this.levels.get(level);
    if (cached?.renderer === renderer && sameBounds(cached.coverage.visibleBounds, visible)
      && sameBounds(cached.coverage.manifestBounds, guard)) return cached.coverage;
    const coverage = {
      visible: enumerateWorldTileBounds(renderer, level, visible),
      guard: enumerateWorldTileBounds(renderer, level, guard),
      visibleBounds: visible, manifestBounds: guard,
    };
    this.levels.set(level, { renderer, coverage });
    return coverage;
  }
}

function sameBounds(a: WorldTileBounds, b: WorldTileBounds): boolean {
  return a.minTileX === b.minTileX && a.maxTileX === b.maxTileX
    && a.minTileY === b.minTileY && a.maxTileY === b.maxTileY;
}

export function getWorldTileDisplayAvailabilityKeys(targets: readonly WorldTileAddress[], previousRenderer: string | null): Set<string> {
  const siblings = getWorldTileSiblingClosure(targets);
  const addresses = [...targets, ...siblings, ...getWorldTileAncestorClosure(targets)];
  const keys = new Set(addresses.map(worldTileAddressKey));
  if (previousRenderer) for (const address of addresses) keys.add(worldTileAddressKey({ ...address, rendererVersion: previousRenderer }));
  return keys;
}

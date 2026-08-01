export interface RoomArtifactCacheEntry {
  key: string;
  roomId: string;
  byteSize: number;
  resourceKeys: readonly string[];
  resourceByteSizes?: Readonly<Record<string, number>>;
}

export interface RoomArtifactCacheSnapshot {
  budgetBytes: number;
  totalBytes: number;
  entryCount: number;
  protectedCount: number;
  evictionCount: number;
}

interface StoredRoomArtifact extends RoomArtifactCacheEntry {
  lastUsedAt: number;
  normalizedResourceByteSizes: ReadonlyMap<string, number>;
  unattributedByteSize: number;
}

/**
 * Byte-budgeted LRU ownership for completed room rendering artifacts.
 * The cache never guesses how a Phaser resource should be destroyed; callers
 * receive the exact resource keys when an entry is evicted or invalidated.
 */
export class RoomArtifactCache {
  private readonly entriesByKey = new Map<string, StoredRoomArtifact>();
  private readonly resourceReferenceCounts = new Map<string, number>();
  private protectedKeys = new Set<string>();
  private clock = 0;
  private totalBytes = 0;
  private evictionCount = 0;

  constructor(
    private budgetBytes: number,
    private readonly releaseResources: (resourceKeys: readonly string[]) => void,
  ) {
    this.budgetBytes = normalizeByteSize(budgetBytes);
  }

  setBudgetBytes(budgetBytes: number): void {
    this.budgetBytes = normalizeByteSize(budgetBytes);
    this.evictToBudget();
  }

  setProtectedKeys(keys: Iterable<string>): void {
    this.protectedKeys = new Set(keys);
    this.evictToBudget();
  }

  has(key: string): boolean {
    return this.entriesByKey.has(key);
  }

  referencesResource(resourceKey: string): boolean {
    return (this.resourceReferenceCounts.get(resourceKey) ?? 0) > 0;
  }

  touch(key: string): boolean {
    const entry = this.entriesByKey.get(key);
    if (!entry) {
      return false;
    }
    entry.lastUsedAt = ++this.clock;
    return true;
  }

  record(entry: RoomArtifactCacheEntry): void {
    const normalizedByteSize = normalizeByteSize(entry.byteSize);
    const resourceKeys = Array.from(new Set(entry.resourceKeys));
    const normalizedSizes = normalizeResourceByteSizes(
      resourceKeys,
      normalizedByteSize,
      entry.resourceByteSizes,
    );
    const normalized: StoredRoomArtifact = {
      ...entry,
      byteSize: normalizedByteSize,
      resourceKeys,
      normalizedResourceByteSizes: normalizedSizes.resourceByteSizes,
      unattributedByteSize: normalizedSizes.unattributedByteSize,
      lastUsedAt: ++this.clock,
    };
    const previous = this.entriesByKey.get(entry.key);
    if (previous) {
      const previousResourceKeys = new Set(previous.resourceKeys);
      const nextResourceKeys = new Set(normalized.resourceKeys);
      this.releaseResourceReferences(
        previous.resourceKeys.filter((resourceKey) => !nextResourceKeys.has(resourceKey)),
      );
      this.retainResourceReferences(
        normalized.resourceKeys.filter((resourceKey) => !previousResourceKeys.has(resourceKey)),
      );
    } else {
      this.retainResourceReferences(normalized.resourceKeys);
    }
    this.entriesByKey.set(entry.key, normalized);
    this.recalculateTotalBytes();
    this.evictToBudget();
  }

  invalidateRoom(roomId: string): void {
    for (const entry of Array.from(this.entriesByKey.values())) {
      if (entry.roomId === roomId) {
        this.removeEntry(entry, false);
      }
    }
  }

  clear(): void {
    for (const entry of Array.from(this.entriesByKey.values())) {
      this.removeEntry(entry, false);
    }
    this.protectedKeys.clear();
    this.resourceReferenceCounts.clear();
  }

  getSnapshot(): RoomArtifactCacheSnapshot {
    let protectedCount = 0;
    for (const key of this.protectedKeys) {
      if (this.entriesByKey.has(key)) {
        protectedCount += 1;
      }
    }
    return {
      budgetBytes: this.budgetBytes,
      totalBytes: this.totalBytes,
      entryCount: this.entriesByKey.size,
      protectedCount,
      evictionCount: this.evictionCount,
    };
  }

  private evictToBudget(): void {
    if (this.totalBytes <= this.budgetBytes) {
      return;
    }
    const candidates = Array.from(this.entriesByKey.values())
      .filter((entry) => !this.protectedKeys.has(entry.key))
      .sort((left, right) => left.lastUsedAt - right.lastUsedAt);
    for (const entry of candidates) {
      if (this.totalBytes <= this.budgetBytes) {
        break;
      }
      this.removeEntry(entry, true);
    }
  }

  private removeEntry(entry: StoredRoomArtifact, eviction: boolean): void {
    if (!this.entriesByKey.delete(entry.key)) {
      return;
    }
    this.protectedKeys.delete(entry.key);
    if (eviction) {
      this.evictionCount += 1;
    }
    this.releaseResourceReferences(entry.resourceKeys);
    this.recalculateTotalBytes();
  }

  private retainResourceReferences(resourceKeys: readonly string[]): void {
    for (const resourceKey of resourceKeys) {
      this.resourceReferenceCounts.set(
        resourceKey,
        (this.resourceReferenceCounts.get(resourceKey) ?? 0) + 1,
      );
    }
  }

  private releaseResourceReferences(resourceKeys: readonly string[]): void {
    const unreferencedResourceKeys: string[] = [];
    for (const resourceKey of resourceKeys) {
      const nextCount = (this.resourceReferenceCounts.get(resourceKey) ?? 0) - 1;
      if (nextCount > 0) {
        this.resourceReferenceCounts.set(resourceKey, nextCount);
      } else {
        this.resourceReferenceCounts.delete(resourceKey);
        unreferencedResourceKeys.push(resourceKey);
      }
    }
    if (unreferencedResourceKeys.length > 0) {
      this.releaseResources(unreferencedResourceKeys);
    }
  }

  private recalculateTotalBytes(): void {
    const uniqueResourceByteSizes = new Map<string, number>();
    let totalBytes = 0;
    for (const entry of this.entriesByKey.values()) {
      totalBytes += entry.unattributedByteSize;
      for (const [resourceKey, byteSize] of entry.normalizedResourceByteSizes) {
        uniqueResourceByteSizes.set(
          resourceKey,
          Math.max(uniqueResourceByteSizes.get(resourceKey) ?? 0, byteSize),
        );
      }
    }
    for (const byteSize of uniqueResourceByteSizes.values()) {
      totalBytes += byteSize;
    }
    this.totalBytes = totalBytes;
  }
}

function normalizeByteSize(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizeResourceByteSizes(
  resourceKeys: readonly string[],
  totalByteSize: number,
  requestedSizes: Readonly<Record<string, number>> | undefined,
): {
  resourceByteSizes: ReadonlyMap<string, number>;
  unattributedByteSize: number;
} {
  if (resourceKeys.length === 0) {
    return {
      resourceByteSizes: new Map(),
      unattributedByteSize: totalByteSize,
    };
  }

  const resourceByteSizes = new Map<string, number>();
  let attributedByteSize = 0;
  const unspecifiedResourceKeys: string[] = [];
  for (const resourceKey of resourceKeys) {
    const requestedSize = requestedSizes?.[resourceKey];
    if (requestedSize === undefined || !Number.isFinite(requestedSize)) {
      unspecifiedResourceKeys.push(resourceKey);
      continue;
    }
    const normalizedSize = normalizeByteSize(requestedSize);
    resourceByteSizes.set(resourceKey, normalizedSize);
    attributedByteSize += normalizedSize;
  }

  let remainingByteSize = Math.max(0, totalByteSize - attributedByteSize);
  for (let index = 0; index < unspecifiedResourceKeys.length; index += 1) {
    const remainingResourceCount = unspecifiedResourceKeys.length - index;
    const byteSize = Math.floor(remainingByteSize / remainingResourceCount);
    resourceByteSizes.set(unspecifiedResourceKeys[index], byteSize);
    remainingByteSize -= byteSize;
  }

  return {
    resourceByteSizes,
    unattributedByteSize: unspecifiedResourceKeys.length === 0
      ? Math.max(0, totalByteSize - attributedByteSize)
      : 0,
  };
}

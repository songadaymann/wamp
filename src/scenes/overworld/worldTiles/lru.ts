export interface WeightedLruEviction<K, V> {
  key: K;
  value: V;
  weight: number;
}

export interface WeightedLruSetResult<K, V> {
  stored: boolean;
  evicted: WeightedLruEviction<K, V>[];
}

interface WeightedLruRecord<V> {
  value: V;
  weight: number;
  pinned: boolean;
  recency: number;
}

export class WeightedPinnedLruCache<K, V> {
  private readonly records = new Map<K, WeightedLruRecord<V>>();
  private recency = 0;
  private total = 0;

  constructor(private capacity: number) {
    assertWeight(capacity, 'capacity');
  }

  get size(): number {
    return this.records.size;
  }

  get totalWeight(): number {
    return this.total;
  }

  get capacityWeight(): number {
    return this.capacity;
  }

  has(key: K): boolean {
    return this.records.has(key);
  }

  get(key: K): V | undefined {
    const record = this.records.get(key);
    if (!record) {
      return undefined;
    }
    record.recency = ++this.recency;
    return record.value;
  }

  peek(key: K): V | undefined {
    return this.records.get(key)?.value;
  }

  set(
    key: K,
    value: V,
    weight: number,
    options: { pinned?: boolean } = {},
  ): WeightedLruSetResult<K, V> {
    assertWeight(weight, 'entry weight');
    const previous = this.records.get(key);
    if (previous) {
      this.total -= previous.weight;
    }

    this.records.set(key, {
      value,
      weight,
      pinned: options.pinned ?? previous?.pinned ?? false,
      recency: ++this.recency,
    });
    this.total += weight;
    const evicted = this.trim();
    return { stored: this.records.has(key), evicted };
  }

  pin(key: K): boolean {
    const record = this.records.get(key);
    if (!record) return false;
    record.pinned = true;
    record.recency = ++this.recency;
    return true;
  }

  unpin(key: K): WeightedLruEviction<K, V>[] {
    const record = this.records.get(key);
    if (!record) return [];
    record.pinned = false;
    return this.trim();
  }

  isPinned(key: K): boolean {
    return this.records.get(key)?.pinned ?? false;
  }

  delete(key: K): WeightedLruEviction<K, V> | null {
    const record = this.records.get(key);
    if (!record) return null;
    this.records.delete(key);
    this.total -= record.weight;
    return { key, value: record.value, weight: record.weight };
  }

  setCapacity(capacity: number): WeightedLruEviction<K, V>[] {
    assertWeight(capacity, 'capacity');
    this.capacity = capacity;
    return this.trim();
  }

  clear(): WeightedLruEviction<K, V>[] {
    const evicted = Array.from(this.records.entries()).map(([key, record]) => ({
      key,
      value: record.value,
      weight: record.weight,
    }));
    this.records.clear();
    this.total = 0;
    return evicted;
  }

  keysByMostRecent(): K[] {
    return Array.from(this.records.entries())
      .sort((left, right) => right[1].recency - left[1].recency)
      .map(([key]) => key);
  }

  private trim(): WeightedLruEviction<K, V>[] {
    const evicted: WeightedLruEviction<K, V>[] = [];
    while (this.total > this.capacity) {
      let oldest: { key: K; record: WeightedLruRecord<V> } | null = null;
      for (const [key, record] of this.records) {
        if (record.pinned) continue;
        if (oldest === null || record.recency < oldest.record.recency) {
          oldest = { key, record };
        }
      }
      if (oldest === null) break;

      this.records.delete(oldest.key);
      this.total -= oldest.record.weight;
      evicted.push({
        key: oldest.key,
        value: oldest.record.value,
        weight: oldest.record.weight,
      });
    }
    return evicted;
  }
}

function assertWeight(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`LRU ${label} must be a finite non-negative number.`);
  }
}

import type Phaser from 'phaser';
import { getPerformanceProfile } from '../ui/deviceLayout';

// Unused custom backgrounds kept decoded so walking straight back into a room does not
// refetch and redecode it. A 1280x768 still holds about 12 MB, so phones keep one (F352).
const REDUCED_IDLE_CUSTOM_BACKGROUNDS = 1;
const DEFAULT_IDLE_CUSTOM_BACKGROUNDS = 4;

export type ReleaseCustomBackgroundTexture = () => void;

export interface CustomBackgroundTextureLeaseOptions {
  isResident: (key: string) => boolean;
  remove: (key: string) => void;
  getIdleCapacity: () => number;
  /** Runs eviction after the current task, so a release followed by a re-acquire keeps the texture. */
  schedule?: (callback: () => void) => void;
}

export interface CustomBackgroundTextureLeaseSnapshot {
  leases: Record<string, number>;
  idle: string[];
}

/**
 * Counts the rooms, editors and previews drawing each custom background texture. A resident
 * texture nobody holds joins a small idle list and is removed once the list is over capacity;
 * removal also stops an animated background's frame loop (animation.ts).
 */
export class CustomBackgroundTextureLeases {
  private readonly counts = new Map<string, number>();
  // Insertion order is least recently released first.
  private readonly idle = new Set<string>();
  private trimScheduled = false;

  constructor(private readonly options: CustomBackgroundTextureLeaseOptions) {}

  acquire(key: string): ReleaseCustomBackgroundTexture {
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
    this.idle.delete(key);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = (this.counts.get(key) ?? 1) - 1;
      if (remaining > 0) {
        this.counts.set(key, remaining);
        return;
      }
      this.counts.delete(key);
      this.markIdle(key);
    };
  }

  /** Called when a texture is committed; one that every requester gave up on starts out idle. */
  noteResident(key: string): void {
    if (!this.counts.has(key)) this.markIdle(key);
  }

  getSnapshot(): CustomBackgroundTextureLeaseSnapshot {
    return {
      leases: Object.fromEntries(this.counts),
      idle: [...this.idle],
    };
  }

  /** Removes idle textures beyond capacity, oldest first. */
  trim(): void {
    this.trimScheduled = false;
    const capacity = Math.max(0, Math.floor(this.options.getIdleCapacity()));
    for (const key of this.idle) {
      if (!this.options.isResident(key)) this.idle.delete(key);
    }
    for (const key of this.idle) {
      if (this.idle.size <= capacity) break;
      this.idle.delete(key);
      this.options.remove(key);
    }
  }

  private markIdle(key: string): void {
    this.idle.delete(key);
    if (!this.options.isResident(key)) return;
    this.idle.add(key);
    if (this.trimScheduled) return;
    this.trimScheduled = true;
    const schedule = this.options.schedule ?? queueMicrotask;
    schedule(() => this.trim());
  }
}

const leasesByTextureManager = new WeakMap<
  Phaser.Textures.TextureManager,
  CustomBackgroundTextureLeases
>();

export function getCustomBackgroundTextureLeases(
  textures: Phaser.Textures.TextureManager,
): CustomBackgroundTextureLeases {
  let leases = leasesByTextureManager.get(textures);
  if (!leases) {
    leases = new CustomBackgroundTextureLeases({
      isResident: (key) => textures.exists(key),
      remove: (key) => {
        textures.remove(key);
      },
      getIdleCapacity: () => getPerformanceProfile() === 'reduced'
        ? REDUCED_IDLE_CUSTOM_BACKGROUNDS
        : DEFAULT_IDLE_CUSTOM_BACKGROUNDS,
    });
    leasesByTextureManager.set(textures, leases);
  }
  return leases;
}

export function acquireCustomBackgroundTexture(
  scene: Phaser.Scene,
  key: string,
): ReleaseCustomBackgroundTexture {
  return getCustomBackgroundTextureLeases(scene.textures).acquire(key);
}

/** Keeps a custom background texture resident until `owner` is destroyed. */
export function holdCustomBackgroundTextureFor(
  scene: Phaser.Scene,
  key: string,
  owner: Phaser.GameObjects.GameObject,
): void {
  owner.once('destroy', acquireCustomBackgroundTexture(scene, key));
}

/**
 * Holds one lease per background key for a changing set of users, such as the rooms in the
 * visible map previews.
 */
export class CustomBackgroundTextureLeaseSet {
  private readonly releases = new Map<string, ReleaseCustomBackgroundTexture>();

  constructor(private readonly acquire: (key: string) => ReleaseCustomBackgroundTexture) {}

  sync(keys: Iterable<string>): void {
    const next = new Set(keys);
    for (const key of next) {
      if (!this.releases.has(key)) this.releases.set(key, this.acquire(key));
    }
    for (const [key, release] of this.releases) {
      if (next.has(key)) continue;
      this.releases.delete(key);
      release();
    }
  }

  releaseAll(): void {
    this.sync([]);
  }
}

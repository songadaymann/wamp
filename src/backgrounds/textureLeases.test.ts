import type Phaser from 'phaser';
import { describe, expect, it, vi } from 'vitest';

import {
  CustomBackgroundTextureLeaseSet,
  CustomBackgroundTextureLeases,
  getCustomBackgroundTextureLeases,
  holdCustomBackgroundTextureFor,
} from './textureLeases';

function harness(capacity = 1) {
  const resident = new Set<string>();
  const removed: string[] = [];
  const scheduled: Array<() => void> = [];
  const leases = new CustomBackgroundTextureLeases({
    isResident: (key) => resident.has(key),
    remove: (key) => {
      resident.delete(key);
      removed.push(key);
    },
    getIdleCapacity: () => capacity,
    schedule: (callback) => scheduled.push(callback),
  });
  const flush = () => {
    for (const callback of scheduled.splice(0)) callback();
  };
  return { leases, resident, removed, scheduled, flush };
}

describe('CustomBackgroundTextureLeases', () => {
  it('keeps a texture while any holder remains and counts each release once', () => {
    const { leases, resident, removed, flush } = harness(0);
    resident.add('a');
    const first = leases.acquire('a');
    const second = leases.acquire('a');

    first();
    first();
    flush();
    expect(leases.getSnapshot()).toEqual({ leases: { a: 1 }, idle: [] });
    expect(removed).toEqual([]);

    second();
    expect(leases.getSnapshot()).toEqual({ leases: {}, idle: ['a'] });
    flush();
    expect(removed).toEqual(['a']);
    expect(leases.getSnapshot().idle).toEqual([]);
  });

  it('keeps the most recently released textures up to the idle capacity', () => {
    const { leases, resident, removed, flush } = harness(1);
    for (const key of ['a', 'b', 'c']) resident.add(key);
    const releases = ['a', 'b', 'c'].map((key) => leases.acquire(key));

    for (const release of releases) release();
    flush();

    expect(removed).toEqual(['a', 'b']);
    expect(leases.getSnapshot().idle).toEqual(['c']);
  });

  it('defers eviction, so a room rebuilt in the same synchronous step keeps its texture', () => {
    const { leases, resident, removed, scheduled, flush } = harness(0);
    resident.add('a');
    leases.acquire('a')();
    const reacquired = leases.acquire('a');

    expect(scheduled).toHaveLength(1);
    flush();
    expect(removed).toEqual([]);
    expect(leases.getSnapshot()).toEqual({ leases: { a: 1 }, idle: [] });

    reacquired();
    flush();
    expect(removed).toEqual(['a']);
  });

  it('lets a texture that lands after every holder left become idle instead of leaking', () => {
    const { leases, resident, removed, flush } = harness(0);
    leases.acquire('late')();
    flush();
    expect(leases.getSnapshot().idle).toEqual([]);

    resident.add('late');
    leases.noteResident('late');
    flush();
    expect(removed).toEqual(['late']);
  });

  it('does not idle a newly committed texture that someone is waiting for', () => {
    const { leases, resident, removed, flush } = harness(0);
    const release = leases.acquire('wanted');
    resident.add('wanted');
    leases.noteResident('wanted');
    flush();

    expect(removed).toEqual([]);
    expect(leases.getSnapshot()).toEqual({ leases: { wanted: 1 }, idle: [] });
    release();
    flush();
    expect(removed).toEqual(['wanted']);
  });

  it('drops idle entries whose texture was already removed elsewhere', () => {
    const { leases, resident, removed, flush } = harness(1);
    resident.add('a');
    resident.add('b');
    leases.acquire('a')();
    resident.delete('a');
    leases.acquire('b')();
    flush();

    expect(removed).toEqual([]);
    expect(leases.getSnapshot().idle).toEqual(['b']);
  });
});

describe('scene texture leases', () => {
  function textureManager(keys: string[]) {
    const resident = new Set(keys);
    return {
      exists: vi.fn((key: string) => resident.has(key)),
      remove: vi.fn((key: string) => resident.delete(key)),
    } as unknown as Phaser.Textures.TextureManager & {
      remove: ReturnType<typeof vi.fn>;
    };
  }

  it('shares one registry per texture manager and removes through Phaser', async () => {
    const textures = textureManager(['a', 'b', 'c', 'd', 'e']);
    const leases = getCustomBackgroundTextureLeases(textures);
    expect(getCustomBackgroundTextureLeases(textures)).toBe(leases);
    expect(getCustomBackgroundTextureLeases(textureManager([]))).not.toBe(leases);

    for (const key of ['a', 'b', 'c', 'd', 'e']) leases.acquire(key)();
    await Promise.resolve();

    // Desktop keeps four unused backgrounds; the oldest one goes.
    expect(textures.remove).toHaveBeenCalledTimes(1);
    expect(textures.remove).toHaveBeenCalledWith('a');
  });

  it('releases a hold when its owner is destroyed', () => {
    const textures = textureManager(['custom_background_x']);
    const scene = { textures } as unknown as Phaser.Scene;
    let onDestroy: (() => void) | null = null;
    const owner = {
      once: vi.fn((event: string, listener: () => void) => {
        expect(event).toBe('destroy');
        onDestroy = listener;
      }),
    } as unknown as Phaser.GameObjects.GameObject;

    holdCustomBackgroundTextureFor(scene, 'custom_background_x', owner);
    const leases = getCustomBackgroundTextureLeases(textures);
    expect(leases.getSnapshot().leases).toEqual({ custom_background_x: 1 });

    onDestroy!();
    expect(leases.getSnapshot()).toEqual({ leases: {}, idle: ['custom_background_x'] });
  });
});

describe('CustomBackgroundTextureLeaseSet', () => {
  it('acquires new keys, keeps unchanged ones and releases the rest', () => {
    const events: string[] = [];
    const set = new CustomBackgroundTextureLeaseSet((key) => {
      events.push(`acquire:${key}`);
      return () => events.push(`release:${key}`);
    });

    set.sync(['a', 'b']);
    set.sync(['b', 'c', 'c']);
    set.releaseAll();

    expect(events).toEqual([
      'acquire:a',
      'acquire:b',
      'acquire:c',
      'release:a',
      'release:b',
      'release:c',
    ]);
  });
});

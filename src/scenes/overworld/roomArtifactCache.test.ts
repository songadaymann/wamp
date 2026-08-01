import { describe, expect, it, vi } from 'vitest';

import { RoomArtifactCache } from './roomArtifactCache';

describe('RoomArtifactCache', () => {
  it('evicts least-recently-used unprotected artifacts by byte size', () => {
    const release = vi.fn();
    const cache = new RoomArtifactCache(10, release);
    cache.record({ key: 'a', roomId: '0,0', byteSize: 4, resourceKeys: ['a-terrain'] });
    cache.record({ key: 'b', roomId: '1,0', byteSize: 4, resourceKeys: ['b-terrain'] });
    cache.touch('a');

    cache.record({ key: 'c', roomId: '2,0', byteSize: 4, resourceKeys: ['c-terrain'] });

    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(true);
    expect(release).toHaveBeenCalledWith(['b-terrain']);
    expect(cache.getSnapshot()).toMatchObject({ totalBytes: 8, evictionCount: 1 });
  });

  it('protects active and prepared artifacts even when they exceed the soft budget', () => {
    const release = vi.fn();
    const cache = new RoomArtifactCache(5, release);
    cache.setProtectedKeys(['current', 'prepared']);

    cache.record({ key: 'current', roomId: '0,0', byteSize: 4, resourceKeys: ['current'] });
    cache.record({ key: 'prepared', roomId: '1,0', byteSize: 4, resourceKeys: ['prepared'] });

    expect(cache.getSnapshot()).toMatchObject({ totalBytes: 8, protectedCount: 2 });
    expect(release).not.toHaveBeenCalled();
  });

  it('purges every version of an invalidated room', () => {
    const release = vi.fn();
    const cache = new RoomArtifactCache(100, release);
    cache.record({ key: 'v1', roomId: '5,7', byteSize: 4, resourceKeys: ['terrain-v1'] });
    cache.record({ key: 'v2', roomId: '5,7', byteSize: 4, resourceKeys: ['terrain-v2', 'custom-v2'] });
    cache.record({ key: 'other', roomId: '0,0', byteSize: 4, resourceKeys: ['other'] });

    cache.invalidateRoom('5,7');

    expect(cache.has('v1')).toBe(false);
    expect(cache.has('v2')).toBe(false);
    expect(cache.has('other')).toBe(true);
    expect(release).toHaveBeenCalledWith(['terrain-v1']);
    expect(release).toHaveBeenCalledWith(['terrain-v2', 'custom-v2']);
  });

  it('releases only resources removed by replacement', () => {
    const release = vi.fn();
    const cache = new RoomArtifactCache(100, release);
    cache.record({ key: 'same', roomId: '0,0', byteSize: 8, resourceKeys: ['terrain', 'old-custom'] });

    cache.record({ key: 'same', roomId: '0,0', byteSize: 6, resourceKeys: ['terrain', 'new-custom'] });

    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(['old-custom']);
    expect(cache.getSnapshot()).toMatchObject({ totalBytes: 6, entryCount: 1 });
  });

  it('keeps shared resources until the final owning entry is removed', () => {
    const release = vi.fn();
    const cache = new RoomArtifactCache(8, release);
    cache.record({
      key: 'published-v1',
      roomId: '5,7',
      byteSize: 4,
      resourceKeys: ['shared-terrain', 'published-only'],
    });
    cache.record({
      key: 'draft-v1',
      roomId: '5,7',
      byteSize: 4,
      resourceKeys: ['shared-terrain', 'draft-only'],
    });

    cache.setBudgetBytes(4);

    expect(cache.has('published-v1')).toBe(false);
    expect(cache.has('draft-v1')).toBe(true);
    expect(cache.referencesResource('shared-terrain')).toBe(true);
    expect(release).toHaveBeenCalledWith(['published-only']);
    expect(release).not.toHaveBeenCalledWith(
      expect.arrayContaining(['shared-terrain']),
    );

    cache.invalidateRoom('5,7');

    expect(cache.referencesResource('shared-terrain')).toBe(false);
    expect(release).toHaveBeenCalledWith(
      expect.arrayContaining(['shared-terrain', 'draft-only']),
    );
  });

  it('counts shared resource bytes once across source-specific artifact entries', () => {
    const cache = new RoomArtifactCache(100, vi.fn());
    cache.record({
      key: 'published-v1',
      roomId: '5,7',
      byteSize: 12,
      resourceKeys: ['shared-terrain', 'published-only'],
      resourceByteSizes: {
        'shared-terrain': 8,
        'published-only': 4,
      },
    });
    cache.record({
      key: 'draft-v1',
      roomId: '5,7',
      byteSize: 12,
      resourceKeys: ['shared-terrain', 'draft-only'],
      resourceByteSizes: {
        'shared-terrain': 8,
        'draft-only': 4,
      },
    });

    expect(cache.getSnapshot()).toMatchObject({
      totalBytes: 16,
      entryCount: 2,
    });
  });
});

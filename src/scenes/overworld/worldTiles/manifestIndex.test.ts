import { describe, expect, it } from 'vitest';
import { WorldTileCoverageCache, WorldTileCoverageCandidates, WorldTileManifestIndex } from './manifestIndex';
import type { WorldTileManifestEntry } from './types';

function entry(x: number): WorldTileManifestEntry {
  return {
    address: { rendererVersion: 'test', level: 4, x, y: 0 }, desiredGeneration: 1,
    desiredEmpty: true, readyEmptyGeneration: 1, ready: null, staleRoomIds: [],
  };
}

describe('bounded world tile manifest work', () => {
  it('forgets old metadata while preserving attached and in-flight addresses', () => {
    const index = new WorldTileManifestIndex(3);
    for (let x = 0; x < 6; x++) index.set(entry(x));
    expect(index.prune(new Set(['test:4:0:0', 'test:4:1:0']))).toEqual([
      'test:4:2:0', 'test:4:3:0', 'test:4:4:0',
    ]);
    expect([...index.entries.keys()]).toEqual(['test:4:0:0', 'test:4:1:0', 'test:4:5:0']);
    index.touch(['test:4:0:0']);
    index.set(entry(6));
    index.prune(new Set());
    expect(index.entries.has('test:4:1:0')).toBe(false);
    expect(index.entries.has('test:4:0:0')).toBe(true);
  });

  it('never removes protected metadata when critical coverage exceeds the soft cap', () => {
    const index = new WorldTileManifestIndex(1);
    index.set(entry(0)); index.set(entry(1));
    expect(index.prune(new Set(index.entries.keys()))).toEqual([]);
    expect(index.entries.size).toBe(2);
    expect(index.prune(new Set())).toEqual(['test:4:0:0']);
  });

  it('reuses stationary geometry and invalidates it for guard, renderer, or viewport changes', () => {
    const cache = new WorldTileCoverageCache();
    const bounds = { minTileX: 0, maxTileX: 1, minTileY: 0, maxTileY: 1 };
    const first = cache.resolve('test', 4, bounds, bounds);
    expect(cache.resolve('test', 4, { ...bounds }, { ...bounds })).toBe(first);
    const shifted = cache.resolve('test', 4, bounds, { ...bounds, maxTileX: 2 });
    expect(shifted).not.toBe(first);
    expect(shifted.guard).toHaveLength(6);
    expect(cache.resolve('new', 4, bounds, bounds).visible[0]?.rendererVersion).toBe('new');
  });

  it('reuses candidate closures and includes selected, sibling and ancestor addresses', () => {
    const cache = new WorldTileCoverageCandidates();
    const visible = [entry(0).address];
    const guards = [entry(2).address];
    const first = cache.resolve(visible, guards, visible, guards, 'test:4:7:0');
    expect(cache.resolve(visible, guards, visible, guards, 'test:4:7:0')).toBe(first);
    expect(first.keys.has('test:4:7:0')).toBe(true);
    expect(first.keys.has('test:4:1:1')).toBe(true);
    expect(first.keys.has('test:0:0:0')).toBe(true);
    const next = cache.resolve(visible, guards, visible, guards, 'test:4:8:0');
    expect(next.keys.has('test:4:7:0')).toBe(false);
    expect(next.keys.has('test:4:8:0')).toBe(true);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { EditorDocumentCache } from './documentCache';

describe('editor derived document cache', () => {
  it('exports once across repeated frames and rebuilds for edit, Undo, Redo and load revisions', () => {
    const cache = new EditorDocumentCache<object>(), build = vi.fn(() => ({}));
    const first = cache.get(1, true, build);
    for (let i = 0; i < 300; i++) expect(cache.get(1, true, build)).toBe(first);
    expect(build).toHaveBeenCalledTimes(1);
    for (const revision of [2, 3, 4, 5]) expect(cache.get(revision, true, build)).not.toBe(first);
    expect(build).toHaveBeenCalledTimes(5);
  });
  it('does no disabled lighting/weather work and refreshes when reenabled after an edit', () => {
    const cache = new EditorDocumentCache<number[]>(), build = vi.fn(() => [1]);
    expect(cache.get(0, false, build)).toBeNull(); expect(build).not.toHaveBeenCalled();
    const first = cache.get(0, true, build);
    expect(cache.get(0, false, build)).toBeNull(); expect(cache.get(0, true, build)).toBe(first);
    expect(cache.get(1, false, build)).toBeNull();
    expect(cache.get(1, true, build)).not.toBe(first); expect(build).toHaveBeenCalledTimes(2);
  });
  it('reset releases the old value and forces a rebuild even at an unchanged revision', () => {
    const cache = new EditorDocumentCache<object>(), build = vi.fn(() => ({}));
    const previous = cache.get(5, true, build); cache.reset();
    expect(cache.get(5, true, build)).not.toBe(previous); expect(build).toHaveBeenCalledTimes(2);
  });
});

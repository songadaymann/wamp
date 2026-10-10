import { describe, expect, it } from 'vitest';
import { MAX_EDITOR_STAMPS, deleteEditorStamp, describeStamp, listEditorStamps, saveEditorStamp } from './stampStorage';
import type { EditorClipboardState } from './clipboard';

function storage(limit = Infinity) {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { if (value.length > limit) throw new Error('quota'); values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } as unknown as Storage;
}

const clipboard = (width = 2): EditorClipboardState => ({
  sourceLayer: 'terrain', width, height: 1, tiles: [Array(width).fill(5)], occupiedMask: [Array(width).fill(true)],
  objects: [{ id: 'coin_gold', instanceId: 'coin', x: 8, y: 8 }],
});

describe('My Stamps storage', () => {
  it('saves newest first, names stamps by contents, and deletes', () => {
    const store = storage();
    const first = saveEditorStamp(clipboard(2), store, new Date('2026-10-09T10:00:00Z'));
    const second = saveEditorStamp(clipboard(3), store, new Date('2026-10-09T11:00:00Z'));
    expect(first.stamp?.name).toBe('2×1 terrain · 2 tiles · 1 object');
    expect(listEditorStamps(store).map((stamp) => stamp.id)).toEqual([second.stamp!.id, first.stamp!.id]);
    expect(listEditorStamps(store)[0].clipboard).toEqual(clipboard(3));
    deleteEditorStamp(first.stamp!.id, store);
    expect(listEditorStamps(store).map((stamp) => stamp.id)).toEqual([second.stamp!.id]);
    expect(describeStamp({ ...clipboard(1), objects: undefined, occupiedMask: [[false]] })).toBe('1×1 terrain');
  });

  it('refuses past the stamp limit, an oversized stamp, or a full storage quota', () => {
    const store = storage();
    for (let i = 0; i < MAX_EDITOR_STAMPS; i += 1) expect(saveEditorStamp(clipboard(), store).stamp).not.toBeNull();
    expect(saveEditorStamp(clipboard(), store).error).toMatch(/up to 24 stamps/);
    expect(saveEditorStamp({ ...clipboard(), objects: [{ id: 'sign', instanceId: 's', x: 0, y: 0, signText: 'x'.repeat(3_100_000) }] }, storage()).error)
      .toMatch(/too large/);
    expect(saveEditorStamp(clipboard(), storage(10)).error).toMatch(/storage is full/);
    expect(saveEditorStamp(clipboard(), null).error).toMatch(/unavailable/);
  });

  it('ignores corrupt stored data', () => {
    const store = storage();
    store.setItem('wamp_editor_stamps_v1', '[{"id":"x"},"junk"]');
    expect(listEditorStamps(store)).toEqual([]);
    store.setItem('wamp_editor_stamps_v1', 'not json');
    expect(listEditorStamps(store)).toEqual([]);
  });
});

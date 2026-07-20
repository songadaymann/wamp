import { describe, expect, it, vi } from 'vitest';
import { processProgressivePreviewBatch } from './progressivePreviewBatch';

describe('progressive world preview batch', () => {
  it('filters canonical published rooms before requesting snapshots after cutover', async () => {
    const dynamicRoomIds = new Set(['draft']);
    const loadSnapshots = vi.fn(async () => {});
    const prepareLoaded = vi.fn(async () => 'prepared');
    const mergeLoaded = vi.fn();

    await processProgressivePreviewBatch({
      batchIds: ['published-a', 'draft', 'published-b'],
      selectCurrentRoomIds: (roomIds) => new Set(
        [...roomIds].filter((roomId) => dynamicRoomIds.has(roomId)),
      ),
      loadSnapshots,
      prepareLoaded,
      mergeLoaded,
    });

    expect(loadSnapshots).toHaveBeenCalledWith(['draft']);
    expect(prepareLoaded).toHaveBeenCalledWith(new Set(['draft']));
    expect(mergeLoaded).toHaveBeenCalledWith('prepared', new Set(['draft']));
  });

  it('re-filters after snapshot loading and before the final merge', async () => {
    let cutoverActive = false;
    const loadSnapshots = vi.fn(async () => {
      cutoverActive = true;
    });
    const prepareLoaded = vi.fn(async () => {
      cutoverActive = true;
      return 'prepared';
    });
    const mergeLoaded = vi.fn();

    await processProgressivePreviewBatch({
      batchIds: ['published', 'draft'],
      selectCurrentRoomIds: (roomIds) => new Set(
        [...roomIds].filter((roomId) => !cutoverActive || roomId === 'draft'),
      ),
      loadSnapshots,
      prepareLoaded,
      mergeLoaded,
    });

    expect(loadSnapshots).toHaveBeenCalledWith(['published', 'draft']);
    expect(prepareLoaded).toHaveBeenCalledWith(new Set(['draft']));
    expect(mergeLoaded).toHaveBeenCalledWith('prepared', new Set(['draft']));
  });

  it('does not merge when cutover activates while loaded previews are prepared', async () => {
    let cutoverActive = false;
    const mergeLoaded = vi.fn();

    await processProgressivePreviewBatch({
      batchIds: ['published'],
      selectCurrentRoomIds: (roomIds) => cutoverActive ? new Set() : roomIds,
      loadSnapshots: async () => {},
      prepareLoaded: async () => {
        cutoverActive = true;
        return 'prepared';
      },
      mergeLoaded,
    });

    expect(mergeLoaded).not.toHaveBeenCalled();
  });
});

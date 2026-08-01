import { describe, expect, it, vi } from 'vitest';
import type { RoomSnapshot } from '../../persistence/roomModel';
import type { WorldRoomSummary } from '../../persistence/worldModel';
import { SelectedExactPrefetchLifecycle } from './selectedExactPrefetch';
import { OverworldWorldStreamingController } from './worldStreaming';

vi.mock('phaser', () => ({ default: {} }));

describe('world streaming selected exact prefetch', () => {
  it('deduplicates the request and refreshes selected state after the missing snapshot arrives', async () => {
    const loaded = deferred<RoomSnapshot | null>();
    const selected = { x: 0, y: 0 };
    const room = { id: '0,0', coordinates: selected, status: 'published', version: 7 } as RoomSnapshot;
    const summary = {
      id: room.id,
      coordinates: selected,
      state: 'published',
      version: room.version,
    } as WorldRoomSummary;
    let cachedRoom: RoomSnapshot | null = null;
    const prefetchPublishedRoom = vi.fn(() => loaded.promise);
    const onSelectedExactRoomSnapshotReady = vi.fn();
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype) as Record<string, unknown>,
      {
        options: {
          scene: { cameras: { main: {} } },
          getSelectedCoordinates: () => selected,
          onSelectedExactRoomSnapshotReady,
        },
        worldTileController: {
          update: vi.fn(),
          isBrowseCutoverActive: () => true,
          isTargetLodReady: () => true,
        },
        frameWorkCoordinator: {
          hasQueuedWorkAtPriority: () => false,
        },
        previewCache: {
          cancelSelectionPrefetchesExcept: vi.fn(),
          getFullRoomSnapshot: () => cachedRoom,
          prefetchPublishedRoom,
        },
        roomSummariesById: new Map([[room.id, summary]]),
        selectedExactPrefetchLifecycle: new SelectedExactPrefetchLifecycle(room.id),
      },
    );

    callUpdateWorldTiles(harness);
    callUpdateWorldTiles(harness);
    expect(prefetchPublishedRoom).toHaveBeenCalledOnce();
    expect(onSelectedExactRoomSnapshotReady).not.toHaveBeenCalled();

    cachedRoom = room;
    loaded.resolve(room);
    await loaded.promise;
    await Promise.resolve();

    expect(onSelectedExactRoomSnapshotReady).toHaveBeenCalledOnce();
    expect(onSelectedExactRoomSnapshotReady).toHaveBeenCalledWith(room);

    callUpdateWorldTiles(harness);
    expect(prefetchPublishedRoom).toHaveBeenCalledOnce();
  });
});

function callUpdateWorldTiles(harness: Record<string, unknown>): void {
  OverworldWorldStreamingController.prototype.updateWorldTiles.call(harness as never);
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

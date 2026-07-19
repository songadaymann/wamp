import { describe, expect, it, vi } from 'vitest';
import { createDefaultRoomSnapshot, type RoomSnapshot } from '../../persistence/roomModel';
import type { WorldRepository } from '../../persistence/worldRepository';
import type { WorldRoomSummary } from '../../persistence/worldModel';
import { OverworldPreviewCache } from './previewCache';

describe('overworld exact-room preview cache lifecycle', () => {
  it('cancels an obsolete selection request and ignores a transport that resolves after abort', async () => {
    const loads: DeferredRoomLoad[] = [];
    const cache = new OverworldPreviewCache(repositoryWithDeferredLoads(loads));
    const request = cache.prefetchPublishedRoom(summary('1,1', 1, 1));

    cache.cancelSelectionPrefetchesExcept('2,2');
    expect(loads[0].signal.aborted).toBe(true);
    loads[0].resolve(snapshot('1,1', 1, 1));

    await expect(request).resolves.toBeNull();
    expect(cache.getFullRoomSnapshot('1,1')).toBeNull();
  });

  it('keeps a replacement same-room request registered after the pre-reset request completes', async () => {
    const loads: DeferredRoomLoad[] = [];
    const repository = repositoryWithDeferredLoads(loads);
    const cache = new OverworldPreviewCache(repository);
    const roomSummary = summary('3,4', 3, 4);
    const obsolete = cache.prefetchPublishedRoom(roomSummary);

    cache.reset();
    const replacement = cache.prefetchPublishedRoom(roomSummary);
    loads[0].resolve(snapshot('3,4', 3, 4));
    await expect(obsolete).resolves.toBeNull();

    const deduplicatedReplacement = cache.prefetchPublishedRoom(roomSummary);
    expect(repository.loadPublishedRoom).toHaveBeenCalledTimes(2);
    loads[1].resolve(snapshot('3,4', 3, 4));
    await Promise.all([replacement, deduplicatedReplacement]);
    expect(cache.getFullRoomSnapshot('3,4')?.id).toBe('3,4');
  });
});

interface DeferredRoomLoad {
  signal: AbortSignal;
  resolve: (room: RoomSnapshot | null) => void;
}

function repositoryWithDeferredLoads(loads: DeferredRoomLoad[]): WorldRepository {
  return {
    loadPublishedRoom: vi.fn((_roomId, _coordinates, signal = new AbortController().signal) => (
      new Promise<RoomSnapshot | null>((resolve) => loads.push({ signal, resolve }))
    )),
  } as unknown as WorldRepository;
}

function summary(id: string, x: number, y: number): WorldRoomSummary {
  return {
    id,
    coordinates: { x, y },
    title: null,
    state: 'published',
    background: null,
    goalType: null,
    version: 1,
    publishedAt: null,
    previewUpdatedAt: null,
    creatorUserId: null,
    creatorDisplayName: null,
    publishedByUserId: null,
    publishedByDisplayName: null,
    course: null,
    expandedRoom: null,
  };
}

function snapshot(id: string, x: number, y: number): RoomSnapshot {
  return createDefaultRoomSnapshot(id, { x, y });
}

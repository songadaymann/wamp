import { describe, expect, it, vi } from 'vitest';
import { createDefaultRoomSnapshot, type RoomSnapshot } from '../../persistence/roomModel';
import type { WorldRepository } from '../../persistence/worldRepository';
import type { WorldRoomSummary } from '../../persistence/worldModel';
import { OverworldPreviewCache, type StreamingRoomCandidate } from './previewCache';

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

  it('shares an exact in-flight snapshot batch across canonical reference orderings', async () => {
    let resolveBatch!: (response: {
      snapshots: Array<{ key: string; reference: { kind: 'current_preview'; roomId: string }; snapshot: RoomSnapshot }>;
      missing: [];
    }) => void;
    const queryRoomSnapshots = vi.fn(() => new Promise<{
      snapshots: Array<{ key: string; reference: { kind: 'current_preview'; roomId: string }; snapshot: RoomSnapshot }>;
      missing: [];
    }>((resolve) => { resolveBatch = resolve; }));
    const cache = new OverworldPreviewCache({ queryRoomSnapshots } as unknown as WorldRepository);
    const candidates = new Map<string, StreamingRoomCandidate>([
      ['dedupe-a', candidate('dedupe-a', 10, 11)],
      ['dedupe-b', candidate('dedupe-b', 12, 13)],
    ]);

    const first = cache.ensureRoomSnapshotsBatch(candidates, ['dedupe-a', 'dedupe-b'], {
      detail: 'full',
      priority: 'high',
    });
    const second = cache.ensureRoomSnapshotsBatch(candidates, ['dedupe-b', 'dedupe-a'], {
      detail: 'full',
      priority: 'low',
    });

    expect(queryRoomSnapshots).toHaveBeenCalledOnce();
    resolveBatch({
      snapshots: [
        {
          key: 'current:dedupe-a',
          reference: { kind: 'current_preview', roomId: 'dedupe-a' },
          snapshot: snapshot('dedupe-a', 10, 11),
        },
        {
          key: 'current:dedupe-b',
          reference: { kind: 'current_preview', roomId: 'dedupe-b' },
          snapshot: snapshot('dedupe-b', 12, 13),
        },
      ],
      missing: [],
    });
    await Promise.all([first, second]);

    expect(cache.getFullRoomSnapshot('dedupe-a')?.id).toBe('dedupe-a');
    expect(cache.getFullRoomSnapshot('dedupe-b')?.id).toBe('dedupe-b');
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

function candidate(id: string, x: number, y: number): StreamingRoomCandidate {
  return {
    id,
    coordinates: { x, y },
    summary: {
      ...summary(id, x, y),
      state: 'claimed_unpublished',
    },
    draft: null,
    sharedPreview: null,
    allowFullRoomLoad: true,
    source: 'saved_construction_draft',
  };
}

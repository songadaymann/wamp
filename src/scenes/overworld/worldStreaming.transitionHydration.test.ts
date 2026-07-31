import { describe, expect, it, vi } from 'vitest';
import { createDefaultRoomSnapshot, type RoomSnapshot } from '../../persistence/roomModel';
import type { WorldRoomSummary } from '../../persistence/worldModel';
import { OverworldWorldStreamingController } from './worldStreaming';

vi.mock('phaser', () => ({ default: {} }));

interface TransitionPrefetchHarness {
  options: { scene: { time: { now: number } } };
  roomSummariesById: Map<string, WorldRoomSummary>;
  playableRoomSnapshotRequestsById: Map<string, Promise<void>>;
  playableRoomSnapshotRetryAtById: Map<string, number>;
  previewCache: { ensureRoomSnapshotsBatch: ReturnType<typeof vi.fn> };
  isPlayableRoomCollisionReady: () => boolean;
  resolveTransitionRenderableRoom: () => null;
}

describe('world streaming transition hydration', () => {
  it('does not expose an overview-only snapshot as playable room data', () => {
    const coordinates = { x: 1, y: -1 };
    const overview = createDefaultRoomSnapshot('1,-1', coordinates);
    const summary = {
      id: overview.id,
      coordinates,
      state: 'published',
      version: overview.version,
      previewUpdatedAt: null,
    } as WorldRoomSummary;
    let exactRoom: RoomSnapshot | null = null;
    const getRoomSnapshot = vi.fn(() => overview);
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype) as Record<string, unknown>,
      {
        transientRoomOverridesById: new Map(),
        draftRoomsById: new Map(),
        optimisticPublishedRoomsById: new Map(),
        presencePreviewRoomsById: new Map(),
        loadedFullRoomsById: new Map(),
        roomSummariesById: new Map([[overview.id, summary]]),
        previewCache: {
          getFullRoomSnapshot: () => exactRoom,
          getRoomSnapshot,
        },
      },
    );

    expect(callGetPlayableSnapshot(harness, coordinates)).toBeNull();
    expect(getRoomSnapshot).not.toHaveBeenCalled();

    exactRoom = createDefaultRoomSnapshot('1,-1', coordinates);
    expect(callGetPlayableSnapshot(harness, coordinates)?.id).toBe('1,-1');
  });

  it('deduplicates exact prefetches and backs off after a failed request', async () => {
    const harness = createPrefetchHarness();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      callPrefetch(harness);
      callPrefetch(harness);
      expect(harness.previewCache.ensureRoomSnapshotsBatch).toHaveBeenCalledOnce();
      await Array.from(harness.playableRoomSnapshotRequestsById.values())[0];

      callPrefetch(harness);
      expect(harness.previewCache.ensureRoomSnapshotsBatch).toHaveBeenCalledOnce();

      harness.options.scene.time.now = 1_001;
      callPrefetch(harness);
      expect(harness.previewCache.ensureRoomSnapshotsBatch).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });

  it('ignores a failed request from a reset streaming lifecycle', async () => {
    let rejectRequest!: (error: Error) => void;
    const harness = createPrefetchHarness(
      () => new Promise<void>((_resolve, reject) => { rejectRequest = reject; }),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      callPrefetch(harness);
      const obsoleteRequest = Array.from(harness.playableRoomSnapshotRequestsById.values())[0];
      harness.playableRoomSnapshotRequestsById = new Map();
      harness.playableRoomSnapshotRetryAtById = new Map();
      rejectRequest(new Error('obsolete request'));
      await obsoleteRequest;

      expect(harness.playableRoomSnapshotRetryAtById.size).toBe(0);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

function createPrefetchHarness(
  request: () => Promise<void> = () => Promise.reject(new Error('network unavailable')),
): TransitionPrefetchHarness {
  const coordinates = { x: 1, y: 0 };
  const summary = {
    id: '1,0',
    coordinates,
    state: 'published',
    version: 1,
    previewUpdatedAt: null,
  } as WorldRoomSummary;
  return Object.assign(
    Object.create(OverworldWorldStreamingController.prototype),
    {
      options: { scene: { time: { now: 0 } } },
      roomSummariesById: new Map([[summary.id, summary]]),
      playableRoomSnapshotRequestsById: new Map<string, Promise<void>>(),
      playableRoomSnapshotRetryAtById: new Map<string, number>(),
      previewCache: { ensureRoomSnapshotsBatch: vi.fn(request) },
      isPlayableRoomCollisionReady: () => false,
      resolveTransitionRenderableRoom: () => null,
    },
  ) as TransitionPrefetchHarness;
}

function callGetPlayableSnapshot(
  harness: Record<string, unknown>,
  coordinates: { x: number; y: number },
): RoomSnapshot | null {
  return OverworldWorldStreamingController.prototype.getPlayableRoomSnapshotForCoordinates.call(
    harness as never,
    coordinates,
  );
}

function callPrefetch(harness: TransitionPrefetchHarness): void {
  OverworldWorldStreamingController.prototype.prefetchPlayableRoomForTransition.call(
    harness as never,
    { x: 1, y: 0 },
  );
}

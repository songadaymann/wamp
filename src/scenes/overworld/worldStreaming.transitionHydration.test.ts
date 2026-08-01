import { describe, expect, it, vi } from 'vitest';
import {
  createDefaultRoomSnapshot,
  type RoomSnapshot,
  type RoomSnapshotView,
} from '../../persistence/roomModel';
import type { WorldRoomSummary } from '../../persistence/worldModel';
import { OverworldWorldStreamingController } from './worldStreaming';
import { RoomSnapshotReferenceChangedError } from './previewCache';

vi.mock('phaser', () => ({ default: {} }));

interface TransitionPrefetchHarness {
  options: {
    scene: { time: { now: number } };
    getCurrentRoomCoordinates: () => { x: number; y: number };
    refreshRoomSummariesForTransition?: ReturnType<typeof vi.fn>;
  };
  roomSummariesById: Map<string, WorldRoomSummary>;
  playableRoomSnapshotRequestsById: Map<string, Promise<void>>;
  playableRoomSnapshotRequestIntentGenerationById: Map<string, number>;
  playableRoomSnapshotPreparationRequestsById: Map<string, unknown>;
  playableRoomSnapshotRetryAtById: Map<string, number>;
  playableRoomSummaryRecoveriesById: Map<string, unknown>;
  previewCache: { ensureRoomSnapshotsBatch: ReturnType<typeof vi.fn> };
  isPlayableRoomCollisionReady: () => boolean;
  resolveTransitionRenderableRoom: ReturnType<typeof vi.fn>;
  adoptPredictedPreparation: () => boolean;
  predictedPreparationRoomId: string | null;
  predictedPreparationIntentGeneration: number;
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
    expect(callGetPlayableSnapshot(harness, coordinates)).toBe(exactRoom);
    expect(callGetPlayableSnapshot(harness, coordinates)).toBe(exactRoom);
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

  it('refreshes a stale summary once and does not reissue its doomed snapshot reference', async () => {
    let resolveSummaryRefresh!: (refreshed: boolean) => void;
    const staleReference = {
      kind: 'current_preview' as const,
      roomId: '1,0',
      coordinates: { x: 1, y: 0 },
      state: 'published' as const,
    };
    const harness = createPrefetchHarness(() => Promise.reject(
      new RoomSnapshotReferenceChangedError([staleReference]),
    ));
    const refreshRoomSummariesForTransition = vi.fn(() => new Promise<boolean>((resolve) => {
      resolveSummaryRefresh = resolve;
    }));
    harness.options.refreshRoomSummariesForTransition = refreshRoomSummariesForTransition;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      callPrefetch(harness);
      const failedRequest = harness.playableRoomSnapshotRequestsById.get('1,0');
      expect(failedRequest).toBeDefined();
      await failedRequest;

      expect(refreshRoomSummariesForTransition).toHaveBeenCalledOnce();
      expect(refreshRoomSummariesForTransition).toHaveBeenCalledWith({ x: 0, y: 0 });
      expect(harness.previewCache.ensureRoomSnapshotsBatch).toHaveBeenCalledOnce();

      callPrefetch(harness);
      expect(harness.previewCache.ensureRoomSnapshotsBatch).toHaveBeenCalledOnce();
      expect(refreshRoomSummariesForTransition).toHaveBeenCalledOnce();

      const previousSummary = harness.roomSummariesById.get('1,0');
      expect(previousSummary).toBeDefined();
      harness.roomSummariesById.set('1,0', {
        ...previousSummary!,
        version: 2,
        previewUpdatedAt: '2026-08-01T00:00:00.000Z',
      });
      resolveSummaryRefresh(true);
      await vi.waitFor(() => {
        expect(harness.playableRoomSummaryRecoveriesById.size).toBe(0);
      });

      harness.previewCache.ensureRoomSnapshotsBatch.mockResolvedValueOnce(undefined);
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

  it.each(['cleared', 'superseded'] as const)(
    'does not resurrect %s predicted intent when an exact snapshot resolves later',
    async (intentChange) => {
      let resolveRequest!: () => void;
      const coordinates = { x: 1, y: 0 };
      const room = createDefaultRoomSnapshot('1,0', coordinates);
      const harness = createPrefetchHarness(
        () => new Promise<void>((resolve) => { resolveRequest = resolve; }),
      );
      const renderableRoom = {
        id: room.id,
        coordinates,
        room,
        source: 'published' as const,
      };
      harness.resolveTransitionRenderableRoom = vi.fn()
        .mockReturnValueOnce(null)
        .mockReturnValue(renderableRoom);
      const beginFullRoomPreparation = vi.fn();
      Object.assign(harness, { beginFullRoomPreparation });

      callPrefetch(harness);
      const request = harness.playableRoomSnapshotRequestsById.get(room.id);
      expect(request).toBeDefined();
      if (intentChange === 'cleared') {
        harness.predictedPreparationRoomId = null;
      }
      harness.predictedPreparationIntentGeneration += 1;
      resolveRequest();
      await request;

      expect(beginFullRoomPreparation).not.toHaveBeenCalled();
    },
  );

  it('keeps a portal-owned preparation when movement prediction clears in the same frame', () => {
    const coordinates = { x: 2, y: 0 };
    const cancelFullRoomPreparation = vi.fn();
    const queueUnretainedPredictedRoomTeardown = vi.fn();
    const requestPlayableRoomSnapshotForTransition = vi.fn();
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        options: {
          scene: { time: { now: 0 } },
          getCurrentRoomCoordinates: () => ({ x: 0, y: 0 }),
        },
        portalPreparationRoomId: null,
        predictedPreparationRoomId: '2,0',
        predictedPreparationCoordinates: coordinates,
        predictedPreparationExpiresAt: 1_000,
        predictedPreparationIntentGeneration: 4,
        playableRoomSnapshotPreparationRequestsById: new Map(),
        playableRoomSnapshotRequestIntentGenerationById: new Map(),
        pendingFullRoomPreparationsById: new Map(),
        isPlayableRoomCollisionReady: () => false,
        resolveTransitionRenderableRoom: () => null,
        requestPlayableRoomSnapshotForTransition,
        getTransitionPreparationPriority: () => 'portal-current-destination',
        cancelPredictedPreparationExpiryTimer: vi.fn(),
        cancelFullRoomPreparation,
        queueUnretainedPredictedRoomTeardown,
        syncRoomArtifactCachePolicy: vi.fn(),
      },
    );

    OverworldWorldStreamingController.prototype.preparePortalTargetRoomForTransition.call(
      harness as never,
      coordinates,
    );
    OverworldWorldStreamingController.prototype.clearPredictedPlayableRoomForTransition.call(
      harness as never,
    );

    expect(requestPlayableRoomSnapshotForTransition).toHaveBeenCalledWith(coordinates, {
      priority: 'portal-current-destination',
      activationRequested: true,
      standardActivationRequested: false,
      portalActivationRequested: true,
      independentOfPredictedIntent: true,
    });
    expect(harness.portalPreparationRoomId).toBe('2,0');
    expect(cancelFullRoomPreparation).not.toHaveBeenCalled();
    expect(queueUnretainedPredictedRoomTeardown).not.toHaveBeenCalled();
  });

  it('retains a portal target outside the ordinary streamed room set', () => {
    const harness = {
      retainedFullRoomIds: new Set<string>(),
      predictedPreparationRoomId: null,
      portalPreparationRoomId: '5,7',
      pendingFullRoomPreparationsById: new Map(),
      options: { getCurrentRoomCoordinates: () => ({ x: 0, y: 0 }) },
    };

    const shouldRetainFullRoom = (
      OverworldWorldStreamingController.prototype as unknown as {
        shouldRetainFullRoom: (roomId: string) => boolean;
      }
    ).shouldRetainFullRoom;

    expect(shouldRetainFullRoom.call(harness, '5,7')).toBe(true);
    expect(shouldRetainFullRoom.call(harness, '6,7')).toBe(false);
  });

  it('fetches and activates a portal target outside the current world-window summaries', async () => {
    const coordinates = { x: 40, y: -12 };
    const room = createDefaultRoomSnapshot('40,-12', coordinates);
    let exactRoom: RoomSnapshot | null = null;
    const preparation = { room };
    const ensureCurrentPublishedRoomSnapshot = vi.fn(async () => {
      exactRoom = room;
      return room;
    });
    const beginFullRoomPreparation = vi.fn(() => preparation);
    const requestFullRoomPreparationActivation = vi.fn();
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        options: {
          scene: { time: { now: 0 } },
          getCurrentRoomCoordinates: () => ({ x: 0, y: 0 }),
        },
        transientRoomOverridesById: new Map(),
        draftRoomsById: new Map(),
        optimisticPublishedRoomsById: new Map(),
        presencePreviewRoomsById: new Map(),
        loadedFullRoomsById: new Map(),
        roomSummariesById: new Map(),
        playableRoomSnapshotRequestsById: new Map(),
        playableRoomSnapshotRequestIntentGenerationById: new Map(),
        playableRoomSnapshotPreparationRequestsById: new Map(),
        playableRoomSnapshotRetryAtById: new Map(),
        playableRoomSummaryRecoveriesById: new Map(),
        predictedPreparationIntentGeneration: 0,
        portalPreparationRoomId: null,
        previewCache: {
          getFullRoomSnapshot: () => exactRoom,
          ensureCurrentPublishedRoomSnapshot,
        },
        isPlayableRoomCollisionReady: vi.fn(() => false),
        beginFullRoomPreparation,
        requestFullRoomPreparationActivation,
      },
    );

    expect(callPreparePortal(harness, coordinates)).toBe(false);
    const request = harness.playableRoomSnapshotRequestsById.get(room.id) as Promise<void>;
    await request;

    expect(ensureCurrentPublishedRoomSnapshot).toHaveBeenCalledWith(
      room.id,
      coordinates,
      { detail: 'full', priority: 'high' },
    );
    expect(beginFullRoomPreparation).toHaveBeenCalledWith(
      expect.objectContaining({ room, source: 'published' }),
      'portal-current-destination',
      false,
      false,
    );
    expect(requestFullRoomPreparationActivation).toHaveBeenCalledWith(preparation, true);
  });

  it('preserves a shared exact request when portal ownership clears but movement still predicts it', () => {
    const roomId = '1,0';
    const request = Promise.resolve();
    const pendingRequest = {
      priority: 'portal-current-destination',
      activationRequested: true,
      standardActivationRequested: false,
      portalActivationRequested: true,
      independentOfPredictedIntent: true,
    };
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        options: { getCurrentRoomCoordinates: () => ({ x: 0, y: 0 }) },
        portalPreparationRoomId: roomId,
        predictedPreparationRoomId: roomId,
        predictedPreparationIntentGeneration: 7,
        playableRoomSnapshotRequestsById: new Map([[roomId, request]]),
        playableRoomSnapshotRequestIntentGenerationById: new Map([[roomId, 6]]),
        playableRoomSnapshotPreparationRequestsById: new Map([[roomId, pendingRequest]]),
        playableRoomSnapshotRetryAtById: new Map([[roomId, 1_000]]),
        pendingFullRoomPreparationsById: new Map(),
        cancelFullRoomPreparation: vi.fn(),
        queueUnretainedPredictedRoomTeardown: vi.fn(),
        syncRoomArtifactCachePolicy: vi.fn(),
      },
    );

    callClearPortal(harness, roomId);

    expect(harness.portalPreparationRoomId).toBeNull();
    expect(harness.playableRoomSnapshotRequestsById.get(roomId)).toBe(request);
    expect(harness.playableRoomSnapshotPreparationRequestsById.get(roomId)).toBe(pendingRequest);
    expect(pendingRequest.independentOfPredictedIntent).toBe(false);
    expect(pendingRequest.activationRequested).toBe(false);
    expect(harness.playableRoomSnapshotRequestIntentGenerationById.get(roomId)).toBe(7);
    expect(harness.cancelFullRoomPreparation).not.toHaveBeenCalled();
    expect(harness.queueUnretainedPredictedRoomTeardown).not.toHaveBeenCalled();
  });

  it('merges portal-first and same-frame movement ownership into one exact request', async () => {
    let resolveRequest!: () => void;
    const coordinates = { x: 1, y: 0 };
    const room = createDefaultRoomSnapshot('1,0', coordinates);
    const renderableRoom = {
      id: room.id,
      coordinates,
      room,
      source: 'published' as const,
    };
    const harness = createPrefetchHarness(
      () => new Promise<void>((resolve) => { resolveRequest = resolve; }),
    );
    harness.predictedPreparationRoomId = null;
    harness.predictedPreparationIntentGeneration = 1;
    harness.resolveTransitionRenderableRoom = vi.fn()
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null)
      .mockReturnValue(renderableRoom);
    harness.adoptPredictedPreparation = () => {
      harness.predictedPreparationRoomId = room.id;
      harness.predictedPreparationIntentGeneration += 1;
      return true;
    };
    const beginFullRoomPreparation = vi.fn(() => ({ room }));
    const requestFullRoomPreparationActivation = vi.fn();
    Object.assign(harness, {
      beginFullRoomPreparation,
      requestFullRoomPreparationActivation,
      pendingFullRoomPreparationsById: new Map(),
      queueUnretainedPredictedRoomTeardown: vi.fn(),
      syncRoomArtifactCachePolicy: vi.fn(),
    });

    callPreparePortal(harness, coordinates);
    callPrefetch(harness);
    expect(harness.previewCache.ensureRoomSnapshotsBatch).toHaveBeenCalledOnce();

    callClearPortal(harness, room.id);
    resolveRequest();
    const request = harness.playableRoomSnapshotRequestsById.get(room.id);
    await request;

    expect(beginFullRoomPreparation).toHaveBeenCalledWith(
      renderableRoom,
      'portal-current-destination',
      true,
      false,
    );
    expect(requestFullRoomPreparationActivation).not.toHaveBeenCalled();
  });

  it.each([
    ['far prediction', false, false],
    ['near-seam activation', true, true],
  ] as const)(
    'removes only the portal activation owner from a shared %s',
    (_label, standardActivationRequested, expectedActivation) => {
      const roomId = '1,0';
      const preparation = {
        activationRequested: true,
        standardActivationRequested,
        portalActivationRequested: true,
        phase: 'ready',
        queuedJob: null,
      };
      const harness = Object.assign(
        Object.create(OverworldWorldStreamingController.prototype),
        {
          options: { getCurrentRoomCoordinates: () => ({ x: 0, y: 0 }) },
          portalPreparationRoomId: roomId,
          predictedPreparationRoomId: roomId,
          predictedPreparationIntentGeneration: 4,
          playableRoomSnapshotRequestsById: new Map(),
          playableRoomSnapshotRequestIntentGenerationById: new Map(),
          playableRoomSnapshotPreparationRequestsById: new Map(),
          playableRoomSnapshotRetryAtById: new Map(),
          pendingFullRoomPreparationsById: new Map([[roomId, preparation]]),
          cancelFullRoomPreparation: vi.fn(),
          queueUnretainedPredictedRoomTeardown: vi.fn(),
          syncRoomArtifactCachePolicy: vi.fn(),
        },
      );

      callClearPortal(harness, roomId);

      expect(preparation.portalActivationRequested).toBe(false);
      expect(preparation.activationRequested).toBe(expectedActivation);
      expect(preparation.phase).toBe('ready');
    },
  );

  it('preserves a non-predicted standard preparation when portal ownership clears', () => {
    const roomId = '1,0';
    const preparation = {
      activationRequested: true,
      standardActivationRequested: true,
      portalActivationRequested: true,
      phase: 'ready',
      queuedJob: null,
    };
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        options: { getCurrentRoomCoordinates: () => ({ x: 0, y: 0 }) },
        portalPreparationRoomId: roomId,
        predictedPreparationRoomId: null,
        predictedPreparationIntentGeneration: 4,
        playableRoomSnapshotRequestsById: new Map(),
        playableRoomSnapshotRequestIntentGenerationById: new Map(),
        playableRoomSnapshotPreparationRequestsById: new Map(),
        playableRoomSnapshotRetryAtById: new Map(),
        pendingFullRoomPreparationsById: new Map([[roomId, preparation]]),
        cancelFullRoomPreparation: vi.fn(),
        queueUnretainedPredictedRoomTeardown: vi.fn(),
        syncRoomArtifactCachePolicy: vi.fn(),
      },
    );

    callClearPortal(harness, roomId);

    expect(preparation.portalActivationRequested).toBe(false);
    expect(preparation.standardActivationRequested).toBe(true);
    expect(preparation.activationRequested).toBe(true);
    expect(preparation.phase).toBe('ready');
    expect(harness.cancelFullRoomPreparation).not.toHaveBeenCalled();
    expect(harness.queueUnretainedPredictedRoomTeardown).not.toHaveBeenCalled();
  });

  it('inherits both owners across an exact portal replacement, then preserves movement ownership', () => {
    const coordinates = { x: 1, y: 0 };
    const firstRoom = createDefaultRoomSnapshot('1,0', coordinates);
    const replacementRoom = createDefaultRoomSnapshot('1,0', coordinates);
    replacementRoom.version = firstRoom.version + 1;
    replacementRoom.updatedAt = `${firstRoom.updatedAt}:replacement`;
    const existingPreparation = {
      identity: 'published:1:old',
      standardActivationRequested: true,
      portalActivationRequested: true,
      activationRequested: true,
      priority: 'portal-current-destination',
      queuedJob: null,
    };
    const pendingFullRoomPreparationsById = new Map<string, unknown>([[
      firstRoom.id,
      existingPreparation,
    ]]);
    const cancelFullRoomPreparation = vi.fn((roomId: string) => {
      pendingFullRoomPreparationsById.delete(roomId);
    });
    const queuePreparedCustomTiles = vi.fn();
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        destroyed: false,
        options: {
          getMode: () => 'play',
          getCurrentRoomCoordinates: () => ({ x: 0, y: 0 }),
          scene: { textures: { exists: vi.fn(() => true) } },
        },
        loadedFullRoomsById: new Map(),
        pendingFullRoomPreparationsById,
        portalPreparationRoomId: firstRoom.id,
        predictedPreparationRoomId: firstRoom.id,
        predictedPreparationCoordinates: coordinates,
        predictedPreparationExpiresAt: 1_000,
        predictedPreparationIntentGeneration: 8,
        playableRoomSnapshotRequestsById: new Map(),
        playableRoomSnapshotRequestIntentGenerationById: new Map(),
        playableRoomSnapshotPreparationRequestsById: new Map(),
        playableRoomSnapshotRetryAtById: new Map(),
        frameWorkCoordinator: {
          beginGeneration: vi.fn(() => ({ scope: `full-room:${firstRoom.id}`, id: 9 })),
        },
        buildFullRoomPreparationIdentity: vi.fn((room: RoomSnapshot) => (
          `published:${room.version}:${room.updatedAt}`
        )),
        buildFullRoomArtifactKey: vi.fn(() => 'replacement-artifact'),
        buildScopedRoomTextureKey: vi
          .fn()
          .mockReturnValueOnce('replacement-terrain')
          .mockReturnValueOnce('replacement-foreground'),
        cancelFullRoomPreparation,
        adoptPredictedPreparation: vi.fn(() => true),
        syncRoomArtifactCachePolicy: vi.fn(),
        queuePreparedCustomTiles,
        queueUnretainedPredictedRoomTeardown: vi.fn(),
      },
    );
    const renderableRoom = {
      id: replacementRoom.id,
      coordinates,
      room: replacementRoom,
      source: 'published' as const,
    };

    const preparation = callBeginFullRoomPreparation(
      harness,
      renderableRoom,
      'portal-current-destination',
      false,
      false,
    ) as typeof existingPreparation | null;

    expect(cancelFullRoomPreparation).toHaveBeenCalledWith(
      replacementRoom.id,
      'room-snapshot-replaced',
      true,
    );
    expect(preparation).not.toBeNull();
    expect(preparation).toMatchObject({
      standardActivationRequested: true,
      portalActivationRequested: true,
      activationRequested: true,
    });
    expect(queuePreparedCustomTiles).toHaveBeenCalledWith(preparation);

    callClearPortal(harness, replacementRoom.id);

    expect(preparation).toMatchObject({
      standardActivationRequested: true,
      portalActivationRequested: false,
      activationRequested: true,
    });
    expect(cancelFullRoomPreparation).toHaveBeenCalledTimes(1);
  });

  it('removes movement ownership before a shared portal preparation is cleared', () => {
    const roomId = '1,0';
    const pendingRequest = {
      priority: 'portal-current-destination',
      activationRequested: true,
      standardActivationRequested: true,
      portalActivationRequested: true,
      independentOfPredictedIntent: true,
    };
    const preparation = {
      activationRequested: true,
      standardActivationRequested: true,
      portalActivationRequested: true,
      phase: 'ready',
      queuedJob: null,
    };
    const cancelFullRoomPreparation = vi.fn();
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        options: { getCurrentRoomCoordinates: () => ({ x: 0, y: 0 }) },
        portalPreparationRoomId: roomId,
        predictedPreparationRoomId: roomId,
        predictedPreparationCoordinates: { x: 1, y: 0 },
        predictedPreparationExpiresAt: 1_000,
        predictedPreparationIntentGeneration: 4,
        playableRoomSnapshotRequestsById: new Map([[roomId, Promise.resolve()]]),
        playableRoomSnapshotRequestIntentGenerationById: new Map([[roomId, 4]]),
        playableRoomSnapshotPreparationRequestsById: new Map([[roomId, pendingRequest]]),
        playableRoomSnapshotRetryAtById: new Map(),
        pendingFullRoomPreparationsById: new Map([[roomId, preparation]]),
        cancelPredictedPreparationExpiryTimer: vi.fn(),
        cancelFullRoomPreparation,
        queueUnretainedPredictedRoomTeardown: vi.fn(),
        syncRoomArtifactCachePolicy: vi.fn(),
      },
    );

    OverworldWorldStreamingController.prototype.clearPredictedPlayableRoomForTransition.call(
      harness as OverworldWorldStreamingController,
      'movement-left-seam',
    );

    expect(pendingRequest.standardActivationRequested).toBe(false);
    expect(pendingRequest.portalActivationRequested).toBe(true);
    expect(preparation.standardActivationRequested).toBe(false);
    expect(preparation.portalActivationRequested).toBe(true);
    expect(preparation.activationRequested).toBe(true);
    expect(cancelFullRoomPreparation).not.toHaveBeenCalled();

    callClearPortal(harness, roomId);

    expect(cancelFullRoomPreparation).toHaveBeenCalledWith(
      roomId,
      'portal-target-no-longer-requested',
    );
    expect(harness.queueUnretainedPredictedRoomTeardown).toHaveBeenCalledWith(roomId);
  });

  it('lets a portal target supersede and suppress a different movement prediction', () => {
    const portalCoordinates = { x: 9, y: 9 };
    const movementCoordinates = { x: 1, y: 0 };
    const clearPredictedPlayableRoomForTransition = vi.fn();
    const preparePlayableRoomForTransition = vi.fn(() => false);
    const requestPlayableRoomSnapshotForTransition = vi.fn();
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        portalPreparationRoomId: null,
        predictedPreparationRoomId: '1,0',
        clearPredictedPlayableRoomForTransition,
        preparePlayableRoomForTransition,
        requestPlayableRoomSnapshotForTransition,
        getTransitionPreparationPriority: vi.fn(() => 'predicted-destination-collision'),
      },
    );

    callPreparePortal(harness, portalCoordinates);

    expect(clearPredictedPlayableRoomForTransition).toHaveBeenCalledWith(
      'portal-target-superseded-prediction',
    );
    expect(harness.portalPreparationRoomId).toBe('9,9');
    OverworldWorldStreamingController.prototype.prefetchPlayableRoomForTransition.call(
      harness as OverworldWorldStreamingController,
      movementCoordinates,
    );
    expect(requestPlayableRoomSnapshotForTransition).not.toHaveBeenCalled();
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
      options: {
        scene: { time: { now: 0 } },
        getCurrentRoomCoordinates: () => ({ x: 0, y: 0 }),
      },
      roomSummariesById: new Map([[summary.id, summary]]),
      playableRoomSnapshotRequestsById: new Map<string, Promise<void>>(),
      playableRoomSnapshotRequestIntentGenerationById: new Map<string, number>(),
      playableRoomSnapshotPreparationRequestsById: new Map<string, unknown>(),
      playableRoomSnapshotRetryAtById: new Map<string, number>(),
      playableRoomSummaryRecoveriesById: new Map<string, unknown>(),
      previewCache: { ensureRoomSnapshotsBatch: vi.fn(request) },
      isPlayableRoomCollisionReady: () => false,
      resolveTransitionRenderableRoom: vi.fn(() => null),
      adoptPredictedPreparation: () => true,
      predictedPreparationRoomId: summary.id,
      predictedPreparationIntentGeneration: 1,
    },
  ) as TransitionPrefetchHarness;
}

function callGetPlayableSnapshot(
  harness: Record<string, unknown>,
  coordinates: { x: number; y: number },
): RoomSnapshotView | null {
  return OverworldWorldStreamingController.prototype.getPlayableRoomSnapshotViewForCoordinates.call(
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

function callPreparePortal(
  harness: object,
  coordinates: { x: number; y: number },
): boolean {
  return OverworldWorldStreamingController.prototype.preparePortalTargetRoomForTransition.call(
    harness as OverworldWorldStreamingController,
    coordinates,
  );
}

function callClearPortal(harness: object, roomId: string): void {
  OverworldWorldStreamingController.prototype.clearPortalTargetRoomPreparation.call(
    harness as OverworldWorldStreamingController,
    roomId,
  );
}

function callBeginFullRoomPreparation(
  harness: object,
  renderableRoom: object,
  priority: 'portal-current-destination',
  predicted: boolean,
  activateWhenReady: boolean,
): unknown {
  return (
    OverworldWorldStreamingController.prototype as unknown as {
      beginFullRoomPreparation(
        room: object,
        workPriority: 'portal-current-destination',
        isPredicted: boolean,
        activate: boolean,
      ): unknown;
    }
  ).beginFullRoomPreparation.call(
    harness,
    renderableRoom,
    priority,
    predicted,
    activateWhenReady,
  );
}

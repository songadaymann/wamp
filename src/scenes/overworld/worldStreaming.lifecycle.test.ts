import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));

import { createDefaultRoomSnapshot } from '../../persistence/roomModel';
import type { RoomSnapshot } from '../../persistence/roomModel';
import { FrameWorkCoordinator } from './frameWorkCoordinator';
import { OverworldWorldStreamingController } from './worldStreaming';

describe('world streaming loaded-room lifecycle', () => {
  it('reserves the reduced CPU slot ahead of lower-priority world-tile work', () => {
    const clock = { value: 0 };
    const execute = vi.fn(() => {
      clock.value += 1;
    });
    const frameWorkCoordinator = new FrameWorkCoordinator({ now: () => clock.value });
    frameWorkCoordinator.enqueue({
      label: 'prepare-room-runtime-shell:-2,0',
      priority: 'portal-current-destination',
      costKind: 'cpu',
      estimatedCostMs: 1,
      execute,
    });
    const worldTileController = { update: vi.fn() };
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        frameWorkCoordinator,
        worldTileController,
      },
    );

    const worldTileWorkRan = harness.updateWorldTiles();
    const frame = frameWorkCoordinator.runFrame({
      profile: 'reduced',
      criticalHeadroomMs: 2,
      sharedBudgetConsumedMs: worldTileWorkRan ? 0.3 : 0,
      cpuBudgetConsumedMs: worldTileWorkRan ? 0.3 : 0,
    });

    expect(worldTileWorkRan).toBe(false);
    expect(worldTileController.update).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledOnce();
    expect(frame.executed.map((job) => job.label)).toEqual([
      'prepare-room-runtime-shell:-2,0',
    ]);
    expect(frame.cpuOvershootMs).toBe(0);
  });

  it('marks exact-snapshot competition only when world-tile work actually executes', () => {
    const onPerformanceAdvisorExactSnapshotEvent = vi.fn();
    const update = vi.fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        frameWorkCoordinator: {
          hasQueuedWorkAtPriority: vi.fn(() => false),
        },
        worldTileController: {
          update,
          isBrowseCutoverActive: vi.fn(() => false),
        },
        selectedExactPrefetchLifecycle: { pause: vi.fn() },
        previewCache: { cancelSelectionPrefetchesExcept: vi.fn() },
        performanceAdvisorExactSnapshotRequestsByRoomId: new Map([[
          '1,0',
          {
            roomId: '1,0',
            generation: 7,
            optionalCompetitionObserved: false,
            settled: false,
          },
        ]]),
        options: {
          scene: { cameras: { main: {} } },
          onPerformanceAdvisorExactSnapshotEvent,
        },
      },
    );

    expect(harness.updateWorldTiles()).toBe(true);
    expect(onPerformanceAdvisorExactSnapshotEvent).not.toHaveBeenCalled();

    expect(harness.updateWorldTiles()).toBe(true);
    expect(onPerformanceAdvisorExactSnapshotEvent).toHaveBeenCalledOnce();
    expect(onPerformanceAdvisorExactSnapshotEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'optional-competition',
        roomId: '1,0',
        generation: 7,
      }),
    );
  });

  it('does not rebuild artifact-cache protection on steady frames', () => {
    const profile = { value: 'normal' as 'normal' | 'reduced' };
    const syncRoomArtifactCachePolicy = vi.fn(function (this: { roomArtifactCacheProfile: string }) {
      this.roomArtifactCacheProfile = profile.value;
    });
    const frameWorkCoordinator = { runFrame: vi.fn() };
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        destroyed: false,
        roomArtifactCacheProfile: 'normal',
        frameWorkCoordinator,
        getEffectivePerformanceProfile: vi.fn(() => profile.value),
        syncRoomArtifactCachePolicy,
        options: { getMode: () => 'play' },
      },
    );

    harness.runDiscretionaryFrameWork(4);
    harness.runDiscretionaryFrameWork(4);
    expect(syncRoomArtifactCachePolicy).not.toHaveBeenCalled();

    profile.value = 'reduced';
    harness.runDiscretionaryFrameWork(4, 1.25);
    expect(syncRoomArtifactCachePolicy).toHaveBeenCalledOnce();
    expect(frameWorkCoordinator.runFrame).toHaveBeenLastCalledWith(expect.objectContaining({
      profile: 'reduced',
      sharedBudgetConsumedMs: 1.25,
      cpuBudgetConsumedMs: 1.25,
    }));
  });

  it('treats an unchanged loaded room as a collider-only no-op', () => {
    const room = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const loadedRoom = { room, source: 'published' };
    const ensurePlayerTerrainColliders = vi.fn();
    const previewRenderer = { syncPreviewVisibility: vi.fn() };
    const options = {
      onBackdropObjectsChanged: vi.fn(),
      onFullRoomVisibilityChanged: vi.fn(),
      onFullRoomSetChanged: vi.fn(),
    };
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        loadedFullRoomsById: new Map([[room.id, loadedRoom]]),
        ensurePlayerTerrainColliders,
        isLoadedFullRoomCurrent: vi.fn(() => true),
        previewRenderer,
        options,
      },
    );

    callEnsureFullRoom(harness, room);

    expect(ensurePlayerTerrainColliders).toHaveBeenCalledOnce();
    expect(previewRenderer.syncPreviewVisibility).not.toHaveBeenCalled();
    expect(options.onBackdropObjectsChanged).not.toHaveBeenCalled();
    expect(options.onFullRoomVisibilityChanged).not.toHaveBeenCalled();
    expect(options.onFullRoomSetChanged).not.toHaveBeenCalled();
  });

  it('stages a loaded v1 to v2 refresh without synchronous texture or object rebuilding', () => {
    const v1 = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const v2 = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    v2.version = v1.version + 1;
    v2.updatedAt = `${v1.updatedAt}:v2`;
    const loadedRuntime = { room: v1, source: 'published', collisionReady: true };
    const ensureFullRoom = vi.fn();
    const beginFullRoomPreparation = vi.fn();
    const renderableRoom = {
      id: v2.id,
      coordinates: v2.coordinates,
      room: v2,
      source: 'published' as const,
    };
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        loadedFullRoomsById: new Map([[v1.id, loadedRuntime]]),
        options: {
          getCurrentRoomCoordinates: () => v1.coordinates,
        },
        isLoadedFullRoomCurrent: vi.fn(() => false),
        ensureFullRoom,
        ensurePlayerTerrainColliders: vi.fn(),
        beginFullRoomPreparation,
        queueDeferredFullRoomLoads: vi.fn(),
      },
    );

    callSyncPlayFullRooms(harness, new Map([[v2.id, renderableRoom]]), new Set([v2.id]));

    expect(ensureFullRoom).not.toHaveBeenCalled();
    expect(harness.ensurePlayerTerrainColliders).not.toHaveBeenCalled();
    expect(beginFullRoomPreparation).toHaveBeenCalledWith(
      renderableRoom,
      'portal-current-destination',
      false,
    );
  });

  it('closes seams before queued teardown and deduplicates each room', () => {
    const first = createDefaultRoomSnapshot('0,0', { x: 0, y: 0 });
    const second = createDefaultRoomSnapshot('1,0', { x: 1, y: 0 });
    const loadedFullRoomsById = new Map([
      [first.id, { room: first, collisionReady: true }],
      [second.id, { room: second, collisionReady: true }],
    ]);
    const destroyFullRoom = vi.fn((roomId: string) => {
      loadedFullRoomsById.delete(roomId);
      return roomId === first.id ? first.coordinates : second.coordinates;
    });
    const syncLiveObjectWorldColliders = vi.fn();
    const syncLiveObjectInteractions = vi.fn();
    const previewRenderer = { syncPreviewVisibility: vi.fn() };
    const options = {
      onBackdropObjectsChanged: vi.fn(),
      onFullRoomSetChanged: vi.fn(() => {
        expect(destroyFullRoom).not.toHaveBeenCalled();
        expect(loadedFullRoomsById.get(first.id)?.collisionReady).toBe(false);
        expect(loadedFullRoomsById.get(second.id)?.collisionReady).toBe(false);
      }),
      syncLiveObjectInteractions,
      getCurrentRoomCoordinates: () => ({ x: 99, y: 99 }),
      getPlayer: () => null,
    };
    const frameWorkCoordinator = new FrameWorkCoordinator();
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        loadedFullRoomsById,
        pendingFullRoomPreparationsById: new Map(),
        pendingFullRoomTeardownsById: new Map(),
        retainedFullRoomIds: new Set(),
        predictedPreparationRoomId: null,
        fullRoomReleaseAtById: new Map(),
        frameWorkCoordinator,
        destroyFullRoom,
        syncLiveObjectWorldColliders,
        previewRenderer,
        options,
      },
    );

    callUnloadOutsideStream(harness, new Set());
    callUnloadOutsideStream(harness, new Set());

    expect(destroyFullRoom).not.toHaveBeenCalled();
    expect(frameWorkCoordinator.getDiagnostics().queueDepth).toBe(2);
    expect(options.onFullRoomSetChanged).toHaveBeenCalledOnce();
    expect(options.onFullRoomSetChanged).toHaveBeenCalledWith([
      first.coordinates,
      second.coordinates,
    ]);

    const frame = frameWorkCoordinator.runFrame({
      profile: 'normal',
      criticalHeadroomMs: 4,
    });

    expect(frame.executed.map((job) => job.priority)).toEqual(['teardown', 'teardown']);
    expect(destroyFullRoom).toHaveBeenCalledTimes(2);
    expect(destroyFullRoom).toHaveBeenNthCalledWith(1, first.id, false);
    expect(destroyFullRoom).toHaveBeenNthCalledWith(2, second.id, false);
    expect(syncLiveObjectWorldColliders).not.toHaveBeenCalled();
    expect(syncLiveObjectInteractions).not.toHaveBeenCalled();

    const reconcileFrame = frameWorkCoordinator.runFrame({
      profile: 'normal',
      criticalHeadroomMs: 4,
    });

    expect(reconcileFrame.executed).toHaveLength(1);
    expect(syncLiveObjectWorldColliders).toHaveBeenCalledOnce();
    expect(syncLiveObjectInteractions).toHaveBeenCalledOnce();
    expect(previewRenderer.syncPreviewVisibility).toHaveBeenCalledOnce();
    expect(options.onBackdropObjectsChanged).toHaveBeenCalledOnce();
  });

  it('suspends old-room rendering and physics even when teardown has no frame headroom', () => {
    const room = createDefaultRoomSnapshot('4,7', { x: 4, y: 7 });
    const image = createRuntimeDisplayObject();
    const terrainLayer = createRuntimeDisplayObject();
    const terrainCollider = { active: true };
    const loadedRoom = {
      room,
      collisionReady: true,
      backgroundColorRect: null,
      backgroundSprites: [],
      image,
      foregroundImage: null,
      terrainLayer,
      terrainCollider,
      terrainInsetBodies: null,
      terrainInsetCollider: null,
    };
    const frameWorkCoordinator = new FrameWorkCoordinator();
    const setLiveObjectsDormant = vi.fn();
    const destroyFullRoom = vi.fn();
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        loadedFullRoomsById: new Map([[room.id, loadedRoom]]),
        pendingFullRoomPreparationsById: new Map(),
        pendingFullRoomTeardownsById: new Map(),
        retainedFullRoomIds: new Set(),
        predictedPreparationRoomId: null,
        portalPreparationRoomId: null,
        fullRoomReleaseAtById: new Map(),
        frameWorkCoordinator,
        destroyFullRoom,
        ensurePlayerTerrainColliders: vi.fn(),
        syncLiveObjectWorldColliders: vi.fn(),
        previewRenderer: { syncPreviewVisibility: vi.fn() },
        options: {
          getCurrentRoomCoordinates: () => ({ x: 5, y: 7 }),
          getPlayer: () => null,
          setLiveObjectsDormant,
          onFullRoomSetChanged: vi.fn(),
          onBackdropObjectsChanged: vi.fn(),
        },
      },
    );

    callUnloadOutsideStream(harness, new Set());

    expect(loadedRoom.collisionReady).toBe(false);
    expect(image).toMatchObject({ active: false, visible: false });
    expect(terrainLayer).toMatchObject({ active: false, visible: false });
    expect(terrainCollider.active).toBe(false);
    expect(setLiveObjectsDormant).toHaveBeenCalledWith(loadedRoom, true);

    for (let frame = 0; frame < 3; frame += 1) {
      frameWorkCoordinator.runFrame({ profile: 'reduced', criticalHeadroomMs: 0 });
    }
    expect(destroyFullRoom).not.toHaveBeenCalled();
    expect(frameWorkCoordinator.getDiagnostics().queueDepth).toBe(1);

    callUnloadOutsideStream(harness, new Set([room.id]));
    expect(image).toMatchObject({ active: true, visible: true });
    expect(terrainLayer).toMatchObject({ active: true, visible: true });
    expect(terrainCollider.active).toBe(true);
    expect(loadedRoom.collisionReady).toBe(true);
    expect(setLiveObjectsDormant).toHaveBeenLastCalledWith(loadedRoom, false);
  });

  it('cancels a queued teardown and safely restores collision when the room is retained', () => {
    const room = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const loadedRoom = { room, collisionReady: true };
    const frameWorkCoordinator = new FrameWorkCoordinator();
    const destroyFullRoom = vi.fn();
    const options = {
      getCurrentRoomCoordinates: () => ({ x: 4, y: 7 }),
      getPlayer: () => null,
      onFullRoomSetChanged: vi.fn(),
      onBackdropObjectsChanged: vi.fn(),
      syncLiveObjectInteractions: vi.fn(),
    };
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        loadedFullRoomsById: new Map([[room.id, loadedRoom]]),
        pendingFullRoomPreparationsById: new Map(),
        pendingFullRoomTeardownsById: new Map(),
        retainedFullRoomIds: new Set(),
        predictedPreparationRoomId: null,
        fullRoomReleaseAtById: new Map(),
        frameWorkCoordinator,
        destroyFullRoom,
        ensurePlayerTerrainColliders: vi.fn(),
        syncLiveObjectWorldColliders: vi.fn(),
        previewRenderer: { syncPreviewVisibility: vi.fn() },
        options,
      },
    );

    callUnloadOutsideStream(harness, new Set());
    expect(loadedRoom.collisionReady).toBe(false);
    expect(frameWorkCoordinator.getDiagnostics().queueDepth).toBe(1);

    callUnloadOutsideStream(harness, new Set([room.id]));
    expect(loadedRoom.collisionReady).toBe(true);
    expect(frameWorkCoordinator.getDiagnostics().queueDepth).toBe(0);
    expect(harness.pendingFullRoomTeardownsById.size).toBe(0);

    frameWorkCoordinator.runFrame({ profile: 'normal', criticalHeadroomMs: 4 });
    expect(destroyFullRoom).not.toHaveBeenCalled();
    expect(options.onFullRoomSetChanged).toHaveBeenCalledTimes(2);
  });

  it('reconciles a restored room while another room remains suspended', () => {
    const roomB = createDefaultRoomSnapshot('4,7', { x: 4, y: 7 });
    const roomA = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const loadedB = createLoadedRoomRuntime(roomB);
    const loadedA = createLoadedRoomRuntime(roomA);
    const frameWorkCoordinator = new FrameWorkCoordinator();
    const syncLiveObjectWorldColliders = vi.fn();
    const syncLiveObjectInteractions = vi.fn();
    const setLiveObjectWorldCollisionTargetDormant = vi.fn();
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        // Queue B first so restoring A leaves B in the pending/suspended set.
        loadedFullRoomsById: new Map([
          [roomB.id, loadedB],
          [roomA.id, loadedA],
        ]),
        pendingFullRoomPreparationsById: new Map(),
        pendingFullRoomTeardownsById: new Map(),
        retainedFullRoomIds: new Set(),
        predictedPreparationRoomId: null,
        portalPreparationRoomId: null,
        fullRoomReleaseAtById: new Map(),
        frameWorkCoordinator,
        ensurePlayerTerrainColliders: vi.fn(),
        syncLiveObjectWorldColliders,
        previewRenderer: { syncPreviewVisibility: vi.fn() },
        options: {
          getCurrentRoomCoordinates: () => ({ x: 99, y: 99 }),
          getPlayer: () => null,
          getLiveObjectPhysicsReconciliationGeneration: () => 7,
          setLiveObjectsDormant: vi.fn(),
          setLiveObjectWorldCollisionTargetDormant,
          syncLiveObjectInteractions,
          onFullRoomSetChanged: vi.fn(),
          onBackdropObjectsChanged: vi.fn(),
        },
      },
    );

    callUnloadOutsideStream(harness, new Set());
    expect(loadedA.runtimeSuspended).toBe(true);
    expect(loadedB.runtimeSuspended).toBe(true);

    callUnloadOutsideStream(harness, new Set([roomA.id]));

    expect(loadedA.runtimeSuspended).toBe(false);
    expect(loadedA.collisionReady).toBe(true);
    expect(loadedB.runtimeSuspended).toBe(true);
    expect(loadedB.collisionReady).toBe(false);
    expect(harness.pendingFullRoomTeardownsById.has(roomB.id)).toBe(true);
    expect(syncLiveObjectWorldColliders).toHaveBeenCalledOnce();
    expect(syncLiveObjectInteractions).toHaveBeenCalledOnce();
    expect(setLiveObjectWorldCollisionTargetDormant).toHaveBeenCalledWith(loadedA, false);
    expect(setLiveObjectWorldCollisionTargetDormant).not.toHaveBeenCalledWith(loadedB, false);
  });

  it('skips queued teardown reconciliation after a newer global reconciliation', () => {
    const room = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const loadedRoom = createLoadedRoomRuntime(room);
    const loadedFullRoomsById = new Map([[room.id, loadedRoom]]);
    const frameWorkCoordinator = new FrameWorkCoordinator();
    const syncLiveObjectWorldColliders = vi.fn();
    const syncLiveObjectInteractions = vi.fn();
    let reconciliationGeneration = 11;
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        loadedFullRoomsById,
        pendingFullRoomPreparationsById: new Map(),
        pendingFullRoomTeardownsById: new Map(),
        retainedFullRoomIds: new Set(),
        predictedPreparationRoomId: null,
        portalPreparationRoomId: null,
        fullRoomReleaseAtById: new Map(),
        frameWorkCoordinator,
        destroyFullRoom: vi.fn((roomId: string) => {
          loadedFullRoomsById.delete(roomId);
          return room.coordinates;
        }),
        syncLiveObjectWorldColliders,
        previewRenderer: { syncPreviewVisibility: vi.fn() },
        options: {
          getCurrentRoomCoordinates: () => ({ x: 99, y: 99 }),
          getPlayer: () => null,
          getLiveObjectPhysicsReconciliationGeneration: () => reconciliationGeneration,
          syncLiveObjectInteractions,
          onFullRoomSetChanged: vi.fn(),
          onBackdropObjectsChanged: vi.fn(),
        },
      },
    );

    callUnloadOutsideStream(harness, new Set());
    const teardownFrame = frameWorkCoordinator.runFrame({
      profile: 'reduced',
      criticalHeadroomMs: 2,
    });
    expect(teardownFrame.executed).toHaveLength(1);
    expect(teardownFrame.executed[0]?.label).toMatch(
      new RegExp(`^teardown-full-room(?:-begin)?:${room.id.replace(',', '\\,')}$`),
    );
    expect(frameWorkCoordinator.getDiagnostics().queueDepth).toBe(1);

    // A different focus/activation path has already rebuilt the global graph.
    reconciliationGeneration += 1;
    frameWorkCoordinator.runFrame({ profile: 'reduced', criticalHeadroomMs: 2 });

    expect(syncLiveObjectWorldColliders).not.toHaveBeenCalled();
    expect(syncLiveObjectInteractions).not.toHaveBeenCalled();
    expect(frameWorkCoordinator.getDiagnostics().queueDepth).toBe(0);
  });

  it('yields heavy teardown across frames and removes the room only after final disposal', () => {
    const room = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const events: string[] = [];
    const { harness, loadedRoom, frameWorkCoordinator, destroyLiveObjectsBatch } =
      createIncrementalTeardownHarness(room, {
        liveObjectCount: 10,
        backgroundSpriteCount: 5,
        events,
      });

    harness.options.onFullRoomSetChanged = vi.fn(() => {
      events.push('seam-closed');
      expect(harness.loadedFullRoomsById.get(room.id)).toBe(loadedRoom);
      expect(loadedRoom.collisionReady).toBe(false);
      expect(destroyLiveObjectsBatch).not.toHaveBeenCalled();
    });

    callUnloadOutsideStream(harness, new Set());

    expect(events).toEqual(['seam-closed']);
    expect(loadedRoom.runtimeSuspended).toBe(true);
    expect(harness.loadedFullRoomsById.has(room.id)).toBe(true);

    const roomPresentAfterFrame: boolean[] = [];
    const executedLabels: string[] = [];
    for (let frame = 0; frame < 30 && harness.loadedFullRoomsById.has(room.id); frame += 1) {
      const result = frameWorkCoordinator.runFrame({
        profile: 'reduced',
        criticalHeadroomMs: 2,
      });
      expect(result.executed.length).toBeLessThanOrEqual(1);
      executedLabels.push(...result.executed.map((job) => job.label));
      roomPresentAfterFrame.push(harness.loadedFullRoomsById.has(room.id));
    }

    expect(destroyLiveObjectsBatch).toHaveBeenCalledTimes(3);
    expect(destroyLiveObjectsBatch.mock.calls.map(([, maxObjectCount]) => maxObjectCount))
      .toEqual([4, 4, 4]);
    expect(roomPresentAfterFrame.length).toBeGreaterThan(3);
    expect(roomPresentAfterFrame.slice(0, -1).every(Boolean)).toBe(true);
    expect(roomPresentAfterFrame.at(-1)).toBe(false);
    expect(harness.loadedFullRoomsById.has(room.id)).toBe(false);
    expect(loadedRoom.liveObjects).toHaveLength(0);
    expect(loadedRoom.terrainLayer.destroy).toHaveBeenCalledOnce();
    expect(loadedRoom.map.destroy).toHaveBeenCalledOnce();
    expect(loadedRoom.image.destroy).toHaveBeenCalledOnce();
    expect(events[0]).toBe('seam-closed');
    expect(events.at(-1)).toBe('finalized');
    expect(executedLabels.some((label) => label.includes('-objects:'))).toBe(true);
    expect(executedLabels.at(-1)).toContain('-finalize:');
  });

  it('restores before destructive work but finishes and refreshes once destruction starts', () => {
    const cancellableRoom = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const cancellable = createIncrementalTeardownHarness(cancellableRoom, {
      liveObjectCount: 6,
    });

    callUnloadOutsideStream(cancellable.harness, new Set());
    callUnloadOutsideStream(cancellable.harness, new Set([cancellableRoom.id]));

    expect(cancellable.destroyLiveObjectsBatch).not.toHaveBeenCalled();
    expect(cancellable.harness.pendingFullRoomTeardownsById.size).toBe(0);
    expect(cancellable.harness.loadedFullRoomsById.get(cancellableRoom.id))
      .toBe(cancellable.loadedRoom);
    expect(cancellable.loadedRoom.runtimeSuspended).toBe(false);
    expect(cancellable.loadedRoom.collisionReady).toBe(true);
    expect(cancellable.refreshVisibleRoomsFromCache).not.toHaveBeenCalled();

    const irreversibleRoom = createDefaultRoomSnapshot('6,7', { x: 6, y: 7 });
    const irreversible = createIncrementalTeardownHarness(irreversibleRoom, {
      liveObjectCount: 6,
    });
    callUnloadOutsideStream(irreversible.harness, new Set());
    irreversible.frameWorkCoordinator.runFrame({
      profile: 'reduced',
      criticalHeadroomMs: 2,
    });

    expect(irreversible.destroyLiveObjectsBatch).toHaveBeenCalledOnce();
    expect(irreversible.loadedRoom.liveObjects).toHaveLength(2);
    expect(irreversible.harness.loadedFullRoomsById.has(irreversibleRoom.id)).toBe(true);

    callUnloadOutsideStream(irreversible.harness, new Set([irreversibleRoom.id]));

    expect(irreversible.loadedRoom.runtimeSuspended).toBe(true);
    expect(irreversible.loadedRoom.collisionReady).toBe(false);
    expect(irreversible.harness.pendingFullRoomTeardownsById.has(irreversibleRoom.id))
      .toBe(true);

    runCoordinatorUntil(
      irreversible.frameWorkCoordinator,
      () => !irreversible.harness.loadedFullRoomsById.has(irreversibleRoom.id),
    );

    expect(irreversible.harness.loadedFullRoomsById.has(irreversibleRoom.id)).toBe(false);
    expect(irreversible.refreshVisibleRoomsFromCache).toHaveBeenCalledOnce();
  });

  it.each(['current', 'predicted'] as const)(
    'revalidates a queued teardown when the room becomes %s before execution',
    (retentionKind) => {
      const room = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
      const loadedRoom = { room, collisionReady: true };
      const currentCoordinates = { value: { x: 4, y: 7 } };
      const frameWorkCoordinator = new FrameWorkCoordinator();
      const destroyFullRoom = vi.fn();
      const options = {
        getCurrentRoomCoordinates: () => currentCoordinates.value,
        getPlayer: () => null,
        onFullRoomSetChanged: vi.fn(),
        onBackdropObjectsChanged: vi.fn(),
        syncLiveObjectInteractions: vi.fn(),
      };
      const harness = Object.assign(
        Object.create(OverworldWorldStreamingController.prototype),
        {
          loadedFullRoomsById: new Map([[room.id, loadedRoom]]),
          pendingFullRoomPreparationsById: new Map(),
          pendingFullRoomTeardownsById: new Map(),
          retainedFullRoomIds: new Set(),
          predictedPreparationRoomId: null,
          fullRoomReleaseAtById: new Map(),
          frameWorkCoordinator,
          destroyFullRoom,
          ensurePlayerTerrainColliders: vi.fn(),
          syncLiveObjectWorldColliders: vi.fn(),
          previewRenderer: { syncPreviewVisibility: vi.fn() },
          options,
        },
      );

      callUnloadOutsideStream(harness, new Set());
      if (retentionKind === 'current') {
        currentCoordinates.value = { ...room.coordinates };
      } else {
        harness.predictedPreparationRoomId = room.id;
      }

      frameWorkCoordinator.runFrame({ profile: 'normal', criticalHeadroomMs: 4 });

      expect(destroyFullRoom).not.toHaveBeenCalled();
      expect(loadedRoom.collisionReady).toBe(true);
      expect(harness.pendingFullRoomTeardownsById.size).toBe(0);
      expect(options.onFullRoomSetChanged).toHaveBeenCalledTimes(2);
    },
  );

  it('retains an activated predicted destination outside the ordinary stream budget', () => {
    const current = createDefaultRoomSnapshot('4,7', { x: 4, y: 7 });
    const predicted = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const destroyFullRoom = vi.fn();
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        loadedFullRoomsById: new Map([
          [current.id, { room: current, collisionReady: true }],
          [predicted.id, { room: predicted, collisionReady: true }],
        ]),
        pendingFullRoomPreparationsById: new Map(),
        pendingFullRoomTeardownsById: new Map(),
        retainedFullRoomIds: new Set(),
        predictedPreparationRoomId: predicted.id,
        frameWorkCoordinator: new FrameWorkCoordinator(),
        destroyFullRoom,
        syncLiveObjectWorldColliders: vi.fn(),
        previewRenderer: { syncPreviewVisibility: vi.fn() },
        options: {
          getCurrentRoomCoordinates: () => current.coordinates,
          getPlayer: () => null,
          onBackdropObjectsChanged: vi.fn(),
          onFullRoomSetChanged: vi.fn(),
        },
      },
    );

    callUnloadOutsideStream(harness, new Set([current.id]));

    expect(destroyFullRoom).not.toHaveBeenCalled();
    expect(harness.loadedFullRoomsById.get(predicted.id)?.collisionReady).toBe(true);
    expect(harness.options.onFullRoomSetChanged).not.toHaveBeenCalled();
  });

  it('skips active-runtime release grace in reduced mode and tears down the previous room', () => {
    const previous = createDefaultRoomSnapshot('4,7', { x: 4, y: 7 });
    const current = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const loadedFullRoomsById = new Map([
      [previous.id, { room: previous, collisionReady: true, artifactKey: 'previous-artifact' }],
      [current.id, { room: current, collisionReady: true, artifactKey: 'current-artifact' }],
    ]);
    const destroyFullRoom = vi.fn((roomId: string) => {
      loadedFullRoomsById.delete(roomId);
      return previous.coordinates;
    });
    const frameWorkCoordinator = new FrameWorkCoordinator();
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        loadedFullRoomsById,
        fullRoomReleaseAtById: new Map(),
        pendingFullRoomPreparationsById: new Map(),
        pendingFullRoomTeardownsById: new Map(),
        retainedFullRoomIds: new Set(),
        predictedPreparationRoomId: null,
        portalPreparationRoomId: null,
        frameWorkCoordinator,
        getEffectivePerformanceProfile: vi.fn(() => 'reduced'),
        getProtectedLoadedFullRoomIds: vi.fn(() => new Set()),
        scheduleFullRoomReleaseCleanup: vi.fn(),
        destroyFullRoom,
        syncLiveObjectWorldColliders: vi.fn(),
        previewRenderer: { syncPreviewVisibility: vi.fn() },
        options: {
          scene: { time: { now: 10_000 } },
          getCurrentRoomCoordinates: () => current.coordinates,
          getPlayer: () => null,
          onFullRoomSetChanged: vi.fn(),
          onBackdropObjectsChanged: vi.fn(),
        },
      },
    );

    const retained = callGetRetainedFullRoomIds(harness, new Set([current.id]));
    expect(retained).toEqual(new Set([current.id]));
    expect(harness.fullRoomReleaseAtById.has(previous.id)).toBe(false);

    callUnloadOutsideStream(harness, retained);
    frameWorkCoordinator.runFrame({ profile: 'reduced', criticalHeadroomMs: 2 });

    expect(Array.from(loadedFullRoomsById.keys())).toEqual([current.id]);
    expect(destroyFullRoom).toHaveBeenCalledWith(previous.id, false);
  });

  it('protects distant portal and dormant preparation snapshots from pruning', () => {
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        loadedFullRoomsById: new Map([['0,0', {}]]),
        pendingFullRoomPreparationsById: new Map([['40,-12', {}]]),
        playableRoomSnapshotRequestsById: new Map([['9,9', Promise.resolve()]]),
        predictedPreparationRoomId: '1,0',
        portalPreparationRoomId: '40,-12',
        options: {
          getMode: () => 'play',
          getCurrentRoomCoordinates: () => ({ x: 0, y: 0 }),
        },
      },
    );

    const protectedIds = callGetProtectedExactSnapshotRoomIds(harness);

    expect(protectedIds).toEqual(new Set([
      '0,0',
      '40,-12',
      '9,9',
      '1,0',
      '-1,0',
      '0,1',
      '0,-1',
    ]));
  });

  it('does not supersede a near side-seam prediction during a tangential jump hold', () => {
    const right = { x: 1, y: 0 };
    const up = { x: 0, y: -1 };
    const player = {
      x: 631,
      y: 176,
      body: { velocity: { x: 0, y: -180 } },
    };
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        predictedPreparationRoomId: '1,0',
        predictedPreparationCoordinates: right,
        options: {
          getCurrentRoomCoordinates: () => ({ x: 0, y: 0 }),
          getPlayer: () => player,
          getRoomOrigin: () => ({ x: 0, y: 0 }),
        },
      },
    );

    expect(callShouldAdoptPredictedPreparation(harness, '0,-1', up)).toBe(false);
  });

  it('keeps exact prediction ties stable across repeated frames', () => {
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        predictedPreparationRoomId: '1,0',
        predictedPreparationCoordinates: { x: 1, y: 0 },
        estimateTimeToSeamMs: vi.fn(() => 100),
      },
    );

    expect(callShouldAdoptPredictedPreparation(harness, '0,1', { x: 0, y: 1 })).toBe(false);
    expect(callShouldAdoptPredictedPreparation(harness, '0,1', { x: 0, y: 1 })).toBe(false);
    expect(callShouldAdoptPredictedPreparation(harness, '0,1', { x: 0, y: 1 })).toBe(false);
  });

  it('can switch from a stopped side seam to tangential travel before reaching the corner', () => {
    const player = {
      x: 631,
      y: 5,
      body: { velocity: { x: 0, y: -180 } },
    };
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        predictedPreparationRoomId: '1,0',
        predictedPreparationCoordinates: { x: 1, y: 0 },
        options: {
          getCurrentRoomCoordinates: () => ({ x: 0, y: 0 }),
          getPlayer: () => player,
          getRoomOrigin: () => ({ x: 0, y: 0 }),
        },
      },
    );

    expect(callShouldAdoptPredictedPreparation(harness, '0,-1', { x: 0, y: -1 })).toBe(true);
  });

  it('cancels queued teardown immediately when an already-loaded room is predicted again', () => {
    const room = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const loadedRoom = { room, collisionReady: false };
    const teardownJob = { cancel: vi.fn() };
    const delayedCall = vi.fn(() => ({ remove: vi.fn() }));
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        loadedFullRoomsById: new Map([[room.id, loadedRoom]]),
        pendingFullRoomPreparationsById: new Map(),
        pendingFullRoomTeardownsById: new Map([[
          room.id,
          { loadedRoom, restoreCollisionReady: true, job: teardownJob },
        ]]),
        retainedFullRoomIds: new Set(),
        predictedPreparationRoomId: null,
        predictedPreparationCoordinates: null,
        predictedPreparationExpiresAt: 0,
        predictedPreparationIntentGeneration: 0,
        predictedPreparationExpiryTimer: null,
        ensurePlayerTerrainColliders: vi.fn(),
        previewRenderer: { syncPreviewVisibility: vi.fn() },
        options: {
          scene: { time: { now: 0, delayedCall } },
          getCurrentRoomCoordinates: () => ({ x: 4, y: 7 }),
          getPlayer: () => null,
          onFullRoomSetChanged: vi.fn(),
        },
      },
    );

    expect(callAdoptPredictedPreparation(harness, room.id, room.coordinates)).toBe(true);

    expect(harness.predictedPreparationRoomId).toBe(room.id);
    expect(harness.pendingFullRoomTeardownsById.size).toBe(0);
    expect(loadedRoom.collisionReady).toBe(true);
    expect(teardownJob.cancel).toHaveBeenCalledWith('room-became-predicted');
    expect(harness.options.onFullRoomSetChanged).toHaveBeenCalledWith([room.coordinates]);
  });

  it('expires abandoned prediction intent and queues its loaded runtime for teardown', () => {
    const current = createDefaultRoomSnapshot('4,7', { x: 4, y: 7 });
    const predicted = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const loadedRoom = { room: predicted, collisionReady: true };
    let expiryCallback: () => void = () => {
      throw new Error('Prediction expiry was not scheduled.');
    };
    const clock = { now: 0 };
    const frameWorkCoordinator = new FrameWorkCoordinator();
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        loadedFullRoomsById: new Map([[predicted.id, loadedRoom]]),
        pendingFullRoomPreparationsById: new Map(),
        pendingFullRoomTeardownsById: new Map(),
        retainedFullRoomIds: new Set(),
        predictedPreparationRoomId: null,
        predictedPreparationCoordinates: null,
        predictedPreparationExpiresAt: 0,
        predictedPreparationIntentGeneration: 0,
        predictedPreparationExpiryTimer: null,
        frameWorkCoordinator,
        roomArtifactCache: { setProtectedKeys: vi.fn(), setBudgetBytes: vi.fn() },
        previewRenderer: { syncPreviewVisibility: vi.fn() },
        getEffectivePerformanceProfile: vi.fn(() => 'normal'),
        options: {
          scene: {
            time: {
              get now() { return clock.now; },
              delayedCall: vi.fn((_delay: number, callback: () => void) => {
                expiryCallback = callback;
                return { remove: vi.fn() };
              }),
            },
          },
          getCurrentRoomCoordinates: () => current.coordinates,
          getPlayer: () => null,
          onFullRoomSetChanged: vi.fn(),
        },
      },
    );

    expect(callAdoptPredictedPreparation(harness, predicted.id, predicted.coordinates)).toBe(true);
    clock.now = 1_501;
    expiryCallback();

    expect(harness.predictedPreparationRoomId).toBeNull();
    expect(loadedRoom.collisionReady).toBe(false);
    expect(harness.pendingFullRoomTeardownsById.has(predicted.id)).toBe(true);
    expect(frameWorkCoordinator.getDiagnostics().queueDepth).toBe(1);
  });
});

function callEnsureFullRoom(
  harness: object,
  room: ReturnType<typeof createDefaultRoomSnapshot>,
): void {
  const method = (
    OverworldWorldStreamingController.prototype as unknown as {
      ensureFullRoom(snapshot: RoomSnapshot, source: 'published'): void;
    }
  ).ensureFullRoom;
  method.call(harness, room, 'published');
}

function callUnloadOutsideStream(harness: object, retained: Set<string>): void {
  const method = (
    OverworldWorldStreamingController.prototype as unknown as {
      unloadFullRoomsOutsideStream(roomIds: Set<string>): void;
    }
  ).unloadFullRoomsOutsideStream;
  method.call(harness, retained);
}

function callGetRetainedFullRoomIds(harness: object, roomIds: Set<string>): Set<string> {
  const method = (
    OverworldWorldStreamingController.prototype as unknown as {
      getRetainedFullRoomIds(ids: Set<string>): Set<string>;
    }
  ).getRetainedFullRoomIds;
  return method.call(harness, roomIds);
}

function callGetProtectedExactSnapshotRoomIds(harness: object): Set<string> {
  const method = (
    OverworldWorldStreamingController.prototype as unknown as {
      getProtectedExactSnapshotRoomIds(): Set<string>;
    }
  ).getProtectedExactSnapshotRoomIds;
  return method.call(harness);
}

function callSyncPlayFullRooms(
  harness: object,
  rooms: Map<string, unknown>,
  fullRoomIds: Set<string>,
): void {
  const method = (
    OverworldWorldStreamingController.prototype as unknown as {
      syncPlayFullRooms(renderableRooms: Map<string, unknown>, ids: Set<string>): void;
    }
  ).syncPlayFullRooms;
  method.call(harness, rooms, fullRoomIds);
}

function callShouldAdoptPredictedPreparation(
  harness: object,
  roomId: string,
  coordinates: { x: number; y: number },
): boolean {
  const method = (
    OverworldWorldStreamingController.prototype as unknown as {
      shouldAdoptPredictedPreparation(id: string, roomCoordinates: { x: number; y: number }): boolean;
    }
  ).shouldAdoptPredictedPreparation;
  return method.call(harness, roomId, coordinates);
}

function callAdoptPredictedPreparation(
  harness: object,
  roomId: string,
  coordinates: { x: number; y: number },
): boolean {
  const method = (
    OverworldWorldStreamingController.prototype as unknown as {
      adoptPredictedPreparation(id: string, roomCoordinates: { x: number; y: number }): boolean;
    }
  ).adoptPredictedPreparation;
  return method.call(harness, roomId, coordinates);
}

function createRuntimeDisplayObject() {
  return {
    scene: {},
    active: true,
    visible: true,
    setActive(active: boolean) {
      this.active = active;
      return this;
    },
    setVisible(visible: boolean) {
      this.visible = visible;
      return this;
    },
  };
}

function createLoadedRoomRuntime(
  room: ReturnType<typeof createDefaultRoomSnapshot>,
  liveObjectCount = 0,
  backgroundSpriteCount = 0,
) {
  return {
    room,
    source: 'published' as const,
    collisionReady: true,
    runtimeSuspended: false,
    staticLighting: { lights: [], shadows: [] },
    backgroundColorRect: null,
    backgroundSprites: Array.from({ length: backgroundSpriteCount }, () => ({
      sprite: createDestroyableRuntimeDisplayObject(),
      parallax: 0,
      tileScale: 1,
      useVerticalParallax: false,
    })),
    image: createDestroyableRuntimeDisplayObject(),
    textureKey: `room-${room.id}-terrain`,
    foregroundImage: null,
    foregroundTextureKey: null,
    map: { destroy: vi.fn() },
    terrainLayer: createDestroyableRuntimeDisplayObject(),
    terrainCollider: null,
    terrainInsetBodies: null,
    terrainInsetCollider: null,
    edgeWalls: [],
    liveObjects: Array.from({ length: liveObjectCount }, (_, index) => ({ index })),
  };
}

function createDestroyableRuntimeDisplayObject() {
  return {
    ...createRuntimeDisplayObject(),
    destroy: vi.fn(),
  };
}

function createIncrementalTeardownHarness(
  room: ReturnType<typeof createDefaultRoomSnapshot>,
  options: {
    liveObjectCount: number;
    backgroundSpriteCount?: number;
    events?: string[];
  },
) {
  const events = options.events ?? [];
  const loadedRoom = createLoadedRoomRuntime(
    room,
    options.liveObjectCount,
    options.backgroundSpriteCount ?? 0,
  );
  const loadedFullRoomsById = new Map([[room.id, loadedRoom]]);
  const frameWorkCoordinator = new FrameWorkCoordinator();
  const refreshVisibleRoomsFromCache = vi.fn();
  let batchCallCount = 0;
  const destroyLiveObjectsBatch = vi.fn((
    targetRoom: typeof loadedRoom,
    maxObjectCount: number,
    batchOptions?: { clearRoomTriggerState?: boolean },
  ) => {
    batchCallCount += 1;
    events.push(`objects:${Math.min(maxObjectCount, targetRoom.liveObjects.length)}`);
    targetRoom.liveObjects.splice(0, maxObjectCount);
    if (batchCallCount === 1) {
      expect(batchOptions?.clearRoomTriggerState).toBe(true);
    } else {
      expect(batchOptions?.clearRoomTriggerState).toBe(false);
    }
    return targetRoom.liveObjects.length === 0;
  });
  const roomArtifactCache = {
    has: vi.fn(() => false),
    touch: vi.fn(),
    referencesResource: vi.fn(() => false),
    setProtectedKeys: vi.fn(),
    setBudgetBytes: vi.fn(),
  };
  const harness = Object.assign(
    Object.create(OverworldWorldStreamingController.prototype),
    {
      loadedFullRoomsById,
      pendingFullRoomPreparationsById: new Map(),
      pendingFullRoomTeardownsById: new Map(),
      pendingFullRoomTeardownReconciliationJob: null,
      fullRoomTeardownReconciliationRequired: false,
      fullRoomTeardownReconciliationGeneration: null,
      retainedFullRoomIds: new Set(),
      predictedPreparationRoomId: null,
      portalPreparationRoomId: null,
      fullRoomReleaseAtById: new Map(),
      frameWorkCoordinator,
      roomArtifactCache,
      roomArtifactCacheProfile: 'normal',
      refreshVisibleRoomsFromCache,
      syncRoomArtifactCachePolicy: vi.fn(),
      syncLiveObjectWorldColliders: vi.fn(),
      ensurePlayerTerrainColliders: vi.fn(),
      previewRenderer: { syncPreviewVisibility: vi.fn() },
      options: {
        scene: {
          textures: {
            exists: vi.fn(() => false),
            remove: vi.fn(),
          },
        },
        getCurrentRoomCoordinates: () => ({ x: 99, y: 99 }),
        getPlayer: () => null,
        getLiveObjectPhysicsReconciliationGeneration: () => 0,
        setLiveObjectsDormant: vi.fn(),
        setLiveObjectWorldCollisionTargetDormant: vi.fn(),
        destroyLiveObjects: vi.fn(),
        destroyLiveObjectsBatch,
        destroyEdgeWalls: vi.fn(() => events.push('collision')),
        syncLiveObjectInteractions: vi.fn(),
        onFullRoomDestroyed: vi.fn(() => {
          expect(loadedFullRoomsById.has(room.id)).toBe(false);
          events.push('finalized');
        }),
        onFullRoomSetChanged: vi.fn(),
        onBackdropObjectsChanged: vi.fn(),
      },
    },
  );

  return {
    harness,
    loadedRoom,
    frameWorkCoordinator,
    destroyLiveObjectsBatch,
    refreshVisibleRoomsFromCache,
  };
}

function runCoordinatorUntil(
  coordinator: FrameWorkCoordinator,
  predicate: () => boolean,
): void {
  for (let frame = 0; frame < 30 && !predicate(); frame += 1) {
    coordinator.runFrame({ profile: 'reduced', criticalHeadroomMs: 2 });
  }
  expect(predicate()).toBe(true);
}

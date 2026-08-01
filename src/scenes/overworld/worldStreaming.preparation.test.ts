import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));

import { createDefaultRoomSnapshot } from '../../persistence/roomModel';
import { OverworldWorldStreamingController } from './worldStreaming';

describe('world streaming prepared-room activation', () => {
  it('reports dormant readiness only after every preparation stage is complete', () => {
    const room = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const preparation = {
      identity: '5,7:published:v2',
      phase: 'objects',
      activationRequested: true,
      loadedRoom: { room },
      backgroundPrepared: true,
    };
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        pendingFullRoomPreparationsById: new Map([[room.id, preparation]]),
      },
    );

    expect(harness.getFullRoomPreparationProbe(room.id)).toMatchObject({
      identity: preparation.identity,
      phase: 'objects',
      activationRequested: true,
      dormantReady: false,
    });

    preparation.phase = 'ready';
    expect(harness.getFullRoomPreparationProbe(room.id)).toMatchObject({
      phase: 'ready',
      dormantReady: true,
    });
  });

  it('publishes collision readiness only after dormant objects activate and global interactions reconcile', () => {
    const room = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const image = createDisplayObject();
    const foregroundImage = createDisplayObject();
    const terrainLayer = { setActive: vi.fn(), destroy: vi.fn() };
    const loadedRoom = {
      room,
      source: 'published',
      image,
      foregroundImage,
      terrainLayer,
      collisionReady: false,
    };
    const preparation = {
      room,
      source: 'published',
      phase: 'commit',
      loadedRoom,
      backgroundPrepared: true,
    };
    const loadedFullRoomsById = new Map<string, unknown>();
    const pendingFullRoomPreparationsById = new Map([[room.id, preparation]]);
    const activationChecks: string[] = [];
    const onFullRoomSetChanged = vi.fn(() => activationChecks.push('seams'));
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        loadedFullRoomsById,
        pendingFullRoomPreparationsById,
        pendingFullRoomTeardownsById: new Map(),
        options: {
          scene: { cameras: { main: {} } },
          getRoomOrigin: () => ({ x: 0, y: 0 }),
          setLiveObjectsDormant: vi.fn(() => {
            expect(loadedFullRoomsById.has(room.id)).toBe(false);
            activationChecks.push('objects');
          }),
          syncLiveObjectInteractions: vi.fn(() => {
            expect(loadedFullRoomsById.get(room.id)).toBe(loadedRoom);
            expect(loadedRoom.collisionReady).toBe(false);
            activationChecks.push('interactions');
          }),
          onBackdropObjectsChanged: vi.fn(),
          onFullRoomSetChanged,
        },
        isFullRoomPreparationSnapshotCurrent: vi.fn(() => true),
        requirePreparedLoadedRoom: vi.fn(() => loadedRoom),
        createRoomBackground: vi.fn(() => ({ colorRect: null, sprites: [] })),
        setPreparedInsetBodiesActive: vi.fn(),
        isLoadedRoomCollisionInfrastructureReady: vi.fn(() => true),
        ensurePlayerTerrainColliders: vi.fn(() => {
          expect(loadedFullRoomsById.get(room.id)).toBe(loadedRoom);
          expect(loadedRoom.collisionReady).toBe(false);
          activationChecks.push('terrain');
        }),
        syncLiveObjectWorldColliders: vi.fn(() => {
          expect(loadedFullRoomsById.get(room.id)).toBe(loadedRoom);
          expect(loadedRoom.collisionReady).toBe(false);
          activationChecks.push('world-colliders');
        }),
        updateFullRoomBackground: vi.fn(),
        retainPreparedTransitionRoom: vi.fn(),
        previewRenderer: { syncPreviewVisibility: vi.fn() },
        syncRoomArtifactCachePolicy: vi.fn(),
      },
    );

    callCommitPreparedRoom(harness, preparation);

    expect(loadedFullRoomsById.get(room.id)).toBe(loadedRoom);
    expect(loadedRoom.collisionReady).toBe(true);
    expect(pendingFullRoomPreparationsById.has(room.id)).toBe(false);
    expect(activationChecks).toEqual([
      'objects',
      'terrain',
      'world-colliders',
      'interactions',
      'seams',
    ]);
    expect(harness.createRoomBackground).not.toHaveBeenCalled();
  });

  it.each([
    ['terrain collider activation', 'terrain'],
    ['world collider reconciliation', 'world-colliders'],
    ['interaction reconciliation', 'interactions'],
    ['collision readiness verification', 'collision-ready'],
    ['background synchronization', 'background'],
  ] as const)('rolls back a published destination when %s fails', (_label, failurePoint) => {
    const room = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const survivorRoom = createDefaultRoomSnapshot('4,7', { x: 4, y: 7 });
    const loadedRoom = {
      room,
      source: 'published',
      image: createDisplayObject(),
      foregroundImage: createDisplayObject(),
      terrainLayer: { setActive: vi.fn(), destroy: vi.fn() },
      collisionReady: false,
    };
    const survivor = { room: survivorRoom, collisionReady: true };
    const preparation = {
      room,
      source: 'published',
      phase: 'commit',
      loadedRoom,
      backgroundPrepared: true,
    };
    const loadedFullRoomsById = new Map<string, unknown>([[survivorRoom.id, survivor]]);
    const pendingFullRoomPreparationsById = new Map([[room.id, preparation]]);
    const fullRoomReleaseAtById = new Map([[room.id, 10_000]]);
    const failure = new Error(`injected ${failurePoint} failure`);
    const repairedWorldRoomIds: string[][] = [];
    const repairedInteractionRoomIds: string[][] = [];
    const seamChecks: Array<{ collisionReady: boolean; stillPublished: boolean }> = [];
    let worldColliderCallCount = 0;
    let interactionCallCount = 0;
    const destroyLoadedRoomResources = vi.fn(() => {
      expect(loadedFullRoomsById.has(room.id)).toBe(false);
    });
    const onFullRoomDestroyed = vi.fn();
    const onFullRoomSetChanged = vi.fn(() => {
      seamChecks.push({
        collisionReady: loadedRoom.collisionReady,
        stillPublished: loadedFullRoomsById.get(room.id) === loadedRoom,
      });
    });
    const syncLiveObjectWorldColliders = vi.fn(() => {
      worldColliderCallCount += 1;
      if (failurePoint === 'world-colliders' && worldColliderCallCount === 1) {
        throw failure;
      }
      repairedWorldRoomIds.push(Array.from(loadedFullRoomsById.keys()));
    });
    const syncLiveObjectInteractions = vi.fn((rooms: Iterable<{ room: { id: string } }>) => {
      interactionCallCount += 1;
      if (failurePoint === 'interactions' && interactionCallCount === 1) {
        throw failure;
      }
      repairedInteractionRoomIds.push(Array.from(rooms, (candidate) => candidate.room.id));
    });
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        loadedFullRoomsById,
        pendingFullRoomPreparationsById,
        pendingFullRoomTeardownsById: new Map(),
        fullRoomReleaseAtById,
        options: {
          scene: { cameras: { main: {} } },
          getRoomOrigin: () => ({ x: 0, y: 0 }),
          finalizeLiveObjectCreation: vi.fn(),
          syncLiveObjectInteractions,
          onBackdropObjectsChanged: vi.fn(),
          onFullRoomDestroyed,
          onFullRoomSetChanged,
        },
        isFullRoomPreparationSnapshotCurrent: vi.fn(() => true),
        requirePreparedLoadedRoom: vi.fn(() => loadedRoom),
        createRoomBackground: vi.fn(() => ({ colorRect: null, sprites: [] })),
        setPreparedInsetBodiesActive: vi.fn(),
        ensurePlayerTerrainColliders: vi.fn(() => {
          if (failurePoint === 'terrain') throw failure;
        }),
        isLoadedRoomCollisionInfrastructureReady: vi.fn(
          () => failurePoint !== 'collision-ready',
        ),
        syncLiveObjectWorldColliders,
        updateFullRoomBackground: vi.fn(() => {
          if (failurePoint === 'background') throw failure;
        }),
        destroyLoadedRoomResources,
        retainPreparedTransitionRoom: vi.fn(),
        previewRenderer: { syncPreviewVisibility: vi.fn() },
        syncRoomArtifactCachePolicy: vi.fn(),
      },
    );

    if (failurePoint === 'collision-ready') {
      expect(() => callCommitPreparedRoom(harness, preparation)).toThrow(
        `Prepared runtime collision is incomplete for ${room.id}.`,
      );
    } else {
      expect(() => callCommitPreparedRoom(harness, preparation)).toThrow(failure);
    }

    expect(loadedFullRoomsById.get(survivorRoom.id)).toBe(survivor);
    expect(loadedFullRoomsById.has(room.id)).toBe(false);
    expect(loadedRoom.collisionReady).toBe(false);
    expect(preparation.loadedRoom).toBeNull();
    expect(fullRoomReleaseAtById.has(room.id)).toBe(false);
    expect(seamChecks).toEqual([{ collisionReady: false, stillPublished: false }]);
    expect(destroyLoadedRoomResources).toHaveBeenCalledOnce();
    expect(onFullRoomDestroyed).not.toHaveBeenCalled();
    expect(repairedWorldRoomIds.at(-1)).toEqual([survivorRoom.id]);
    expect(repairedInteractionRoomIds.at(-1)).toEqual([survivorRoom.id]);
    expect(harness.previewRenderer.syncPreviewVisibility).toHaveBeenCalledOnce();
    expect(harness.options.onBackdropObjectsChanged).toHaveBeenCalledOnce();
    expect(harness.retainPreparedTransitionRoom).not.toHaveBeenCalled();
  });

  it.each([
    'activation',
    'preview',
    'backdrop',
    'seam',
    'replacement',
    'retention',
  ] as const)(
    'atomically restores an existing runtime when replacement %s fails',
    (failurePoint) => {
      const previousRoom = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
      const replacementRoom = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
      replacementRoom.version = previousRoom.version + 1;
      replacementRoom.updatedAt = `${previousRoom.updatedAt}:v2`;
      const previousRuntime = {
        room: previousRoom,
        source: 'published',
        collisionReady: true,
      };
      const replacementRuntime = {
        room: replacementRoom,
        source: 'published',
        image: createDisplayObject(),
        foregroundImage: createDisplayObject(),
        terrainLayer: { setActive: vi.fn(), destroy: vi.fn() },
        collisionReady: false,
      };
      const preparation = {
        room: replacementRoom,
        source: 'published',
        phase: 'commit',
        loadedRoom: replacementRuntime,
        replacementRoom: null,
        backgroundPrepared: true,
      };
      const loadedFullRoomsById = new Map<string, unknown>([
        [previousRoom.id, previousRuntime],
      ]);
      const pendingFullRoomPreparationsById = new Map([
        [replacementRoom.id, preparation],
      ]);
      const failure = new Error(`injected ${failurePoint} failure`);
      const failOnceAt = (point: typeof failurePoint) => {
        let failed = false;
        return vi.fn(() => {
          if (!failed && failurePoint === point) {
            failed = true;
            throw failure;
          }
        });
      };
      const setLiveObjectsDormant = failOnceAt('activation');
      const syncPreviewVisibility = failOnceAt('preview');
      const onBackdropObjectsChanged = failOnceAt('backdrop');
      const onFullRoomSetChanged = failOnceAt('seam');
      const onFullRoomReplaced = failOnceAt('replacement');
      const retainPreparedTransitionRoom = failOnceAt('retention');
      const destroyLoadedRoomResources = vi.fn();
      const harness = Object.assign(
        Object.create(OverworldWorldStreamingController.prototype),
        {
          loadedFullRoomsById,
          pendingFullRoomPreparationsById,
          pendingFullRoomTeardownsById: new Map(),
          fullRoomReleaseAtById: new Map([[previousRoom.id, 9_000]]),
          options: {
            scene: { cameras: { main: {} }, time: { now: 0 } },
            getRoomOrigin: () => ({ x: 0, y: 0 }),
            setLiveObjectsDormant,
            syncLiveObjectInteractions: vi.fn(),
            onBackdropObjectsChanged,
            onFullRoomSetChanged,
            onFullRoomReplaced,
          },
          isFullRoomPreparationSnapshotCurrent: vi.fn(() => true),
          isLoadedFullRoomCurrent: vi.fn(() => false),
          requirePreparedLoadedRoom: vi.fn(() => replacementRuntime),
          createRoomBackground: vi.fn(() => ({ colorRect: null, sprites: [] })),
          setPreparedInsetBodiesActive: vi.fn(),
          isLoadedRoomCollisionInfrastructureReady: vi.fn(() => true),
          ensurePlayerTerrainColliders: vi.fn(),
          syncLiveObjectWorldColliders: vi.fn(),
          updateFullRoomBackground: vi.fn(),
          destroyLoadedRoomResources,
          retainPreparedTransitionRoom,
          previewRenderer: { syncPreviewVisibility },
          scheduleFullRoomReleaseCleanup: vi.fn(),
          syncRoomArtifactCachePolicy: vi.fn(),
        },
      );

      expect(() => callCommitPreparedRoom(harness, preparation)).toThrow(failure);

      expect(loadedFullRoomsById.get(previousRoom.id)).toBe(previousRuntime);
      expect(previousRuntime.collisionReady).toBe(true);
      expect(replacementRuntime.collisionReady).toBe(false);
      expect(destroyLoadedRoomResources).toHaveBeenCalledOnce();
      expect(destroyLoadedRoomResources).toHaveBeenCalledWith(replacementRuntime, true);
      expect(preparation.loadedRoom).toBeNull();
      expect(preparation.replacementRoom).toBeNull();
      if (failurePoint === 'replacement' || failurePoint === 'retention') {
        expect(pendingFullRoomPreparationsById.has(previousRoom.id)).toBe(false);
        expect(preparation.phase).toBe('failed');
      } else {
        expect(pendingFullRoomPreparationsById.get(previousRoom.id)).toBe(preparation);
      }
      if (failurePoint === 'retention') {
        expect(harness.retainPreparedTransitionRoom).toHaveBeenCalledOnce();
      } else {
        expect(harness.retainPreparedTransitionRoom).not.toHaveBeenCalled();
      }
    },
  );

  it('keeps the previous runtime alive through replacement observers, then destroys it', () => {
    const previousRoom = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const replacementRoom = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    replacementRoom.version += 1;
    replacementRoom.updatedAt = `${replacementRoom.updatedAt}:v2`;
    const previousRuntime = {
      room: previousRoom,
      source: 'published',
      collisionReady: true,
      artifactKey: 'v1-artifact',
      textureKey: 'v1-terrain',
      foregroundTextureKey: 'v1-foreground',
      customRoomTileTextureKey: null,
    };
    const replacementRuntime = {
      room: replacementRoom,
      source: 'published',
      image: createDisplayObject(),
      foregroundImage: createDisplayObject(),
      terrainLayer: { setActive: vi.fn(), destroy: vi.fn() },
      collisionReady: false,
    };
    const preparation = {
      room: replacementRoom,
      source: 'published',
      phase: 'commit',
      loadedRoom: replacementRuntime,
      replacementRoom: null,
      backgroundPrepared: true,
    };
    const loadedFullRoomsById = new Map<string, unknown>([
      [previousRoom.id, previousRuntime],
    ]);
    const destroyLoadedRoomResources = vi.fn();
    const onFullRoomDestroyed = vi.fn();
    const onFullRoomReplaced = vi.fn(() => {
      expect(previousRuntime.collisionReady).toBe(true);
      expect(destroyLoadedRoomResources).not.toHaveBeenCalled();
      expect(loadedFullRoomsById.get(previousRoom.id)).toBe(replacementRuntime);
    });
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        loadedFullRoomsById,
        pendingFullRoomPreparationsById: new Map([[replacementRoom.id, preparation]]),
        pendingFullRoomTeardownsById: new Map(),
        previousRoomArtifactKey: null,
        previousRoomArtifactRoomId: null,
        options: {
          scene: { cameras: { main: {} } },
          getRoomOrigin: () => ({ x: 0, y: 0 }),
          finalizeLiveObjectCreation: vi.fn(),
          syncLiveObjectInteractions: vi.fn(),
          onBackdropObjectsChanged: vi.fn(),
          onFullRoomSetChanged: vi.fn(),
          onFullRoomReplaced,
          onFullRoomDestroyed,
        },
        isFullRoomPreparationSnapshotCurrent: vi.fn(() => true),
        isLoadedFullRoomCurrent: vi.fn(() => false),
        requirePreparedLoadedRoom: vi.fn(() => replacementRuntime),
        createRoomBackground: vi.fn(() => ({ colorRect: null, sprites: [] })),
        setPreparedInsetBodiesActive: vi.fn(),
        isLoadedRoomCollisionInfrastructureReady: vi.fn(() => true),
        ensurePlayerTerrainColliders: vi.fn(),
        syncLiveObjectWorldColliders: vi.fn(),
        updateFullRoomBackground: vi.fn(),
        destroyLoadedRoomResources,
        retainPreparedTransitionRoom: vi.fn(),
        previewRenderer: { syncPreviewVisibility: vi.fn() },
        roomArtifactCache: { has: vi.fn(() => true), touch: vi.fn() },
        releaseRoomArtifactResources: vi.fn(),
        syncRoomArtifactCachePolicy: vi.fn(),
      },
    );

    callCommitPreparedRoom(harness, preparation);

    expect(onFullRoomReplaced).toHaveBeenCalledWith(replacementRuntime);
    expect(previousRuntime.collisionReady).toBe(false);
    expect(destroyLoadedRoomResources).toHaveBeenCalledWith(previousRuntime, true);
    expect(loadedFullRoomsById.get(previousRoom.id)).toBe(replacementRuntime);
    expect(harness.roomArtifactCache.touch).toHaveBeenCalledWith('v1-artifact');
    expect(harness.releaseRoomArtifactResources).not.toHaveBeenCalled();
    expect(harness.previousRoomArtifactKey).toBeNull();
    expect(harness.previousRoomArtifactRoomId).toBeNull();
    expect(onFullRoomDestroyed).not.toHaveBeenCalled();
  });

  it('never publishes a stale preparation', () => {
    const room = createDefaultRoomSnapshot('1,0', { x: 1, y: 0 });
    const preparation = { room, phase: 'commit' };
    const cancelFullRoomPreparation = vi.fn();
    const loadedFullRoomsById = new Map();
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        loadedFullRoomsById,
        isFullRoomPreparationSnapshotCurrent: vi.fn(() => false),
        cancelFullRoomPreparation,
      },
    );

    callCommitPreparedRoom(harness, preparation);

    expect(cancelFullRoomPreparation).toHaveBeenCalledWith(room.id, 'stale-before-commit');
    expect(loadedFullRoomsById.size).toBe(0);
  });

  it('releases runtime texture keys when its artifact entry does not own them', () => {
    const room = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const loadedRoom = {
      room,
      artifactKey: 'missing-artifact-entry',
      textureKey: 'terrain-5,7',
      foregroundTextureKey: 'foreground-5,7',
      customRoomTileTextureKey: 'custom-tiles-5,7',
      collisionReady: true,
    };
    const destroyLoadedRoomResources = vi.fn();
    const releaseRoomArtifactResources = vi.fn();
    const loadedFullRoomsById = new Map([[room.id, loadedRoom]]);
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        loadedFullRoomsById,
        pendingFullRoomTeardownsById: new Map(),
        fullRoomReleaseAtById: new Map([[room.id, 5_000]]),
        roomArtifactCache: {
          has: vi.fn(() => false),
          touch: vi.fn(),
        },
        options: {
          onFullRoomSetChanged: vi.fn(),
          onBackdropObjectsChanged: vi.fn(),
          onFullRoomDestroyed: vi.fn(),
        },
        cancelPendingFullRoomTeardown: vi.fn(),
        destroyLoadedRoomResources,
        releaseRoomArtifactResources,
        syncRoomArtifactCachePolicy: vi.fn(),
      },
    );

    const destroyedCoordinates = callDestroyFullRoom(harness, room.id);

    expect(destroyedCoordinates).toEqual(room.coordinates);
    expect(destroyLoadedRoomResources).toHaveBeenCalledWith(loadedRoom);
    expect(releaseRoomArtifactResources).toHaveBeenCalledWith([
      'terrain-5,7',
      'foreground-5,7',
      'custom-tiles-5,7',
    ]);
    expect(harness.roomArtifactCache.touch).not.toHaveBeenCalled();
    expect(loadedFullRoomsById.has(room.id)).toBe(false);
    expect(harness.fullRoomReleaseAtById.has(room.id)).toBe(false);
  });

  it('cancels dormant runtime state and invalidates its queued generation on reversal', () => {
    const room = createDefaultRoomSnapshot('1,0', { x: 1, y: 0 });
    const loadedRoom = { room };
    const generation = { scope: 'full-room:1,0', id: 1 };
    const texturePreparation = { cancel: vi.fn() };
    const preparation = {
      room,
      artifactKey: 'artifact-1,0',
      generation,
      phase: 'objects',
      texturePreparation,
      loadedRoom,
      committedTextureKeys: ['terrain-1,0'],
    };
    const pendingFullRoomPreparationsById = new Map([[room.id, preparation]]);
    const destroyLoadedRoomResources = vi.fn();
    const releaseRoomArtifactResources = vi.fn();
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        pendingFullRoomPreparationsById,
        predictedPreparationRoomId: room.id,
        frameWorkCoordinator: { cancelGeneration: vi.fn() },
        roomArtifactCache: { has: vi.fn(() => false) },
        getCustomRoomTileTextureKey: vi.fn(() => null),
        destroyLoadedRoomResources,
        releaseRoomArtifactResources,
        syncRoomArtifactCachePolicy: vi.fn(),
      },
    );

    callCancelPreparedRoom(harness, room.id, 'predicted-destination-changed');

    expect(harness.frameWorkCoordinator.cancelGeneration).toHaveBeenCalledWith(
      generation,
      'predicted-destination-changed',
    );
    expect(texturePreparation.cancel).toHaveBeenCalledOnce();
    expect(destroyLoadedRoomResources).toHaveBeenCalledWith(loadedRoom, true);
    expect(releaseRoomArtifactResources).toHaveBeenCalledWith(['terrain-1,0']);
    expect(pendingFullRoomPreparationsById.size).toBe(0);
    expect(harness.predictedPreparationRoomId).toBeNull();
  });

  it('draws custom tile atlases in bounded jobs before one coordinated upload', () => {
    const room = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    room.customTiles = [{ id: 'custom-tile' }] as never;
    let textureExists = false;
    let batchCount = 0;
    const customTilePreparation = {
      runNextBatch: vi.fn((maxTiles: number) => {
        expect(maxTiles).toBe(4);
        batchCount += 1;
        return batchCount === 2;
      }),
      commit: vi.fn(() => {
        textureExists = true;
        return 'custom-atlas';
      }),
    };
    const preparation = {
      room,
      phase: 'uploads',
      customTilePreparation,
      customBackgroundReady: true,
    };
    const recordPreparedRoomArtifacts = vi.fn();
    const queuePreparedRuntimeShell = vi.fn();
    const queuedLabels: string[] = [];
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        options: {
          scene: {
            textures: { exists: vi.fn(() => textureExists) },
          },
        },
        getCustomRoomTileTextureKey: vi.fn(() => 'custom-atlas'),
        enqueueFullRoomPreparationJob: vi.fn((
          _preparation: object,
          label: string,
          _costKind: string,
          _estimatedCostMs: number,
          execute: () => void,
        ) => {
          queuedLabels.push(label);
          execute();
        }),
        recordPreparedRoomArtifacts,
        queuePreparedRuntimeShell,
      },
    );

    callQueuePreparedCustomTiles(harness, preparation);

    expect(customTilePreparation.runNextBatch).toHaveBeenCalledTimes(2);
    expect(customTilePreparation.commit).toHaveBeenCalledOnce();
    expect(queuedLabels).toEqual([
      'prepare-room-custom-tile-batch',
      'prepare-room-custom-tile-batch',
      'upload-room-custom-tiles',
    ]);
    expect(recordPreparedRoomArtifacts).toHaveBeenCalledOnce();
    expect(queuePreparedRuntimeShell).toHaveBeenCalledOnce();
  });
});

function createDisplayObject() {
  const object = {
    setActive: vi.fn(),
    setVisible: vi.fn(),
  };
  return object;
}

function callCommitPreparedRoom(harness: object, preparation: object): void {
  const method = (
    OverworldWorldStreamingController.prototype as unknown as {
      commitPreparedFullRoom(value: object): void;
    }
  ).commitPreparedFullRoom;
  method.call(harness, preparation);
}

function callCancelPreparedRoom(harness: object, roomId: string, reason: string): void {
  const method = (
    OverworldWorldStreamingController.prototype as unknown as {
      cancelFullRoomPreparation(id: string, cancellationReason: string): void;
    }
  ).cancelFullRoomPreparation;
  method.call(harness, roomId, reason);
}

function callDestroyFullRoom(
  harness: object,
  roomId: string,
): { x: number; y: number } | null {
  const method = (
    OverworldWorldStreamingController.prototype as unknown as {
      destroyFullRoom(id: string, notifyDisplayChanges?: boolean): { x: number; y: number } | null;
    }
  ).destroyFullRoom;
  return method.call(harness, roomId);
}

function callQueuePreparedCustomTiles(harness: object, preparation: object): void {
  const method = (
    OverworldWorldStreamingController.prototype as unknown as {
      queuePreparedCustomTiles(value: object): void;
    }
  ).queuePreparedCustomTiles;
  method.call(harness, preparation);
}

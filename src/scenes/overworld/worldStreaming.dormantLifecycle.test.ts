import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Textures: {
      FilterMode: {
        LINEAR: 'linear',
        NEAREST: 'nearest',
      },
    },
  },
}));

import { createDefaultRoomSnapshot } from '../../persistence/roomModel';
import { getCustomBackgroundTextureKey } from '../../backgrounds/runtime';
import { FrameWorkCoordinator } from './frameWorkCoordinator';
import { OverworldWorldStreamingController } from './worldStreaming';

describe('world streaming dormant destination lifecycle', () => {
  it('creates a texture-ready custom background in its own dormant job before terrain', () => {
    const room = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    room.background = 'custom:abcdefgh?fit=stretch';
    const colorRect = createDormantBackgroundObject();
    const customImage = createDormantBackgroundObject();
    const loadedRoom = {
      room,
      backgroundColorRect: null,
      backgroundSprites: [] as Array<{ sprite: unknown }>,
      collisionReady: false,
    };
    const frameWorkCoordinator = new FrameWorkCoordinator();
    const generation = frameWorkCoordinator.beginGeneration(`full-room:${room.id}`);
    const preparation = {
      room,
      generation,
      priority: 'predicted-visuals-objects',
      queuedJob: null,
      phase: 'runtime-shell',
      loadedRoom,
      customBackgroundReady: true,
      backgroundPrepared: false,
    };
    const queuePreparedTerrainBatch = vi.fn();
    const scene = {
      textures: {
        exists: vi.fn(() => true),
        get: vi.fn(() => ({
          getSourceImage: () => ({ width: 320, height: 176 }),
        })),
      },
      add: {
        rectangle: vi.fn(() => colorRect),
        image: vi.fn(() => customImage),
      },
    };
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        destroyed: false,
        pendingFullRoomPreparationsById: new Map([[room.id, preparation]]),
        frameWorkCoordinator,
        options: {
          scene,
          getRoomOrigin: () => ({ x: 640, y: 352 }),
        },
        queuePreparedTerrainBatch,
      },
    );

    callQueuePreparedBackground(harness, preparation);

    expect(preparation.phase).toBe('custom-background');
    expect(scene.add.rectangle).not.toHaveBeenCalled();
    expect(scene.add.image).not.toHaveBeenCalled();
    expect(queuePreparedTerrainBatch).not.toHaveBeenCalled();

    const frame = frameWorkCoordinator.runFrame({
      profile: 'normal',
      criticalHeadroomMs: 4,
    });

    expect(frame.executed.map((job) => job.label)).toEqual([
      `prepare-room-background:${room.id}`,
    ]);
    expect(scene.add.rectangle).toHaveBeenCalledOnce();
    expect(scene.add.image).toHaveBeenCalledOnce();
    expect(loadedRoom.backgroundColorRect).toBe(colorRect);
    expect(loadedRoom.backgroundSprites).toHaveLength(1);
    expect(loadedRoom.backgroundSprites[0]?.sprite).toBe(customImage);
    expect(colorRect).toMatchObject({ active: false, visible: false });
    expect(customImage).toMatchObject({ active: false, visible: false });
    expect(preparation.backgroundPrepared).toBe(true);
    expect(queuePreparedTerrainBatch).toHaveBeenCalledWith(preparation);
  });

  it('prepares and atomically activates a cold custom-background destination', async () => {
    const room = createDefaultRoomSnapshot('-2,9', { x: -2, y: 9 });
    room.background = 'custom:abcdefgh?fit=stretch';
    const renderableRoom = {
      id: room.id,
      coordinates: room.coordinates,
      room,
      source: 'published',
    };
    const terrainTextureKey = 'terrain-texture';
    const foregroundTextureKey = 'foreground-texture';
    const customBackgroundTextureKey = getCustomBackgroundTextureKey('abcdefgh');
    const registeredTextures = new Set([terrainTextureKey, foregroundTextureKey]);
    const canvasContext = {
      imageSmoothingEnabled: false,
      drawImage: vi.fn(),
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => canvasContext),
    };
    const bitmap = {
      width: 320,
      height: 176,
      close: vi.fn(),
    } as unknown as ImageBitmap;
    const createImageBitmapSpy = vi.fn(async () => bitmap);
    const fetchReceivers: unknown[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(function (
      this: unknown,
      _url: RequestInfo | URL,
      _init?: RequestInit,
    ): Promise<Response> {
      fetchReceivers.push(this);
      if (this !== globalThis) {
        return Promise.reject(new TypeError('Illegal invocation'));
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        blob: async () => new Blob(['cold-background']),
      } as Response);
    });
    vi.stubGlobal('createImageBitmap', createImageBitmapSpy);
    vi.stubGlobal('document', {
      createElement: vi.fn((tagName: string) => {
        expect(tagName).toBe('canvas');
        return canvas;
      }),
    });

    const image = createDormantDisplayObject();
    const foregroundImage = createDormantDisplayObject();
    const terrainLayer = createDormantTerrainLayer();
    const loadedRoom = {
      room,
      source: 'published',
      backgroundColorRect: null,
      backgroundSprites: [],
      image,
      textureKey: terrainTextureKey,
      foregroundImage,
      foregroundTextureKey,
      terrainLayer,
      terrainInsetBodies: null,
      liveObjects: [],
      collisionReady: false,
    };
    const loadedFullRoomsById = new Map<string, unknown>();
    const pendingFullRoomPreparationsById = new Map<string, unknown>();
    const frameWorkCoordinator = new FrameWorkCoordinator();
    const observerStates: Array<{ published: boolean; collisionReady: boolean }> = [];
    const onFullRoomCollisionReady = vi.fn();
    const onFullRoomSetChanged = vi.fn(() => {
      observerStates.push({
        published: loadedFullRoomsById.get(room.id) === loadedRoom,
        collisionReady: loadedRoom.collisionReady,
      });
    });
    const scene = {
      textures: {
        exists: vi.fn((key: string) => registeredTextures.has(key)),
        addCanvas: vi.fn((key: string) => {
          registeredTextures.add(key);
          return {};
        }),
      },
      cameras: { main: {} },
    };
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        destroyed: false,
        loadedFullRoomsById,
        pendingFullRoomPreparationsById,
        pendingFullRoomTeardownsById: new Map(),
        predictedPreparationRoomId: null,
        frameWorkCoordinator,
        roomArtifactCache: { has: vi.fn(() => false) },
        options: {
          getMode: () => 'play',
          scene,
          getRoomOrigin: () => ({ x: 0, y: 0 }),
          syncLiveObjectInteractions: vi.fn(),
          onBackdropObjectsChanged: vi.fn(),
          onFullRoomSetChanged,
          onFullRoomCollisionReady,
        },
        detachPredictedPreparationIntent: vi.fn(),
        buildFullRoomPreparationIdentity: vi.fn(() => 'cold-custom-background'),
        buildFullRoomArtifactKey: vi.fn(() => 'cold-custom-background-artifact'),
        buildScopedRoomTextureKey: vi
          .fn()
          .mockReturnValueOnce(terrainTextureKey)
          .mockReturnValueOnce(foregroundTextureKey),
        getCustomRoomTileTextureKey: vi.fn(() => null),
        recordPreparedRoomArtifacts: vi.fn(),
        syncRoomArtifactCachePolicy: vi.fn(),
        releaseRoomArtifactResources: vi.fn(),
        isFullRoomPreparationSnapshotCurrent: vi.fn(() => true),
        requirePreparedLoadedRoom: vi.fn(() => loadedRoom),
        setPreparedInsetBodiesActive: vi.fn(),
        isLoadedRoomCollisionInfrastructureReady: vi.fn(() => true),
        ensurePlayerTerrainColliders: vi.fn(),
        syncLiveObjectWorldColliders: vi.fn(),
        updateFullRoomBackground: vi.fn(),
        retainPreparedTransitionRoom: vi.fn(),
        previewRenderer: { syncPreviewVisibility: vi.fn() },
        queuePreparedRuntimeShell: vi.fn((preparation: { loadedRoom: unknown }) => {
          preparation.loadedRoom = loadedRoom;
          Object.assign(preparation, { backgroundPrepared: true });
          callMarkPreparedRoomReady(harness, preparation);
        }),
      },
    );

    try {
      const preparation = callBeginPreparedRoom(
        harness,
        renderableRoom,
        'predicted-visuals-objects',
        false,
      ) as { phase: string; activationRequested: boolean };

      expect(preparation).not.toBeNull();
      expect(preparation.phase).toBe('custom-background');
      expect(preparation.activationRequested).toBe(true);
      expect(loadedFullRoomsById.has(room.id)).toBe(false);
      expect(loadedRoom.collisionReady).toBe(false);

      await vi.waitFor(() => {
        expect(frameWorkCoordinator.getDiagnostics().queueDepth).toBe(1);
      });
      for (let frame = 0; frame < 10 && !loadedFullRoomsById.has(room.id); frame += 1) {
        frameWorkCoordinator.runFrame({ profile: 'normal', criticalHeadroomMs: 4 });
      }

      expect(fetchReceivers).toEqual([globalThis]);
      expect(fetchSpy).toHaveBeenCalledOnce();
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/background-images/abcdefgh/image'),
        expect.objectContaining({
          credentials: 'include',
          signal: expect.any(AbortSignal),
        }),
      );
      expect(createImageBitmapSpy).toHaveBeenCalledOnce();
      expect(registeredTextures.has(customBackgroundTextureKey)).toBe(true);
      expect(canvasContext.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
      expect(bitmap.close).toHaveBeenCalledOnce();
      expect(loadedFullRoomsById.get(room.id)).toBe(loadedRoom);
      expect(loadedRoom.collisionReady).toBe(true);
      expect(pendingFullRoomPreparationsById.has(room.id)).toBe(false);
      expect(onFullRoomCollisionReady).toHaveBeenCalledWith(loadedRoom);
      expect(onFullRoomSetChanged).toHaveBeenCalledWith([room.coordinates]);
      expect(observerStates).toEqual([{ published: true, collisionReady: true }]);
      expect(frameWorkCoordinator.getDiagnostics()).toMatchObject({
        queueDepth: 0,
        failedJobs: 0,
        currentGenerations: {},
      });
    } finally {
      fetchSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('finalizes prepared object links and switch state in a discretionary job while dormant', () => {
    const room = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const liveObject = { active: false, body: { enable: false } };
    const loadedRoom = {
      room,
      liveObjects: [liveObject],
      collisionReady: false,
    };
    const frameWorkCoordinator = new FrameWorkCoordinator();
    const generation = frameWorkCoordinator.beginGeneration(`full-room:${room.id}`);
    const preparation = {
      room,
      generation,
      priority: 'predicted-visuals-objects',
      queuedJob: null,
      phase: 'objects',
      activationRequested: false,
      loadedRoom,
    };
    const callbacks: string[] = [];
    const onPreparedLiveObjectsReady = vi.fn(() => {
      expect(liveObject).toEqual({ active: false, body: { enable: false } });
      callbacks.push('links');
    });
    const finalizeLiveObjectCreation = vi.fn((_room, dormant: boolean) => {
      expect(liveObject).toEqual({ active: false, body: { enable: false } });
      expect(dormant).toBe(true);
      callbacks.push('switch-state');
    });
    const queuePreparedRoomCommit = vi.fn();
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        destroyed: false,
        pendingFullRoomPreparationsById: new Map([[room.id, preparation]]),
        frameWorkCoordinator,
        options: {
          onPreparedLiveObjectsReady,
          finalizeLiveObjectCreation,
        },
        queuePreparedRoomCommit,
      },
    );

    callQueuePreparedLiveObjectFinalization(harness, preparation);

    expect(onPreparedLiveObjectsReady).not.toHaveBeenCalled();
    expect(finalizeLiveObjectCreation).not.toHaveBeenCalled();
    expect(preparation.phase).toBe('objects');

    const frame = frameWorkCoordinator.runFrame({
      profile: 'normal',
      criticalHeadroomMs: 4,
    });

    expect(frame.executed.map((job) => job.label)).toEqual([
      `prepare-room-object-links-state:${room.id}`,
    ]);
    expect(frame.executed[0]?.priority).toBe('predicted-visuals-objects');
    expect(callbacks).toEqual(['links', 'switch-state']);
    expect(onPreparedLiveObjectsReady).toHaveBeenCalledWith(loadedRoom);
    expect(finalizeLiveObjectCreation).toHaveBeenCalledWith(loadedRoom, true);
    expect(liveObject).toEqual({ active: false, body: { enable: false } });
    expect(preparation.phase).toBe('ready');
    expect(queuePreparedRoomCommit).not.toHaveBeenCalled();
  });

  it('keeps a completed predicted runtime dormant and unpublished', () => {
    const room = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const image = createDormantDisplayObject();
    const foregroundImage = createDormantDisplayObject();
    const terrainLayer = createDormantTerrainLayer();
    const liveObject = { active: false, body: { enable: false } };
    const loadedRoom = {
      room,
      image,
      foregroundImage,
      terrainLayer,
      liveObjects: [liveObject],
      collisionReady: false,
    };
    const preparation = {
      room,
      phase: 'objects',
      activationRequested: false,
      loadedRoom,
    };
    const loadedFullRoomsById = new Map();
    const queuePreparedRoomCommit = vi.fn();
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        loadedFullRoomsById,
        queuePreparedRoomCommit,
      },
    );

    callMarkPreparedRoomReady(harness, preparation);

    expect(preparation.phase).toBe('ready');
    expect(loadedFullRoomsById.has(room.id)).toBe(false);
    expect(loadedRoom.collisionReady).toBe(false);
    expect(image).toMatchObject({ active: false, visible: false });
    expect(foregroundImage).toMatchObject({ active: false, visible: false });
    expect(terrainLayer).toMatchObject({ active: false, visible: false });
    expect(liveObject).toEqual({ active: false, body: { enable: false } });
    expect(image.setActive).not.toHaveBeenCalled();
    expect(image.setVisible).not.toHaveBeenCalled();
    expect(terrainLayer.setActive).not.toHaveBeenCalled();
    expect(queuePreparedRoomCommit).not.toHaveBeenCalled();
  });

  it('promotes the currently queued stage when activation becomes critical', () => {
    const room = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const queuedJob = { reprioritize: vi.fn(() => true) };
    const preparation = {
      room,
      priority: 'predicted-visuals-objects',
      queuedJob,
      activationRequested: false,
      phase: 'terrain',
    };
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        isFullRoomPreparationCurrent: vi.fn(() => true),
        queuePreparedRoomCommit: vi.fn(),
      },
    );

    callRequestPreparedRoomActivation(harness, preparation);

    expect(preparation.activationRequested).toBe(true);
    expect(preparation.priority).toBe('portal-current-destination');
    expect(queuedJob.reprioritize).toHaveBeenCalledOnce();
    expect(queuedJob.reprioritize).toHaveBeenCalledWith('portal-current-destination');
    expect(harness.queuePreparedRoomCommit).not.toHaveBeenCalled();
  });

  it('queues a ready destination and publishes it only after atomic activation completes', () => {
    const room = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const image = createDormantDisplayObject();
    const foregroundImage = createDormantDisplayObject();
    const terrainLayer = createDormantTerrainLayer();
    const loadedRoom = {
      room,
      source: 'published',
      image,
      foregroundImage,
      terrainLayer,
      liveObjects: [],
      collisionReady: false,
    };
    const frameWorkCoordinator = new FrameWorkCoordinator();
    const generation = frameWorkCoordinator.beginGeneration(`full-room:${room.id}`);
    const preparation = {
      room,
      source: 'published',
      generation,
      priority: 'predicted-visuals-objects',
      queuedJob: null,
      activationRequested: false,
      phase: 'ready',
      loadedRoom,
      replacementRoom: null,
      backgroundPrepared: true,
    };
    const loadedFullRoomsById = new Map<string, unknown>();
    const pendingFullRoomPreparationsById = new Map([[room.id, preparation]]);
    const observerStates: Array<{ published: boolean; collisionReady: boolean }> = [];
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        loadedFullRoomsById,
        pendingFullRoomPreparationsById,
        pendingFullRoomTeardownsById: new Map(),
        frameWorkCoordinator,
        options: {
          scene: { cameras: { main: {} } },
          getRoomOrigin: () => ({ x: 0, y: 0 }),
          finalizeLiveObjectCreation: vi.fn(),
          syncLiveObjectInteractions: vi.fn(),
          onBackdropObjectsChanged: vi.fn(),
          onFullRoomSetChanged: vi.fn(() => {
            observerStates.push({
              published: loadedFullRoomsById.get(room.id) === loadedRoom,
              collisionReady: loadedRoom.collisionReady,
            });
          }),
        },
        isFullRoomPreparationCurrent: vi.fn(() => true),
        isFullRoomPreparationSnapshotCurrent: vi.fn(() => true),
        requirePreparedLoadedRoom: vi.fn(() => loadedRoom),
        createRoomBackground: vi.fn(() => ({ colorRect: null, sprites: [] })),
        setPreparedInsetBodiesActive: vi.fn(),
        isLoadedRoomCollisionInfrastructureReady: vi.fn(() => true),
        ensurePlayerTerrainColliders: vi.fn(),
        syncLiveObjectWorldColliders: vi.fn(),
        updateFullRoomBackground: vi.fn(),
        retainPreparedTransitionRoom: vi.fn(),
        previewRenderer: { syncPreviewVisibility: vi.fn() },
        syncRoomArtifactCachePolicy: vi.fn(),
      },
    );

    callRequestPreparedRoomActivation(harness, preparation);

    expect(preparation.phase).toBe('commit');
    expect(loadedFullRoomsById.has(room.id)).toBe(false);
    expect(loadedRoom.collisionReady).toBe(false);
    expect(frameWorkCoordinator.getDiagnostics().queueDepth).toBe(1);

    frameWorkCoordinator.runFrame({ profile: 'normal', criticalHeadroomMs: 4 });

    expect(loadedFullRoomsById.get(room.id)).toBe(loadedRoom);
    expect(loadedRoom.collisionReady).toBe(true);
    expect(pendingFullRoomPreparationsById.has(room.id)).toBe(false);
    expect(frameWorkCoordinator.getDiagnostics().currentGenerations).toEqual({});
    expect(observerStates).toEqual([{ published: true, collisionReady: true }]);
    expect(image.setActive).toHaveBeenCalledWith(true);
    expect(image.setVisible).toHaveBeenCalledWith(true);
    expect(terrainLayer.setActive).toHaveBeenCalledWith(true);
  });

  it('marks an ordinary nonpredicted preparation for activation from creation', () => {
    const room = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const renderableRoom = {
      id: room.id,
      coordinates: room.coordinates,
      room,
      source: 'published',
    };
    const queuePreparedCustomTiles = vi.fn();
    const queuePreparedRoomCommit = vi.fn();
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        destroyed: false,
        loadedFullRoomsById: new Map(),
        pendingFullRoomPreparationsById: new Map(),
        frameWorkCoordinator: {
          beginGeneration: vi.fn(() => ({ scope: `full-room:${room.id}`, id: 1 })),
        },
        options: {
          getMode: () => 'play',
          scene: { textures: { exists: vi.fn(() => true) } },
        },
        detachPredictedPreparationIntent: vi.fn(),
        buildFullRoomPreparationIdentity: vi.fn(() => 'identity'),
        buildFullRoomArtifactKey: vi.fn(() => 'artifact'),
        buildScopedRoomTextureKey: vi
          .fn()
          .mockReturnValueOnce('terrain-texture')
          .mockReturnValueOnce('foreground-texture'),
        syncRoomArtifactCachePolicy: vi.fn(),
        queuePreparedCustomTiles,
        queuePreparedRoomCommit,
      },
    );

    const preparation = callBeginPreparedRoom(
      harness,
      renderableRoom,
      'predicted-visuals-objects',
      false,
    );

    expect(preparation).not.toBeNull();
    expect(preparation?.activationRequested).toBe(true);
    expect(queuePreparedCustomTiles).toHaveBeenCalledWith(preparation);

    callMarkPreparedRoomReady(harness, preparation!);
    expect(queuePreparedRoomCommit).toHaveBeenCalledWith(preparation);
  });

  it('keeps same-room movement ownership when portal activation begins before portal exit', () => {
    const room = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const renderableRoom = {
      id: room.id,
      coordinates: room.coordinates,
      room,
      source: 'published',
    };
    const detachPredictedPreparationIntent = vi.fn();
    const cancelFullRoomPreparation = vi.fn();
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        destroyed: false,
        loadedFullRoomsById: new Map(),
        pendingFullRoomPreparationsById: new Map(),
        playableRoomSnapshotRequestsById: new Map(),
        playableRoomSnapshotRequestIntentGenerationById: new Map(),
        playableRoomSnapshotPreparationRequestsById: new Map(),
        playableRoomSnapshotRetryAtById: new Map(),
        predictedPreparationRoomId: room.id,
        predictedPreparationCoordinates: room.coordinates,
        predictedPreparationIntentGeneration: 3,
        portalPreparationRoomId: room.id,
        frameWorkCoordinator: {
          beginGeneration: vi.fn(() => ({ scope: `full-room:${room.id}`, id: 1 })),
        },
        options: {
          getMode: () => 'play',
          getCurrentRoomCoordinates: () => ({ x: 4, y: 7 }),
          scene: { textures: { exists: vi.fn(() => true) } },
        },
        detachPredictedPreparationIntent,
        buildFullRoomPreparationIdentity: vi.fn(() => 'identity'),
        buildFullRoomArtifactKey: vi.fn(() => 'artifact'),
        buildScopedRoomTextureKey: vi
          .fn()
          .mockReturnValueOnce('terrain-texture')
          .mockReturnValueOnce('foreground-texture'),
        syncRoomArtifactCachePolicy: vi.fn(),
        queuePreparedCustomTiles: vi.fn(),
        cancelFullRoomPreparation,
        queueUnretainedPredictedRoomTeardown: vi.fn(),
      },
    );

    const preparation = callBeginPreparedRoom(
      harness,
      renderableRoom,
      'predicted-visuals-objects',
      false,
      false,
    ) as {
      activationRequested: boolean;
      standardActivationRequested: boolean;
      portalActivationRequested: boolean;
    };
    callRequestPreparedRoomActivation(harness, preparation, false);
    callRequestPreparedRoomActivation(harness, preparation, true);

    callClearPortalTarget(harness, room.id);

    expect(detachPredictedPreparationIntent).not.toHaveBeenCalled();
    expect(harness.predictedPreparationRoomId).toBe(room.id);
    expect(preparation.standardActivationRequested).toBe(true);
    expect(preparation.portalActivationRequested).toBe(false);
    expect(preparation.activationRequested).toBe(true);
    expect(cancelFullRoomPreparation).not.toHaveBeenCalled();
  });

  it('destroys a dormant ready shell when prediction is cleared or reversed', () => {
    const room = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const loadedRoom = {
      room,
      image: createDormantDisplayObject(),
      terrainLayer: createDormantTerrainLayer(),
      liveObjects: [{ active: false, body: { enable: false } }],
      collisionReady: false,
    };
    const generation = { scope: `full-room:${room.id}`, id: 1 };
    const preparation = {
      room,
      artifactKey: 'dormant-artifact',
      generation,
      queuedJob: null,
      phase: 'ready',
      activationRequested: false,
      texturePreparation: { cancel: vi.fn() },
      loadedRoom,
      committedTextureKeys: ['dormant-terrain'],
    };
    const destroyLoadedRoomResources = vi.fn();
    const releaseRoomArtifactResources = vi.fn();
    const harness = Object.assign(
      Object.create(OverworldWorldStreamingController.prototype),
      {
        predictedPreparationRoomId: room.id,
        predictedPreparationCoordinates: room.coordinates,
        predictedPreparationExpiresAt: 500,
        predictedPreparationIntentGeneration: 1,
        predictedPreparationExpiryTimer: null,
        loadedFullRoomsById: new Map(),
        pendingFullRoomPreparationsById: new Map([[room.id, preparation]]),
        pendingFullRoomTeardownsById: new Map(),
        retainedFullRoomIds: new Set(),
        frameWorkCoordinator: { cancelGeneration: vi.fn() },
        roomArtifactCache: { has: vi.fn(() => false) },
        options: { getCurrentRoomCoordinates: () => ({ x: 4, y: 7 }) },
        getCustomRoomTileTextureKey: vi.fn(() => null),
        destroyLoadedRoomResources,
        releaseRoomArtifactResources,
        syncRoomArtifactCachePolicy: vi.fn(),
      },
    );

    callClearPredictedRoom(harness, 'predicted-destination-reversed');

    expect(harness.frameWorkCoordinator.cancelGeneration).toHaveBeenCalledWith(
      generation,
      'predicted-destination-reversed',
    );
    expect(preparation.texturePreparation.cancel).toHaveBeenCalledOnce();
    expect(destroyLoadedRoomResources).toHaveBeenCalledWith(loadedRoom, true);
    expect(releaseRoomArtifactResources).toHaveBeenCalledWith(['dormant-terrain']);
    expect(preparation.phase).toBe('cancelled');
    expect(preparation.loadedRoom).toBeNull();
    expect(harness.pendingFullRoomPreparationsById.size).toBe(0);
    expect(harness.loadedFullRoomsById.size).toBe(0);
    expect(harness.predictedPreparationRoomId).toBeNull();
  });
});

function createDormantDisplayObject() {
  return {
    active: false,
    visible: false,
    setActive: vi.fn(function (this: { active: boolean }, active: boolean) {
      this.active = active;
      return this;
    }),
    setVisible: vi.fn(function (this: { visible: boolean }, visible: boolean) {
      this.visible = visible;
      return this;
    }),
  };
}

function createDormantTerrainLayer() {
  return {
    active: false,
    visible: false,
    setActive: vi.fn(function (this: { active: boolean }, active: boolean) {
      this.active = active;
      return this;
    }),
  };
}

function createDormantBackgroundObject() {
  return {
    active: true,
    visible: true,
    texture: { setFilter: vi.fn() },
    setActive: vi.fn(function (this: { active: boolean }, active: boolean) {
      this.active = active;
      return this;
    }),
    setVisible: vi.fn(function (this: { visible: boolean }, visible: boolean) {
      this.visible = visible;
      return this;
    }),
    setOrigin: vi.fn().mockReturnThis(),
    setDepth: vi.fn().mockReturnThis(),
    setPosition: vi.fn().mockReturnThis(),
    setCrop: vi.fn().mockReturnThis(),
    setDisplaySize: vi.fn().mockReturnThis(),
    destroy: vi.fn(),
  };
}

function callQueuePreparedBackground(harness: object, preparation: object): void {
  const method = (
    OverworldWorldStreamingController.prototype as unknown as {
      queuePreparedBackground(value: object): void;
    }
  ).queuePreparedBackground;
  method.call(harness, preparation);
}

function callQueuePreparedLiveObjectFinalization(
  harness: object,
  preparation: object,
): void {
  const method = (
    OverworldWorldStreamingController.prototype as unknown as {
      queuePreparedLiveObjectFinalization(value: object): void;
    }
  ).queuePreparedLiveObjectFinalization;
  method.call(harness, preparation);
}

function callMarkPreparedRoomReady(harness: object, preparation: object): void {
  const method = (
    OverworldWorldStreamingController.prototype as unknown as {
      markPreparedFullRoomReady(value: object): void;
    }
  ).markPreparedFullRoomReady;
  method.call(harness, preparation);
}

function callRequestPreparedRoomActivation(
  harness: object,
  preparation: object,
  portalDestination = false,
): void {
  const method = (
    OverworldWorldStreamingController.prototype as unknown as {
      requestFullRoomPreparationActivation(value: object, portal?: boolean): void;
    }
  ).requestFullRoomPreparationActivation;
  method.call(harness, preparation, portalDestination);
}

function callBeginPreparedRoom(
  harness: object,
  renderableRoom: object,
  priority: 'predicted-visuals-objects',
  predicted: boolean,
  activateWhenReady?: boolean,
): { activationRequested: boolean } | null {
  const method = (
    OverworldWorldStreamingController.prototype as unknown as {
      beginFullRoomPreparation(
        room: object,
        jobPriority: 'predicted-visuals-objects',
        isPredicted: boolean,
        shouldActivateWhenReady?: boolean,
      ): { activationRequested: boolean } | null;
    }
  ).beginFullRoomPreparation;
  return method.call(harness, renderableRoom, priority, predicted, activateWhenReady);
}

function callClearPredictedRoom(harness: object, reason: string): void {
  OverworldWorldStreamingController.prototype.clearPredictedPlayableRoomForTransition.call(
    harness as OverworldWorldStreamingController,
    reason,
  );
}

function callClearPortalTarget(harness: object, roomId: string): void {
  OverworldWorldStreamingController.prototype.clearPortalTargetRoomPreparation.call(
    harness as OverworldWorldStreamingController,
    roomId,
  );
}

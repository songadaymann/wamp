import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));

import { createDefaultRoomSnapshot } from '../../persistence/roomModel';
import { FrameWorkCoordinator } from './frameWorkCoordinator';
import { OverworldWorldStreamingController } from './worldStreaming';

describe('world streaming teardown races', () => {
  it('restores a queued teardown through syncPlayFullRooms without rebuilding terrain colliders', () => {
    const room = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const loadedRoom = createLoadedRoomRuntime(room);
    const originalTerrainCollider = loadedRoom.terrainCollider;
    const collider = vi.fn();
    const harness = createStreamingHarness(loadedRoom, {
      currentCoordinates: room.coordinates,
      collider,
    });
    Object.assign(harness, {
      measure: (_label: string, operation: () => unknown) => operation(),
      syncArtifactFocusRoom: vi.fn(),
      isLoadedFullRoomCurrent: vi.fn(() => true),
      queueDeferredFullRoomLoads: vi.fn(),
    });

    callQueueFullRoomTeardown(harness, loadedRoom);

    expect(loadedRoom.runtimeSuspended).toBe(true);
    expect(originalTerrainCollider.active).toBe(false);
    expect(harness.pendingFullRoomTeardownsById.has(room.id)).toBe(true);

    callSyncPlayFullRooms(
      harness,
      new Map([[
        room.id,
        {
          id: room.id,
          coordinates: room.coordinates,
          room,
          source: 'published',
        },
      ]]),
      new Set([room.id]),
    );

    expect(harness.pendingFullRoomTeardownsById.has(room.id)).toBe(false);
    expect(harness.loadedFullRoomsById.get(room.id)).toBe(loadedRoom);
    expect(loadedRoom.runtimeSuspended).toBe(false);
    expect(loadedRoom.collisionReady).toBe(true);
    expect(loadedRoom.terrainCollider).toBe(originalTerrainCollider);
    expect(originalTerrainCollider.active).toBe(true);
    expect(originalTerrainCollider.destroy).not.toHaveBeenCalled();
    expect(collider).not.toHaveBeenCalled();
    expect(harness.frameWorkCoordinator.getDiagnostics().queueDepth).toBe(0);
  });

  it('starts a fresh preparation when syncPlayFullRooms force-disposes a failed restore', () => {
    const room = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const oldRoom = createLoadedRoomRuntime(room);
    const harness = createStreamingHarness(oldRoom, {
      currentCoordinates: room.coordinates,
    });
    const freshPreparation = { room, loadedRoom: null, phase: 'textures' };
    let oldRuntimeDisposed = false;
    const ensurePlayerTerrainColliders = vi.fn((candidate: typeof oldRoom) => {
      expect(candidate).toBe(oldRoom);
      expect(oldRuntimeDisposed).toBe(false);
    });
    const beginFullRoomPreparation = vi.fn(() => {
      expect(oldRuntimeDisposed).toBe(true);
      expect(harness.loadedFullRoomsById.has(room.id)).toBe(false);
      harness.pendingFullRoomPreparationsById.set(room.id, freshPreparation);
      return freshPreparation;
    });
    Object.assign(harness, {
      measure: (_label: string, operation: () => unknown) => operation(),
      syncArtifactFocusRoom: vi.fn(),
      isLoadedFullRoomCurrent: vi.fn((candidate: typeof oldRoom) => {
        expect(oldRuntimeDisposed).toBe(false);
        return candidate === oldRoom;
      }),
      ensurePlayerTerrainColliders,
      isLoadedRoomCollisionInfrastructureReady: vi.fn(() => false),
      beginFullRoomPreparation,
      queueDeferredFullRoomLoads: vi.fn(),
    });
    harness.options.onFullRoomDestroyed = vi.fn((candidate: typeof oldRoom) => {
      expect(candidate).toBe(oldRoom);
      oldRuntimeDisposed = true;
    });

    callQueueFullRoomTeardown(harness, oldRoom);
    callSyncPlayFullRooms(
      harness,
      new Map([[
        room.id,
        {
          id: room.id,
          coordinates: room.coordinates,
          room,
          source: 'published',
        },
      ]]),
      new Set([room.id]),
    );

    expect(oldRuntimeDisposed).toBe(true);
    expect(harness.loadedFullRoomsById.has(room.id)).toBe(false);
    expect(harness.pendingFullRoomTeardownsById.has(room.id)).toBe(false);
    expect(harness.pendingFullRoomPreparationsById.get(room.id)).toBe(freshPreparation);
    expect(beginFullRoomPreparation).toHaveBeenCalledOnce();
    expect(ensurePlayerTerrainColliders).toHaveBeenCalledOnce();
    expect(harness.roomArtifactCache.touch).not.toHaveBeenCalled();
    expect(harness.options.onFullRoomDestroyed).toHaveBeenCalledOnce();
  });

  it('does not ensure or touch a disposed runtime while beginning its fresh preparation', () => {
    const room = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const oldRoom = createLoadedRoomRuntime(room);
    const harness = createStreamingHarness(oldRoom, {
      currentCoordinates: room.coordinates,
    });
    let oldRuntimeDisposed = false;
    const ensurePlayerTerrainColliders = vi.fn((candidate: typeof oldRoom) => {
      expect(candidate).toBe(oldRoom);
      expect(oldRuntimeDisposed).toBe(false);
    });
    Object.assign(harness, {
      isLoadedFullRoomCurrent: vi.fn((candidate: typeof oldRoom) => {
        expect(oldRuntimeDisposed).toBe(false);
        return candidate === oldRoom;
      }),
      ensurePlayerTerrainColliders,
      isLoadedRoomCollisionInfrastructureReady: vi.fn(() => false),
      buildFullRoomPreparationIdentity: vi.fn(() => 'fresh-identity'),
      buildFullRoomArtifactKey: vi.fn(() => 'fresh-artifact'),
      buildScopedRoomTextureKey: vi
        .fn()
        .mockReturnValueOnce('fresh-terrain')
        .mockReturnValueOnce('fresh-foreground'),
      queuePreparedCustomTiles: vi.fn(),
    });
    harness.options.scene.textures.exists = vi.fn(() => true);
    harness.options.onFullRoomDestroyed = vi.fn((candidate: typeof oldRoom) => {
      expect(candidate).toBe(oldRoom);
      oldRuntimeDisposed = true;
    });

    callQueueFullRoomTeardown(harness, oldRoom);
    const preparation = callBeginFullRoomPreparation(harness, {
      id: room.id,
      coordinates: room.coordinates,
      room,
      source: 'published',
    });

    expect(oldRuntimeDisposed).toBe(true);
    expect(preparation).not.toBeNull();
    expect(preparation?.loadedRoom).toBeNull();
    expect(harness.pendingFullRoomPreparationsById.get(room.id)).toBe(preparation);
    expect(harness.pendingFullRoomTeardownsById.has(room.id)).toBe(false);
    expect(harness.loadedFullRoomsById.has(room.id)).toBe(false);
    expect(ensurePlayerTerrainColliders).toHaveBeenCalledOnce();
    expect(harness.roomArtifactCache.touch).not.toHaveBeenCalled();
    expect(harness.queuePreparedCustomTiles).toHaveBeenCalledWith(preparation);
  });

  it('never reinserts a force-disposed old runtime when replacement activation fails', () => {
    const roomV1 = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const roomV2 = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    roomV2.version = roomV1.version + 1;
    roomV2.updatedAt = `${roomV1.updatedAt}:v2`;
    const oldRoom = createLoadedRoomRuntime(roomV1);
    const newRoom = createLoadedRoomRuntime(roomV2);
    setPreparedRoomDormant(newRoom);
    const harness = createStreamingHarness(oldRoom, {
      currentCoordinates: roomV2.coordinates,
    });
    const failure = new Error('injected new-runtime activation failure');
    const ensurePlayerTerrainColliders = vi.fn();
    Object.assign(harness, {
      isFullRoomPreparationSnapshotCurrent: vi.fn(() => true),
      isLoadedFullRoomCurrent: vi.fn((candidate: typeof oldRoom) => candidate === oldRoom),
      ensurePlayerTerrainColliders,
      isLoadedRoomCollisionInfrastructureReady: vi.fn(
        (candidate: typeof oldRoom | typeof newRoom) => candidate === newRoom,
      ),
      updateFullRoomBackground: vi.fn(() => {
        throw failure;
      }),
      retainPreparedTransitionRoom: vi.fn(),
    });
    const preparation = createPreparedReplacement(harness, roomV2, newRoom, {
      standardActivationRequested: true,
      portalActivationRequested: false,
    });
    harness.pendingFullRoomPreparationsById.set(roomV2.id, preparation);

    callQueueFullRoomTeardown(harness, oldRoom);

    expect(() => callCommitPreparedFullRoom(harness, preparation)).toThrow(failure);

    expect(harness.pendingFullRoomTeardownsById.has(roomV1.id)).toBe(false);
    expect(harness.loadedFullRoomsById.has(roomV1.id)).toBe(false);
    expect(Array.from(harness.loadedFullRoomsById.values())).not.toContain(oldRoom);
    expect(Array.from(harness.loadedFullRoomsById.values())).not.toContain(newRoom);
    expect(oldRoom.collisionReady).toBe(false);
    expect(newRoom.collisionReady).toBe(false);
    expect(preparation.replacementRoom).toBeNull();
    expect(ensurePlayerTerrainColliders).toHaveBeenNthCalledWith(1, oldRoom);
    expect(ensurePlayerTerrainColliders).toHaveBeenNthCalledWith(2, newRoom);
    expect(harness.options.onFullRoomDestroyed).toHaveBeenCalledOnce();
    expect(harness.options.onFullRoomDestroyed).toHaveBeenCalledWith(oldRoom);
    expect(harness.options.onFullRoomReplaced).not.toHaveBeenCalled();
  });

  it('waits for destructive same-ID disposal before committing a prepared replacement', () => {
    const roomV1 = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const roomV2 = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    roomV2.version = roomV1.version + 1;
    roomV2.updatedAt = `${roomV1.updatedAt}:v2`;
    const events: string[] = [];
    const oldRoom = createLoadedRoomRuntime(roomV1, events, 'old');
    const oldResources = getDestroyableOldResources(oldRoom);
    const newRoom = createLoadedRoomRuntime(roomV2, events, 'new');
    const harness = createStreamingHarness(oldRoom, {
      currentCoordinates: { x: 99, y: 99 },
      events,
    });
    const generation = harness.frameWorkCoordinator.beginGeneration(`full-room:${roomV2.id}`);
    const preparation = {
      identity: 'room-v2',
      artifactKey: 'artifact-v2',
      room: roomV2,
      source: 'published',
      generation,
      priority: 'portal-current-destination',
      queuedJob: null,
      activationRequested: true,
      standardActivationRequested: true,
      portalActivationRequested: false,
      phase: 'commit',
      texturePreparation: null,
      textureKey: newRoom.textureKey,
      foregroundTextureKey: newRoom.foregroundTextureKey,
      committedTextureKeys: [],
      loadedRoom: newRoom,
      replacementRoom: null,
      nextTerrainRow: 0,
      nextInsetRow: 0,
      insetBodyCount: 0,
      nextLiveObjectIndex: 0,
      customBackgroundReady: true,
      backgroundPrepared: true,
    };
    Object.assign(harness, {
      isFullRoomPreparationSnapshotCurrent: vi.fn(() => true),
      updateFullRoomBackground: vi.fn(),
      retainPreparedTransitionRoom: vi.fn(),
    });
    harness.options.onFullRoomSetChanged = vi.fn(() => {
      if (harness.loadedFullRoomsById.get(roomV2.id) === newRoom) {
        events.push('new-commit');
      }
    });

    callQueueFullRoomTeardown(harness, oldRoom);
    harness.frameWorkCoordinator.runFrame({ profile: 'reduced', criticalHeadroomMs: 2 });

    const pendingTeardown = harness.pendingFullRoomTeardownsById.get(roomV1.id);
    expect(pendingTeardown?.destructionStarted).toBe(true);
    expect(oldRoom.liveObjects).toHaveLength(0);

    harness.pendingFullRoomPreparationsById.set(roomV2.id, preparation);
    callCommitPreparedFullRoom(harness, preparation);

    expect(preparation.phase).toBe('waiting-for-teardown');
    expect(pendingTeardown?.commitAfterTeardown).toBe(preparation);
    expect(harness.loadedFullRoomsById.get(roomV1.id)).toBe(oldRoom);
    expect(events).not.toContain('new-commit');

    runCoordinatorUntil(
      harness.frameWorkCoordinator,
      () => harness.loadedFullRoomsById.get(roomV2.id) === newRoom,
    );

    expect(harness.pendingFullRoomTeardownsById.has(roomV1.id)).toBe(false);
    expect(harness.pendingFullRoomPreparationsById.has(roomV2.id)).toBe(false);
    expect(harness.loadedFullRoomsById.get(roomV2.id)).toBe(newRoom);
    expect(preparation.phase).toBe('committed');
    expect(newRoom.collisionReady).toBe(true);
    expect(events.at(-1)).toBe('new-commit');
    for (const resource of oldResources) {
      expect(resource.destroy).toHaveBeenCalledOnce();
    }
    const firstNewCommit = events.indexOf('new-commit');
    expect(firstNewCommit).toBeGreaterThan(0);
    expect(events.slice(0, firstNewCommit).filter((event) => event.startsWith('old:')))
      .toHaveLength(oldResources.length);
    expect(harness.options.onFullRoomReplaced).toHaveBeenCalledOnce();
    expect(harness.options.onFullRoomReplaced).toHaveBeenCalledWith(newRoom);
    expect(harness.options.onFullRoomDestroyed).not.toHaveBeenCalled();
    expect(harness.frameWorkCoordinator.getDiagnostics().failedJobs).toBe(0);
  });

  it('cancels a map-owned dormant replacement when its snapshot becomes stale before teardown finalizes', () => {
    const roomV1 = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const roomV2 = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    roomV2.version = roomV1.version + 1;
    roomV2.updatedAt = `${roomV1.updatedAt}:v2`;
    const currentCoordinates = { x: 99, y: 99 };
    const oldRoom = createLoadedRoomRuntime(roomV1);
    const newRoom = createLoadedRoomRuntime(roomV2);
    const newResources = getDestroyableOldResources(newRoom);
    setPreparedRoomDormant(newRoom);
    const harness = createStreamingHarness(oldRoom, { currentCoordinates });
    const isSnapshotCurrent = vi.fn()
      .mockReturnValueOnce(true)
      .mockReturnValue(false);
    Object.assign(harness, {
      isFullRoomPreparationSnapshotCurrent: isSnapshotCurrent,
    });
    const preparation = createPreparedReplacement(harness, roomV2, newRoom, {
      standardActivationRequested: true,
      portalActivationRequested: false,
    });

    callQueueFullRoomTeardown(harness, oldRoom);
    harness.frameWorkCoordinator.runFrame({ profile: 'reduced', criticalHeadroomMs: 2 });
    expect(harness.pendingFullRoomTeardownsById.get(roomV1.id)?.destructionStarted)
      .toBe(true);

    currentCoordinates.x = roomV2.coordinates.x;
    currentCoordinates.y = roomV2.coordinates.y;
    harness.pendingFullRoomPreparationsById.set(roomV2.id, preparation);
    callCommitPreparedFullRoom(harness, preparation);
    const pendingTeardown = harness.pendingFullRoomTeardownsById.get(roomV1.id);
    expect(preparation.phase).toBe('waiting-for-teardown');
    expect(pendingTeardown?.commitAfterTeardown).toBe(preparation);

    runCoordinatorUntil(
      harness.frameWorkCoordinator,
      () => harness.pendingFullRoomTeardownsById.size === 0,
    );
    runCoordinatorUntil(
      harness.frameWorkCoordinator,
      () => harness.frameWorkCoordinator.getDiagnostics().queueDepth === 0,
    );

    expect(isSnapshotCurrent).toHaveBeenCalledTimes(2);
    expect(pendingTeardown?.commitAfterTeardown).toBeNull();
    expect(preparation.phase).toBe('cancelled');
    expect(preparation.loadedRoom).toBeNull();
    expect(harness.pendingFullRoomPreparationsById.has(roomV2.id)).toBe(false);
    expect(harness.pendingFullRoomTeardownsById.has(roomV1.id)).toBe(false);
    expect(harness.loadedFullRoomsById.has(roomV1.id)).toBe(false);
    for (const resource of newResources) {
      expect(resource.destroy).toHaveBeenCalledOnce();
    }
    expect(harness.options.onFullRoomDestroyed).toHaveBeenCalledOnce();
    expect(harness.options.onFullRoomDestroyed).toHaveBeenCalledWith(oldRoom);
    expect(harness.options.onFullRoomReplaced).not.toHaveBeenCalled();
    expect(harness.refreshVisibleRoomsFromCache).toHaveBeenCalledOnce();
  });

  it('settles disposed replacement ownership when portal clear cancels a queued post-teardown commit', () => {
    const roomV1 = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const roomV2 = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    roomV2.version = roomV1.version + 1;
    roomV2.updatedAt = `${roomV1.updatedAt}:v2`;
    const oldRoom = createLoadedRoomRuntime(roomV1);
    const newRoom = createLoadedRoomRuntime(roomV2);
    setPreparedRoomDormant(newRoom);
    const harness = createStreamingHarness(oldRoom, {
      currentCoordinates: { x: 99, y: 99 },
    });
    Object.assign(harness, {
      isFullRoomPreparationSnapshotCurrent: vi.fn(() => true),
      portalPreparationRoomId: roomV2.id,
    });
    const preparation = createPreparedReplacement(harness, roomV2, newRoom, {
      standardActivationRequested: false,
      portalActivationRequested: true,
    });

    // Cross the destructive boundary before either retention or the prepared
    // activation owner exists, then attach the portal-owned replacement.
    callQueueFullRoomTeardown(harness, oldRoom);
    harness.portalPreparationRoomId = null;
    harness.frameWorkCoordinator.runFrame({ profile: 'reduced', criticalHeadroomMs: 2 });
    harness.portalPreparationRoomId = roomV2.id;
    harness.retainedFullRoomIds.add(roomV2.id);
    harness.pendingFullRoomPreparationsById.set(roomV2.id, preparation);
    callCommitPreparedFullRoom(harness, preparation);

    runCoordinatorUntil(
      harness.frameWorkCoordinator,
      () => (
        harness.pendingFullRoomTeardownsById.size === 0
        && preparation.phase === 'commit'
        && preparation.disposedReplacementRoom === oldRoom
      ),
    );

    expect(harness.loadedFullRoomsById.has(roomV2.id)).toBe(false);
    expect(harness.options.onFullRoomDestroyed).not.toHaveBeenCalled();
    expect((preparation.queuedJob as { state: string } | null)?.state).toBe('queued');

    callClearPortalTargetRoomPreparation(harness, roomV2.id);

    expect(preparation.phase).toBe('cancelled');
    expect(preparation.disposedReplacementRoom).toBeNull();
    expect(harness.pendingFullRoomPreparationsById.has(roomV2.id)).toBe(false);
    expect(harness.loadedFullRoomsById.has(roomV2.id)).toBe(false);
    expect(harness.options.onFullRoomDestroyed).toHaveBeenCalledOnce();
    expect(harness.options.onFullRoomDestroyed).toHaveBeenCalledWith(oldRoom);
    expect(harness.options.onFullRoomReplaced).not.toHaveBeenCalled();
    expect(harness.refreshVisibleRoomsFromCache).toHaveBeenCalledOnce();

    runCoordinatorUntil(
      harness.frameWorkCoordinator,
      () => harness.frameWorkCoordinator.getDiagnostics().queueDepth === 0,
    );
    expect(harness.loadedFullRoomsById.has(roomV2.id)).toBe(false);
    expect(harness.options.onFullRoomDestroyed).toHaveBeenCalledOnce();
  });

  it('transfers disposed replacement ownership from superseded v2 to successful v3 activation', () => {
    const roomV1 = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const roomV2 = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const roomV3 = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    roomV2.version = roomV1.version + 1;
    roomV2.updatedAt = `${roomV1.updatedAt}:v2`;
    roomV3.version = roomV2.version + 1;
    roomV3.updatedAt = `${roomV1.updatedAt}:v3`;
    const oldRoom = createLoadedRoomRuntime(roomV1);
    const v2Room = createLoadedRoomRuntime(roomV2);
    const v3Room = createLoadedRoomRuntime(roomV3);
    setPreparedRoomDormant(v2Room);
    setPreparedRoomDormant(v3Room);
    const harness = createStreamingHarness(oldRoom, {
      currentCoordinates: { x: 99, y: 99 },
    });
    Object.assign(harness, {
      isFullRoomPreparationSnapshotCurrent: vi.fn(() => true),
      buildFullRoomPreparationIdentity: vi.fn(
        (room: typeof roomV1) => `${room.id}:v${room.version}`,
      ),
      buildFullRoomArtifactKey: vi.fn(
        (room: typeof roomV1) => `artifact:${room.id}:v${room.version}`,
      ),
      buildScopedRoomTextureKey: vi.fn(
        (room: typeof roomV1, options: { includedLayers?: string[] }) =>
          `${room.id}:v${room.version}:${options.includedLayers?.join('-') ?? 'all'}`,
      ),
      queuePreparedCustomTiles: vi.fn(),
      updateFullRoomBackground: vi.fn(),
      retainPreparedTransitionRoom: vi.fn(),
    });
    harness.options.scene.textures.exists = vi.fn(() => true);
    const v2Preparation = createPreparedReplacement(harness, roomV2, v2Room, {
      standardActivationRequested: true,
      portalActivationRequested: false,
    });

    callQueueFullRoomTeardown(harness, oldRoom);
    harness.frameWorkCoordinator.runFrame({ profile: 'reduced', criticalHeadroomMs: 2 });
    harness.pendingFullRoomPreparationsById.set(roomV2.id, v2Preparation);
    callCommitPreparedFullRoom(harness, v2Preparation);

    runCoordinatorUntil(
      harness.frameWorkCoordinator,
      () => (
        harness.pendingFullRoomTeardownsById.size === 0
        && v2Preparation.phase === 'commit'
        && v2Preparation.disposedReplacementRoom === oldRoom
      ),
    );
    expect((v2Preparation.queuedJob as { state: string } | null)?.state).toBe('queued');
    expect(harness.options.onFullRoomDestroyed).not.toHaveBeenCalled();

    const v3Preparation = callBeginFullRoomPreparation(harness, {
      id: roomV3.id,
      coordinates: roomV3.coordinates,
      room: roomV3,
      source: 'published',
    }) as ReturnType<typeof createPreparedReplacement> | null;

    expect(v3Preparation).not.toBeNull();
    expect(v2Preparation.phase).toBe('cancelled');
    expect(v2Preparation.disposedReplacementRoom).toBeNull();
    expect(v3Preparation?.disposedReplacementRoom).toBe(oldRoom);
    expect(harness.pendingFullRoomPreparationsById.get(roomV3.id)).toBe(v3Preparation);
    expect(harness.loadedFullRoomsById.has(roomV3.id)).toBe(false);

    if (!v3Preparation) throw new Error('Expected v3 preparation.');
    v3Preparation.loadedRoom = v3Room;
    v3Preparation.textureKey = v3Room.textureKey;
    v3Preparation.foregroundTextureKey = v3Room.foregroundTextureKey;
    v3Preparation.backgroundPrepared = true;
    v3Preparation.phase = 'commit';
    callCommitPreparedFullRoom(harness, v3Preparation);

    expect(harness.loadedFullRoomsById.get(roomV3.id)).toBe(v3Room);
    expect(v3Preparation.phase).toBe('committed');
    expect(v3Preparation.disposedReplacementRoom).toBeNull();
    expect(harness.options.onFullRoomReplaced).toHaveBeenCalledOnce();
    expect(harness.options.onFullRoomReplaced).toHaveBeenCalledWith(v3Room);
    expect(harness.options.onFullRoomDestroyed).not.toHaveBeenCalled();
    expect(harness.refreshVisibleRoomsFromCache).not.toHaveBeenCalled();
  });

  it('detaches a waiting commit when its only portal activation owner clears', () => {
    const roomV1 = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const roomV2 = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    roomV2.version = roomV1.version + 1;
    roomV2.updatedAt = `${roomV1.updatedAt}:v2`;
    const oldRoom = createLoadedRoomRuntime(roomV1);
    const newRoom = createLoadedRoomRuntime(roomV2);
    setPreparedRoomDormant(newRoom);
    const harness = createStreamingHarness(oldRoom, {
      currentCoordinates: { x: 99, y: 99 },
    });
    Object.assign(harness, {
      isFullRoomPreparationSnapshotCurrent: vi.fn(() => true),
      predictedPreparationIntentGeneration: 4,
    });

    callQueueFullRoomTeardown(harness, oldRoom);
    // Prediction ownership must arrive after teardown has become destructive;
    // otherwise ordinary retention correctly reverses the queued teardown.
    harness.frameWorkCoordinator.runFrame({ profile: 'reduced', criticalHeadroomMs: 2 });
    harness.predictedPreparationRoomId = roomV2.id;
    harness.predictedPreparationCoordinates = roomV2.coordinates;
    harness.portalPreparationRoomId = roomV2.id;

    const preparation = createPreparedReplacement(harness, roomV2, newRoom, {
      standardActivationRequested: false,
      portalActivationRequested: true,
    });
    harness.pendingFullRoomPreparationsById.set(roomV2.id, preparation);
    callCommitPreparedFullRoom(harness, preparation);

    const pendingTeardown = harness.pendingFullRoomTeardownsById.get(roomV2.id);
    expect(preparation.phase).toBe('waiting-for-teardown');
    expect(pendingTeardown?.commitAfterTeardown).toBe(preparation);

    callClearPortalTargetRoomPreparation(harness, roomV2.id);

    expect(harness.portalPreparationRoomId).toBeNull();
    expect(harness.predictedPreparationRoomId).toBe(roomV2.id);
    expect(preparation.portalActivationRequested).toBe(false);
    expect(preparation.standardActivationRequested).toBe(false);
    expect(preparation.activationRequested).toBe(false);
    expect(preparation.phase).toBe('ready');
    expect(pendingTeardown?.commitAfterTeardown).toBeNull();

    runCoordinatorUntil(
      harness.frameWorkCoordinator,
      () => harness.pendingFullRoomTeardownsById.size === 0,
    );
    runCoordinatorUntil(
      harness.frameWorkCoordinator,
      () => harness.frameWorkCoordinator.getDiagnostics().queueDepth === 0,
    );

    expect(harness.loadedFullRoomsById.has(roomV2.id)).toBe(false);
    expect(harness.pendingFullRoomPreparationsById.get(roomV2.id)).toBe(preparation);
    expect(preparation.phase).toBe('ready');
    expect(newRoom.collisionReady).toBe(false);
    expect(newRoom.image.active).toBe(false);
    expect(newRoom.terrainLayer.active).toBe(false);
    expect(harness.options.onFullRoomReplaced).not.toHaveBeenCalled();
    expect(harness.options.onFullRoomDestroyed).toHaveBeenCalledOnce();
    expect(harness.options.onFullRoomDestroyed).toHaveBeenCalledWith(oldRoom);
  });

  it('clears a failed deferred replacement and refreshes its disposed current room', () => {
    const roomV1 = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const roomV2 = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    roomV2.version = roomV1.version + 1;
    roomV2.updatedAt = `${roomV1.updatedAt}:v2`;
    const currentCoordinates = { x: 99, y: 99 };
    const oldRoom = createLoadedRoomRuntime(roomV1);
    const newRoom = createLoadedRoomRuntime(roomV2);
    setPreparedRoomDormant(newRoom);
    const harness = createStreamingHarness(oldRoom, { currentCoordinates });
    const failure = new Error('injected deferred activation failure');
    Object.assign(harness, {
      isFullRoomPreparationSnapshotCurrent: vi.fn(() => true),
      updateFullRoomBackground: vi.fn(() => {
        throw failure;
      }),
      retainPreparedTransitionRoom: vi.fn(),
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      callQueueFullRoomTeardown(harness, oldRoom);
      harness.frameWorkCoordinator.runFrame({ profile: 'reduced', criticalHeadroomMs: 2 });
      expect(harness.pendingFullRoomTeardownsById.get(roomV1.id)?.destructionStarted)
        .toBe(true);

      currentCoordinates.x = roomV2.coordinates.x;
      currentCoordinates.y = roomV2.coordinates.y;
      const preparation = createPreparedReplacement(harness, roomV2, newRoom, {
        standardActivationRequested: true,
        portalActivationRequested: false,
      });
      harness.pendingFullRoomPreparationsById.set(roomV2.id, preparation);
      callCommitPreparedFullRoom(harness, preparation);
      expect(preparation.phase).toBe('waiting-for-teardown');

      runCoordinatorUntil(
        harness.frameWorkCoordinator,
        () => harness.frameWorkCoordinator.getDiagnostics().failedJobs === 1,
      );

      expect(harness.pendingFullRoomTeardownsById.has(roomV1.id)).toBe(false);
      expect(harness.pendingFullRoomPreparationsById.has(roomV2.id)).toBe(false);
      expect(harness.loadedFullRoomsById.has(roomV2.id)).toBe(false);
      expect(preparation.loadedRoom).toBeNull();
      expect(preparation.disposedReplacementRoom).toBeNull();
      expect(harness.options.onFullRoomDestroyed).toHaveBeenCalledOnce();
      expect(harness.options.onFullRoomDestroyed).toHaveBeenCalledWith(oldRoom);
      expect(harness.options.onFullRoomReplaced).not.toHaveBeenCalled();
      expect(harness.refreshVisibleRoomsFromCache).toHaveBeenCalledOnce();
      expect(harness.frameWorkCoordinator.getDiagnostics().failedJobs).toBe(1);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('force-disposes a queued teardown when restoring its suspended runtime throws', () => {
    const room = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const loadedRoom = createLoadedRoomRuntime(room);
    const harness = createStreamingHarness(loadedRoom, {
      currentCoordinates: { x: 99, y: 99 },
    });
    const failure = new Error('injected restoreRuntime failure');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      callQueueFullRoomTeardown(harness, loadedRoom);
      const pending = harness.pendingFullRoomTeardownsById.get(room.id);
      expect(pending?.destructionStarted).toBe(false);
      if (pending) {
        pending.restoreRuntime = () => {
          throw failure;
        };
      }

      const restoredCoordinates = callCancelPendingFullRoomTeardown(harness, room.id);

      expect(restoredCoordinates).toEqual(room.coordinates);
      expect(harness.pendingFullRoomTeardownsById.has(room.id)).toBe(false);
      expect(harness.loadedFullRoomsById.has(room.id)).toBe(false);
      expect(harness.fullRoomReleaseAtById.has(room.id)).toBe(false);
      expect(loadedRoom.collisionReady).toBe(false);
      expect(harness.options.onFullRoomDestroyed).toHaveBeenCalledOnce();
      expect(harness.options.onFullRoomDestroyed).toHaveBeenCalledWith(loadedRoom);
      expect(harness.refreshVisibleRoomsFromCache).toHaveBeenCalledOnce();

      runCoordinatorUntil(
        harness.frameWorkCoordinator,
        () => harness.frameWorkCoordinator.getDiagnostics().queueDepth === 0,
      );
      expect(harness.pendingFullRoomTeardownsById.size).toBe(0);
      expect(harness.loadedFullRoomsById.size).toBe(0);
    } finally {
      consoleError.mockRestore();
    }
  });

  it.each([
    'terrain-collider-creation-throws',
    'collision-infrastructure-remains-unready',
  ] as const)(
    'force-disposes after runtime restoration when %s',
    (failurePoint) => {
      const room = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
      const loadedRoom = createLoadedRoomRuntime(room);
      const harness = createStreamingHarness(loadedRoom, {
        currentCoordinates: room.coordinates,
      });
      const readinessFailure = new Error('injected terrain collider restoration failure');
      const ensurePlayerTerrainColliders = failurePoint === 'terrain-collider-creation-throws'
        ? vi.fn(() => {
            throw readinessFailure;
          })
        : vi.fn();
      const isLoadedRoomCollisionInfrastructureReady = vi.fn(
        () => failurePoint !== 'collision-infrastructure-remains-unready',
      );
      Object.assign(harness, {
        ensurePlayerTerrainColliders,
        isLoadedRoomCollisionInfrastructureReady,
      });
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        callQueueFullRoomTeardown(harness, loadedRoom);
        const pending = harness.pendingFullRoomTeardownsById.get(room.id);
        expect(pending?.destructionStarted).toBe(false);
        expect(loadedRoom.runtimeSuspended).toBe(true);

        const restoredCoordinates = callCancelPendingFullRoomTeardown(harness, room.id);

        expect(restoredCoordinates).toEqual(room.coordinates);
        expect(harness.options.setLiveObjectsDormant).toHaveBeenNthCalledWith(
          1,
          loadedRoom,
          true,
        );
        expect(harness.options.setLiveObjectsDormant).toHaveBeenNthCalledWith(
          2,
          loadedRoom,
          false,
        );
        expect(pending?.restoreRuntime).toBeNull();
        expect(ensurePlayerTerrainColliders).toHaveBeenCalledWith(loadedRoom);
        if (failurePoint === 'terrain-collider-creation-throws') {
          expect(isLoadedRoomCollisionInfrastructureReady).not.toHaveBeenCalled();
        } else {
          expect(isLoadedRoomCollisionInfrastructureReady).toHaveBeenCalledWith(loadedRoom);
        }
        expect(loadedRoom.collisionReady).toBe(false);
        expect(harness.pendingFullRoomTeardownsById.has(room.id)).toBe(false);
        expect(harness.loadedFullRoomsById.has(room.id)).toBe(false);
        expect(harness.fullRoomReleaseAtById.has(room.id)).toBe(false);
        expect(harness.options.onFullRoomDestroyed).toHaveBeenCalledOnce();
        expect(harness.options.onFullRoomDestroyed).toHaveBeenCalledWith(loadedRoom);
        expect(harness.refreshVisibleRoomsFromCache).toHaveBeenCalledOnce();

        runCoordinatorUntil(
          harness.frameWorkCoordinator,
          () => harness.frameWorkCoordinator.getDiagnostics().queueDepth === 0,
        );
        expect(harness.pendingFullRoomTeardownsById.size).toBe(0);
        expect(harness.loadedFullRoomsById.size).toBe(0);
      } finally {
        consoleError.mockRestore();
      }
    },
  );

  it('force-disposes when a display mutation throws midway through suspension', () => {
    const room = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const loadedRoom = createLoadedRoomRuntime(room);
    const resources = getDestroyableOldResources(loadedRoom);
    const harness = createStreamingHarness(loadedRoom, {
      currentCoordinates: { x: 99, y: 99 },
    });
    const failure = new Error('injected display suspension failure');
    loadedRoom.backgroundSprites[0].sprite.setVisible = vi.fn(() => {
      throw failure;
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      callQueueFullRoomTeardown(harness, loadedRoom);

      expect(loadedRoom.collisionReady).toBe(false);
      expect(harness.pendingFullRoomTeardownsById.has(room.id)).toBe(false);
      expect(harness.loadedFullRoomsById.has(room.id)).toBe(false);
      expect(Array.from(harness.loadedFullRoomsById.values())).not.toContain(loadedRoom);
      expect(harness.options.onFullRoomDestroyed).toHaveBeenCalledOnce();
      expect(harness.options.onFullRoomDestroyed).toHaveBeenCalledWith(loadedRoom);
      for (const resource of resources) {
        expect(resource.destroy).toHaveBeenCalledOnce();
      }

      runCoordinatorUntil(
        harness.frameWorkCoordinator,
        () => harness.frameWorkCoordinator.getDiagnostics().queueDepth === 0,
      );
      expect(harness.pendingFullRoomTeardownsById.size).toBe(0);
      expect(harness.loadedFullRoomsById.size).toBe(0);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('force-disposes when live-object suspension throws', () => {
    const room = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const loadedRoom = createLoadedRoomRuntime(room);
    const resources = getDestroyableOldResources(loadedRoom);
    const harness = createStreamingHarness(loadedRoom, {
      currentCoordinates: { x: 99, y: 99 },
    });
    const failure = new Error('injected live-object suspension failure');
    harness.options.setLiveObjectsDormant.mockImplementation((
      candidate: typeof loadedRoom,
      dormant: boolean,
    ) => {
      expect(candidate).toBe(loadedRoom);
      if (dormant) throw failure;
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      callQueueFullRoomTeardown(harness, loadedRoom);

      expect(harness.options.setLiveObjectsDormant).toHaveBeenCalledWith(loadedRoom, true);
      expect(harness.options.setLiveObjectWorldCollisionTargetDormant).not.toHaveBeenCalled();
      expect(loadedRoom.collisionReady).toBe(false);
      expect(harness.pendingFullRoomTeardownsById.has(room.id)).toBe(false);
      expect(harness.loadedFullRoomsById.has(room.id)).toBe(false);
      expect(Array.from(harness.loadedFullRoomsById.values())).not.toContain(loadedRoom);
      expect(harness.options.onFullRoomDestroyed).toHaveBeenCalledOnce();
      expect(harness.options.onFullRoomDestroyed).toHaveBeenCalledWith(loadedRoom);
      for (const resource of resources) {
        expect(resource.destroy).toHaveBeenCalledOnce();
      }

      runCoordinatorUntil(
        harness.frameWorkCoordinator,
        () => harness.frameWorkCoordinator.getDiagnostics().queueDepth === 0,
      );
      expect(harness.pendingFullRoomTeardownsById.size).toBe(0);
      expect(harness.loadedFullRoomsById.size).toBe(0);
    } finally {
      consoleError.mockRestore();
    }
  });

  it.each(['detach', 'destroy'] as const)(
    'continues inset cleanup after a child %s failure',
    (failurePoint) => {
      const room = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
      const loadedRoom = createLoadedRoomRuntime(room);
      const insetBodies = loadedRoom.terrainInsetBodies;
      const children = insetBodies.getChildren();
      children.push(
        createDisplayObject('inset-sibling-2', []),
        createDisplayObject('inset-sibling-3', []),
      );
      const originalChildren = [...children];
      const failure = new Error(`injected inset child ${failurePoint} failure`);
      insetBodies.remove.mockImplementation((
        child: (typeof originalChildren)[number],
        _removeFromScene: boolean,
        _destroy: boolean,
      ) => {
        if (failurePoint === 'detach' && child === originalChildren[0]) {
          throw failure;
        }
        const index = children.indexOf(child);
        if (index >= 0) children.splice(index, 1);
      });
      if (failurePoint === 'destroy') {
        originalChildren[0].destroy.mockImplementationOnce(() => {
          throw failure;
        });
      }
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        callForceDestroyLoadedRoomInsetBodies(loadedRoom);

        for (const child of originalChildren) {
          expect(insetBodies.remove).toHaveBeenCalledWith(child, false, false);
          expect(child.destroy).toHaveBeenCalledOnce();
        }
        expect(insetBodies.remove).toHaveBeenCalledTimes(originalChildren.length);
        expect(insetBodies.clear).toHaveBeenCalledWith(false, false);
        expect(insetBodies.clear).toHaveBeenCalledOnce();
        expect(insetBodies.destroy).toHaveBeenCalledOnce();
        expect(loadedRoom.terrainInsetBodies).toBeNull();
      } finally {
        consoleError.mockRestore();
      }
    },
  );

  it('reconciles retained-room physics before reopening a seam when earlier teardown work is unresolved', () => {
    const room = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const loadedRoom = createLoadedRoomRuntime(room);
    const harness = createStreamingHarness(loadedRoom, {
      currentCoordinates: room.coordinates,
    });
    const events: string[] = [];
    harness.syncLiveObjectWorldColliders.mockImplementation(() => {
      events.push('reconcile-colliders');
      expect(loadedRoom.collisionReady).toBe(false);
    });
    harness.options.syncLiveObjectInteractions.mockImplementation(() => {
      events.push('reconcile-interactions');
      expect(loadedRoom.collisionReady).toBe(false);
    });
    harness.options.onFullRoomSetChanged.mockImplementation(() => {
      events.push('seam-opened');
      expect(loadedRoom.collisionReady).toBe(true);
    });

    callQueueFullRoomTeardown(harness, loadedRoom);
    harness.fullRoomTeardownReconciliationRequired = true;
    harness.fullRoomTeardownReconciliationGeneration = 7;

    const restoredCoordinates = callCancelPendingFullRoomTeardown(
      harness,
      room.id,
      true,
    );

    expect(restoredCoordinates).toEqual(room.coordinates);
    expect(events).toEqual([
      'reconcile-colliders',
      'reconcile-interactions',
      'seam-opened',
    ]);
    expect(harness.fullRoomTeardownReconciliationRequired).toBe(false);
    expect(harness.pendingFullRoomTeardownReconciliationJob).toBeNull();
    expect(harness.frameWorkCoordinator.getDiagnostics().queueDepth).toBe(0);
  });

  it.each(['world-colliders', 'interactions'] as const)(
    'force-disposes and refreshes a retained room when %s reconciliation throws',
    (failurePoint) => {
      const room = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
      const loadedRoom = createLoadedRoomRuntime(room);
      const harness = createStreamingHarness(loadedRoom, {
        currentCoordinates: room.coordinates,
      });
      const failure = new Error(`injected ${failurePoint} reconciliation failure`);
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      if (failurePoint === 'world-colliders') {
        harness.syncLiveObjectWorldColliders.mockImplementation(() => {
          throw failure;
        });
      } else {
        harness.options.syncLiveObjectInteractions.mockImplementation(() => {
          throw failure;
        });
      }
      harness.options.onFullRoomSetChanged.mockImplementation(() => {
        expect(loadedRoom.collisionReady).toBe(false);
        expect(harness.loadedFullRoomsById.has(room.id)).toBe(false);
        expect(harness.pendingFullRoomTeardownsById.has(room.id)).toBe(false);
      });

      try {
        callQueueFullRoomTeardown(harness, loadedRoom);
        harness.fullRoomTeardownReconciliationRequired = true;
        harness.fullRoomTeardownReconciliationGeneration = 7;

        const restoredCoordinates = callCancelPendingFullRoomTeardown(
          harness,
          room.id,
          true,
        );

        expect(restoredCoordinates).toEqual(room.coordinates);
        expect(loadedRoom.collisionReady).toBe(false);
        expect(harness.loadedFullRoomsById.has(room.id)).toBe(false);
        expect(harness.pendingFullRoomTeardownsById.has(room.id)).toBe(false);
        expect(harness.pendingFullRoomPreparationsById.has(room.id)).toBe(false);
        expect(harness.fullRoomReleaseAtById.has(room.id)).toBe(false);
        expect(harness.options.onFullRoomDestroyed).toHaveBeenCalledOnce();
        expect(harness.options.onFullRoomDestroyed).toHaveBeenCalledWith(loadedRoom);
        expect(harness.refreshVisibleRoomsFromCache).toHaveBeenCalledOnce();
        expect(harness.options.onFullRoomSetChanged).toHaveBeenCalledOnce();
        if (failurePoint === 'world-colliders') {
          expect(harness.options.syncLiveObjectInteractions).not.toHaveBeenCalled();
        } else {
          expect(harness.syncLiveObjectWorldColliders).toHaveBeenCalledOnce();
        }
      } finally {
        consoleError.mockRestore();
      }
    },
  );

  it('does not self-requeue reconciliation while another teardown remains pending', () => {
    const room = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const loadedRoom = createLoadedRoomRuntime(room);
    const harness = createStreamingHarness(loadedRoom, {
      currentCoordinates: { x: 99, y: 99 },
    });
    harness.pendingFullRoomTeardownsById.set(room.id, {
      loadedRoom,
      phase: 'objects',
      destructionStarted: true,
    });

    callQueueFullRoomTeardownReconciliation(harness);
    expect(harness.frameWorkCoordinator.getDiagnostics().queueDepth).toBe(1);

    const result = harness.frameWorkCoordinator.runFrame({
      profile: 'reduced',
      criticalHeadroomMs: 2,
    });

    expect(result.executed.map((job: { label: string }) => job.label)).toEqual([
      'reconcile-full-room-teardowns',
    ]);
    expect(harness.pendingFullRoomTeardownReconciliationJob).toBeNull();
    expect(harness.fullRoomTeardownReconciliationRequired).toBe(true);
    expect(harness.frameWorkCoordinator.getDiagnostics().queueDepth).toBe(0);
    expect(harness.syncLiveObjectWorldColliders).not.toHaveBeenCalled();
    expect(harness.options.syncLiveObjectInteractions).not.toHaveBeenCalled();
  });

  it.each(['objects', 'collision', 'display'] as const)(
    'force-completes an injected %s teardown failure without stranding room state',
    (failurePoint) => {
      const room = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
      const loadedRoom = createLoadedRoomRuntime(room);
      const harness = createStreamingHarness(loadedRoom, {
        currentCoordinates: { x: 99, y: 99 },
      });
      const failure = new Error(`injected ${failurePoint} teardown failure`);
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      if (failurePoint === 'objects') {
        harness.options.destroyLiveObjectsBatch.mockImplementationOnce(() => {
          throw failure;
        });
      } else if (failurePoint === 'collision') {
        harness.options.destroyEdgeWalls.mockImplementationOnce(() => {
          throw failure;
        });
      } else {
        loadedRoom.image.destroy.mockImplementationOnce(() => {
          throw failure;
        });
      }

      try {
        callQueueFullRoomTeardown(harness, loadedRoom);
        runCoordinatorUntil(
          harness.frameWorkCoordinator,
          () => harness.frameWorkCoordinator.getDiagnostics().failedJobs === 1,
        );

        expect(harness.pendingFullRoomTeardownsById.has(room.id)).toBe(false);
        expect(harness.loadedFullRoomsById.has(room.id)).toBe(false);
        expect(harness.fullRoomReleaseAtById.has(room.id)).toBe(false);
        expect(harness.options.onFullRoomDestroyed).toHaveBeenCalledWith(loadedRoom);
        expect(harness.frameWorkCoordinator.getDiagnostics().failedJobs).toBe(1);

        runCoordinatorUntil(
          harness.frameWorkCoordinator,
          () => harness.frameWorkCoordinator.getDiagnostics().queueDepth === 0,
        );
        expect(harness.pendingFullRoomTeardownsById.size).toBe(0);
        expect(harness.loadedFullRoomsById.size).toBe(0);
      } finally {
        consoleError.mockRestore();
      }
    },
  );
});

function createStreamingHarness(
  loadedRoom: ReturnType<typeof createLoadedRoomRuntime>,
  input: {
    currentCoordinates: { x: number; y: number };
    collider?: ReturnType<typeof vi.fn>;
    events?: string[];
  },
) {
  const loadedFullRoomsById = new Map([[loadedRoom.room.id, loadedRoom]]);
  const frameWorkCoordinator = new FrameWorkCoordinator();
  const collider = input.collider ?? vi.fn(() => createCollider());
  const syncLiveObjectWorldColliders = vi.fn();
  const destroyLiveObjects = vi.fn((targetRoom: typeof loadedRoom) => {
    for (const liveObject of targetRoom.liveObjects) liveObject.destroy();
    targetRoom.liveObjects = [];
  });
  const destroyLiveObjectsBatch = vi.fn((
    targetRoom: typeof loadedRoom,
    maxObjectCount: number,
  ) => {
    const objects = targetRoom.liveObjects.splice(0, maxObjectCount);
    for (const liveObject of objects) liveObject.destroy();
    return targetRoom.liveObjects.length === 0;
  });
  const destroyEdgeWalls = vi.fn((targetRoom: typeof loadedRoom) => {
    for (const edgeWall of targetRoom.edgeWalls) edgeWall.destroy();
    targetRoom.edgeWalls = [];
  });
  return Object.assign(
    Object.create(OverworldWorldStreamingController.prototype),
    {
      destroyed: false,
      loadedFullRoomsById,
      pendingFullRoomPreparationsById: new Map<string, object>(),
      pendingFullRoomTeardownsById: new Map<string, object>(),
      pendingFullRoomTeardownReconciliationJob: null,
      fullRoomTeardownReconciliationRequired: false,
      fullRoomTeardownReconciliationGeneration: null,
      retainedFullRoomIds: new Set<string>(),
      predictedPreparationRoomId: null,
      predictedPreparationCoordinates: null,
      predictedPreparationIntentGeneration: 0,
      portalPreparationRoomId: null,
      playableRoomSnapshotRequestsById: new Map<string, Promise<unknown>>(),
      playableRoomSnapshotRequestIntentGenerationById: new Map<string, number>(),
      playableRoomSnapshotPreparationRequestsById: new Map<string, object>(),
      playableRoomSnapshotRetryAtById: new Map<string, number>(),
      fullRoomReleaseAtById: new Map<string, number>(),
      frameWorkCoordinator,
      roomArtifactCache: {
        has: vi.fn(() => false),
        touch: vi.fn(),
        referencesResource: vi.fn(() => false),
      },
      roomArtifactCacheProfile: 'normal',
      previewRenderer: { syncPreviewVisibility: vi.fn() },
      syncRoomArtifactCachePolicy: vi.fn(),
      releaseRoomArtifactResources: vi.fn(),
      syncLiveObjectWorldColliders,
      refreshVisibleRoomsFromCache: vi.fn(),
      options: {
        scene: {
          physics: { add: { collider } },
          cameras: { main: {} },
          textures: { exists: vi.fn(() => false), remove: vi.fn() },
        },
        getMode: () => 'play',
        getCurrentRoomCoordinates: () => input.currentCoordinates,
        getPlayer: () => ({ id: 'player' }),
        getLiveObjectPhysicsReconciliationGeneration: () => 7,
        setLiveObjectsDormant: vi.fn(),
        setLiveObjectWorldCollisionTargetDormant: vi.fn(),
        destroyLiveObjects,
        destroyLiveObjectsBatch,
        destroyEdgeWalls,
        syncLiveObjectInteractions: vi.fn(),
        onFullRoomDestroyed: vi.fn(),
        onFullRoomReplaced: vi.fn(),
        onFullRoomSetChanged: vi.fn(),
        onBackdropObjectsChanged: vi.fn(),
      },
    },
  );
}

function createLoadedRoomRuntime(
  room: ReturnType<typeof createDefaultRoomSnapshot>,
  events: string[] = [],
  eventPrefix = room.id,
) {
  const insetZone = createDisplayObject(`${eventPrefix}:inset-zone`, events);
  const insetChildren = [insetZone];
  const terrainInsetBodies = {
    children: {
      iterate: vi.fn((callback: (child: typeof insetZone) => unknown) => {
        for (const child of insetChildren) callback(child);
      }),
    },
    getChildren: vi.fn(() => insetChildren),
    getLength: vi.fn(() => insetChildren.length),
    remove: vi.fn((child: typeof insetZone, _removeFromScene: boolean, destroy: boolean) => {
      const index = insetChildren.indexOf(child);
      if (index >= 0) insetChildren.splice(index, 1);
      if (destroy) child.destroy();
    }),
    clear: vi.fn((_removeFromScene: boolean, destroy: boolean) => {
      if (destroy) {
        for (const child of insetChildren.splice(0)) child.destroy();
      } else {
        insetChildren.length = 0;
      }
    }),
    destroy: createDestroySpy(`${eventPrefix}:inset-group`, events),
  };
  return {
    room,
    source: 'published' as const,
    collisionReady: true,
    runtimeSuspended: false,
    staticLighting: { emitters: [], objectCount: 0, tileCount: 0 },
    backgroundColorRect: createDisplayObject(`${eventPrefix}:background-color`, events),
    backgroundSprites: [
      {
        sprite: createDisplayObject(`${eventPrefix}:background-1`, events),
        parallax: 0,
        tileScale: 1,
        useVerticalParallax: false,
      },
      {
        sprite: createDisplayObject(`${eventPrefix}:background-2`, events),
        parallax: 0,
        tileScale: 1,
        useVerticalParallax: false,
      },
    ],
    image: createDisplayObject(`${eventPrefix}:image`, events),
    textureKey: `${eventPrefix}:terrain-texture`,
    foregroundImage: createDisplayObject(`${eventPrefix}:foreground`, events),
    foregroundTextureKey: `${eventPrefix}:foreground-texture`,
    map: { destroy: createDestroySpy(`${eventPrefix}:map`, events) },
    terrainLayer: createDisplayObject(`${eventPrefix}:terrain-layer`, events),
    terrainCollider: createCollider(`${eventPrefix}:terrain-collider`, events),
    terrainInsetBodies,
    terrainInsetCollider: createCollider(`${eventPrefix}:inset-collider`, events),
    edgeWalls: [{ destroy: createDestroySpy(`${eventPrefix}:edge-wall`, events) }],
    liveObjects: [{ destroy: createDestroySpy(`${eventPrefix}:live-object`, events) }],
    artifactKey: `${eventPrefix}:artifact`,
    customRoomTileTextureKey: `${eventPrefix}:custom-tiles`,
  };
}

function createPreparedReplacement(
  harness: { frameWorkCoordinator: FrameWorkCoordinator },
  room: ReturnType<typeof createDefaultRoomSnapshot>,
  loadedRoom: ReturnType<typeof createLoadedRoomRuntime>,
  owners: {
    standardActivationRequested: boolean;
    portalActivationRequested: boolean;
  },
) {
  return {
    identity: `${room.id}:v${room.version}`,
    artifactKey: `prepared:${room.id}:v${room.version}`,
    room,
    source: 'published' as const,
    generation: harness.frameWorkCoordinator.beginGeneration(`full-room:${room.id}`),
    priority: 'portal-current-destination' as const,
    queuedJob: null,
    activationRequested:
      owners.standardActivationRequested || owners.portalActivationRequested,
    standardActivationRequested: owners.standardActivationRequested,
    portalActivationRequested: owners.portalActivationRequested,
    phase: 'commit',
    texturePreparation: null,
    textureKey: loadedRoom.textureKey,
    foregroundTextureKey: loadedRoom.foregroundTextureKey,
    committedTextureKeys: [] as string[],
    loadedRoom,
    replacementRoom: null,
    disposedReplacementRoom: null,
    nextTerrainRow: 0,
    nextInsetRow: 0,
    insetBodyCount: 0,
    nextLiveObjectIndex: 0,
    customBackgroundReady: true,
    backgroundPrepared: true,
  };
}

function setPreparedRoomDormant(
  loadedRoom: ReturnType<typeof createLoadedRoomRuntime>,
): void {
  loadedRoom.collisionReady = false;
  const displayObjects = [
    loadedRoom.backgroundColorRect,
    ...loadedRoom.backgroundSprites.map((background) => background.sprite),
    loadedRoom.image,
    loadedRoom.foregroundImage,
    loadedRoom.terrainLayer,
  ];
  for (const displayObject of displayObjects) {
    displayObject.setActive(false);
    displayObject.setVisible(false);
  }
}

function createDisplayObject(label: string, events: string[]) {
  return {
    scene: {},
    active: true,
    visible: true,
    body: { enable: true },
    setActive(active: boolean) {
      this.active = active;
      return this;
    },
    setVisible(visible: boolean) {
      this.visible = visible;
      return this;
    },
    destroy: createDestroySpy(label, events),
  };
}

function createCollider(label = 'collider', events: string[] = []) {
  return {
    active: true,
    destroy: createDestroySpy(label, events),
  };
}

function createDestroySpy(label: string, events: string[]) {
  return vi.fn(() => {
    events.push(label);
  });
}

function getDestroyableOldResources(
  room: ReturnType<typeof createLoadedRoomRuntime>,
) {
  return [
    ...room.liveObjects,
    ...room.edgeWalls,
    room.terrainCollider,
    room.terrainInsetCollider,
    ...room.terrainInsetBodies.getChildren(),
    room.terrainInsetBodies,
    room.terrainLayer,
    room.map,
    room.backgroundColorRect,
    ...room.backgroundSprites.map((background) => background.sprite),
    room.image,
    room.foregroundImage,
  ];
}

function callQueueFullRoomTeardown(harness: object, loadedRoom: object): void {
  const method = (
    OverworldWorldStreamingController.prototype as unknown as {
      queueFullRoomTeardown(room: object): unknown;
    }
  ).queueFullRoomTeardown;
  method.call(harness, loadedRoom);
}

function callSyncPlayFullRooms(
  harness: object,
  rooms: Map<string, unknown>,
  roomIds: Set<string>,
): void {
  const method = (
    OverworldWorldStreamingController.prototype as unknown as {
      syncPlayFullRooms(renderableRooms: Map<string, unknown>, ids: Set<string>): void;
    }
  ).syncPlayFullRooms;
  method.call(harness, rooms, roomIds);
}

function callCommitPreparedFullRoom(harness: object, preparation: object): void {
  const method = (
    OverworldWorldStreamingController.prototype as unknown as {
      commitPreparedFullRoom(value: object): void;
    }
  ).commitPreparedFullRoom;
  method.call(harness, preparation);
}

function callBeginFullRoomPreparation(
  harness: object,
  renderableRoom: object,
): { loadedRoom: object | null } | null {
  const method = (
    OverworldWorldStreamingController.prototype as unknown as {
      beginFullRoomPreparation(
        room: object,
        priority: 'portal-current-destination',
        predicted: boolean,
      ): { loadedRoom: object | null } | null;
    }
  ).beginFullRoomPreparation;
  return method.call(
    harness,
    renderableRoom,
    'portal-current-destination',
    false,
  );
}

function callQueueFullRoomTeardownReconciliation(harness: object): void {
  const method = (
    OverworldWorldStreamingController.prototype as unknown as {
      queueFullRoomTeardownReconciliation(): void;
    }
  ).queueFullRoomTeardownReconciliation;
  method.call(harness);
}

function callForceDestroyLoadedRoomInsetBodies(loadedRoom: object): void {
  const method = (
    OverworldWorldStreamingController.prototype as unknown as {
      forceDestroyLoadedRoomInsetBodies(room: object): void;
    }
  ).forceDestroyLoadedRoomInsetBodies;
  method.call(
    Object.create(OverworldWorldStreamingController.prototype),
    loadedRoom,
  );
}

function callClearPortalTargetRoomPreparation(harness: object, roomId: string): void {
  OverworldWorldStreamingController.prototype.clearPortalTargetRoomPreparation.call(
    harness as OverworldWorldStreamingController,
    roomId,
  );
}

function callCancelPendingFullRoomTeardown(
  harness: object,
  roomId: string,
  notifySeams = false,
): { x: number; y: number } | null {
  const method = (
    OverworldWorldStreamingController.prototype as unknown as {
      cancelPendingFullRoomTeardown(
        id: string,
        reason: string,
        restoreCollisionReady: boolean,
        notifySeams: boolean,
      ): { x: number; y: number } | null;
    }
  ).cancelPendingFullRoomTeardown;
  return method.call(harness, roomId, 'test-restore', true, notifySeams);
}

function runCoordinatorUntil(
  coordinator: FrameWorkCoordinator,
  predicate: () => boolean,
): void {
  for (let frame = 0; frame < 40 && !predicate(); frame += 1) {
    coordinator.runFrame({ profile: 'reduced', criticalHeadroomMs: 2 });
  }
  expect(predicate()).toBe(true);
}

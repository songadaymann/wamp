import { describe, expect, it, vi } from 'vitest';
import {
  cloneRoomSnapshot,
  createDefaultRoomSnapshot,
  getRoomSnapshotCloneCount,
  type RoomSnapshot,
  type RoomSnapshotView,
} from '../../persistence/roomModel';
import { OverworldWorldStreamingController } from './worldStreaming';

vi.mock('phaser', () => ({ default: {} }));

type SnapshotHarness = Record<string, unknown>;

describe('world streaming snapshot views', () => {
  it('preserves source precedence without allocating and returns stable identities', () => {
    const coordinates = { x: 5, y: 7 };
    const cached = createSnapshot('cached');
    const loaded = createSnapshot('loaded');
    const optimistic = createSnapshot('optimistic');
    const presence = createSnapshot('presence');
    const draft = createSnapshot('draft');
    const transient = createSnapshot('transient');
    const harness = createHarness({ cached, loaded, optimistic, presence, draft, transient });

    expect(callGetView(harness, coordinates)).toBe(transient);
    expect(callGetView(harness, coordinates)).toBe(transient);

    getMap(harness, 'transientRoomOverridesById').clear();
    expect(callGetView(harness, coordinates)).toBe(draft);
    getMap(harness, 'draftRoomsById').clear();
    expect(callGetView(harness, coordinates)).toBe(presence);
    getMap(harness, 'presencePreviewRoomsById').clear();
    expect(callGetView(harness, coordinates)).toBe(optimistic);
    getMap(harness, 'optimisticPublishedRoomsById').clear();
    expect(callGetView(harness, coordinates)).toBe(loaded);
    getMap(harness, 'loadedFullRoomsById').clear();
    expect(callGetView(harness, coordinates)).toBe(cached);
    expect(callGetView(harness, coordinates)).toBe(cached);
  });

  it('keeps cloning explicit and isolates mutable clones from the cached view', () => {
    const coordinates = { x: 5, y: 7 };
    const cached = createSnapshot('cached');
    cached.tileData.terrain[0][0] = 1;
    const harness = createHarness({ cached });

    const view = callGetView(harness, coordinates);
    expect(callCloneCount(harness)).toBe(0);
    const clone = callClone(harness, coordinates);
    const deprecatedClone = callDeprecatedGetter(harness, coordinates);

    expect(view).toBe(cached);
    expect(clone).not.toBe(view);
    expect(clone?.tileData).not.toBe(view?.tileData);
    expect(deprecatedClone).not.toBe(view);
    expect(deprecatedClone).not.toBe(clone);
    expect(callCloneCount(harness)).toBe(2);

    if (!clone) throw new Error('Expected a cloned snapshot.');
    clone.tileData.terrain[0][0] = 99;
    clone.coordinates.x = 100;
    expect(view?.tileData.terrain[0][0]).toBe(1);
    expect(view?.coordinates.x).toBe(5);
  });

  it('normalizes and owns mutable draft input once at cache ingress', () => {
    const coordinates = { x: 5, y: 7 };
    const input = createSnapshot('  Draft title  ');
    input.tileData.terrain[0][0] = 1;
    const harness = createHarness({});

    OverworldWorldStreamingController.prototype.setDraftRoom.call(harness as never, input);
    const firstView = callGetView(harness, coordinates);
    input.title = 'mutated outside cache';
    input.tileData.terrain[0][0] = 99;
    const secondView = callGetView(harness, coordinates);

    expect(firstView).toBe(secondView);
    expect(firstView?.title).toBe('Draft title');
    expect(firstView?.tileData.terrain[0][0]).toBe(1);
  });

  it('adopts a replacement preview-cache identity without mutating the old view', () => {
    const coordinates = { x: 5, y: 7 };
    const cached = createSnapshot('cached v1');
    const replacement = createSnapshot('cached v2');
    replacement.version = cached.version + 1;
    replacement.updatedAt = `${cached.updatedAt}:v2`;
    const harness = createHarness({ cached });
    const firstView = callGetView(harness, coordinates);
    const getRoomSnapshot = (
      harness.previewCache as { getRoomSnapshot: ReturnType<typeof vi.fn> }
    ).getRoomSnapshot;

    getRoomSnapshot.mockReturnValue(replacement);
    const replacementView = callGetView(harness, coordinates);

    expect(firstView).toBe(cached);
    expect(replacementView).toBe(replacement);
    expect(replacementView).not.toBe(firstView);
    expect(firstView?.title).toBe('cached v1');
    expect(callCloneCount(harness)).toBe(0);
  });

  it('counts direct deep clones outside the streaming getters', () => {
    const harness = createHarness({});

    cloneRoomSnapshot(createSnapshot('direct clone'));

    expect(callCloneCount(harness)).toBe(1);
  });

  it('reuses unchanged presence snapshots across repeated 5 Hz syncs', () => {
    const incoming = createSnapshot('presence v1');
    incoming.tileData.terrain[0][0] = 1;
    const refreshVisibleRoomsFromCache = vi.fn();
    const harness = Object.assign(createHarness({}), {
      refreshVisibleRoomsFromCache,
      presencePreviewOwnedBySource: new WeakMap<RoomSnapshot, RoomSnapshot>(),
    });

    OverworldWorldStreamingController.prototype.syncPresencePreviewRooms.call(
      harness as never,
      [incoming],
    );
    const owned = getMap(harness, 'presencePreviewRoomsById').get(incoming.id) as RoomSnapshot;
    expect(owned).not.toBe(incoming);
    const cloneCountAfterIngress = callCloneCount(harness);

    for (let tick = 0; tick < 10; tick += 1) {
      OverworldWorldStreamingController.prototype.syncPresencePreviewRooms.call(
        harness as never,
        [incoming],
      );
    }

    expect(callCloneCount(harness)).toBe(cloneCountAfterIngress);
    expect(getMap(harness, 'presencePreviewRoomsById').get(incoming.id)).toBe(owned);
    expect(refreshVisibleRoomsFromCache).toHaveBeenCalledTimes(1);
  });

  it('owns changed presence ingress without exposing later caller mutation', () => {
    const initial = createSnapshot('presence v1');
    const refreshVisibleRoomsFromCache = vi.fn();
    const harness = Object.assign(createHarness({}), {
      refreshVisibleRoomsFromCache,
      presencePreviewOwnedBySource: new WeakMap<RoomSnapshot, RoomSnapshot>(),
    });
    OverworldWorldStreamingController.prototype.syncPresencePreviewRooms.call(
      harness as never,
      [initial],
    );
    const changed = JSON.parse(JSON.stringify(initial)) as RoomSnapshot;
    changed.title = 'presence content changed';
    changed.tileData.terrain[0][0] = 7;
    const cloneCountBeforeChange = callCloneCount(harness);

    OverworldWorldStreamingController.prototype.syncPresencePreviewRooms.call(
      harness as never,
      [changed],
    );
    const owned = getMap(harness, 'presencePreviewRoomsById').get(initial.id) as RoomSnapshot;
    changed.title = 'mutated after sync';
    changed.tileData.terrain[0][0] = 99;

    expect(callCloneCount(harness)).toBe(cloneCountBeforeChange + 1);
    expect(owned).not.toBe(changed);
    expect(owned.title).toBe('presence content changed');
    expect(owned.tileData.terrain[0][0]).toBe(7);
    expect(refreshVisibleRoomsFromCache).toHaveBeenCalledTimes(2);
  });

  it('passes cache-owned snapshots through repeated visible candidate collection', () => {
    const draft = createSnapshotAt('draft', 5, 7);
    const transient = createSnapshotAt('transient', 6, 7);
    const presence = createSnapshotAt('presence', 7, 7);
    const optimistic = createSnapshotAt('optimistic', 8, 7);
    const harness = Object.assign(createHarness({}), {
      loadedRoomBounds: { minX: 0, maxX: 10, minY: 0, maxY: 10 },
      draftRoomsById: new Map([[draft.id, draft]]),
      transientRoomOverridesById: new Map([[transient.id, transient]]),
      presencePreviewRoomsById: new Map([[presence.id, presence]]),
      optimisticPublishedRoomsById: new Map([[optimistic.id, optimistic]]),
      roomSummariesById: new Map(),
    });
    const cloneCountBeforeRefreshes = callCloneCount(harness);

    for (let refresh = 0; refresh < 10; refresh += 1) {
      const candidates = callCollectVisibleRoomCandidates(harness);
      expect(candidates.get(draft.id)?.draft).toBe(draft);
      expect(candidates.get(transient.id)?.draft).toBe(transient);
      expect(candidates.get(presence.id)?.sharedPreview).toBe(presence);
      expect(candidates.get(optimistic.id)?.draft).toBe(optimistic);
    }

    expect(callCloneCount(harness)).toBe(cloneCountBeforeRefreshes);
  });
});

function createSnapshot(title: string): RoomSnapshot {
  return createSnapshotAt(title, 5, 7);
}

function createSnapshotAt(title: string, x: number, y: number): RoomSnapshot {
  const room = createDefaultRoomSnapshot(`${x},${y}`, { x, y });
  room.title = title;
  return room;
}

function createHarness(sources: {
  cached?: RoomSnapshot;
  loaded?: RoomSnapshot;
  optimistic?: RoomSnapshot;
  presence?: RoomSnapshot;
  draft?: RoomSnapshot;
  transient?: RoomSnapshot;
}): SnapshotHarness {
  const roomId = '5,7';
  return Object.assign(
    Object.create(OverworldWorldStreamingController.prototype) as SnapshotHarness,
    {
      transientRoomOverridesById: new Map(sources.transient ? [[roomId, sources.transient]] : []),
      draftRoomsById: new Map(sources.draft ? [[roomId, sources.draft]] : []),
      presencePreviewRoomsById: new Map(sources.presence ? [[roomId, sources.presence]] : []),
      optimisticPublishedRoomsById: new Map(sources.optimistic ? [[roomId, sources.optimistic]] : []),
      loadedFullRoomsById: new Map(sources.loaded ? [[roomId, { room: sources.loaded }]] : []),
      previewCache: {
        getRoomSnapshot: vi.fn(() => sources.cached ?? null),
      },
      roomSnapshotCloneCountBaseline: getRoomSnapshotCloneCount(),
      presencePreviewOwnedBySource: new WeakMap<RoomSnapshot, RoomSnapshot>(),
    },
  );
}

function getMap(harness: SnapshotHarness, key: string): Map<string, unknown> {
  return harness[key] as Map<string, unknown>;
}

function callGetView(
  harness: SnapshotHarness,
  coordinates: { x: number; y: number },
): RoomSnapshotView | null {
  return OverworldWorldStreamingController.prototype.getRoomSnapshotViewForCoordinates.call(
    harness as never,
    coordinates,
  );
}

function callClone(
  harness: SnapshotHarness,
  coordinates: { x: number; y: number },
): RoomSnapshot | null {
  return OverworldWorldStreamingController.prototype.cloneRoomSnapshotForCoordinates.call(
    harness as never,
    coordinates,
  );
}

function callDeprecatedGetter(
  harness: SnapshotHarness,
  coordinates: { x: number; y: number },
): RoomSnapshot | null {
  return OverworldWorldStreamingController.prototype.getRoomSnapshotForCoordinates.call(
    harness as never,
    coordinates,
  );
}

function callCloneCount(harness: SnapshotHarness): number {
  return OverworldWorldStreamingController.prototype.getRoomSnapshotCloneCountSinceReset.call(
    harness as never,
  );
}

function callCollectVisibleRoomCandidates(
  harness: SnapshotHarness,
): Map<string, {
  draft: RoomSnapshot | null;
  sharedPreview: RoomSnapshot | null;
}> {
  const prototype = OverworldWorldStreamingController.prototype as unknown as {
    collectVisibleRoomCandidates(): Map<string, {
      draft: RoomSnapshot | null;
      sharedPreview: RoomSnapshot | null;
    }>;
  };
  return prototype.collectVisibleRoomCandidates.call(harness);
}

function assertRoomSnapshotViewIsDeeplyReadonly(view: RoomSnapshotView): void {
  // @ts-expect-error Runtime snapshot coordinates are immutable.
  view.coordinates.x = 1;
  // @ts-expect-error Runtime tile rows are immutable.
  view.tileData.terrain[0][0] = 1;
  // @ts-expect-error Runtime placed-object collections are immutable.
  view.placedObjects.push({});
  // @ts-expect-error Nested placed-object path collections are immutable.
  view.placedObjects[0].linkedTargetInstanceIds?.push('next');
}

void assertRoomSnapshotViewIsDeeplyReadonly;

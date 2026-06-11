import assert from 'node:assert/strict';
import {
  computeWorldChunkWindow,
  createClaimedUnpublishedRoomSummary,
  createPublishedRoomSummary,
} from '../src/persistence/worldModel';
import type { WorldRepository } from '../src/persistence/worldRepository';
import {
  cloneRoomSnapshot,
  createDefaultRoomSnapshot,
  roomIdFromCoordinates,
  type RoomCoordinates,
  type RoomSnapshot,
} from '../src/persistence/roomModel';
import {
  OverworldPreviewCache,
  isStreamingRoomCandidateRenderable,
  type StreamingRoomCandidate,
} from '../src/scenes/overworld/previewCache';
import {
  computeOverworldPreviewSelection,
} from '../src/scenes/overworld/previewStreaming';

class ProbeWorldRepository implements WorldRepository {
  constructor(private readonly publishedRoomsById: Map<string, RoomSnapshot>) {}

  async loadWorldWindow(): Promise<never> {
    throw new Error('loadWorldWindow is not used by this smoke.');
  }

  async loadWorldChunkWindow(): Promise<never> {
    throw new Error('loadWorldChunkWindow is not used by this smoke.');
  }

  async loadPublishedRoom(roomId: string): Promise<RoomSnapshot | null> {
    const room = this.publishedRoomsById.get(roomId) ?? null;
    return room ? cloneRoomSnapshot(room) : null;
  }

  async loadClaimableFrontierWindow(): Promise<never> {
    throw new Error('loadClaimableFrontierWindow is not used by this smoke.');
  }
}

function room(coordinates: RoomCoordinates, options: Partial<RoomSnapshot>): RoomSnapshot {
  const id = roomIdFromCoordinates(coordinates);
  return {
    ...createDefaultRoomSnapshot(id, coordinates),
    ...options,
    id,
    coordinates: { ...coordinates },
  };
}

async function probeChunkPreviewIncludesConstructionDraft(): Promise<void> {
  const draft = room(
    { x: 1, y: 0 },
    {
      title: 'Saved construction draft',
      status: 'draft',
      publishedAt: null,
      version: 7,
    },
  );

  const chunkWindow = computeWorldChunkWindow(
    [
      {
        state: 'claimed_unpublished',
        snapshot: draft,
        claimerUserId: 'builder-1',
        claimerDisplayName: 'Builder One',
      },
    ],
    { minChunkX: 0, maxChunkX: 0, minChunkY: 0, maxChunkY: 0 },
  );

  assert.equal(chunkWindow.chunks.length, 1);
  assert.equal(chunkWindow.chunks[0]?.rooms[0]?.state, 'claimed_unpublished');
  assert.equal(chunkWindow.chunks[0]?.previewRooms[0]?.id, draft.id);
  assert.equal(chunkWindow.chunks[0]?.previewRooms[0]?.status, 'draft');
}

async function probeConstructionSourcePriority(): Promise<void> {
  const coordinates = { x: 2, y: 0 };
  const savedDraft = room(coordinates, {
    title: 'Saved draft',
    status: 'draft',
    publishedAt: null,
    version: 1,
  });
  const livePreview = room(coordinates, {
    title: 'Live preview',
    status: 'draft',
    publishedAt: null,
    version: 2,
  });

  const cache = new OverworldPreviewCache(new ProbeWorldRepository(new Map()));
  cache.setRoomSnapshot(savedDraft);

  const candidates = new Map<string, StreamingRoomCandidate>([
    [
      savedDraft.id,
      {
        id: savedDraft.id,
        coordinates,
        summary: createClaimedUnpublishedRoomSummary({
          state: 'claimed_unpublished',
          snapshot: savedDraft,
          claimerUserId: 'builder-1',
          claimerDisplayName: 'Builder One',
        }),
        draft: null,
        sharedPreview: livePreview,
        allowFullRoomLoad: true,
        source: 'live_construction_preview',
      },
    ],
  ]);

  const renderableRooms = await cache.collectRenderableRooms(
    candidates,
    new Set([savedDraft.id]),
    new Set([savedDraft.id]),
  );
  const renderable = renderableRooms.get(savedDraft.id);
  assert.equal(renderable?.room.title, 'Live preview');
  assert.equal(renderable?.source, 'live_construction_preview');
}

async function probeSavedDraftFallback(): Promise<void> {
  const coordinates = { x: 3, y: 0 };
  const savedDraft = room(coordinates, {
    title: 'Saved fallback',
    status: 'draft',
    publishedAt: null,
    version: 1,
  });

  const cache = new OverworldPreviewCache(new ProbeWorldRepository(new Map()));
  cache.setRoomSnapshot(savedDraft);

  const candidates = new Map<string, StreamingRoomCandidate>([
    [
      savedDraft.id,
      {
        id: savedDraft.id,
        coordinates,
        summary: createClaimedUnpublishedRoomSummary({
          state: 'claimed_unpublished',
          snapshot: savedDraft,
          claimerUserId: 'builder-1',
          claimerDisplayName: 'Builder One',
        }),
        draft: null,
        sharedPreview: null,
        allowFullRoomLoad: true,
        source: 'saved_construction_draft',
      },
    ],
  ]);

  const renderableRooms = await cache.collectRenderableRooms(
    candidates,
    new Set([savedDraft.id]),
    new Set([savedDraft.id]),
  );
  const renderable = renderableRooms.get(savedDraft.id);
  assert.equal(renderable?.room.title, 'Saved fallback');
  assert.equal(renderable?.source, 'saved_construction_draft');
}

async function probeSavedDraftSelectedForPlayFullRoom(): Promise<void> {
  const coordinates = { x: 0, y: 0 };
  const savedDraft = room(coordinates, {
    title: 'Saved playable draft',
    status: 'draft',
    publishedAt: null,
    version: 1,
  });
  const candidate: StreamingRoomCandidate = {
    id: savedDraft.id,
    coordinates,
    summary: createClaimedUnpublishedRoomSummary({
      state: 'claimed_unpublished',
      snapshot: savedDraft,
      claimerUserId: 'builder-1',
      claimerDisplayName: 'Builder One',
    }),
    draft: null,
    sharedPreview: null,
    allowFullRoomLoad: true,
    source: 'saved_construction_draft',
  };
  const selection = computeOverworldPreviewSelection({
    mode: 'play',
    performanceProfile: 'default',
    zoom: 1,
    focusCoordinates: coordinates,
    roomCandidates: [
      {
        id: candidate.id,
        coordinates,
        isRenderable: isStreamingRoomCandidateRenderable(candidate),
        allowFullRoomLoad: candidate.allowFullRoomLoad,
      },
    ],
    visibleRoomBounds: {
      minX: 0,
      maxX: 0,
      minY: 0,
      maxY: 0,
    },
  });

  assert(selection.fullRoomIds.has(savedDraft.id), 'saved construction drafts should full-load in play');
}

async function probePublishedRoomsIgnorePreview(): Promise<void> {
  const coordinates = { x: 4, y: 0 };
  const published = room(coordinates, {
    title: 'Published stable',
    status: 'published',
    publishedAt: new Date(0).toISOString(),
    version: 5,
  });
  const untrustedPreview = room(coordinates, {
    title: 'Untrusted edit preview',
    status: 'draft',
    publishedAt: null,
    version: 6,
  });

  const cache = new OverworldPreviewCache(new ProbeWorldRepository(new Map([[published.id, published]])));
  const candidates = new Map<string, StreamingRoomCandidate>([
    [
      published.id,
      {
        id: published.id,
        coordinates,
        summary: createPublishedRoomSummary({
          state: 'published',
          snapshot: published,
          creatorUserId: 'builder-1',
          creatorDisplayName: 'Builder One',
        }),
        draft: null,
        sharedPreview: untrustedPreview,
        allowFullRoomLoad: true,
        source: 'live_construction_preview',
      },
    ],
  ]);

  const renderableRooms = await cache.collectRenderableRooms(
    candidates,
    new Set([published.id]),
    new Set([published.id]),
  );
  const renderable = renderableRooms.get(published.id);
  assert.equal(renderable?.room.title, 'Published stable');
  assert.equal(renderable?.room.status, 'published');
  assert.equal(renderable?.source, 'published');
}

await probeChunkPreviewIncludesConstructionDraft();
await probeConstructionSourcePriority();
await probeSavedDraftFallback();
await probeSavedDraftSelectedForPlayFullRoom();
await probePublishedRoomsIgnorePreview();

console.log('Live construction play smoke passed.');

import {
  cloneRoomSnapshot,
  type RoomSnapshot,
  type RoomSnapshotQueryDetail,
} from '../../persistence/roomModel';
import type { WorldRepository } from '../../persistence/worldRepository';
import type { WorldChunkWindow, WorldRoomSummary } from '../../persistence/worldModel';
import type { RoomCoordinates } from '../../persistence/roomModel';
import {
  buildSharedRoomSnapshotKey,
  getSharedRoomSnapshot,
  invalidateSharedRoomSnapshots,
  setSharedRoomSnapshot,
} from '../../persistence/sharedRoomSnapshotCache';

export type PlayableRoomSource =
  | 'published'
  | 'local_draft'
  | 'live_construction_preview'
  | 'saved_construction_draft';

export interface StreamingRoomCandidate {
  id: string;
  coordinates: RoomCoordinates;
  summary: WorldRoomSummary | null;
  draft: RoomSnapshot | null;
  sharedPreview: RoomSnapshot | null;
  allowFullRoomLoad: boolean;
  source: PlayableRoomSource;
}

export interface RenderableRoom {
  id: string;
  coordinates: RoomCoordinates;
  room: RoomSnapshot;
  source: PlayableRoomSource;
}

type RoomLoadOwner = 'render' | 'selection';

interface RoomLoadRequest {
  abortController: AbortController;
  lifecycleEpoch: number;
  owners: Set<RoomLoadOwner>;
  promise: Promise<RoomSnapshot | null>;
}

export function isStreamingRoomCandidateRenderable(
  roomCandidate: Pick<StreamingRoomCandidate, 'draft' | 'sharedPreview' | 'summary'>,
): boolean {
  return (
    roomCandidate.draft !== null ||
    roomCandidate.sharedPreview !== null ||
    roomCandidate.summary?.state === 'published' ||
    roomCandidate.summary?.state === 'claimed_unpublished'
  );
}

export class OverworldPreviewCache {
  private roomSnapshotsById = new Map<string, RoomSnapshot>();
  private overviewSnapshotsById = new Map<string, RoomSnapshot>();
  private roomLoadRequestsById = new Map<string, RoomLoadRequest>();
  private lifecycleEpoch = 0;

  constructor(private readonly worldRepository: WorldRepository) {}

  reset(): void {
    this.lifecycleEpoch += 1;
    for (const request of this.roomLoadRequestsById.values()) request.abortController.abort();
    this.roomSnapshotsById = new Map();
    this.overviewSnapshotsById = new Map();
    this.roomLoadRequestsById = new Map();
  }

  getRoomSnapshotsById(): Map<string, RoomSnapshot> {
    return new Map([...this.overviewSnapshotsById, ...this.roomSnapshotsById]);
  }

  getRoomSnapshot(roomId: string): RoomSnapshot | null {
    return this.roomSnapshotsById.get(roomId) ?? this.overviewSnapshotsById.get(roomId) ?? null;
  }

  getFullRoomSnapshot(roomId: string): RoomSnapshot | null {
    return this.roomSnapshotsById.get(roomId) ?? null;
  }

  setRoomSnapshot(room: RoomSnapshot): void {
    this.roomSnapshotsById.set(room.id, room);
    this.overviewSnapshotsById.delete(room.id);
    setSharedRoomSnapshot(
      buildSharedRoomSnapshotKey(room.id, room.version, room.status, room.updatedAt),
      room,
    );
  }

  hydrateChunkWindow(chunkWindow: Pick<WorldChunkWindow, 'chunks'>): void {
    for (const chunk of chunkWindow.chunks) {
      for (const previewRoom of chunk.previewRooms) {
        const existing = this.roomSnapshotsById.get(previewRoom.id) ?? null;
        if (
          existing &&
          existing.version === previewRoom.version &&
          existing.updatedAt === previewRoom.updatedAt
        ) {
          continue;
        }

        this.roomSnapshotsById.set(previewRoom.id, cloneRoomSnapshot(previewRoom));
        this.overviewSnapshotsById.delete(previewRoom.id);
        setSharedRoomSnapshot(
          buildSharedRoomSnapshotKey(previewRoom.id, previewRoom.version, previewRoom.status, previewRoom.updatedAt),
          previewRoom,
        );
      }
    }
  }

  async ensureRoomSnapshotsBatch(
    roomCandidates: Map<string, StreamingRoomCandidate>,
    roomIds: Iterable<string>,
    options: {
      priority?: 'high' | 'low' | 'auto';
      detail?: RoomSnapshotQueryDetail;
    } = {},
  ): Promise<void> {
    const detail = options.detail ?? 'full';
    const references = Array.from(new Set(roomIds)).flatMap((roomId) => {
      const candidate = roomCandidates.get(roomId);
      const summary = candidate?.summary ?? null;
      if (!summary || (summary.state !== 'published' && summary.state !== 'claimed_unpublished')) return [];
      const cached = this.roomSnapshotsById.get(roomId)
        ?? (detail === 'overview' ? this.overviewSnapshotsById.get(roomId) : null);
      if (
        cached &&
        cached.version === summary.version &&
        (!summary.previewUpdatedAt || cached.updatedAt === summary.previewUpdatedAt)
      ) return [];
      const shared = getSharedRoomSnapshot(buildSharedRoomSnapshotKey(
        roomId,
        summary.version,
        summary.state,
        summary.previewUpdatedAt,
      ));
      if (shared) {
        this.roomSnapshotsById.set(roomId, shared);
        return [];
      }
      return [{
        kind: 'current_preview' as const,
        roomId,
        coordinates: summary.coordinates,
        state: summary.state,
        ...(summary.previewUpdatedAt ? { updatedAt: summary.previewUpdatedAt } : {}),
      }];
    });

    for (let index = 0; index < references.length; index += 48) {
      const batch = references.slice(index, index + 48);
      const response = await this.worldRepository.queryRoomSnapshots(batch, options);
      if (response.missing.length > 0) {
        const missing = response.missing[0];
        throw new Error(`Room preview ${missing.roomId} changed while the world was loading.`);
      }
      for (const entry of response.snapshots) {
        const snapshot = cloneRoomSnapshot(entry.snapshot);
        if (detail === 'overview') {
          if (!this.roomSnapshotsById.has(snapshot.id)) {
            this.overviewSnapshotsById.set(snapshot.id, snapshot);
          }
          continue;
        }
        this.roomSnapshotsById.set(snapshot.id, snapshot);
        this.overviewSnapshotsById.delete(snapshot.id);
        const summary = roomCandidates.get(entry.snapshot.id)?.summary ?? null;
        setSharedRoomSnapshot(buildSharedRoomSnapshotKey(
          entry.snapshot.id,
          entry.snapshot.version,
          summary?.state ?? entry.snapshot.status,
          entry.snapshot.updatedAt,
        ), entry.snapshot);
      }
    }
  }

  invalidateRoom(roomId: string, dropPublishedSnapshot: boolean): void {
    this.roomLoadRequestsById.get(roomId)?.abortController.abort();
    this.roomLoadRequestsById.delete(roomId);
    if (dropPublishedSnapshot) {
      this.roomSnapshotsById.delete(roomId);
      this.overviewSnapshotsById.delete(roomId);
      invalidateSharedRoomSnapshots(roomId);
    }
  }

  pruneSnapshots(visibleRoomIds: Set<string>, loadedFullRoomIds: Set<string>): void {
    for (const roomId of Array.from(this.roomSnapshotsById.keys())) {
      if (!visibleRoomIds.has(roomId) && !loadedFullRoomIds.has(roomId)) {
        this.roomSnapshotsById.delete(roomId);
      }
    }
    for (const roomId of Array.from(this.overviewSnapshotsById.keys())) {
      if (!visibleRoomIds.has(roomId) && !loadedFullRoomIds.has(roomId)) {
        this.overviewSnapshotsById.delete(roomId);
      }
    }
  }

  async collectRenderableRooms(
    roomCandidates: Map<string, StreamingRoomCandidate>,
    previewRoomIds: Set<string>,
    fullRoomIds: Set<string>
  ): Promise<Map<string, RenderableRoom>> {
    const renderableRooms = new Map<string, RenderableRoom>();
    const requestedRoomIds = new Set<string>([...previewRoomIds, ...fullRoomIds]);
    if (requestedRoomIds.size === 0) {
      return renderableRooms;
    }

    await Promise.all(
      Array.from(requestedRoomIds.values()).map(async (roomId) => {
        const candidate = roomCandidates.get(roomId);
        if (!candidate) {
          return;
        }

        if (candidate.draft) {
          renderableRooms.set(candidate.id, {
            id: candidate.id,
            coordinates: { ...candidate.coordinates },
            room: candidate.draft,
            source: candidate.source,
          });
          return;
        }

        if (candidate.summary?.state === 'published' && candidate.sharedPreview) {
          const publishedRoom = await this.ensurePublishedRoomSnapshot(candidate.summary);
          if (publishedRoom) {
            renderableRooms.set(candidate.id, {
              id: candidate.id,
              coordinates: { ...candidate.coordinates },
              room: publishedRoom,
              source: 'published',
            });
            return;
          }
        }

        if (candidate.sharedPreview && candidate.summary?.state !== 'published') {
          renderableRooms.set(candidate.id, {
            id: candidate.id,
            coordinates: { ...candidate.coordinates },
            room: candidate.sharedPreview,
            source: candidate.source,
          });
          return;
        }

        if (
          !candidate.summary ||
          (candidate.summary.state !== 'published' && candidate.summary.state !== 'claimed_unpublished')
        ) {
          return;
        }

        const cachedRoom = fullRoomIds.has(candidate.summary.id)
          ? this.getFullRoomSnapshot(candidate.summary.id)
          : this.getRoomSnapshot(candidate.summary.id);
        const publishedRoom =
          cachedRoom ??
          (candidate.summary.state === 'published' && fullRoomIds.has(candidate.summary.id)
            ? await this.ensurePublishedRoomSnapshot(candidate.summary)
            : null);
        if (!publishedRoom) {
          return;
        }

        renderableRooms.set(candidate.id, {
          id: candidate.id,
          coordinates: { ...candidate.coordinates },
          room: publishedRoom,
          source: candidate.summary.state === 'published' ? 'published' : 'saved_construction_draft',
        });
      })
    );

    return renderableRooms;
  }

  async prefetchPublishedRoom(summary: WorldRoomSummary): Promise<RoomSnapshot | null> {
    return this.ensurePublishedRoomSnapshot(summary, 'selection');
  }

  cancelSelectionPrefetchesExcept(roomId: string | null): void {
    for (const [requestRoomId, request] of this.roomLoadRequestsById) {
      if (requestRoomId === roomId || !request.owners.delete('selection')) continue;
      if (request.owners.size > 0) continue;
      request.abortController.abort();
      this.roomLoadRequestsById.delete(requestRoomId);
    }
  }

  private async ensurePublishedRoomSnapshot(
    summary: WorldRoomSummary,
    owner: RoomLoadOwner = 'render',
  ): Promise<RoomSnapshot | null> {
    const cached = this.roomSnapshotsById.get(summary.id);
    if (cached && cached.version === (summary.version ?? cached.version)) {
      return cached;
    }

    const inFlight = this.roomLoadRequestsById.get(summary.id);
    if (inFlight) {
      inFlight.owners.add(owner);
      return inFlight.promise;
    }

    const abortController = new AbortController();
    const lifecycleEpoch = this.lifecycleEpoch;
    const request: RoomLoadRequest = {
      abortController,
      lifecycleEpoch,
      owners: new Set([owner]),
      promise: Promise.resolve(null),
    };
    request.promise = this.worldRepository
      .loadPublishedRoom(summary.id, summary.coordinates, abortController.signal)
      .then((room) => {
        if (
          abortController.signal.aborted
          || lifecycleEpoch !== this.lifecycleEpoch
          || this.roomLoadRequestsById.get(summary.id) !== request
        ) {
          return null;
        }
        if (room) {
          this.roomSnapshotsById.set(room.id, room);
        }
        return room;
      })
      .finally(() => {
        if (this.roomLoadRequestsById.get(summary.id) === request) {
          this.roomLoadRequestsById.delete(summary.id);
        }
      });

    this.roomLoadRequestsById.set(summary.id, request);
    return request.promise;
  }
}

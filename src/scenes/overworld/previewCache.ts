import {
  cloneRoomSnapshot,
  type RoomSnapshot,
  type RoomSnapshotQueryDetail,
  type RoomSnapshotQueryReference,
  type RoomSnapshotQueryResponse,
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
import {
  type RenderableRoom,
  type StreamingRoomCandidate,
} from './worldStreamingModel';

// Compatibility re-exports while callers migrate to the streaming model.
export {
  isStreamingRoomCandidateRenderable,
  type PlayableRoomSource,
  type RenderableRoom,
  type StreamingRoomCandidate,
} from './worldStreamingModel';

/**
 * The world summary and the room snapshot endpoint no longer agree about the
 * exact current preview. Callers must refresh the summary before retrying the
 * same reference; retrying it unchanged can never make progress.
 */
export class RoomSnapshotReferenceChangedError extends Error {
  readonly roomIds: readonly string[];

  constructor(readonly references: readonly RoomSnapshotQueryReference[]) {
    const roomIds = Array.from(new Set(references.map((reference) => reference.roomId)));
    super(`Room preview ${roomIds[0] ?? 'unknown'} changed while the world was loading.`);
    this.name = 'RoomSnapshotReferenceChangedError';
    this.roomIds = roomIds;
  }
}

export function isRoomSnapshotReferenceChangedError(
  error: unknown,
): error is RoomSnapshotReferenceChangedError {
  return error instanceof RoomSnapshotReferenceChangedError;
}

type RoomLoadOwner = 'render' | 'selection';

interface RoomLoadRequest {
  abortController: AbortController;
  lifecycleEpoch: number;
  owners: Set<RoomLoadOwner>;
  promise: Promise<RoomSnapshot | null>;
}

interface RoomSnapshotBatchRequest {
  lifecycleEpoch: number;
  roomInvalidationEpochs: Map<string, number>;
  promise: Promise<RoomSnapshotQueryResponse>;
}

function serializeRoomSnapshotReference(reference: RoomSnapshotQueryReference): string {
  return reference.kind === 'version'
    ? JSON.stringify(['version', reference.roomId, reference.version])
    : JSON.stringify([
        'current_preview',
        reference.roomId,
        reference.coordinates?.x ?? null,
        reference.coordinates?.y ?? null,
        reference.state ?? null,
        reference.updatedAt ?? null,
      ]);
}

function buildRoomSnapshotBatchKey(
  references: readonly RoomSnapshotQueryReference[],
  detail: RoomSnapshotQueryDetail,
): string {
  const canonicalReferences = references.map(serializeRoomSnapshotReference).sort();
  return JSON.stringify([detail, canonicalReferences]);
}

export class OverworldPreviewCache {
  private roomSnapshotsById = new Map<string, RoomSnapshot>();
  private overviewSnapshotsById = new Map<string, RoomSnapshot>();
  private roomLoadRequestsById = new Map<string, RoomLoadRequest>();
  private roomSnapshotBatchRequestsByKey = new Map<string, RoomSnapshotBatchRequest>();
  private roomInvalidationEpochsById = new Map<string, number>();
  private lifecycleEpoch = 0;

  constructor(private readonly worldRepository: WorldRepository) {}

  reset(): void {
    this.lifecycleEpoch += 1;
    for (const request of this.roomLoadRequestsById.values()) request.abortController.abort();
    this.roomSnapshotsById = new Map();
    this.overviewSnapshotsById = new Map();
    this.roomLoadRequestsById = new Map();
    this.roomSnapshotBatchRequestsByKey = new Map();
    this.roomInvalidationEpochsById = new Map();
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
    }).sort((left, right) => (
      serializeRoomSnapshotReference(left).localeCompare(serializeRoomSnapshotReference(right))
    ));

    for (let index = 0; index < references.length; index += 48) {
      const batch = references.slice(index, index + 48);
      const lifecycleEpoch = this.lifecycleEpoch;
      const roomInvalidationEpochs = this.captureRoomInvalidationEpochs(batch);
      const response = await this.queryRoomSnapshotBatch(batch, detail, options.priority);
      if (lifecycleEpoch !== this.lifecycleEpoch) return;
      const currentMissing = response.missing.filter((missing) =>
        this.isRoomInvalidationEpochCurrent(missing.roomId, roomInvalidationEpochs),
      );
      if (currentMissing.length > 0) {
        throw new RoomSnapshotReferenceChangedError(currentMissing);
      }
      const changedReferences = response.snapshots.flatMap((entry) => {
        if (!this.isRoomInvalidationEpochCurrent(entry.snapshot.id, roomInvalidationEpochs)) {
          return [];
        }
        const summary = roomCandidates.get(entry.snapshot.id)?.summary ?? null;
        if (
          !summary
          || (
            (summary.version === null || entry.snapshot.version === summary.version)
            && (!summary.previewUpdatedAt || entry.snapshot.updatedAt === summary.previewUpdatedAt)
          )
        ) {
          return [];
        }
        return [entry.reference];
      });
      if (changedReferences.length > 0) {
        throw new RoomSnapshotReferenceChangedError(changedReferences);
      }
      for (const entry of response.snapshots) {
        if (!this.isRoomInvalidationEpochCurrent(entry.snapshot.id, roomInvalidationEpochs)) {
          continue;
        }
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

  /**
   * Loads a published room that is not represented by the current world-window
   * summaries. Portal links can legitimately point outside that window, so
   * their exact destination must not depend on overview discovery first.
   */
  async ensureCurrentPublishedRoomSnapshot(
    roomId: string,
    coordinates: RoomCoordinates,
    options: {
      priority?: 'high' | 'low' | 'auto';
      detail?: RoomSnapshotQueryDetail;
    } = {},
  ): Promise<RoomSnapshot | null> {
    const detail = options.detail ?? 'full';
    const reference: RoomSnapshotQueryReference = {
      kind: 'current_preview',
      roomId,
      coordinates,
      state: 'published',
    };
    const lifecycleEpoch = this.lifecycleEpoch;
    const roomInvalidationEpochs = this.captureRoomInvalidationEpochs([reference]);
    const response = await this.queryRoomSnapshotBatch(
      [reference],
      detail,
      options.priority,
    );
    if (lifecycleEpoch !== this.lifecycleEpoch) return null;
    if (!this.isRoomInvalidationEpochCurrent(roomId, roomInvalidationEpochs)) return null;

    const entry = response.snapshots.find((candidate) => candidate.snapshot.id === roomId) ?? null;
    if (!entry || response.missing.length > 0) {
      throw new Error(`Published portal destination ${roomId} is unavailable.`);
    }

    const snapshot = cloneRoomSnapshot(entry.snapshot);
    if (detail === 'overview') {
      if (!this.roomSnapshotsById.has(roomId)) {
        this.overviewSnapshotsById.set(roomId, snapshot);
      }
      return snapshot;
    }

    this.roomSnapshotsById.set(roomId, snapshot);
    this.overviewSnapshotsById.delete(roomId);
    setSharedRoomSnapshot(
      buildSharedRoomSnapshotKey(
        roomId,
        snapshot.version,
        'published',
        snapshot.updatedAt,
      ),
      snapshot,
    );
    return snapshot;
  }

  private queryRoomSnapshotBatch(
    references: RoomSnapshotQueryReference[],
    detail: RoomSnapshotQueryDetail,
    priority?: 'high' | 'low' | 'auto',
  ): Promise<RoomSnapshotQueryResponse> {
    const key = buildRoomSnapshotBatchKey(references, detail);
    const existing = this.roomSnapshotBatchRequestsByKey.get(key);
    const roomInvalidationEpochs = this.captureRoomInvalidationEpochs(references);
    if (
      existing?.lifecycleEpoch === this.lifecycleEpoch
      && this.areRoomInvalidationEpochsCurrent(existing.roomInvalidationEpochs)
    ) {
      return existing.promise;
    }

    const request: RoomSnapshotBatchRequest = {
      lifecycleEpoch: this.lifecycleEpoch,
      roomInvalidationEpochs,
      promise: this.worldRepository.queryRoomSnapshots(references, { detail, priority }),
    };
    this.roomSnapshotBatchRequestsByKey.set(key, request);
    const clearIfCurrent = (): void => {
      if (this.roomSnapshotBatchRequestsByKey.get(key) === request) {
        this.roomSnapshotBatchRequestsByKey.delete(key);
      }
    };
    void request.promise.then(clearIfCurrent, clearIfCurrent);
    return request.promise;
  }

  invalidateRoom(roomId: string, dropPublishedSnapshot: boolean): void {
    this.roomInvalidationEpochsById.set(
      roomId,
      (this.roomInvalidationEpochsById.get(roomId) ?? 0) + 1,
    );
    this.roomLoadRequestsById.get(roomId)?.abortController.abort();
    this.roomLoadRequestsById.delete(roomId);
    if (dropPublishedSnapshot) {
      this.roomSnapshotsById.delete(roomId);
      this.overviewSnapshotsById.delete(roomId);
      invalidateSharedRoomSnapshots(roomId);
    }
  }

  private captureRoomInvalidationEpochs(
    references: Iterable<Pick<RoomSnapshotQueryReference, 'roomId'>>,
  ): Map<string, number> {
    return new Map(Array.from(references, (reference) => [
      reference.roomId,
      this.roomInvalidationEpochsById.get(reference.roomId) ?? 0,
    ]));
  }

  private isRoomInvalidationEpochCurrent(
    roomId: string,
    capturedEpochs: ReadonlyMap<string, number>,
  ): boolean {
    return (capturedEpochs.get(roomId) ?? 0)
      === (this.roomInvalidationEpochsById.get(roomId) ?? 0);
  }

  private areRoomInvalidationEpochsCurrent(
    capturedEpochs: ReadonlyMap<string, number>,
  ): boolean {
    for (const [roomId, epoch] of capturedEpochs) {
      if ((this.roomInvalidationEpochsById.get(roomId) ?? 0) !== epoch) return false;
    }
    return true;
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

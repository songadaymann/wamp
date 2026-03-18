import { cloneRoomSnapshot, type RoomSnapshot } from '../../persistence/roomModel';
import type { WorldRepository } from '../../persistence/worldRepository';
import type { WorldChunkWindow, WorldRoomSummary } from '../../persistence/worldModel';
import type { RoomCoordinates } from '../../persistence/roomModel';

export interface StreamingRoomCandidate {
  id: string;
  coordinates: RoomCoordinates;
  summary: WorldRoomSummary | null;
  draft: RoomSnapshot | null;
}

export interface RenderableRoom {
  id: string;
  coordinates: RoomCoordinates;
  room: RoomSnapshot;
}

export class OverworldPreviewCache {
  private roomSnapshotsById = new Map<string, RoomSnapshot>();
  private roomLoadPromisesById = new Map<string, Promise<RoomSnapshot | null>>();

  constructor(private readonly worldRepository: WorldRepository) {}

  reset(): void {
    this.roomSnapshotsById = new Map();
    this.roomLoadPromisesById = new Map();
  }

  getRoomSnapshotsById(): Map<string, RoomSnapshot> {
    return this.roomSnapshotsById;
  }

  getRoomSnapshot(roomId: string): RoomSnapshot | null {
    return this.roomSnapshotsById.get(roomId) ?? null;
  }

  setRoomSnapshot(room: RoomSnapshot): void {
    this.roomSnapshotsById.set(room.id, room);
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
      }
    }
  }

  invalidateRoom(roomId: string, dropPublishedSnapshot: boolean): void {
    this.roomLoadPromisesById.delete(roomId);
    if (dropPublishedSnapshot) {
      this.roomSnapshotsById.delete(roomId);
    }
  }

  pruneSnapshots(visibleRoomIds: Set<string>, loadedFullRoomIds: Set<string>): void {
    for (const roomId of Array.from(this.roomSnapshotsById.keys())) {
      if (!visibleRoomIds.has(roomId) && !loadedFullRoomIds.has(roomId)) {
        this.roomSnapshotsById.delete(roomId);
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
            room: cloneRoomSnapshot(candidate.draft),
          });
          return;
        }

        if (!candidate.summary || candidate.summary.state !== 'published') {
          return;
        }

        const cachedRoom = this.roomSnapshotsById.get(candidate.summary.id) ?? null;
        const publishedRoom =
          cachedRoom ??
          (fullRoomIds.has(candidate.summary.id)
            ? await this.ensurePublishedRoomSnapshot(candidate.summary)
            : null);
        if (!publishedRoom) {
          return;
        }

        renderableRooms.set(candidate.id, {
          id: candidate.id,
          coordinates: { ...candidate.coordinates },
          room: publishedRoom,
        });
      })
    );

    return renderableRooms;
  }

  private async ensurePublishedRoomSnapshot(summary: WorldRoomSummary): Promise<RoomSnapshot | null> {
    const cached = this.roomSnapshotsById.get(summary.id);
    if (cached && cached.version === (summary.version ?? cached.version)) {
      return cached;
    }

    const inFlight = this.roomLoadPromisesById.get(summary.id);
    if (inFlight) {
      return inFlight;
    }

    const request = this.worldRepository
      .loadPublishedRoom(summary.id, summary.coordinates)
      .then((room) => {
        if (room) {
          this.roomSnapshotsById.set(room.id, room);
        }
        return room;
      })
      .finally(() => {
        this.roomLoadPromisesById.delete(summary.id);
      });

    this.roomLoadPromisesById.set(summary.id, request);
    return request;
  }
}

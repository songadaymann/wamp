import {
  cloneRoomSnapshot,
  normalizeRoomRecord,
  parseRoomId,
  type RoomCoordinates,
  type RoomRecord,
  type RoomSnapshotQueryReference,
  type RoomSnapshotQueryDetail,
  type RoomSnapshotQueryResponse,
  type RoomSnapshot,
} from './roomModel';
import {
  cloneWorldChunkWindow,
  cloneCompactWorldChunkWindow,
  cloneWorldWindow,
  computeWorldChunkWindow,
  computeWorldWindow,
  type ClaimableFrontierRoomWindow,
  type CompactWorldChunkWindow,
  type ClaimedUnpublishedWorldRoomSource,
  type WorldRoomSource,
  type WorldChunkBounds,
  type WorldChunkWindow,
  type WorldWindow,
} from './worldModel';
import { getApiBaseUrl } from '../api/baseUrl';
import { ROOM_STORAGE_PREFIX } from './browserStorage';
import { startBootStallWatch } from '../main/bootDiagnostics';

export interface WorldRepository {
  loadWorldWindow(center: RoomCoordinates, radius: number): Promise<WorldWindow>;
  loadWorldChunkWindow(chunkBounds: WorldChunkBounds): Promise<WorldChunkWindow>;
  loadCompactWorldChunkWindow(chunkBounds: WorldChunkBounds): Promise<CompactWorldChunkWindow | null>;
  queryRoomSnapshots(
    references: RoomSnapshotQueryReference[],
    options?: { priority?: 'high' | 'low' | 'auto'; detail?: RoomSnapshotQueryDetail },
  ): Promise<RoomSnapshotQueryResponse>;
  loadPublishedRoom(roomId: string, coordinates: RoomCoordinates): Promise<RoomSnapshot | null>;
  loadClaimableFrontierWindow(center: RoomCoordinates, radius: number): Promise<ClaimableFrontierRoomWindow>;
}

class WorldApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

type RoomStorageBackend = 'auto' | 'local' | 'remote';

function getRoomStorageBackend(): RoomStorageBackend {
  const configured = import.meta.env.VITE_ROOM_STORAGE_BACKEND;

  if (configured === 'auto' || configured === 'local' || configured === 'remote') {
    return configured;
  }

  return 'remote';
}

function parseStoredRecord(
  raw: string | null,
  roomId: string,
  coordinates: RoomCoordinates
): RoomRecord | null {
  if (!raw) return null;

  try {
    return normalizeRoomRecord(JSON.parse(raw), roomId, coordinates);
  } catch {
    return null;
  }
}

class LocalWorldRepository implements WorldRepository {
  async loadWorldWindow(center: RoomCoordinates, radius: number): Promise<WorldWindow> {
    return computeWorldWindow(this.loadAllWorldRooms(), center, radius);
  }

  async loadWorldChunkWindow(chunkBounds: WorldChunkBounds): Promise<WorldChunkWindow> {
    return computeWorldChunkWindow(this.loadAllWorldRooms(), chunkBounds);
  }

  async loadCompactWorldChunkWindow(_chunkBounds: WorldChunkBounds): Promise<CompactWorldChunkWindow | null> {
    return null;
  }

  async queryRoomSnapshots(
    _references: RoomSnapshotQueryReference[],
    _options?: { priority?: 'high' | 'low' | 'auto'; detail?: RoomSnapshotQueryDetail },
  ): Promise<RoomSnapshotQueryResponse> {
    return { snapshots: [], missing: [] };
  }

  async loadPublishedRoom(roomId: string, coordinates: RoomCoordinates): Promise<RoomSnapshot | null> {
    const parsedCoordinates = parseRoomId(roomId);
    const lookupId = parsedCoordinates
      ? roomId
      : `${coordinates.x},${coordinates.y}`;
    const lookupCoordinates = parsedCoordinates ?? coordinates;
    const stored = parseStoredRecord(
      localStorage.getItem(`${ROOM_STORAGE_PREFIX}${lookupId}`),
      lookupId,
      lookupCoordinates
    );

    if (!stored?.published) {
      return null;
    }

    return cloneRoomSnapshot(stored.published);
  }

  async loadClaimableFrontierWindow(
    center: RoomCoordinates,
    radius: number
  ): Promise<ClaimableFrontierRoomWindow> {
    const worldWindow = computeWorldWindow(this.loadAllWorldRooms(), center, radius);
    return {
      center: { ...center },
      radius,
      rooms: worldWindow.rooms.filter((room) => room.state === 'frontier'),
      roomDailyClaimLimit: null,
      roomClaimsUsedToday: 0,
      roomClaimsRemainingToday: null,
    };
  }

  private loadAllWorldRooms(): WorldRoomSource[] {
    const rooms: WorldRoomSource[] = [];

    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key || !key.startsWith(ROOM_STORAGE_PREFIX)) continue;
      const roomId = key.slice(ROOM_STORAGE_PREFIX.length);
      const coordinates = parseRoomId(roomId);
      if (!coordinates) continue;

      const stored = parseStoredRecord(localStorage.getItem(key), roomId, coordinates);
      if (stored?.published) {
        rooms.push({
          state: 'published',
          snapshot: cloneRoomSnapshot(stored.published),
          creatorUserId: stored.claimerUserId ?? stored.lastPublishedByUserId,
          creatorDisplayName: stored.claimerDisplayName ?? stored.lastPublishedByDisplayName,
        });
        continue;
      }

      if (stored?.claimerUserId && stored.claimedAt) {
        const claimedRoom: ClaimedUnpublishedWorldRoomSource = {
          state: 'claimed_unpublished',
          snapshot: cloneRoomSnapshot(stored.draft),
          claimerUserId: stored.claimerUserId,
          claimerDisplayName: stored.claimerDisplayName,
        };
        rooms.push(claimedRoom);
      }
    }

    return rooms;
  }
}

class ApiWorldRepository implements WorldRepository {
  private compactWorldUnavailable = false;
  constructor(
    private readonly baseUrl: string,
    private readonly fallback: WorldRepository | null
  ) {}

  async loadWorldWindow(center: RoomCoordinates, radius: number): Promise<WorldWindow> {
    const params = new URLSearchParams({
      centerX: String(center.x),
      centerY: String(center.y),
      radius: String(radius),
    });

    return this.withFallback(
      () => this.requestWorldWindow(`/api/world?${params.toString()}`),
      () => this.fallback?.loadWorldWindow(center, radius)
    );
  }

  async loadWorldChunkWindow(chunkBounds: WorldChunkBounds): Promise<WorldChunkWindow> {
    const params = new URLSearchParams({
      minChunkX: String(chunkBounds.minChunkX),
      maxChunkX: String(chunkBounds.maxChunkX),
      minChunkY: String(chunkBounds.minChunkY),
      maxChunkY: String(chunkBounds.maxChunkY),
    });

    return this.withFallback(
      () => this.requestWorldChunkWindow(`/api/world/chunks?${params.toString()}`),
      () => this.fallback?.loadWorldChunkWindow(chunkBounds)
    );
  }

  async loadCompactWorldChunkWindow(chunkBounds: WorldChunkBounds): Promise<CompactWorldChunkWindow | null> {
    if (this.compactWorldUnavailable) return null;
    const params = new URLSearchParams({
      minChunkX: String(chunkBounds.minChunkX),
      maxChunkX: String(chunkBounds.maxChunkX),
      minChunkY: String(chunkBounds.minChunkY),
      maxChunkY: String(chunkBounds.maxChunkY),
    });
    try {
      return await this.requestCompactWorldChunkWindow(`/api/world/chunks/summary?${params.toString()}`);
    } catch (error) {
      this.compactWorldUnavailable = true;
      console.warn('Compact world reads unavailable for this session; using legacy chunks.', error);
      return null;
    }
  }

  async queryRoomSnapshots(
    references: RoomSnapshotQueryReference[],
    options: { priority?: 'high' | 'low' | 'auto'; detail?: RoomSnapshotQueryDetail } = {},
  ): Promise<RoomSnapshotQueryResponse> {
    try {
      const requestInit: RequestInit & { priority?: 'high' | 'low' | 'auto' } = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ references, detail: options.detail ?? 'full' }),
        ...(options.priority ? { priority: options.priority } : {}),
      };
      const response = await this.fetchWorldApi('/api/rooms/snapshots/query', requestInit);
      if (!response.ok) {
        const details = await response.text();
        throw new WorldApiError(details || `Snapshot query failed with status ${response.status}.`, response.status);
      }
      return (await response.json()) as RoomSnapshotQueryResponse;
    } catch (error) {
      this.compactWorldUnavailable = true;
      throw error;
    }
  }

  async loadPublishedRoom(roomId: string, coordinates: RoomCoordinates): Promise<RoomSnapshot | null> {
    const params = new URLSearchParams({
      x: String(coordinates.x),
      y: String(coordinates.y),
    });

    return this.withFallback(
      () => this.requestPublishedRoom(`/api/rooms/${encodeURIComponent(roomId)}/published?${params.toString()}`),
      () => this.fallback?.loadPublishedRoom(roomId, coordinates)
    );
  }

  async loadClaimableFrontierWindow(
    center: RoomCoordinates,
    radius: number
  ): Promise<ClaimableFrontierRoomWindow> {
    const params = new URLSearchParams({
      centerX: String(center.x),
      centerY: String(center.y),
      radius: String(radius),
    });

    return this.withFallback(
      () => this.requestClaimableFrontierWindow(`/api/world/claimable?${params.toString()}`),
      () => this.fallback?.loadClaimableFrontierWindow(center, radius)
    );
  }

  private async requestWorldWindow(path: string): Promise<WorldWindow> {
    const response = await this.fetchWorldApi(path);

    if (!response.ok) {
      const details = await response.text();
      throw new WorldApiError(
        details || `World API request failed with status ${response.status}.`,
        response.status
      );
    }

    return cloneWorldWindow((await response.json()) as WorldWindow);
  }

  private async requestWorldChunkWindow(path: string): Promise<WorldChunkWindow> {
    const response = await this.fetchWorldApi(path);

    if (!response.ok) {
      const details = await response.text();
      throw new WorldApiError(
        details || `World API request failed with status ${response.status}.`,
        response.status
      );
    }

    return cloneWorldChunkWindow((await response.json()) as WorldChunkWindow);
  }

  private async requestCompactWorldChunkWindow(path: string): Promise<CompactWorldChunkWindow> {
    const response = await this.fetchWorldApi(path);
    if (!response.ok) {
      const details = await response.text();
      throw new WorldApiError(details || `Compact world API request failed with status ${response.status}.`, response.status);
    }
    return cloneCompactWorldChunkWindow((await response.json()) as CompactWorldChunkWindow);
  }

  private async requestPublishedRoom(path: string): Promise<RoomSnapshot | null> {
    const response = await this.fetchWorldApi(path);

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const details = await response.text();
      throw new WorldApiError(
        details || `World API request failed with status ${response.status}.`,
        response.status
      );
    }

    const room = (await response.json()) as RoomSnapshot;
    return cloneRoomSnapshot(room);
  }

  private async requestClaimableFrontierWindow(path: string): Promise<ClaimableFrontierRoomWindow> {
    const response = await this.fetchWorldApi(path);

    if (!response.ok) {
      const details = await response.text();
      throw new WorldApiError(
        details || `World API request failed with status ${response.status}.`,
        response.status
      );
    }

    return (await response.json()) as ClaimableFrontierRoomWindow;
  }

  private async fetchWorldApi(path: string, init?: RequestInit): Promise<Response> {
    const cancelStallWatch = startBootStallWatch('world API request', 8000, () => ({
      path,
      baseUrl: this.baseUrl,
    }));

    try {
      return await fetch(`${this.baseUrl}${path}`, {
        ...init,
        credentials: 'include',
      });
    } finally {
      cancelStallWatch();
    }
  }

  private async withFallback<T>(
    remoteOperation: () => Promise<T>,
    fallbackOperation: (() => Promise<T> | undefined) | undefined
  ): Promise<T> {
    try {
      return await remoteOperation();
    } catch (error) {
      if (!this.shouldFallback(error) || !fallbackOperation) {
        throw error;
      }

      const fallbackResult = await fallbackOperation();
      if (fallbackResult === undefined) {
        throw error;
      }

      return fallbackResult;
    }
  }

  private shouldFallback(error: unknown): boolean {
    if (!this.fallback) return false;
    if (!import.meta.env.DEV) return false;
    if (error instanceof TypeError) return true;
    if (error instanceof WorldApiError && error.status === 404) return true;
    if (error instanceof WorldApiError && error.status >= 500) return true;
    return false;
  }
}

export function createWorldRepository(): WorldRepository {
  const backend = getRoomStorageBackend();
  const localRepository = new LocalWorldRepository();

  if (backend === 'local') {
    return localRepository;
  }

  return new ApiWorldRepository(
    getApiBaseUrl(),
    backend === 'auto' ? localRepository : null
  );
}

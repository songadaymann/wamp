import {
  cloneRoomSnapshot,
  normalizeRoomRecord,
  parseRoomId,
  type RoomCoordinates,
  type RoomRecord,
  type RoomSnapshot,
} from './roomModel';
import {
  computeWorldChunkWindow,
  computeWorldWindow,
  type WorldChunkBounds,
  type WorldChunkWindow,
  type WorldWindow,
} from './worldModel';
import { ROOM_STORAGE_PREFIX } from './browserStorage';

export interface WorldRepository {
  loadWorldWindow(center: RoomCoordinates, radius: number): Promise<WorldWindow>;
  loadWorldChunkWindow(chunkBounds: WorldChunkBounds): Promise<WorldChunkWindow>;
  loadPublishedRoom(roomId: string, coordinates: RoomCoordinates): Promise<RoomSnapshot | null>;
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

function getApiBaseUrl(): string {
  const configured = import.meta.env.VITE_ROOM_API_BASE_URL?.trim();
  return configured ? configured.replace(/\/+$/, '') : '';
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
    return computeWorldWindow(this.loadAllPublishedRooms(), center, radius);
  }

  async loadWorldChunkWindow(chunkBounds: WorldChunkBounds): Promise<WorldChunkWindow> {
    return computeWorldChunkWindow(this.loadAllPublishedRooms(), chunkBounds);
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

  private loadAllPublishedRooms(): RoomSnapshot[] {
    const publishedRooms: RoomSnapshot[] = [];

    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key || !key.startsWith(ROOM_STORAGE_PREFIX)) continue;
      const roomId = key.slice(ROOM_STORAGE_PREFIX.length);
      const coordinates = parseRoomId(roomId);
      if (!coordinates) continue;

      const stored = parseStoredRecord(localStorage.getItem(key), roomId, coordinates);
      if (!stored?.published) continue;

      publishedRooms.push(cloneRoomSnapshot(stored.published));
    }

    return publishedRooms;
  }
}

class ApiWorldRepository implements WorldRepository {
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

  private async requestWorldWindow(path: string): Promise<WorldWindow> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      credentials: 'include',
    });

    if (!response.ok) {
      const details = await response.text();
      throw new WorldApiError(
        details || `World API request failed with status ${response.status}.`,
        response.status
      );
    }

    return (await response.json()) as WorldWindow;
  }

  private async requestWorldChunkWindow(path: string): Promise<WorldChunkWindow> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      credentials: 'include',
    });

    if (!response.ok) {
      const details = await response.text();
      throw new WorldApiError(
        details || `World API request failed with status ${response.status}.`,
        response.status
      );
    }

    return (await response.json()) as WorldChunkWindow;
  }

  private async requestPublishedRoom(path: string): Promise<RoomSnapshot | null> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      credentials: 'include',
    });

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

import {
  cloneRoomRecord,
  cloneRoomSnapshot,
  createRoomVersionRecord,
  createDefaultRoomRecord,
  isRoomMinted,
  normalizeRoomRecord,
  type RoomVersionRecord,
  type RoomCoordinates,
  type RoomRecord,
  type RoomRevertRequestBody,
  type RoomSnapshot,
} from './roomModel';
import { ROOM_STORAGE_PREFIX } from './browserStorage';
import { getApiBaseUrl } from '../api/baseUrl';
import type {
  RoomMintConfirmRequestBody,
  RoomMintPrepareResponse,
} from '../mint/roomOwnership';

export * from './roomModel';

export interface RoomRepository {
  loadRoom(roomId: string, coordinates: RoomCoordinates): Promise<RoomRecord>;
  saveDraft(room: RoomSnapshot): Promise<RoomRecord>;
  publish(room: RoomSnapshot): Promise<RoomRecord>;
  revert(roomId: string, coordinates: RoomCoordinates, targetVersion: number): Promise<RoomRecord>;
  prepareMint(roomId: string, coordinates: RoomCoordinates): Promise<RoomMintPrepareResponse>;
  confirmMint(
    roomId: string,
    coordinates: RoomCoordinates,
    request: RoomMintConfirmRequestBody
  ): Promise<RoomRecord>;
}

function getStorageKey(roomId: string): string {
  return `${ROOM_STORAGE_PREFIX}${roomId}`;
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

function computeLocalPermissions(record: RoomRecord): RoomRecord['permissions'] {
  return {
    canSaveDraft: !isRoomMinted(record),
    canPublish: !isRoomMinted(record),
    canRevert: !isRoomMinted(record) && record.permissions.canRevert,
    canMint: !isRoomMinted(record) && record.permissions.canMint,
  };
}

class LocalRoomRepository implements RoomRepository {
  async loadRoom(roomId: string, coordinates: RoomCoordinates): Promise<RoomRecord> {
    const stored = parseStoredRecord(localStorage.getItem(getStorageKey(roomId)), roomId, coordinates);
    if (stored) {
      return cloneRoomRecord({
        ...stored,
        permissions: computeLocalPermissions(stored),
      });
    }

    return createDefaultRoomRecord(roomId, coordinates);
  }

  async saveDraft(room: RoomSnapshot): Promise<RoomRecord> {
    const existing = await this.loadRoom(room.id, room.coordinates);
    const now = new Date().toISOString();

    const draft: RoomSnapshot = {
      ...cloneRoomSnapshot(room),
      createdAt: existing.draft.createdAt,
      updatedAt: now,
      publishedAt: existing.published?.publishedAt ?? null,
      status: 'draft',
      version: existing.draft.version || 1,
    };

    const nextRecord: RoomRecord = {
      draft,
      published: existing.published,
      versions: existing.versions,
      claimerUserId: existing.claimerUserId,
      claimerDisplayName: existing.claimerDisplayName,
      claimedAt: existing.claimedAt,
      lastPublishedByUserId: existing.lastPublishedByUserId,
      lastPublishedByDisplayName: existing.lastPublishedByDisplayName,
      mintedChainId: existing.mintedChainId,
      mintedContractAddress: existing.mintedContractAddress,
      mintedTokenId: existing.mintedTokenId,
      mintedOwnerWalletAddress: existing.mintedOwnerWalletAddress,
      mintedOwnerSyncedAt: existing.mintedOwnerSyncedAt,
      permissions: computeLocalPermissions(existing),
    };

    localStorage.setItem(getStorageKey(room.id), JSON.stringify(nextRecord));
    return cloneRoomRecord(nextRecord);
  }

  async publish(room: RoomSnapshot): Promise<RoomRecord> {
    const existing = await this.loadRoom(room.id, room.coordinates);
    if (!existing.permissions.canPublish) {
      throw new Error('Publishing is locked for minted rooms.');
    }

    const now = new Date().toISOString();
    const lastPublished = existing.versions[existing.versions.length - 1] ?? null;
    const lastPublishedVersion = lastPublished?.version ?? 0;
    const nextVersion = lastPublishedVersion > 0
      ? lastPublishedVersion + 1
      : Math.max(1, room.version);

    const published: RoomSnapshot = {
      ...cloneRoomSnapshot(room),
      createdAt: existing.draft.createdAt,
      updatedAt: now,
      publishedAt: now,
      status: 'published',
      version: nextVersion,
    };

    const draft: RoomSnapshot = {
      ...cloneRoomSnapshot(published),
      status: 'draft',
    };

    const nextRecord: RoomRecord = {
      draft,
      published,
      versions: [
        ...existing.versions,
        createRoomVersionRecord(published, {
          createdAt: published.publishedAt ?? now,
          publishedByUserId: null,
          publishedByDisplayName: 'Guest',
        }),
      ],
      claimerUserId: existing.claimerUserId,
      claimerDisplayName: existing.claimerDisplayName,
      claimedAt: existing.claimedAt,
      lastPublishedByUserId: null,
      lastPublishedByDisplayName: 'Guest',
      mintedChainId: existing.mintedChainId,
      mintedContractAddress: existing.mintedContractAddress,
      mintedTokenId: existing.mintedTokenId,
      mintedOwnerWalletAddress: existing.mintedOwnerWalletAddress,
      mintedOwnerSyncedAt: existing.mintedOwnerSyncedAt,
      permissions: computeLocalPermissions(existing),
    };

    localStorage.setItem(getStorageKey(room.id), JSON.stringify(nextRecord));
    return cloneRoomRecord(nextRecord);
  }

  async revert(roomId: string, coordinates: RoomCoordinates, targetVersion: number): Promise<RoomRecord> {
    const existing = await this.loadRoom(roomId, coordinates);
    if (!existing.permissions.canRevert) {
      throw new Error('You do not have permission to revert this room.');
    }
    if (isRoomMinted(existing)) {
      throw new Error('Minted rooms cannot be reverted here.');
    }

    const target = existing.versions.find((version) => version.version === targetVersion) ?? null;
    if (!target) {
      throw new Error(`Version ${targetVersion} was not found.`);
    }

    const now = new Date().toISOString();
    const lastPublished = existing.versions[existing.versions.length - 1] ?? null;
    const nextVersion = (lastPublished?.version ?? 0) + 1;
    const published: RoomSnapshot = {
      ...cloneRoomSnapshot(target.snapshot),
      createdAt: existing.draft.createdAt,
      updatedAt: now,
      publishedAt: now,
      status: 'published',
      version: nextVersion,
    };

    const draft: RoomSnapshot = {
      ...cloneRoomSnapshot(published),
      status: 'draft',
    };

    const nextVersionRecord: RoomVersionRecord = createRoomVersionRecord(published, {
      createdAt: now,
      publishedByUserId: existing.claimerUserId,
      publishedByDisplayName: existing.claimerDisplayName,
      revertedFromVersion: target.version,
    });

    const nextRecord: RoomRecord = {
      draft,
      published,
      versions: [...existing.versions, nextVersionRecord],
      claimerUserId: existing.claimerUserId,
      claimerDisplayName: existing.claimerDisplayName,
      claimedAt: existing.claimedAt,
      lastPublishedByUserId: existing.claimerUserId,
      lastPublishedByDisplayName: existing.claimerDisplayName,
      mintedChainId: existing.mintedChainId,
      mintedContractAddress: existing.mintedContractAddress,
      mintedTokenId: existing.mintedTokenId,
      mintedOwnerWalletAddress: existing.mintedOwnerWalletAddress,
      mintedOwnerSyncedAt: existing.mintedOwnerSyncedAt,
      permissions: computeLocalPermissions(existing),
    };

    localStorage.setItem(getStorageKey(roomId), JSON.stringify(nextRecord));
    return cloneRoomRecord(nextRecord);
  }

  async prepareMint(_roomId: string, _coordinates: RoomCoordinates): Promise<RoomMintPrepareResponse> {
    throw new Error('Minting requires the remote API backend.');
  }

  async confirmMint(
    _roomId: string,
    _coordinates: RoomCoordinates,
    _request: RoomMintConfirmRequestBody
  ): Promise<RoomRecord> {
    throw new Error('Minting requires the remote API backend.');
  }
}

export function createLocalRoomRepository(): RoomRepository {
  return new LocalRoomRepository();
}

class RoomApiError extends Error {
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

class ApiRoomRepository implements RoomRepository {
  constructor(
    private readonly baseUrl: string,
    private readonly fallback: RoomRepository | null
  ) {}

  async loadRoom(roomId: string, coordinates: RoomCoordinates): Promise<RoomRecord> {
    const params = new URLSearchParams({
      x: String(coordinates.x),
      y: String(coordinates.y),
    });

    return this.withFallback(
      () => this.request(`/api/rooms/${encodeURIComponent(roomId)}?${params.toString()}`),
      () => this.fallback?.loadRoom(roomId, coordinates)
    );
  }

  async saveDraft(room: RoomSnapshot): Promise<RoomRecord> {
    return this.withFallback(
      () =>
        this.request(`/api/rooms/${encodeURIComponent(room.id)}/draft`, {
          method: 'PUT',
          body: JSON.stringify(room),
        }),
      () => this.fallback?.saveDraft(room)
    );
  }

  async publish(room: RoomSnapshot): Promise<RoomRecord> {
    return this.withFallback(
      () =>
        this.request(`/api/rooms/${encodeURIComponent(room.id)}/publish`, {
          method: 'POST',
          body: JSON.stringify(room),
        }),
      () => this.fallback?.publish(room)
    );
  }

  async revert(roomId: string, coordinates: RoomCoordinates, targetVersion: number): Promise<RoomRecord> {
    const params = new URLSearchParams({
      x: String(coordinates.x),
      y: String(coordinates.y),
    });
    const body: RoomRevertRequestBody = { targetVersion };

    return this.withFallback(
      () =>
        this.request(`/api/rooms/${encodeURIComponent(roomId)}/revert?${params.toString()}`, {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      () => this.fallback?.revert(roomId, coordinates, targetVersion)
    );
  }

  async prepareMint(roomId: string, coordinates: RoomCoordinates): Promise<RoomMintPrepareResponse> {
    const params = new URLSearchParams({
      x: String(coordinates.x),
      y: String(coordinates.y),
    });

    return this.request<RoomMintPrepareResponse>(
      `/api/rooms/${encodeURIComponent(roomId)}/mint/prepare?${params.toString()}`,
      {
        method: 'POST',
      }
    );
  }

  async confirmMint(
    roomId: string,
    coordinates: RoomCoordinates,
    request: RoomMintConfirmRequestBody
  ): Promise<RoomRecord> {
    const params = new URLSearchParams({
      x: String(coordinates.x),
      y: String(coordinates.y),
    });

    return this.request<RoomRecord>(
      `/api/rooms/${encodeURIComponent(roomId)}/mint/confirm?${params.toString()}`,
      {
        method: 'POST',
        body: JSON.stringify(request),
      }
    );
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);

    if (init?.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      credentials: 'include',
    });

    if (!response.ok) {
      const details = await response.text();
      let message = details || `Room API request failed with status ${response.status}.`;

      if (details) {
        try {
          const parsed = JSON.parse(details) as { error?: unknown };
          if (typeof parsed.error === 'string' && parsed.error.trim()) {
            message = parsed.error;
          }
        } catch {
          message = details;
        }
      }

      throw new RoomApiError(
        message,
        response.status
      );
    }

    const data = (await response.json()) as T;
    if (isRoomRecordResponse(data)) {
      return cloneRoomRecord(data) as T;
    }

    return data;
  }

  private async withFallback(
    remoteOperation: () => Promise<RoomRecord>,
    fallbackOperation: (() => Promise<RoomRecord> | undefined) | undefined
  ): Promise<RoomRecord> {
    try {
      return await remoteOperation();
    } catch (error) {
      if (!this.shouldFallback(error) || !fallbackOperation) {
        throw error;
      }

      const fallbackResult = await fallbackOperation();
      if (!fallbackResult) {
        throw error;
      }

      return fallbackResult;
    }
  }

  private shouldFallback(error: unknown): boolean {
    if (!this.fallback) return false;
    if (!import.meta.env.DEV) return false;
    if (error instanceof TypeError) return true;
    if (error instanceof RoomApiError && error.status === 404) return true;
    if (error instanceof RoomApiError && error.status >= 500) return true;
    return false;
  }
}

export function createRoomRepository(): RoomRepository {
  const backend = getRoomStorageBackend();
  const localRepository = createLocalRoomRepository();

  if (backend === 'local') {
    return localRepository;
  }

  return new ApiRoomRepository(
    getApiBaseUrl(),
    backend === 'auto' ? localRepository : null
  );
}

export function isRoomApiError(error: unknown): error is RoomApiError {
  return error instanceof RoomApiError;
}

function isRoomRecordResponse(value: unknown): value is RoomRecord {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'draft' in value &&
      'versions' in value &&
      'permissions' in value
  );
}

import {
  cloneRoomRecord,
  cloneRoomSnapshot,
  createRoomVersionRecord,
  createDefaultRoomRecord,
  createRoomRecordFromCurrent,
  createRoomSummaryFromRecord,
  DEFAULT_ROOM_COORDINATES,
  getRoomPublishValidationError,
  isRoomMinted,
  normalizeRoomRecord,
  type RoomLeaderboardLineageRequestBody,
  type RoomVersionRecord,
  type RoomCoordinates,
  type RoomCurrentRecord,
  type RoomRecord,
  type RoomRevertRequestBody,
  type RoomSnapshot,
  type RoomSnapshotQueryReference,
  type RoomSnapshotQueryResponse,
  type RoomSummary,
  type RoomVersionSummary,
  type RoomVersionsPage,
} from './roomModel';
import { ROOM_STORAGE_PREFIX } from './browserStorage';
import { invalidateSharedRoomPreviewCache } from './sharedRoomPreviewCache';
import { getApiBaseUrl } from '../api/baseUrl';
import { buildRoomVersionLineage } from './roomVersionLineage';
import { getManualRoomLeaderboardSourceValidationError } from './roomLeaderboardLineage';
import type {
  RoomMintConfirmRequestBody,
  RoomMintPrepareResponse,
} from '../mint/roomOwnership';
import type {
  RoomMetadataRefreshConfirmRequestBody,
  RoomMetadataRefreshPrepareRequestBody,
  RoomMetadataRefreshPrepareResponse,
} from '../mint/roomMetadata';

export * from './roomModel';

export type RoomPersistenceTarget = 'local' | 'remote';

export interface RoomRepository {
  loadRoom(roomId: string, coordinates: RoomCoordinates): Promise<RoomRecord>;
  loadRoomSummary(roomId: string, coordinates: RoomCoordinates): Promise<RoomSummary>;
  loadRoomCurrent(roomId: string, coordinates: RoomCoordinates): Promise<RoomCurrentRecord>;
  loadRoomVersions(roomId: string, limit?: number, cursor?: string): Promise<RoomVersionsPage>;
  loadExactRoomVersion(roomId: string, version: number): Promise<RoomVersionRecord>;
  queryRoomSnapshots(references: RoomSnapshotQueryReference[]): Promise<RoomSnapshotQueryResponse>;
  saveDraft(room: RoomSnapshot): Promise<RoomRecord>;
  publish(room: RoomSnapshot): Promise<RoomRecord>;
  revert(roomId: string, coordinates: RoomCoordinates, targetVersion: number): Promise<RoomRecord>;
  adminRestore(roomId: string, coordinates: RoomCoordinates, targetVersion: number): Promise<RoomRecord>;
  setCanonicalVersion(
    roomId: string,
    coordinates: RoomCoordinates,
    targetVersion: number
  ): Promise<RoomRecord>;
  setLeaderboardSourceVersion(
    roomId: string,
    coordinates: RoomCoordinates,
    targetVersion: number,
    sourceVersion: number | null
  ): Promise<RoomRecord>;
  prepareMint(roomId: string, coordinates: RoomCoordinates): Promise<RoomMintPrepareResponse>;
  confirmMint(
    roomId: string,
    coordinates: RoomCoordinates,
    request: RoomMintConfirmRequestBody
  ): Promise<RoomRecord>;
  prepareMetadataRefresh(
    roomId: string,
    coordinates: RoomCoordinates,
    request: RoomMetadataRefreshPrepareRequestBody
  ): Promise<RoomMetadataRefreshPrepareResponse>;
  confirmMetadataRefresh(
    roomId: string,
    coordinates: RoomCoordinates,
    request: RoomMetadataRefreshConfirmRequestBody
  ): Promise<RoomRecord>;
  getLastPersistenceTarget(): RoomPersistenceTarget | null;
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
  getLastPersistenceTarget(): RoomPersistenceTarget {
    return 'local';
  }

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

  async loadRoomSummary(roomId: string, coordinates: RoomCoordinates): Promise<RoomSummary> {
    return createRoomSummaryFromRecord(await this.loadRoom(roomId, coordinates));
  }

  async loadRoomCurrent(roomId: string, coordinates: RoomCoordinates): Promise<RoomCurrentRecord> {
    const record = await this.loadRoom(roomId, coordinates);
    return { summary: createRoomSummaryFromRecord(record), draft: record.draft, published: record.published };
  }

  async loadRoomVersions(roomId: string, limit = 25): Promise<RoomVersionsPage> {
    const record = await this.loadRoom(roomId, DEFAULT_ROOM_COORDINATES);
    const versions: RoomVersionSummary[] = [...record.versions].reverse().slice(0, limit).map((entry) => ({
      version: entry.version,
      title: entry.snapshot.title,
      createdAt: entry.createdAt,
      publishedByUserId: entry.publishedByUserId,
      publishedByPrincipalKind: entry.publishedByPrincipalKind,
      publishedByAgentId: entry.publishedByAgentId,
      publishedByDisplayName: entry.publishedByDisplayName,
      revertedFromVersion: entry.revertedFromVersion,
      leaderboardSourceVersion: entry.leaderboardSourceVersion,
    }));
    return { versions };
  }

  async loadExactRoomVersion(roomId: string, version: number): Promise<RoomVersionRecord> {
    const record = await this.loadRoom(roomId, DEFAULT_ROOM_COORDINATES);
    const match = record.versions.find((entry) => entry.version === version);
    if (!match) throw new Error('Room version not found.');
    return match;
  }

  async queryRoomSnapshots(references: RoomSnapshotQueryReference[]): Promise<RoomSnapshotQueryResponse> {
    const snapshots: RoomSnapshotQueryResponse['snapshots'] = [];
    const missing: RoomSnapshotQueryReference[] = [];
    for (const reference of references) {
      const record = await this.loadRoom(reference.roomId, reference.kind === 'current_preview'
        ? reference.coordinates ?? DEFAULT_ROOM_COORDINATES
        : DEFAULT_ROOM_COORDINATES);
      const snapshot = reference.kind === 'version'
        ? record.versions.find((entry) => entry.version === reference.version)?.snapshot ?? null
        : reference.state === 'claimed_unpublished' ? record.draft : record.published;
      if (snapshot) snapshots.push({
        key: reference.kind === 'version'
          ? `version:${reference.roomId}:${reference.version}`
          : `current:${reference.roomId}:${reference.state ?? 'published'}:${reference.updatedAt ?? ''}`,
        reference,
        snapshot,
      });
      else missing.push(reference);
    }
    return { snapshots, missing };
  }

  async saveDraft(room: RoomSnapshot): Promise<RoomRecord> {
    const existing = await this.loadRoom(room.id, room.coordinates);
    const now = new Date().toISOString();
    const shouldClaimDraft = !existing.claimerUserId && existing.published === null;

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
      canonicalVersion: existing.canonicalVersion,
      claimerUserId: shouldClaimDraft ? 'local-user' : existing.claimerUserId,
      claimerPrincipalKind: shouldClaimDraft ? 'user' : existing.claimerPrincipalKind,
      claimerAgentId: existing.claimerAgentId,
      claimerDisplayName: shouldClaimDraft ? 'Guest' : existing.claimerDisplayName,
      claimedAt: shouldClaimDraft ? now : existing.claimedAt,
      lastPublishedByUserId: existing.lastPublishedByUserId,
      lastPublishedByPrincipalKind: existing.lastPublishedByPrincipalKind,
      lastPublishedByAgentId: existing.lastPublishedByAgentId,
      lastPublishedByDisplayName: existing.lastPublishedByDisplayName,
      mintedChainId: existing.mintedChainId,
      mintedContractAddress: existing.mintedContractAddress,
      mintedTokenId: existing.mintedTokenId,
      mintedOwnerWalletAddress: existing.mintedOwnerWalletAddress,
      mintedOwnerSyncedAt: existing.mintedOwnerSyncedAt,
      mintedMetadataRoomVersion: existing.mintedMetadataRoomVersion,
      mintedMetadataUpdatedAt: existing.mintedMetadataUpdatedAt,
      mintedMetadataHash: existing.mintedMetadataHash,
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
    const normalizedRoom = cloneRoomSnapshot(room);
    const publishValidationError = getRoomPublishValidationError(normalizedRoom);
    if (publishValidationError) {
      throw new Error(publishValidationError);
    }

    const now = new Date().toISOString();
    const lastPublished = existing.versions[existing.versions.length - 1] ?? null;
    const lastPublishedVersion = lastPublished?.version ?? 0;
    const nextVersion = lastPublishedVersion > 0
      ? lastPublishedVersion + 1
      : Math.max(1, normalizedRoom.version);

    const published: RoomSnapshot = {
      ...normalizedRoom,
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
          publishedByPrincipalKind: null,
          publishedByAgentId: null,
          publishedByDisplayName: 'Guest',
          leaderboardSourceVersion: null,
        }),
      ],
      canonicalVersion: existing.canonicalVersion,
      claimerUserId: existing.claimerUserId ?? 'local-user',
      claimerPrincipalKind: existing.claimerPrincipalKind ?? 'user',
      claimerAgentId: existing.claimerAgentId,
      claimerDisplayName: existing.claimerDisplayName ?? 'Guest',
      claimedAt: existing.claimedAt ?? now,
      lastPublishedByUserId: null,
      lastPublishedByPrincipalKind: null,
      lastPublishedByAgentId: null,
      lastPublishedByDisplayName: 'Guest',
      mintedChainId: existing.mintedChainId,
      mintedContractAddress: existing.mintedContractAddress,
      mintedTokenId: existing.mintedTokenId,
      mintedOwnerWalletAddress: existing.mintedOwnerWalletAddress,
      mintedOwnerSyncedAt: existing.mintedOwnerSyncedAt,
      mintedMetadataRoomVersion: existing.mintedMetadataRoomVersion,
      mintedMetadataUpdatedAt: existing.mintedMetadataUpdatedAt,
      mintedMetadataHash: existing.mintedMetadataHash,
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
      publishedByPrincipalKind: existing.claimerPrincipalKind,
      publishedByAgentId: existing.claimerAgentId,
      publishedByDisplayName: existing.claimerDisplayName,
      revertedFromVersion: target.version,
      leaderboardSourceVersion: null,
    });

    const nextRecord: RoomRecord = {
      draft,
      published,
      versions: [...existing.versions, nextVersionRecord],
      canonicalVersion: existing.canonicalVersion,
      claimerUserId: existing.claimerUserId,
      claimerPrincipalKind: existing.claimerPrincipalKind,
      claimerAgentId: existing.claimerAgentId,
      claimerDisplayName: existing.claimerDisplayName,
      claimedAt: existing.claimedAt,
      lastPublishedByUserId: existing.claimerUserId,
      lastPublishedByPrincipalKind: existing.claimerPrincipalKind,
      lastPublishedByAgentId: existing.claimerAgentId,
      lastPublishedByDisplayName: existing.claimerDisplayName,
      mintedChainId: existing.mintedChainId,
      mintedContractAddress: existing.mintedContractAddress,
      mintedTokenId: existing.mintedTokenId,
      mintedOwnerWalletAddress: existing.mintedOwnerWalletAddress,
      mintedOwnerSyncedAt: existing.mintedOwnerSyncedAt,
      mintedMetadataRoomVersion: existing.mintedMetadataRoomVersion,
      mintedMetadataUpdatedAt: existing.mintedMetadataUpdatedAt,
      mintedMetadataHash: existing.mintedMetadataHash,
      permissions: computeLocalPermissions(existing),
    };

    localStorage.setItem(getStorageKey(roomId), JSON.stringify(nextRecord));
    return cloneRoomRecord(nextRecord);
  }

  async adminRestore(
    roomId: string,
    coordinates: RoomCoordinates,
    targetVersion: number
  ): Promise<RoomRecord> {
    const existing = await this.loadRoom(roomId, coordinates);
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
      publishedByUserId: existing.lastPublishedByUserId,
      publishedByPrincipalKind: existing.lastPublishedByPrincipalKind,
      publishedByAgentId: existing.lastPublishedByAgentId,
      publishedByDisplayName: existing.lastPublishedByDisplayName ?? 'Admin',
      revertedFromVersion: target.version,
      leaderboardSourceVersion: null,
    });

    const nextRecord: RoomRecord = {
      draft,
      published,
      versions: [...existing.versions, nextVersionRecord],
      canonicalVersion: existing.canonicalVersion,
      claimerUserId: existing.claimerUserId,
      claimerPrincipalKind: existing.claimerPrincipalKind,
      claimerAgentId: existing.claimerAgentId,
      claimerDisplayName: existing.claimerDisplayName,
      claimedAt: existing.claimedAt,
      lastPublishedByUserId: existing.lastPublishedByUserId,
      lastPublishedByPrincipalKind: existing.lastPublishedByPrincipalKind,
      lastPublishedByAgentId: existing.lastPublishedByAgentId,
      lastPublishedByDisplayName: existing.lastPublishedByDisplayName,
      mintedChainId: existing.mintedChainId,
      mintedContractAddress: existing.mintedContractAddress,
      mintedTokenId: existing.mintedTokenId,
      mintedOwnerWalletAddress: existing.mintedOwnerWalletAddress,
      mintedOwnerSyncedAt: existing.mintedOwnerSyncedAt,
      mintedMetadataRoomVersion: existing.mintedMetadataRoomVersion,
      mintedMetadataUpdatedAt: existing.mintedMetadataUpdatedAt,
      mintedMetadataHash: existing.mintedMetadataHash,
      permissions: computeLocalPermissions(existing),
    };

    localStorage.setItem(getStorageKey(roomId), JSON.stringify(nextRecord));
    return cloneRoomRecord(nextRecord);
  }

  async setCanonicalVersion(
    roomId: string,
    coordinates: RoomCoordinates,
    targetVersion: number
  ): Promise<RoomRecord> {
    const existing = await this.loadRoom(roomId, coordinates);
    if (!existing.permissions.canRevert) {
      throw new Error('You do not have permission to set the canonical version for this room.');
    }

    const target = existing.versions.find((version) => version.version === targetVersion) ?? null;
    if (!target) {
      throw new Error(`Version ${targetVersion} was not found.`);
    }

    const nextRecord: RoomRecord = {
      draft: existing.draft,
      published: existing.published,
      versions: existing.versions,
      canonicalVersion: target.version,
      claimerUserId: existing.claimerUserId,
      claimerPrincipalKind: existing.claimerPrincipalKind,
      claimerAgentId: existing.claimerAgentId,
      claimerDisplayName: existing.claimerDisplayName,
      claimedAt: existing.claimedAt,
      lastPublishedByUserId: existing.lastPublishedByUserId,
      lastPublishedByPrincipalKind: existing.lastPublishedByPrincipalKind,
      lastPublishedByAgentId: existing.lastPublishedByAgentId,
      lastPublishedByDisplayName: existing.lastPublishedByDisplayName,
      mintedChainId: existing.mintedChainId,
      mintedContractAddress: existing.mintedContractAddress,
      mintedTokenId: existing.mintedTokenId,
      mintedOwnerWalletAddress: existing.mintedOwnerWalletAddress,
      mintedOwnerSyncedAt: existing.mintedOwnerSyncedAt,
      mintedMetadataRoomVersion: existing.mintedMetadataRoomVersion,
      mintedMetadataUpdatedAt: existing.mintedMetadataUpdatedAt,
      mintedMetadataHash: existing.mintedMetadataHash,
      permissions: computeLocalPermissions(existing),
    };

    localStorage.setItem(getStorageKey(roomId), JSON.stringify(nextRecord));
    return cloneRoomRecord(nextRecord);
  }

  async setLeaderboardSourceVersion(
    roomId: string,
    coordinates: RoomCoordinates,
    targetVersion: number,
    sourceVersion: number | null
  ): Promise<RoomRecord> {
    const existing = await this.loadRoom(roomId, coordinates);
    if (!existing.permissions.canRevert) {
      throw new Error('You do not have permission to manage leaderboard lineage for this room.');
    }

    const target = existing.versions.find((version) => version.version === targetVersion) ?? null;
    if (!target) {
      throw new Error(`Version ${targetVersion} was not found.`);
    }

    if (sourceVersion !== null) {
      const source = existing.versions.find((version) => version.version === sourceVersion) ?? null;
      if (!source) {
        throw new Error(`Version ${sourceVersion} was not found.`);
      }

      const exactLineage = buildRoomVersionLineage(
        existing.versions,
        existing.canonicalVersion,
        existing.published?.version ?? null
      );
      const validationError = getManualRoomLeaderboardSourceValidationError(target, source, exactLineage);
      if (validationError) {
        throw new Error(validationError);
      }
    }

    const nextRecord: RoomRecord = {
      draft: existing.draft,
      published: existing.published,
      versions: existing.versions.map((version) =>
        version.version === targetVersion
          ? {
              ...version,
              leaderboardSourceVersion: sourceVersion,
              snapshot: cloneRoomSnapshot(version.snapshot),
            }
          : {
              ...version,
              snapshot: cloneRoomSnapshot(version.snapshot),
            }
      ),
      canonicalVersion: existing.canonicalVersion,
      claimerUserId: existing.claimerUserId,
      claimerPrincipalKind: existing.claimerPrincipalKind,
      claimerAgentId: existing.claimerAgentId,
      claimerDisplayName: existing.claimerDisplayName,
      claimedAt: existing.claimedAt,
      lastPublishedByUserId: existing.lastPublishedByUserId,
      lastPublishedByPrincipalKind: existing.lastPublishedByPrincipalKind,
      lastPublishedByAgentId: existing.lastPublishedByAgentId,
      lastPublishedByDisplayName: existing.lastPublishedByDisplayName,
      mintedChainId: existing.mintedChainId,
      mintedContractAddress: existing.mintedContractAddress,
      mintedTokenId: existing.mintedTokenId,
      mintedOwnerWalletAddress: existing.mintedOwnerWalletAddress,
      mintedOwnerSyncedAt: existing.mintedOwnerSyncedAt,
      mintedMetadataRoomVersion: existing.mintedMetadataRoomVersion,
      mintedMetadataUpdatedAt: existing.mintedMetadataUpdatedAt,
      mintedMetadataHash: existing.mintedMetadataHash,
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

  async prepareMetadataRefresh(
    _roomId: string,
    _coordinates: RoomCoordinates,
    _request: RoomMetadataRefreshPrepareRequestBody
  ): Promise<RoomMetadataRefreshPrepareResponse> {
    throw new Error('NFT metadata refresh requires the remote API backend.');
  }

  async confirmMetadataRefresh(
    _roomId: string,
    _coordinates: RoomCoordinates,
    _request: RoomMetadataRefreshConfirmRequestBody
  ): Promise<RoomRecord> {
    throw new Error('NFT metadata refresh requires the remote API backend.');
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
  private lastPersistenceTarget: RoomPersistenceTarget | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly fallback: RoomRepository | null
  ) {}

  getLastPersistenceTarget(): RoomPersistenceTarget | null {
    return this.lastPersistenceTarget;
  }

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

  async loadRoomSummary(roomId: string, coordinates: RoomCoordinates): Promise<RoomSummary> {
    const params = new URLSearchParams({ x: String(coordinates.x), y: String(coordinates.y) });
    return this.withFallback(
      () => this.request(`/api/rooms/${encodeURIComponent(roomId)}/summary?${params.toString()}`),
      () => this.fallback?.loadRoomSummary(roomId, coordinates),
    );
  }

  async loadRoomCurrent(roomId: string, coordinates: RoomCoordinates): Promise<RoomCurrentRecord> {
    const params = new URLSearchParams({ x: String(coordinates.x), y: String(coordinates.y) });
    return this.withFallback(
      () => this.request(`/api/rooms/${encodeURIComponent(roomId)}/current?${params.toString()}`),
      () => this.fallback?.loadRoomCurrent(roomId, coordinates),
    );
  }

  async loadRoomVersions(roomId: string, limit = 25, cursor?: string): Promise<RoomVersionsPage> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    return this.withFallback(
      () => this.request(`/api/rooms/${encodeURIComponent(roomId)}/versions?${params.toString()}`),
      () => this.fallback?.loadRoomVersions(roomId, limit, cursor),
    );
  }

  async loadExactRoomVersion(roomId: string, version: number): Promise<RoomVersionRecord> {
    return this.withFallback(
      () => this.request(`/api/rooms/${encodeURIComponent(roomId)}/versions/${version}`),
      () => this.fallback?.loadExactRoomVersion(roomId, version),
    );
  }

  async queryRoomSnapshots(references: RoomSnapshotQueryReference[]): Promise<RoomSnapshotQueryResponse> {
    return this.withFallback(
      () => this.request('/api/rooms/snapshots/query', { method: 'POST', body: JSON.stringify({ references }) }),
      () => this.fallback?.queryRoomSnapshots(references),
    );
  }

  async saveDraft(room: RoomSnapshot): Promise<RoomRecord> {
    return this.withFallback(
      async () => this.compactMutationRecord(
        await this.request(`/api/rooms/${encodeURIComponent(room.id)}/draft?response=compact`, {
          method: 'PUT',
          body: JSON.stringify(room),
        }),
      ),
      () => this.fallback?.saveDraft(room)
    );
  }

  async publish(room: RoomSnapshot): Promise<RoomRecord> {
    return this.withFallback(
      async () => {
        const current = await this.request<RoomCurrentRecord>(`/api/rooms/${encodeURIComponent(room.id)}/publish?response=compact`, {
          method: 'POST',
          body: JSON.stringify(room),
        });
        return this.compactMutationRecord(current);
      },
      () => this.fallback?.publish(room)
    );
  }

  async revert(roomId: string, coordinates: RoomCoordinates, targetVersion: number): Promise<RoomRecord> {
    const params = new URLSearchParams({
      x: String(coordinates.x),
      y: String(coordinates.y),
      response: 'compact',
    });
    const body: RoomRevertRequestBody = { targetVersion };

    return this.withFallback(
      async () => {
        params.set('response', 'compact');
        const current = await this.request<RoomCurrentRecord>(`/api/rooms/${encodeURIComponent(roomId)}/revert?${params.toString()}`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        return this.compactMutationRecord(current);
      },
      () => this.fallback?.revert(roomId, coordinates, targetVersion)
    );
  }

  async adminRestore(
    roomId: string,
    coordinates: RoomCoordinates,
    targetVersion: number
  ): Promise<RoomRecord> {
    const params = new URLSearchParams({
      x: String(coordinates.x),
      y: String(coordinates.y),
      response: 'compact',
    });
    const body: RoomRevertRequestBody = { targetVersion };

    return this.withFallback(
      () =>
        this.request<RoomCurrentRecord>(
          `/api/admin/rooms/${encodeURIComponent(roomId)}/restore?${params.toString()}`,
          {
            method: 'POST',
            body: JSON.stringify(body),
          }
        ).then((current) => this.compactMutationRecord(current)),
      () => this.fallback?.adminRestore(roomId, coordinates, targetVersion)
    );
  }

  async setCanonicalVersion(
    roomId: string,
    coordinates: RoomCoordinates,
    targetVersion: number
  ): Promise<RoomRecord> {
    const params = new URLSearchParams({
      x: String(coordinates.x),
      y: String(coordinates.y),
      response: 'compact',
    });

    return this.withFallback(
      () =>
        this.request<RoomCurrentRecord>(
          `/api/rooms/${encodeURIComponent(roomId)}/canonical?${params.toString()}`,
          {
            method: 'POST',
            body: JSON.stringify({ targetVersion }),
          }
        ).then((current) => this.compactMutationRecord(current)),
      () => this.fallback?.setCanonicalVersion(roomId, coordinates, targetVersion)
    );
  }

  async setLeaderboardSourceVersion(
    roomId: string,
    coordinates: RoomCoordinates,
    targetVersion: number,
    sourceVersion: number | null
  ): Promise<RoomRecord> {
    const params = new URLSearchParams({
      x: String(coordinates.x),
      y: String(coordinates.y),
      response: 'compact',
    });
    const body: RoomLeaderboardLineageRequestBody = { targetVersion, sourceVersion };

    return this.withFallback(
      () =>
        this.request<RoomCurrentRecord>(
          `/api/rooms/${encodeURIComponent(roomId)}/leaderboard-lineage?${params.toString()}`,
          {
            method: 'POST',
            body: JSON.stringify(body),
          }
        ).then((current) => this.compactMutationRecord(current)),
      () => this.fallback?.setLeaderboardSourceVersion(roomId, coordinates, targetVersion, sourceVersion)
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

  async prepareMetadataRefresh(
    roomId: string,
    coordinates: RoomCoordinates,
    request: RoomMetadataRefreshPrepareRequestBody
  ): Promise<RoomMetadataRefreshPrepareResponse> {
    const params = new URLSearchParams({
      x: String(coordinates.x),
      y: String(coordinates.y),
    });

    return this.request<RoomMetadataRefreshPrepareResponse>(
      `/api/rooms/${encodeURIComponent(roomId)}/mint/metadata/prepare?${params.toString()}`,
      {
        method: 'POST',
        body: JSON.stringify(request),
      }
    );
  }

  async confirmMetadataRefresh(
    roomId: string,
    coordinates: RoomCoordinates,
    request: RoomMetadataRefreshConfirmRequestBody
  ): Promise<RoomRecord> {
    const params = new URLSearchParams({
      x: String(coordinates.x),
      y: String(coordinates.y),
    });

    return this.request<RoomRecord>(
      `/api/rooms/${encodeURIComponent(roomId)}/mint/metadata/confirm?${params.toString()}`,
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
      if (init?.method && init.method !== 'GET') invalidateSharedRoomPreviewCache(data.draft.id);
      return cloneRoomRecord(data) as T;
    }

    return data;
  }

  private compactMutationRecord(current: RoomCurrentRecord): RoomRecord {
    invalidateSharedRoomPreviewCache(current.draft.id);
    return createRoomRecordFromCurrent(current);
  }

  private async withFallback<T>(
    remoteOperation: () => Promise<T>,
    fallbackOperation: (() => Promise<T> | undefined) | undefined
  ): Promise<T> {
    try {
      const remoteResult = await remoteOperation();
      this.lastPersistenceTarget = 'remote';
      return remoteResult;
    } catch (error) {
      if (!this.shouldFallback(error) || !fallbackOperation) {
        throw error;
      }

      const fallbackResult = await fallbackOperation();
      if (!fallbackResult) {
        throw error;
      }

      this.lastPersistenceTarget = 'local';
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

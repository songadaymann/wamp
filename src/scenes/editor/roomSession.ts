import {
  DEFAULT_ROOM_COORDINATES,
  DEFAULT_ROOM_ID,
  cloneRoomSnapshot,
  createLocalRoomRepository,
  isRoomApiError,
  isRoomSnapshotBlank,
  type RoomCoordinates,
  type RoomPermissions,
  type RoomRecord,
  type RoomSnapshot,
  type RoomVersionRecord,
} from '../../persistence/roomRepository';
import type { RoomRepository } from '../../persistence/roomRepository';
import {
  getAuthDebugState,
  promptForSignIn,
  refreshAuthSession,
  sendPreparedWalletTransaction,
} from '../../auth/client';
import { clearLocalRoomStorageEntry } from '../../persistence/browserStorage';
import {
  buildExplorerTxUrl,
  formatWalletAddress,
} from '../../mint/roomOwnership';
import type { OverworldPlaySceneData } from '../sceneData';

interface EditorRoomSessionHost {
  applyRoomSnapshot(room: RoomSnapshot): void;
  exportRoomSnapshot(): RoomSnapshot;
  getRoomDirty(): boolean;
  setRoomDirty(dirty: boolean): void;
  getLastDirtyAt(): number;
  refreshUi(): void;
  refreshSurroundingRoomPreviews(): void;
}

export interface EditorHistoryState {
  roomId: string;
  claimerDisplayName: string | null;
  claimedAt: string | null;
  canRevert: boolean;
  canPublish: boolean;
  canMint: boolean;
  mintedTokenId: string | null;
  mintedOwnerWalletAddress: string | null;
  versions: RoomVersionRecord[];
}

export class EditorRoomSession {
  private readonly AUTO_SAVE_DELAY_MS = 600;

  private roomId = DEFAULT_ROOM_ID;
  private roomCoordinates = DEFAULT_ROOM_COORDINATES;
  private roomVersion = 1;
  private publishedVersion = 0;
  private roomTitle: string | null = null;
  private roomCreatedAt = '';
  private roomUpdatedAt = '';
  private roomPublishedAt: string | null = null;
  private roomPermissions: RoomPermissions = {
    canSaveDraft: true,
    canPublish: true,
    canRevert: false,
    canMint: false,
  };
  private roomVersionHistory: RoomVersionRecord[] = [];
  private claimerDisplayName: string | null = null;
  private claimedAt: string | null = null;
  private mintedChainId: number | null = null;
  private mintedContractAddress: string | null = null;
  private mintedTokenId: string | null = null;
  private mintedOwnerWalletAddress: string | null = null;
  private mintedOwnerSyncedAt: string | null = null;
  private saveInFlight = false;
  private persistenceStatusText = '';
  private readonly localRoomRepository: RoomRepository = createLocalRoomRepository();

  constructor(
    private readonly roomRepository: RoomRepository,
    private readonly host: EditorRoomSessionHost,
  ) {}

  get currentRoomId(): string {
    return this.roomId;
  }

  set currentRoomId(value: string) {
    this.roomId = value;
  }

  get currentRoomCoordinates(): RoomCoordinates {
    return this.roomCoordinates;
  }

  set currentRoomCoordinates(value: RoomCoordinates) {
    this.roomCoordinates = { ...value };
  }

  get currentRoomVersion(): number {
    return this.roomVersion;
  }

  get currentPublishedVersion(): number {
    return this.publishedVersion;
  }

  get currentRoomTitle(): string | null {
    return this.roomTitle;
  }

  set currentRoomTitle(value: string | null) {
    this.roomTitle = value;
  }

  get currentRoomCreatedAt(): string {
    return this.roomCreatedAt;
  }

  get currentRoomUpdatedAt(): string {
    return this.roomUpdatedAt;
  }

  get currentRoomPublishedAt(): string | null {
    return this.roomPublishedAt;
  }

  get currentRoomPermissions(): RoomPermissions {
    return this.roomPermissions;
  }

  get currentRoomVersionHistory(): RoomVersionRecord[] {
    return this.roomVersionHistory;
  }

  get currentClaimerDisplayName(): string | null {
    return this.claimerDisplayName;
  }

  get currentClaimedAt(): string | null {
    return this.claimedAt;
  }

  get currentMintedChainId(): number | null {
    return this.mintedChainId;
  }

  get currentMintedContractAddress(): string | null {
    return this.mintedContractAddress;
  }

  get currentMintedTokenId(): string | null {
    return this.mintedTokenId;
  }

  get currentMintedOwnerWalletAddress(): string | null {
    return this.mintedOwnerWalletAddress;
  }

  get currentMintedOwnerSyncedAt(): string | null {
    return this.mintedOwnerSyncedAt;
  }

  get isSaveInFlight(): boolean {
    return this.saveInFlight;
  }

  get statusText(): string {
    return this.persistenceStatusText;
  }

  reset(): void {
    this.roomId = DEFAULT_ROOM_ID;
    this.roomCoordinates = { ...DEFAULT_ROOM_COORDINATES };
    this.roomVersion = 1;
    this.publishedVersion = 0;
    this.roomTitle = null;
    this.roomCreatedAt = '';
    this.roomUpdatedAt = '';
    this.roomPublishedAt = null;
    this.roomPermissions = {
      canSaveDraft: true,
      canPublish: true,
      canRevert: false,
      canMint: false,
    };
    this.roomVersionHistory = [];
    this.claimerDisplayName = null;
    this.claimedAt = null;
    this.mintedChainId = null;
    this.mintedContractAddress = null;
    this.mintedTokenId = null;
    this.mintedOwnerWalletAddress = null;
    this.mintedOwnerSyncedAt = null;
    this.saveInFlight = false;
    this.persistenceStatusText = '';
  }

  setStatusText(text: string): void {
    this.persistenceStatusText = text;
    this.host.refreshUi();
  }

  getIdleStatusText(): string {
    if (this.mintedTokenId) {
      if (this.roomPermissions.canSaveDraft) {
        return `Minted room token #${this.mintedTokenId}. Owner: ${formatWalletAddress(this.mintedOwnerWalletAddress)}.`;
      }

      return `Minted room owned by ${formatWalletAddress(this.mintedOwnerWalletAddress)}. Edit locked.`;
    }

    if (this.claimerDisplayName) {
      return `Claimed by ${this.claimerDisplayName}.`;
    }

    if (this.publishedVersion > 0) {
      return `Editing published room v${this.publishedVersion}.`;
    }

    return 'Editing frontier draft.';
  }

  getHistoryState(): EditorHistoryState {
    return {
      roomId: this.roomId,
      claimerDisplayName: this.claimerDisplayName,
      claimedAt: this.claimedAt,
      canRevert: this.roomPermissions.canRevert,
      canPublish: this.roomPermissions.canPublish,
      canMint: this.roomPermissions.canMint,
      mintedTokenId: this.mintedTokenId,
      mintedOwnerWalletAddress: this.mintedOwnerWalletAddress,
      versions: this.roomVersionHistory.map((version) => ({
        ...version,
        snapshot: cloneRoomSnapshot(version.snapshot),
      })),
    };
  }

  maybeAutoSave(isPlaying: boolean): void {
    if (
      !this.host.getRoomDirty()
      || this.saveInFlight
      || isPlaying
      || !this.roomPermissions.canSaveDraft
    ) {
      return;
    }

    if (performance.now() - this.host.getLastDirtyAt() < this.AUTO_SAVE_DELAY_MS) {
      return;
    }

    void this.saveDraft();
  }

  async loadPersistedRoom(initialRoomSnapshot: RoomSnapshot | null): Promise<void> {
    this.setStatusText('Loading draft...');

    try {
      const remoteRecord = await this.roomRepository.loadRoom(this.roomId, this.roomCoordinates);
      const localRecord = await this.getRecoverableLocalDraft(remoteRecord);
      const activeRecord = localRecord ?? remoteRecord;
      this.syncRoomMetadata(activeRecord);
      this.host.applyRoomSnapshot(
        this.resolveRoomSnapshotForEditing(activeRecord, initialRoomSnapshot)
      );
      this.host.refreshSurroundingRoomPreviews();
      this.setStatusText(
        localRecord
          ? getAuthDebugState().authenticated
            ? 'Recovered local draft. Save or publish to sync it.'
            : 'Recovered local guest draft.'
          : this.getIdleStatusText()
      );
    } catch (error) {
      console.error('Failed to load room draft', error);
      this.setStatusText('Failed to load draft.');
    }
  }

  async saveDraft(force: boolean = false): Promise<RoomRecord | null> {
    if (this.saveInFlight) {
      return null;
    }
    if (!force && !this.host.getRoomDirty()) {
      return null;
    }
    if (!this.roomPermissions.canSaveDraft) {
      this.setStatusText('Only the room token owner can save this room.');
      return null;
    }

    const saveStartedAt = this.host.getLastDirtyAt();
    this.saveInFlight = true;
    this.setStatusText('Saving draft...');

    try {
      const record = await this.roomRepository.saveDraft(this.host.exportRoomSnapshot());
      this.syncRoomMetadata(record);
      clearLocalRoomStorageEntry(this.roomId);

      if (this.host.getLastDirtyAt() === saveStartedAt) {
        this.host.setRoomDirty(false);
      }

      const publishSuffix = this.publishedVersion > 0 ? ` Published v${this.publishedVersion}.` : '';
      this.setStatusText(`Draft saved v${this.roomVersion}.${publishSuffix}`);
      return record;
    } catch (error) {
      if (this.shouldPersistGuestDraftLocally(error)) {
        return this.saveDraftLocally(
          saveStartedAt,
          'Draft saved locally. Sign in to publish.'
        );
      }

      console.error('Failed to save room draft', error);
      this.setStatusText('Draft save failed.');
    } finally {
      this.saveInFlight = false;
      this.host.refreshUi();
    }

    return null;
  }

  async publishRoom(successText?: string): Promise<RoomRecord | null> {
    if (this.saveInFlight) {
      return null;
    }
    if (!this.roomPermissions.canPublish) {
      this.setStatusText('Only the room token owner can publish this room.');
      return null;
    }
    await refreshAuthSession();
    if (!getAuthDebugState().authenticated) {
      await this.saveDraftLocally(
        this.host.getLastDirtyAt(),
        'Draft saved locally. Sign in to publish.'
      );
      promptForSignIn('Sign in to publish this room. Your local draft is safe.');
      return null;
    }

    this.saveInFlight = true;
    this.setStatusText('Publishing...');

    try {
      const record = await this.roomRepository.publish(this.host.exportRoomSnapshot());
      this.syncRoomMetadata(record);
      clearLocalRoomStorageEntry(this.roomId);
      await refreshAuthSession();
      this.host.setRoomDirty(false);
      this.setStatusText(successText ?? `Published v${this.publishedVersion}.`);
      return record;
    } catch (error) {
      if (this.shouldPersistGuestDraftLocally(error)) {
        await this.saveDraftLocally(
          this.host.getLastDirtyAt(),
          'Draft saved locally. Sign in to publish.'
        );
        promptForSignIn('Sign in to publish this room. Your local draft is safe.');
        return null;
      }

      console.error('Failed to publish room', error);
      const message = error instanceof Error ? error.message : 'Publish failed.';
      this.setStatusText(message);
    } finally {
      this.saveInFlight = false;
      this.host.refreshUi();
    }

    return null;
  }

  async revertToVersion(
    targetVersion: number,
    initialRoomSnapshot: RoomSnapshot | null,
  ): Promise<RoomRecord | null> {
    if (this.saveInFlight) {
      return null;
    }
    if (!this.roomPermissions.canRevert) {
      this.setStatusText(
        this.mintedTokenId
          ? 'Only the room token owner can revert this room.'
          : 'Only the claimer can revert this room.'
      );
      return null;
    }

    this.saveInFlight = true;
    this.setStatusText(`Reverting to v${targetVersion}...`);

    try {
      const record = await this.roomRepository.revert(this.roomId, this.roomCoordinates, targetVersion);
      this.syncRoomMetadata(record);
      this.host.applyRoomSnapshot(this.resolveRoomSnapshotForEditing(record, initialRoomSnapshot));
      this.setStatusText(`Reverted to v${targetVersion}.`);
      return record;
    } catch (error) {
      console.error('Failed to revert room version', error);
      const message = error instanceof Error ? error.message : 'Revert failed.';
      this.setStatusText(message);
    } finally {
      this.saveInFlight = false;
      this.host.refreshUi();
    }

    return null;
  }

  async buildReturnToWorldWakeData(): Promise<OverworldPlaySceneData | null> {
    if (!this.host.getRoomDirty()) {
      return {
        centerCoordinates: { ...this.roomCoordinates },
        roomCoordinates: { ...this.roomCoordinates },
        draftRoom: this.shouldShowDraftPreviewInWorld() ? this.host.exportRoomSnapshot() : null,
        clearDraftRoomId: this.shouldShowDraftPreviewInWorld() ? null : this.roomId,
        mode: 'browse',
      };
    }

    if (!this.roomPermissions.canSaveDraft && !this.roomPermissions.canPublish) {
      return {
        centerCoordinates: { ...this.roomCoordinates },
        roomCoordinates: { ...this.roomCoordinates },
        statusMessage: 'Read-only room changes were not saved.',
        draftRoom: null,
        clearDraftRoomId: this.roomId,
        mode: 'browse',
      };
    }

    const publishedRecord = await this.publishRoom('Auto-published on exit.');
    if (publishedRecord) {
      return {
        centerCoordinates: { ...this.roomCoordinates },
        roomCoordinates: { ...this.roomCoordinates },
        statusMessage: 'Auto-published on exit.',
        draftRoom: null,
        clearDraftRoomId: this.roomId,
        mode: 'browse',
      };
    }

    const draftRecord = await this.saveDraft(true);
    if (!draftRecord) {
      this.setStatusText('Publish failed. Draft save failed.');
      return null;
    }

    this.setStatusText('Publish failed, draft saved instead.');
    return {
      centerCoordinates: { ...this.roomCoordinates },
      roomCoordinates: { ...this.roomCoordinates },
      statusMessage: 'Publish failed, draft saved instead.',
      draftRoom: this.host.exportRoomSnapshot(),
      clearDraftRoomId: null,
      mode: 'browse',
    };
  }

  async mintRoom(): Promise<RoomRecord | null> {
    if (this.saveInFlight) {
      return null;
    }

    if (this.mintedTokenId) {
      this.setStatusText(`Room token #${this.mintedTokenId} is already minted.`);
      return null;
    }

    if (this.host.getRoomDirty() || this.publishedVersion === 0) {
      const publishedRecord = await this.publishRoom(
        this.publishedVersion === 0 ? 'Published. Ready to mint.' : 'Published latest changes before mint.'
      );
      if (!publishedRecord) {
        return null;
      }
    }

    if (!this.roomPermissions.canMint) {
      this.setStatusText('Link the owning wallet and publish the room before minting.');
      return null;
    }

    this.saveInFlight = true;
    this.setStatusText('Preparing mint...');

    try {
      const prepare = await this.roomRepository.prepareMint(this.roomId, this.roomCoordinates);
      this.setStatusText(`Waiting for wallet confirmation on ${prepare.chain.name}...`);
      const tx = await sendPreparedWalletTransaction(prepare.transaction, prepare.chain);
      this.setStatusText('Confirming mint...');

      const record = await this.roomRepository.confirmMint(this.roomId, this.roomCoordinates, {
        txHash: tx.hash,
      });
      this.syncRoomMetadata(record);
      this.host.setRoomDirty(false);

      const explorerUrl = buildExplorerTxUrl(prepare.chain, tx.hash);
      this.setStatusText(
        explorerUrl
          ? `Minted room token #${record.mintedTokenId}. ${explorerUrl}`
          : `Minted room token #${record.mintedTokenId}.`
      );
      return record;
    } catch (error) {
      console.error('Failed to mint room', error);
      if (isRoomApiError(error) && error.status === 409) {
        const refreshed = await this.roomRepository.loadRoom(this.roomId, this.roomCoordinates);
        this.syncRoomMetadata(refreshed);
      }

      const message = error instanceof Error ? error.message : 'Mint failed.';
      this.setStatusText(message);
    } finally {
      this.saveInFlight = false;
      this.host.refreshUi();
    }

    return null;
  }

  private shouldShowDraftPreviewInWorld(): boolean {
    return this.roomPublishedAt === null || this.roomUpdatedAt !== this.roomPublishedAt;
  }

  private async getRecoverableLocalDraft(remoteRecord: RoomRecord): Promise<RoomRecord | null> {
    const localRecord = await this.localRoomRepository.loadRoom(this.roomId, this.roomCoordinates);
    if (isRoomSnapshotBlank(localRecord.draft)) {
      return null;
    }

    if (localRecord.published !== null) {
      return null;
    }

    if (remoteRecord.published !== null) {
      return null;
    }

    if (!isRoomSnapshotBlank(remoteRecord.draft)) {
      return null;
    }

    return localRecord;
  }

  private shouldPersistGuestDraftLocally(error: unknown): boolean {
    return isRoomApiError(error) && error.status === 401;
  }

  private async saveDraftLocally(
    saveStartedAt: number,
    successText: string
  ): Promise<RoomRecord | null> {
    const record = await this.localRoomRepository.saveDraft(this.host.exportRoomSnapshot());
    this.syncRoomMetadata(record);

    if (this.host.getLastDirtyAt() === saveStartedAt) {
      this.host.setRoomDirty(false);
    }

    this.setStatusText(successText);
    return record;
  }

  private syncRoomMetadata(record: RoomRecord): void {
    this.roomId = record.draft.id;
    this.roomCoordinates = { ...record.draft.coordinates };
    this.roomVersion = record.draft.version;
    this.publishedVersion = record.published?.version ?? 0;
    this.roomTitle = record.draft.title;
    this.roomCreatedAt = record.draft.createdAt;
    this.roomUpdatedAt = record.draft.updatedAt;
    this.roomPublishedAt = record.published?.publishedAt ?? null;
    this.roomPermissions = { ...record.permissions };
    this.roomVersionHistory = record.versions.map((version) => ({
      ...version,
      snapshot: cloneRoomSnapshot(version.snapshot),
    }));
    this.claimerDisplayName = record.claimerDisplayName;
    this.claimedAt = record.claimedAt;
    this.mintedChainId = record.mintedChainId;
    this.mintedContractAddress = record.mintedContractAddress;
    this.mintedTokenId = record.mintedTokenId;
    this.mintedOwnerWalletAddress = record.mintedOwnerWalletAddress;
    this.mintedOwnerSyncedAt = record.mintedOwnerSyncedAt;
    this.host.refreshUi();
  }

  private resolveRoomSnapshotForEditing(
    record: RoomRecord,
    initialRoomSnapshot: RoomSnapshot | null,
  ): RoomSnapshot {
    if (initialRoomSnapshot && this.shouldPreferInitialRoomSnapshot(record, initialRoomSnapshot)) {
      return this.getEditableSnapshotFromSource(initialRoomSnapshot);
    }

    if (record.published && this.shouldPreferPublishedSnapshot(record)) {
      return this.getEditableSnapshotFromSource(record.published);
    }

    return cloneRoomSnapshot(record.draft);
  }

  private shouldPreferInitialRoomSnapshot(
    record: RoomRecord,
    initialRoomSnapshot: RoomSnapshot,
  ): boolean {
    return isRoomSnapshotBlank(record.draft) && !isRoomSnapshotBlank(initialRoomSnapshot);
  }

  private shouldPreferPublishedSnapshot(record: RoomRecord): boolean {
    return Boolean(record.published && isRoomSnapshotBlank(record.draft) && !isRoomSnapshotBlank(record.published));
  }

  private getEditableSnapshotFromSource(source: RoomSnapshot): RoomSnapshot {
    const snapshot = cloneRoomSnapshot(source);
    snapshot.status = 'draft';
    snapshot.version = this.roomVersion;
    snapshot.createdAt = this.roomCreatedAt || snapshot.createdAt;
    snapshot.updatedAt = this.roomUpdatedAt || snapshot.updatedAt;
    snapshot.publishedAt = this.roomPublishedAt ?? snapshot.publishedAt;
    return snapshot;
  }
}

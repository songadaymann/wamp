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
import { buildRoomTokenMetadata } from '../../mint/roomMetadata';
import { renderRoomSnapshotToPngDataUrl } from '../../mint/roomMetadataRender';
import {
  hideBusyOverlay,
  showBusyOverlay,
  updateBusyOverlay,
} from '../../ui/appFeedback';
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
  canRefreshMintMetadata: boolean;
  canonicalVersion: number | null;
  mintedTokenId: string | null;
  mintedOwnerWalletAddress: string | null;
  mintedMetadataRoomVersion: number | null;
  mintedMetadataUpdatedAt: string | null;
  mintedMetadataCurrent: boolean;
  versions: RoomVersionRecord[];
}

export interface EditorStatusDetails {
  text: string;
  accentText: string;
  linkLabel: string;
  linkHref: string | null;
}

interface SaveDraftOptions {
  promptForSignInOnUnauthorized?: boolean;
}

export class EditorRoomSession {
  private readonly AUTO_SAVE_DELAY_MS = 600;
  private readonly DRAFT_VISIBILITY_WARNING = 'Draft only. Not visible in the world until published.';
  private readonly DRAFT_WORLD_PREVIEW_WARNING = 'Only you can see this draft preview. Publish to make it public.';

  private roomId = DEFAULT_ROOM_ID;
  private roomCoordinates = DEFAULT_ROOM_COORDINATES;
  private roomVersion = 1;
  private publishedVersion = 0;
  private canonicalVersion: number | null = null;
  private roomTitle: string | null = null;
  private roomCreatedAt = '';
  private roomUpdatedAt = '';
  private roomPublishedAt: string | null = null;
  private publishedRoomSnapshot: RoomSnapshot | null = null;
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
  private mintedMetadataRoomVersion: number | null = null;
  private mintedMetadataUpdatedAt: string | null = null;
  private mintedMetadataHash: string | null = null;
  private saveInFlight = false;
  private persistenceStatus: EditorStatusDetails = {
    text: '',
    accentText: '',
    linkLabel: '',
    linkHref: null,
  };
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
    return this.persistenceStatus.text;
  }

  get statusDetails(): EditorStatusDetails {
    return { ...this.persistenceStatus };
  }

  hasDraftPreviewInWorld(): boolean {
    return this.shouldShowDraftPreviewInWorld();
  }

  reset(): void {
    this.roomId = DEFAULT_ROOM_ID;
    this.roomCoordinates = { ...DEFAULT_ROOM_COORDINATES };
    this.roomVersion = 1;
    this.publishedVersion = 0;
    this.canonicalVersion = null;
    this.roomTitle = null;
    this.roomCreatedAt = '';
    this.roomUpdatedAt = '';
    this.roomPublishedAt = null;
    this.publishedRoomSnapshot = null;
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
    this.mintedMetadataRoomVersion = null;
    this.mintedMetadataUpdatedAt = null;
    this.mintedMetadataHash = null;
    this.saveInFlight = false;
    this.persistenceStatus = {
      text: '',
      accentText: '',
      linkLabel: '',
      linkHref: null,
    };
  }

  setStatusText(text: string): void {
    this.setStatusDetails({
      text,
      accentText: '',
      linkLabel: '',
      linkHref: null,
    });
  }

  setStatusDetails(details: EditorStatusDetails): void {
    this.persistenceStatus = { ...details };
    this.host.refreshUi();
  }

  getIdleStatusText(): string {
    const details = this.getIdleStatusDetails();
    return details.accentText ? `${details.accentText}. ${details.text}`.trim() : details.text;
  }

  getIdleStatusDetails(): EditorStatusDetails {
    if (this.mintedTokenId) {
      const accentText = `Minted token #${this.mintedTokenId}`;
      if (this.roomPermissions.canSaveDraft) {
        if (this.mintedMetadataRoomVersion === null) {
          return {
            text: `Owner: ${formatWalletAddress(this.mintedOwnerWalletAddress)}. NFT metadata is not on-chain yet.`,
            accentText,
            linkLabel: '',
            linkHref: null,
          };
        }

        if (!this.isMintMetadataCurrent()) {
          return {
            text: `Owner: ${formatWalletAddress(this.mintedOwnerWalletAddress)}. NFT metadata is stale (on-chain v${this.mintedMetadataRoomVersion}, room v${this.publishedVersion}).`,
            accentText,
            linkLabel: '',
            linkHref: null,
          };
        }

        return {
          text: `Owner: ${formatWalletAddress(this.mintedOwnerWalletAddress)}. NFT metadata is current at v${this.mintedMetadataRoomVersion}.`,
          accentText,
          linkLabel: '',
          linkHref: null,
        };
      }

      return {
        text: `Owned by ${formatWalletAddress(this.mintedOwnerWalletAddress)}. Edit locked.`,
        accentText,
        linkLabel: '',
        linkHref: null,
      };
    }

    if (this.claimerDisplayName) {
      return {
        text: `Claimed by ${this.claimerDisplayName}.`,
        accentText: '',
        linkLabel: '',
        linkHref: null,
      };
    }

    if (this.publishedVersion > 0) {
      return {
        text: `Editing published room v${this.publishedVersion}.`,
        accentText: '',
        linkLabel: '',
        linkHref: null,
      };
    }

    return {
      text: this.DRAFT_VISIBILITY_WARNING,
      accentText: '',
      linkLabel: '',
      linkHref: null,
    };
  }

  getHistoryState(): EditorHistoryState {
    return {
      roomId: this.roomId,
      claimerDisplayName: this.claimerDisplayName,
      claimedAt: this.claimedAt,
      canRevert: this.roomPermissions.canRevert,
      canPublish: this.roomPermissions.canPublish,
      canMint: this.roomPermissions.canMint,
      canRefreshMintMetadata: this.canRefreshMintMetadata(),
      canonicalVersion: this.canonicalVersion,
      mintedTokenId: this.mintedTokenId,
      mintedOwnerWalletAddress: this.mintedOwnerWalletAddress,
      mintedMetadataRoomVersion: this.mintedMetadataRoomVersion,
      mintedMetadataUpdatedAt: this.mintedMetadataUpdatedAt,
      mintedMetadataCurrent: this.isMintMetadataCurrent(),
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

  async loadPersistedRoom(initialRoomSnapshot: RoomSnapshot | null): Promise<boolean> {
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
            ? `Recovered local draft. ${this.DRAFT_VISIBILITY_WARNING}`
            : `Recovered local guest draft. ${this.DRAFT_VISIBILITY_WARNING}`
          : this.getIdleStatusText()
      );
      return true;
    } catch (error) {
      console.error('Failed to load room draft', error);
      this.setStatusText('Failed to load draft.');
      return false;
    }
  }

  async saveDraft(
    force: boolean = false,
    options: SaveDraftOptions = {}
  ): Promise<RoomRecord | null> {
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
    if (options.promptForSignInOnUnauthorized) {
      await refreshAuthSession();
      if (!getAuthDebugState().authenticated) {
        await this.saveDraftLocally(
          saveStartedAt,
          'Draft saved locally. Sign in to save drafts to your account.'
        );
        promptForSignIn('Sign in to save drafts to your account. Your local draft is safe.');
        return null;
      }
    }

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
        const record = await this.saveDraftLocally(
          saveStartedAt,
          options.promptForSignInOnUnauthorized
            ? 'Draft saved locally. Sign in to save drafts to your account.'
            : 'Draft saved locally. Sign in to publish.'
        );
        if (options.promptForSignInOnUnauthorized) {
          promptForSignIn('Sign in to save drafts to your account. Your local draft is safe.');
        }
        return record;
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
      if (this.mintedTokenId && this.canRefreshMintMetadata() && !this.isMintMetadataCurrent()) {
        this.setStatusDetails({
          text: 'NFT metadata is stale. Refresh NFT Metadata to update the on-chain snapshot.',
          accentText: `Published v${this.publishedVersion}`,
          linkLabel: '',
          linkHref: null,
        });
      } else {
        this.setStatusText(successText ?? `Published v${this.publishedVersion}.`);
      }
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

  async setCanonicalVersion(targetVersion: number): Promise<RoomRecord | null> {
    if (this.saveInFlight) {
      return null;
    }
    if (!this.roomPermissions.canRevert) {
      this.setStatusText(
        this.mintedTokenId
          ? 'Only the room token owner can set the canonical version for this room.'
          : 'Only the claimer can set the canonical version for this room.'
      );
      return null;
    }

    this.saveInFlight = true;
    this.setStatusText(`Marking v${targetVersion} as canonical...`);

    try {
      const record = await this.roomRepository.setCanonicalVersion(
        this.roomId,
        this.roomCoordinates,
        targetVersion
      );
      this.syncRoomMetadata(record);
      this.setStatusText(`Canonical version set to v${targetVersion}.`);
      return record;
    } catch (error) {
      console.error('Failed to set canonical room version', error);
      const message = error instanceof Error ? error.message : 'Canonical version update failed.';
      this.setStatusText(message);
    } finally {
      this.saveInFlight = false;
      this.host.refreshUi();
    }

    return null;
  }

  async setLeaderboardSourceVersion(
    targetVersion: number,
    sourceVersion: number | null
  ): Promise<RoomRecord | null> {
    if (this.saveInFlight) {
      return null;
    }
    if (!this.roomPermissions.canRevert) {
      this.setStatusText(
        this.mintedTokenId
          ? 'Only the room token owner can manage leaderboard lineage for this room.'
          : 'Only the claimer can manage leaderboard lineage for this room.'
      );
      return null;
    }

    this.saveInFlight = true;
    this.setStatusText(
      sourceVersion === null
        ? `Restoring v${targetVersion} to its own leaderboard...`
        : `Linking v${targetVersion} to leaderboard v${sourceVersion}...`
    );

    try {
      const record = await this.roomRepository.setLeaderboardSourceVersion(
        this.roomId,
        this.roomCoordinates,
        targetVersion,
        sourceVersion
      );
      this.syncRoomMetadata(record);
      this.setStatusText(
        sourceVersion === null
          ? `v${targetVersion} now uses its own leaderboard.`
          : `v${targetVersion} now uses leaderboard v${sourceVersion}.`
      );
      return record;
    } catch (error) {
      console.error('Failed to update room leaderboard lineage', error);
      const message = error instanceof Error ? error.message : 'Leaderboard lineage update failed.';
      this.setStatusText(message);
    } finally {
      this.saveInFlight = false;
      this.host.refreshUi();
    }

    return null;
  }

  async buildReturnToWorldWakeData(): Promise<OverworldPlaySceneData | null> {
    if (!this.host.getRoomDirty()) {
      if (this.shouldShowDraftPreviewInWorld()) {
        return {
          centerCoordinates: { ...this.roomCoordinates },
          roomCoordinates: { ...this.roomCoordinates },
          statusMessage: this.DRAFT_WORLD_PREVIEW_WARNING,
          draftRoom: cloneRoomSnapshot(this.host.exportRoomSnapshot()),
          clearDraftRoomId: null,
          invalidateRoomId: this.roomId,
          forceRefreshAround: true,
          mode: 'browse',
        };
      }

      return {
        centerCoordinates: { ...this.roomCoordinates },
        roomCoordinates: { ...this.roomCoordinates },
        publishedRoom: this.publishedRoomSnapshot ? cloneRoomSnapshot(this.publishedRoomSnapshot) : null,
        draftRoom: null,
        clearDraftRoomId: this.roomId,
        invalidateRoomId: this.roomId,
        forceRefreshAround: true,
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
        publishedRoom: publishedRecord.published ? cloneRoomSnapshot(publishedRecord.published) : null,
        draftRoom: null,
        clearDraftRoomId: this.roomId,
        invalidateRoomId: this.roomId,
        forceRefreshAround: true,
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
      statusMessage: this.DRAFT_WORLD_PREVIEW_WARNING,
      draftRoom: cloneRoomSnapshot(draftRecord.draft),
      clearDraftRoomId: null,
      invalidateRoomId: this.roomId,
      forceRefreshAround: true,
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
      showBusyOverlay('Publishing room...', 'Preparing room for mint...');
      const publishedRecord = await this.publishRoom(
        this.publishedVersion === 0 ? 'Published. Ready to mint.' : 'Published latest changes before mint.'
      );
      hideBusyOverlay();
      if (!publishedRecord) {
        return null;
      }
    }

    await refreshAuthSession();
    const authState = getAuthDebugState();

    if (!authState.authenticated) {
      promptForSignIn('Sign in and link a wallet to mint this room.');
      return null;
    }

    if (!authState.user?.walletAddress) {
      this.setStatusText('Link a wallet from the account menu before minting.');
      return null;
    }

    if (!this.roomPermissions.canMint) {
      this.setStatusText(
        this.roomPermissions.canPublish
          ? 'Link the owning wallet from the account menu before minting.'
          : 'Only the current claimer can mint this room.'
      );
      return null;
    }

    this.saveInFlight = true;
    showBusyOverlay('Preparing mint...', 'Checking room mint configuration...');
    this.setStatusText('Preparing mint...');

    try {
      const prepare = await this.roomRepository.prepareMint(this.roomId, this.roomCoordinates);
      updateBusyOverlay('Waiting for wallet confirmation...', `Approve the ${prepare.chain.name} transaction in your wallet.`);
      this.setStatusText(`Waiting for wallet confirmation on ${prepare.chain.name}...`);
      const tx = await sendPreparedWalletTransaction(prepare.transaction, prepare.chain);
      updateBusyOverlay('Confirming mint...', 'Waiting for on-chain confirmation...');
      this.setStatusText('Confirming mint...');

      const record = await this.roomRepository.confirmMint(this.roomId, this.roomCoordinates, {
        txHash: tx.hash,
      });
      this.syncRoomMetadata(record);
      this.host.setRoomDirty(false);

      const explorerUrl = buildExplorerTxUrl(prepare.chain, tx.hash);
      this.setStatusDetails({
        text: '',
        accentText: `Minted token #${record.mintedTokenId}`,
        linkLabel: explorerUrl ? 'Transaction' : '',
        linkHref: explorerUrl,
      });
      hideBusyOverlay();
      return record;
    } catch (error) {
      console.error('Failed to mint room', error);
      if (isRoomApiError(error) && error.status === 409) {
        const refreshed = await this.roomRepository.loadRoom(this.roomId, this.roomCoordinates);
        this.syncRoomMetadata(refreshed);
      }

      const message = error instanceof Error ? error.message : 'Mint failed.';
      this.setStatusText(message);
      hideBusyOverlay();
    } finally {
      this.saveInFlight = false;
      this.host.refreshUi();
    }

    return null;
  }

  async refreshMintMetadata(): Promise<RoomRecord | null> {
    if (this.saveInFlight) {
      return null;
    }

    if (!this.mintedTokenId || !this.mintedContractAddress || this.mintedChainId === null) {
      this.setStatusText('This room is not minted yet.');
      return null;
    }

    if (!this.publishedRoomSnapshot) {
      this.setStatusText('Publish the room before refreshing NFT metadata.');
      return null;
    }

    if (!this.canRefreshMintMetadata()) {
      this.setStatusText('Only the room token owner can refresh NFT metadata.');
      return null;
    }

    await refreshAuthSession();
    const authState = getAuthDebugState();

    if (!authState.authenticated) {
      promptForSignIn('Sign in and link the owning wallet to refresh NFT metadata.');
      return null;
    }

    if (!authState.user?.walletAddress) {
      this.setStatusText('Link the token-owning wallet from the account menu before refreshing NFT metadata.');
      return null;
    }

    this.saveInFlight = true;
    showBusyOverlay('Preparing NFT metadata...', 'Rendering room preview...');
    this.setStatusText('Preparing NFT metadata...');

    try {
      const imageDataUrl = await renderRoomSnapshotToPngDataUrl(this.publishedRoomSnapshot, {
        tilePixelSize: 2,
      });
      const built = await buildRoomTokenMetadata(
        this.publishedRoomSnapshot,
        imageDataUrl,
        {
          origin: window.location.origin,
          chainId: this.mintedChainId,
          contractAddress: this.mintedContractAddress,
          tokenId: this.mintedTokenId,
        }
      );
      updateBusyOverlay('Preparing wallet transaction...', 'Packaging room metadata for the wallet...');
      const prepare = await this.roomRepository.prepareMetadataRefresh(
        this.roomId,
        this.roomCoordinates,
        {
          tokenUri: built.tokenUri,
        }
      );
      updateBusyOverlay(
        'Waiting for wallet confirmation...',
        `Approve the ${prepare.chain.name} transaction in your wallet.`
      );
      this.setStatusText(`Waiting for wallet confirmation on ${prepare.chain.name}...`);
      const tx = await sendPreparedWalletTransaction(prepare.transaction, prepare.chain);
      updateBusyOverlay('Confirming metadata refresh...', 'Waiting for on-chain confirmation...');
      this.setStatusText('Confirming NFT metadata refresh...');

      const record = await this.roomRepository.confirmMetadataRefresh(
        this.roomId,
        this.roomCoordinates,
        {
          txHash: tx.hash,
          metadataRoomVersion: this.publishedVersion,
          metadataHash: built.metadataHash,
        }
      );
      this.syncRoomMetadata(record);

      const explorerUrl = buildExplorerTxUrl(prepare.chain, tx.hash);
      this.setStatusDetails({
        text: `On-chain metadata is now synced to room v${record.mintedMetadataRoomVersion ?? this.publishedVersion}.`,
        accentText: `NFT metadata refreshed for token #${record.mintedTokenId}`,
        linkLabel: explorerUrl ? 'Transaction' : '',
        linkHref: explorerUrl,
      });
      hideBusyOverlay();
      return record;
    } catch (error) {
      console.error('Failed to refresh room NFT metadata', error);
      if (isRoomApiError(error) && error.status === 409) {
        const refreshed = await this.roomRepository.loadRoom(this.roomId, this.roomCoordinates);
        this.syncRoomMetadata(refreshed);
      }

      const message = error instanceof Error ? error.message : 'NFT metadata refresh failed.';
      this.setStatusText(message);
      hideBusyOverlay();
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

  private canRefreshMintMetadata(): boolean {
    return Boolean(this.mintedTokenId && this.publishedRoomSnapshot && this.roomPermissions.canSaveDraft);
  }

  private isMintMetadataCurrent(): boolean {
    return (
      this.mintedTokenId !== null &&
      this.publishedVersion > 0 &&
      this.mintedMetadataRoomVersion !== null &&
      this.mintedMetadataRoomVersion === this.publishedVersion
    );
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
    this.canonicalVersion = record.canonicalVersion;
    this.roomTitle = record.draft.title;
    this.roomCreatedAt = record.draft.createdAt;
    this.roomUpdatedAt = record.draft.updatedAt;
    this.roomPublishedAt = record.published?.publishedAt ?? null;
    this.publishedRoomSnapshot = record.published ? cloneRoomSnapshot(record.published) : null;
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
    this.mintedMetadataRoomVersion = record.mintedMetadataRoomVersion;
    this.mintedMetadataUpdatedAt = record.mintedMetadataUpdatedAt;
    this.mintedMetadataHash = record.mintedMetadataHash;
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

import {
  DEFAULT_ROOM_COORDINATES,
  DEFAULT_ROOM_ID,
  cloneRoomSnapshot,
  createRoomRecordFromCurrent,
  createLocalRoomRepository,
  isRoomApiError,
  isRoomSnapshotBlank,
  type RoomCoordinates,
  type RoomPermissions,
  type RoomRecord,
  type RoomSnapshot,
  type RoomSummary,
  type RoomVersionRecord,
} from '../../persistence/roomRepository';
import type { RoomRepository } from '../../persistence/roomRepository';
import {
  getAuthDebugState,
  refreshAuthSession,
} from '../../auth/client';
import {
  requestGuestBuilderClaim,
  type GuestBuilderClaimSource,
} from '../../progression/guestBuilderClaimEvents';
import { saveGuestRoomDraft } from '../../guestRooms/client';
import { clearLocalRoomStorageEntry } from '../../persistence/browserStorage';
import { readRoomDraftBackupMetadata, writeRoomDraftBackup } from '../../persistence/localDraftBackup';
import { isRoomEditConflict } from '../../persistence/roomEditConflict';
import {
  formatWalletAddress,
} from '../../mint/roomOwnership';
import {
  hideBusyOverlay,
  showBusyError,
} from '../../ui/appFeedback';
import type { OverworldPlaySceneData } from '../sceneData';
import type { RoomCollectionStageOptions, RoomCollectionFlowHost } from './roomCollectionFlow';
import { RoomWalletActions } from './roomWalletActions';
import type { PendingRoomWallet } from '../../mint/pendingRoomWallet';
import type { RoomWalletRecoveryResult } from '../../mint/roomWalletRecovery';

interface EditorRoomSessionHost {
  isActive?(): boolean;
  events?: RoomCollectionFlowHost['events'];
  applyRoomSnapshot(room: RoomSnapshot): void;
  exportRoomSnapshot(): RoomSnapshot;
  getPublishValidationError(): string | null;
  getRoomDirty(): boolean;
  setRoomDirty(dirty: boolean): void;
  getLastDirtyAt(): number;
  refreshUi(): void;
  refreshSurroundingRoomPreviews(): void;
  /** Every draft the server accepted, autosaves included, so a course cell's session copy follows it (F379). */
  onDraftSaved?(record: RoomRecord): void;
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

const DAILY_ROOM_CLAIM_LIMIT_ERROR_PREFIX = 'Daily room claim limit reached.';
const AUTO_SAVE_RETRY_BASE_MS = 2_000;
const AUTO_SAVE_RETRY_MAX_MS = 30_000;

// After a failed save, autosave waits before retrying (2s, 4s, 8s... up to 30s) and keeps a
// copy of the room in this browser so a closed tab can be recovered on the next open.
// Errors that retrying cannot fix stop autosave until a save succeeds.
interface AutoSaveBackoff {
  roomId: string;
  failures: number;
  retryAt: number;
  backedUpDirtyAt: number;
}

function isPermanentSaveError(error: unknown): boolean {
  if (!isRoomApiError(error)) {
    return false;
  }
  if (error.status === 429) {
    return error.message.startsWith(DAILY_ROOM_CLAIM_LIMIT_ERROR_PREFIX);
  }
  return error.status >= 400 && error.status < 500 && error.status !== 408;
}
const DAILY_ROOM_CLAIM_LIMIT_TITLE = "You've Reached Today's Room Claim Limit";
const DAILY_ROOM_CLAIM_LIMIT_MESSAGE =
  "You've reached your daily room claim limit. To claim more rooms per day, increase your Builder XP by publishing more high quality rooms.";

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
  private historyLoaded = false;
  private claimerDisplayName: string | null = null;
  private claimedAt: string | null = null;
  private mintedChainId: number | null = null;
  private mintedContractAddress: string | null = null;
  private mintedTokenId: string | null = null;
  private mintedOwnerWalletAddress: string | null = null;
  private mintedOwnerSyncedAt: string | null = null;
  private mintedMetadataRoomVersion: number | null = null;
  private mintedMetadataUpdatedAt: string | null = null;
  private saveInFlightValue = false;
  private saveSettledWaiters: Array<() => void> = [];
  private autoSaveBackoff: AutoSaveBackoff | null = null;
  // Bumped whenever the editor resets for another room. Network calls capture it before they
  // start and drop their results if it changed, so a slow save or load for the previous room
  // can never repoint this session at that room or overwrite the room now being edited.
  private sessionGeneration = 0;
  // The draft updatedAt the server last reported for this room. Saves and publishes send it so
  // the server can refuse to overwrite a newer save from another tab or device.
  private serverDraftUpdatedAt: string | null = null;
  private editConflictPending = false;
  private persistenceStatus: EditorStatusDetails = {
    text: '',
    accentText: '',
    linkLabel: '',
    linkHref: null,
  };
  private readonly walletActions: RoomWalletActions;
  private readonly localRoomRepository: RoomRepository = createLocalRoomRepository();

  constructor(
    private readonly roomRepository: RoomRepository,
    private readonly host: EditorRoomSessionHost,
  ) {
    const session = this;
    this.walletActions = new RoomWalletActions(roomRepository, {
      isActive: () => host.isActive?.() ?? true, events: host.events,
      get roomId() { return session.roomId; },
      get roomCoordinates() { return session.roomCoordinates; },
      get publishedVersion() { return session.publishedVersion; },
      get publishedRoomSnapshot() { return session.publishedRoomSnapshot; },
      get roomPermissions() { return session.roomPermissions; },
      get mintedTokenId() { return session.mintedTokenId; },
      get mintedChainId() { return session.mintedChainId; },
      get mintedContractAddress() { return session.mintedContractAddress; },
      get sessionGeneration() { return session.sessionGeneration; },
      get saveInFlight() { return session.saveInFlight; },
      set saveInFlight(value) { session.saveInFlight = value; },
      getRoomDirty: () => host.getRoomDirty(),
      applyRecovery: summary => session.applyWalletRecovery(summary),
      refreshUi: () => host.refreshUi(),
      canRefreshMintMetadata: () => session.canRefreshMintMetadata(),
      publishRoom: status => session.publishRoom(status),
      syncRoomMetadata: record => session.syncRoomMetadata(record, host.getRoomDirty()),
      setStatusText: text => session.setStatusText(text),
      setStatusDetails: status => session.setStatusDetails(status),
    });
  }

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

  /** The server draft version this editor last loaded or saved; null for a room it has not loaded from the server. */
  get currentServerDraftUpdatedAt(): string | null {
    return this.serverDraftUpdatedAt;
  }

  private get saveInFlight(): boolean {
    return this.saveInFlightValue;
  }

  private set saveInFlight(value: boolean) {
    this.saveInFlightValue = value;
    if (!value) {
      const waiters = this.saveSettledWaiters;
      this.saveSettledWaiters = [];
      for (const settle of waiters) settle();
    }
  }

  /** Resolves once no save, publish or other room write is running, or after timeoutMs. */
  waitForSaveToSettle(timeoutMs = 20_000): Promise<void> {
    if (!this.saveInFlight) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const settle = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(settle, timeoutMs);
      this.saveSettledWaiters.push(settle);
    });
  }

  get statusText(): string {
    return this.persistenceStatus.text;
  }

  get statusDetails(): EditorStatusDetails {
    return { ...this.persistenceStatus };
  }

  getPublishValidationError(): string | null {
    return this.host.getPublishValidationError();
  }

  hasDraftPreviewInWorld(): boolean {
    return this.shouldShowDraftPreviewInWorld();
  }

  reset(): void {
    this.sessionGeneration += 1;
    this.serverDraftUpdatedAt = null;
    this.editConflictPending = false;
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
    this.walletActions.reset();
    this.saveInFlight = false;
    this.persistenceStatus = {
      text: '',
      accentText: '',
      linkLabel: '',
      linkHref: null,
    };
  }

  // True while the "changed somewhere else" choice is waiting for the builder.
  get hasPendingEditConflict(): boolean {
    return this.editConflictPending;
  }

  captureContext(): () => boolean {
    const generation = this.sessionGeneration, roomId = this.roomId;
    return () => !this.isStale(generation) && this.roomId === roomId;
  }

  get hasPendingArtworkConfirmation(): boolean { return this.walletActions.hasPendingArtworkConfirmation; }
  get hasPendingWalletConfirmation(): boolean { return this.walletActions.hasPendingWalletConfirmation; }

  acceptWalletRecovery(pending: PendingRoomWallet, result: RoomWalletRecoveryResult): void {
    if (pending.roomId !== this.roomId || this.saveInFlight && !this.walletActions.ownsPending(pending.id)) return;
    this.applyWalletRecovery(result.summary);
    this.walletActions.acceptRecovery(pending, result);
  }

  /** A fresh chain check updates rights/artwork without replacing a builder's draft or timestamps. */
  applyWalletRecovery(summary: RoomSummary): void {
    if (summary.id !== this.roomId || summary.coordinates.x !== this.roomCoordinates.x
      || summary.coordinates.y !== this.roomCoordinates.y || summary.world?.worldId) return;
    this.roomPermissions = { ...summary.permissions };
    this.mintedChainId = summary.mintedChainId;
    this.mintedContractAddress = summary.mintedContractAddress;
    this.mintedTokenId = summary.mintedTokenId;
    this.mintedOwnerWalletAddress = summary.mintedOwnerWalletAddress;
    this.mintedOwnerSyncedAt = summary.mintedOwnerSyncedAt;
    this.mintedMetadataRoomVersion = summary.mintedMetadataRoomVersion;
    this.mintedMetadataUpdatedAt = summary.mintedMetadataUpdatedAt;
    this.host.refreshUi();
  }

  private isStale(generation: number): boolean {
    return generation !== this.sessionGeneration;
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
      const accentText = `Collected & Locked · Token #${this.mintedTokenId}`;
      if (this.roomPermissions.canSaveDraft) {
        if (this.mintedMetadataRoomVersion === null) {
          return {
            text: `Owner: ${formatWalletAddress(this.mintedOwnerWalletAddress)}. Artwork status has not been recorded here. Use Add/update artwork to add or replace it.`,
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

  async loadHistory(): Promise<void> {
    if (this.historyLoaded || this.publishedVersion <= 0) return;
    const generation = this.sessionGeneration;
    const metadata = [];
    let cursor: string | undefined;
    do {
      const page = await this.roomRepository.loadRoomVersions(this.roomId, 100, cursor);
      if (this.isStale(generation)) return;
      metadata.push(...page.versions);
      cursor = page.nextCursor;
    } while (cursor);

    const snapshotsByKey = new Map<string, RoomSnapshot>();
    for (let index = 0; index < metadata.length; index += 128) {
      const batch = metadata.slice(index, index + 128);
      const response = await this.roomRepository.queryRoomSnapshots(batch.map((version) => ({
        kind: 'version' as const,
        roomId: this.roomId,
        version: version.version,
      })));
      if (this.isStale(generation)) return;
      if (response.missing.length > 0) throw new Error('One or more room history snapshots are unavailable.');
      for (const entry of response.snapshots) snapshotsByKey.set(entry.key, entry.snapshot);
    }
    this.roomVersionHistory = metadata.map((version) => {
      const snapshot = snapshotsByKey.get(`version:${this.roomId}:${version.version}`);
      if (!snapshot) throw new Error(`Room version ${version.version} is unavailable.`);
      return { ...version, snapshot: cloneRoomSnapshot(snapshot) };
    }).sort((left, right) => left.version - right.version);
    this.historyLoaded = true;
    this.host.refreshUi();
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

    const backoff = this.autoSaveBackoff?.roomId === this.roomId ? this.autoSaveBackoff : null;
    if (backoff && performance.now() < backoff.retryAt) {
      const lastDirtyAt = this.host.getLastDirtyAt();
      if (lastDirtyAt !== backoff.backedUpDirtyAt) {
        backoff.backedUpDirtyAt = lastDirtyAt;
        void this.backupDraftLocally();
      }
      return;
    }

    void this.saveDraft();
  }

  async loadPersistedRoom(
    initialRoomSnapshot: RoomSnapshot | null,
    options: { forceInitialRoomSnapshot?: boolean } = {},
  ): Promise<boolean> {
    const generation = this.sessionGeneration;
    this.setStatusText('Loading draft...');

    try {
      const remoteRecord = createRoomRecordFromCurrent(
        await this.roomRepository.loadRoomCurrent(this.roomId, this.roomCoordinates),
      );
      const recovery = options.forceInitialRoomSnapshot ? null : await this.getRecoverableLocalDraft(remoteRecord);
      const localRecord = recovery?.conflictsWithServer ? null : recovery?.record ?? null;
      if (this.isStale(generation)) {
        return false;
      }
      const activeRecord = localRecord ?? remoteRecord;
      this.syncRoomMetadata(activeRecord);
      this.serverDraftUpdatedAt = remoteRecord.draft.updatedAt;
      const editableSnapshot = localRecord ? cloneRoomSnapshot(localRecord.draft)
        : this.resolveRoomSnapshotForEditing(activeRecord, initialRoomSnapshot, options);
      this.roomTitle = editableSnapshot.title;
      this.host.applyRoomSnapshot(editableSnapshot);
      if (localRecord || (initialRoomSnapshot && (options.forceInitialRoomSnapshot
        || (isRoomSnapshotBlank(activeRecord.draft) && !isRoomSnapshotBlank(initialRoomSnapshot))))) {
        this.host.setRoomDirty(true);
      }
      this.host.refreshSurroundingRoomPreviews();
      void this.walletActions.recoverPending();
      this.setStatusText(
        localRecord
          ? getAuthDebugState().authenticated
            ? `Recovered local draft. ${this.DRAFT_VISIBILITY_WARNING}`
            : `Recovered local guest draft. ${this.DRAFT_VISIBILITY_WARNING}`
          : this.getIdleStatusText()
      );
      if (recovery?.conflictsWithServer) {
        this.offerLocalDraftRecovery(generation, remoteRecord, recovery.record);
      }
      return true;
    } catch (error) {
      if (this.isStale(generation)) {
        return false;
      }
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
      this.setStatusText(
        this.mintedTokenId
          ? 'Only the room token owner can save this room.'
          : 'You do not have permission to save this room.',
      );
      return null;
    }

    const generation = this.sessionGeneration;
    const saveStartedAt = this.host.getLastDirtyAt();
    if (options.promptForSignInOnUnauthorized) {
      await refreshAuthSession();
      if (this.isStale(generation)) {
        return null;
      }
      if (!getAuthDebugState().authenticated) {
        await this.saveGuestDraft(
          saveStartedAt,
          'Draft saved as guest. Sign in to save drafts to your account.',
          'manual-save'
        );
        return null;
      }
    }

    if (!getAuthDebugState().authenticated) {
      return this.saveGuestDraft(
        saveStartedAt,
        'Draft saved as guest. Sign in to publish.',
        null,
      );
    }

    this.saveInFlight = true;
    this.setStatusText('Saving draft...');

    try {
      const record = await this.roomRepository.saveDraft(this.host.exportRoomSnapshot(), {
        baseUpdatedAt: this.serverDraftUpdatedAt,
      });
      if (this.isStale(generation)) {
        return null;
      }
      this.autoSaveBackoff = null;
      this.syncRoomMetadata(record, this.host.getLastDirtyAt() !== saveStartedAt);
      if (this.shouldClearLocalDraftAfterRepositoryMutation()) this.host.onDraftSaved?.(record);
      if (this.host.getLastDirtyAt() === saveStartedAt) {
        this.host.setRoomDirty(false);
        if (this.shouldClearLocalDraftAfterRepositoryMutation()) {
          clearLocalRoomStorageEntry(this.roomId);
        }
      } else {
        this.backupDraftForPageExit();
      }

      const publishSuffix = this.publishedVersion > 0 ? ` Published v${this.publishedVersion}.` : '';
      this.setStatusText(`Draft saved v${this.roomVersion}.${publishSuffix}`);
      return record;
    } catch (error) {
      if (this.isStale(generation)) {
        return null;
      }
      if (isRoomEditConflict(error)) {
        await this.handleEditConflict();
        return null;
      }
      if (this.shouldPersistGuestDraftLocally(error)) {
        try {
          return await this.saveDraftLocally(
            saveStartedAt,
            options.promptForSignInOnUnauthorized
              ? 'Draft saved locally. Sign in to save drafts to your account.'
              : 'Draft saved locally. Sign in to publish.',
            options.promptForSignInOnUnauthorized ? 'manual-save' : null
          );
        } catch (localError) {
          console.warn('Failed to save room draft locally', localError);
        }
      }

      const permanent = isPermanentSaveError(error);
      this.recordAutoSaveFailure(permanent);
      const backedUp = await this.backupDraftLocally();

      if (this.showDailyRoomClaimLimitModal(error)) {
        return null;
      }

      console.error('Failed to save room draft', error);
      this.setStatusText(this.getSaveFailureStatusText(error, permanent, backedUp));
    } finally {
      if (!this.isStale(generation)) {
        this.saveInFlight = false;
        this.host.refreshUi();
      }
    }

    return null;
  }

  async publishRoom(successText?: string): Promise<RoomRecord | null> {
    if (this.saveInFlight) {
      return null;
    }
    const publishValidationError = this.host.getPublishValidationError();
    if (publishValidationError) {
      showBusyError(publishValidationError, {
        title: 'Cannot Publish Room',
        variant: 'danger',
        closeLabel: 'OK',
      });
      return null;
    }
    if (!this.roomPermissions.canPublish) {
      this.setStatusText(
        this.mintedTokenId
          ? 'Only the room token owner can publish this room.'
          : 'You do not have permission to publish this room.',
      );
      return null;
    }
    const generation = this.sessionGeneration;
    await refreshAuthSession();
    if (this.isStale(generation)) {
      return null;
    }
    if (!getAuthDebugState().authenticated) {
      await this.saveGuestDraft(
        this.host.getLastDirtyAt(),
        'Draft saved as guest. Sign in to publish, or publish to Guest Rooms.',
        'publish-attempt'
      );
      return null;
    }

    this.saveInFlight = true;
    this.setStatusText('Publishing...');
    const publishStartedAt = this.host.getLastDirtyAt();

    try {
      const record = await this.roomRepository.publish(this.host.exportRoomSnapshot(), {
        baseUpdatedAt: this.serverDraftUpdatedAt,
      });
      if (this.isStale(generation)) {
        return null;
      }
      this.syncRoomMetadata(record, this.host.getLastDirtyAt() !== publishStartedAt);
      if (this.host.getLastDirtyAt() !== publishStartedAt) {
        this.backupDraftForPageExit();
      }
      await refreshAuthSession();
      if (this.isStale(generation)) {
        return null;
      }
      if (this.host.getLastDirtyAt() === publishStartedAt) {
        this.host.setRoomDirty(false);
        if (this.shouldClearLocalDraftAfterRepositoryMutation()) {
          clearLocalRoomStorageEntry(this.roomId);
        }
      } else {
        this.backupDraftForPageExit();
      }
      if (record.worldPublicationSubmission) {
        this.setStatusText('Draft saved and submitted for World approval. Waiting for review.');
        return null;
      }
      if (this.mintedTokenId && this.canRefreshMintMetadata() && !this.isMintMetadataCurrent()) {
        this.setStatusDetails({
          text: 'Room artwork is stale. Choose Add/update artwork to update the on-chain snapshot.',
          accentText: `Published v${this.publishedVersion}`,
          linkLabel: '',
          linkHref: null,
        });
      } else {
        this.setStatusText(successText ?? `Published v${this.publishedVersion}.`);
      }
      return record;
    } catch (error) {
      if (this.isStale(generation)) {
        return null;
      }
      if (isRoomEditConflict(error)) {
        await this.handleEditConflict();
        return null;
      }
      if (this.shouldPersistGuestDraftLocally(error)) {
        await this.saveDraftLocally(
          this.host.getLastDirtyAt(),
          'Draft saved locally. Sign in to publish.',
          'publish-attempt'
        );
        return null;
      }

      if (this.showDailyRoomClaimLimitModal(error)) {
        return null;
      }

      console.error('Failed to publish room', error);
      const message = error instanceof Error ? error.message : 'Publish failed.';
      this.setStatusText(message);
    } finally {
      if (!this.isStale(generation)) {
        this.saveInFlight = false;
        this.host.refreshUi();
      }
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

    const generation = this.sessionGeneration;
    this.saveInFlight = true;
    this.setStatusText(`Reverting to v${targetVersion}...`);

    try {
      const record = await this.roomRepository.revert(this.roomId, this.roomCoordinates, targetVersion);
      if (this.isStale(generation)) {
        return null;
      }
      this.syncRoomMetadata(record);
      this.host.applyRoomSnapshot(this.resolveRoomSnapshotForEditing(record, initialRoomSnapshot));
      this.setStatusText(`Reverted to v${targetVersion}.`);
      return record;
    } catch (error) {
      if (this.isStale(generation)) {
        return null;
      }
      console.error('Failed to revert room version', error);
      const message = error instanceof Error ? error.message : 'Revert failed.';
      this.setStatusText(message);
    } finally {
      if (!this.isStale(generation)) {
        this.saveInFlight = false;
        this.host.refreshUi();
      }
    }

    return null;
  }

  async adminRestoreToVersion(
    targetVersion: number,
    initialRoomSnapshot: RoomSnapshot | null,
  ): Promise<RoomRecord | null> {
    if (this.saveInFlight) {
      return null;
    }

    await refreshAuthSession();
    const moderationRole = getAuthDebugState().chatModeration.role;
    if (moderationRole !== 'admin' && moderationRole !== 'owner') {
      this.setStatusText('Only chat moderators can admin-restore rooms.');
      return null;
    }

    const generation = this.sessionGeneration;
    this.saveInFlight = true;
    this.setStatusText(`Admin restoring to v${targetVersion}...`);

    try {
      const record = await this.roomRepository.adminRestore(
        this.roomId,
        this.roomCoordinates,
        targetVersion
      );
      if (this.isStale(generation)) {
        return null;
      }
      this.syncRoomMetadata(record);
      this.host.applyRoomSnapshot(this.resolveRoomSnapshotForEditing(record, initialRoomSnapshot));
      this.setStatusText(`Admin restored room to v${targetVersion}.`);
      return record;
    } catch (error) {
      if (this.isStale(generation)) {
        return null;
      }
      console.error('Failed to admin-restore room version', error);
      const message = error instanceof Error ? error.message : 'Admin restore failed.';
      this.setStatusText(message);
    } finally {
      if (!this.isStale(generation)) {
        this.saveInFlight = false;
        this.host.refreshUi();
      }
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

    const generation = this.sessionGeneration;
    this.saveInFlight = true;
    this.setStatusText(`Marking v${targetVersion} as canonical...`);

    try {
      const record = await this.roomRepository.setCanonicalVersion(
        this.roomId,
        this.roomCoordinates,
        targetVersion
      );
      if (this.isStale(generation)) {
        return null;
      }
      this.syncRoomMetadata(record);
      this.setStatusText(`Canonical version set to v${targetVersion}.`);
      return record;
    } catch (error) {
      if (this.isStale(generation)) {
        return null;
      }
      console.error('Failed to set canonical room version', error);
      const message = error instanceof Error ? error.message : 'Canonical version update failed.';
      this.setStatusText(message);
    } finally {
      if (!this.isStale(generation)) {
        this.saveInFlight = false;
        this.host.refreshUi();
      }
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

    const generation = this.sessionGeneration;
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
      if (this.isStale(generation)) {
        return null;
      }
      this.syncRoomMetadata(record);
      this.setStatusText(
        sourceVersion === null
          ? `v${targetVersion} now uses its own leaderboard.`
          : `v${targetVersion} now uses leaderboard v${sourceVersion}.`
      );
      return record;
    } catch (error) {
      if (this.isStale(generation)) {
        return null;
      }
      console.error('Failed to update room leaderboard lineage', error);
      const message = error instanceof Error ? error.message : 'Leaderboard lineage update failed.';
      this.setStatusText(message);
    } finally {
      if (!this.isStale(generation)) {
        this.saveInFlight = false;
        this.host.refreshUi();
      }
    }

    return null;
  }

  async buildReturnToWorldWakeData(): Promise<OverworldPlaySceneData | null> {
    // Leaving during an autosave waits for it, so what happens doesn't depend on its timing.
    const generation = this.sessionGeneration;
    await this.waitForSaveToSettle();
    if (this.isStale(generation) || this.editConflictPending) {
      return null;
    }

    if (!this.host.getRoomDirty()) {
      if (this.shouldShowDraftPreviewInWorld()) {
        return {
          centerCoordinates: { ...this.roomCoordinates },
          roomCoordinates: { ...this.roomCoordinates },
          statusMessage: this.DRAFT_WORLD_PREVIEW_WARNING,
          draftRoom: cloneRoomSnapshot(this.host.exportRoomSnapshot()),
          draftRoomBaseUpdatedAt: this.serverDraftUpdatedAt,
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

    // Back/Escape only save a private draft. Publishing is always an explicit action.
    const draftRecord = await this.saveDraft(true);
    if (this.isStale(generation)) {
      return null;
    }
    if (!draftRecord) {
      return null;
    }

    if (this.host.getRoomDirty()) {
      this.setStatusText('Your room changed while saving. Please try leaving again to save the latest edits.');
      return null;
    }

    this.setStatusText('Draft saved. Not published yet.');
    return {
      centerCoordinates: { ...this.roomCoordinates },
      roomCoordinates: { ...this.roomCoordinates },
      statusMessage: this.DRAFT_WORLD_PREVIEW_WARNING,
      draftRoom: cloneRoomSnapshot(draftRecord.draft),
      draftRoomBaseUpdatedAt: draftRecord.draft.updatedAt,
      clearDraftRoomId: null,
      invalidateRoomId: this.roomId,
      forceRefreshAround: true,
      mode: 'browse',
    };
  }

  mintRoom(options: RoomCollectionStageOptions = {}): Promise<RoomRecord | null> {
    return this.walletActions.mintRoom(options);
  }

  refreshMintMetadata(options: RoomCollectionStageOptions = {}): Promise<RoomRecord | null> {
    return this.walletActions.refreshMintMetadata(options);
  }

  private shouldShowDraftPreviewInWorld(): boolean {
    return this.roomPublishedAt === null || this.roomUpdatedAt !== this.roomPublishedAt;
  }

  private async getRecoverableLocalDraft(remoteRecord: RoomRecord): Promise<{
    record: RoomRecord;
    conflictsWithServer: boolean;
  } | null> {
    const backup = readRoomDraftBackupMetadata(this.roomId);
    if (backup && (backup.userId !== (getAuthDebugState().user?.id ?? null)
      || !remoteRecord.permissions.canSaveDraft)) {
      return null;
    }
    const localRecord = await this.localRoomRepository.loadRoom(this.roomId, this.roomCoordinates);
    if (!backup && isRoomSnapshotBlank(localRecord.draft)) {
      return null;
    }

    const localDraftUpdatedAt = this.getSnapshotTimestamp(localRecord.draft);
    const remoteDraftUpdatedAt = this.getSnapshotTimestamp(remoteRecord.draft);
    // Missing remote rooms receive a fresh default snapshot on every load.
    // Its timestamp describes the request, not a saved edit that supersedes
    // this browser's guest draft.
    const remoteIsUnclaimedPlaceholder = !remoteRecord.claimedAt
      && !remoteRecord.claimerUserId
      && !remoteRecord.claimerAgentId
      && !remoteRecord.published
      && !remoteRecord.mintedTokenId
      && isRoomSnapshotBlank(remoteRecord.draft);
    const conflictsWithServer = Boolean(backup?.baseUpdatedAt && !remoteIsUnclaimedPlaceholder
      && backup.baseUpdatedAt !== remoteRecord.draft.updatedAt);
    if (!remoteIsUnclaimedPlaceholder && localDraftUpdatedAt <= remoteDraftUpdatedAt
      && !backup) {
      return null;
    }

    return {
      record: { ...remoteRecord, draft: cloneRoomSnapshot(localRecord.draft) },
      conflictsWithServer,
    };
  }

  private offerLocalDraftRecovery(generation: number, remote: RoomRecord, local: RoomRecord): void {
    this.editConflictPending = true;
    const resolve = (restore: boolean): void => {
      hideBusyOverlay();
      if (this.isStale(generation)) return;
      this.editConflictPending = false;
      this.autoSaveBackoff = null;
      if (restore) {
        this.syncRoomMetadata(local);
        this.serverDraftUpdatedAt = remote.draft.updatedAt;
        this.host.applyRoomSnapshot(cloneRoomSnapshot(local.draft));
        this.host.setRoomDirty(true);
        this.setStatusText(`Recovered local draft. ${this.DRAFT_VISIBILITY_WARNING}`);
      } else {
        clearLocalRoomStorageEntry(this.roomId);
      }
      this.host.refreshUi();
    };
    showBusyError('This device has unsaved changes, and the account draft has changed. Choose which draft to continue editing.', {
      title: 'Recover your room draft',
      tone: 'choice',
      retryLabel: 'Restore Local',
      retryHandler: () => resolve(true),
      closeLabel: 'Use Account Draft',
      closeHandler: () => resolve(false),
      destructive: 'close',
    });
  }

  private getSnapshotTimestamp(snapshot: RoomSnapshot | null): number {
    if (!snapshot) {
      return 0;
    }

    const updatedAt = Date.parse(snapshot.updatedAt);
    if (!Number.isNaN(updatedAt) && updatedAt > 0) {
      return updatedAt;
    }

    const publishedAt = snapshot.publishedAt ? Date.parse(snapshot.publishedAt) : Number.NaN;
    if (!Number.isNaN(publishedAt) && publishedAt > 0) {
      return publishedAt;
    }

    const createdAt = Date.parse(snapshot.createdAt);
    return Number.isNaN(createdAt) ? 0 : createdAt;
  }

  private shouldPersistGuestDraftLocally(error: unknown): boolean {
    return isRoomApiError(error) && error.status === 401;
  }

  private shouldClearLocalDraftAfterRepositoryMutation(): boolean {
    return this.roomRepository.getLastPersistenceTarget() !== 'local';
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
    successText: string,
    guestBuilderClaimSource: GuestBuilderClaimSource | null = null,
  ): Promise<RoomRecord | null> {
    const record = await this.localRoomRepository.saveDraft(this.host.exportRoomSnapshot());
    this.autoSaveBackoff = null;
    this.syncRoomMetadata(record);
    this.serverDraftUpdatedAt = null;

    if (this.host.getLastDirtyAt() === saveStartedAt) {
      this.host.setRoomDirty(false);
    }

    this.setStatusText(successText);
    this.requestGuestBuilderClaimPrompt(guestBuilderClaimSource);
    return record;
  }

  private async saveGuestDraft(
    saveStartedAt: number,
    successText: string,
    guestBuilderClaimSource: GuestBuilderClaimSource | null = null,
  ): Promise<RoomRecord | null> {
    const generation = this.sessionGeneration;
    this.saveInFlight = true;
    this.setStatusText('Saving guest draft...');

    try {
      const snapshot = this.host.exportRoomSnapshot();
      const localRecord = await this.localRoomRepository.saveDraft(snapshot);
      this.autoSaveBackoff = null;
      this.syncRoomMetadata(localRecord);
      this.serverDraftUpdatedAt = null;

      try {
        await saveGuestRoomDraft(localRecord.draft);
        if (this.isStale(generation)) {
          return localRecord;
        }
        this.setStatusText(successText);
      } catch (error) {
        if (this.isStale(generation)) {
          return localRecord;
        }
        console.warn('Failed to save durable guest room draft', error);
        this.setStatusText('Draft saved locally. Sign in to publish.');
      }

      if (this.host.getLastDirtyAt() === saveStartedAt) {
        this.host.setRoomDirty(false);
      }

      this.requestGuestBuilderClaimPrompt(guestBuilderClaimSource);
      return localRecord;
    } catch (error) {
      console.error('Failed to save guest room draft', error);
      this.recordAutoSaveFailure(false);
      this.setStatusText('Could not save this draft on this device. Your browser storage may be full.');
      return null;
    } finally {
      if (!this.isStale(generation)) {
        this.saveInFlight = false;
        this.host.refreshUi();
      }
    }
  }

  private async handleEditConflict(): Promise<void> {
    this.editConflictPending = true;
    this.recordAutoSaveFailure(true);
    await this.backupDraftLocally();
    this.setStatusText('This room was changed in another tab or device. Choose which version to keep.');
    const generation = this.sessionGeneration;
    showBusyError(
      'This room was saved from another tab or device after you opened it here. '
        + 'Load Latest opens that newer version and discards the changes made here. '
        + 'Keep Mine saves the version here over it.',
      {
        title: 'This Room Changed Somewhere Else',
        tone: 'choice',
        destructive: 'retry',
        retryLabel: 'Load Latest',
        retryHandler: () => this.resolveEditConflict(generation, 'load-latest'),
        closeLabel: 'Keep Mine',
        closeHandler: () => this.resolveEditConflict(generation, 'keep-mine'),
      },
    );
  }

  private async resolveEditConflict(generation: number, choice: 'load-latest' | 'keep-mine'): Promise<void> {
    hideBusyOverlay();
    if (this.isStale(generation)) {
      return;
    }
    this.editConflictPending = false;
    this.autoSaveBackoff = null;
    if (choice === 'keep-mine') {
      // No baseline: this one save overwrites, then the new server timestamp protects later saves.
      this.serverDraftUpdatedAt = null;
      await this.saveDraft(true);
      return;
    }
    // Drop this device's copy so loading does not "recover" it over the newer version.
    clearLocalRoomStorageEntry(this.roomId);
    if (await this.loadPersistedRoom(null)) {
      this.host.setRoomDirty(false);
    }
  }

  private recordAutoSaveFailure(permanent: boolean): void {
    const failures = this.autoSaveBackoff?.roomId === this.roomId ? this.autoSaveBackoff.failures + 1 : 1;
    const delay = Math.min(AUTO_SAVE_RETRY_MAX_MS, AUTO_SAVE_RETRY_BASE_MS * 2 ** (failures - 1));
    this.autoSaveBackoff = {
      roomId: this.roomId,
      failures,
      retryAt: permanent ? Number.POSITIVE_INFINITY : performance.now() + delay,
      backedUpDirtyAt: this.host.getLastDirtyAt(),
    };
  }

  private async backupDraftLocally(): Promise<boolean> {
    return this.backupDraftForPageExit();
  }

  backupDraftForPageExit(): boolean {
    if (!this.host.getRoomDirty()) {
      return true;
    }
    try {
      return writeRoomDraftBackup(this.host.exportRoomSnapshot(), {
        userId: getAuthDebugState().user?.id ?? null,
        baseUpdatedAt: this.serverDraftUpdatedAt,
      });
    } catch {
      return false;
    }
  }

  private getSaveFailureStatusText(error: unknown, permanent: boolean, backedUp: boolean): string {
    const kept = backedUp ? ' Your changes are kept on this device.' : '';
    if (permanent) {
      const reason = error instanceof Error && error.message.trim() ? ` ${error.message.trim()}` : '';
      return `Draft save failed.${reason}${kept}`;
    }
    return `Draft save failed. Retrying soon.${kept}`;
  }

  private requestGuestBuilderClaimPrompt(source: GuestBuilderClaimSource | null): void {
    if (!source || getAuthDebugState().authenticated) {
      return;
    }

    requestGuestBuilderClaim({
      roomId: this.roomId,
      roomCoordinates: this.roomCoordinates,
      roomTitle: this.roomTitle,
      source,
    });
  }

  private showDailyRoomClaimLimitModal(error: unknown): boolean {
    if (!isRoomApiError(error) || error.status !== 429) {
      return false;
    }
    if (!error.message.startsWith(DAILY_ROOM_CLAIM_LIMIT_ERROR_PREFIX)) {
      return false;
    }

    this.setStatusText(DAILY_ROOM_CLAIM_LIMIT_ERROR_PREFIX);
    showBusyError(DAILY_ROOM_CLAIM_LIMIT_MESSAGE, {
      title: DAILY_ROOM_CLAIM_LIMIT_TITLE,
      closeLabel: 'OK',
    });
    return true;
  }

  private syncRoomMetadata(record: RoomRecord, preserveCurrentTitle = false): void {
    this.serverDraftUpdatedAt = record.draft.updatedAt;
    this.roomId = record.draft.id;
    this.roomCoordinates = { ...record.draft.coordinates };
    this.roomVersion = record.draft.version;
    this.publishedVersion = record.published?.version ?? 0;
    this.canonicalVersion = record.canonicalVersion;
    if (!preserveCurrentTitle) {
      this.roomTitle = record.draft.title;
    }
    this.roomCreatedAt = record.draft.createdAt;
    this.roomUpdatedAt = record.draft.updatedAt;
    this.roomPublishedAt = record.published?.publishedAt ?? null;
    this.publishedRoomSnapshot = record.published ? cloneRoomSnapshot(record.published) : null;
    this.roomPermissions = { ...record.permissions };
    this.roomVersionHistory = record.versions.map((version) => ({
      ...version,
      snapshot: cloneRoomSnapshot(version.snapshot),
    }));
    this.historyLoaded = record.versions.length > 0 || record.published === null;
    this.claimerDisplayName = record.claimerDisplayName;
    this.claimedAt = record.claimedAt;
    this.mintedChainId = record.mintedChainId;
    this.mintedContractAddress = record.mintedContractAddress;
    this.mintedTokenId = record.mintedTokenId;
    this.mintedOwnerWalletAddress = record.mintedOwnerWalletAddress;
    this.mintedOwnerSyncedAt = record.mintedOwnerSyncedAt;
    this.mintedMetadataRoomVersion = record.mintedMetadataRoomVersion;
    this.mintedMetadataUpdatedAt = record.mintedMetadataUpdatedAt;
    this.host.refreshUi();
  }

  private resolveRoomSnapshotForEditing(
    record: RoomRecord,
    initialRoomSnapshot: RoomSnapshot | null,
    options: { forceInitialRoomSnapshot?: boolean } = {},
  ): RoomSnapshot {
    if (initialRoomSnapshot && options.forceInitialRoomSnapshot) {
      return this.getEditableSnapshotFromSource(initialRoomSnapshot);
    }

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

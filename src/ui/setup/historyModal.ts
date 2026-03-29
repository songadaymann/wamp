import Phaser from 'phaser';
import { getAuthDebugState } from '../../auth/client';
import {
  buildRoomLeaderboardLineage,
  getManualRoomLeaderboardSourceValidationError,
} from '../../persistence/roomLeaderboardLineage';
import { getActiveEditorScene, type EditorHistoryState } from './sceneBridge';

const HISTORY_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

type HistoryModalElements = {
  modal: HTMLElement | null;
  meta: HTMLElement | null;
  list: HTMLElement | null;
  error: HTMLElement | null;
  refreshMetadataButton: HTMLButtonElement | null;
  restoreCanonicalButton: HTMLButtonElement | null;
  closeButton: HTMLElement | null;
  status: HTMLElement | null;
};

export class RoomHistoryModalController {
  private readonly elements: HistoryModalElements;
  private activeTargetVersion: number | null = null;
  private activeAdminRestoreVersion: number | null = null;
  private activeCanonicalVersion: number | null = null;
  private activeLeaderboardTargetVersion: number | null = null;
  private activeLeaderboardSourceVersion: number | null = null;
  private metadataRefreshInFlight = false;

  private readonly handleCloseClick = () => {
    this.close();
  };

  private readonly handleBackdropClick = (event: Event) => {
    if (event.target === this.elements.modal) {
      this.close();
    }
  };

  private readonly handleDocumentKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || this.elements.modal?.classList.contains('hidden')) {
      return;
    }

    this.close();
  };

  private readonly handleWindowResize = () => {
    if (this.elements.modal?.classList.contains('hidden')) {
      return;
    }

    void this.render();
  };

  private readonly handleRefreshMetadataClick = async () => {
    const editorScene = getActiveEditorScene(this.game);
    if (!editorScene?.refreshMintMetadata) {
      return;
    }

    this.metadataRefreshInFlight = true;
    this.setError(null);
    await this.render();

    const result = await editorScene.refreshMintMetadata();
    this.metadataRefreshInFlight = false;

    if (!result) {
      const statusMessage = this.getEditorStatusText() || 'NFT metadata refresh failed.';
      this.setError(statusMessage);
      await this.render();
      return;
    }

    this.setError(null);
    await this.render();
  };

  private readonly handleRestoreCanonicalClick = async () => {
    const editorScene = getActiveEditorScene(this.game);
    const canonicalVersion = editorScene?.getHistoryState?.().canonicalVersion ?? null;
    if (!editorScene?.revertToVersion || canonicalVersion === null) {
      return;
    }

    await this.handleRevert(canonicalVersion);
  };

  constructor(
    private readonly game: Phaser.Game,
    private readonly doc: Document = document,
    private readonly windowObj: Window = window,
  ) {
    this.elements = {
      modal: this.doc.getElementById('room-history-modal'),
      meta: this.doc.getElementById('room-history-meta'),
      list: this.doc.getElementById('room-history-list'),
      error: this.doc.getElementById('room-history-error'),
      refreshMetadataButton: this.doc.getElementById('btn-room-history-refresh-metadata') as HTMLButtonElement | null,
      restoreCanonicalButton: this.doc.getElementById('btn-room-history-restore-canonical') as HTMLButtonElement | null,
      closeButton: this.doc.getElementById('btn-room-history-close'),
      status: this.doc.getElementById('room-save-status'),
    };
  }

  init(): void {
    this.elements.refreshMetadataButton?.addEventListener('click', this.handleRefreshMetadataClick);
    this.elements.restoreCanonicalButton?.addEventListener('click', this.handleRestoreCanonicalClick);
    this.elements.closeButton?.addEventListener('click', this.handleCloseClick);
    this.elements.modal?.addEventListener('click', this.handleBackdropClick);
    this.doc.addEventListener('keydown', this.handleDocumentKeydown);
    this.windowObj.addEventListener('resize', this.handleWindowResize);
  }

  destroy(): void {
    this.elements.refreshMetadataButton?.removeEventListener('click', this.handleRefreshMetadataClick);
    this.elements.restoreCanonicalButton?.removeEventListener('click', this.handleRestoreCanonicalClick);
    this.elements.closeButton?.removeEventListener('click', this.handleCloseClick);
    this.elements.modal?.removeEventListener('click', this.handleBackdropClick);
    this.doc.removeEventListener('keydown', this.handleDocumentKeydown);
    this.windowObj.removeEventListener('resize', this.handleWindowResize);
    this.close();
  }

  async open(): Promise<void> {
    const editorScene = getActiveEditorScene(this.game);
    if (!editorScene?.getHistoryState || !this.elements.modal) {
      return;
    }

    this.elements.modal.classList.remove('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'false');
    this.activeTargetVersion = null;
    this.activeAdminRestoreVersion = null;
    this.activeCanonicalVersion = null;
    this.activeLeaderboardTargetVersion = null;
    this.activeLeaderboardSourceVersion = null;
    this.metadataRefreshInFlight = false;
    this.setError(null);
    await this.render();
  }

  close(): void {
    if (!this.elements.modal || !this.elements.list) {
      return;
    }

    this.activeTargetVersion = null;
    this.activeAdminRestoreVersion = null;
    this.activeCanonicalVersion = null;
    this.activeLeaderboardTargetVersion = null;
    this.activeLeaderboardSourceVersion = null;
    this.metadataRefreshInFlight = false;
    this.setError(null);
    this.elements.list.replaceChildren();
    this.elements.modal.classList.add('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'true');
  }

  private getEditorStatusText(): string {
    return this.elements.status?.textContent?.trim() || '';
  }

  private setError(message: string | null): void {
    if (!this.elements.error) {
      return;
    }

    if (!message) {
      this.elements.error.textContent = '';
      this.elements.error.classList.add('hidden');
      return;
    }

    this.elements.error.textContent = message;
    this.elements.error.classList.remove('hidden');
  }

  private formatTimestamp(value: string | null): string {
    if (!value) {
      return 'Unknown time';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return HISTORY_TIME_FORMATTER.format(date);
  }

  private async handleRevert(targetVersion: number): Promise<void> {
    const editorScene = getActiveEditorScene(this.game);
    if (!editorScene?.revertToVersion) {
      return;
    }

    this.activeTargetVersion = targetVersion;
    this.setError(null);
    await this.render();

    const result = await editorScene.revertToVersion(targetVersion);

    this.activeTargetVersion = null;

    if (!result) {
      const statusMessage = this.getEditorStatusText() || `Revert to v${targetVersion} failed.`;
      this.setError(statusMessage);
      await this.render();
      return;
    }

    this.setError(null);
    await this.render();
  }

  private async handleAdminRestore(targetVersion: number): Promise<void> {
    const editorScene = getActiveEditorScene(this.game);
    if (!editorScene?.adminRestoreToVersion) {
      return;
    }

    this.activeAdminRestoreVersion = targetVersion;
    this.setError(null);
    await this.render();

    const result = await editorScene.adminRestoreToVersion(targetVersion);
    this.activeAdminRestoreVersion = null;

    if (!result) {
      const statusMessage = this.getEditorStatusText() || `Admin restore to v${targetVersion} failed.`;
      this.setError(statusMessage);
      await this.render();
      return;
    }

    this.setError(null);
    await this.render();
  }

  private async handleSetCanonical(targetVersion: number): Promise<void> {
    const editorScene = getActiveEditorScene(this.game);
    if (!editorScene?.setCanonicalVersion) {
      return;
    }

    this.activeCanonicalVersion = targetVersion;
    this.setError(null);
    await this.render();

    const result = await editorScene.setCanonicalVersion(targetVersion);
    this.activeCanonicalVersion = null;

    if (!result) {
      const statusMessage =
        this.getEditorStatusText() || `Setting canonical version to v${targetVersion} failed.`;
      this.setError(statusMessage);
      await this.render();
      return;
    }

    this.setError(null);
    await this.render();
  }

  private async handleSetLeaderboardSource(
    targetVersion: number,
    sourceVersion: number | null
  ): Promise<void> {
    const editorScene = getActiveEditorScene(this.game);
    if (!editorScene?.setLeaderboardSourceVersion) {
      return;
    }

    this.activeLeaderboardTargetVersion = targetVersion;
    this.activeLeaderboardSourceVersion = sourceVersion;
    this.setError(null);
    await this.render();

    const result = await editorScene.setLeaderboardSourceVersion(targetVersion, sourceVersion);
    this.activeLeaderboardTargetVersion = null;
    this.activeLeaderboardSourceVersion = null;

    if (!result) {
      const statusMessage =
        this.getEditorStatusText()
        || (
          sourceVersion === null
            ? `Restoring v${targetVersion} to its own leaderboard failed.`
            : `Setting v${targetVersion} to use leaderboard v${sourceVersion} failed.`
        );
      this.setError(statusMessage);
      await this.render();
      return;
    }

    this.setError(null);
    await this.render();
  }

  private renderMeta(state: EditorHistoryState): void {
    if (!this.elements.meta) {
      return;
    }

    const metaParts = [
      `Room ${state.roomId}`,
      `${state.versions.length} version${state.versions.length === 1 ? '' : 's'}`,
    ];

    if (state.claimerDisplayName) {
      const claimLine = state.claimedAt
        ? `Claimed by ${state.claimerDisplayName} on ${this.formatTimestamp(state.claimedAt)}`
        : `Claimed by ${state.claimerDisplayName}`;
      metaParts.push(claimLine);
    } else {
      metaParts.push('Unclaimed room');
    }

    if (!state.canPublish) {
      metaParts.push('Minted lock active');
    }

    const latestVersion = state.versions.reduce((max, version) => Math.max(max, version.version), 0);
    const lineage = buildRoomLeaderboardLineage(state.versions, state.canonicalVersion, latestVersion || null);
    if (state.canonicalVersion !== null) {
      metaParts.push(
        `Canonical v${lineage.exactLineage.canonicalRepresentativeVersion ?? state.canonicalVersion}`
      );
    }

    if (state.mintedTokenId) {
      metaParts.push(
        `Token #${state.mintedTokenId} · Owner ${state.mintedOwnerWalletAddress ?? 'unknown'}`
      );
      if (state.mintedMetadataRoomVersion === null) {
        metaParts.push('NFT metadata not set');
      } else if (state.mintedMetadataCurrent) {
        metaParts.push(`NFT metadata current at v${state.mintedMetadataRoomVersion}`);
      } else {
        metaParts.push(`NFT metadata stale at v${state.mintedMetadataRoomVersion}`);
      }
      if (state.mintedMetadataUpdatedAt) {
        metaParts.push(`Metadata updated ${this.formatTimestamp(state.mintedMetadataUpdatedAt)}`);
      }
    } else if (state.canMint) {
      metaParts.push('Eligible to mint');
    }

    this.elements.meta.textContent = metaParts.join(' | ');
  }

  private renderEmptyState(): void {
    if (!this.elements.list) {
      return;
    }

    const empty = this.doc.createElement('div');
    empty.className = 'history-version-empty';
    empty.textContent = 'No published versions yet.';
    this.elements.list.appendChild(empty);
  }

  private renderVersionRow(
    state: EditorHistoryState,
    latestVersion: number,
    version: EditorHistoryState['versions'][number],
    lineage: ReturnType<typeof buildRoomLeaderboardLineage>,
  ): HTMLElement {
    const row = this.doc.createElement('div');
    row.className = 'history-version-row';

    const copy = this.doc.createElement('div');
    copy.className = 'history-version-copy';

    const titleLine = this.doc.createElement('div');
    titleLine.className = 'history-version-line';

    const label = this.doc.createElement('div');
    label.className = 'history-version-label';
    label.textContent = `v${version.version}`;
    titleLine.appendChild(label);
    const lineageEntry = lineage.byVersion.get(version.version) ?? null;
    const leaderboardSourceRepresentativeVersion =
      lineageEntry?.leaderboardSourceRepresentativeVersion ?? null;
    const currentVersion = state.versions.find((candidate) => candidate.version === latestVersion) ?? null;
    const currentLineageEntry =
      currentVersion === null ? null : lineage.byVersion.get(currentVersion.version) ?? null;

    if (version.version === latestVersion) {
      const badge = this.doc.createElement('span');
      badge.className = 'history-version-badge';
      badge.textContent = 'Latest';
      titleLine.appendChild(badge);
    }

    if (lineageEntry?.isCanonical) {
      const badge = this.doc.createElement('span');
      badge.className = 'history-version-badge';
      badge.textContent = 'Canonical';
      titleLine.appendChild(badge);
    }

    if (lineageEntry && lineageEntry.sameAsVersion !== null) {
      const badge = this.doc.createElement('span');
      badge.className = 'history-version-badge';
      badge.textContent = `Same as v${lineageEntry.sameAsVersion}`;
      titleLine.appendChild(badge);
    }

    if (version.revertedFromVersion !== null) {
      const badge = this.doc.createElement('span');
      badge.className = 'history-version-badge';
      badge.textContent = `Revert of v${version.revertedFromVersion}`;
      titleLine.appendChild(badge);
    }

    if (leaderboardSourceRepresentativeVersion !== null) {
      const badge = this.doc.createElement('span');
      badge.className = 'history-version-badge';
      badge.textContent = `Leaderboard from v${leaderboardSourceRepresentativeVersion}`;
      titleLine.appendChild(badge);
    }

    const metaLine = this.doc.createElement('div');
    metaLine.className = 'history-version-meta';
    const lineParts = [`Published ${this.formatTimestamp(version.createdAt)}`];
    if (version.publishedByDisplayName) {
      lineParts.push(`by ${version.publishedByDisplayName}`);
    }
    metaLine.textContent = lineParts.join(' ');

    copy.appendChild(titleLine);
    copy.appendChild(metaLine);
    row.appendChild(copy);

    const actions = this.doc.createElement('div');
    actions.className = 'history-version-actions';
    const isChatModerator = ['admin', 'owner'].includes(getAuthDebugState().chatModeration.role);

    if (state.canRevert && version.version < latestVersion) {
      const button = this.doc.createElement('button');
      button.className = 'bar-btn bar-btn-small';
      button.textContent =
        this.activeTargetVersion === version.version ? 'Reverting...' : 'Revert';
      button.disabled = this.hasPendingAction();
      button.addEventListener('click', () => {
        void this.handleRevert(version.version);
      });
      actions.appendChild(button);
    } else if (isChatModerator && version.version < latestVersion) {
      const button = this.doc.createElement('button');
      button.className = 'bar-btn bar-btn-small';
      button.textContent =
        this.activeAdminRestoreVersion === version.version ? 'Restoring...' : 'Admin Restore';
      button.disabled = this.hasPendingAction();
      button.addEventListener('click', () => {
        void this.handleAdminRestore(version.version);
      });
      actions.appendChild(button);
    }

    if (state.canRevert && state.canonicalVersion !== version.version) {
      const button = this.doc.createElement('button');
      button.className = 'bar-btn bar-btn-small';
      button.textContent =
        this.activeCanonicalVersion === version.version ? 'Saving...' : 'Mark Canonical';
      button.disabled = this.hasPendingAction();
      button.addEventListener('click', () => {
        void this.handleSetCanonical(version.version);
      });
      actions.appendChild(button);
    }

    const manualLineageError =
      currentVersion && version.version < latestVersion
        ? getManualRoomLeaderboardSourceValidationError(currentVersion, version, lineage.exactLineage)
        : 'Only older published challenge versions can supply a leaderboard.';
    const currentSourceRepresentativeVersion =
      currentLineageEntry?.leaderboardSourceRepresentativeVersion ?? null;
    const currentUsesThisSource =
      currentSourceRepresentativeVersion !== null &&
      lineageEntry !== null &&
      currentSourceRepresentativeVersion === lineageEntry.representativeVersion;

    if (
      state.canRevert &&
      currentVersion &&
      version.version === currentVersion.version &&
      version.leaderboardSourceVersion !== null
    ) {
      const button = this.doc.createElement('button');
      button.className = 'bar-btn bar-btn-small';
      button.textContent =
        this.activeLeaderboardTargetVersion === version.version &&
        this.activeLeaderboardSourceVersion === null
          ? 'Saving...'
          : 'Use Own Leaderboard';
      button.disabled = this.hasPendingAction();
      button.addEventListener('click', () => {
        void this.handleSetLeaderboardSource(version.version, null);
      });
      actions.appendChild(button);
    } else if (
      state.canRevert &&
      currentVersion &&
      version.version < latestVersion &&
      manualLineageError === null
    ) {
      const button = this.doc.createElement('button');
      button.className = 'bar-btn bar-btn-small';
      button.textContent =
        this.activeLeaderboardTargetVersion === latestVersion &&
        this.activeLeaderboardSourceVersion === version.version
          ? 'Saving...'
          : currentUsesThisSource
            ? 'Using Leaderboard'
            : 'Use This Leaderboard';
      button.disabled = this.hasPendingAction() || currentUsesThisSource;
      button.addEventListener('click', () => {
        void this.handleSetLeaderboardSource(latestVersion, version.version);
      });
      actions.appendChild(button);
    }

    if (actions.childElementCount > 0) {
      row.appendChild(actions);
    }

    return row;
  }

  async render(): Promise<void> {
    if (
      !this.elements.modal ||
      !this.elements.meta ||
      !this.elements.list ||
      this.elements.modal.classList.contains('hidden')
    ) {
      return;
    }

    const editorScene = getActiveEditorScene(this.game);
    if (!editorScene?.getHistoryState) {
      this.close();
      return;
    }

    const state = editorScene.getHistoryState();
    const latestVersion = state.versions.reduce(
      (max, version) => Math.max(max, version.version),
      0,
    );
    const lineage = buildRoomLeaderboardLineage(state.versions, state.canonicalVersion, latestVersion || null);
    const versionsNewestFirst = [...state.versions].sort((a, b) => b.version - a.version);

    this.renderMeta(state);
    if (this.elements.refreshMetadataButton) {
      const refreshing = this.metadataRefreshInFlight;
      this.elements.refreshMetadataButton.classList.toggle(
        'hidden',
        !state.canRefreshMintMetadata,
      );
      this.elements.refreshMetadataButton.disabled = this.hasPendingAction();
      this.elements.refreshMetadataButton.textContent = refreshing
        ? 'Refreshing...'
        : 'Refresh NFT Metadata';
    }
    if (this.elements.restoreCanonicalButton) {
      const canonicalCurrent =
        state.canonicalVersion !== null &&
        (lineage.byVersion.get(latestVersion)?.inCanonicalGroup ?? false);
      const showRestore = state.canRevert && state.canonicalVersion !== null && !canonicalCurrent;
      this.elements.restoreCanonicalButton.classList.toggle('hidden', !showRestore);
      this.elements.restoreCanonicalButton.disabled = this.hasPendingAction();
      this.elements.restoreCanonicalButton.textContent =
        state.canonicalVersion !== null && lineage.exactLineage.canonicalRepresentativeVersion !== null
          ? `Restore Canonical (v${lineage.exactLineage.canonicalRepresentativeVersion})`
          : 'Restore Canonical';
    }
    this.elements.list.replaceChildren();

    if (versionsNewestFirst.length === 0) {
      this.renderEmptyState();
      return;
    }

    for (const version of versionsNewestFirst) {
      this.elements.list.appendChild(this.renderVersionRow(state, latestVersion, version, lineage));
    }
  }

  private hasPendingAction(): boolean {
    return (
      this.activeTargetVersion !== null ||
      this.activeAdminRestoreVersion !== null ||
      this.activeCanonicalVersion !== null ||
      this.activeLeaderboardTargetVersion !== null ||
      this.metadataRefreshInFlight
    );
  }
}

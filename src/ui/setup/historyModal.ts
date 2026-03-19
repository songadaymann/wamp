import Phaser from 'phaser';
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
  closeButton: HTMLElement | null;
  status: HTMLElement | null;
};

export class RoomHistoryModalController {
  private readonly elements: HistoryModalElements;
  private activeTargetVersion: number | null = null;

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

    this.activeTargetVersion = -1;
    this.setError(null);
    await this.render();

    const result = await editorScene.refreshMintMetadata();
    this.activeTargetVersion = null;

    if (!result) {
      const statusMessage = this.getEditorStatusText() || 'NFT metadata refresh failed.';
      this.setError(statusMessage);
      await this.render();
      return;
    }

    this.setError(null);
    await this.render();
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
      closeButton: this.doc.getElementById('btn-room-history-close'),
      status: this.doc.getElementById('room-save-status'),
    };
  }

  init(): void {
    this.elements.refreshMetadataButton?.addEventListener('click', this.handleRefreshMetadataClick);
    this.elements.closeButton?.addEventListener('click', this.handleCloseClick);
    this.elements.modal?.addEventListener('click', this.handleBackdropClick);
    this.doc.addEventListener('keydown', this.handleDocumentKeydown);
    this.windowObj.addEventListener('resize', this.handleWindowResize);
  }

  destroy(): void {
    this.elements.refreshMetadataButton?.removeEventListener('click', this.handleRefreshMetadataClick);
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
    this.setError(null);
    await this.render();
  }

  close(): void {
    if (!this.elements.modal || !this.elements.list) {
      return;
    }

    this.activeTargetVersion = null;
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

    if (version.version === latestVersion) {
      const badge = this.doc.createElement('span');
      badge.className = 'history-version-badge';
      badge.textContent = 'Latest';
      titleLine.appendChild(badge);
    }

    if (version.revertedFromVersion !== null) {
      const badge = this.doc.createElement('span');
      badge.className = 'history-version-badge';
      badge.textContent = `Revert of v${version.revertedFromVersion}`;
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

    if (state.canRevert && version.version < latestVersion) {
      const button = this.doc.createElement('button');
      button.className = 'bar-btn bar-btn-small';
      button.textContent =
        this.activeTargetVersion === version.version ? 'Reverting...' : 'Revert';
      button.disabled = this.activeTargetVersion !== null;
      button.addEventListener('click', () => {
        void this.handleRevert(version.version);
      });
      row.appendChild(button);
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
    const versionsNewestFirst = [...state.versions].sort((a, b) => b.version - a.version);

    this.renderMeta(state);
    if (this.elements.refreshMetadataButton) {
      const refreshing = this.activeTargetVersion === -1;
      this.elements.refreshMetadataButton.classList.toggle(
        'hidden',
        !state.canRefreshMintMetadata,
      );
      this.elements.refreshMetadataButton.disabled =
        refreshing || this.activeTargetVersion !== null;
      this.elements.refreshMetadataButton.textContent = refreshing
        ? 'Refreshing...'
        : 'Refresh NFT Metadata';
    }
    this.elements.list.replaceChildren();

    if (versionsNewestFirst.length === 0) {
      this.renderEmptyState();
      return;
    }

    for (const version of versionsNewestFirst) {
      this.elements.list.appendChild(this.renderVersionRow(state, latestVersion, version));
    }
  }
}

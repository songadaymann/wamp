import Phaser from 'phaser';
import type { RoomLeaderboardEntry, RoomLeaderboardResponse, GlobalLeaderboardEntry, GlobalLeaderboardResponse } from '../../runs/model';
import { createRunRepository, type RunRepository } from '../../runs/runRepository';
import { createRoomRepository, type RoomRepository, type RoomVersionRecord } from '../../persistence/roomRepository';
import { getActiveOverworldScene, type OverworldSelectedRoomContext } from './sceneBridge';

type LeaderboardTab = 'room' | 'global';

type LeaderboardModalElements = {
  modal: HTMLElement | null;
  meta: HTMLElement | null;
  error: HTMLElement | null;
  closeButton: HTMLElement | null;
  roomTabButton: HTMLButtonElement | null;
  globalTabButton: HTMLButtonElement | null;
  roomPanel: HTMLElement | null;
  globalPanel: HTMLElement | null;
  versionSelect: HTMLSelectElement | null;
  roomSummary: HTMLElement | null;
  roomViewer: HTMLElement | null;
  roomList: HTMLElement | null;
  globalSummary: HTMLElement | null;
  globalViewer: HTMLElement | null;
  globalList: HTMLElement | null;
};

export class LeaderboardModalController {
  private readonly elements: LeaderboardModalElements;
  private activeTab: LeaderboardTab = 'room';
  private roomVersions: RoomVersionRecord[] = [];
  private selectedVersion: number | null = null;
  private roomLeaderboard: RoomLeaderboardResponse | null = null;
  private globalLeaderboard: GlobalLeaderboardResponse | null = null;
  private roomContext: OverworldSelectedRoomContext | null = null;
  private loading = false;

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

  constructor(
    private readonly game: Phaser.Game,
    private readonly runRepository: RunRepository = createRunRepository(),
    private readonly roomRepository: RoomRepository = createRoomRepository(),
    private readonly doc: Document = document,
  ) {
    this.elements = {
      modal: this.doc.getElementById('leaderboard-modal'),
      meta: this.doc.getElementById('leaderboard-modal-meta'),
      error: this.doc.getElementById('leaderboard-modal-error'),
      closeButton: this.doc.getElementById('btn-leaderboard-close'),
      roomTabButton: this.doc.getElementById('btn-leaderboard-tab-room') as HTMLButtonElement | null,
      globalTabButton: this.doc.getElementById('btn-leaderboard-tab-global') as HTMLButtonElement | null,
      roomPanel: this.doc.getElementById('leaderboard-room-panel'),
      globalPanel: this.doc.getElementById('leaderboard-global-panel'),
      versionSelect: this.doc.getElementById('leaderboard-version-select') as HTMLSelectElement | null,
      roomSummary: this.doc.getElementById('leaderboard-room-summary'),
      roomViewer: this.doc.getElementById('leaderboard-room-viewer'),
      roomList: this.doc.getElementById('leaderboard-room-list'),
      globalSummary: this.doc.getElementById('leaderboard-global-summary'),
      globalViewer: this.doc.getElementById('leaderboard-global-viewer'),
      globalList: this.doc.getElementById('leaderboard-global-list'),
    };
  }

  init(): void {
    this.elements.closeButton?.addEventListener('click', this.handleCloseClick);
    this.elements.modal?.addEventListener('click', this.handleBackdropClick);
    this.doc.addEventListener('keydown', this.handleDocumentKeydown);
    this.elements.roomTabButton?.addEventListener('click', () => {
      if (!this.elements.roomTabButton?.disabled) {
        this.activeTab = 'room';
        this.render();
      }
    });
    this.elements.globalTabButton?.addEventListener('click', () => {
      this.activeTab = 'global';
      this.render();
    });
    this.elements.versionSelect?.addEventListener('change', () => {
      const nextVersion = Number.parseInt(this.elements.versionSelect?.value ?? '', 10);
      this.selectedVersion = Number.isInteger(nextVersion) ? nextVersion : null;
      void this.loadRoomLeaderboard();
    });
  }

  destroy(): void {
    this.elements.closeButton?.removeEventListener('click', this.handleCloseClick);
    this.elements.modal?.removeEventListener('click', this.handleBackdropClick);
    this.doc.removeEventListener('keydown', this.handleDocumentKeydown);
    this.close();
  }

  async open(): Promise<void> {
    if (!this.elements.modal) {
      return;
    }

    this.elements.modal.classList.remove('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'false');
    this.setError(null);
    this.loading = true;
    this.roomLeaderboard = null;
    this.globalLeaderboard = null;
    this.roomVersions = [];
    this.selectedVersion = null;
    this.activeTab = 'room';
    this.render();
    await this.load();
  }

  close(): void {
    if (!this.elements.modal) {
      return;
    }

    this.elements.modal.classList.add('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'true');
    this.setError(null);
  }

  private async load(): Promise<void> {
    try {
      const scene = getActiveOverworldScene(this.game);
      this.roomContext = scene?.getSelectedRoomContext?.() ?? null;
      const [globalLeaderboard, roomVersions] = await Promise.all([
        this.runRepository.loadGlobalLeaderboard(25),
        this.loadRoomVersions(),
      ]);

      this.globalLeaderboard = globalLeaderboard;
      this.roomVersions = roomVersions;
      this.activeTab =
        this.roomVersions.length > 0 && this.roomContext?.state === 'published'
          ? 'room'
          : 'global';
      this.selectedVersion =
        this.roomVersions[this.roomVersions.length - 1]?.version ?? null;
      await this.loadRoomLeaderboard();
    } catch (error) {
      console.error('Failed to load leaderboards', error);
      this.setError(error instanceof Error ? error.message : 'Failed to load leaderboards.');
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private async loadRoomVersions(): Promise<RoomVersionRecord[]> {
    if (!this.roomContext || this.roomContext.state !== 'published') {
      return [];
    }

    const record = await this.roomRepository.loadRoom(
      this.roomContext.roomId,
      this.roomContext.coordinates
    );

    return record.versions.filter((version) => version.snapshot.goal !== null);
  }

  private async loadRoomLeaderboard(): Promise<void> {
    if (!this.roomContext || this.roomContext.state !== 'published' || this.selectedVersion === null) {
      this.roomLeaderboard = null;
      this.render();
      return;
    }

    try {
      this.roomLeaderboard = await this.runRepository.loadRoomLeaderboard(
        this.roomContext.roomId,
        this.roomContext.coordinates,
        this.selectedVersion,
        25
      );
      this.setError(null);
    } catch (error) {
      console.error('Failed to load room leaderboard', error);
      this.roomLeaderboard = null;
      this.setError(error instanceof Error ? error.message : 'Failed to load room leaderboard.');
    } finally {
      this.render();
    }
  }

  private render(): void {
    const roomAvailable = this.roomVersions.length > 0 && this.roomContext?.state === 'published';
    this.elements.roomTabButton?.classList.toggle('active', this.activeTab === 'room');
    this.elements.globalTabButton?.classList.toggle('active', this.activeTab === 'global');
    if (this.elements.roomTabButton) {
      this.elements.roomTabButton.disabled = !roomAvailable;
    }
    if (!roomAvailable) {
      this.activeTab = 'global';
    }

    this.elements.roomPanel?.classList.toggle('hidden', this.activeTab !== 'room');
    this.elements.globalPanel?.classList.toggle('hidden', this.activeTab !== 'global');
    this.renderMeta();
    this.renderVersionSelect();
    this.renderRoomPanel();
    this.renderGlobalPanel();
  }

  private renderMeta(): void {
    if (!this.elements.meta) {
      return;
    }

    if (this.loading) {
      this.elements.meta.textContent = 'Loading leaderboards...';
      return;
    }

    if (this.activeTab === 'room') {
      const roomLabel = this.roomLeaderboard
        ? `${this.roomLeaderboard.roomTitle?.trim() || `Room ${this.roomLeaderboard.roomCoordinates.x},${this.roomLeaderboard.roomCoordinates.y}`} · ${this.roomLeaderboard.roomCoordinates.x},${this.roomLeaderboard.roomCoordinates.y} · ${this.roomLeaderboard.goalType.replace('_', ' ')} · v${this.roomLeaderboard.roomVersion}`
        : 'No published room challenge selected.';
      this.elements.meta.textContent = roomLabel;
      return;
    }

    this.elements.meta.textContent = 'Global points leaderboard.';
  }

  private renderVersionSelect(): void {
    if (!this.elements.versionSelect) {
      return;
    }

    this.elements.versionSelect.replaceChildren();
    if (this.roomVersions.length === 0) {
      const option = this.doc.createElement('option');
      option.value = '';
      option.textContent = 'No versions';
      this.elements.versionSelect.appendChild(option);
      this.elements.versionSelect.disabled = true;
      return;
    }

    this.elements.versionSelect.disabled = false;
    for (const version of this.roomVersions) {
      const option = this.doc.createElement('option');
      option.value = String(version.version);
      option.textContent = `v${version.version}`;
      if (version.version === this.selectedVersion) {
        option.selected = true;
      }
      this.elements.versionSelect.appendChild(option);
    }
  }

  private renderRoomPanel(): void {
    if (!this.elements.roomList || !this.elements.roomSummary || !this.elements.roomViewer) {
      return;
    }

    this.elements.roomList.replaceChildren();
    this.elements.roomSummary.textContent = this.loading
      ? 'Loading room leaderboard...'
      : this.roomLeaderboard
        ? `${this.roomLeaderboard.entries.length} ranked run${this.roomLeaderboard.entries.length === 1 ? '' : 's'} · ${this.roomLeaderboard.rankingMode === 'time' ? 'fastest time wins' : 'highest score wins'}`
        : 'No published room leaderboard available.';

    const viewer = this.roomLeaderboard?.viewerBest ?? null;
    this.elements.roomViewer.classList.toggle('hidden', viewer === null);
    if (viewer) {
      this.elements.roomViewer.textContent =
        `You: #${this.roomLeaderboard?.viewerRank ?? viewer.rank} · ${this.formatRoomMetric(viewer, this.roomLeaderboard?.rankingMode ?? 'time')} · ${viewer.deaths} deaths`;
    } else {
      this.elements.roomViewer.textContent = '';
    }

    if (!this.roomLeaderboard || this.roomLeaderboard.entries.length === 0) {
      const empty = this.doc.createElement('div');
      empty.className = 'leaderboard-empty';
      empty.textContent = this.roomVersions.length === 0
        ? 'Select a published challenge room to view rankings.'
        : 'No completed ranked runs yet.';
      this.elements.roomList.appendChild(empty);
      return;
    }

    for (const entry of this.roomLeaderboard.entries) {
      this.elements.roomList.appendChild(
        this.renderRoomEntry(entry, this.roomLeaderboard.rankingMode)
      );
    }
  }

  private renderGlobalPanel(): void {
    if (!this.elements.globalList || !this.elements.globalSummary || !this.elements.globalViewer) {
      return;
    }

    this.elements.globalList.replaceChildren();
    this.elements.globalSummary.textContent = this.loading
      ? 'Loading global leaderboard...'
      : 'Points for publishing rooms and finishing challenges.';

    const viewer = this.globalLeaderboard?.viewerEntry ?? null;
    this.elements.globalViewer.classList.toggle('hidden', viewer === null);
    if (viewer) {
      this.elements.globalViewer.textContent =
        `You: #${viewer.rank} · ${viewer.totalPoints} pts · ${viewer.completedRuns} clears · ${viewer.totalRoomsPublished} rooms`;
    } else {
      this.elements.globalViewer.textContent = '';
    }

    if (!this.globalLeaderboard || this.globalLeaderboard.entries.length === 0) {
      const empty = this.doc.createElement('div');
      empty.className = 'leaderboard-empty';
      empty.textContent = 'No global points yet.';
      this.elements.globalList.appendChild(empty);
      return;
    }

    for (const entry of this.globalLeaderboard.entries) {
      this.elements.globalList.appendChild(this.renderGlobalEntry(entry));
    }
  }

  private renderRoomEntry(entry: RoomLeaderboardEntry, rankingMode: RoomLeaderboardResponse['rankingMode']): HTMLElement {
    const row = this.doc.createElement('div');
    row.className = 'history-version-row leaderboard-row';

    row.appendChild(this.createCell('leaderboard-rank', `#${entry.rank}`));

    const playerCell = this.doc.createElement('div');
    playerCell.className = 'leaderboard-primary';
    playerCell.textContent = entry.userDisplayName;
    row.appendChild(playerCell);

    row.appendChild(this.createCell('leaderboard-primary', this.formatRoomMetric(entry, rankingMode)));
    row.appendChild(this.createCell('leaderboard-secondary', `${entry.deaths} deaths`));
    row.appendChild(this.createCell('leaderboard-secondary', this.formatShortDate(entry.finishedAt)));
    return row;
  }

  private renderGlobalEntry(entry: GlobalLeaderboardEntry): HTMLElement {
    const row = this.doc.createElement('div');
    row.className = 'history-version-row leaderboard-row leaderboard-global-row';

    row.appendChild(this.createCell('leaderboard-rank', `#${entry.rank}`));
    row.appendChild(this.createCell('leaderboard-primary', entry.userDisplayName));
    row.appendChild(this.createCell('leaderboard-primary', `${entry.totalPoints} pts`));
    row.appendChild(this.createCell('leaderboard-secondary', `${entry.completedRuns} clears`));
    row.appendChild(this.createCell('leaderboard-secondary', `${entry.totalRoomsPublished} rooms`));
    return row;
  }

  private createCell(className: string, text: string): HTMLElement {
    const cell = this.doc.createElement('div');
    cell.className = className;
    cell.textContent = text;
    return cell;
  }

  private formatRoomMetric(entry: RoomLeaderboardEntry, rankingMode: RoomLeaderboardResponse['rankingMode']): string {
    return rankingMode === 'time'
      ? `${(entry.elapsedMs / 1000).toFixed(2)}s`
      : `${entry.score} pts`;
  }

  private formatShortDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
    }).format(date);
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
}

import Phaser from 'phaser';
import {
  ROOM_DIFFICULTIES,
  ROOM_DIFFICULTY_LABELS,
  type GlobalLeaderboardEntry,
  type GlobalLeaderboardResponse,
  type RoomDifficulty,
  type RoomDiscoveryEntry,
  type RoomDiscoveryResponse,
  type RoomLeaderboardEntry,
  type RoomLeaderboardResponse,
} from '../../runs/model';
import { createRunRepository, type RunRepository } from '../../runs/runRepository';
import { createRoomRepository, type RoomRepository, type RoomVersionRecord } from '../../persistence/roomRepository';
import {
  createCourseRepository,
  type CourseRepository,
} from '../../courses/courseRepository';
import type {
  CourseLeaderboardEntry,
  CourseLeaderboardResponse,
} from '../../courses/runModel';
import { getActiveOverworldScene, type OverworldSelectedRoomContext } from './sceneBridge';

type LeaderboardTab = 'room' | 'discover' | 'course' | 'global';

type LeaderboardModalElements = {
  modal: HTMLElement | null;
  meta: HTMLElement | null;
  error: HTMLElement | null;
  closeButton: HTMLElement | null;
  roomTabButton: HTMLButtonElement | null;
  discoverTabButton: HTMLButtonElement | null;
  courseTabButton: HTMLButtonElement | null;
  globalTabButton: HTMLButtonElement | null;
  roomPanel: HTMLElement | null;
  discoverPanel: HTMLElement | null;
  coursePanel: HTMLElement | null;
  globalPanel: HTMLElement | null;
  versionSelect: HTMLSelectElement | null;
  roomSummary: HTMLElement | null;
  roomViewer: HTMLElement | null;
  roomDifficultySummary: HTMLElement | null;
  roomDifficultyStatus: HTMLElement | null;
  roomDifficultyButtons: HTMLButtonElement[];
  roomList: HTMLElement | null;
  discoverFilterButtons: HTMLButtonElement[];
  discoverSummary: HTMLElement | null;
  discoverList: HTMLElement | null;
  courseSummary: HTMLElement | null;
  courseViewer: HTMLElement | null;
  courseList: HTMLElement | null;
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
  private roomDiscovery: RoomDiscoveryResponse | null = null;
  private courseLeaderboard: CourseLeaderboardResponse | null = null;
  private globalLeaderboard: GlobalLeaderboardResponse | null = null;
  private roomContext: OverworldSelectedRoomContext | null = null;
  private loading = false;
  private discoverLoading = false;
  private voteSubmitting = false;
  private discoverFilter: RoomDifficulty | null = null;

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
    private readonly courseRepository: CourseRepository = createCourseRepository(),
    private readonly doc: Document = document,
  ) {
    this.elements = {
      modal: this.doc.getElementById('leaderboard-modal'),
      meta: this.doc.getElementById('leaderboard-modal-meta'),
      error: this.doc.getElementById('leaderboard-modal-error'),
      closeButton: this.doc.getElementById('btn-leaderboard-close'),
      roomTabButton: this.doc.getElementById('btn-leaderboard-tab-room') as HTMLButtonElement | null,
      discoverTabButton: this.doc.getElementById('btn-leaderboard-tab-discover') as HTMLButtonElement | null,
      courseTabButton: this.doc.getElementById('btn-leaderboard-tab-course') as HTMLButtonElement | null,
      globalTabButton: this.doc.getElementById('btn-leaderboard-tab-global') as HTMLButtonElement | null,
      roomPanel: this.doc.getElementById('leaderboard-room-panel'),
      discoverPanel: this.doc.getElementById('leaderboard-discover-panel'),
      coursePanel: this.doc.getElementById('leaderboard-course-panel'),
      globalPanel: this.doc.getElementById('leaderboard-global-panel'),
      versionSelect: this.doc.getElementById('leaderboard-version-select') as HTMLSelectElement | null,
      roomSummary: this.doc.getElementById('leaderboard-room-summary'),
      roomViewer: this.doc.getElementById('leaderboard-room-viewer'),
      roomDifficultySummary: this.doc.getElementById('leaderboard-room-difficulty-summary'),
      roomDifficultyStatus: this.doc.getElementById('leaderboard-room-difficulty-status'),
      roomDifficultyButtons: Array.from(
        this.doc.querySelectorAll<HTMLButtonElement>('#leaderboard-room-difficulty-actions [data-room-difficulty]')
      ),
      roomList: this.doc.getElementById('leaderboard-room-list'),
      discoverFilterButtons: Array.from(
        this.doc.querySelectorAll<HTMLButtonElement>('#leaderboard-discover-filters [data-discover-difficulty]')
      ),
      discoverSummary: this.doc.getElementById('leaderboard-discover-summary'),
      discoverList: this.doc.getElementById('leaderboard-discover-list'),
      courseSummary: this.doc.getElementById('leaderboard-course-summary'),
      courseViewer: this.doc.getElementById('leaderboard-course-viewer'),
      courseList: this.doc.getElementById('leaderboard-course-list'),
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
    this.elements.discoverTabButton?.addEventListener('click', () => {
      this.activeTab = 'discover';
      this.render();
    });
    this.elements.courseTabButton?.addEventListener('click', () => {
      if (!this.elements.courseTabButton?.disabled) {
        this.activeTab = 'course';
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
    for (const button of this.elements.roomDifficultyButtons) {
      button.addEventListener('click', () => {
        const difficulty = this.parseDifficultyButtonValue(button.dataset.roomDifficulty);
        if (difficulty) {
          void this.submitRoomDifficultyVote(difficulty);
        }
      });
    }
    for (const button of this.elements.discoverFilterButtons) {
      button.addEventListener('click', () => {
        const difficulty = this.parseDifficultyButtonValue(button.dataset.discoverDifficulty);
        this.discoverFilter = difficulty;
        void this.loadDiscoveryResults();
      });
    }
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
    this.discoverLoading = true;
    this.voteSubmitting = false;
    this.roomLeaderboard = null;
    this.roomDiscovery = null;
    this.courseLeaderboard = null;
    this.globalLeaderboard = null;
    this.roomVersions = [];
    this.selectedVersion = null;
    this.discoverFilter = null;
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
          : this.roomContext?.courseId
            ? 'course'
            : 'discover';
      this.selectedVersion =
        this.roomVersions[this.roomVersions.length - 1]?.version ?? null;
      await Promise.all([
        this.loadRoomLeaderboard(),
        this.loadCourseLeaderboard(),
        this.loadDiscoveryResults(),
      ]);
    } catch (error) {
      console.error('Failed to load leaderboards', error);
      this.setError(error instanceof Error ? error.message : 'Failed to load leaderboards.');
    } finally {
      this.loading = false;
      this.discoverLoading = false;
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

  private async loadCourseLeaderboard(): Promise<void> {
    if (!this.roomContext?.courseId) {
      this.courseLeaderboard = null;
      this.render();
      return;
    }

    try {
      this.courseLeaderboard = await this.courseRepository.loadCourseLeaderboard(
        this.roomContext.courseId,
        null,
        25
      );
      this.setError(null);
    } catch (error) {
      console.error('Failed to load course leaderboard', error);
      this.courseLeaderboard = null;
      this.setError(error instanceof Error ? error.message : 'Failed to load course leaderboard.');
    } finally {
      this.render();
    }
  }

  private async loadDiscoveryResults(): Promise<void> {
    this.discoverLoading = true;
    this.render();
    try {
      this.roomDiscovery = await this.runRepository.loadRoomDiscovery(this.discoverFilter, 100);
      this.setError(null);
    } catch (error) {
      console.error('Failed to load room discovery', error);
      this.roomDiscovery = null;
      this.setError(error instanceof Error ? error.message : 'Failed to load room discovery.');
    } finally {
      this.discoverLoading = false;
      this.render();
    }
  }

  private async submitRoomDifficultyVote(difficulty: RoomDifficulty): Promise<void> {
    if (!this.roomLeaderboard || this.voteSubmitting) {
      return;
    }

    this.voteSubmitting = true;
    this.render();
    try {
      await this.runRepository.submitRoomDifficultyVote(this.roomLeaderboard.roomId, {
        roomCoordinates: this.roomLeaderboard.roomCoordinates,
        roomVersion: this.roomLeaderboard.roomVersion,
        difficulty,
      });
      await Promise.all([this.loadRoomLeaderboard(), this.loadDiscoveryResults()]);
      this.setError(null);
    } catch (error) {
      console.error('Failed to submit room difficulty vote', error);
      this.setError(
        error instanceof Error ? error.message : 'Failed to submit room difficulty vote.'
      );
    } finally {
      this.voteSubmitting = false;
      this.render();
    }
  }

  private render(): void {
    const roomAvailable = this.roomVersions.length > 0 && this.roomContext?.state === 'published';
    const courseAvailable = Boolean(this.roomContext?.courseId);
    this.elements.roomTabButton?.classList.toggle('active', this.activeTab === 'room');
    this.elements.discoverTabButton?.classList.toggle('active', this.activeTab === 'discover');
    this.elements.courseTabButton?.classList.toggle('active', this.activeTab === 'course');
    this.elements.globalTabButton?.classList.toggle('active', this.activeTab === 'global');
    if (this.elements.roomTabButton) {
      this.elements.roomTabButton.disabled = !roomAvailable;
    }
    if (this.elements.courseTabButton) {
      this.elements.courseTabButton.disabled = !courseAvailable;
    }
    if (!roomAvailable && this.activeTab === 'room') {
      this.activeTab = courseAvailable ? 'course' : 'discover';
    }
    if (!courseAvailable && this.activeTab === 'course') {
      this.activeTab = 'discover';
    }

    this.elements.roomPanel?.classList.toggle('hidden', this.activeTab !== 'room');
    this.elements.discoverPanel?.classList.toggle('hidden', this.activeTab !== 'discover');
    this.elements.coursePanel?.classList.toggle('hidden', this.activeTab !== 'course');
    this.elements.globalPanel?.classList.toggle('hidden', this.activeTab !== 'global');
    this.renderMeta();
    this.renderVersionSelect();
    this.renderRoomPanel();
    this.renderDiscoverPanel();
    this.renderCoursePanel();
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

    if (this.activeTab === 'course') {
      const courseLabel = this.courseLeaderboard
        ? `${this.courseLeaderboard.courseTitle?.trim() || 'Course'} · ${this.courseLeaderboard.goalType.replace('_', ' ')} · v${this.courseLeaderboard.courseVersion}`
        : 'No published course selected.';
      this.elements.meta.textContent = courseLabel;
      return;
    }

    if (this.activeTab === 'discover') {
      this.elements.meta.textContent =
        this.discoverFilter === null
          ? 'Browse published room challenges by player-rated difficulty.'
          : `Browse ${ROOM_DIFFICULTY_LABELS[this.discoverFilter].toLowerCase()}-rated published room challenges.`;
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
    if (
      !this.elements.roomList ||
      !this.elements.roomSummary ||
      !this.elements.roomViewer ||
      !this.elements.roomDifficultySummary ||
      !this.elements.roomDifficultyStatus
    ) {
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

    const difficulty = this.roomLeaderboard?.difficulty ?? null;
    const consensusText =
      difficulty === null || difficulty.totalVotes === 0
        ? 'No difficulty ratings yet.'
        : `Consensus: ${
            difficulty.consensus ? ROOM_DIFFICULTY_LABELS[difficulty.consensus] : 'Unrated'
          } · ${difficulty.totalVotes} vote${difficulty.totalVotes === 1 ? '' : 's'}`;
    this.elements.roomDifficultySummary.textContent = consensusText;
    this.elements.roomDifficultyStatus.textContent = this.getDifficultyStatusText();
    for (const button of this.elements.roomDifficultyButtons) {
      const difficultyValue = this.parseDifficultyButtonValue(button.dataset.roomDifficulty);
      if (!difficultyValue) {
        button.disabled = true;
        continue;
      }

      const count = difficulty?.counts[difficultyValue] ?? 0;
      button.textContent = `${ROOM_DIFFICULTY_LABELS[difficultyValue]} · ${count}`;
      button.classList.toggle('active', difficulty?.viewerVote === difficultyValue);
      button.disabled = this.voteSubmitting || !difficulty?.viewerCanVote;
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

  private renderDiscoverPanel(): void {
    if (!this.elements.discoverList || !this.elements.discoverSummary) {
      return;
    }

    this.elements.discoverList.replaceChildren();
    for (const button of this.elements.discoverFilterButtons) {
      const difficulty = this.parseDifficultyButtonValue(button.dataset.discoverDifficulty);
      button.classList.toggle('active', difficulty === this.discoverFilter);
    }

    if (this.discoverLoading) {
      this.elements.discoverSummary.textContent = 'Loading room discovery...';
      return;
    }

    const results = this.roomDiscovery?.results ?? [];
    this.elements.discoverSummary.textContent =
      this.discoverFilter === null
        ? `${results.length} published challenge room${results.length === 1 ? '' : 's'}`
        : `${results.length} ${ROOM_DIFFICULTY_LABELS[this.discoverFilter].toLowerCase()} room${results.length === 1 ? '' : 's'}`;

    if (results.length === 0) {
      const empty = this.doc.createElement('div');
      empty.className = 'leaderboard-empty';
      empty.textContent =
        this.discoverFilter === null
          ? 'No published challenge rooms found yet.'
          : `No ${ROOM_DIFFICULTY_LABELS[this.discoverFilter].toLowerCase()}-rated rooms yet.`;
      this.elements.discoverList.appendChild(empty);
      return;
    }

    for (const entry of results) {
      this.elements.discoverList.appendChild(this.renderDiscoverEntry(entry));
    }
  }

  private renderCoursePanel(): void {
    if (!this.elements.courseList || !this.elements.courseSummary || !this.elements.courseViewer) {
      return;
    }

    this.elements.courseList.replaceChildren();
    this.elements.courseSummary.textContent = this.loading
      ? 'Loading course leaderboard...'
      : this.courseLeaderboard
        ? `${this.courseLeaderboard.entries.length} ranked run${this.courseLeaderboard.entries.length === 1 ? '' : 's'} · ${this.courseLeaderboard.rankingMode === 'time' ? 'fastest time wins' : 'highest score wins'}`
        : 'No published course leaderboard available.';

    const viewer = this.courseLeaderboard?.viewerBest ?? null;
    this.elements.courseViewer.classList.toggle('hidden', viewer === null);
    if (viewer && this.courseLeaderboard) {
      this.elements.courseViewer.textContent =
        `You: #${this.courseLeaderboard.viewerRank ?? viewer.rank} · ${this.formatCourseMetric(viewer, this.courseLeaderboard.rankingMode)} · ${viewer.deaths} deaths`;
    } else {
      this.elements.courseViewer.textContent = '';
    }

    if (!this.courseLeaderboard || this.courseLeaderboard.entries.length === 0) {
      const empty = this.doc.createElement('div');
      empty.className = 'leaderboard-empty';
      empty.textContent = this.roomContext?.courseId
        ? 'No completed ranked course runs yet.'
        : 'Select a published course room to view course rankings.';
      this.elements.courseList.appendChild(empty);
      return;
    }

    for (const entry of this.courseLeaderboard.entries) {
      this.elements.courseList.appendChild(
        this.renderCourseEntry(entry, this.courseLeaderboard.rankingMode)
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

  private renderDiscoverEntry(entry: RoomDiscoveryEntry): HTMLElement {
    const button = this.doc.createElement('button');
    button.className = 'leaderboard-discover-row';
    button.type = 'button';
    button.addEventListener('click', () => {
      this.close();
      void getActiveOverworldScene(this.game)?.jumpToCoordinates?.(entry.roomCoordinates);
    });

    const title = this.doc.createElement('div');
    title.className = 'leaderboard-discover-title';
    title.textContent =
      entry.roomTitle?.trim() || `Room ${entry.roomCoordinates.x},${entry.roomCoordinates.y}`;
    button.appendChild(title);

    const meta = this.doc.createElement('div');
    meta.className = 'leaderboard-discover-meta';
    const difficultyLabel = entry.consensusDifficulty
      ? ROOM_DIFFICULTY_LABELS[entry.consensusDifficulty]
      : 'Unrated';
    meta.textContent = `${entry.goalType.replace('_', ' ')} · ${difficultyLabel} · ${
      entry.voteCount
    } vote${entry.voteCount === 1 ? '' : 's'} · ${entry.roomCoordinates.x},${entry.roomCoordinates.y}`;
    button.appendChild(meta);
    return button;
  }

  private renderCourseEntry(
    entry: CourseLeaderboardEntry,
    rankingMode: CourseLeaderboardResponse['rankingMode']
  ): HTMLElement {
    const row = this.doc.createElement('div');
    row.className = 'history-version-row leaderboard-row';

    row.appendChild(this.createCell('leaderboard-rank', `#${entry.rank}`));
    row.appendChild(this.createCell('leaderboard-primary', entry.userDisplayName));
    row.appendChild(this.createCell('leaderboard-primary', this.formatCourseMetric(entry, rankingMode)));
    row.appendChild(this.createCell('leaderboard-secondary', `${entry.deaths} deaths`));
    row.appendChild(this.createCell('leaderboard-secondary', this.formatShortDate(entry.finishedAt)));
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

  private formatCourseMetric(
    entry: CourseLeaderboardEntry,
    rankingMode: CourseLeaderboardResponse['rankingMode']
  ): string {
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

  private getDifficultyStatusText(): string {
    if (!this.roomLeaderboard) {
      return 'Select a published challenge room to rate difficulty.';
    }

    if (this.voteSubmitting) {
      return 'Saving your difficulty vote...';
    }

    const difficulty = this.roomLeaderboard.difficulty;
    if (!difficulty) {
      return 'Difficulty data unavailable for this room yet.';
    }

    const currentVersion = this.roomVersions[this.roomVersions.length - 1]?.version ?? null;
    if (!difficulty.viewerSignedIn) {
      return 'Sign in and play this published version to rate its difficulty.';
    }

    if (currentVersion !== this.roomLeaderboard.roomVersion) {
      return 'Difficulty votes can only be updated on the current published version.';
    }

    if (difficulty.viewerNeedsRun) {
      return difficulty.viewerVote
        ? 'Play this published version to update your carried-forward rating.'
        : 'Play this published version once to rate its difficulty.';
    }

    if (difficulty.viewerVote) {
      return `Your current rating: ${ROOM_DIFFICULTY_LABELS[difficulty.viewerVote]}.`;
    }

    return 'Rate this room based on your run.';
  }

  private parseDifficultyButtonValue(value: string | undefined): RoomDifficulty | null {
    if (!value) {
      return null;
    }

    return ROOM_DIFFICULTIES.includes(value as RoomDifficulty) ? (value as RoomDifficulty) : null;
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

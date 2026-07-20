import Phaser from 'phaser';
import { getAuthDebugState } from '../../auth/client';
import { dispatchProgressionFeedback } from '../../progression/progressionFeedback';
import { saveSeenRewardProgression } from '../../progression/rewardStingSeenState';
import type { ProgressionSummary } from '../../progression/model';
import {
  ROOM_DIFFICULTIES,
  ROOM_DIFFICULTY_LABELS,
  type GlobalLeaderboardEntry,
  type GlobalLeaderboardResponse,
  type RoomRushDifficulty,
  type RoomRushLeaderboardEntry,
  type RoomRushLeaderboardModeKey,
  type RoomRushLeaderboardResponse,
  type RoomRushLeaderboardsResponse,
  type RoomRushStartRule,
  type RoomDifficulty,
  type RoomLeaderboardEntry,
  type RoomLeaderboardResponse,
  type RoomLeaderboardVersionOption,
} from '../../runs/model';
import { createRunRepository, type RunRepository } from '../../runs/runRepository';
import {
  createCourseRepository,
  type CourseRepository,
} from '../../courses/courseRepository';
import { createProfileRepository, type ProfileRepository } from '../../profiles/profileRepository';
import type {
  CourseLeaderboardEntry,
  CourseLeaderboardResponse,
} from '../../courses/runModel';
import { getActiveOverworldScene, type OverworldSelectedRoomContext } from './sceneBridge';
import { createProfileTriggerElement, requestProfileInvalidation } from './profileEvents';
import {
  POST_RUN_RATING_SUBMITTED_EVENT,
  type PostRunRatingSubmittedDetail,
} from '../../progression/postRunRatingEvents';

type LeaderboardTab = 'room' | 'course' | 'roomRush' | 'global';

const ROOM_RUSH_MODE_ORDER: RoomRushLeaderboardModeKey[] = [
  'easy:selected',
  'hard:selected',
  'easy:origin',
  'hard:origin',
];

type LeaderboardModalElements = {
  modal: HTMLElement | null;
  title: HTMLElement | null;
  meta: HTMLElement | null;
  error: HTMLElement | null;
  closeButton: HTMLElement | null;
  roomTabButton: HTMLButtonElement | null;
  courseTabButton: HTMLButtonElement | null;
  roomRushTabButton: HTMLButtonElement | null;
  globalTabButton: HTMLButtonElement | null;
  roomPanel: HTMLElement | null;
  coursePanel: HTMLElement | null;
  roomRushPanel: HTMLElement | null;
  globalPanel: HTMLElement | null;
  versionSelect: HTMLSelectElement | null;
  roomSummary: HTMLElement | null;
  roomViewer: HTMLElement | null;
  roomDifficultySummary: HTMLElement | null;
  roomDifficultyStatus: HTMLElement | null;
  roomQualityButtons: HTMLButtonElement[];
  roomDifficultyButtons: HTMLButtonElement[];
  roomList: HTMLElement | null;
  courseSummary: HTMLElement | null;
  courseViewer: HTMLElement | null;
  courseList: HTMLElement | null;
  roomRushModeButtons: HTMLButtonElement[];
  roomRushSummary: HTMLElement | null;
  roomRushViewer: HTMLElement | null;
  roomRushList: HTMLElement | null;
  globalSummary: HTMLElement | null;
  globalViewer: HTMLElement | null;
  globalList: HTMLElement | null;
};

export class LeaderboardModalController {
  private readonly elements: LeaderboardModalElements;
  private activeTab: LeaderboardTab = 'room';
  private roomVersionOptions: RoomLeaderboardVersionOption[] = [];
  private currentPublishedVersion: number | null = null;
  private selectedVersion: number | null = null;
  private roomLeaderboard: RoomLeaderboardResponse | null = null;
  private courseLeaderboard: CourseLeaderboardResponse | null = null;
  private roomRushLeaderboards: RoomRushLeaderboardsResponse | null = null;
  private globalLeaderboard: GlobalLeaderboardResponse | null = null;
  private roomContext: OverworldSelectedRoomContext | null = null;
  private loading = false;
  private roomLoading = false;
  private roomLoaded = false;
  private courseLoading = false;
  private courseLoaded = false;
  private roomRushLoading = false;
  private readonly roomRushLoadedModes = new Set<RoomRushLeaderboardModeKey>();
  private readonly roomRushFailedModes = new Set<RoomRushLeaderboardModeKey>();
  private globalLoading = false;
  private globalLoaded = false;
  private voteSubmitting = false;
  private selectedRoomRushMode: RoomRushLeaderboardModeKey = 'easy:selected';
  private preferredInitialTab: LeaderboardTab | null = null;

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

  private readonly handleRunRatingSubmitted = (event: Event) => {
    const detail =
      event instanceof CustomEvent
        ? (event.detail as PostRunRatingSubmittedDetail | undefined)
        : undefined;
    if (!detail || this.elements.modal?.classList.contains('hidden')) {
      return;
    }

    if (detail.contentType === 'room') {
      const shouldRefreshRoom =
        this.roomLoaded && this.roomLeaderboard?.roomId === detail.contentId;
      if (!shouldRefreshRoom) {
        return;
      }
      void this.loadRoomLeaderboard();
      return;
    }

    if (this.courseLoaded && this.courseLeaderboard?.courseId === detail.contentId) {
      void this.loadCourseLeaderboard();
    }
  };

  constructor(
    private readonly game: Phaser.Game,
    private readonly runRepository: RunRepository = createRunRepository(),
    private readonly courseRepository: CourseRepository = createCourseRepository(),
    private readonly profileRepository: ProfileRepository = createProfileRepository(),
    private readonly doc: Document = document,
  ) {
    this.elements = {
      modal: this.doc.getElementById('leaderboard-modal'),
      title: this.doc.getElementById('leaderboard-modal-title'),
      meta: this.doc.getElementById('leaderboard-modal-meta'),
      error: this.doc.getElementById('leaderboard-modal-error'),
      closeButton: this.doc.getElementById('btn-leaderboard-close'),
      roomTabButton: this.doc.getElementById('btn-leaderboard-tab-room') as HTMLButtonElement | null,
      courseTabButton: this.doc.getElementById('btn-leaderboard-tab-course') as HTMLButtonElement | null,
      roomRushTabButton: this.doc.getElementById('btn-leaderboard-tab-room-rush') as HTMLButtonElement | null,
      globalTabButton: this.doc.getElementById('btn-leaderboard-tab-global') as HTMLButtonElement | null,
      roomPanel: this.doc.getElementById('leaderboard-room-panel'),
      coursePanel: this.doc.getElementById('leaderboard-course-panel'),
      roomRushPanel: this.doc.getElementById('leaderboard-room-rush-panel'),
      globalPanel: this.doc.getElementById('leaderboard-global-panel'),
      versionSelect: this.doc.getElementById('leaderboard-version-select') as HTMLSelectElement | null,
      roomSummary: this.doc.getElementById('leaderboard-room-summary'),
      roomViewer: this.doc.getElementById('leaderboard-room-viewer'),
      roomDifficultySummary: this.doc.getElementById('leaderboard-room-difficulty-summary'),
      roomDifficultyStatus: this.doc.getElementById('leaderboard-room-difficulty-status'),
      roomQualityButtons: Array.from(
        this.doc.querySelectorAll<HTMLButtonElement>('#leaderboard-room-quality-actions [data-room-quality-stars]')
      ),
      roomDifficultyButtons: Array.from(
        this.doc.querySelectorAll<HTMLButtonElement>('#leaderboard-room-difficulty-actions [data-room-difficulty]')
      ),
      roomList: this.doc.getElementById('leaderboard-room-list'),
      courseSummary: this.doc.getElementById('leaderboard-course-summary'),
      courseViewer: this.doc.getElementById('leaderboard-course-viewer'),
      courseList: this.doc.getElementById('leaderboard-course-list'),
      roomRushModeButtons: Array.from(
        this.doc.querySelectorAll<HTMLButtonElement>('#leaderboard-room-rush-modes [data-room-rush-leaderboard-mode]')
      ),
      roomRushSummary: this.doc.getElementById('leaderboard-room-rush-summary'),
      roomRushViewer: this.doc.getElementById('leaderboard-room-rush-viewer'),
      roomRushList: this.doc.getElementById('leaderboard-room-rush-list'),
      globalSummary: this.doc.getElementById('leaderboard-global-summary'),
      globalViewer: this.doc.getElementById('leaderboard-global-viewer'),
      globalList: this.doc.getElementById('leaderboard-global-list'),
    };
  }

  init(): void {
    this.elements.closeButton?.addEventListener('click', this.handleCloseClick);
    this.elements.modal?.addEventListener('click', this.handleBackdropClick);
    this.doc.addEventListener('keydown', this.handleDocumentKeydown);
    window.addEventListener(POST_RUN_RATING_SUBMITTED_EVENT, this.handleRunRatingSubmitted as EventListener);
    this.elements.roomTabButton?.addEventListener('click', () => {
      if (!this.elements.roomTabButton?.disabled) {
        void this.activateTab('room');
      }
    });
    this.elements.courseTabButton?.addEventListener('click', () => {
      if (!this.elements.courseTabButton?.disabled) {
        void this.activateTab('course');
      }
    });
    this.elements.roomRushTabButton?.addEventListener('click', () => {
      void this.activateTab('roomRush');
    });
    this.elements.globalTabButton?.addEventListener('click', () => {
      void this.activateTab('global');
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
    for (const button of this.elements.roomQualityButtons) {
      button.addEventListener('click', () => {
        const qualityStars = this.parseQualityStars(button.dataset.roomQualityStars);
        if (qualityStars !== null) {
          void this.submitRoomQualityVote(qualityStars);
        }
      });
    }
    for (const button of this.elements.roomRushModeButtons) {
      button.addEventListener('click', () => {
        const mode = this.parseRoomRushModeButtonValue(button.dataset.roomRushLeaderboardMode);
        if (!mode || mode === this.selectedRoomRushMode) {
          return;
        }

        this.selectedRoomRushMode = mode;
        this.render();
        if (this.activeTab === 'roomRush') {
          void this.ensureRoomRushModeLoaded(mode);
        }
      });
    }
  }

  destroy(): void {
    this.elements.closeButton?.removeEventListener('click', this.handleCloseClick);
    this.elements.modal?.removeEventListener('click', this.handleBackdropClick);
    this.doc.removeEventListener('keydown', this.handleDocumentKeydown);
    window.removeEventListener(POST_RUN_RATING_SUBMITTED_EVENT, this.handleRunRatingSubmitted as EventListener);
    this.close();
  }

  async open(initialTab: LeaderboardTab = 'room'): Promise<void> {
    if (!this.elements.modal) {
      return;
    }

    this.preferredInitialTab = initialTab;
    this.elements.modal.classList.remove('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'false');
    this.setError(null);
    this.loading = true;
    this.roomLoading = false;
    this.roomLoaded = false;
    this.courseLoading = false;
    this.courseLoaded = false;
    this.roomRushLoading = false;
    this.globalLoading = false;
    this.globalLoaded = false;
    this.voteSubmitting = false;
    this.roomLeaderboard = null;
    this.courseLeaderboard = null;
    this.roomRushLeaderboards = null;
    this.roomRushLoadedModes.clear();
    this.roomRushFailedModes.clear();
    this.globalLeaderboard = null;
    this.roomVersionOptions = [];
    this.currentPublishedVersion = null;
    this.selectedVersion = null;
    this.selectedRoomRushMode = 'easy:selected';
    this.activeTab = initialTab;
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

  private async activateTab(nextTab: LeaderboardTab): Promise<void> {
    this.activeTab = nextTab;
    this.render();
    await this.ensureTabLoaded(nextTab);
  }

  private async ensureTabLoaded(tab: LeaderboardTab): Promise<void> {
    switch (tab) {
      case 'room':
        if (!this.roomLoaded && !this.roomLoading) {
          await this.loadRoomLeaderboard();
        }
        return;
      case 'course':
        if (!this.courseLoaded && !this.courseLoading) {
          await this.loadCourseLeaderboard();
        }
        return;
      case 'roomRush':
        await this.ensureRoomRushModeLoaded(this.selectedRoomRushMode);
        return;
      case 'global':
        if (!this.globalLoaded && !this.globalLoading) {
          await this.loadGlobalLeaderboard();
        }
        return;
    }
  }

  private async load(): Promise<void> {
    try {
      const scene = getActiveOverworldScene(this.game);
      this.roomContext = scene?.getSelectedRoomContext?.() ?? null;
      this.activeTab = this.resolveInitialTab();
      this.render();
      await this.ensureTabLoaded(this.activeTab);
    } catch (error) {
      console.error('Failed to load leaderboards', error);
      this.setError(error instanceof Error ? error.message : 'Failed to load leaderboards.');
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private async loadRoomLeaderboard(): Promise<void> {
    if (!this.roomContext || this.roomContext.state !== 'published') {
      this.roomLeaderboard = null;
      this.roomLoading = false;
      this.roomLoaded = true;
      this.render();
      return;
    }

    this.roomLoading = true;
    this.roomLoaded = false;
    this.render();
    try {
      const response = await this.runRepository.loadRoomLeaderboard(
        this.roomContext.roomId,
        this.roomContext.coordinates,
        this.selectedVersion,
        25
      );
      this.roomLeaderboard = response;
      this.currentPublishedVersion = response.currentPublishedVersion ?? response.roomVersion;
      this.roomVersionOptions = response.versionOptions?.length
        ? response.versionOptions
        : [{
            value: response.displayRoomVersion,
            representativeVersion: response.displayRoomVersion,
            equivalentVersions: [...response.equivalentRoomVersions],
            containsCanonical: response.canonicalRoomVersion === response.displayRoomVersion,
            containsCurrentPublished: response.roomVersion === this.currentPublishedVersion,
            label: this.formatRoomVersionLabel(response),
          }];
      this.selectedVersion = this.roomVersionOptions.find((option) =>
        option.equivalentVersions.includes(response.roomVersion)
      )?.value ?? response.displayRoomVersion;
      this.setError(null);
    } catch (error) {
      console.error('Failed to load room leaderboard', error);
      this.roomLeaderboard = null;
      this.setError(error instanceof Error ? error.message : 'Failed to load room leaderboard.');
    } finally {
      this.roomLoading = false;
      this.roomLoaded = true;
      this.render();
    }
  }

  private async loadCourseLeaderboard(): Promise<void> {
    if (!this.roomContext?.courseId) {
      this.courseLeaderboard = null;
      this.courseLoading = false;
      this.courseLoaded = true;
      this.render();
      return;
    }

    this.courseLoading = true;
    this.courseLoaded = false;
    this.render();
    try {
      this.courseLeaderboard = await this.courseRepository.loadCourseLeaderboard(
        this.roomContext.courseId,
        null,
        25
      );
      this.setError(null);
    } catch (error) {
      console.error('Failed to load expanded room leaderboard', error);
      this.courseLeaderboard = null;
      this.setError(error instanceof Error ? error.message : 'Failed to load expanded room leaderboard.');
    } finally {
      this.courseLoading = false;
      this.courseLoaded = true;
      this.render();
    }
  }

  private async ensureRoomRushModeLoaded(modeKey: RoomRushLeaderboardModeKey): Promise<void> {
    if (this.roomRushLoadedModes.has(modeKey) || this.roomRushLoading) {
      return;
    }

    await this.loadRoomRushLeaderboards(modeKey);
  }

  private async loadRoomRushLeaderboards(modeKey: RoomRushLeaderboardModeKey): Promise<void> {
    this.roomRushLoading = true;
    this.roomRushFailedModes.delete(modeKey);
    this.render();
    try {
      const response = await this.runRepository.loadRoomRushLeaderboards(25, modeKey);
      this.mergeRoomRushLeaderboards(response);
      for (const mode of response.modes) {
        this.roomRushLoadedModes.add(mode.modeKey);
      }
      if (!this.roomRushLoadedModes.has(modeKey)) {
        this.roomRushFailedModes.add(modeKey);
      }
      this.setError(null);
    } catch (error) {
      console.error('Failed to load Room Rush leaderboards', error);
      this.roomRushFailedModes.add(modeKey);
      this.setError(error instanceof Error ? error.message : 'Failed to load Room Rush leaderboards.');
    } finally {
      this.roomRushLoading = false;
      this.render();
    }
  }

  private mergeRoomRushLeaderboards(response: RoomRushLeaderboardsResponse): void {
    const byMode = new Map<RoomRushLeaderboardModeKey, RoomRushLeaderboardResponse>();
    for (const mode of this.roomRushLeaderboards?.modes ?? []) {
      byMode.set(mode.modeKey, mode);
    }
    for (const mode of response.modes) {
      byMode.set(mode.modeKey, mode);
    }

    this.roomRushLeaderboards = {
      modes: ROOM_RUSH_MODE_ORDER.flatMap((modeKey) => {
        const mode = byMode.get(modeKey);
        return mode ? [mode] : [];
      }),
    };
  }

  private async loadGlobalLeaderboard(): Promise<void> {
    this.globalLoading = true;
    this.globalLoaded = false;
    this.render();
    try {
      this.globalLeaderboard = await this.runRepository.loadGlobalLeaderboard(25);
      this.setError(null);
    } catch (error) {
      console.error('Failed to load global leaderboard', error);
      this.globalLeaderboard = null;
      this.setError(error instanceof Error ? error.message : 'Failed to load global leaderboard.');
    } finally {
      this.globalLoading = false;
      this.globalLoaded = true;
      this.render();
    }
  }

  private async submitRoomDifficultyVote(difficulty: RoomDifficulty): Promise<void> {
    await this.submitRoomRatingUpdate({
      difficultyChoice: difficulty,
    });
  }

  private async submitRoomQualityVote(qualityStars: number): Promise<void> {
    await this.submitRoomRatingUpdate({
      qualityStars,
    });
  }

  private async submitRoomRatingUpdate(
    update: {
      qualityStars?: number | null;
      difficultyChoice?: RoomDifficulty | null;
    },
  ): Promise<void> {
    if (!this.roomLeaderboard || this.voteSubmitting) {
      return;
    }

    const roomId = this.roomLeaderboard.roomId;
    const roomCoordinates = this.roomLeaderboard.roomCoordinates;
    const roomVersion = this.roomLeaderboard.roomVersion;
    const roomTitle = this.roomLeaderboard.roomTitle ?? null;
    const previousViewerRank = this.roomLeaderboard.viewerRank ?? null;
    const authUserId = getAuthDebugState().user?.id?.trim() ?? null;

    this.voteSubmitting = true;
    this.render();
    try {
      const nextDifficultyChoice =
        update.difficultyChoice
        ?? this.roomLeaderboard.viewerRating?.difficultyChoice
        ?? this.roomLeaderboard.difficulty.viewerVote
        ?? null;
      const nextQualityStars =
        update.qualityStars
        ?? this.roomLeaderboard.viewerRating?.qualityStars
        ?? null;
      const nextAutoSuggestedDifficulty =
        this.roomLeaderboard.viewerRating?.autoSuggestedDifficulty
        ?? nextDifficultyChoice
        ?? this.roomLeaderboard.difficulty.consensus
        ?? 'medium';
      const previousProgression = authUserId
        ? await this.loadBaselineProgression(authUserId)
        : null;
      const response = await this.runRepository.submitRoomRating(roomId, {
        roomCoordinates,
        roomVersion,
        qualityStars: nextQualityStars,
        difficultyChoice: nextDifficultyChoice,
        autoSuggestedDifficulty: nextAutoSuggestedDifficulty,
      });
      if (authUserId) {
        saveSeenRewardProgression(authUserId, response.progression);
      }
      requestProfileInvalidation(authUserId);
      await this.loadRoomLeaderboard();
      dispatchProgressionFeedback({
        previousProgression,
        currentProgression: response.progression,
        progressionDelta: response.progressionDelta,
        previousViewerRank,
        currentViewerRank: this.roomLeaderboard?.viewerRank ?? null,
        contentType: 'room',
        contentId: roomId,
        contentTitle: this.roomLeaderboard?.roomTitle ?? roomTitle,
        reason: roomTitle?.trim() ? `Rated ${roomTitle}` : 'Rated a room',
      });
      this.setError(null);
    } catch (error) {
      console.error('Failed to submit room rating update', error);
      this.setError(
        error instanceof Error ? error.message : 'Failed to submit room rating update.'
      );
    } finally {
      this.voteSubmitting = false;
      this.render();
    }
  }

  private render(): void {
    const roomAvailable = this.roomContext?.state === 'published';
    const courseAvailable = Boolean(this.roomContext?.courseId);
    this.elements.roomTabButton?.classList.toggle('active', this.activeTab === 'room');
    this.elements.courseTabButton?.classList.toggle('active', this.activeTab === 'course');
    this.elements.roomRushTabButton?.classList.toggle('active', this.activeTab === 'roomRush');
    this.elements.globalTabButton?.classList.toggle('active', this.activeTab === 'global');
    if (this.elements.roomTabButton) {
      this.elements.roomTabButton.disabled = !roomAvailable;
    }
    if (this.elements.courseTabButton) {
      this.elements.courseTabButton.disabled = !courseAvailable;
    }
    if (!roomAvailable && this.activeTab === 'room') {
      this.activeTab = courseAvailable ? 'course' : 'global';
    }
    if (!courseAvailable && this.activeTab === 'course') {
      this.activeTab = roomAvailable ? 'room' : 'global';
    }

    this.elements.roomPanel?.classList.toggle('hidden', this.activeTab !== 'room');
    this.elements.coursePanel?.classList.toggle('hidden', this.activeTab !== 'course');
    this.elements.roomRushPanel?.classList.toggle('hidden', this.activeTab !== 'roomRush');
    this.elements.globalPanel?.classList.toggle('hidden', this.activeTab !== 'global');
    this.renderMeta();
    this.renderVersionSelect();
    this.renderRoomPanel();
    this.renderCoursePanel();
    this.renderRoomRushPanel();
    this.renderGlobalPanel();
  }

  private async loadBaselineProgression(userId: string): Promise<ProgressionSummary | null> {
    try {
      const profile = await this.profileRepository.loadProfile(userId);
      return profile.progression;
    } catch {
      return null;
    }
  }

  private renderMeta(): void {
    if (!this.elements.meta) {
      return;
    }

    if (this.elements.title) {
      this.elements.title.textContent =
        this.activeTab === 'roomRush'
            ? 'Room Rush'
            : 'Leaderboard';
    }

    if (this.loading) {
      this.elements.meta.textContent = 'Loading leaderboards...';
      return;
    }

    if (this.activeTab === 'room') {
      const roomLabel = this.roomLeaderboard
        ? `${this.roomLeaderboard.roomTitle?.trim() || `Room ${this.roomLeaderboard.roomCoordinates.x},${this.roomLeaderboard.roomCoordinates.y}`} · ${this.roomLeaderboard.roomCoordinates.x},${this.roomLeaderboard.roomCoordinates.y} · ${this.roomLeaderboard.goalType.replace('_', ' ')} · ${this.formatRoomVersionLabel(this.roomLeaderboard)}`
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

    if (this.activeTab === 'roomRush') {
      this.elements.meta.textContent =
        'Room Rush leaderboards. More rooms wins; ties go to faster time, then fewer deaths.';
      return;
    }

    this.elements.meta.textContent = 'Global points leaderboard.';
  }

  private renderVersionSelect(): void {
    if (!this.elements.versionSelect) {
      return;
    }

    this.elements.versionSelect.replaceChildren();
    if (this.roomVersionOptions.length === 0) {
      const option = this.doc.createElement('option');
      option.value = '';
      option.textContent = 'No versions';
      this.elements.versionSelect.appendChild(option);
      this.elements.versionSelect.disabled = true;
      return;
    }

    this.elements.versionSelect.disabled = false;
    for (const version of this.roomVersionOptions) {
      const option = this.doc.createElement('option');
      option.value = String(version.value);
      option.textContent = version.label;
      if (version.value === this.selectedVersion) {
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

    const roomPending =
      this.loading || this.roomLoading || (this.activeTab === 'room' && !this.roomLoaded);
    this.elements.roomList.replaceChildren();
    this.elements.roomSummary.textContent = roomPending
      ? 'Loading room leaderboard...'
      : this.roomLeaderboard
        ? `${this.roomLeaderboard.entries.length} ranked run${this.roomLeaderboard.entries.length === 1 ? '' : 's'} · ${this.roomLeaderboard.rankingMode === 'time' ? 'fastest time wins' : 'highest score wins'} · ${this.formatQualitySummary(this.roomLeaderboard.quality)}${this.formatTrophySuffix(this.roomLeaderboard.trophy)}`
        : 'No published room leaderboard available.';

    const viewer = this.roomLeaderboard?.viewerBest ?? null;
    this.elements.roomViewer.classList.toggle('hidden', roomPending || viewer === null);
    if (!roomPending && viewer) {
      this.elements.roomViewer.textContent =
        `You: #${this.roomLeaderboard?.viewerRank ?? viewer.rank} · ${this.formatRoomMetric(viewer, this.roomLeaderboard?.rankingMode ?? 'time')} · ${viewer.deaths} deaths`;
    } else {
      this.elements.roomViewer.textContent = '';
    }

    const difficulty = this.roomLeaderboard?.difficulty ?? null;
    const consensusText =
      roomPending
        ? 'Loading quality and difficulty ratings...'
        : difficulty === null || difficulty.totalVotes === 0
          ? `${this.formatQualitySummary(this.roomLeaderboard?.quality ?? null)}`
          : `Consensus: ${
              difficulty.consensus ? ROOM_DIFFICULTY_LABELS[difficulty.consensus] : 'Unrated'
            } · ${difficulty.totalVotes} vote${difficulty.totalVotes === 1 ? '' : 's'} · ${this.formatQualitySummary(this.roomLeaderboard?.quality ?? null)}`;
    this.elements.roomDifficultySummary.textContent = consensusText;
    this.elements.roomDifficultyStatus.textContent = roomPending ? '' : this.getRoomRatingStatusText();
    for (const button of this.elements.roomQualityButtons) {
      const qualityStars = this.parseQualityStars(button.dataset.roomQualityStars);
      if (qualityStars === null) {
        button.disabled = true;
        continue;
      }

      const count = this.getQualityVoteCount(qualityStars);
      button.textContent = `${qualityStars} Star${qualityStars === 1 ? '' : 's'} · ${count}`;
      button.classList.toggle('active', this.roomLeaderboard?.viewerRating?.qualityStars === qualityStars);
      button.disabled = roomPending || this.voteSubmitting || !difficulty?.viewerCanVote;
    }
    for (const button of this.elements.roomDifficultyButtons) {
      const difficultyValue = this.parseDifficultyButtonValue(button.dataset.roomDifficulty);
      if (!difficultyValue) {
        button.disabled = true;
        continue;
      }

      const count = difficulty?.counts[difficultyValue] ?? 0;
      button.textContent = `${ROOM_DIFFICULTY_LABELS[difficultyValue]} · ${count}`;
      button.classList.toggle('active', difficulty?.viewerVote === difficultyValue);
      button.disabled = roomPending || this.voteSubmitting || !difficulty?.viewerCanVote;
    }

    if (roomPending) {
      const loading = this.doc.createElement('div');
      loading.className = 'leaderboard-empty';
      loading.textContent = 'Loading room leaderboard...';
      this.elements.roomList.appendChild(loading);
      return;
    }

    if (!this.roomLeaderboard || this.roomLeaderboard.entries.length === 0) {
      const empty = this.doc.createElement('div');
      empty.className = 'leaderboard-empty';
      empty.textContent = this.roomVersionOptions.length === 0
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

  private renderCoursePanel(): void {
    if (!this.elements.courseList || !this.elements.courseSummary || !this.elements.courseViewer) {
      return;
    }

    const coursePending =
      this.loading || this.courseLoading || (this.activeTab === 'course' && !this.courseLoaded);
    this.elements.courseList.replaceChildren();
    this.elements.courseSummary.textContent = coursePending
      ? 'Loading expanded room leaderboard...'
      : this.courseLeaderboard
        ? `${this.courseLeaderboard.entries.length} ranked run${this.courseLeaderboard.entries.length === 1 ? '' : 's'} · ${this.courseLeaderboard.rankingMode === 'time' ? 'fastest time wins' : 'highest score wins'} · ${this.formatQualitySummary(this.courseLeaderboard.quality)} · ${this.formatDifficultyConsensus(this.courseLeaderboard.difficulty)}${this.formatTrophySuffix(this.courseLeaderboard.trophy)}`
        : 'No published expanded room leaderboard available.';

    const viewer = this.courseLeaderboard?.viewerBest ?? null;
    this.elements.courseViewer.classList.toggle('hidden', coursePending || viewer === null);
    if (!coursePending && viewer && this.courseLeaderboard) {
      this.elements.courseViewer.textContent =
        `You: #${this.courseLeaderboard.viewerRank ?? viewer.rank} · ${this.formatCourseMetric(viewer, this.courseLeaderboard.rankingMode)} · ${viewer.deaths} deaths`;
    } else {
      this.elements.courseViewer.textContent = '';
    }

    if (coursePending) {
      const loading = this.doc.createElement('div');
      loading.className = 'leaderboard-empty';
      loading.textContent = 'Loading expanded room leaderboard...';
      this.elements.courseList.appendChild(loading);
      return;
    }

    if (!this.courseLeaderboard || this.courseLeaderboard.entries.length === 0) {
      const empty = this.doc.createElement('div');
      empty.className = 'leaderboard-empty';
      empty.textContent = this.roomContext?.courseId
        ? 'No completed ranked expanded room runs yet.'
        : 'Select a published expanded room cell to view expanded room rankings.';
      this.elements.courseList.appendChild(empty);
      return;
    }

    for (const entry of this.courseLeaderboard.entries) {
      this.elements.courseList.appendChild(
        this.renderCourseEntry(entry, this.courseLeaderboard.rankingMode)
      );
    }
  }

  private renderRoomRushPanel(): void {
    if (
      !this.elements.roomRushList ||
      !this.elements.roomRushSummary ||
      !this.elements.roomRushViewer
    ) {
      return;
    }

    const selectedModeSettled =
      this.roomRushLoadedModes.has(this.selectedRoomRushMode) ||
      this.roomRushFailedModes.has(this.selectedRoomRushMode);
    const roomRushPending =
      this.loading ||
      this.roomRushLoading ||
      (this.activeTab === 'roomRush' && !selectedModeSettled);
    const selected = this.getSelectedRoomRushLeaderboard();
    this.elements.roomRushList.replaceChildren();

    for (const button of this.elements.roomRushModeButtons) {
      const mode = this.parseRoomRushModeButtonValue(button.dataset.roomRushLeaderboardMode);
      button.classList.toggle('active', mode === this.selectedRoomRushMode);
      button.disabled = roomRushPending;
    }

    this.elements.roomRushSummary.textContent = roomRushPending
      ? 'Loading Room Rush leaderboards...'
      : selected
        ? `${this.formatRoomRushModeLabel(selected)} · ${selected.entries.length} ranked rush${selected.entries.length === 1 ? '' : 'es'} · rooms, then time, then deaths`
        : 'Room Rush leaderboard unavailable.';

    const viewer = selected?.viewerBest ?? null;
    this.elements.roomRushViewer.classList.toggle('hidden', roomRushPending || viewer === null);
    if (!roomRushPending && viewer && selected) {
      this.elements.roomRushViewer.textContent =
        `You: #${selected.viewerRank ?? viewer.rank} · ${this.formatRoomRushRooms(viewer.uniqueRooms)} · ${this.formatElapsedMs(viewer.elapsedMs)} · ${this.formatDeathCount(viewer.deaths)}`;
    } else {
      this.elements.roomRushViewer.textContent = '';
    }

    if (roomRushPending) {
      const loading = this.doc.createElement('div');
      loading.className = 'leaderboard-empty';
      loading.textContent = 'Loading Room Rush leaderboards...';
      this.elements.roomRushList.appendChild(loading);
      return;
    }

    if (!selected || selected.entries.length === 0) {
      const empty = this.doc.createElement('div');
      empty.className = 'leaderboard-empty';
      empty.textContent = 'No saved Room Rush runs yet.';
      this.elements.roomRushList.appendChild(empty);
      return;
    }

    for (const entry of selected.entries) {
      this.elements.roomRushList.appendChild(this.renderRoomRushEntry(entry));
    }
  }

  private renderGlobalPanel(): void {
    if (!this.elements.globalList || !this.elements.globalSummary || !this.elements.globalViewer) {
      return;
    }

    const globalPending =
      this.loading || this.globalLoading || (this.activeTab === 'global' && !this.globalLoaded);
    this.elements.globalList.replaceChildren();
    this.elements.globalSummary.textContent = globalPending
      ? 'Loading global leaderboard...'
      : 'Points for publishing rooms and finishing challenges.';

    const viewer = this.globalLeaderboard?.viewerEntry ?? null;
    this.elements.globalViewer.classList.toggle('hidden', globalPending || viewer === null);
    if (!globalPending && viewer) {
      this.elements.globalViewer.textContent =
        `You: #${viewer.rank} · ${viewer.totalPoints} pts · ${viewer.completedRuns} clears · ${viewer.totalRoomsPublished} rooms`;
    } else {
      this.elements.globalViewer.textContent = '';
    }

    if (globalPending) {
      const loading = this.doc.createElement('div');
      loading.className = 'leaderboard-empty';
      loading.textContent = 'Loading global leaderboard...';
      this.elements.globalList.appendChild(loading);
      return;
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
    row.appendChild(
      createProfileTriggerElement(
        this.doc,
        entry.userId,
        entry.userDisplayName,
        'leaderboard-primary',
        'div'
      )
    );

    row.appendChild(this.createCell('leaderboard-primary', this.formatRoomMetric(entry, rankingMode)));
    row.appendChild(this.createCell('leaderboard-secondary', `${entry.deaths} deaths`));
    row.appendChild(this.createCell('leaderboard-secondary', this.formatShortDate(entry.finishedAt)));
    return row;
  }

  private renderGlobalEntry(entry: GlobalLeaderboardEntry): HTMLElement {
    const row = this.doc.createElement('div');
    row.className = 'history-version-row leaderboard-row leaderboard-global-row';

    row.appendChild(this.createCell('leaderboard-rank', `#${entry.rank}`));
    row.appendChild(
      createProfileTriggerElement(
        this.doc,
        entry.userId,
        entry.userDisplayName,
        'leaderboard-primary',
        'div'
      )
    );
    row.appendChild(this.createCell('leaderboard-primary', `${entry.totalPoints} pts`));
    row.appendChild(this.createCell('leaderboard-secondary', `${entry.completedRuns} clears`));
    row.appendChild(this.createCell('leaderboard-secondary', `${entry.totalRoomsPublished} rooms`));
    return row;
  }

  private renderCourseEntry(
    entry: CourseLeaderboardEntry,
    rankingMode: CourseLeaderboardResponse['rankingMode']
  ): HTMLElement {
    const row = this.doc.createElement('div');
    row.className = 'history-version-row leaderboard-row';

    row.appendChild(this.createCell('leaderboard-rank', `#${entry.rank}`));
    row.appendChild(
      createProfileTriggerElement(
        this.doc,
        entry.userId,
        entry.userDisplayName,
        'leaderboard-primary',
        'div'
      )
    );
    row.appendChild(this.createCell('leaderboard-primary', this.formatCourseMetric(entry, rankingMode)));
    row.appendChild(this.createCell('leaderboard-secondary', `${entry.deaths} deaths`));
    row.appendChild(this.createCell('leaderboard-secondary', this.formatShortDate(entry.finishedAt)));
    return row;
  }

  private renderRoomRushEntry(entry: RoomRushLeaderboardEntry): HTMLElement {
    const row = this.doc.createElement('div');
    row.className = 'history-version-row leaderboard-row leaderboard-room-rush-row';

    row.appendChild(this.createCell('leaderboard-rank', `#${entry.rank}`));
    row.appendChild(
      createProfileTriggerElement(
        this.doc,
        entry.userId,
        entry.userDisplayName,
        'leaderboard-primary',
        'div'
      )
    );
    row.appendChild(this.createCell('leaderboard-primary', this.formatRoomRushRooms(entry.uniqueRooms)));
    row.appendChild(this.createCell('leaderboard-secondary', this.formatElapsedMs(entry.elapsedMs)));
    row.appendChild(this.createCell('leaderboard-secondary', this.formatDeathCount(entry.deaths)));
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

  private formatRoomRushRooms(uniqueRooms: number): string {
    return `${uniqueRooms} ${uniqueRooms === 1 ? 'room' : 'rooms'}`;
  }

  private formatElapsedMs(elapsedMs: number): string {
    return `${(elapsedMs / 1000).toFixed(2)}s`;
  }

  private formatDeathCount(deaths: number): string {
    return `${deaths} ${deaths === 1 ? 'death' : 'deaths'}`;
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

  private formatQualitySummary(
    quality: RoomLeaderboardResponse['quality'] | CourseLeaderboardResponse['quality'] | null
  ): string {
    if (!quality || quality.adjustedAverage === null) {
      return 'quality unrated';
    }

    return `quality ${quality.adjustedAverage.toFixed(2)}/5`;
  }

  private formatDifficultyConsensus(
    difficulty: CourseLeaderboardResponse['difficulty'] | RoomLeaderboardResponse['difficulty'] | null
  ): string {
    if (!difficulty || difficulty.consensus === null || difficulty.totalVotes === 0) {
      return 'difficulty unrated';
    }

    return `difficulty ${ROOM_DIFFICULTY_LABELS[difficulty.consensus]}`;
  }

  private formatTrophySuffix(
    trophy: RoomLeaderboardResponse['trophy'] | CourseLeaderboardResponse['trophy'] | null
  ): string {
    return trophy ? ' · trophy' : '';
  }

  private getDifficultyStatusText(): string {
    if (!this.roomLeaderboard) {
      return 'Select a published challenge room to rate quality and difficulty.';
    }

    if (this.voteSubmitting) {
      return 'Saving your quality and difficulty rating...';
    }

    const difficulty = this.roomLeaderboard.difficulty;
    if (!difficulty) {
      return 'Quality and difficulty data are unavailable for this room yet.';
    }

    const currentVersion = this.currentPublishedVersion;
    if (!difficulty.viewerSignedIn) {
      return 'Sign in and play this published version to rate its quality and difficulty.';
    }

    if (currentVersion !== this.roomLeaderboard.roomVersion) {
      return 'Quality and difficulty ratings can only be updated on the current published version.';
    }

    if (difficulty.viewerNeedsRun) {
      return this.roomLeaderboard.viewerRating?.qualityStars !== null || difficulty.viewerVote
        ? 'Play this published version to update your carried-forward quality and difficulty rating.'
        : 'Play this published version once to rate its quality and difficulty.';
    }

    const qualityStars = this.roomLeaderboard.viewerRating?.qualityStars ?? null;
    if (difficulty.viewerVote || qualityStars !== null) {
      const parts: string[] = [];
      if (qualityStars !== null) {
        parts.push(`${qualityStars} star${qualityStars === 1 ? '' : 's'}`);
      }
      if (difficulty.viewerVote) {
        parts.push(ROOM_DIFFICULTY_LABELS[difficulty.viewerVote]);
      }
      return `Your current rating: ${parts.join(' · ')}.`;
    }

    return 'Rate this room based on your run.';
  }

  private getRoomRatingStatusText(): string {
    return this.getDifficultyStatusText();
  }

  private getQualityVoteCount(stars: number): number {
    const counts = this.roomLeaderboard?.quality.counts;
    if (!counts) {
      return 0;
    }

    switch (stars) {
      case 1:
        return counts.oneStar;
      case 2:
        return counts.twoStar;
      case 3:
        return counts.threeStar;
      case 4:
        return counts.fourStar;
      case 5:
        return counts.fiveStar;
      default:
        return 0;
    }
  }

  private parseDifficultyButtonValue(value: string | undefined): RoomDifficulty | null {
    if (!value) {
      return null;
    }

    return ROOM_DIFFICULTIES.includes(value as RoomDifficulty) ? (value as RoomDifficulty) : null;
  }

  private parseQualityStars(value: string | undefined): number | null {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 5 ? parsed : null;
  }

  private parseRoomRushModeButtonValue(value: string | undefined): RoomRushLeaderboardModeKey | null {
    if (
      value === 'easy:selected' ||
      value === 'hard:selected' ||
      value === 'easy:origin' ||
      value === 'hard:origin'
    ) {
      return value;
    }

    return null;
  }

  private getSelectedRoomRushLeaderboard(): RoomRushLeaderboardResponse | null {
    return this.roomRushLeaderboards?.modes.find(
      (mode) => mode.modeKey === this.selectedRoomRushMode
    ) ?? null;
  }

  private formatRoomRushModeLabel(mode: {
    difficulty: RoomRushDifficulty;
    startRule: RoomRushStartRule;
  }): string {
    const startLabel = mode.startRule === 'origin' ? 'Start from 0,0' : 'Start anywhere';
    const difficultyLabel = mode.difficulty === 'hard' ? 'Death ends run' : 'Deaths allowed';
    return `${startLabel} · ${difficultyLabel}`;
  }

  private resolveInitialTab(): LeaderboardTab {
    const requested = this.preferredInitialTab;
    this.preferredInitialTab = null;
    const roomAvailable = this.roomContext?.state === 'published';
    const courseAvailable = Boolean(this.roomContext?.courseId);

    if (requested === 'global') {
      return 'global';
    }
    if (requested === 'roomRush') {
      return 'roomRush';
    }
    if (requested === 'course' && courseAvailable) {
      return 'course';
    }
    if (requested === 'room' && roomAvailable) {
      return 'room';
    }

    return roomAvailable ? 'room' : courseAvailable ? 'course' : 'global';
  }

  private formatRoomVersionLabel(response: RoomLeaderboardResponse): string {
    return this.formatRoomVersionSummary(
      response.displayRoomVersion,
      response.roomVersion,
      response.leaderboardSourceVersion
    );
  }

  private formatRoomVersionSummary(
    displayRoomVersion: number,
    roomVersion: number,
    leaderboardSourceVersion: number | null
  ): string {
    const parts = [
      displayRoomVersion === roomVersion
        ? `v${displayRoomVersion}`
        : `v${displayRoomVersion} · live as v${roomVersion}`,
    ];

    if (leaderboardSourceVersion !== null) {
      parts.push(`leaderboard from v${leaderboardSourceVersion}`);
    }

    return parts.join(' · ');
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

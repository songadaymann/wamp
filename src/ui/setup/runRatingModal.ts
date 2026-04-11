import Phaser from 'phaser';
import { getAuthDebugState } from '../../auth/client';
import {
  createCourseRepository,
  type CourseRepository,
} from '../../courses/courseRepository';
import type {
  CourseLeaderboardResponse,
  CourseProgressRatingResponse,
} from '../../courses/runModel';
import type {
  ProgressionDelta,
  ProgressionDifficulty,
  ProgressionSummary,
  QualityRatingSummary,
  RoomRatingResponse,
  ViewerRatingSummary,
} from '../../progression/model';
import {
  POST_RUN_RATING_REQUEST_EVENT,
  notifyPostRunRatingSubmitted,
  type PostRunRatingRequestDetail,
} from '../../progression/postRunRatingEvents';
import { REWARD_STINGS_IDLE_EVENT } from '../../progression/rewardStings';
import { dispatchProgressionFeedback } from '../../progression/progressionFeedback';
import { saveSeenRewardProgression } from '../../progression/rewardStingSeenState';
import { createProfileRepository, type ProfileRepository } from '../../profiles/profileRepository';
import { requestProfileInvalidation } from './profileEvents';
import {
  ROOM_DIFFICULTIES,
  ROOM_DIFFICULTY_LABELS,
  type RoomLeaderboardResponse,
} from '../../runs/model';
import { createRunRepository, type RunRepository } from '../../runs/runRepository';

type RunRatingElements = {
  modal: HTMLElement | null;
  closeButton: HTMLButtonElement | null;
  skipButton: HTMLButtonElement | null;
  submitButton: HTMLButtonElement | null;
  title: HTMLElement | null;
  meta: HTMLElement | null;
  result: HTMLElement | null;
  leaderboard: HTMLElement | null;
  suggestion: HTMLElement | null;
  status: HTMLElement | null;
  reward: HTMLElement | null;
  error: HTMLElement | null;
  qualityButtons: HTMLButtonElement[];
  difficultyButtons: HTMLButtonElement[];
};

export class RunRatingModalController {
  private readonly elements: RunRatingElements;
  private activeRequest: PostRunRatingRequestDetail | null = null;
  private roomSummary: RoomLeaderboardResponse | null = null;
  private courseSummary: CourseLeaderboardResponse | null = null;
  private currentQualityStars: number | null = null;
  private currentDifficultyChoice: ProgressionDifficulty | null = null;
  private submitting = false;
  private loadingSummary = false;
  private loadToken = 0;
  private savedProgression: ProgressionSummary | null = null;
  private savedDeltaText: string | null = null;
  private baselineProgression: ProgressionSummary | null = null;
  private baselineProgressionLoad: Promise<void> | null = null;
  private pendingOpenRequest: PostRunRatingRequestDetail | null = null;

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

  private readonly handleOpenRequest = (event: Event) => {
    const detail =
      event instanceof CustomEvent
        ? (event.detail as PostRunRatingRequestDetail | undefined)
        : undefined;
    if (!detail) {
      return;
    }

    if (this.isRewardStingVisible()) {
      this.pendingOpenRequest = detail;
      return;
    }

    void this.open(detail);
  };

  private readonly handleRewardStingsIdle = () => {
    if (!this.pendingOpenRequest || this.isRewardStingVisible()) {
      return;
    }

    const detail = this.pendingOpenRequest;
    this.pendingOpenRequest = null;
    void this.open(detail);
  };

  constructor(
    _game: Phaser.Game,
    private readonly runRepository: RunRepository = createRunRepository(),
    private readonly courseRepository: CourseRepository = createCourseRepository(),
    private readonly profileRepository: ProfileRepository = createProfileRepository(),
    private readonly doc: Document = document,
    private readonly windowObj: Window = window
  ) {
    this.elements = {
      modal: this.doc.getElementById('run-rating-modal'),
      closeButton: this.doc.getElementById('btn-run-rating-close') as HTMLButtonElement | null,
      skipButton: this.doc.getElementById('btn-run-rating-skip') as HTMLButtonElement | null,
      submitButton: this.doc.getElementById('btn-run-rating-submit') as HTMLButtonElement | null,
      title: this.doc.getElementById('run-rating-title'),
      meta: this.doc.getElementById('run-rating-meta'),
      result: this.doc.getElementById('run-rating-result'),
      leaderboard: this.doc.getElementById('run-rating-leaderboard'),
      suggestion: this.doc.getElementById('run-rating-suggestion'),
      status: this.doc.getElementById('run-rating-status'),
      reward: this.doc.getElementById('run-rating-reward'),
      error: this.doc.getElementById('run-rating-error'),
      qualityButtons: Array.from(
        this.doc.querySelectorAll<HTMLButtonElement>('#run-rating-quality-actions [data-quality-stars]')
      ),
      difficultyButtons: Array.from(
        this.doc.querySelectorAll<HTMLButtonElement>('#run-rating-difficulty-actions [data-progression-difficulty]')
      ),
    };
  }

  init(): void {
    this.elements.closeButton?.addEventListener('click', this.handleCloseClick);
    this.elements.skipButton?.addEventListener('click', this.handleCloseClick);
    this.elements.submitButton?.addEventListener('click', () => {
      void this.submit();
    });
    this.elements.modal?.addEventListener('click', this.handleBackdropClick);
    this.doc.addEventListener('keydown', this.handleDocumentKeydown);
    this.windowObj.addEventListener(
      POST_RUN_RATING_REQUEST_EVENT,
      this.handleOpenRequest as EventListener
    );
    this.windowObj.addEventListener(REWARD_STINGS_IDLE_EVENT, this.handleRewardStingsIdle);
    for (const button of this.elements.qualityButtons) {
      button.addEventListener('click', () => {
        const value = Number.parseInt(button.dataset.qualityStars ?? '', 10);
        if (Number.isInteger(value) && value >= 1 && value <= 5) {
          this.currentQualityStars = value;
          this.render();
        }
      });
    }
    for (const button of this.elements.difficultyButtons) {
      button.addEventListener('click', () => {
        const value = button.dataset.progressionDifficulty;
        if (value && ROOM_DIFFICULTIES.includes(value as ProgressionDifficulty)) {
          this.currentDifficultyChoice = value as ProgressionDifficulty;
          this.render();
        }
      });
    }
  }

  destroy(): void {
    this.elements.closeButton?.removeEventListener('click', this.handleCloseClick);
    this.elements.skipButton?.removeEventListener('click', this.handleCloseClick);
    this.elements.modal?.removeEventListener('click', this.handleBackdropClick);
    this.doc.removeEventListener('keydown', this.handleDocumentKeydown);
    this.windowObj.removeEventListener(
      POST_RUN_RATING_REQUEST_EVENT,
      this.handleOpenRequest as EventListener
    );
    this.windowObj.removeEventListener(REWARD_STINGS_IDLE_EVENT, this.handleRewardStingsIdle);
  }

  private async open(detail: PostRunRatingRequestDetail): Promise<void> {
    if (!this.elements.modal) {
      return;
    }

    this.activeRequest = detail;
    this.roomSummary = null;
    this.courseSummary = null;
    this.currentQualityStars = null;
    this.currentDifficultyChoice = detail.autoSuggestedDifficulty;
    this.submitting = false;
    this.loadingSummary = true;
    this.savedProgression = null;
    this.savedDeltaText = null;
    this.baselineProgression = null;
    this.baselineProgressionLoad = null;
    this.setError(null);
    this.elements.modal.classList.remove('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'false');
    this.render();

    const loadToken = ++this.loadToken;
    this.baselineProgressionLoad = this.loadBaselineProgression(loadToken);
    try {
      if (detail.contentType === 'room') {
        const summary = await this.runRepository.loadRoomLeaderboard(
          detail.contentId,
          detail.roomCoordinates,
          detail.version,
          5
        );
        if (loadToken !== this.loadToken || !this.activeRequest) {
          return;
        }
        this.roomSummary = summary;
        this.adoptViewerRating(summary.viewerRating);
      } else {
        const summary = await this.courseRepository.loadCourseLeaderboard(
          detail.contentId,
          detail.version,
          5
        );
        if (loadToken !== this.loadToken || !this.activeRequest) {
          return;
        }
        this.courseSummary = summary;
        this.adoptViewerRating(summary.viewerRating);
      }
    } catch (error) {
      if (loadToken !== this.loadToken || !this.activeRequest) {
        return;
      }
      this.setError(error instanceof Error ? error.message : 'Failed to load run rating summary.');
    } finally {
      if (loadToken === this.loadToken && this.activeRequest) {
        this.loadingSummary = false;
        this.render();
      }
    }
  }

  close(): void {
    if (!this.elements.modal) {
      return;
    }

    this.elements.modal.classList.add('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'true');
    this.activeRequest = null;
    this.roomSummary = null;
    this.courseSummary = null;
    this.currentQualityStars = null;
    this.currentDifficultyChoice = null;
    this.submitting = false;
    this.loadingSummary = false;
    this.savedProgression = null;
    this.savedDeltaText = null;
    this.baselineProgression = null;
    this.baselineProgressionLoad = null;
    this.pendingOpenRequest = null;
    this.setError(null);
  }

  private isRewardStingVisible(): boolean {
    const layer = this.doc.getElementById('reward-sting-layer');
    return Boolean(layer && !layer.classList.contains('hidden'));
  }

  private adoptViewerRating(viewerRating: ViewerRatingSummary | null): void {
    if (!viewerRating) {
      return;
    }
    if (viewerRating.qualityStars !== null) {
      this.currentQualityStars = viewerRating.qualityStars;
    }
    if (viewerRating.difficultyChoice) {
      this.currentDifficultyChoice = viewerRating.difficultyChoice;
    }
  }

  private async submit(): Promise<void> {
    const request = this.activeRequest;
    if (
      !request ||
      this.submitting ||
      this.currentQualityStars === null ||
      this.currentDifficultyChoice === null
    ) {
      return;
    }

    this.submitting = true;
    this.setError(null);
    this.render();

    try {
      const authUserId = getAuthDebugState().user?.id?.trim() ?? null;
      if (request.contentType === 'room') {
        const response = await this.runRepository.submitRoomRating(request.contentId, {
          roomCoordinates: request.roomCoordinates,
          roomVersion: request.version,
          qualityStars: this.currentQualityStars,
          difficultyChoice: this.currentDifficultyChoice,
          autoSuggestedDifficulty: request.autoSuggestedDifficulty,
        });
        this.roomSummary = this.mergeRoomSummary(response);
        this.savedProgression = response.progression;
        this.savedDeltaText = formatProgressionDelta(response.progressionDelta);
        await this.baselineProgressionLoad;
        await this.ensureCurrentSummary(request);
        if (authUserId) {
          saveSeenRewardProgression(authUserId, response.progression);
        }
        requestProfileInvalidation(authUserId);
        this.emitProgressionFeedback(request, response.progression, response.progressionDelta);
      } else {
        const response = await this.courseRepository.submitCourseRating(request.contentId, {
          courseVersion: request.version,
          qualityStars: this.currentQualityStars,
          difficultyChoice: this.currentDifficultyChoice,
          autoSuggestedDifficulty: request.autoSuggestedDifficulty,
        });
        this.courseSummary = this.mergeCourseSummary(response);
        this.savedProgression = response.progression;
        this.savedDeltaText = formatProgressionDelta(response.progressionDelta);
        await this.baselineProgressionLoad;
        await this.ensureCurrentSummary(request);
        if (authUserId) {
          saveSeenRewardProgression(authUserId, response.progression);
        }
        requestProfileInvalidation(authUserId);
        this.emitProgressionFeedback(request, response.progression, response.progressionDelta);
      }

      notifyPostRunRatingSubmitted({
        contentType: request.contentType,
        contentId: request.contentId,
      });
    } catch (error) {
      this.setError(error instanceof Error ? error.message : 'Failed to save your rating.');
    } finally {
      this.submitting = false;
      this.render();
    }
  }

  private mergeRoomSummary(response: RoomRatingResponse): RoomLeaderboardResponse | null {
    const existing = this.roomSummary;
    if (!existing) {
      return null;
    }
    return {
      ...existing,
      quality: response.summary.quality,
      difficulty: response.summary.difficulty,
      viewerRating: response.summary.viewerRating,
      trophy: response.summary.trophy,
    };
  }

  private mergeCourseSummary(response: CourseProgressRatingResponse): CourseLeaderboardResponse | null {
    const existing = this.courseSummary;
    if (!existing) {
      return null;
    }
    return {
      ...existing,
      quality: response.summary.quality,
      difficulty: response.summary.difficulty,
      viewerRating: response.summary.viewerRating,
      trophy: response.summary.trophy,
    };
  }

  private render(): void {
    const request = this.activeRequest;
    const roomSummary = this.roomSummary;
    const courseSummary = this.courseSummary;
    const summaryTitle =
      request?.contentType === 'room'
        ? roomSummary?.roomTitle ?? request?.contentTitle ?? 'Room Challenge'
        : courseSummary?.courseTitle ?? request?.contentTitle ?? 'Course Run';

    if (this.elements.title) {
      this.elements.title.textContent = summaryTitle;
    }
    if (this.elements.meta) {
      this.elements.meta.textContent = request
        ? request.contentType === 'room'
          ? `Post-run room rating · version ${request.version}`
          : `Post-run course rating · version ${request.version}`
        : 'Post-run rating';
    }
    if (this.elements.result) {
      this.elements.result.textContent = request ? formatRunResultSummary(request) : '';
    }
    if (this.elements.leaderboard) {
      this.elements.leaderboard.textContent = this.loadingSummary
        ? 'Loading latest leaderboard summary...'
        : formatLeaderboardSummary(roomSummary, courseSummary);
    }
    if (this.elements.suggestion) {
      this.elements.suggestion.textContent = request
        ? `Suggested difficulty: ${ROOM_DIFFICULTY_LABELS[request.autoSuggestedDifficulty]}.`
        : '';
    }
    if (this.elements.status) {
      this.elements.status.textContent = this.submitting
        ? 'Saving your post-run rating...'
        : this.savedProgression
          ? buildSavedStatus(this.savedDeltaText, this.savedProgression)
          : buildPromptStatus(request);
    }
    if (this.elements.reward) {
      const rewardText = this.savedProgression
        ? buildProgressionSummaryText(this.savedProgression)
        : buildQualitySummaryText(roomSummary?.quality ?? courseSummary?.quality ?? null);
      this.elements.reward.textContent = rewardText;
      this.elements.reward.classList.toggle('hidden', rewardText.length === 0);
    }

    for (const button of this.elements.qualityButtons) {
      const value = Number.parseInt(button.dataset.qualityStars ?? '', 10);
      button.classList.toggle('active', value === this.currentQualityStars);
      button.disabled = this.submitting;
    }
    for (const button of this.elements.difficultyButtons) {
      const value = button.dataset.progressionDifficulty as ProgressionDifficulty | undefined;
      button.classList.toggle('active', value === this.currentDifficultyChoice);
      button.disabled = this.submitting;
    }

    if (this.elements.submitButton) {
      const canSubmit =
        !this.submitting &&
        request !== null &&
        this.currentQualityStars !== null &&
        this.currentDifficultyChoice !== null;
      this.elements.submitButton.disabled = !canSubmit;
      this.elements.submitButton.textContent = this.savedProgression ? 'Update Rating' : 'Submit Rating';
    }
    if (this.elements.skipButton) {
      this.elements.skipButton.disabled = this.submitting;
      this.elements.skipButton.textContent = this.savedProgression ? 'Done' : 'Skip';
    }
  }

  private setError(message: string | null): void {
    if (!this.elements.error) {
      return;
    }

    const normalized = message?.trim() ?? '';
    this.elements.error.textContent = normalized;
    this.elements.error.classList.toggle('hidden', normalized.length === 0);
  }

  private async loadBaselineProgression(loadToken: number): Promise<void> {
    const userId = getAuthDebugState().user?.id?.trim();
    if (!userId) {
      return;
    }

    try {
      const profile = await this.profileRepository.loadProfile(userId);
      if (loadToken !== this.loadToken || !this.activeRequest) {
        return;
      }
      this.baselineProgression = profile.progression;
    } catch {
      // Keep reward stings optional when profile baselines are unavailable.
    }
  }

  private emitProgressionFeedback(
    request: PostRunRatingRequestDetail,
    progression: ProgressionSummary,
    progressionDelta: ProgressionDelta,
  ): void {
    const resolvedTitle =
      request.contentType === 'room'
        ? this.roomSummary?.roomTitle ?? request.contentTitle
        : this.courseSummary?.courseTitle ?? request.contentTitle;

    dispatchProgressionFeedback({
      previousProgression: this.baselineProgression,
      currentProgression: progression,
      progressionDelta,
      previousViewerRank: request.previousViewerRank,
      currentViewerRank:
        request.contentType === 'room'
          ? this.roomSummary?.viewerRank ?? null
          : this.courseSummary?.viewerRank ?? null,
      contentType: request.contentType,
      contentId: request.contentId,
      contentTitle: resolvedTitle,
      reason: this.buildXpReason(request.contentType, resolvedTitle),
      windowObj: this.windowObj,
    });
  }

  private buildXpReason(
    contentType: PostRunRatingRequestDetail['contentType'],
    resolvedTitle: string | null | undefined,
  ): string {
    const normalizedTitle = resolvedTitle?.trim();
    if (normalizedTitle) {
      return `Rated ${normalizedTitle}`;
    }
    return contentType === 'course' ? 'Rated a course' : 'Rated a room';
  }

  private async ensureCurrentSummary(request: PostRunRatingRequestDetail): Promise<void> {
    try {
      if (request.contentType === 'room') {
        if (this.roomSummary) {
          return;
        }
        this.roomSummary = await this.runRepository.loadRoomLeaderboard(
          request.contentId,
          request.roomCoordinates,
          request.version,
          5,
        );
        return;
      }

      if (this.courseSummary) {
        return;
      }
      this.courseSummary = await this.courseRepository.loadCourseLeaderboard(
        request.contentId,
        request.version,
        5,
      );
    } catch {
      // Reward rank stings can silently skip when the summary is unavailable.
    }
  }
}

function formatRunResultSummary(detail: PostRunRatingRequestDetail): string {
  const parts = [
    formatElapsedMs(detail.elapsedMs),
    `${detail.deaths} death${detail.deaths === 1 ? '' : 's'}`,
  ];
  if (typeof detail.score === 'number') {
    parts.push(`${detail.score} pts`);
  }
  return parts.join(' · ');
}

function formatElapsedMs(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.round(elapsedMs / 100) / 10);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
}

function formatLeaderboardSummary(
  roomSummary: RoomLeaderboardResponse | null,
  courseSummary: CourseLeaderboardResponse | null
): string {
  if (roomSummary) {
    if (roomSummary.viewerRank !== null) {
      return `Leaderboard: #${roomSummary.viewerRank} · ${
        roomSummary.rankingMode === 'time' ? 'fastest time wins' : 'highest score wins'
      }.`;
    }
    return roomSummary.entries.length
      ? `Leaderboard live · ${
          roomSummary.rankingMode === 'time' ? 'fastest time wins' : 'highest score wins'
        }.`
      : 'No ranked clears yet.';
  }
  if (courseSummary) {
    if (courseSummary.viewerRank !== null) {
      return `Leaderboard: #${courseSummary.viewerRank} · ${
        courseSummary.rankingMode === 'time' ? 'fastest time wins' : 'highest score wins'
      }.`;
    }
    return courseSummary.entries.length
      ? `Leaderboard live · ${
          courseSummary.rankingMode === 'time' ? 'fastest time wins' : 'highest score wins'
        }.`
      : 'No ranked clears yet.';
  }
  return 'Latest leaderboard summary unavailable.';
}

function buildQualitySummaryText(quality: QualityRatingSummary | null): string {
  if (!quality || quality.adjustedAverage === null) {
    return '';
  }
  return `Current quality: ${quality.adjustedAverage.toFixed(2)}/5 from ${quality.voteCount} vote${
    quality.voteCount === 1 ? '' : 's'
  }.`;
}

function buildPromptStatus(request: PostRunRatingRequestDetail | null): string {
  if (request?.contentType === 'course') {
    return 'Rate the course quality and tweak the suggested difficulty if needed.';
  }
  return 'Rate the room quality and tweak the suggested difficulty if needed.';
}

function formatProgressionDelta(delta: {
  pxp: number;
  bxp: number;
  cxp: number;
  trust: number;
}): string {
  const parts: string[] = [];
  if (delta.pxp > 0) {
    parts.push(`+${delta.pxp} PXP`);
  }
  if (delta.bxp > 0) {
    parts.push(`+${delta.bxp} BXP`);
  }
  if (delta.cxp > 0) {
    parts.push(`+${delta.cxp} CXP`);
  }
  if (delta.trust > 0) {
    parts.push(`+${delta.trust} Trust`);
  }
  return parts.join(' · ');
}

function buildSavedStatus(
  deltaText: string | null,
  progression: ProgressionSummary
): string {
  if (deltaText && deltaText.length > 0) {
    return `Rating saved. ${deltaText}.`;
  }
  return `Rating updated. Player ${progression.player.level} · Builder ${progression.builder.level} · Curator ${progression.curator.level}.`;
}

function buildProgressionSummaryText(progression: ProgressionSummary): string {
  const founder = progression.founderNumber !== null ? `Founder #${progression.founderNumber}` : null;
  const parts = [
    founder,
    `Player ${progression.player.level}`,
    `Builder ${progression.builder.level}`,
    `Curator ${progression.curator.level}`,
  ].filter((value): value is string => Boolean(value));
  return parts.join(' · ');
}

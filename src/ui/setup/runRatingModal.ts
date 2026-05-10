import Phaser from 'phaser';
import { getAuthDebugState, promptForSignIn } from '../../auth/client';
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
  POST_RUN_GUEST_CLAIM_REQUEST_EVENT,
  POST_RUN_RATING_REQUEST_EVENT,
  notifyPostRunRatingSubmitted,
  type PostRunRatingRequestDetail,
} from '../../progression/postRunRatingEvents';
import {
  recordGuestRunClear,
  type GuestRunProgressSummary,
} from '../../progression/guestRunProgress';
import { REWARD_STINGS_IDLE_EVENT } from '../../progression/rewardStings';
import { dispatchProgressionFeedback } from '../../progression/progressionFeedback';
import { saveSeenRewardProgression } from '../../progression/rewardStingSeenState';
import { createProfileRepository, type ProfileRepository } from '../../profiles/profileRepository';
import { requestProfileInvalidation } from './profileEvents';
import { TILE_SIZE } from '../../config';
import { renderRoomSnapshotToPngDataUrl } from '../../mint/roomMetadataRender';
import type { RoomSnapshot } from '../../persistence/roomModel';
import {
  ROOM_DIFFICULTIES,
  ROOM_DIFFICULTY_LABELS,
  type RoomLeaderboardResponse,
} from '../../runs/model';
import { createRunRepository, type RunRepository } from '../../runs/runRepository';
import {
  buildRunShareText,
  buildRunShareUrl,
  canShareRunImage,
  createRunShareImageFile,
  downloadRunShareImage,
  openTwitterShareIntent,
  type RunShareImage,
} from '../../social/runShare';

type RunRatingElements = {
  modal: HTMLElement | null;
  closeButton: HTMLButtonElement | null;
  skipButton: HTMLButtonElement | null;
  submitButton: HTMLButtonElement | null;
  kicker: HTMLElement | null;
  title: HTMLElement | null;
  meta: HTMLElement | null;
  result: HTMLElement | null;
  leaderboard: HTMLElement | null;
  suggestion: HTMLElement | null;
  status: HTMLElement | null;
  reward: HTMLElement | null;
  qualitySection: HTMLElement | null;
  difficultySection: HTMLElement | null;
  ratingActions: HTMLElement | null;
  error: HTMLElement | null;
  shareSection: HTMLElement | null;
  sharePreviewImage: HTMLImageElement | null;
  sharePreviewPlaceholder: HTMLElement | null;
  shareMessage: HTMLElement | null;
  shareStatus: HTMLElement | null;
  shareSignInButton: HTMLButtonElement | null;
  shareTwitterButton: HTMLButtonElement | null;
  shareDownloadButton: HTMLButtonElement | null;
  guestClaimSection: HTMLElement | null;
  guestClaimXp: HTMLElement | null;
  guestClaimCopy: HTMLElement | null;
  guestClaimSignInButton: HTMLButtonElement | null;
  guestClaimContinueButton: HTMLButtonElement | null;
  qualityButtons: HTMLButtonElement[];
  difficultyButtons: HTMLButtonElement[];
};

type PostRunShareScene = {
  getPostRunShareRoomSnapshot?: () => RoomSnapshot | null;
};

type RunRatingModalMode = 'rating' | 'guest-claim';

interface PendingOpenRequest {
  mode: RunRatingModalMode;
  detail: PostRunRatingRequestDetail;
}

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
  private pendingOpenRequest: PendingOpenRequest | null = null;
  private mode: RunRatingModalMode = 'rating';
  private guestProgressSummary: GuestRunProgressSummary | null = null;
  private shareImage: RunShareImage | null = null;
  private shareImageLoading = false;
  private shareStatusText: string | null = null;
  private shareStatusTone: 'default' | 'error' = 'default';

  private readonly handleCloseClick = () => {
    this.close();
  };

  private readonly handleShareSignInClick = () => {
    promptForSignIn('Sign in to save ranked clears and share your WAMP runs.');
  };

  private readonly handleGuestClaimSignInClick = (event: Event) => {
    event.stopPropagation();
    this.close();
    promptForSignIn('Sign in to save your XP and leaderboard progress.');
  };

  private readonly handleGuestClaimContinueClick = () => {
    this.close();
  };

  private readonly handleShareTwitterClick = () => {
    void this.shareRun();
  };

  private readonly handleShareDownloadClick = () => {
    if (!this.shareImage) {
      return;
    }

    downloadRunShareImage(this.doc, this.shareImage);
    this.setShareStatus('Snapshot downloaded.', 'default');
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

    const mode: RunRatingModalMode = getAuthDebugState().authenticated ? 'rating' : 'guest-claim';
    if (this.isRewardStingVisible()) {
      this.pendingOpenRequest = { mode, detail };
      return;
    }

    if (mode === 'guest-claim') {
      this.openGuestClaim(detail);
      return;
    }

    void this.open(detail);
  };

  private readonly handleGuestClaimRequest = (event: Event) => {
    const detail =
      event instanceof CustomEvent
        ? (event.detail as PostRunRatingRequestDetail | undefined)
        : undefined;
    if (!detail) {
      return;
    }

    if (this.isRewardStingVisible()) {
      this.pendingOpenRequest = { mode: 'guest-claim', detail };
      return;
    }

    this.openGuestClaim(detail);
  };

  private readonly handleRewardStingsIdle = () => {
    if (!this.pendingOpenRequest || this.isRewardStingVisible()) {
      return;
    }

    const request = this.pendingOpenRequest;
    this.pendingOpenRequest = null;
    if (request.mode === 'guest-claim') {
      this.openGuestClaim(request.detail);
      return;
    }
    void this.open(request.detail);
  };

  constructor(
    private readonly game: Phaser.Game,
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
      kicker: this.doc.getElementById('run-rating-kicker'),
      title: this.doc.getElementById('run-rating-title'),
      meta: this.doc.getElementById('run-rating-meta'),
      result: this.doc.getElementById('run-rating-result'),
      leaderboard: this.doc.getElementById('run-rating-leaderboard'),
      suggestion: this.doc.getElementById('run-rating-suggestion'),
      status: this.doc.getElementById('run-rating-status'),
      reward: this.doc.getElementById('run-rating-reward'),
      qualitySection: this.doc.querySelector<HTMLElement>('#run-rating-modal .run-rating-section-quality'),
      difficultySection: this.doc.querySelector<HTMLElement>('#run-rating-modal .run-rating-section-difficulty'),
      ratingActions: this.doc.querySelector<HTMLElement>('#run-rating-modal .run-rating-actions'),
      error: this.doc.getElementById('run-rating-error'),
      shareSection: this.doc.getElementById('run-rating-share'),
      sharePreviewImage: this.doc.getElementById('run-share-preview-image') as HTMLImageElement | null,
      sharePreviewPlaceholder: this.doc.getElementById('run-share-preview-placeholder'),
      shareMessage: this.doc.getElementById('run-share-message'),
      shareStatus: this.doc.getElementById('run-share-status'),
      shareSignInButton: this.doc.getElementById('btn-run-share-signin') as HTMLButtonElement | null,
      shareTwitterButton: this.doc.getElementById('btn-run-share-twitter') as HTMLButtonElement | null,
      shareDownloadButton: this.doc.getElementById('btn-run-share-download') as HTMLButtonElement | null,
      guestClaimSection: this.doc.getElementById('run-guest-claim'),
      guestClaimXp: this.doc.getElementById('run-guest-claim-xp'),
      guestClaimCopy: this.doc.getElementById('run-guest-claim-copy'),
      guestClaimSignInButton: this.doc.getElementById('btn-run-guest-claim-signin') as HTMLButtonElement | null,
      guestClaimContinueButton: this.doc.getElementById('btn-run-guest-claim-continue') as HTMLButtonElement | null,
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
    this.elements.shareSignInButton?.addEventListener('click', this.handleShareSignInClick);
    this.elements.shareTwitterButton?.addEventListener('click', this.handleShareTwitterClick);
    this.elements.shareDownloadButton?.addEventListener('click', this.handleShareDownloadClick);
    this.elements.guestClaimSignInButton?.addEventListener('click', this.handleGuestClaimSignInClick);
    this.elements.guestClaimContinueButton?.addEventListener('click', this.handleGuestClaimContinueClick);
    this.elements.modal?.addEventListener('click', this.handleBackdropClick);
    this.doc.addEventListener('keydown', this.handleDocumentKeydown);
    this.windowObj.addEventListener(
      POST_RUN_RATING_REQUEST_EVENT,
      this.handleOpenRequest as EventListener
    );
    this.windowObj.addEventListener(
      POST_RUN_GUEST_CLAIM_REQUEST_EVENT,
      this.handleGuestClaimRequest as EventListener
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
    this.elements.shareSignInButton?.removeEventListener('click', this.handleShareSignInClick);
    this.elements.shareTwitterButton?.removeEventListener('click', this.handleShareTwitterClick);
    this.elements.shareDownloadButton?.removeEventListener('click', this.handleShareDownloadClick);
    this.elements.guestClaimSignInButton?.removeEventListener('click', this.handleGuestClaimSignInClick);
    this.elements.guestClaimContinueButton?.removeEventListener('click', this.handleGuestClaimContinueClick);
    this.elements.modal?.removeEventListener('click', this.handleBackdropClick);
    this.doc.removeEventListener('keydown', this.handleDocumentKeydown);
    this.windowObj.removeEventListener(
      POST_RUN_RATING_REQUEST_EVENT,
      this.handleOpenRequest as EventListener
    );
    this.windowObj.removeEventListener(
      POST_RUN_GUEST_CLAIM_REQUEST_EVENT,
      this.handleGuestClaimRequest as EventListener
    );
    this.windowObj.removeEventListener(REWARD_STINGS_IDLE_EVENT, this.handleRewardStingsIdle);
  }

  private async open(detail: PostRunRatingRequestDetail): Promise<void> {
    if (!this.elements.modal) {
      return;
    }

    this.mode = 'rating';
    this.activeRequest = detail;
    this.guestProgressSummary = null;
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
    this.shareImage = null;
    this.shareImageLoading = detail.contentType === 'room';
    this.shareStatusText = detail.contentType === 'room' ? 'Rendering room snapshot...' : null;
    this.shareStatusTone = 'default';
    this.setError(null);
    const loadToken = ++this.loadToken;
    this.elements.modal.classList.remove('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'false');
    this.render();
    void this.prepareShareImage(detail, loadToken);

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

  private openGuestClaim(detail: PostRunRatingRequestDetail): void {
    if (!this.elements.modal) {
      return;
    }

    this.mode = 'guest-claim';
    this.activeRequest = detail;
    this.guestProgressSummary = recordGuestRunClear(detail);
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
    this.shareImage = null;
    this.shareImageLoading = false;
    this.shareStatusText = null;
    this.shareStatusTone = 'default';
    this.setError(null);
    this.loadToken += 1;
    this.elements.modal.classList.remove('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'false');
    this.render();
  }

  close(): void {
    if (!this.elements.modal) {
      return;
    }

    this.elements.modal.classList.add('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'true');
    this.mode = 'rating';
    this.activeRequest = null;
    this.guestProgressSummary = null;
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
    this.shareImage = null;
    this.shareImageLoading = false;
    this.shareStatusText = null;
    this.shareStatusTone = 'default';
    this.setError(null);
  }

  private isRewardStingVisible(): boolean {
    const layer = this.doc.getElementById('reward-sting-layer');
    return Boolean(layer && !layer.classList.contains('hidden'));
  }

  private async prepareShareImage(
    detail: PostRunRatingRequestDetail,
    loadToken: number
  ): Promise<void> {
    if (detail.contentType !== 'room') {
      return;
    }

    try {
      const snapshot = this.getPostRunShareRoomSnapshot();
      if (!snapshot) {
        throw new Error('Completed room snapshot was not available.');
      }

      const dataUrl = await renderRoomSnapshotToPngDataUrl(snapshot, {
        tilePixelSize: TILE_SIZE,
      });
      if (!this.isActiveRequest(detail, loadToken)) {
        return;
      }

      this.shareImage = {
        dataUrl,
        fileName: this.buildShareImageFileName(detail),
      };
      this.shareStatusText = 'Snapshot ready.';
      this.shareStatusTone = 'default';
    } catch (error) {
      console.warn('Failed to render room share snapshot.', error);
      if (!this.isActiveRequest(detail, loadToken)) {
        return;
      }

      const fallbackDataUrl = this.captureCurrentCanvasDataUrl();
      if (fallbackDataUrl) {
        this.shareImage = {
          dataUrl: fallbackDataUrl,
          fileName: this.buildShareImageFileName(detail),
        };
        this.shareStatusText = 'Snapshot ready from the current view.';
        this.shareStatusTone = 'default';
      } else {
        this.shareImage = null;
        this.shareStatusText = 'Snapshot unavailable. You can still share the text.';
        this.shareStatusTone = 'error';
      }
    } finally {
      if (this.isActiveRequest(detail, loadToken)) {
        this.shareImageLoading = false;
        this.render();
      }
    }
  }

  private async shareRun(): Promise<void> {
    const request = this.activeRequest;
    if (!request || request.contentType !== 'room') {
      return;
    }

    const text = buildRunShareText(request, this.getShareContentTitle(request));
    const url = buildRunShareUrl(request, this.windowObj.location.href);
    const file = this.shareImage ? createRunShareImageFile(this.shareImage) : null;

    if (file && canShareRunImage(this.windowObj.navigator, file)) {
      try {
        await this.windowObj.navigator.share({
          title: 'WAMP room clear',
          text,
          url,
          files: [file],
        });
        this.setShareStatus('Share sheet opened with the snapshot.', 'default');
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          this.setShareStatus('Share canceled.', 'default');
          return;
        }
        console.warn('Native run share failed; falling back to Twitter intent.', error);
      }
    }

    openTwitterShareIntent(this.windowObj, text, url);
    this.setShareStatus(
      file
        ? 'Opened X with the achievement text. Download the snapshot if you want to attach it manually.'
        : 'Opened X with the achievement text. Snapshot image was not available.',
      'default'
    );
  }

  private getPostRunShareRoomSnapshot(): RoomSnapshot | null {
    try {
      const scene = this.game.scene.getScene('OverworldPlayScene') as PostRunShareScene;
      return scene.getPostRunShareRoomSnapshot?.() ?? null;
    } catch {
      return null;
    }
  }

  private captureCurrentCanvasDataUrl(): string | null {
    try {
      return this.game.canvas.toDataURL('image/png');
    } catch {
      return null;
    }
  }

  private buildShareImageFileName(detail: PostRunRatingRequestDetail): string {
    if (detail.contentType !== 'room') {
      return 'wamp-run-clear.png';
    }

    const x = String(detail.roomCoordinates.x).replace('-', 'neg');
    const y = String(detail.roomCoordinates.y).replace('-', 'neg');
    return `wamp-room-${x}-${y}-v${detail.version}-clear.png`;
  }

  private getShareContentTitle(request: PostRunRatingRequestDetail): string | null {
    return request.contentType === 'room'
      ? this.roomSummary?.roomTitle ?? request.contentTitle
      : this.courseSummary?.courseTitle ?? request.contentTitle;
  }

  private isActiveRequest(
    detail: PostRunRatingRequestDetail,
    loadToken: number
  ): boolean {
    return this.loadToken === loadToken && this.activeRequest === detail;
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
    const guestClaimMode = this.mode === 'guest-claim';
    const summaryTitle = guestClaimMode
      ? 'You did it!'
      : request?.contentType === 'room'
        ? roomSummary?.roomTitle ?? request?.contentTitle ?? 'Room Challenge'
        : courseSummary?.courseTitle ?? request?.contentTitle ?? 'Course Run';

    this.elements.kicker?.classList.toggle('hidden', guestClaimMode);
    if (this.elements.title) {
      this.elements.title.textContent = summaryTitle;
    }
    if (this.elements.meta) {
      this.elements.meta.classList.toggle('hidden', guestClaimMode);
      if (guestClaimMode) {
        this.elements.meta.textContent = '';
      } else if (request) {
        this.elements.meta.textContent =
          request.contentType === 'room'
            ? `Post-run room rating · version ${request.version}`
            : `Post-run course rating · version ${request.version}`;
      } else {
        this.elements.meta.textContent = 'Post-run rating';
      }
    }
    if (this.elements.result) {
      this.elements.result.classList.toggle('hidden', guestClaimMode);
      this.elements.result.textContent = request ? formatRunResultSummary(request) : '';
    }
    if (this.elements.leaderboard) {
      this.elements.leaderboard.classList.toggle('hidden', guestClaimMode);
      this.elements.leaderboard.textContent = this.loadingSummary
        ? 'Loading latest leaderboard summary...'
        : formatLeaderboardSummary(roomSummary, courseSummary);
    }
    if (this.elements.suggestion) {
      this.elements.suggestion.classList.toggle('hidden', guestClaimMode);
      this.elements.suggestion.textContent = request
        ? `Suggested difficulty: ${ROOM_DIFFICULTY_LABELS[request.autoSuggestedDifficulty]}.`
        : '';
    }
    if (this.elements.status) {
      this.elements.status.classList.toggle('hidden', guestClaimMode);
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
      this.elements.reward.classList.toggle('hidden', guestClaimMode || rewardText.length === 0);
    }
    this.elements.qualitySection?.classList.toggle('hidden', guestClaimMode);
    this.elements.difficultySection?.classList.toggle('hidden', guestClaimMode);
    this.elements.ratingActions?.classList.toggle('hidden', guestClaimMode);
    this.elements.guestClaimSection?.classList.toggle('hidden', !guestClaimMode);
    if (guestClaimMode) {
      this.renderGuestClaim();
    }
    this.renderShare(request);

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

  private renderGuestClaim(): void {
    const xp = this.guestProgressSummary?.latest?.potentialPxp ?? 0;
    if (this.elements.guestClaimXp) {
      this.elements.guestClaimXp.textContent = `You earned ${xp > 0 ? xp : 20} XP`;
    }
    if (this.elements.guestClaimCopy) {
      this.elements.guestClaimCopy.textContent =
        'Sign in to save your XP and leaderboard progress.';
    }
  }

  private renderShare(request: PostRunRatingRequestDetail | null): void {
    const visible = this.mode === 'rating' && request?.contentType === 'room';
    this.elements.shareSection?.classList.toggle('hidden', !visible);
    if (!visible || !request) {
      return;
    }

    const authState = getAuthDebugState();
    const shareText = buildRunShareText(request, this.getShareContentTitle(request));
    if (this.elements.shareMessage) {
      this.elements.shareMessage.textContent = shareText;
    }
    if (this.elements.sharePreviewImage) {
      if (this.shareImage) {
        this.elements.sharePreviewImage.src = this.shareImage.dataUrl;
        this.elements.sharePreviewImage.classList.remove('hidden');
      } else {
        this.elements.sharePreviewImage.removeAttribute('src');
        this.elements.sharePreviewImage.classList.add('hidden');
      }
    }
    if (this.elements.sharePreviewPlaceholder) {
      this.elements.sharePreviewPlaceholder.textContent = this.shareImageLoading
        ? 'Rendering snapshot...'
        : 'Snapshot unavailable';
      this.elements.sharePreviewPlaceholder.classList.toggle('hidden', Boolean(this.shareImage));
    }
    if (this.elements.shareStatus) {
      this.elements.shareStatus.textContent = this.shareStatusText ?? '';
      this.elements.shareStatus.classList.toggle('hidden', !this.shareStatusText);
      this.elements.shareStatus.setAttribute('data-run-share-tone', this.shareStatusTone);
    }
    if (this.elements.shareSignInButton) {
      this.elements.shareSignInButton.classList.toggle('hidden', authState.authenticated);
    }
    if (this.elements.shareTwitterButton) {
      this.elements.shareTwitterButton.disabled = this.shareImageLoading;
    }
    if (this.elements.shareDownloadButton) {
      this.elements.shareDownloadButton.disabled = !this.shareImage;
    }
  }

  private setShareStatus(
    message: string | null,
    tone: 'default' | 'error'
  ): void {
    this.shareStatusText = message;
    this.shareStatusTone = tone;
    this.render();
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

    const currentViewerRank =
      request.contentType === 'room'
        ? this.roomSummary?.viewerRank ?? null
        : this.courseSummary?.viewerRank ?? null;
    dispatchProgressionFeedback({
      previousProgression: this.baselineProgression,
      currentProgression: progression,
      progressionDelta,
      previousViewerRank: request.suppressLeaderboardRewardStings
        ? currentViewerRank
        : request.previousViewerRank,
      currentViewerRank,
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

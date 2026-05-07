import Phaser from 'phaser';
import { getAuthDebugState } from '../../auth/client';
import {
  createRunRepository,
  type RunRepository,
} from '../../runs/runRepository';
import type { RoomRushRunSubmissionRequestBody } from '../../runs/model';
import {
  buildRoomRushShareText,
  formatRoomRushDifficulty,
  formatRoomRushDuration,
  formatRoomRushStartRule,
  renderRoomRushShareImage,
  type RoomRushOverworldCapture,
} from '../../social/roomRushShare';
import {
  canShareRunImage,
  createRunShareImageFile,
  downloadRunShareImage,
  openTwitterShareIntent,
  type RunShareImage,
} from '../../social/runShare';
import type { ActiveRoomRushRunState } from '../../scenes/overworld/roomRushRuns';
import {
  ROOM_RUSH_RESULT_REQUEST_EVENT,
  type RoomRushResultRequestDetail,
} from './roomRushResultEvents';

type RoomRushResultModalElements = {
  modal: HTMLElement | null;
  closeButton: HTMLButtonElement | null;
  title: HTMLElement | null;
  meta: HTMLElement | null;
  mapCanvas: HTMLCanvasElement | null;
  message: HTMLElement | null;
  status: HTMLElement | null;
  shareButton: HTMLButtonElement | null;
  copyButton: HTMLButtonElement | null;
  downloadButton: HTMLButtonElement | null;
};

type RoomRushShareScene = {
  getRoomRushShareOverworldCapture?: (run: ActiveRoomRushRunState) => RoomRushOverworldCapture | null;
};

export class RoomRushResultModalController {
  private readonly elements: RoomRushResultModalElements;
  private activeRun: ActiveRoomRushRunState | null = null;
  private shareImage: RunShareImage | null = null;
  private shareStatusText: string | null = null;
  private shareStatusTone: 'default' | 'error' = 'default';

  private readonly handleCloseClick = (): void => {
    this.close();
  };

  private readonly handleShareClick = (): void => {
    void this.shareRun();
  };

  private readonly handleCopyClick = (): void => {
    void this.copyShareText();
  };

  private readonly handleDownloadClick = (): void => {
    if (!this.shareImage) {
      return;
    }

    downloadRunShareImage(this.doc, this.shareImage);
    this.setShareStatus('Map image downloaded.', 'default');
  };

  private readonly handleBackdropClick = (event: Event): void => {
    if (event.target === this.elements.modal) {
      this.close();
    }
  };

  private readonly handleDocumentKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || this.elements.modal?.classList.contains('hidden')) {
      return;
    }

    this.close();
  };

  private readonly handleOpenRequest = (event: Event): void => {
    const detail =
      event instanceof CustomEvent
        ? (event.detail as RoomRushResultRequestDetail | undefined)
        : undefined;
    if (!detail?.run) {
      return;
    }

    this.open(detail.run);
  };

  constructor(
    private readonly game: Phaser.Game,
    private readonly doc: Document = document,
    private readonly windowObj: Window = window,
    private readonly runRepository: RunRepository = createRunRepository(),
  ) {
    this.elements = {
      modal: this.doc.getElementById('room-rush-result-modal'),
      closeButton: this.doc.getElementById('btn-room-rush-result-close') as HTMLButtonElement | null,
      title: this.doc.getElementById('room-rush-result-title'),
      meta: this.doc.getElementById('room-rush-result-meta'),
      mapCanvas: this.doc.getElementById('room-rush-result-map') as HTMLCanvasElement | null,
      message: this.doc.getElementById('room-rush-result-message'),
      status: this.doc.getElementById('room-rush-result-status'),
      shareButton: this.doc.getElementById('btn-room-rush-result-share') as HTMLButtonElement | null,
      copyButton: this.doc.getElementById('btn-room-rush-result-copy') as HTMLButtonElement | null,
      downloadButton: this.doc.getElementById('btn-room-rush-result-download') as HTMLButtonElement | null,
    };
  }

  init(): void {
    this.elements.closeButton?.addEventListener('click', this.handleCloseClick);
    this.elements.shareButton?.addEventListener('click', this.handleShareClick);
    this.elements.copyButton?.addEventListener('click', this.handleCopyClick);
    this.elements.downloadButton?.addEventListener('click', this.handleDownloadClick);
    this.elements.modal?.addEventListener('click', this.handleBackdropClick);
    this.doc.addEventListener('keydown', this.handleDocumentKeydown);
    this.windowObj.addEventListener(
      ROOM_RUSH_RESULT_REQUEST_EVENT,
      this.handleOpenRequest as EventListener,
    );
  }

  destroy(): void {
    this.elements.closeButton?.removeEventListener('click', this.handleCloseClick);
    this.elements.shareButton?.removeEventListener('click', this.handleShareClick);
    this.elements.copyButton?.removeEventListener('click', this.handleCopyClick);
    this.elements.downloadButton?.removeEventListener('click', this.handleDownloadClick);
    this.elements.modal?.removeEventListener('click', this.handleBackdropClick);
    this.doc.removeEventListener('keydown', this.handleDocumentKeydown);
    this.windowObj.removeEventListener(
      ROOM_RUSH_RESULT_REQUEST_EVENT,
      this.handleOpenRequest as EventListener,
    );
    this.close();
  }

  open(run: ActiveRoomRushRunState): void {
    if (!this.elements.modal) {
      return;
    }

    this.activeRun = cloneRoomRushRun(run);
    this.shareImage = null;
    this.shareStatusText = null;
    this.shareStatusTone = 'default';
    this.elements.modal.classList.remove('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'false');
    this.shareStatusText = 'Rendering overworld map...';
    this.shareStatusTone = 'default';
    this.render();
    void this.submitLeaderboardRun(this.activeRun);
    void this.renderShareImageAfterFrame();
  }

  close(): void {
    if (!this.elements.modal) {
      return;
    }

    this.elements.modal.classList.add('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'true');
    this.activeRun = null;
    this.shareImage = null;
    this.shareStatusText = null;
    this.shareStatusTone = 'default';
  }

  private async renderShareImageAfterFrame(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.windowObj.requestAnimationFrame(() => {
        this.windowObj.requestAnimationFrame(() => resolve());
      });
    });

    this.renderShareImage();
  }

  private renderShareImage(): void {
    const run = this.activeRun;
    const canvas = this.elements.mapCanvas;
    if (!run || !canvas) {
      return;
    }

    try {
      this.shareImage = renderRoomRushShareImage(canvas, run, {
        overworldCapture: this.getOverworldCapture(run),
      });
      this.shareStatusText = null;
      this.shareStatusTone = 'default';
    } catch (error) {
      console.warn('Failed to render Room Rush route map.', error);
      this.shareImage = null;
      this.shareStatusText = 'Route map unavailable. You can still copy the text.';
      this.shareStatusTone = 'error';
    }
    this.render();
  }

  private getOverworldCapture(run: ActiveRoomRushRunState): RoomRushOverworldCapture | null {
    try {
      const scene = this.game.scene.getScene('OverworldPlayScene') as RoomRushShareScene;
      return scene.getRoomRushShareOverworldCapture?.(run) ?? null;
    } catch {
      return null;
    }
  }

  private render(): void {
    const run = this.activeRun;
    if (!run) {
      return;
    }

    const score = run.visitedRoomIds.length;
    if (this.elements.title) {
      this.elements.title.textContent =
        run.result === 'failed' ? 'Hard Rush Ended' : 'Room Rush Complete';
    }
    if (this.elements.meta) {
      this.elements.meta.textContent = [
        `${score} ${score === 1 ? 'room' : 'rooms'}`,
        `${formatRoomRushDifficulty(run)} - ${formatRoomRushStartRule(run)}`,
        formatRoomRushDuration(run.elapsedMs),
        `${run.deaths} ${run.deaths === 1 ? 'death' : 'deaths'}`,
      ].join(' / ');
    }
    if (this.elements.message) {
      this.elements.message.textContent = buildRoomRushShareText(run);
    }
    if (this.elements.status) {
      this.elements.status.textContent = this.shareStatusText ?? '';
      this.elements.status.classList.toggle('hidden', !this.shareStatusText);
      this.elements.status.setAttribute('data-room-rush-share-tone', this.shareStatusTone);
    }
    if (this.elements.shareButton) {
      this.elements.shareButton.disabled = false;
    }
    if (this.elements.copyButton) {
      this.elements.copyButton.disabled = false;
    }
    if (this.elements.downloadButton) {
      this.elements.downloadButton.disabled = !this.shareImage;
    }
  }

  private async shareRun(): Promise<void> {
    const run = this.activeRun;
    if (!run) {
      return;
    }

    const text = buildRoomRushShareText(run);
    const url = this.windowObj.location.href;
    const file = this.shareImage ? createRunShareImageFile(this.shareImage) : null;

    if (file && canShareRunImage(this.windowObj.navigator, file)) {
      try {
        await this.windowObj.navigator.share({
          title: 'WAMP Room Rush',
          text,
          url,
          files: [file],
        });
        this.setShareStatus('Share sheet opened with the route map.', 'default');
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          this.setShareStatus('Share canceled.', 'default');
          return;
        }
        console.warn('Native Room Rush share failed; falling back to X intent.', error);
      }
    }

    openTwitterShareIntent(this.windowObj, text, url);
    this.setShareStatus(
      file
        ? 'Opened X with the run text. Download the map if you want to attach it manually.'
        : 'Opened X with the run text. Route map was not available.',
      'default',
    );
  }

  private async copyShareText(): Promise<void> {
    const run = this.activeRun;
    if (!run) {
      return;
    }

    const clipboard = this.windowObj.navigator.clipboard;
    if (!clipboard?.writeText) {
      this.setShareStatus('Clipboard unavailable in this browser.', 'error');
      return;
    }

    try {
      await clipboard.writeText(`${buildRoomRushShareText(run)}\n${this.windowObj.location.href}`);
      this.setShareStatus('Share text copied.', 'default');
    } catch (error) {
      console.warn('Failed to copy Room Rush share text.', error);
      this.setShareStatus('Could not copy share text.', 'error');
    }
  }

  private setShareStatus(message: string | null, tone: 'default' | 'error'): void {
    this.shareStatusText = message;
    this.shareStatusTone = tone;
    this.render();
  }

  private async submitLeaderboardRun(run: ActiveRoomRushRunState): Promise<void> {
    if (run.result !== 'completed' && run.result !== 'failed') {
      return;
    }

    if (!getAuthDebugState().authenticated) {
      return;
    }

    try {
      await this.runRepository.submitRoomRushRun(buildRoomRushSubmissionBody(run));
    } catch (error) {
      console.warn('Failed to save Room Rush leaderboard run.', error);
    }
  }
}

function buildRoomRushSubmissionBody(
  run: ActiveRoomRushRunState
): RoomRushRunSubmissionRequestBody {
  return {
    clientRunId: run.runId,
    difficulty: run.difficulty,
    startRule: run.startRule,
    result: run.result === 'failed' ? 'failed' : 'completed',
    elapsedMs: Math.max(0, Math.round(run.elapsedMs)),
    deaths: Math.max(0, Math.round(run.deaths)),
    visitedRoomIds: [...run.visitedRoomIds],
    route: run.route.map((step) => ({
      routeIndex: step.routeIndex,
      roomId: step.roomId,
      coordinates: { ...step.coordinates },
      uniqueVisitIndex: step.uniqueVisitIndex,
    })),
    startCoordinates: { ...run.startCoordinates },
    finishCoordinates: { ...run.currentCoordinates },
    finishedAt: new Date().toISOString(),
  };
}

function cloneRoomRushRun(run: ActiveRoomRushRunState): ActiveRoomRushRunState {
  return {
    ...run,
    startCoordinates: { ...run.startCoordinates },
    returnCoordinates: { ...run.returnCoordinates },
    currentCoordinates: { ...run.currentCoordinates },
    visitedRoomIds: [...run.visitedRoomIds],
    route: run.route.map((step) => ({
      ...step,
      coordinates: { ...step.coordinates },
    })),
  };
}

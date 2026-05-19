import Phaser from 'phaser';
import {
  POST_RUN_RATING_SUBMITTED_EVENT,
  type PostRunRatingSubmittedDetail,
} from '../../progression/postRunRatingEvents';
import type { RoomDiscoveryEntry } from '../../runs/model';
import { getActiveOverworldScene } from './sceneBridge';
import {
  EXPLORE_QUEUE_START_EVENT,
  type ExploreQueueMode,
  type ExploreQueueStartDetail,
} from './exploreQueueEvents';
import type { LeaderboardModalController } from './leaderboardModal';

type ExploreQueueElements = {
  bar: HTMLElement | null;
  kicker: HTMLElement | null;
  title: HTMLElement | null;
  meta: HTMLElement | null;
  currentButton: HTMLButtonElement | null;
  nextButton: HTMLButtonElement | null;
  stopButton: HTMLButtonElement | null;
};

type QueueStatusTone = 'default' | 'error' | 'done';

interface ActiveExploreQueue {
  mode: ExploreQueueMode;
  entries: RoomDiscoveryEntry[];
  sourceLabel: string;
  index: number;
  statusText: string | null;
  statusTone: QueueStatusTone;
}

type ExploreQueueDebugWindow = Window & {
  get_explore_queue_state?: () => unknown;
};

export class ExploreQueueController {
  private readonly elements: ExploreQueueElements;
  private activeQueue: ActiveExploreQueue | null = null;
  private navigating = false;
  private advanceTimer: number | null = null;

  private readonly handleStartRequest = (event: Event): void => {
    const detail =
      event instanceof CustomEvent
        ? (event.detail as ExploreQueueStartDetail | undefined)
        : undefined;
    if (!detail || detail.entries.length === 0) {
      return;
    }
    void this.start(detail);
  };

  private readonly handleCurrentClick = (): void => {
    void this.presentCurrent();
  };

  private readonly handleNextClick = (): void => {
    void this.advance();
  };

  private readonly handleStopClick = (): void => {
    this.stop();
  };

  private readonly handleRunRatingSubmitted = (event: Event): void => {
    const detail =
      event instanceof CustomEvent
        ? (event.detail as PostRunRatingSubmittedDetail | undefined)
        : undefined;
    const queue = this.activeQueue;
    const current = this.getCurrentEntry();
    if (!detail || !queue || !current || detail.contentType !== 'room' || detail.contentId !== current.roomId) {
      return;
    }

    queue.statusText =
      queue.mode === 'rate'
        ? 'Saved. Loading the next room...'
        : 'Rating saved. Next room is ready.';
    queue.statusTone = 'default';
    this.render();
    if (queue.mode !== 'rate') {
      return;
    }

    this.clearAdvanceTimer();
    this.advanceTimer = this.windowObj.setTimeout(() => {
      this.advanceTimer = null;
      void this.advance();
    }, 450);
  };

  constructor(
    private readonly game: Phaser.Game,
    private readonly leaderboardModal: LeaderboardModalController,
    private readonly doc: Document = document,
    private readonly windowObj: ExploreQueueDebugWindow = window,
  ) {
    this.elements = {
      bar: this.doc.getElementById('explore-queue-bar'),
      kicker: this.doc.getElementById('explore-queue-kicker'),
      title: this.doc.getElementById('explore-queue-title'),
      meta: this.doc.getElementById('explore-queue-meta'),
      currentButton: this.doc.getElementById('btn-explore-queue-current') as HTMLButtonElement | null,
      nextButton: this.doc.getElementById('btn-explore-queue-next') as HTMLButtonElement | null,
      stopButton: this.doc.getElementById('btn-explore-queue-stop') as HTMLButtonElement | null,
    };
  }

  init(): void {
    this.windowObj.addEventListener(EXPLORE_QUEUE_START_EVENT, this.handleStartRequest as EventListener);
    this.windowObj.addEventListener(POST_RUN_RATING_SUBMITTED_EVENT, this.handleRunRatingSubmitted as EventListener);
    this.elements.currentButton?.addEventListener('click', this.handleCurrentClick);
    this.elements.nextButton?.addEventListener('click', this.handleNextClick);
    this.elements.stopButton?.addEventListener('click', this.handleStopClick);
    this.windowObj.get_explore_queue_state = () => this.getDebugState();
    this.render();
  }

  destroy(): void {
    this.windowObj.removeEventListener(EXPLORE_QUEUE_START_EVENT, this.handleStartRequest as EventListener);
    this.windowObj.removeEventListener(POST_RUN_RATING_SUBMITTED_EVENT, this.handleRunRatingSubmitted as EventListener);
    this.elements.currentButton?.removeEventListener('click', this.handleCurrentClick);
    this.elements.nextButton?.removeEventListener('click', this.handleNextClick);
    this.elements.stopButton?.removeEventListener('click', this.handleStopClick);
    this.clearAdvanceTimer();
    if (this.windowObj.get_explore_queue_state) {
      delete this.windowObj.get_explore_queue_state;
    }
  }

  private async start(detail: ExploreQueueStartDetail): Promise<void> {
    this.clearAdvanceTimer();
    this.activeQueue = {
      mode: detail.mode,
      entries: detail.entries.map((entry) => ({ ...entry, roomCoordinates: { ...entry.roomCoordinates } })),
      sourceLabel: detail.sourceLabel,
      index: 0,
      statusText: null,
      statusTone: 'default',
    };
    this.render();
    await this.presentCurrent();
  }

  stop(): void {
    this.clearAdvanceTimer();
    this.activeQueue = null;
    this.navigating = false;
    this.render();
  }

  private async advance(): Promise<void> {
    const queue = this.activeQueue;
    if (!queue || this.navigating) {
      return;
    }

    if (queue.index >= queue.entries.length - 1) {
      queue.index = queue.entries.length;
      queue.statusText = 'Queue complete.';
      queue.statusTone = 'done';
      this.leaderboardModal.close();
      this.render();
      return;
    }

    queue.index += 1;
    queue.statusText = null;
    queue.statusTone = 'default';
    this.render();
    await this.presentCurrent();
  }

  private async presentCurrent(): Promise<void> {
    const queue = this.activeQueue;
    const entry = this.getCurrentEntry();
    if (!queue || !entry || this.navigating) {
      return;
    }

    const scene = getActiveOverworldScene(this.game);
    if (!scene?.jumpToCoordinates) {
      queue.statusText = 'The overworld is not ready yet.';
      queue.statusTone = 'error';
      this.render();
      return;
    }

    this.navigating = true;
    queue.statusText = queue.mode === 'play' ? 'Loading room...' : 'Loading rating...';
    queue.statusTone = 'default';
    this.render();

    try {
      await scene.jumpToCoordinates(entry.roomCoordinates);
      if (queue.mode === 'play') {
        if (!scene.playSelectedRoom) {
          throw new Error('The room player is not ready yet.');
        }
        this.leaderboardModal.close();
        scene.playSelectedRoom();
        queue.statusText = 'Playing. Use Next when you are ready for another room.';
      } else {
        await this.leaderboardModal.open('room');
        queue.statusText = 'Rate this room, then the queue will advance.';
      }
      queue.statusTone = 'default';
    } catch (error) {
      console.error('Failed to present Explore queue room.', error);
      queue.statusText = error instanceof Error ? error.message : 'Failed to load this room.';
      queue.statusTone = 'error';
    } finally {
      this.navigating = false;
      this.render();
    }
  }

  private getCurrentEntry(): RoomDiscoveryEntry | null {
    const queue = this.activeQueue;
    if (!queue || queue.index < 0 || queue.index >= queue.entries.length) {
      return null;
    }
    return queue.entries[queue.index] ?? null;
  }

  private render(): void {
    const queue = this.activeQueue;
    const current = this.getCurrentEntry();
    const complete = Boolean(queue && queue.index >= queue.entries.length);
    this.elements.bar?.classList.toggle('hidden', !queue);
    this.elements.bar?.setAttribute('aria-hidden', queue ? 'false' : 'true');
    if (!queue) {
      return;
    }

    this.elements.bar?.setAttribute('data-queue-mode', queue.mode);
    this.elements.bar?.setAttribute('data-queue-tone', queue.statusTone);
    if (this.elements.kicker) {
      this.elements.kicker.textContent = queue.mode === 'play' ? 'Play All' : 'Rate All';
    }
    if (this.elements.title) {
      this.elements.title.textContent = current
        ? current.roomTitle?.trim() || 'Untitled Level'
        : 'Queue Complete';
    }
    if (this.elements.meta) {
      const progress = complete
        ? `${queue.entries.length}/${queue.entries.length}`
        : `${queue.index + 1}/${queue.entries.length}`;
      const status = queue.statusText ? ` · ${queue.statusText}` : '';
      this.elements.meta.textContent = `${queue.sourceLabel} · ${progress}${status}`;
    }
    if (this.elements.currentButton) {
      this.elements.currentButton.textContent = queue.mode === 'play' ? 'Play' : 'Rate';
      this.elements.currentButton.disabled = this.navigating || complete;
    }
    if (this.elements.nextButton) {
      this.elements.nextButton.textContent =
        queue.index >= queue.entries.length - 1 ? 'Finish' : 'Next';
      this.elements.nextButton.disabled = this.navigating || complete;
    }
  }

  private clearAdvanceTimer(): void {
    if (this.advanceTimer === null) {
      return;
    }
    this.windowObj.clearTimeout(this.advanceTimer);
    this.advanceTimer = null;
  }

  private getDebugState(): unknown {
    const queue = this.activeQueue;
    return {
      active: Boolean(queue),
      mode: queue?.mode ?? null,
      index: queue?.index ?? null,
      count: queue?.entries.length ?? 0,
      currentRoomId: this.getCurrentEntry()?.roomId ?? null,
      navigating: this.navigating,
      statusText: queue?.statusText ?? null,
    };
  }
}

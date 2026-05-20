import Phaser from 'phaser';
import {
  POST_RUN_RATING_SUBMITTED_EVENT,
  type PostRunRatingSubmittedDetail,
} from '../../progression/postRunRatingEvents';
import { getActiveOverworldScene } from './sceneBridge';
import type { LeaderboardModalController } from './leaderboardModal';
import type { PlaylistIntroModalController } from './playlistIntroModal';
import type { WelcomeModalController } from './welcomeModal';
import {
  ROOM_SEQUENCE_START_EVENT,
  type RoomSequenceKind,
  type RoomSequenceMode,
  type RoomSequenceStartDetail,
} from './roomSequenceEvents';

type RoomSequenceElements = {
  hud: HTMLElement | null;
  kicker: HTMLElement | null;
  title: HTMLElement | null;
  meta: HTMLElement | null;
  currentButton: HTMLButtonElement | null;
  stopButton: HTMLButtonElement | null;
  restartButton: HTMLButtonElement | null;
  nextButton: HTMLButtonElement | null;
  commentButton: HTMLButtonElement | null;
};

type RoomSequenceStatusTone = 'default' | 'error' | 'done';

interface ActiveRoomSequence {
  mode: RoomSequenceMode;
  kind: RoomSequenceKind;
  entries: RoomSequenceStartDetail['entries'];
  sourceLabel: string;
  kickerLabel: string;
  index: number;
  statusText: string | null;
  statusTone: RoomSequenceStatusTone;
  forceGoalIntro: boolean;
  showDesktopControlsIntro: boolean;
}

type RoomSequenceDebugWindow = Window & {
  get_room_sequence_state?: () => unknown;
  get_explore_queue_state?: () => unknown;
};

export class RoomSequenceController {
  private readonly elements: RoomSequenceElements;
  private activeSequence: ActiveRoomSequence | null = null;
  private navigating = false;
  private advanceTimer: number | null = null;

  private readonly handleStartRequest = (event: Event): void => {
    const detail =
      event instanceof CustomEvent
        ? (event.detail as RoomSequenceStartDetail | undefined)
        : undefined;
    if (!detail || detail.entries.length === 0) {
      return;
    }
    void this.start(detail);
  };

  private readonly handleCurrentClick = (): void => {
    void this.presentCurrent();
  };

  private readonly handleStopClick = (): void => {
    this.stop();
  };

  private readonly handleRestartClick = (): void => {
    const sequence = this.activeSequence;
    if (!sequence || sequence.mode !== 'play' || this.navigating || this.isComplete()) {
      return;
    }
    void getActiveOverworldScene(this.game)?.restartCurrentRun?.();
  };

  private readonly handleNextClick = (): void => {
    void this.advance();
  };

  private readonly handleCommentClick = (): void => {
    const sequence = this.activeSequence;
    if (!sequence || sequence.mode !== 'play' || this.navigating || this.isComplete()) {
      return;
    }
    getActiveOverworldScene(this.game)?.openRoomCommentComposer?.();
  };

  private readonly handleRunRatingSubmitted = (event: Event): void => {
    const detail =
      event instanceof CustomEvent
        ? (event.detail as PostRunRatingSubmittedDetail | undefined)
        : undefined;
    const sequence = this.activeSequence;
    const current = this.getCurrentEntry();
    if (
      !detail ||
      !sequence ||
      !current ||
      detail.contentType !== 'room' ||
      detail.contentId !== current.roomId
    ) {
      return;
    }

    sequence.statusText =
      sequence.mode === 'rate'
        ? 'Saved. Loading the next room...'
        : 'Rating saved. Next room is ready.';
    sequence.statusTone = 'default';
    this.render();
    if (sequence.mode !== 'rate') {
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
    private readonly playlistIntroModal: PlaylistIntroModalController,
    private readonly welcomeModal: Pick<WelcomeModalController, 'close'>,
    private readonly doc: Document = document,
    private readonly windowObj: RoomSequenceDebugWindow = window,
  ) {
    this.elements = {
      hud: this.doc.getElementById('room-sequence-hud'),
      kicker: this.doc.getElementById('room-sequence-kicker'),
      title: this.doc.getElementById('room-sequence-title'),
      meta: this.doc.getElementById('room-sequence-meta'),
      currentButton: this.doc.getElementById('btn-room-sequence-current') as HTMLButtonElement | null,
      stopButton: this.doc.getElementById('btn-room-sequence-stop') as HTMLButtonElement | null,
      restartButton: this.doc.getElementById('btn-room-sequence-restart') as HTMLButtonElement | null,
      nextButton: this.doc.getElementById('btn-room-sequence-next') as HTMLButtonElement | null,
      commentButton: this.doc.getElementById('btn-room-sequence-comment') as HTMLButtonElement | null,
    };
  }

  init(): void {
    this.windowObj.addEventListener(ROOM_SEQUENCE_START_EVENT, this.handleStartRequest as EventListener);
    this.windowObj.addEventListener(POST_RUN_RATING_SUBMITTED_EVENT, this.handleRunRatingSubmitted as EventListener);
    this.elements.currentButton?.addEventListener('click', this.handleCurrentClick);
    this.elements.stopButton?.addEventListener('click', this.handleStopClick);
    this.elements.restartButton?.addEventListener('click', this.handleRestartClick);
    this.elements.nextButton?.addEventListener('click', this.handleNextClick);
    this.elements.commentButton?.addEventListener('click', this.handleCommentClick);
    this.windowObj.get_room_sequence_state = () => this.getDebugState();
    this.windowObj.get_explore_queue_state = () => this.getDebugState();
    this.render();
  }

  destroy(): void {
    this.windowObj.removeEventListener(ROOM_SEQUENCE_START_EVENT, this.handleStartRequest as EventListener);
    this.windowObj.removeEventListener(POST_RUN_RATING_SUBMITTED_EVENT, this.handleRunRatingSubmitted as EventListener);
    this.elements.currentButton?.removeEventListener('click', this.handleCurrentClick);
    this.elements.stopButton?.removeEventListener('click', this.handleStopClick);
    this.elements.restartButton?.removeEventListener('click', this.handleRestartClick);
    this.elements.nextButton?.removeEventListener('click', this.handleNextClick);
    this.elements.commentButton?.removeEventListener('click', this.handleCommentClick);
    this.clearAdvanceTimer();
    if (this.windowObj.get_room_sequence_state) {
      delete this.windowObj.get_room_sequence_state;
    }
    if (this.windowObj.get_explore_queue_state) {
      delete this.windowObj.get_explore_queue_state;
    }
    this.setSequenceActiveBodyFlag(false);
  }

  async start(detail: RoomSequenceStartDetail): Promise<void> {
    this.clearAdvanceTimer();
    const sequence: ActiveRoomSequence = {
      mode: detail.mode,
      kind: detail.kind,
      entries: detail.entries.map((entry) => ({
        ...entry,
        roomCoordinates: { ...entry.roomCoordinates },
      })),
      sourceLabel: detail.sourceLabel,
      kickerLabel: detail.kickerLabel,
      index: 0,
      statusText: null,
      statusTone: 'default',
      forceGoalIntro: detail.forceGoalIntro === true,
      showDesktopControlsIntro: detail.showDesktopControlsIntro === true,
    };
    this.activeSequence = sequence;
    this.navigating = false;
    this.welcomeModal.close(true);
    this.render();

    if (
      sequence.kind === 'playlist' &&
      sequence.showDesktopControlsIntro &&
      this.shouldShowDesktopControlsIntro()
    ) {
      await this.playlistIntroModal.open({
        title: sequence.kickerLabel,
        sourceLabel: sequence.sourceLabel,
        entries: sequence.entries,
      });
      if (this.activeSequence !== sequence) {
        return;
      }
    }

    await this.presentCurrent();
  }

  stop(options: { returnToWorld?: boolean } = {}): void {
    const shouldReturnToWorld = options.returnToWorld ?? true;
    const wasPlaying = this.activeSequence?.mode === 'play';
    this.clearAdvanceTimer();
    this.activeSequence = null;
    this.navigating = false;
    this.render();

    if (shouldReturnToWorld && wasPlaying) {
      getActiveOverworldScene(this.game)?.returnToWorld?.();
    }
  }

  private async advance(): Promise<void> {
    const sequence = this.activeSequence;
    if (!sequence || this.navigating) {
      return;
    }

    if (sequence.index >= sequence.entries.length - 1) {
      sequence.index = sequence.entries.length;
      sequence.statusText = sequence.kind === 'playlist' ? 'Playlist complete.' : 'Queue complete.';
      sequence.statusTone = 'done';
      this.leaderboardModal.close();
      this.render();
      return;
    }

    sequence.index += 1;
    sequence.statusText = null;
    sequence.statusTone = 'default';
    this.render();
    await this.presentCurrent();
  }

  private async presentCurrent(): Promise<void> {
    const sequence = this.activeSequence;
    const entry = this.getCurrentEntry();
    if (!sequence || !entry || this.navigating) {
      return;
    }

    const scene = getActiveOverworldScene(this.game);
    if (!scene?.jumpToCoordinates) {
      sequence.statusText = 'The overworld is not ready yet.';
      sequence.statusTone = 'error';
      this.render();
      return;
    }

    this.navigating = true;
    sequence.statusText = sequence.mode === 'play' ? 'Loading room...' : 'Loading rating...';
    sequence.statusTone = 'default';
    this.render();

    try {
      await scene.jumpToCoordinates(entry.roomCoordinates);
      if (sequence.mode === 'play') {
        if (!scene.playSelectedRoom) {
          throw new Error('The room player is not ready yet.');
        }
        this.leaderboardModal.close();
        scene.playSelectedRoom({ forceGoalIntro: sequence.forceGoalIntro });
        sequence.statusText = 'Playing. Use Next for another room.';
      } else {
        await this.leaderboardModal.open('room');
        sequence.statusText = 'Rate this room, then the queue will advance.';
      }
      sequence.statusTone = 'default';
    } catch (error) {
      console.error('Failed to present room sequence entry.', error);
      sequence.statusText = error instanceof Error ? error.message : 'Failed to load this room.';
      sequence.statusTone = 'error';
    } finally {
      this.navigating = false;
      this.render();
    }
  }

  private getCurrentEntry(): RoomSequenceStartDetail['entries'][number] | null {
    const sequence = this.activeSequence;
    if (!sequence || sequence.index < 0 || sequence.index >= sequence.entries.length) {
      return null;
    }
    return sequence.entries[sequence.index] ?? null;
  }

  private render(): void {
    const sequence = this.activeSequence;
    const current = this.getCurrentEntry();
    const complete = this.isComplete();
    this.elements.hud?.classList.toggle('hidden', !sequence);
    this.elements.hud?.classList.toggle('active', Boolean(sequence));
    this.elements.hud?.setAttribute('aria-hidden', sequence ? 'false' : 'true');
    this.setSequenceActiveBodyFlag(Boolean(sequence));
    if (!sequence) {
      return;
    }

    this.elements.hud?.setAttribute('data-sequence-mode', sequence.mode);
    this.elements.hud?.setAttribute('data-sequence-tone', sequence.statusTone);
    if (this.elements.kicker) {
      this.elements.kicker.textContent = sequence.kickerLabel;
    }
    if (this.elements.title) {
      this.elements.title.textContent = current
        ? current.roomTitle?.trim() || 'Untitled Level'
        : sequence.kind === 'playlist'
          ? 'Playlist Complete'
          : 'Queue Complete';
    }
    if (this.elements.meta) {
      const progress = complete
        ? `${sequence.entries.length}/${sequence.entries.length}`
        : `${sequence.index + 1}/${sequence.entries.length}`;
      const status = sequence.statusText ? ` · ${sequence.statusText}` : '';
      this.elements.meta.textContent = `${sequence.sourceLabel} · ${progress}${status}`;
    }

    const playMode = sequence.mode === 'play';
    this.setButtonHidden(this.elements.currentButton, playMode);
    this.setButtonHidden(this.elements.restartButton, !playMode);
    this.setButtonHidden(this.elements.commentButton, !playMode);
    if (this.elements.currentButton) {
      this.elements.currentButton.textContent = sequence.mode === 'rate' ? 'Rate' : 'Play';
      this.elements.currentButton.disabled = this.navigating || complete;
    }
    if (this.elements.stopButton) {
      this.elements.stopButton.disabled = false;
    }
    if (this.elements.restartButton) {
      this.elements.restartButton.disabled = this.navigating || complete;
    }
    if (this.elements.nextButton) {
      this.elements.nextButton.textContent =
        sequence.index >= sequence.entries.length - 1 ? 'Finish' : 'Next';
      this.elements.nextButton.disabled = this.navigating || complete;
    }
    if (this.elements.commentButton) {
      this.elements.commentButton.disabled = this.navigating || complete;
    }
  }

  private isComplete(): boolean {
    return Boolean(
      this.activeSequence &&
      this.activeSequence.index >= this.activeSequence.entries.length,
    );
  }

  private shouldShowDesktopControlsIntro(): boolean {
    const deviceClass = this.doc.body.dataset.deviceClass;
    if (deviceClass === 'phone') {
      return false;
    }
    if (deviceClass === 'desktop') {
      return true;
    }
    return this.windowObj.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? true;
  }

  private setButtonHidden(button: HTMLButtonElement | null, hidden: boolean): void {
    button?.classList.toggle('hidden', hidden);
  }

  private setSequenceActiveBodyFlag(active: boolean): void {
    this.doc.body.dataset.roomSequenceActive = active ? 'true' : 'false';
  }

  private clearAdvanceTimer(): void {
    if (this.advanceTimer === null) {
      return;
    }
    this.windowObj.clearTimeout(this.advanceTimer);
    this.advanceTimer = null;
  }

  private getDebugState(): unknown {
    const sequence = this.activeSequence;
    return {
      active: Boolean(sequence),
      kind: sequence?.kind ?? null,
      mode: sequence?.mode ?? null,
      index: sequence?.index ?? null,
      count: sequence?.entries.length ?? 0,
      currentRoomId: this.getCurrentEntry()?.roomId ?? null,
      navigating: this.navigating,
      statusText: sequence?.statusText ?? null,
    };
  }
}

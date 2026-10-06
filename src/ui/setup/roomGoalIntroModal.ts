import type { RoomSnapshot } from '../../persistence/roomRepository';
import { createModalLifecycle } from './modalLifecycle';
import { DEVICE_LAYOUT_CHANGED_EVENT } from '../deviceLayout';
import { getPlayControlsStorage, hasSeenPlayControls, markPlayControlsSeen, renderPlayControlHints } from './playControlHints';
import { GhostRaceIntro } from './ghostRaceIntro';
import type { RunGhost, GhostRaceChoice } from '../../runs/ghostRace';

const ROOM_GOAL_INTRO_SEEN_STORAGE_PREFIX = 'everybodys-platformer:room-goal-intro-seen:v1:';

type RoomGoalIntroElements = {
  modal: HTMLElement | null;
  title: HTMLElement | null;
  meta: HTMLElement | null;
  body: HTMLElement | null;
  copy: HTMLElement | null;
  controls: HTMLElement | null;
  startButton: HTMLButtonElement | null;
};

type RoomGoalIntroOpenOptions = {
  room: RoomSnapshot;
  titleText: string;
  metaText: string;
  bodyText: string;
  signedIn?: boolean;
  onStart: (ghost?: RunGhost | null, choice?: GhostRaceChoice) => void;
};

let activeRoomGoalIntroModalController: RoomGoalIntroModalController | null = null;

export function getRoomGoalIntroModalController(): RoomGoalIntroModalController | null {
  return activeRoomGoalIntroModalController;
}

export class RoomGoalIntroModalController {
  private readonly elements: RoomGoalIntroElements;
  private pendingStart: RoomGoalIntroOpenOptions['onStart'] | null = null;
  private readonly ghosts: GhostRaceIntro;
  private activeSeenKey: string | null = null;
  private readonly lifecycle: ReturnType<typeof createModalLifecycle>;

  private readonly handleStartClick = () => {
    if (this.isOpen()) this.finish(true, true);
  };
  private readonly handleLayoutChange = () => renderPlayControlHints(this.elements.controls, this.doc);

  constructor(
    private readonly storage: Storage | null = getPlayControlsStorage(),
    private readonly doc: Document = document,
    private readonly windowObj: Window = window,
  ) {
    ensureRoomGoalIntroModalMarkup(this.doc);
    this.ghosts = new GhostRaceIntro(this.doc);
    this.elements = {
      modal: this.doc.getElementById('room-goal-intro-modal'),
      title: this.doc.getElementById('room-goal-intro-title'),
      meta: this.doc.getElementById('room-goal-intro-meta'),
      body: this.doc.getElementById('room-goal-intro-body'),
      copy: this.doc.getElementById('room-goal-intro-copy'),
      controls: this.doc.getElementById('room-goal-intro-controls'),
      startButton: this.doc.getElementById('btn-room-goal-intro-start') as HTMLButtonElement | null,
    };
    this.lifecycle = createModalLifecycle({
      doc: this.doc,
      modal: this.elements.modal,
      onClose: () => this.finish(true, true),
    });
  }

  init(): void {
    activeRoomGoalIntroModalController = this;
    this.elements.startButton?.addEventListener('click', this.handleStartClick);
    this.windowObj.addEventListener(DEVICE_LAYOUT_CHANGED_EVENT, this.handleLayoutChange);
    this.handleLayoutChange();
    this.lifecycle.attach();
  }

  destroy(): void {
    if (activeRoomGoalIntroModalController === this) {
      activeRoomGoalIntroModalController = null;
    }
    this.elements.startButton?.removeEventListener('click', this.handleStartClick);
    this.windowObj.removeEventListener(DEVICE_LAYOUT_CHANGED_EVENT, this.handleLayoutChange);
    this.lifecycle.detach();
    this.finish(false, false);
    this.ghosts.destroy();
  }

  isOpen(): boolean {
    return this.lifecycle.isOpen();
  }

  shouldShowForRoom(room: RoomSnapshot | null): boolean {
    if (!room) return false;
    return !hasSeenPlayControls(this.storage, this.doc)
      || (room.status === 'published' && Boolean(room.goal) && !this.hasSeenRoom(room));
  }

  openControlsIfNeeded(onStart: () => void): boolean {
    if (!this.elements.modal || hasSeenPlayControls(this.storage, this.doc)) return false;
    if (this.isOpen()) return true;
    this.pendingStart = onStart;
    this.ghosts.close();
    this.activeSeenKey = null;
    this.show('How to play', '', '');
    return true;
  }

  open(options: RoomGoalIntroOpenOptions): void {
    if (!this.elements.modal) {
      options.onStart();
      return;
    }

    this.pendingStart = options.onStart;
    this.ghosts.open(options.room, options.signedIn ?? false);
    this.activeSeenKey = options.room.status === 'published' && options.room.goal
      ? this.getSeenKey(options.room)
      : null;
    this.show(options.titleText, options.metaText, options.bodyText);
  }

  private show(title: string, meta: string, body: string): void {
    this.setText(this.elements.title, title);
    this.setText(this.elements.meta, meta);
    this.setText(this.elements.body, body);
    this.elements.meta?.classList.toggle('hidden', !meta);
    this.elements.copy?.classList.toggle('hidden', !body);
    this.handleLayoutChange();
    this.lifecycle.show();
    this.elements.startButton?.focus({ preventScroll: true });
  }

  forceClose(): void {
    this.finish(false, false);
  }

  private finish(markSeen: boolean, triggerStart: boolean): void {
    this.lifecycle.hide();

    const seenKey = this.activeSeenKey;
    const startHandler = this.pendingStart;
    const race = triggerStart ? this.ghosts.take() : null;
    if (!triggerStart) this.ghosts.close();
    this.activeSeenKey = null;
    this.pendingStart = null;

    if (markSeen && seenKey) {
      try {
        this.storage?.setItem(seenKey, '1');
      } catch {
        // Ignore storage failures and continue starting the run.
      }
    }

    if (triggerStart) {
      if (markSeen && startHandler) markPlayControlsSeen(this.storage, this.doc);
      startHandler?.(race?.ghost, race?.choice);
    }
  }

  private hasSeenRoom(room: RoomSnapshot): boolean {
    try {
      return this.storage?.getItem(this.getSeenKey(room)) === '1';
    } catch {
      return false;
    }
  }

  private getSeenKey(room: RoomSnapshot): string {
    return `${ROOM_GOAL_INTRO_SEEN_STORAGE_PREFIX}${room.id}:${room.version}`;
  }

  private setText(element: HTMLElement | null, value: string): void {
    if (element) {
      element.textContent = value;
    }
  }
}

function ensureRoomGoalIntroModalMarkup(doc: Document): void {
  if (doc.getElementById('room-goal-intro-modal')) return;
  doc.body.insertAdjacentHTML('beforeend', `
    <div id="room-goal-intro-modal" class="history-modal hidden" aria-hidden="true">
      <div class="history-modal-panel room-goal-intro-modal-panel" role="dialog" aria-modal="true" aria-labelledby="room-goal-intro-title">
        <div class="history-modal-header room-goal-intro-header">
          <div class="history-modal-title-group">
            <h2 id="room-goal-intro-title" class="history-modal-title">Reach Exit</h2>
            <div id="room-goal-intro-meta" class="history-modal-meta">Collect 3</div>
          </div>
        </div>
        <div id="room-goal-intro-copy" class="room-goal-intro-copy">
          <div id="room-goal-intro-body" class="room-goal-intro-body">Reach the exit as fast as you can!</div>
        </div>
        <div id="room-goal-intro-controls" class="play-intro-controls" aria-label="Play controls"></div>
        <div id="room-ghost-race" class="room-ghost-race hidden">
          <label for="room-ghost-race-choice">Ghost race</label>
          <select id="room-ghost-race-choice">
            <option value="off">No ghost</option>
            <option value="top" disabled>Race #1 · unavailable</option>
            <option value="personal" disabled>Race my best · unavailable</option>
          </select>
          <div id="room-ghost-race-status" role="status"></div>
        </div>
        <div class="room-goal-intro-actions">
          <button id="btn-room-goal-intro-start" class="bar-btn" type="button">Start</button>
        </div>
      </div>
    </div>
  `);
}

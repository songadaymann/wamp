import type { RoomSnapshot } from '../../persistence/roomRepository';
import { createModalLifecycle } from './modalLifecycle';

const ROOM_GOAL_INTRO_SEEN_STORAGE_PREFIX = 'everybodys-platformer:room-goal-intro-seen:v1:';

type RoomGoalIntroElements = {
  modal: HTMLElement | null;
  title: HTMLElement | null;
  meta: HTMLElement | null;
  body: HTMLElement | null;
  startButton: HTMLButtonElement | null;
};

type RoomGoalIntroOpenOptions = {
  room: RoomSnapshot;
  titleText: string;
  metaText: string;
  bodyText: string;
  onStart: () => void;
};

let activeRoomGoalIntroModalController: RoomGoalIntroModalController | null = null;

export function getRoomGoalIntroModalController(): RoomGoalIntroModalController | null {
  return activeRoomGoalIntroModalController;
}

export class RoomGoalIntroModalController {
  private readonly elements: RoomGoalIntroElements;
  private pendingStart: (() => void) | null = null;
  private activeSeenKey: string | null = null;
  private readonly lifecycle: ReturnType<typeof createModalLifecycle>;

  private readonly handleStartClick = () => {
    this.finish(true, true);
  };

  constructor(
    private readonly storage: Storage = window.localStorage,
    private readonly doc: Document = document,
  ) {
    ensureRoomGoalIntroModalMarkup(this.doc);
    this.elements = {
      modal: this.doc.getElementById('room-goal-intro-modal'),
      title: this.doc.getElementById('room-goal-intro-title'),
      meta: this.doc.getElementById('room-goal-intro-meta'),
      body: this.doc.getElementById('room-goal-intro-body'),
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
    this.lifecycle.attach();
  }

  destroy(): void {
    if (activeRoomGoalIntroModalController === this) {
      activeRoomGoalIntroModalController = null;
    }
    this.elements.startButton?.removeEventListener('click', this.handleStartClick);
    this.lifecycle.detach();
    this.finish(false, false);
  }

  isOpen(): boolean {
    return this.lifecycle.isOpen();
  }

  shouldShowForRoom(room: RoomSnapshot | null): boolean {
    if (!room || room.status !== 'published' || !room.goal) {
      return false;
    }

    return !this.hasSeenRoom(room);
  }

  open(options: RoomGoalIntroOpenOptions): void {
    if (!this.elements.modal) {
      options.onStart();
      return;
    }

    this.pendingStart = options.onStart;
    this.activeSeenKey = this.getSeenKey(options.room);
    this.setText(this.elements.title, options.titleText);
    this.setText(this.elements.meta, options.metaText);
    this.setText(this.elements.body, options.bodyText);
    this.lifecycle.show();
  }

  forceClose(): void {
    this.finish(false, false);
  }

  private finish(markSeen: boolean, triggerStart: boolean): void {
    this.lifecycle.hide();

    const seenKey = this.activeSeenKey;
    const startHandler = this.pendingStart;
    this.activeSeenKey = null;
    this.pendingStart = null;

    if (markSeen && seenKey) {
      try {
        this.storage.setItem(seenKey, '1');
      } catch {
        // Ignore storage failures and continue starting the run.
      }
    }

    if (triggerStart) {
      startHandler?.();
    }
  }

  private hasSeenRoom(room: RoomSnapshot): boolean {
    try {
      return this.storage.getItem(this.getSeenKey(room)) === '1';
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
            <div class="history-modal-kicker">Room Goal</div>
            <h2 id="room-goal-intro-title" class="history-modal-title">Reach Exit</h2>
            <div id="room-goal-intro-meta" class="history-modal-meta">Collect 3</div>
          </div>
        </div>
        <div class="room-goal-intro-copy">
          <div id="room-goal-intro-body" class="room-goal-intro-body">Reach the exit as fast as you can!</div>
        </div>
        <div class="room-goal-intro-actions">
          <button id="btn-room-goal-intro-start" class="bar-btn" type="button">Start</button>
        </div>
      </div>
    </div>
  `);
}

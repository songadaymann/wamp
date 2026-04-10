import type { RoomSnapshot } from '../../persistence/roomRepository';

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

  private readonly handleStartClick = () => {
    this.finish(true, true);
  };

  private readonly handleBackdropClick = (event: Event) => {
    if (event.target === this.elements.modal) {
      this.finish(true, true);
    }
  };

  private readonly handleDocumentKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !this.isOpen()) {
      return;
    }

    this.finish(true, true);
  };

  constructor(
    private readonly storage: Storage = window.localStorage,
    private readonly doc: Document = document,
  ) {
    this.elements = {
      modal: this.doc.getElementById('room-goal-intro-modal'),
      title: this.doc.getElementById('room-goal-intro-title'),
      meta: this.doc.getElementById('room-goal-intro-meta'),
      body: this.doc.getElementById('room-goal-intro-body'),
      startButton: this.doc.getElementById('btn-room-goal-intro-start') as HTMLButtonElement | null,
    };
  }

  init(): void {
    activeRoomGoalIntroModalController = this;
    this.elements.startButton?.addEventListener('click', this.handleStartClick);
    this.elements.modal?.addEventListener('click', this.handleBackdropClick);
    this.doc.addEventListener('keydown', this.handleDocumentKeydown);
  }

  destroy(): void {
    if (activeRoomGoalIntroModalController === this) {
      activeRoomGoalIntroModalController = null;
    }
    this.elements.startButton?.removeEventListener('click', this.handleStartClick);
    this.elements.modal?.removeEventListener('click', this.handleBackdropClick);
    this.doc.removeEventListener('keydown', this.handleDocumentKeydown);
    this.finish(false, false);
  }

  isOpen(): boolean {
    return Boolean(this.elements.modal && !this.elements.modal.classList.contains('hidden'));
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
    this.elements.modal.classList.remove('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'false');
  }

  forceClose(): void {
    this.finish(false, false);
  }

  private finish(markSeen: boolean, triggerStart: boolean): void {
    if (this.elements.modal) {
      this.elements.modal.classList.add('hidden');
      this.elements.modal.setAttribute('aria-hidden', 'true');
    }

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

import type { RoomSequenceEntry } from './roomSequenceEvents';

type PlaylistIntroElements = {
  modal: HTMLElement | null;
  title: HTMLElement | null;
  meta: HTMLElement | null;
  levels: HTMLElement | null;
  startButton: HTMLButtonElement | null;
};

export type PlaylistIntroDetail = {
  title: string;
  sourceLabel: string;
  entries: RoomSequenceEntry[];
};

export class PlaylistIntroModalController {
  private readonly elements: PlaylistIntroElements;
  private pendingResolve: (() => void) | null = null;

  private readonly handleStartClick = () => {
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

  constructor(private readonly doc: Document = document) {
    this.elements = {
      modal: this.doc.getElementById('playlist-intro-modal'),
      title: this.doc.getElementById('playlist-intro-title'),
      meta: this.doc.getElementById('playlist-intro-meta'),
      levels: this.doc.getElementById('playlist-intro-levels'),
      startButton: this.doc.getElementById('btn-playlist-intro-start') as HTMLButtonElement | null,
    };
  }

  init(): void {
    this.elements.startButton?.addEventListener('click', this.handleStartClick);
    this.elements.modal?.addEventListener('click', this.handleBackdropClick);
    this.doc.addEventListener('keydown', this.handleDocumentKeydown);
  }

  destroy(): void {
    this.elements.startButton?.removeEventListener('click', this.handleStartClick);
    this.elements.modal?.removeEventListener('click', this.handleBackdropClick);
    this.doc.removeEventListener('keydown', this.handleDocumentKeydown);
    this.close();
  }

  open(detail: PlaylistIntroDetail): Promise<void> {
    if (!this.elements.modal) {
      return Promise.resolve();
    }

    this.render(detail);
    this.elements.modal.classList.remove('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'false');
    this.elements.startButton?.focus({ preventScroll: true });

    return new Promise((resolve) => {
      this.pendingResolve = resolve;
    });
  }

  close(): void {
    if (!this.elements.modal) {
      return;
    }

    this.elements.modal.classList.add('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'true');
    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    resolve?.();
  }

  private render(detail: PlaylistIntroDetail): void {
    if (this.elements.title) {
      this.elements.title.textContent = detail.title.trim() || 'Playlist';
    }
    if (this.elements.meta) {
      const count = detail.entries.length;
      this.elements.meta.textContent = `${detail.sourceLabel} · ${count} ${count === 1 ? 'level' : 'levels'}`;
    }
    if (!this.elements.levels) {
      return;
    }

    this.elements.levels.replaceChildren();
    detail.entries.forEach((entry, index) => {
      this.elements.levels?.appendChild(this.createLevelCard(entry, index));
    });
  }

  private createLevelCard(entry: RoomSequenceEntry, index: number): HTMLElement {
    const card = this.doc.createElement('div');
    card.className = 'playlist-intro-level-card';

    const number = this.doc.createElement('div');
    number.className = 'playlist-intro-level-number';
    number.textContent = String(index + 1).padStart(2, '0');

    const copy = this.doc.createElement('div');
    copy.className = 'playlist-intro-level-copy';

    const title = this.doc.createElement('div');
    title.className = 'playlist-intro-level-title';
    title.textContent = entry.roomTitle?.trim() || `Room ${entry.roomCoordinates.x},${entry.roomCoordinates.y}`;

    const meta = this.doc.createElement('div');
    meta.className = 'playlist-intro-level-meta';
    meta.textContent = `${entry.roomCoordinates.x},${entry.roomCoordinates.y} · v${entry.roomVersion}`;

    copy.append(title, meta);
    card.append(number, copy);
    return card;
  }
}

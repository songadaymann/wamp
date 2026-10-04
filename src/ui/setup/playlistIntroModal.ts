import type { RoomSequenceEntry } from './roomSequenceEvents';
import { createModalLifecycle } from './modalLifecycle';
import { DEVICE_LAYOUT_CHANGED_EVENT } from '../deviceLayout';
import { getPlayControlsStorage, markPlayControlsSeen, renderPlayControlHints } from './playControlHints';

type PlaylistIntroElements = {
  modal: HTMLElement | null;
  title: HTMLElement | null;
  meta: HTMLElement | null;
  levels: HTMLElement | null;
  controls: HTMLElement | null;
  startButton: HTMLButtonElement | null;
};

export type PlaylistIntroDetail = {
  title: string;
  sourceLabel: string;
  entries: RoomSequenceEntry[];
};

export class PlaylistIntroModalController {
  private readonly elements: PlaylistIntroElements;
  private readonly lifecycle: ReturnType<typeof createModalLifecycle>;
  private pendingResolve: (() => void) | null = null;

  private readonly handleStartClick = () => {
    markPlayControlsSeen(getPlayControlsStorage(), this.doc);
    this.close();
  };
  private readonly handleLayoutChange = () => renderPlayControlHints(this.elements.controls, this.doc);

  constructor(private readonly doc: Document = document, private readonly windowObj: Window = window) {
    this.elements = {
      modal: this.doc.getElementById('playlist-intro-modal'),
      title: this.doc.getElementById('playlist-intro-title'),
      meta: this.doc.getElementById('playlist-intro-meta'),
      levels: this.doc.getElementById('playlist-intro-levels'),
      controls: this.doc.getElementById('playlist-intro-controls'),
      startButton: this.doc.getElementById('btn-playlist-intro-start') as HTMLButtonElement | null,
    };
    this.lifecycle = createModalLifecycle({
      doc: this.doc,
      modal: this.elements.modal,
      onClose: () => this.close(),
    });
  }

  init(): void {
    this.elements.startButton?.addEventListener('click', this.handleStartClick);
    this.windowObj.addEventListener(DEVICE_LAYOUT_CHANGED_EVENT, this.handleLayoutChange);
    this.lifecycle.attach();
  }

  destroy(): void {
    this.elements.startButton?.removeEventListener('click', this.handleStartClick);
    this.windowObj.removeEventListener(DEVICE_LAYOUT_CHANGED_EVENT, this.handleLayoutChange);
    this.lifecycle.detach();
    this.close();
  }

  open(detail: PlaylistIntroDetail): Promise<void> {
    if (!this.elements.modal) {
      return Promise.resolve();
    }

    this.render(detail);
    this.handleLayoutChange();
    this.lifecycle.show();
    this.elements.startButton?.focus({ preventScroll: true });

    return new Promise((resolve) => {
      this.pendingResolve = resolve;
    });
  }

  close(): void {
    if (!this.lifecycle.hide()) {
      return;
    }

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
    if (entry.expandedRoomId && entry.expandedRoomCellCount && entry.expandedRoomCellCount > 1) {
      const versionText =
        typeof entry.expandedRoomVersion === 'number'
          ? `v${entry.expandedRoomVersion}`
          : `v${entry.roomVersion}`;
      meta.textContent =
        `${entry.expandedRoomCellCount} cells · ${versionText} · focus ${entry.roomCoordinates.x},${entry.roomCoordinates.y}`;
    } else {
      meta.textContent = `${entry.roomCoordinates.x},${entry.roomCoordinates.y} · v${entry.roomVersion}`;
    }

    copy.append(title, meta);
    card.append(number, copy);
    return card;
  }
}

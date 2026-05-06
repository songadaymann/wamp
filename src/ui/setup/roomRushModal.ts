import Phaser from 'phaser';
import type {
  RoomRushDifficulty,
  RoomRushStartRule,
} from '../../scenes/overworld/roomRushRuns';
import { getActiveOverworldScene } from './sceneBridge';

type RoomRushModalElements = {
  modal: HTMLElement | null;
  closeButton: HTMLButtonElement | null;
  status: HTMLElement | null;
  modeButtons: HTMLButtonElement[];
};

export class RoomRushModalController {
  private readonly elements: RoomRushModalElements;

  private readonly handleCloseClick = (): void => {
    this.close();
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

  constructor(
    private readonly game: Phaser.Game,
    private readonly doc: Document = document,
  ) {
    this.elements = {
      modal: this.doc.getElementById('room-rush-modal'),
      closeButton: this.doc.getElementById('btn-room-rush-close') as HTMLButtonElement | null,
      status: this.doc.getElementById('room-rush-status'),
      modeButtons: Array.from(
        this.doc.querySelectorAll<HTMLButtonElement>('[data-room-rush-difficulty][data-room-rush-start-rule]'),
      ),
    };
  }

  init(): void {
    this.elements.closeButton?.addEventListener('click', this.handleCloseClick);
    this.elements.modal?.addEventListener('click', this.handleBackdropClick);
    this.doc.addEventListener('keydown', this.handleDocumentKeydown);
    for (const button of this.elements.modeButtons) {
      button.addEventListener('click', () => {
        void this.startRunFromButton(button);
      });
    }
  }

  destroy(): void {
    this.elements.closeButton?.removeEventListener('click', this.handleCloseClick);
    this.elements.modal?.removeEventListener('click', this.handleBackdropClick);
    this.doc.removeEventListener('keydown', this.handleDocumentKeydown);
    this.close();
  }

  open(): void {
    if (!this.elements.modal) {
      return;
    }

    this.setStatus(null);
    this.elements.modal.classList.remove('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'false');
  }

  close(): void {
    if (!this.elements.modal) {
      return;
    }

    this.elements.modal.classList.add('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'true');
  }

  private async startRunFromButton(button: HTMLButtonElement): Promise<void> {
    const difficulty = this.parseDifficulty(button.dataset.roomRushDifficulty);
    const startRule = this.parseStartRule(button.dataset.roomRushStartRule);
    if (!difficulty || !startRule) {
      return;
    }

    const scene = getActiveOverworldScene(this.game);
    if (!scene?.startRoomRushRun) {
      this.setStatus('Room Rush is not available yet.');
      return;
    }

    this.setButtonsDisabled(true);
    this.setStatus('Starting Room Rush...');
    try {
      const started = await scene.startRoomRushRun({ difficulty, startRule });
      if (started) {
        this.close();
      } else {
        this.setStatus('Select an available room to start Room Rush.');
      }
    } finally {
      this.setButtonsDisabled(false);
    }
  }

  private setButtonsDisabled(disabled: boolean): void {
    for (const button of this.elements.modeButtons) {
      button.disabled = disabled;
    }
  }

  private setStatus(message: string | null): void {
    if (!this.elements.status) {
      return;
    }

    this.elements.status.textContent = message ?? '';
    this.elements.status.classList.toggle('hidden', !message);
  }

  private parseDifficulty(value: string | undefined): RoomRushDifficulty | null {
    return value === 'easy' || value === 'hard' ? value : null;
  }

  private parseStartRule(value: string | undefined): RoomRushStartRule | null {
    return value === 'selected' || value === 'origin' ? value : null;
  }
}

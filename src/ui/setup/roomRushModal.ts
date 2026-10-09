import Phaser from 'phaser';
import type {
  RoomRushDifficulty,
  RoomRushStartRule,
} from '../../scenes/overworld/roomRushRuns';
import { getActiveOverworldScene } from './sceneBridge';
import { DEVICE_LAYOUT_CHANGED_EVENT } from '../deviceLayout';
import { getPlayControlsStorage, markPlayControlsSeen, renderPlayControlHints } from './playControlHints';
import { loadWeeklyRoomRush } from '../../runs/weeklyRoomRushRepository';
import { getAuthDebugState } from '../../auth/client';
import { getActiveWorldId } from '../../worlds/clientContext';

type RoomRushModalElements = {
  modal: HTMLElement | null;
  closeButton: HTMLButtonElement | null;
  status: HTMLElement | null;
  controls: HTMLElement | null;
  modeButtons: HTMLButtonElement[];
  weeklyButton: HTMLButtonElement | null;
  weeklySummary: HTMLElement | null;
};

export class RoomRushModalController {
  private readonly elements: RoomRushModalElements;
  private weeklyAvailable = false;
  private weeklyGeneration = 0;
  private readonly handleMenuOpen = (): void => {
    if (this.doc.body.dataset.appMode !== 'world') return;
    this.doc.getElementById('auth-panel')?.classList.remove('menu-open');
    this.open();
  };
  private readonly handleLayoutChange = () => renderPlayControlHints(this.elements.controls, this.doc);

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
    private readonly windowObj: Window = window,
  ) {
    this.elements = {
      modal: this.doc.getElementById('room-rush-modal'),
      closeButton: this.doc.getElementById('btn-room-rush-close') as HTMLButtonElement | null,
      status: this.doc.getElementById('room-rush-status'),
      controls: this.doc.getElementById('room-rush-controls'),
      weeklyButton: this.doc.getElementById('btn-room-rush-weekly') as HTMLButtonElement | null,
      weeklySummary: this.doc.getElementById('room-rush-weekly-summary'),
      modeButtons: Array.from(
        this.doc.querySelectorAll<HTMLButtonElement>('[data-room-rush-difficulty][data-room-rush-start-rule]'),
      ),
    };
  }

  init(): void {
    this.doc.getElementById('btn-menu-room-rush')?.addEventListener('click', this.handleMenuOpen);
    this.elements.closeButton?.addEventListener('click', this.handleCloseClick);
    this.elements.modal?.addEventListener('click', this.handleBackdropClick);
    this.doc.addEventListener('keydown', this.handleDocumentKeydown);
    this.windowObj.addEventListener(DEVICE_LAYOUT_CHANGED_EVENT, this.handleLayoutChange);
    for (const button of this.elements.modeButtons) {
      button.addEventListener('click', () => {
        void this.startRunFromButton(button);
      });
    }
  }

  destroy(): void {
    this.doc.getElementById('btn-menu-room-rush')?.removeEventListener('click', this.handleMenuOpen);
    this.elements.closeButton?.removeEventListener('click', this.handleCloseClick);
    this.elements.modal?.removeEventListener('click', this.handleBackdropClick);
    this.doc.removeEventListener('keydown', this.handleDocumentKeydown);
    this.windowObj.removeEventListener(DEVICE_LAYOUT_CHANGED_EVENT, this.handleLayoutChange);
    this.close();
  }

  open(): void {
    if (!this.elements.modal) {
      return;
    }

    this.setStatus(null);
    this.handleLayoutChange();
    this.elements.modal.classList.remove('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'false');
    void this.refreshWeekly();
  }

  close(): void {
    this.weeklyGeneration += 1;
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
        markPlayControlsSeen(getPlayControlsStorage(), this.doc);
        this.close();
      } else {
        this.setStatus(startRule === 'weekly' ? 'Weekly Rush could not start. Reload and retry; its room or availability may have changed.' : 'Select an available room to start Room Rush.');
      }
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : 'Room Rush could not start. Please retry.');
    } finally {
      this.setButtonsDisabled(false);
    }
  }

  private setButtonsDisabled(disabled: boolean): void {
    for (const button of this.elements.modeButtons) {
      button.disabled = disabled || (button === this.elements.weeklyButton && !this.weeklyAvailable);
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
    return value === 'selected' || value === 'origin' || value === 'weekly' ? value : null;
  }

  private async refreshWeekly(): Promise<void> {
    const generation = ++this.weeklyGeneration;
    this.weeklyAvailable = false;
    if (this.elements.weeklyButton) this.elements.weeklyButton.disabled = true;
    const summary = this.elements.weeklySummary;
    if (!summary) return;
    if (getActiveWorldId()) { summary.textContent = 'Weekly Room Rush takes place in Prime.'; return; }
    summary.textContent = 'Loading this week’s Rush…';
    try {
      const weekly = await loadWeeklyRoomRush();
      if (generation !== this.weeklyGeneration) return;
      this.weeklyAvailable = Boolean(weekly.pick?.available);
      const pick = weekly.pick;
      const winners = weekly.previousWinners.map(entry => `${entry.userDisplayName} (${entry.uniqueRooms} rooms)`).join(', ');
      summary.textContent = [pick?.available
        ? `${pick.title} · ${pick.roomId} · death ends the run. ${getAuthDebugState().authenticated ? 'Your best counts on this week’s leaderboard.' : 'Guest practice. Sign in before starting to join the leaderboard.'}`
        : pick?.unavailableReason ?? 'This week’s Rush room has not been chosen yet.',
        'Resets Monday at 00:00 UTC.', winners ? `Last week: ${winners}.` : 'No winners from last week yet.'].join(' ');
      if (this.elements.weeklyButton) this.elements.weeklyButton.disabled = !this.weeklyAvailable;
    } catch (error) {
      if (generation === this.weeklyGeneration) summary.textContent = error instanceof Error ? error.message : 'Weekly Rush could not load. Close and retry.';
    }
  }
}

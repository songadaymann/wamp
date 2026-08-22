import Phaser from 'phaser';
import { AUTH_STATE_CHANGED_EVENT, getAuthDebugState } from '../../auth/client';
import {
  createDefaultRoomSnapshot,
  createRoomRepository,
  type RoomCoordinates,
  type RoomRepository,
} from '../../persistence/roomRepository';
import type { WorldRoomSummary } from '../../persistence/worldModel';
import type { WorldRepository } from '../../persistence/worldRepository';
import { createWorldRepository } from '../../persistence/worldRepository';
import { APP_READY_EVENT, isAppReady, isBusyOverlayVisible } from '../appFeedback';
import { getActiveOverworldScene } from './sceneBridge';
import { getGameSettings, updateGameSettings } from '../../settings/userSettings';

const WELCOME_MODAL_SEEN_STORAGE_KEY = 'wamp_welcome_modal_seen_v1';
export const REQUEST_BUILDER_MODE_EVENT = 'wamp:request-builder-mode';
const WELCOME_MODAL_AUTO_OPEN_DELAY_MS = 540;
const BUILD_FRONTIER_RADIUS = 24;
const WELCOME_PLAY_ROOM_COORDINATES: RoomCoordinates = { x: 1, y: 0 };

type WelcomeModalElements = {
  modal: HTMLElement | null;
  closeButton: HTMLButtonElement | null;
  exploreButton: HTMLButtonElement | null;
  playButton: HTMLButtonElement | null;
  buildButton: HTMLButtonElement | null;
  status: HTMLElement | null;
  authPanel: HTMLElement | null;
  laneBody: HTMLElement | null;
  builderChoice: HTMLElement | null;
  builderModeButtons: HTMLButtonElement[];
  builderBackButton: HTMLButtonElement | null;
};

export class WelcomeModalController {
  private readonly elements: WelcomeModalElements;
  private autoOpenTimer: number | null = null;
  private dismissed = false;
  private autoOpened = false;
  private pending = false;
  private builderChoiceContinuation: (() => void) | null = null;

  private readonly handleAppReady = () => {
    this.scheduleAutoOpen();
  };

  private readonly handleVisibilityChange = () => {
    if (this.doc.visibilityState !== 'visible') {
      return;
    }

    this.scheduleAutoOpen();
  };

  private readonly handleAuthStateChanged = () => {
    this.scheduleAutoOpen();
  };

  private readonly handleExploreClick = () => {
    this.close(true);
  };

  private readonly handlePlayClick = () => {
    void this.handlePlayAction();
  };

  private readonly handleBuildClick = () => {
    this.requestBuilderMode(() => void this.handleBuildAction());
  };

  private readonly handleBuilderModeRequest = (event: Event) => {
    const detail = (event as CustomEvent<{ onSelected?: () => void }>).detail;
    if (typeof detail?.onSelected === 'function') this.requestBuilderMode(detail.onSelected);
  };

  private readonly handleBuilderModeClick = (event: Event) => {
    const target = event.currentTarget;
    if (!(target instanceof HTMLButtonElement)) return;
    const builderMode = target.dataset.welcomeBuilderMode === 'advanced' ? 'advanced' : 'beginner';
    updateGameSettings({ builderMode });
    this.doc.body.dataset.builderMode = builderMode;
    const continuation = this.builderChoiceContinuation;
    this.builderChoiceContinuation = null;
    this.showBuilderChoice(false);
    continuation?.();
  };

  private readonly handleBuilderBackClick = () => this.showBuilderChoice(false);

  private readonly handleCloseClick = () => {
    this.close(true);
  };

  private readonly handleBackdropClick = (event: Event) => {
    if (event.target === this.elements.modal) {
      this.close(true);
    }
  };

  private readonly handleDocumentKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || this.elements.modal?.classList.contains('hidden')) {
      return;
    }

    this.close(true);
  };

  constructor(
    private readonly game: Phaser.Game,
    private readonly worldRepository: WorldRepository = createWorldRepository(),
    private readonly roomRepository: RoomRepository = createRoomRepository(),
    private readonly storage: Storage = window.localStorage,
    private readonly doc: Document = document,
    private readonly windowObj: Window = window,
  ) {
    this.elements = {
      modal: this.doc.getElementById('welcome-modal'),
      closeButton: this.doc.getElementById('btn-welcome-close') as HTMLButtonElement | null,
      exploreButton: this.doc.getElementById('btn-welcome-explore') as HTMLButtonElement | null,
      playButton: this.doc.getElementById('btn-welcome-play') as HTMLButtonElement | null,
      buildButton: this.doc.getElementById('btn-welcome-build') as HTMLButtonElement | null,
      status: this.doc.getElementById('welcome-modal-status'),
      authPanel: this.doc.getElementById('auth-panel'),
      laneBody: this.doc.querySelector('#welcome-modal .welcome-modal-body'),
      builderChoice: this.doc.getElementById('welcome-builder-choice'),
      builderModeButtons: Array.from(this.doc.querySelectorAll<HTMLButtonElement>('[data-welcome-builder-mode]')),
      builderBackButton: this.doc.getElementById('btn-welcome-builder-back') as HTMLButtonElement | null,
    };
  }

  init(): void {
    this.dismissed = this.readDismissedState();
    this.elements.closeButton?.addEventListener('click', this.handleCloseClick);
    this.elements.exploreButton?.addEventListener('click', this.handleExploreClick);
    this.elements.playButton?.addEventListener('click', this.handlePlayClick);
    this.elements.buildButton?.addEventListener('click', this.handleBuildClick);
    for (const button of this.elements.builderModeButtons) button.addEventListener('click', this.handleBuilderModeClick);
    this.elements.builderBackButton?.addEventListener('click', this.handleBuilderBackClick);
    this.elements.modal?.addEventListener('click', this.handleBackdropClick);
    this.doc.addEventListener('keydown', this.handleDocumentKeydown);
    this.doc.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.windowObj.addEventListener(APP_READY_EVENT, this.handleAppReady as EventListener);
    this.windowObj.addEventListener(AUTH_STATE_CHANGED_EVENT, this.handleAuthStateChanged as EventListener);
    this.windowObj.addEventListener(REQUEST_BUILDER_MODE_EVENT, this.handleBuilderModeRequest as EventListener);

    if (isAppReady()) {
      this.scheduleAutoOpen();
    }
  }

  destroy(): void {
    this.clearAutoOpenTimer();
    this.elements.closeButton?.removeEventListener('click', this.handleCloseClick);
    this.elements.exploreButton?.removeEventListener('click', this.handleExploreClick);
    this.elements.playButton?.removeEventListener('click', this.handlePlayClick);
    this.elements.buildButton?.removeEventListener('click', this.handleBuildClick);
    for (const button of this.elements.builderModeButtons) button.removeEventListener('click', this.handleBuilderModeClick);
    this.elements.builderBackButton?.removeEventListener('click', this.handleBuilderBackClick);
    this.elements.modal?.removeEventListener('click', this.handleBackdropClick);
    this.doc.removeEventListener('keydown', this.handleDocumentKeydown);
    this.doc.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.windowObj.removeEventListener(APP_READY_EVENT, this.handleAppReady as EventListener);
    this.windowObj.removeEventListener(AUTH_STATE_CHANGED_EVENT, this.handleAuthStateChanged as EventListener);
    this.windowObj.removeEventListener(REQUEST_BUILDER_MODE_EVENT, this.handleBuilderModeRequest as EventListener);
    this.close(false);
  }

  open(): void {
    if (!this.elements.modal) {
      return;
    }

    this.clearAutoOpenTimer();
    this.autoOpened = true;
    this.pending = false;
    this.setStatus(null, false);
    this.setButtonsDisabled(false);
    this.showBuilderChoice(false);
    this.elements.authPanel?.classList.remove('menu-open');
    this.elements.modal.classList.remove('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'false');
  }

  close(persistDismissal: boolean): void {
    if (!this.elements.modal) {
      return;
    }

    this.pending = false;
    this.builderChoiceContinuation = null;
    this.setButtonsDisabled(false);
    this.setStatus(null, false);
    this.elements.modal.classList.add('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'true');

    if (persistDismissal) {
      this.dismissed = true;
      this.writeDismissedState();
    }
  }

  private scheduleAutoOpen(): void {
    if (!this.shouldContinueAutoOpenPolling()) {
      return;
    }

    this.clearAutoOpenTimer();
    this.autoOpenTimer = this.windowObj.setTimeout(() => {
      this.autoOpenTimer = null;
      if (this.shouldAutoOpen()) {
        this.open();
        return;
      }

      if (this.shouldContinueAutoOpenPolling()) {
        this.scheduleAutoOpen();
      }
    }, WELCOME_MODAL_AUTO_OPEN_DELAY_MS);
  }

  private clearAutoOpenTimer(): void {
    if (this.autoOpenTimer === null) {
      return;
    }

    this.windowObj.clearTimeout(this.autoOpenTimer);
    this.autoOpenTimer = null;
  }

  private shouldContinueAutoOpenPolling(): boolean {
    return !this.dismissed && !this.autoOpened && this.doc.visibilityState === 'visible';
  }

  private shouldAutoOpen(): boolean {
    if (this.dismissed || this.autoOpened || this.pending) {
      return false;
    }

    if (this.doc.visibilityState !== 'visible') {
      return false;
    }

    if (this.doc.body.dataset.appMode !== 'world') {
      return false;
    }

    if (!getActiveOverworldScene(this.game)) {
      return false;
    }

    return !this.hasBlockingSurface();
  }

  private hasBlockingSurface(): boolean {
    if (isBusyOverlayVisible()) {
      return true;
    }

    return Array.from(this.doc.querySelectorAll<HTMLElement>('.history-modal')).some((element) => {
      if (element === this.elements.modal) {
        return false;
      }

      return !element.classList.contains('hidden');
    });
  }

  private async handlePlayAction(): Promise<void> {
    if (this.pending) {
      return;
    }

    this.pending = true;
    this.setButtonsDisabled(true);
    this.setStatus('Heading to a level...', false);

    try {
      const overworld = getActiveOverworldScene(this.game);
      if (!overworld?.jumpToCoordinates || !overworld.playSelectedRoom) {
        throw new Error('The overworld is not ready yet.');
      }

      this.close(true);
      await overworld.jumpToCoordinates(WELCOME_PLAY_ROOM_COORDINATES);
      overworld.playSelectedRoom();
    } catch (error) {
      console.error('Failed to launch welcome Play action', error);
      this.pending = false;
      this.setButtonsDisabled(false);
      this.setStatus(error instanceof Error ? error.message : 'Failed to start a level.', true);
    }
  }

  private async handleBuildAction(): Promise<void> {
    if (this.pending) {
      return;
    }

    const overworld = getActiveOverworldScene(this.game);
    if (!overworld?.jumpToCoordinates) {
      this.setStatus('The overworld is not ready yet.', true);
      return;
    }

    this.pending = true;
    this.setButtonsDisabled(true);
    this.setStatus('Finding an open room to build...', false);

    try {
      const centerCoordinates =
        overworld.getSelectedRoomContext?.().coordinates ?? { x: 0, y: 0 };
      const authState = getAuthDebugState();
      const targetRoom = authState.authenticated
        ? await this.pickRandomClaimableFrontierRoom(centerCoordinates)
        : await this.pickRandomFrontierRoom(centerCoordinates);

      if (!targetRoom) {
        throw new Error('No open frontier rooms are available nearby.');
      }

      if (authState.authenticated) {
        await this.roomRepository.saveDraft(
          createDefaultRoomSnapshot(targetRoom.id, targetRoom.coordinates)
        );
      }

      this.close(true);
      await overworld.jumpToCoordinates(targetRoom.coordinates);
      if (authState.authenticated) {
        overworld.editSelectedRoom?.();
      } else {
        overworld.buildSelectedRoom?.();
      }
    } catch (error) {
      console.error('Failed to launch welcome Build action', error);
      this.pending = false;
      this.setButtonsDisabled(false);
      this.setStatus(error instanceof Error ? error.message : 'Failed to open build mode.', true);
    }
  }

  private async pickRandomClaimableFrontierRoom(
    center: RoomCoordinates
  ): Promise<WorldRoomSummary | null> {
    const response = await this.worldRepository.loadClaimableFrontierWindow(center, BUILD_FRONTIER_RADIUS);
    return this.pickRandomRoomSummary(response.rooms.filter((room) => room.state === 'frontier'));
  }

  private async pickRandomFrontierRoom(center: RoomCoordinates): Promise<WorldRoomSummary | null> {
    const worldWindow = await this.worldRepository.loadWorldWindow(center, BUILD_FRONTIER_RADIUS);
    return this.pickRandomRoomSummary(worldWindow.rooms.filter((room) => room.state === 'frontier'));
  }

  private pickRandomRoomSummary(rooms: WorldRoomSummary[]): WorldRoomSummary | null {
    if (rooms.length === 0) {
      return null;
    }

    return rooms[Math.floor(Math.random() * rooms.length)] ?? null;
  }

  private setButtonsDisabled(disabled: boolean): void {
    this.elements.exploreButton?.toggleAttribute('disabled', disabled);
    this.elements.playButton?.toggleAttribute('disabled', disabled);
    this.elements.buildButton?.toggleAttribute('disabled', disabled);
    this.elements.closeButton?.toggleAttribute('disabled', disabled);
    for (const button of this.elements.builderModeButtons) button.toggleAttribute('disabled', disabled);
    this.elements.builderBackButton?.toggleAttribute('disabled', disabled);
  }

  private requestBuilderMode(continuation: () => void): void {
    if (getGameSettings().builderMode !== 'unselected') {
      continuation();
      return;
    }
    this.builderChoiceContinuation = continuation;
    this.open();
    this.showBuilderChoice(true);
  }

  private showBuilderChoice(visible: boolean): void {
    this.elements.laneBody?.classList.toggle('hidden', visible);
    this.elements.builderChoice?.classList.toggle('hidden', !visible);
  }

  private setStatus(message: string | null, isError: boolean): void {
    if (!this.elements.status) {
      return;
    }

    if (!message) {
      this.elements.status.textContent = '';
      this.elements.status.classList.add('hidden');
      this.elements.status.classList.remove('history-modal-error');
      return;
    }

    this.elements.status.textContent = message;
    this.elements.status.classList.remove('hidden');
    this.elements.status.classList.toggle('history-modal-error', isError);
  }

  private readDismissedState(): boolean {
    return this.shouldForceOpen() ? false : this.storage.getItem(WELCOME_MODAL_SEEN_STORAGE_KEY) === '1';
  }

  private writeDismissedState(): void {
    this.storage.setItem(WELCOME_MODAL_SEEN_STORAGE_KEY, '1');
  }

  private shouldForceOpen(): boolean {
    const value = new URLSearchParams(this.windowObj.location.search).get('welcome');
    if (!value) {
      return false;
    }

    return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  }
}

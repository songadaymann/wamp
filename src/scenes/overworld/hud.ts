export interface OverworldHudViewModel {
  saveStatusTone: 'default' | 'play-score' | 'challenge-active' | 'challenge-complete' | 'challenge-failed';
  jumpInputValue: string;
  selectedTitleText: string;
  selectedCoordinatesText: string;
  selectedStateText: string;
  selectedStateTone: 'published' | 'draft' | 'frontier' | 'empty';
  selectedMetaText: string;
  selectedMetaTone: 'default' | 'challenge' | 'draft' | 'frontier';
  statusText: string;
  leaderboardText: string;
  zoomLabelText: string;
  playButtonText: string;
  playButtonDisabled: boolean;
  playButtonActive: boolean;
  editButtonDisabled: boolean;
  buildButtonDisabled: boolean;
  roomCoordinatesText: string;
  cursorText: string;
  playersOnlineText: string;
  saveStatusText: string;
  bottomBarZoomText: string;
  goalPanelVisible: boolean;
  goalPanelTone: 'active' | 'complete' | 'failed';
  goalPanelRoomText: string;
  goalPanelGoalText: string;
  goalPanelTimerText: string;
  goalPanelProgressText: string;
}

export class OverworldHudBridge {
  private readonly hudRoot: HTMLElement | null;
  private readonly selectedTitleEl: HTMLElement | null;
  private readonly selectedCoordinatesEl: HTMLElement | null;
  private readonly selectedStateEl: HTMLElement | null;
  private readonly selectedMetaEl: HTMLElement | null;
  private readonly statusEl: HTMLElement | null;
  private readonly leaderboardEl: HTMLElement | null;
  private readonly playButton: HTMLButtonElement | null;
  private readonly editButton: HTMLButtonElement | null;
  private readonly buildButton: HTMLButtonElement | null;
  private readonly jumpInput: HTMLInputElement | null;
  private readonly zoomLabelEl: HTMLElement | null;
  private readonly roomCoordinatesEl: HTMLElement | null;
  private readonly separatorEl: HTMLElement | null;
  private readonly cursorEl: HTMLElement | null;
  private readonly playersOnlineEl: HTMLElement | null;
  private readonly saveStatusEl: HTMLElement | null;
  private readonly fitButton: HTMLElement | null;
  private readonly bottomBarZoomEl: HTMLElement | null;
  private readonly goalPanelEl: HTMLElement | null;
  private readonly goalPanelRoomEl: HTMLElement | null;
  private readonly goalPanelGoalEl: HTMLElement | null;
  private readonly goalPanelTimerEl: HTMLElement | null;
  private readonly goalPanelProgressEl: HTMLElement | null;
  private destroyed = false;

  constructor(private readonly doc: Document = document) {
    this.hudRoot = this.doc.getElementById('world-hud');
    this.selectedTitleEl = this.doc.getElementById('world-selected-title');
    this.selectedCoordinatesEl = this.doc.getElementById('world-selected-coords');
    this.selectedStateEl = this.doc.getElementById('world-selected-state');
    this.selectedMetaEl = this.doc.getElementById('world-selected-meta');
    this.statusEl = this.doc.getElementById('world-status');
    this.leaderboardEl = this.doc.getElementById('world-leaderboard');
    this.playButton = this.doc.getElementById('btn-world-play') as HTMLButtonElement | null;
    this.editButton = this.doc.getElementById('btn-world-edit') as HTMLButtonElement | null;
    this.buildButton = this.doc.getElementById('btn-world-build') as HTMLButtonElement | null;
    this.jumpInput = this.doc.getElementById('world-jump-input') as HTMLInputElement | null;
    this.zoomLabelEl = this.doc.getElementById('world-zoom-label');
    this.roomCoordinatesEl = this.doc.getElementById('room-coords');
    this.separatorEl = this.doc.querySelector('#bottom-bar .separator');
    this.cursorEl = this.doc.getElementById('cursor-coords');
    this.playersOnlineEl = this.doc.getElementById('world-online-count');
    this.saveStatusEl = this.doc.getElementById('room-save-status');
    this.fitButton = this.doc.getElementById('btn-fit-screen');
    this.bottomBarZoomEl = this.doc.getElementById('zoom-level');
    this.goalPanelEl = this.doc.getElementById('world-goal-panel');
    this.goalPanelRoomEl = this.doc.getElementById('world-goal-panel-room');
    this.goalPanelGoalEl = this.doc.getElementById('world-goal-panel-goal');
    this.goalPanelTimerEl = this.doc.getElementById('world-goal-panel-timer');
    this.goalPanelProgressEl = this.doc.getElementById('world-goal-panel-progress');
  }

  render(viewModel: OverworldHudViewModel): void {
    if (this.destroyed) {
      return;
    }

    this.hudRoot?.classList.remove('hidden');
    this.fitButton?.classList.remove('hidden');

    if (this.jumpInput && this.doc.activeElement !== this.jumpInput && this.jumpInput.value !== viewModel.jumpInputValue) {
      this.jumpInput.value = viewModel.jumpInputValue;
    }

    this.setText(this.selectedTitleEl, viewModel.selectedTitleText);
    this.setText(this.selectedCoordinatesEl, viewModel.selectedCoordinatesText);
    this.setText(this.selectedStateEl, viewModel.selectedStateText);
    this.setStateTone(viewModel.selectedStateTone);
    this.setText(this.selectedMetaEl, viewModel.selectedMetaText);
    this.setMetaTone(viewModel.selectedMetaTone);
    this.setText(this.statusEl, viewModel.statusText);
    this.setText(this.leaderboardEl, viewModel.leaderboardText);
    this.setText(this.zoomLabelEl, viewModel.zoomLabelText);
    this.setText(this.roomCoordinatesEl, viewModel.roomCoordinatesText);
    this.setText(this.cursorEl, viewModel.cursorText);
    this.setSeparatorVisible(Boolean(viewModel.roomCoordinatesText && viewModel.cursorText));
    this.setText(this.playersOnlineEl, viewModel.playersOnlineText);
    this.setText(this.saveStatusEl, viewModel.saveStatusText);
    this.setSaveStatusTone(viewModel.saveStatusTone);
    this.setText(this.bottomBarZoomEl, viewModel.bottomBarZoomText);
    this.setButton(this.playButton, viewModel.playButtonText, viewModel.playButtonDisabled);
    this.setActive(this.playButton, viewModel.playButtonActive);
    this.setDisabled(this.editButton, viewModel.editButtonDisabled);
    this.setDisabled(this.buildButton, viewModel.buildButtonDisabled);
    this.renderGoalPanel(viewModel);
  }

  destroy(): void {
    this.destroyed = true;
  }

  private setText(element: HTMLElement | null, text: string): void {
    if (element && element.textContent !== text) {
      element.textContent = text;
    }
  }

  private setDisabled(element: HTMLButtonElement | null, disabled: boolean): void {
    if (element && element.disabled !== disabled) {
      element.disabled = disabled;
    }
  }

  private setActive(element: HTMLElement | null, active: boolean): void {
    element?.classList.toggle('active', active);
  }

  private setButton(element: HTMLButtonElement | null, text: string, disabled: boolean): void {
    if (!element) {
      return;
    }

    if (element.textContent !== text) {
      element.textContent = text;
    }

    if (element.disabled !== disabled) {
      element.disabled = disabled;
    }
  }

  private setSaveStatusTone(
    tone: OverworldHudViewModel['saveStatusTone']
  ): void {
    if (!this.saveStatusEl) {
      return;
    }

    if (tone === 'default') {
      this.saveStatusEl.removeAttribute('data-overworld-tone');
      return;
    }

    this.saveStatusEl.setAttribute('data-overworld-tone', tone);
  }

  private setStateTone(
    tone: OverworldHudViewModel['selectedStateTone']
  ): void {
    if (!this.selectedStateEl) {
      return;
    }

    this.selectedStateEl.setAttribute('data-world-state-tone', tone);
  }

  private setMetaTone(
    tone: OverworldHudViewModel['selectedMetaTone']
  ): void {
    if (!this.selectedMetaEl) {
      return;
    }

    this.selectedMetaEl.setAttribute('data-world-meta-tone', tone);
  }

  private setSeparatorVisible(visible: boolean): void {
    this.separatorEl?.classList.toggle('hidden', !visible);
  }

  private renderGoalPanel(viewModel: OverworldHudViewModel): void {
    if (!this.goalPanelEl) {
      return;
    }

    this.goalPanelEl.classList.toggle('hidden', !viewModel.goalPanelVisible);
    this.goalPanelEl.setAttribute('data-goal-panel-tone', viewModel.goalPanelTone);
    this.setText(this.goalPanelRoomEl, viewModel.goalPanelRoomText);
    this.setText(this.goalPanelGoalEl, viewModel.goalPanelGoalText);
    this.setText(this.goalPanelTimerEl, viewModel.goalPanelTimerText);
    this.setText(this.goalPanelProgressEl, viewModel.goalPanelProgressText);
  }
}

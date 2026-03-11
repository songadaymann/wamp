export interface EditorGoalUiViewModel {
  goalTypeValue: string;
  timeLimitHidden: boolean;
  timeLimitValue: string;
  requiredCountHidden: boolean;
  requiredCountValue: string;
  survivalHidden: boolean;
  survivalValue: string;
  markerControlsHidden: boolean;
  placementHintHidden: boolean;
  placementHintText: string;
  summaryText: string;
  placeExitHidden: boolean;
  placeExitActive: boolean;
  addCheckpointHidden: boolean;
  addCheckpointActive: boolean;
  placeFinishHidden: boolean;
  placeFinishActive: boolean;
}

export interface EditorUiViewModel {
  roomTitleValue: string;
  roomCoordinatesText: string;
  saveStatusText: string;
  zoomText: string;
  backToWorldHidden: boolean;
  playHidden: boolean;
  saveHidden: boolean;
  saveDisabled: boolean;
  publishHidden: boolean;
  publishDisabled: boolean;
  mintHidden: boolean;
  mintDisabled: boolean;
  mintButtonText: string;
  historyHidden: boolean;
  historyDisabled: boolean;
  fitHidden: boolean;
  goal: EditorGoalUiViewModel;
}

export class EditorUiBridge {
  private readonly roomTitleInput: HTMLInputElement | null;
  private readonly roomCoordsEl: HTMLElement | null;
  private readonly separatorEl: HTMLElement | null;
  private readonly saveStatusEl: HTMLElement | null;
  private readonly zoomEl: HTMLElement | null;
  private readonly backToWorldBtn: HTMLButtonElement | null;
  private readonly playBtn: HTMLButtonElement | null;
  private readonly saveBtn: HTMLButtonElement | null;
  private readonly publishBtn: HTMLButtonElement | null;
  private readonly mintBtn: HTMLButtonElement | null;
  private readonly historyBtn: HTMLButtonElement | null;
  private readonly fitBtn: HTMLButtonElement | null;
  private readonly goalTypeSelect: HTMLSelectElement | null;
  private readonly timeLimitRow: HTMLElement | null;
  private readonly timeLimitInput: HTMLInputElement | null;
  private readonly requiredCountRow: HTMLElement | null;
  private readonly requiredCountInput: HTMLInputElement | null;
  private readonly survivalRow: HTMLElement | null;
  private readonly survivalInput: HTMLInputElement | null;
  private readonly markerControls: HTMLElement | null;
  private readonly placementHint: HTMLElement | null;
  private readonly summary: HTMLElement | null;
  private readonly placeExitBtn: HTMLButtonElement | null;
  private readonly addCheckpointBtn: HTMLButtonElement | null;
  private readonly placeFinishBtn: HTMLButtonElement | null;
  private destroyed = false;

  constructor(private readonly doc: Document = document) {
    this.roomTitleInput = this.doc.getElementById('room-title-input') as HTMLInputElement | null;
    this.roomCoordsEl = this.doc.getElementById('room-coords');
    this.separatorEl = this.doc.querySelector('#bottom-bar .separator');
    this.saveStatusEl = this.doc.getElementById('room-save-status');
    this.zoomEl = this.doc.getElementById('zoom-level');
    this.backToWorldBtn = this.doc.getElementById('btn-back-to-world') as HTMLButtonElement | null;
    this.playBtn = this.doc.getElementById('btn-test-play') as HTMLButtonElement | null;
    this.saveBtn = this.doc.getElementById('btn-save-draft') as HTMLButtonElement | null;
    this.publishBtn = this.doc.getElementById('btn-publish-room') as HTMLButtonElement | null;
    this.mintBtn = this.doc.getElementById('btn-mint-room') as HTMLButtonElement | null;
    this.historyBtn = this.doc.getElementById('btn-room-history') as HTMLButtonElement | null;
    this.fitBtn = this.doc.getElementById('btn-fit-screen') as HTMLButtonElement | null;
    this.goalTypeSelect = this.doc.getElementById('goal-type-select') as HTMLSelectElement | null;
    this.timeLimitRow = this.doc.getElementById('goal-time-limit-row');
    this.timeLimitInput = this.doc.getElementById('goal-time-limit-seconds') as HTMLInputElement | null;
    this.requiredCountRow = this.doc.getElementById('goal-required-count-row');
    this.requiredCountInput = this.doc.getElementById('goal-required-count') as HTMLInputElement | null;
    this.survivalRow = this.doc.getElementById('goal-survival-row');
    this.survivalInput = this.doc.getElementById('goal-survival-seconds') as HTMLInputElement | null;
    this.markerControls = this.doc.getElementById('goal-marker-controls');
    this.placementHint = this.doc.getElementById('goal-placement-hint');
    this.summary = this.doc.getElementById('goal-summary');
    this.placeExitBtn = this.doc.getElementById('btn-goal-place-exit') as HTMLButtonElement | null;
    this.addCheckpointBtn = this.doc.getElementById('btn-goal-add-checkpoint') as HTMLButtonElement | null;
    this.placeFinishBtn = this.doc.getElementById('btn-goal-place-finish') as HTMLButtonElement | null;
  }

  render(viewModel: EditorUiViewModel): void {
    if (this.destroyed) {
      return;
    }

    this.setValue(this.roomTitleInput, viewModel.roomTitleValue);
    this.setText(this.roomCoordsEl, viewModel.roomCoordinatesText);
    this.separatorEl?.classList.toggle('hidden', false);
    this.setText(this.saveStatusEl, viewModel.saveStatusText);
    this.resetSaveStatusTone();
    this.setText(this.zoomEl, viewModel.zoomText);

    this.setHidden(this.backToWorldBtn, viewModel.backToWorldHidden);
    this.setHidden(this.playBtn, viewModel.playHidden);
    this.setHidden(this.saveBtn, viewModel.saveHidden);
    this.setDisabled(this.saveBtn, viewModel.saveDisabled);
    this.setHidden(this.publishBtn, viewModel.publishHidden);
    this.setDisabled(this.publishBtn, viewModel.publishDisabled);
    this.setHidden(this.mintBtn, viewModel.mintHidden);
    this.setDisabled(this.mintBtn, viewModel.mintDisabled);
    this.setButtonText(this.mintBtn, viewModel.mintButtonText);
    this.setHidden(this.historyBtn, viewModel.historyHidden);
    this.setDisabled(this.historyBtn, viewModel.historyDisabled);
    this.setHidden(this.fitBtn, viewModel.fitHidden);

    this.setValue(this.goalTypeSelect, viewModel.goal.goalTypeValue);
    this.setHidden(this.timeLimitRow, viewModel.goal.timeLimitHidden);
    this.setValue(this.timeLimitInput, viewModel.goal.timeLimitValue);
    this.setHidden(this.requiredCountRow, viewModel.goal.requiredCountHidden);
    this.setValue(this.requiredCountInput, viewModel.goal.requiredCountValue);
    this.setHidden(this.survivalRow, viewModel.goal.survivalHidden);
    this.setValue(this.survivalInput, viewModel.goal.survivalValue);
    this.setHidden(this.markerControls, viewModel.goal.markerControlsHidden);
    this.setHidden(this.placementHint, viewModel.goal.placementHintHidden);
    this.setText(this.placementHint, viewModel.goal.placementHintText);
    this.setText(this.summary, viewModel.goal.summaryText);

    this.setHidden(this.placeExitBtn, viewModel.goal.placeExitHidden);
    this.setActive(this.placeExitBtn, viewModel.goal.placeExitActive);
    this.setHidden(this.addCheckpointBtn, viewModel.goal.addCheckpointHidden);
    this.setActive(this.addCheckpointBtn, viewModel.goal.addCheckpointActive);
    this.setHidden(this.placeFinishBtn, viewModel.goal.placeFinishHidden);
    this.setActive(this.placeFinishBtn, viewModel.goal.placeFinishActive);
  }

  destroy(): void {
    this.destroyed = true;
  }

  private setText(element: HTMLElement | null, text: string): void {
    if (element && element.textContent !== text) {
      element.textContent = text;
    }
  }

  private setValue(
    element: HTMLInputElement | HTMLSelectElement | null,
    value: string
  ): void {
    if (!element) {
      return;
    }

    if (this.doc.activeElement === element && element.value !== value) {
      return;
    }

    if (element.value !== value) {
      element.value = value;
    }
  }

  private setDisabled(element: HTMLButtonElement | null, disabled: boolean): void {
    if (element && element.disabled !== disabled) {
      element.disabled = disabled;
    }
  }

  private setHidden(element: HTMLElement | null, hidden: boolean): void {
    if (element) {
      element.classList.toggle('hidden', hidden);
    }
  }

  private setActive(element: HTMLElement | null, active: boolean): void {
    if (element) {
      element.classList.toggle('active', active);
    }
  }

  private setButtonText(element: HTMLButtonElement | null, text: string): void {
    if (element && element.textContent !== text) {
      element.textContent = text;
    }
  }

  private resetSaveStatusTone(): void {
    this.saveStatusEl?.removeAttribute('data-overworld-tone');
  }
}

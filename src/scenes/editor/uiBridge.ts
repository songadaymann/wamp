export interface EditorGoalUiViewModel {
  goalTypeValue: string;
  goalTypeDisabled: boolean;
  timeLimitHidden: boolean;
  timeLimitDisabled: boolean;
  timeLimitValue: string;
  requiredCountHidden: boolean;
  requiredCountDisabled: boolean;
  requiredCountValue: string;
  survivalHidden: boolean;
  survivalDisabled: boolean;
  survivalValue: string;
  markerControlsHidden: boolean;
  placementHintHidden: boolean;
  placementHintText: string;
  summaryText: string;
  contextHidden: boolean;
  contextText: string;
  placeStartHidden: boolean;
  placeStartActive: boolean;
  placeExitHidden: boolean;
  placeExitActive: boolean;
  addCheckpointHidden: boolean;
  addCheckpointActive: boolean;
  placeFinishHidden: boolean;
  placeFinishActive: boolean;
}

export interface EditorCourseUiViewModel {
  visible: boolean;
  statusHidden: boolean;
  statusText: string;
  goalTypeValue: string;
  goalTypeDisabled: boolean;
  timeLimitHidden: boolean;
  timeLimitDisabled: boolean;
  timeLimitValue: string;
  requiredCountHidden: boolean;
  requiredCountDisabled: boolean;
  requiredCountValue: string;
  survivalHidden: boolean;
  survivalDisabled: boolean;
  survivalValue: string;
  markerControlsHidden: boolean;
  placementHintHidden: boolean;
  placementHintText: string;
  summaryText: string;
  placeStartHidden: boolean;
  placeStartActive: boolean;
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
  saveStatusAccentText: string;
  saveStatusLinkText: string;
  saveStatusLinkHref: string | null;
  publishNudgeVisible: boolean;
  publishNudgeText: string;
  publishNudgeActionText: string;
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
  course: EditorCourseUiViewModel;
}

export class EditorUiBridge {
  private readonly roomTitleInput: HTMLInputElement | null;
  private readonly roomCoordsEls: HTMLElement[];
  private readonly separatorEl: HTMLElement | null;
  private readonly saveStatusEls: HTMLElement[];
  private readonly publishNudgeRoot: HTMLElement | null;
  private readonly publishNudgeTextEl: HTMLElement | null;
  private readonly publishNudgeActionBtn: HTMLButtonElement | null;
  private readonly zoomEls: HTMLElement[];
  private readonly backToWorldBtn: HTMLButtonElement | null;
  private readonly playBtn: HTMLButtonElement | null;
  private readonly saveBtn: HTMLButtonElement | null;
  private readonly publishBtn: HTMLButtonElement | null;
  private readonly mintBtn: HTMLButtonElement | null;
  private readonly historyBtn: HTMLButtonElement | null;
  private readonly fitBtns: HTMLButtonElement[];
  private readonly goalTypeSelect: HTMLSelectElement | null;
  private readonly goalContextNote: HTMLElement | null;
  private readonly timeLimitRow: HTMLElement | null;
  private readonly timeLimitInput: HTMLInputElement | null;
  private readonly requiredCountRow: HTMLElement | null;
  private readonly requiredCountInput: HTMLInputElement | null;
  private readonly survivalRow: HTMLElement | null;
  private readonly survivalInput: HTMLInputElement | null;
  private readonly markerControls: HTMLElement | null;
  private readonly placementHint: HTMLElement | null;
  private readonly summary: HTMLElement | null;
  private readonly placeStartBtn: HTMLButtonElement | null;
  private readonly placeExitBtn: HTMLButtonElement | null;
  private readonly addCheckpointBtn: HTMLButtonElement | null;
  private readonly placeFinishBtn: HTMLButtonElement | null;
  private readonly courseRoot: HTMLElement | null;
  private readonly courseStatus: HTMLElement | null;
  private readonly courseGoalTypeSelect: HTMLSelectElement | null;
  private readonly courseTimeLimitRow: HTMLElement | null;
  private readonly courseTimeLimitInput: HTMLInputElement | null;
  private readonly courseRequiredCountRow: HTMLElement | null;
  private readonly courseRequiredCountInput: HTMLInputElement | null;
  private readonly courseSurvivalRow: HTMLElement | null;
  private readonly courseSurvivalInput: HTMLInputElement | null;
  private readonly courseMarkerControls: HTMLElement | null;
  private readonly coursePlacementHint: HTMLElement | null;
  private readonly courseSummary: HTMLElement | null;
  private readonly coursePlaceStartBtn: HTMLButtonElement | null;
  private readonly coursePlaceExitBtn: HTMLButtonElement | null;
  private readonly courseAddCheckpointBtn: HTMLButtonElement | null;
  private readonly coursePlaceFinishBtn: HTMLButtonElement | null;
  private readonly backgroundButtons: HTMLButtonElement[];
  private destroyed = false;

  constructor(private readonly doc: Document = document) {
    this.roomTitleInput = this.doc.getElementById('room-title-input') as HTMLInputElement | null;
    this.roomCoordsEls = [
      this.doc.getElementById('room-coords'),
      this.doc.getElementById('mobile-editor-room-coords'),
    ].filter((element): element is HTMLElement => Boolean(element));
    this.separatorEl = this.doc.querySelector('#bottom-bar .separator');
    this.saveStatusEls = [
      this.doc.getElementById('room-save-status'),
      this.doc.getElementById('mobile-editor-save-status'),
    ].filter((element): element is HTMLElement => Boolean(element));
    this.publishNudgeRoot = this.doc.getElementById('editor-publish-nudge');
    this.publishNudgeTextEl = this.doc.getElementById('editor-publish-nudge-text');
    this.publishNudgeActionBtn = this.doc.getElementById('btn-editor-publish-nudge') as HTMLButtonElement | null;
    this.zoomEls = [
      this.doc.getElementById('zoom-level'),
      this.doc.getElementById('mobile-editor-zoom-level'),
    ].filter((element): element is HTMLElement => Boolean(element));
    this.backToWorldBtn = this.doc.getElementById('btn-back-to-world') as HTMLButtonElement | null;
    this.playBtn = this.doc.getElementById('btn-test-play') as HTMLButtonElement | null;
    this.saveBtn = this.doc.getElementById('btn-save-draft') as HTMLButtonElement | null;
    this.publishBtn = this.doc.getElementById('btn-publish-room') as HTMLButtonElement | null;
    this.mintBtn = this.doc.getElementById('btn-mint-room') as HTMLButtonElement | null;
    this.historyBtn = this.doc.getElementById('btn-room-history') as HTMLButtonElement | null;
    this.fitBtns = [
      this.doc.getElementById('btn-fit-screen') as HTMLButtonElement | null,
      this.doc.getElementById('btn-mobile-editor-fit') as HTMLButtonElement | null,
    ].filter((element): element is HTMLButtonElement => Boolean(element));
    this.goalTypeSelect = this.doc.getElementById('goal-type-select') as HTMLSelectElement | null;
    this.goalContextNote = this.doc.getElementById('goal-context-note');
    this.timeLimitRow = this.doc.getElementById('goal-time-limit-row');
    this.timeLimitInput = this.doc.getElementById('goal-time-limit-seconds') as HTMLInputElement | null;
    this.requiredCountRow = this.doc.getElementById('goal-required-count-row');
    this.requiredCountInput = this.doc.getElementById('goal-required-count') as HTMLInputElement | null;
    this.survivalRow = this.doc.getElementById('goal-survival-row');
    this.survivalInput = this.doc.getElementById('goal-survival-seconds') as HTMLInputElement | null;
    this.markerControls = this.doc.getElementById('goal-marker-controls');
    this.placementHint = this.doc.getElementById('goal-placement-hint');
    this.summary = this.doc.getElementById('goal-summary');
    this.placeStartBtn = this.doc.getElementById('btn-goal-place-start') as HTMLButtonElement | null;
    this.placeExitBtn = this.doc.getElementById('btn-goal-place-exit') as HTMLButtonElement | null;
    this.addCheckpointBtn = this.doc.getElementById('btn-goal-add-checkpoint') as HTMLButtonElement | null;
    this.placeFinishBtn = this.doc.getElementById('btn-goal-place-finish') as HTMLButtonElement | null;
    this.courseRoot = this.doc.getElementById('course-goal-section');
    this.courseStatus = this.doc.getElementById('course-editor-status');
    this.courseGoalTypeSelect = this.doc.getElementById('course-editor-goal-type-select') as HTMLSelectElement | null;
    this.courseTimeLimitRow = this.doc.getElementById('course-editor-time-limit-row');
    this.courseTimeLimitInput = this.doc.getElementById('course-editor-time-limit-seconds') as HTMLInputElement | null;
    this.courseRequiredCountRow = this.doc.getElementById('course-editor-required-count-row');
    this.courseRequiredCountInput = this.doc.getElementById('course-editor-required-count') as HTMLInputElement | null;
    this.courseSurvivalRow = this.doc.getElementById('course-editor-survival-row');
    this.courseSurvivalInput = this.doc.getElementById('course-editor-survival-seconds') as HTMLInputElement | null;
    this.courseMarkerControls = this.doc.getElementById('course-editor-marker-controls');
    this.coursePlacementHint = this.doc.getElementById('course-editor-placement-hint');
    this.courseSummary = this.doc.getElementById('course-editor-summary');
    this.coursePlaceStartBtn = this.doc.getElementById('btn-course-editor-place-start') as HTMLButtonElement | null;
    this.coursePlaceExitBtn = this.doc.getElementById('btn-course-editor-place-exit') as HTMLButtonElement | null;
    this.courseAddCheckpointBtn = this.doc.getElementById('btn-course-editor-add-checkpoint') as HTMLButtonElement | null;
    this.coursePlaceFinishBtn = this.doc.getElementById('btn-course-editor-place-finish') as HTMLButtonElement | null;
    this.backgroundButtons = Array.from(
      this.doc.querySelectorAll<HTMLButtonElement>('[data-background-id]')
    );
  }

  render(viewModel: EditorUiViewModel): void {
    if (this.destroyed) {
      return;
    }

    this.setValue(this.roomTitleInput, viewModel.roomTitleValue);
    this.setText(this.roomCoordsEls, viewModel.roomCoordinatesText);
    this.separatorEl?.classList.toggle('hidden', false);
    this.renderSaveStatus(this.saveStatusEls, viewModel);
    this.setHidden(this.publishNudgeRoot, !viewModel.publishNudgeVisible);
    this.setText(this.publishNudgeTextEl, viewModel.publishNudgeText);
    this.setButtonText(this.publishNudgeActionBtn, viewModel.publishNudgeActionText);
    this.resetSaveStatusTone();
    this.setText(this.zoomEls, viewModel.zoomText);
    this.syncBackgroundSelection();

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
    this.setHidden(this.fitBtns, viewModel.fitHidden);

    this.setValue(this.goalTypeSelect, viewModel.goal.goalTypeValue);
    this.setDisabled(this.goalTypeSelect, viewModel.goal.goalTypeDisabled);
    this.setHidden(this.goalContextNote, viewModel.goal.contextHidden);
    this.setText(this.goalContextNote, viewModel.goal.contextText);
    this.setHidden(this.timeLimitRow, viewModel.goal.timeLimitHidden);
    this.setDisabled(this.timeLimitInput, viewModel.goal.timeLimitDisabled);
    this.setValue(this.timeLimitInput, viewModel.goal.timeLimitValue);
    this.setHidden(this.requiredCountRow, viewModel.goal.requiredCountHidden);
    this.setDisabled(this.requiredCountInput, viewModel.goal.requiredCountDisabled);
    this.setValue(this.requiredCountInput, viewModel.goal.requiredCountValue);
    this.setHidden(this.survivalRow, viewModel.goal.survivalHidden);
    this.setDisabled(this.survivalInput, viewModel.goal.survivalDisabled);
    this.setValue(this.survivalInput, viewModel.goal.survivalValue);
    this.setHidden(this.markerControls, viewModel.goal.markerControlsHidden);
    this.setHidden(this.placementHint, viewModel.goal.placementHintHidden);
    this.setText(this.placementHint, viewModel.goal.placementHintText);
    this.setText(this.summary, viewModel.goal.summaryText);

    this.setHidden(this.placeStartBtn, viewModel.goal.placeStartHidden);
    this.setActive(this.placeStartBtn, viewModel.goal.placeStartActive);
    this.setHidden(this.placeExitBtn, viewModel.goal.placeExitHidden);
    this.setActive(this.placeExitBtn, viewModel.goal.placeExitActive);
    this.setHidden(this.addCheckpointBtn, viewModel.goal.addCheckpointHidden);
    this.setActive(this.addCheckpointBtn, viewModel.goal.addCheckpointActive);
    this.setHidden(this.placeFinishBtn, viewModel.goal.placeFinishHidden);
    this.setActive(this.placeFinishBtn, viewModel.goal.placeFinishActive);

    this.setHidden(this.courseRoot, !viewModel.course.visible);
    this.setHidden(this.courseStatus, viewModel.course.statusHidden);
    this.setText(this.courseStatus, viewModel.course.statusText);
    this.setValue(this.courseGoalTypeSelect, viewModel.course.goalTypeValue);
    this.setDisabled(this.courseGoalTypeSelect, viewModel.course.goalTypeDisabled);
    this.setHidden(this.courseTimeLimitRow, viewModel.course.timeLimitHidden);
    this.setDisabled(this.courseTimeLimitInput, viewModel.course.timeLimitDisabled);
    this.setValue(this.courseTimeLimitInput, viewModel.course.timeLimitValue);
    this.setHidden(this.courseRequiredCountRow, viewModel.course.requiredCountHidden);
    this.setDisabled(this.courseRequiredCountInput, viewModel.course.requiredCountDisabled);
    this.setValue(this.courseRequiredCountInput, viewModel.course.requiredCountValue);
    this.setHidden(this.courseSurvivalRow, viewModel.course.survivalHidden);
    this.setDisabled(this.courseSurvivalInput, viewModel.course.survivalDisabled);
    this.setValue(this.courseSurvivalInput, viewModel.course.survivalValue);
    this.setHidden(this.courseMarkerControls, viewModel.course.markerControlsHidden);
    this.setHidden(this.coursePlacementHint, viewModel.course.placementHintHidden);
    this.setText(this.coursePlacementHint, viewModel.course.placementHintText);
    this.setText(this.courseSummary, viewModel.course.summaryText);
    this.setHidden(this.coursePlaceStartBtn, viewModel.course.placeStartHidden);
    this.setActive(this.coursePlaceStartBtn, viewModel.course.placeStartActive);
    this.setHidden(this.coursePlaceExitBtn, viewModel.course.placeExitHidden);
    this.setActive(this.coursePlaceExitBtn, viewModel.course.placeExitActive);
    this.setHidden(this.courseAddCheckpointBtn, viewModel.course.addCheckpointHidden);
    this.setActive(this.courseAddCheckpointBtn, viewModel.course.addCheckpointActive);
    this.setHidden(this.coursePlaceFinishBtn, viewModel.course.placeFinishHidden);
    this.setActive(this.coursePlaceFinishBtn, viewModel.course.placeFinishActive);
  }

  destroy(): void {
    this.destroyed = true;
  }

  private setText(elements: HTMLElement | HTMLElement[] | null, text: string): void {
    const targets = Array.isArray(elements) ? elements : elements ? [elements] : [];
    for (const element of targets) {
      if (element.textContent !== text) {
        element.textContent = text;
      }
    }
  }

  private renderSaveStatus(elements: HTMLElement[], viewModel: EditorUiViewModel): void {
    for (const element of elements) {
      element.replaceChildren();

      const hasRichStatus =
        viewModel.saveStatusAccentText.length > 0 || viewModel.saveStatusLinkText.length > 0;
      element.classList.toggle('editor-save-status-rich', hasRichStatus);

      if (viewModel.saveStatusAccentText) {
        const accent = this.doc.createElement('span');
        accent.className = 'editor-save-status-accent';
        accent.textContent = viewModel.saveStatusAccentText;
        element.append(accent);
      }

      if (viewModel.saveStatusText) {
        if (element.childNodes.length > 0) {
          element.append(this.doc.createTextNode(' '));
        }
        element.append(this.doc.createTextNode(viewModel.saveStatusText));
      }

      if (viewModel.saveStatusLinkText && viewModel.saveStatusLinkHref) {
        if (element.childNodes.length > 0) {
          element.append(this.doc.createTextNode(' '));
        }
        const link = this.doc.createElement('a');
        link.className = 'editor-save-status-link';
        link.href = viewModel.saveStatusLinkHref;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = viewModel.saveStatusLinkText;
        element.append(link);
      }
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

  private setDisabled(
    element: HTMLButtonElement | HTMLInputElement | HTMLSelectElement | null,
    disabled: boolean,
  ): void {
    if (element && element.disabled !== disabled) {
      element.disabled = disabled;
    }
  }

  private setHidden(element: HTMLElement | HTMLElement[] | null, hidden: boolean): void {
    const targets = Array.isArray(element) ? element : element ? [element] : [];
    for (const target of targets) {
      target.classList.toggle('hidden', hidden);
    }
  }

  private syncBackgroundSelection(): void {
    for (const button of this.backgroundButtons) {
      const active = button.dataset.backgroundId === (this.doc.getElementById('background-select') as HTMLSelectElement | null)?.value;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  private resetSaveStatusTone(): void {
    for (const element of this.saveStatusEls) {
      element.removeAttribute('data-overworld-tone');
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
}

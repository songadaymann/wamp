import Phaser from 'phaser';
import type { CourseGoalType } from '../../courses/model';
import type { CourseEditorCheckpointEntry, CourseEditorRoomEntry, CourseEditorUiState } from '../../courses/editor/state';
import {
  COURSE_COMPOSER_STATE_CHANGED_EVENT,
  getActiveCourseComposerScene,
} from './sceneBridge';

type CourseEditorPanelElements = {
  shell: HTMLElement | null;
  titleInput: HTMLInputElement | null;
  status: HTMLElement | null;
  selectedRoomSummary: HTMLElement | null;
  selectedRoomStatus: HTMLElement | null;
  selectedRoomActions: HTMLElement | null;
  toggleSelectedRoomButton: HTMLButtonElement | null;
  openSelectedRoomButton: HTMLButtonElement | null;
  centerSelectedRoomButton: HTMLButtonElement | null;
  editCourseButton: HTMLButtonElement | null;
  placeStartButton: HTMLButtonElement | null;
  placeExitButton: HTMLButtonElement | null;
  addCheckpointButton: HTMLButtonElement | null;
  placeFinishButton: HTMLButtonElement | null;
  clearMarkersButton: HTMLButtonElement | null;
  placementHint: HTMLElement | null;
  goalTypeSelect: HTMLSelectElement | null;
  timeLimitRow: HTMLElement | null;
  timeLimitInput: HTMLInputElement | null;
  requiredCountRow: HTMLElement | null;
  requiredCountInput: HTMLInputElement | null;
  survivalRow: HTMLElement | null;
  survivalInput: HTMLInputElement | null;
  roomList: HTMLElement | null;
  checkpointList: HTMLElement | null;
  summary: HTMLElement | null;
  publishedState: HTMLElement | null;
  publishedWarning: HTMLElement | null;
  testDraftButton: HTMLButtonElement | null;
  testDraftReason: HTMLElement | null;
  saveButton: HTMLButtonElement | null;
  saveReason: HTMLElement | null;
  publishButton: HTMLButtonElement | null;
  publishReason: HTMLElement | null;
  unpublishButton: HTMLButtonElement | null;
  unpublishReason: HTMLElement | null;
  zoomText: HTMLElement | null;
  zoomInButton: HTMLButtonElement | null;
  zoomOutButton: HTMLButtonElement | null;
  fitButton: HTMLButtonElement | null;
  backButton: HTMLButtonElement | null;
};

export class CourseComposerPanelController {
  private readonly elements: CourseEditorPanelElements;

  private readonly handleStateChanged = () => {
    this.render();
  };

  constructor(
    private readonly game: Phaser.Game,
    private readonly doc: Document = document,
    private readonly windowObj: Window = window,
  ) {
    this.elements = {
      shell: this.doc.getElementById('course-editor-shell'),
      titleInput: this.doc.getElementById('course-workbench-title-input') as HTMLInputElement | null,
      status: this.doc.getElementById('course-workbench-status'),
      selectedRoomSummary: this.doc.getElementById('course-workbench-selected-room-summary'),
      selectedRoomStatus: this.doc.getElementById('course-workbench-selected-room-status'),
      selectedRoomActions: this.doc.getElementById('course-workbench-selected-room-actions'),
      toggleSelectedRoomButton: this.doc.getElementById('btn-course-workbench-toggle-room') as HTMLButtonElement | null,
      openSelectedRoomButton: this.doc.getElementById('btn-course-workbench-open-room') as HTMLButtonElement | null,
      centerSelectedRoomButton: this.doc.getElementById('btn-course-workbench-center-room') as HTMLButtonElement | null,
      editCourseButton: this.doc.getElementById('btn-course-workbench-edit-course') as HTMLButtonElement | null,
      placeStartButton: this.doc.getElementById('btn-course-workbench-place-start') as HTMLButtonElement | null,
      placeExitButton: this.doc.getElementById('btn-course-workbench-place-exit') as HTMLButtonElement | null,
      addCheckpointButton: this.doc.getElementById('btn-course-workbench-add-checkpoint') as HTMLButtonElement | null,
      placeFinishButton: this.doc.getElementById('btn-course-workbench-place-finish') as HTMLButtonElement | null,
      clearMarkersButton: this.doc.getElementById('btn-course-workbench-clear-markers') as HTMLButtonElement | null,
      placementHint: this.doc.getElementById('course-workbench-placement-hint'),
      goalTypeSelect: this.doc.getElementById('course-workbench-goal-type') as HTMLSelectElement | null,
      timeLimitRow: this.doc.getElementById('course-workbench-time-limit-row'),
      timeLimitInput: this.doc.getElementById('course-workbench-time-limit-seconds') as HTMLInputElement | null,
      requiredCountRow: this.doc.getElementById('course-workbench-required-count-row'),
      requiredCountInput: this.doc.getElementById('course-workbench-required-count') as HTMLInputElement | null,
      survivalRow: this.doc.getElementById('course-workbench-survival-row'),
      survivalInput: this.doc.getElementById('course-workbench-survival-seconds') as HTMLInputElement | null,
      roomList: this.doc.getElementById('course-workbench-room-list'),
      checkpointList: this.doc.getElementById('course-workbench-checkpoint-list'),
      summary: this.doc.getElementById('course-workbench-summary'),
      publishedState: this.doc.getElementById('course-workbench-published-state'),
      publishedWarning: this.doc.getElementById('course-workbench-published-warning'),
      testDraftButton: this.doc.getElementById('btn-course-workbench-test') as HTMLButtonElement | null,
      testDraftReason: this.doc.getElementById('course-workbench-test-reason'),
      saveButton: this.doc.getElementById('btn-course-workbench-save') as HTMLButtonElement | null,
      saveReason: this.doc.getElementById('course-workbench-save-reason'),
      publishButton: this.doc.getElementById('btn-course-workbench-publish') as HTMLButtonElement | null,
      publishReason: this.doc.getElementById('course-workbench-publish-reason'),
      unpublishButton: this.doc.getElementById('btn-course-workbench-unpublish') as HTMLButtonElement | null,
      unpublishReason: this.doc.getElementById('course-workbench-unpublish-reason'),
      zoomText: this.doc.getElementById('course-workbench-zoom-text'),
      zoomInButton: this.doc.getElementById('btn-course-workbench-zoom-in') as HTMLButtonElement | null,
      zoomOutButton: this.doc.getElementById('btn-course-workbench-zoom-out') as HTMLButtonElement | null,
      fitButton: this.doc.getElementById('btn-course-workbench-fit') as HTMLButtonElement | null,
      backButton: this.doc.getElementById('btn-course-workbench-back-world') as HTMLButtonElement | null,
    };
  }

  init(): void {
    this.windowObj.addEventListener(COURSE_COMPOSER_STATE_CHANGED_EVENT, this.handleStateChanged);

    this.elements.titleInput?.addEventListener('input', () => {
      getActiveCourseComposerScene(this.game)?.setCourseTitle?.(this.elements.titleInput?.value ?? null);
    });
    this.elements.goalTypeSelect?.addEventListener('change', () => {
      const nextType = this.elements.goalTypeSelect?.value
        ? (this.elements.goalTypeSelect.value as CourseGoalType)
        : null;
      getActiveCourseComposerScene(this.game)?.setCourseGoalType?.(nextType);
    });
    this.elements.timeLimitInput?.addEventListener('change', () => {
      const raw = this.elements.timeLimitInput?.value.trim() ?? '';
      const seconds = raw.length > 0 ? Number(raw) : null;
      getActiveCourseComposerScene(this.game)?.setCourseGoalTimeLimitSeconds?.(
        seconds !== null && Number.isFinite(seconds) ? seconds : null
      );
    });
    this.elements.requiredCountInput?.addEventListener('change', () => {
      const raw = Number(this.elements.requiredCountInput?.value ?? '');
      if (!Number.isFinite(raw)) {
        return;
      }
      getActiveCourseComposerScene(this.game)?.setCourseGoalRequiredCount?.(raw);
    });
    this.elements.survivalInput?.addEventListener('change', () => {
      const raw = Number(this.elements.survivalInput?.value ?? '');
      if (!Number.isFinite(raw)) {
        return;
      }
      getActiveCourseComposerScene(this.game)?.setCourseGoalSurvivalSeconds?.(raw);
    });
    this.elements.placeStartButton?.addEventListener('click', () => {
      getActiveCourseComposerScene(this.game)?.startMarkerPlacement?.('start');
    });
    this.elements.placeExitButton?.addEventListener('click', () => {
      getActiveCourseComposerScene(this.game)?.startMarkerPlacement?.('exit');
    });
    this.elements.addCheckpointButton?.addEventListener('click', () => {
      getActiveCourseComposerScene(this.game)?.startMarkerPlacement?.('checkpoint');
    });
    this.elements.placeFinishButton?.addEventListener('click', () => {
      getActiveCourseComposerScene(this.game)?.startMarkerPlacement?.('finish');
    });
    this.elements.clearMarkersButton?.addEventListener('click', () => {
      getActiveCourseComposerScene(this.game)?.clearMarkers?.();
    });
    this.elements.toggleSelectedRoomButton?.addEventListener('click', () => {
      getActiveCourseComposerScene(this.game)?.toggleSelectedRoomMembership?.();
    });
    this.elements.openSelectedRoomButton?.addEventListener('click', () => {
      void getActiveCourseComposerScene(this.game)?.openSelectedRoom?.();
    });
    this.elements.centerSelectedRoomButton?.addEventListener('click', () => {
      getActiveCourseComposerScene(this.game)?.centerSelectedRoom?.();
    });
    this.elements.editCourseButton?.addEventListener('click', () => {
      void getActiveCourseComposerScene(this.game)?.openCourseEditor?.();
    });
    this.elements.testDraftButton?.addEventListener('click', () => {
      void getActiveCourseComposerScene(this.game)?.testDraftCourse?.();
    });
    this.elements.saveButton?.addEventListener('click', () => {
      void getActiveCourseComposerScene(this.game)?.saveCourseDraft?.();
    });
    this.elements.publishButton?.addEventListener('click', () => {
      void getActiveCourseComposerScene(this.game)?.publishCourseDraft?.();
    });
    this.elements.unpublishButton?.addEventListener('click', () => {
      void getActiveCourseComposerScene(this.game)?.unpublishCourse?.();
    });
    this.elements.zoomInButton?.addEventListener('click', () => {
      getActiveCourseComposerScene(this.game)?.zoomIn?.();
    });
    this.elements.zoomOutButton?.addEventListener('click', () => {
      getActiveCourseComposerScene(this.game)?.zoomOut?.();
    });
    this.elements.fitButton?.addEventListener('click', () => {
      getActiveCourseComposerScene(this.game)?.fitCourseToView?.();
    });
    this.elements.backButton?.addEventListener('click', () => {
      void getActiveCourseComposerScene(this.game)?.returnToWorld?.();
    });

    this.elements.roomList?.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest<HTMLButtonElement>('[data-course-editor-room-id]');
      const roomId = button?.dataset.courseEditorRoomId ?? null;
      if (!roomId) {
        return;
      }
      getActiveCourseComposerScene(this.game)?.selectRoom?.(roomId);
    });

    this.elements.checkpointList?.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest<HTMLButtonElement>('[data-course-editor-checkpoint-action]');
      const index = Number(button?.dataset.courseEditorCheckpointIndex ?? '');
      if (!button || !Number.isInteger(index) || index < 0) {
        return;
      }

      const action = button.dataset.courseEditorCheckpointAction;
      const scene = getActiveCourseComposerScene(this.game);
      if (!scene) {
        return;
      }

      if (action === 'up') {
        scene.moveCheckpoint?.(index, -1);
      } else if (action === 'down') {
        scene.moveCheckpoint?.(index, 1);
      } else if (action === 'remove') {
        scene.removeCheckpoint?.(index);
      }
    });

    this.render();
  }

  destroy(): void {
    this.windowObj.removeEventListener(COURSE_COMPOSER_STATE_CHANGED_EVENT, this.handleStateChanged);
  }

  render(): void {
    const state = getActiveCourseComposerScene(this.game)?.getCourseEditorState?.() ?? null;
    const visible = state?.visible ?? false;
    this.elements.shell?.classList.toggle('hidden', !visible);
    if (!state) {
      return;
    }

    this.setValue(this.elements.titleInput, state.title);
    this.setText(this.elements.status, state.statusText ?? '');
    this.setHidden(this.elements.status, !state.statusText);
    this.setText(this.elements.selectedRoomSummary, state.selectedRoomSummary);
    this.setText(this.elements.selectedRoomStatus, state.selectedRoomStatusText);
    this.setHidden(this.elements.selectedRoomActions, !state.selectedRoomId);
    this.setButtonText(this.elements.toggleSelectedRoomButton, state.toggleSelectedRoomLabel);
    this.setDisabled(this.elements.toggleSelectedRoomButton, !state.canToggleSelectedRoom);
    if (this.elements.toggleSelectedRoomButton) {
      this.elements.toggleSelectedRoomButton.title = state.toggleSelectedRoomDisabledReason ?? '';
    }
    this.setDisabled(this.elements.openSelectedRoomButton, !state.canOpenSelectedRoom);
    this.setDisabled(this.elements.centerSelectedRoomButton, !state.canCenterSelectedRoom);
    this.setDisabled(this.elements.editCourseButton, !state.canOpenCourseEditor);
    if (this.elements.editCourseButton) {
      this.elements.editCourseButton.title = state.openCourseEditorDisabledReason ?? '';
    }

    this.renderPlacementButton(this.elements.placeStartButton, state.tool === 'start', !(state.goalType === 'reach_exit' || state.goalType === 'checkpoint_sprint'));
    this.renderPlacementButton(this.elements.placeExitButton, state.tool === 'exit', state.goalType !== 'reach_exit');
    this.renderPlacementButton(this.elements.addCheckpointButton, state.tool === 'checkpoint', state.goalType !== 'checkpoint_sprint');
    this.renderPlacementButton(this.elements.placeFinishButton, state.tool === 'finish', state.goalType !== 'checkpoint_sprint');
    this.setHidden(
      this.elements.clearMarkersButton,
      !(state.goalType === 'reach_exit' || state.goalType === 'checkpoint_sprint')
    );

    this.setText(this.elements.placementHint, state.placementHintText ?? '');
    this.setHidden(this.elements.placementHint, !state.placementHintText);
    this.setValue(this.elements.goalTypeSelect, state.goalType ?? '');
    this.setDisabled(this.elements.goalTypeSelect, !state.canEdit);
    this.setValue(this.elements.timeLimitInput, state.timeLimitSeconds);
    this.setHidden(
      this.elements.timeLimitRow,
      !(state.goalType === 'reach_exit' || state.goalType === 'collect_target' || state.goalType === 'defeat_all' || state.goalType === 'checkpoint_sprint')
    );
    this.setDisabled(this.elements.timeLimitInput, !state.canEdit);
    this.setValue(this.elements.requiredCountInput, state.requiredCount);
    this.setHidden(this.elements.requiredCountRow, state.goalType !== 'collect_target');
    this.setDisabled(this.elements.requiredCountInput, !state.canEdit);
    this.setValue(this.elements.survivalInput, state.survivalSeconds);
    this.setHidden(this.elements.survivalRow, state.goalType !== 'survival');
    this.setDisabled(this.elements.survivalInput, !state.canEdit);

    this.renderRoomEntries(state.roomEntries);
    this.renderCheckpointEntries(state.checkpointEntries);
    this.setText(this.elements.summary, state.summaryText);
    this.setText(this.elements.publishedState, state.publishedStateText);
    this.setText(this.elements.publishedWarning, state.publishedDraftWarningText ?? '');
    this.setHidden(this.elements.publishedWarning, !state.publishedDraftWarningText);
    this.setDisabled(this.elements.testDraftButton, !state.canTestDraft);
    this.setText(this.elements.testDraftReason, state.testDraftDisabledReason ?? '');
    this.setHidden(this.elements.testDraftReason, !state.testDraftDisabledReason);
    this.setDisabled(this.elements.saveButton, !state.canSaveDraft);
    this.setText(this.elements.saveReason, state.saveDraftDisabledReason ?? '');
    this.setHidden(this.elements.saveReason, !state.saveDraftDisabledReason);
    this.setDisabled(this.elements.publishButton, !state.canPublishCourse);
    this.setText(this.elements.publishReason, state.publishCourseDisabledReason ?? '');
    this.setHidden(this.elements.publishReason, !state.publishCourseDisabledReason);
    this.setHidden(this.elements.unpublishButton, !state.showUnpublishCourse);
    this.setDisabled(this.elements.unpublishButton, !state.canUnpublishCourse);
    this.setText(this.elements.unpublishReason, state.unpublishCourseDisabledReason ?? '');
    this.setHidden(this.elements.unpublishReason, !state.unpublishCourseDisabledReason);
    this.setText(this.elements.zoomText, state.zoomText);
  }

  private renderPlacementButton(
    button: HTMLButtonElement | null,
    active: boolean,
    hidden: boolean,
  ): void {
    if (!button) {
      return;
    }
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.classList.toggle('hidden', hidden);
  }

  private renderRoomEntries(entries: CourseEditorRoomEntry[]): void {
    const root = this.elements.roomList;
    if (!root) {
      return;
    }

    root.replaceChildren();
    if (entries.length === 0) {
      const empty = this.doc.createElement('div');
      empty.className = 'course-editor-empty';
      empty.textContent = 'No rooms in this course yet.';
      root.append(empty);
      return;
    }

    for (const entry of entries) {
      const button = this.doc.createElement('button');
      button.type = 'button';
      button.className = 'course-editor-room-entry';
      button.dataset.courseEditorRoomId = entry.roomId;
      button.classList.toggle('active', entry.selected);

      const title = this.doc.createElement('div');
      title.className = 'course-editor-room-entry-title';
      title.textContent =
        entry.roomTitle?.trim() || `Room ${entry.coordinates.x},${entry.coordinates.y}`;

      const meta = this.doc.createElement('div');
      meta.className = 'course-editor-room-entry-meta';
      const tags: string[] = [`${entry.coordinates.x},${entry.coordinates.y}`, `v${entry.roomVersion}`];
      if (entry.isStartRoom) {
        tags.push('start');
      }
      if (entry.checkpointIndexes.length > 0) {
        tags.push(
          entry.checkpointIndexes.length === 1
            ? `checkpoint ${entry.checkpointIndexes[0] + 1}`
            : `${entry.checkpointIndexes.length} checkpoints`
        );
      }
      if (entry.isFinishRoom) {
        tags.push('finish');
      }
      meta.textContent = tags.join(' · ');

      button.append(title, meta);
      root.append(button);
    }
  }

  private renderCheckpointEntries(entries: CourseEditorCheckpointEntry[]): void {
    const root = this.elements.checkpointList;
    if (!root) {
      return;
    }

    root.replaceChildren();
    if (entries.length === 0) {
      const empty = this.doc.createElement('div');
      empty.className = 'course-editor-empty';
      empty.textContent = 'No checkpoints yet.';
      root.append(empty);
      return;
    }

    for (const entry of entries) {
      const row = this.doc.createElement('div');
      row.className = 'course-editor-checkpoint-entry';

      const copy = this.doc.createElement('div');
      copy.className = 'course-editor-checkpoint-copy';

      const title = this.doc.createElement('div');
      title.className = 'course-editor-checkpoint-title';
      title.textContent = `Checkpoint ${entry.index + 1}`;

      const meta = this.doc.createElement('div');
      meta.className = 'course-editor-checkpoint-meta';
      meta.textContent = `${entry.roomTitle?.trim() || `Room ${entry.coordinates.x},${entry.coordinates.y}`} · ${Math.round(entry.point.x)}, ${Math.round(entry.point.y)}`;

      copy.append(title, meta);

      const actions = this.doc.createElement('div');
      actions.className = 'course-editor-checkpoint-actions';
      actions.append(
        this.createCheckpointButton('Up', entry.index, 'up', !entry.canMoveEarlier),
        this.createCheckpointButton('Down', entry.index, 'down', !entry.canMoveLater),
        this.createCheckpointButton('Remove', entry.index, 'remove', false),
      );

      row.append(copy, actions);
      root.append(row);
    }
  }

  private createCheckpointButton(
    label: string,
    index: number,
    action: 'up' | 'down' | 'remove',
    disabled: boolean,
  ): HTMLButtonElement {
    const button = this.doc.createElement('button');
    button.type = 'button';
    button.className = 'bar-btn bar-btn-small';
    button.textContent = label;
    button.dataset.courseEditorCheckpointIndex = String(index);
    button.dataset.courseEditorCheckpointAction = action;
    button.disabled = disabled;
    return button;
  }

  private setText(element: HTMLElement | null, value: string): void {
    if (element && element.textContent !== value) {
      element.textContent = value;
    }
  }

  private setValue(
    element: HTMLInputElement | HTMLSelectElement | null,
    value: string,
  ): void {
    if (!element) {
      return;
    }
    if (this.doc.activeElement === element) {
      return;
    }
    if (element.value !== value) {
      element.value = value;
    }
  }

  private setHidden(element: HTMLElement | null, hidden: boolean): void {
    element?.classList.toggle('hidden', hidden);
  }

  private setDisabled(
    element: HTMLButtonElement | HTMLInputElement | HTMLSelectElement | null,
    disabled: boolean,
  ): void {
    if (element && element.disabled !== disabled) {
      element.disabled = disabled;
    }
  }

  private setButtonText(element: HTMLButtonElement | null, value: string): void {
    if (element && element.textContent !== value) {
      element.textContent = value;
    }
  }
}

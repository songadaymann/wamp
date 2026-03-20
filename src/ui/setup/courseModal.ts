import Phaser from 'phaser';
import {
  COURSE_COMPOSER_STATE_CHANGED_EVENT,
  getActiveOverworldScene,
  type CourseComposerState,
} from './sceneBridge';

type CourseModalElements = {
  modal: HTMLElement | null;
  panel: HTMLElement | null;
  hudRoot: HTMLElement | null;
  meta: HTMLElement | null;
  status: HTMLElement | null;
  publishedState: HTMLElement | null;
  publishedWarning: HTMLElement | null;
  closeButton: HTMLElement | null;
  titleInput: HTMLInputElement | null;
  roomList: HTMLElement | null;
  selectedRoomStatus: HTMLElement | null;
  addSelectedRoomButton: HTMLButtonElement | null;
  removeSelectedRoomButton: HTMLButtonElement | null;
  moveSelectedRoomEarlierButton: HTMLButtonElement | null;
  moveSelectedRoomLaterButton: HTMLButtonElement | null;
  editSelectedRoomButton: HTMLButtonElement | null;
  testDraftButton: HTMLButtonElement | null;
  testDraftReason: HTMLElement | null;
  summary: HTMLElement | null;
  saveButton: HTMLButtonElement | null;
  saveDraftReason: HTMLElement | null;
  publishButton: HTMLButtonElement | null;
  publishReason: HTMLElement | null;
  unpublishButton: HTMLButtonElement | null;
  unpublishReason: HTMLElement | null;
};

function goalTypeLabel(goalType: CourseComposerState['goalType']): string {
  switch (goalType) {
    case 'reach_exit':
      return 'Reach Exit';
    case 'collect_target':
      return 'Collect Target';
    case 'defeat_all':
      return 'Defeat All';
    case 'checkpoint_sprint':
      return 'Checkpoint Sprint';
    case 'survival':
      return 'Survival';
    default:
      return 'No course goal selected.';
  }
}

export class CourseModalController {
  private readonly elements: CourseModalElements;
  private suspendedForEditor = false;

  private readonly handleCloseClick = () => {
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

  private readonly handleStateChanged = () => {
    const state = getActiveOverworldScene(this.game)?.getCourseComposerState?.() ?? null;
    if (this.suspendedForEditor && state) {
      this.open();
      return;
    }

    if (this.elements.modal?.classList.contains('hidden')) {
      return;
    }

    this.render();
  };

  private readonly handleWindowResize = () => {
    if (this.elements.modal?.classList.contains('hidden')) {
      return;
    }

    this.syncDockPosition();
  };

  constructor(
    private readonly game: Phaser.Game,
    private readonly doc: Document = document,
    private readonly windowObj: Window = window,
  ) {
    this.elements = {
      modal: this.doc.getElementById('course-modal'),
      panel: this.doc.querySelector('#course-modal .course-modal-panel'),
      hudRoot: this.doc.getElementById('world-hud'),
      meta: this.doc.getElementById('course-modal-meta'),
      status: this.doc.getElementById('course-modal-status'),
      publishedState: this.doc.getElementById('course-published-state'),
      publishedWarning: this.doc.getElementById('course-published-warning'),
      closeButton: this.doc.getElementById('btn-course-close'),
      titleInput: this.doc.getElementById('course-title-input') as HTMLInputElement | null,
      roomList: this.doc.getElementById('course-room-list'),
      selectedRoomStatus: this.doc.getElementById('course-selected-room-status'),
      addSelectedRoomButton: this.doc.getElementById('btn-course-add-selected-room') as HTMLButtonElement | null,
      removeSelectedRoomButton: this.doc.getElementById('btn-course-remove-selected-room') as HTMLButtonElement | null,
      moveSelectedRoomEarlierButton: this.doc.getElementById('btn-course-move-selected-earlier') as HTMLButtonElement | null,
      moveSelectedRoomLaterButton: this.doc.getElementById('btn-course-move-selected-later') as HTMLButtonElement | null,
      editSelectedRoomButton: this.doc.getElementById('btn-course-edit-selected-room') as HTMLButtonElement | null,
      testDraftButton: this.doc.getElementById('btn-course-test-draft') as HTMLButtonElement | null,
      testDraftReason: this.doc.getElementById('course-test-draft-reason'),
      summary: this.doc.getElementById('course-summary'),
      saveButton: this.doc.getElementById('btn-course-save-draft') as HTMLButtonElement | null,
      saveDraftReason: this.doc.getElementById('course-save-draft-reason'),
      publishButton: this.doc.getElementById('btn-course-publish') as HTMLButtonElement | null,
      publishReason: this.doc.getElementById('course-publish-reason'),
      unpublishButton: this.doc.getElementById('btn-course-unpublish') as HTMLButtonElement | null,
      unpublishReason: this.doc.getElementById('course-unpublish-reason'),
    };
  }

  init(): void {
    this.elements.closeButton?.addEventListener('click', this.handleCloseClick);
    this.elements.modal?.addEventListener('click', this.handleBackdropClick);
    this.doc.addEventListener('keydown', this.handleDocumentKeydown);
    this.windowObj.addEventListener(
      COURSE_COMPOSER_STATE_CHANGED_EVENT,
      this.handleStateChanged as EventListener
    );
    this.windowObj.addEventListener('resize', this.handleWindowResize);

    this.elements.titleInput?.addEventListener('input', () => {
      getActiveOverworldScene(this.game)?.setCourseTitle?.(this.elements.titleInput?.value ?? null);
    });
    this.elements.addSelectedRoomButton?.addEventListener('click', () => {
      getActiveOverworldScene(this.game)?.addSelectedRoomToCourseDraft?.();
    });
    this.elements.removeSelectedRoomButton?.addEventListener('click', () => {
      getActiveOverworldScene(this.game)?.removeSelectedRoomFromCourseDraft?.();
    });
    this.elements.moveSelectedRoomEarlierButton?.addEventListener('click', () => {
      getActiveOverworldScene(this.game)?.moveSelectedRoomEarlierInCourseDraft?.();
    });
    this.elements.moveSelectedRoomLaterButton?.addEventListener('click', () => {
      getActiveOverworldScene(this.game)?.moveSelectedRoomLaterInCourseDraft?.();
    });
    this.elements.editSelectedRoomButton?.addEventListener('click', () => {
      const opened = getActiveOverworldScene(this.game)?.editSelectedCourseRoom?.() ?? false;
      if (opened) {
        this.suspendForEditor();
      }
    });
    this.elements.testDraftButton?.addEventListener('click', () => {
      void getActiveOverworldScene(this.game)?.testDraftCourse?.();
    });
    this.elements.saveButton?.addEventListener('click', () => {
      void getActiveOverworldScene(this.game)?.saveCourseDraft?.();
    });
    this.elements.publishButton?.addEventListener('click', () => {
      void getActiveOverworldScene(this.game)?.publishCourseDraft?.();
    });
    this.elements.unpublishButton?.addEventListener('click', () => {
      void getActiveOverworldScene(this.game)?.unpublishCourse?.();
    });
  }

  destroy(): void {
    this.elements.closeButton?.removeEventListener('click', this.handleCloseClick);
    this.elements.modal?.removeEventListener('click', this.handleBackdropClick);
    this.doc.removeEventListener('keydown', this.handleDocumentKeydown);
    this.windowObj.removeEventListener(
      COURSE_COMPOSER_STATE_CHANGED_EVENT,
      this.handleStateChanged as EventListener
    );
    this.windowObj.removeEventListener('resize', this.handleWindowResize);
    this.close();
  }

  open(): void {
    if (!this.elements.modal) {
      return;
    }

    this.suspendedForEditor = false;
    this.elements.modal.classList.remove('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'false');
    this.syncDockPosition();
    this.render();
  }

  suspendForEditor(): void {
    if (!this.elements.modal) {
      return;
    }

    this.suspendedForEditor = true;
    this.elements.modal.classList.add('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'true');
    this.clearDockPosition();
  }

  close(): void {
    if (!this.elements.modal) {
      return;
    }

    this.suspendedForEditor = false;
    this.elements.modal.classList.add('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'true');
    this.clearDockPosition();
    getActiveOverworldScene(this.game)?.closeCourseComposer?.();
  }

  render(): void {
    this.syncDockPosition();
    const state = getActiveOverworldScene(this.game)?.getCourseComposerState?.() ?? null;
    if (!state) {
      this.renderEmpty();
      return;
    }

    if (this.elements.meta) {
      const roomCount = state.roomRefs.length;
      this.elements.meta.textContent =
        roomCount > 0
          ? `${roomCount} room${roomCount === 1 ? '' : 's'} selected · authored order defines the path`
          : 'Select 1-4 adjacent published rooms you authored in path order.';
    }

    if (this.elements.publishedState) {
      const publishedRoomText =
        state.published && state.publishedRoomCount > 0
          ? ` · ${state.publishedRoomCount} room${state.publishedRoomCount === 1 ? '' : 's'}`
          : '';
      this.elements.publishedState.textContent = `${state.publishedStateText}${publishedRoomText}`;
    }
    if (this.elements.publishedWarning) {
      this.elements.publishedWarning.textContent = state.publishedDraftWarningText ?? '';
      this.elements.publishedWarning.classList.toggle('hidden', !state.publishedDraftWarningText);
    }

    this.setInputValue(this.elements.titleInput, state.title);
    if (this.elements.selectedRoomStatus) {
      let selectedText = 'Select a published room in the world to extend this course tail.';
      if (state.selectedRoomId && state.selectedRoomOrder !== null) {
        selectedText = `Course room step ${state.selectedRoomOrder + 1} is selected for edit and reorder actions.`;
      }
      if (state.selectedRoomInDraft && state.selectedRoomOrder !== null) {
        selectedText = `World selection is already in the course at step ${state.selectedRoomOrder + 1}.`;
      } else if (state.selectedRoomEligible) {
        selectedText = 'World selection can extend the current course tail.';
      } else if (!state.canEdit) {
        selectedText = 'This course is read-only for your account.';
      } else {
        selectedText = 'World selection cannot extend the current course tail.';
      }
      this.elements.selectedRoomStatus.textContent = selectedText;
    }

    this.renderRoomList(state);
    this.renderSummary(state);

    this.setDisabled(this.elements.titleInput, !state.canEdit);
    this.setButtonDisabled(this.elements.addSelectedRoomButton, !state.canEdit || !state.selectedRoomEligible);
    this.setButtonDisabled(this.elements.removeSelectedRoomButton, !state.canEdit || !state.selectedRoomId);
    this.setButtonDisabled(
      this.elements.moveSelectedRoomEarlierButton,
      !state.canEdit || !state.canMoveSelectedRoomEarlier
    );
    this.setButtonDisabled(
      this.elements.moveSelectedRoomLaterButton,
      !state.canEdit || !state.canMoveSelectedRoomLater
    );
    this.setButtonDisabled(
      this.elements.editSelectedRoomButton,
      !state.canEdit || !state.canEditSelectedRoom
    );
    this.setButtonDisabled(this.elements.testDraftButton, !state.canEdit || !state.canTestDraft);
    const testDraftReason = !state.canTestDraft ? state.testDraftDisabledReason : null;
    if (this.elements.testDraftButton) {
      this.elements.testDraftButton.title = testDraftReason ?? '';
    }
    if (this.elements.testDraftReason) {
      this.elements.testDraftReason.textContent = testDraftReason ?? '';
      this.elements.testDraftReason.classList.toggle('hidden', !testDraftReason);
    }
    this.setButtonDisabled(this.elements.saveButton, !state.canSaveDraft);
    if (this.elements.saveButton) {
      this.elements.saveButton.title = state.saveDraftDisabledReason ?? '';
    }
    if (this.elements.saveDraftReason) {
      this.elements.saveDraftReason.textContent = state.saveDraftDisabledReason ?? '';
      this.elements.saveDraftReason.classList.toggle('hidden', !state.saveDraftDisabledReason);
    }
    this.setButtonDisabled(this.elements.publishButton, !state.canPublishCourse);
    if (this.elements.publishButton) {
      this.elements.publishButton.title = state.publishCourseDisabledReason ?? '';
    }
    if (this.elements.publishReason) {
      this.elements.publishReason.textContent = state.publishCourseDisabledReason ?? '';
      this.elements.publishReason.classList.toggle('hidden', !state.publishCourseDisabledReason);
    }
    if (this.elements.unpublishButton) {
      this.elements.unpublishButton.classList.toggle('hidden', !state.showUnpublishCourse);
      this.elements.unpublishButton.title = state.unpublishCourseDisabledReason ?? '';
    }
    this.setButtonDisabled(this.elements.unpublishButton, !state.canUnpublishCourse);
    if (this.elements.unpublishReason) {
      const unpublishReason = state.showUnpublishCourse ? state.unpublishCourseDisabledReason : null;
      this.elements.unpublishReason.textContent = unpublishReason ?? '';
      this.elements.unpublishReason.classList.toggle('hidden', !unpublishReason);
    }

    if (this.elements.status) {
      this.elements.status.textContent = state.statusText ?? '';
      this.elements.status.classList.toggle('hidden', !state.statusText);
    }
  }

  private renderRoomList(state: CourseComposerState): void {
    if (!this.elements.roomList) {
      return;
    }

    this.elements.roomList.replaceChildren();
    if (state.roomRefs.length === 0) {
      const empty = this.doc.createElement('div');
      empty.className = 'leaderboard-empty';
      empty.textContent = 'No rooms selected yet.';
      this.elements.roomList.appendChild(empty);
      return;
    }

    state.roomRefs.forEach((roomRef, index) => {
      const row = this.doc.createElement('div');
      row.className = 'history-version-row course-room-row';
      if (state.selectedRoomOrder === index) {
        row.classList.add('course-room-row-selected');
      }
      row.tabIndex = 0;
      row.addEventListener('click', () => {
        getActiveOverworldScene(this.game)?.selectCourseRoomInComposer?.(roomRef.roomId);
      });

      const step = this.doc.createElement('div');
      step.className = 'leaderboard-rank';
      step.textContent = `#${index + 1}`;

      const primary = this.doc.createElement('div');
      primary.className = 'leaderboard-primary';
      primary.textContent = roomRef.roomTitle?.trim() || `Room ${roomRef.coordinates.x},${roomRef.coordinates.y}`;

      const secondary = this.doc.createElement('div');
      secondary.className = 'leaderboard-secondary';
      secondary.textContent = `${roomRef.coordinates.x},${roomRef.coordinates.y}`;

      const version = this.doc.createElement('div');
      version.className = 'leaderboard-secondary';
      version.textContent = `v${roomRef.roomVersion}`;

      row.append(step, primary, secondary, version);
      this.elements.roomList?.appendChild(row);
    });
  }

  private renderSummary(state: CourseComposerState): void {
    if (!this.elements.summary) {
      return;
    }

    if (!state.goalType) {
      this.elements.summary.textContent =
        'Open a selected course room in the editor to choose the course goal and place markers.';
      return;
    }

    const parts = [goalTypeLabel(state.goalType)];
    if (state.startPointRoomId) {
      parts.push(`start set`);
    }
    if (state.goalType === 'checkpoint_sprint') {
      parts.push(`${state.checkpointCount} checkpoint${state.checkpointCount === 1 ? '' : 's'}`);
      parts.push(state.finishRoomId ? 'finish set' : 'finish missing');
    } else if (state.goalType === 'reach_exit') {
      parts.push(state.finishRoomId ? 'exit set' : 'exit missing');
    } else if (state.goalType === 'collect_target' && state.requiredCount !== null) {
      parts.push(`${state.requiredCount} required`);
    } else if (state.goalType === 'survival' && state.survivalSeconds !== null) {
      parts.push(`${state.survivalSeconds}s`);
    }

    this.elements.summary.textContent = parts.join(' · ');
  }

  private renderEmpty(): void {
    if (this.elements.meta) {
      this.elements.meta.textContent = 'Open the course builder from the world HUD.';
    }
    if (this.elements.status) {
      this.elements.status.textContent = '';
      this.elements.status.classList.add('hidden');
    }
    if (this.elements.publishedState) {
      this.elements.publishedState.textContent = 'Not published';
    }
    if (this.elements.publishedWarning) {
      this.elements.publishedWarning.textContent = '';
      this.elements.publishedWarning.classList.add('hidden');
    }
    this.elements.roomList?.replaceChildren();
    if (this.elements.summary) {
      this.elements.summary.textContent = 'No course selected.';
    }
    if (this.elements.saveDraftReason) {
      this.elements.saveDraftReason.textContent = '';
      this.elements.saveDraftReason.classList.add('hidden');
    }
    if (this.elements.publishReason) {
      this.elements.publishReason.textContent = '';
      this.elements.publishReason.classList.add('hidden');
    }
    if (this.elements.unpublishButton) {
      this.elements.unpublishButton.classList.add('hidden');
      this.elements.unpublishButton.title = '';
    }
    if (this.elements.unpublishReason) {
      this.elements.unpublishReason.textContent = '';
      this.elements.unpublishReason.classList.add('hidden');
    }
    if (this.elements.testDraftReason) {
      this.elements.testDraftReason.textContent = '';
      this.elements.testDraftReason.classList.add('hidden');
    }
  }

  private setInputValue(input: HTMLInputElement | null, nextValue: string): void {
    if (!input || this.doc.activeElement === input || input.value === nextValue) {
      return;
    }

    input.value = nextValue;
  }

  private setDisabled(
    element: HTMLInputElement | HTMLSelectElement | null,
    disabled: boolean
  ): void {
    if (element && element.disabled !== disabled) {
      element.disabled = disabled;
    }
  }

  private setButtonDisabled(element: HTMLButtonElement | null, disabled: boolean): void {
    if (element && element.disabled !== disabled) {
      element.disabled = disabled;
    }
  }

  private syncDockPosition(): void {
    const panel = this.elements.panel;
    const hudRoot = this.elements.hudRoot;
    const deviceClass = this.doc.body.dataset.deviceClass;
    if (!panel) {
      return;
    }

    if (deviceClass === 'phone') {
      this.clearDockPosition();
      return;
    }

    if (!hudRoot || hudRoot.classList.contains('hidden')) {
      this.clearDockPosition();
      return;
    }

    const hudRect = hudRoot.getBoundingClientRect();
    if (hudRect.width <= 0 || hudRect.height <= 0) {
      this.clearDockPosition();
      return;
    }

    const top = Math.round(hudRect.bottom + 12);
    panel.style.left = `${Math.round(hudRect.left)}px`;
    panel.style.top = `${top}px`;
    panel.style.width = `${Math.round(hudRect.width)}px`;
    panel.style.maxHeight = `calc(100vh - ${top}px - 16px - var(--safe-bottom))`;
  }

  private clearDockPosition(): void {
    const panel = this.elements.panel;
    if (!panel) {
      return;
    }

    panel.style.removeProperty('left');
    panel.style.removeProperty('top');
    panel.style.removeProperty('width');
    panel.style.removeProperty('max-height');
  }
}

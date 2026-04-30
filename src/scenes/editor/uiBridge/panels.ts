import {
  colorNumberToCssHex,
  colorNumberToCssRgba,
  colorNumberToCssRgb,
  getTilesetUiTheme,
} from '../../../config';
import type { EditorUiElements } from './elements';
import type { EditorInspectorState, EditorUiViewModel } from './model';

export function renderEditorUiViewModel(
  elements: EditorUiElements,
  doc: Document,
  viewModel: EditorUiViewModel,
): void {
  setValue(elements.roomTitleInput, viewModel.roomTitleValue);
  setText(elements.roomCoordsEls, viewModel.roomCoordinatesText);
  elements.separatorEl?.classList.toggle('hidden', false);
  renderSaveStatus(doc, elements.saveStatusEls, viewModel);
  setHidden(elements.publishNudgeRoot, !viewModel.publishNudgeVisible);
  setText(elements.publishNudgeTextEl, viewModel.publishNudgeText);
  setButtonText(elements.publishNudgeActionBtn, viewModel.publishNudgeActionText);
  resetSaveStatusTone(elements.saveStatusEls);
  setText(elements.zoomEls, viewModel.zoomText);

  setHidden(elements.backBtn, viewModel.backButtonHidden);
  setButtonText(elements.backBtn, viewModel.backButtonText);
  setButtonTitle(elements.backBtn, viewModel.backButtonTitle);
  setHidden(elements.playBtn, viewModel.playHidden);
  setHidden(elements.saveBtn, viewModel.saveHidden);
  setButtonText(elements.saveBtn, viewModel.saveButtonText);
  setButtonTitle(elements.saveBtn, viewModel.saveButtonTitle);
  setDisabled(elements.saveBtn, viewModel.saveDisabled);
  setHidden(elements.publishBtn, viewModel.publishHidden);
  setButtonText(elements.publishBtn, viewModel.publishButtonText);
  setButtonTitle(elements.publishBtn, viewModel.publishButtonTitle);
  setDisabled(elements.publishBtn, viewModel.publishDisabled);
  setAriaDisabled(elements.publishBtn, viewModel.publishButtonAriaDisabled);
  setHidden(elements.mintBtn, viewModel.mintHidden);
  setDisabled(elements.mintBtn, viewModel.mintDisabled);
  setButtonText(elements.mintBtn, viewModel.mintButtonText);
  setHidden(elements.refreshMetadataBtn, viewModel.refreshMetadataHidden);
  setDisabled(elements.refreshMetadataBtn, viewModel.refreshMetadataDisabled);
  setButtonText(elements.refreshMetadataBtn, viewModel.refreshMetadataButtonText);
  setHidden(elements.historyBtn, viewModel.historyHidden);
  setDisabled(elements.historyBtn, viewModel.historyDisabled);
  setHidden(elements.fitBtns, viewModel.fitHidden);

  renderGoalPanel(elements, viewModel);
  renderCourseGoalPanel(elements, viewModel);
}

export function renderInspectorPanel(
  elements: EditorUiElements,
  state: EditorInspectorState,
): void {
  setHidden(elements.inspectorRoot, !state.visible);
  setHidden(elements.pressurePanel, !state.pressureVisible);
  setText(elements.pressureStatus, state.pressureStatusText);
  setHidden(elements.pressureConnectBtn, state.pressureConnectHidden);
  setDisabled(elements.pressureConnectBtn, state.pressureConnectDisabled);
  if (elements.pressureConnectBtn) {
    elements.pressureConnectBtn.title = state.pressureConnectTitle;
  }
  setHidden(elements.pressureClearBtn, state.pressureClearHidden);
  setDisabled(elements.pressureClearBtn, state.pressureClearDisabled);
  setHidden(elements.pressureDoneLaterBtn, state.pressureDoneLaterHidden);
  setHidden(elements.containerPanel, !state.containerVisible);
  setText(elements.containerStatus, state.containerStatusText);
  setDisabled(elements.containerClearBtn, state.containerClearDisabled);
  if (elements.containerClearBtn) {
    elements.containerClearBtn.title = state.containerClearTitle;
  }
  setHidden(elements.swordsmanPanel, !state.swordsmanVisible);
  setText(elements.swordsmanStatus, state.swordsmanStatusText);
  setValue(elements.swordsmanObjectiveModeSelect, state.swordsmanObjectiveModeValue);
  setDisabled(elements.swordsmanObjectiveModeSelect, state.swordsmanObjectiveModeDisabled);
  setValue(elements.swordsmanDefeatModeSelect, state.swordsmanDefeatModeValue);
  setDisabled(elements.swordsmanDefeatModeSelect, state.swordsmanDefeatModeDisabled);
}

function renderGoalPanel(elements: EditorUiElements, viewModel: EditorUiViewModel): void {
  setValue(elements.goalTypeSelect, viewModel.goal.goalTypeValue);
  setDisabled(elements.goalTypeSelect, viewModel.goal.goalTypeDisabled);
  setHidden(elements.goalContextNote, viewModel.goal.contextHidden);
  setText(elements.goalContextNote, viewModel.goal.contextText);
  setHidden(elements.timeLimitRow, viewModel.goal.timeLimitHidden);
  setDisabled(elements.timeLimitInput, viewModel.goal.timeLimitDisabled);
  setValue(elements.timeLimitInput, viewModel.goal.timeLimitValue);
  setHidden(elements.requiredCountRow, viewModel.goal.requiredCountHidden);
  setDisabled(elements.requiredCountInput, viewModel.goal.requiredCountDisabled);
  setValue(elements.requiredCountInput, viewModel.goal.requiredCountValue);
  setHidden(elements.survivalRow, viewModel.goal.survivalHidden);
  setDisabled(elements.survivalInput, viewModel.goal.survivalDisabled);
  setValue(elements.survivalInput, viewModel.goal.survivalValue);
  setHidden(elements.goalIntroRow, viewModel.goal.introTextHidden);
  setDisabled(elements.goalIntroInput, viewModel.goal.introTextDisabled);
  setValue(elements.goalIntroInput, viewModel.goal.introTextValue);
  setHidden(elements.markerControls, viewModel.goal.markerControlsHidden);
  setHidden(elements.placementHint, viewModel.goal.placementHintHidden);
  setText(elements.placementHint, viewModel.goal.placementHintText);
  setText(elements.summary, viewModel.goal.summaryText);
  setHidden(elements.placeStartBtn, viewModel.goal.placeStartHidden);
  setActive(elements.placeStartBtn, viewModel.goal.placeStartActive);
  setHidden(elements.placeExitBtn, viewModel.goal.placeExitHidden);
  setActive(elements.placeExitBtn, viewModel.goal.placeExitActive);
  setHidden(elements.addCheckpointBtn, viewModel.goal.addCheckpointHidden);
  setActive(elements.addCheckpointBtn, viewModel.goal.addCheckpointActive);
  setHidden(elements.placeFinishBtn, viewModel.goal.placeFinishHidden);
  setActive(elements.placeFinishBtn, viewModel.goal.placeFinishActive);
}

function renderCourseGoalPanel(elements: EditorUiElements, viewModel: EditorUiViewModel): void {
  setHidden(elements.courseRoot, !viewModel.course.visible);
  setHidden(elements.courseStatus, viewModel.course.statusHidden);
  setText(elements.courseStatus, viewModel.course.statusText);
  setHidden(elements.courseRoomStep, viewModel.course.roomStepText.length === 0);
  setText(elements.courseRoomStep, viewModel.course.roomStepText);
  setValue(elements.courseGoalTypeSelect, viewModel.course.goalTypeValue);
  setDisabled(elements.courseGoalTypeSelect, viewModel.course.goalTypeDisabled);
  setHidden(elements.courseTimeLimitRow, viewModel.course.timeLimitHidden);
  setDisabled(elements.courseTimeLimitInput, viewModel.course.timeLimitDisabled);
  setValue(elements.courseTimeLimitInput, viewModel.course.timeLimitValue);
  setHidden(elements.courseRequiredCountRow, viewModel.course.requiredCountHidden);
  setDisabled(elements.courseRequiredCountInput, viewModel.course.requiredCountDisabled);
  setValue(elements.courseRequiredCountInput, viewModel.course.requiredCountValue);
  setHidden(elements.courseSurvivalRow, viewModel.course.survivalHidden);
  setDisabled(elements.courseSurvivalInput, viewModel.course.survivalDisabled);
  setValue(elements.courseSurvivalInput, viewModel.course.survivalValue);
  setHidden(elements.courseMarkerControls, viewModel.course.markerControlsHidden);
  setHidden(elements.coursePlacementHint, viewModel.course.placementHintHidden);
  setText(elements.coursePlacementHint, viewModel.course.placementHintText);
  setText(elements.courseSummary, viewModel.course.summaryText);
  setHidden(elements.coursePlaceStartBtn, viewModel.course.placeStartHidden);
  setActive(elements.coursePlaceStartBtn, viewModel.course.placeStartActive);
  setHidden(elements.coursePlaceExitBtn, viewModel.course.placeExitHidden);
  setActive(elements.coursePlaceExitBtn, viewModel.course.placeExitActive);
  setHidden(elements.courseAddCheckpointBtn, viewModel.course.addCheckpointHidden);
  setActive(elements.courseAddCheckpointBtn, viewModel.course.addCheckpointActive);
  setHidden(elements.coursePlaceFinishBtn, viewModel.course.placeFinishHidden);
  setActive(elements.coursePlaceFinishBtn, viewModel.course.placeFinishActive);
}

export function setText(elements: HTMLElement | HTMLElement[] | null, text: string): void {
  const targets = Array.isArray(elements) ? elements : elements ? [elements] : [];
  for (const element of targets) {
    if (element.textContent !== text) {
      element.textContent = text;
    }
  }
}

export function setValue(
  element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null,
  value: string,
): void {
  if (!element) {
    return;
  }

  if (element.ownerDocument.activeElement === element && element.value !== value) {
    return;
  }

  if (element.value !== value) {
    element.value = value;
  }
}

export function setDisabled(
  element: HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null,
  disabled: boolean,
): void {
  if (element && element.disabled !== disabled) {
    element.disabled = disabled;
  }
}

export function setAriaDisabled(element: HTMLElement | null, disabled: boolean): void {
  if (!element) {
    return;
  }

  if (disabled) {
    element.setAttribute('aria-disabled', 'true');
    return;
  }

  element.removeAttribute('aria-disabled');
}

export function setHidden(element: HTMLElement | HTMLElement[] | null, hidden: boolean): void {
  const targets = Array.isArray(element) ? element : element ? [element] : [];
  for (const target of targets) {
    target.classList.toggle('hidden', hidden);
  }
}

export function setActive(element: HTMLElement | null, active: boolean): void {
  if (element) {
    element.classList.toggle('active', active);
  }
}

export function setButtonText(element: HTMLButtonElement | null, text: string): void {
  if (!element) {
    return;
  }

  const labelTarget = element.querySelector<HTMLElement>('[data-button-label]');
  if (labelTarget) {
    if (labelTarget.textContent !== text) {
      labelTarget.textContent = text;
    }
    return;
  }

  if (element.textContent !== text) {
    element.textContent = text;
  }
}

export function setButtonTitle(element: HTMLButtonElement | null, title: string): void {
  if (!element) {
    return;
  }
  if (element.title !== title) {
    element.title = title;
  }
}

export function resetSaveStatusTone(elements: HTMLElement[]): void {
  for (const element of elements) {
    element.removeAttribute('data-overworld-tone');
  }
}

export function applyTilesetTheme(doc: Document, selectedTilesetKey: string): void {
  const root = doc.documentElement;
  const theme = getTilesetUiTheme(selectedTilesetKey);
  root.style.setProperty('--accent-cool', colorNumberToCssHex(theme.accentCool));
  root.style.setProperty('--accent-cool-rgb', colorNumberToCssRgb(theme.accentCool));
  root.style.setProperty('--accent-cool-soft', colorNumberToCssRgba(theme.accentCool, 0.18));
  root.style.setProperty('--accent-warm', colorNumberToCssHex(theme.accentWarm));
  root.style.setProperty('--accent-warm-rgb', colorNumberToCssRgb(theme.accentWarm));
  root.style.setProperty('--accent-warm-soft', colorNumberToCssRgba(theme.accentWarm, 0.18));
  root.style.setProperty('--accent-hot', colorNumberToCssHex(theme.accentHot));
  root.style.setProperty('--accent-hot-rgb', colorNumberToCssRgb(theme.accentHot));
  root.style.setProperty('--accent-hot-soft', colorNumberToCssRgba(theme.accentHot, 0.18));
  root.style.setProperty('--accent-alt', colorNumberToCssHex(theme.accentAlt));
  root.style.setProperty('--accent-alt-rgb', colorNumberToCssRgb(theme.accentAlt));
  root.style.setProperty('--accent-alt-soft', colorNumberToCssRgba(theme.accentAlt, 0.18));
  root.style.setProperty('--accent-soft', colorNumberToCssHex(theme.accentAlt));
}

function renderSaveStatus(
  doc: Document,
  elements: HTMLElement[],
  viewModel: EditorUiViewModel,
): void {
  for (const element of elements) {
    element.replaceChildren();

    const hasRichStatus =
      viewModel.saveStatusAccentText.length > 0 || viewModel.saveStatusLinkText.length > 0;
    element.classList.toggle('editor-save-status-rich', hasRichStatus);

    if (viewModel.saveStatusAccentText) {
      const accent = doc.createElement('span');
      accent.className = 'editor-save-status-accent';
      accent.textContent = viewModel.saveStatusAccentText;
      element.append(accent);
    }

    if (viewModel.saveStatusText) {
      if (element.childNodes.length > 0) {
        element.append(doc.createTextNode(' '));
      }
      element.append(doc.createTextNode(viewModel.saveStatusText));
    }

    if (viewModel.saveStatusLinkText && viewModel.saveStatusLinkHref) {
      if (element.childNodes.length > 0) {
        element.append(doc.createTextNode(' '));
      }
      const link = doc.createElement('a');
      link.className = 'editor-save-status-link';
      link.href = viewModel.saveStatusLinkHref;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = viewModel.saveStatusLinkText;
      element.append(link);
    }
  }
}

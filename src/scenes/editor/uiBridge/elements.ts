export interface EditorUiElements {
  roomTitleInput: HTMLInputElement | null;
  roomCoordsEls: HTMLElement[];
  separatorEl: HTMLElement | null;
  saveStatusEls: HTMLElement[];
  publishNudgeRoot: HTMLElement | null;
  publishNudgeTextEl: HTMLElement | null;
  publishNudgeActionBtn: HTMLButtonElement | null;
  zoomEls: HTMLElement[];
  backBtn: HTMLButtonElement | null;
  playBtn: HTMLButtonElement | null;
  saveBtn: HTMLButtonElement | null;
  publishBtn: HTMLButtonElement | null;
  mintBtn: HTMLButtonElement | null;
  refreshMetadataBtn: HTMLButtonElement | null;
  historyBtn: HTMLButtonElement | null;
  fitBtns: HTMLButtonElement[];
  mobileZoomInBtn: HTMLButtonElement | null;
  mobileZoomOutBtn: HTMLButtonElement | null;
  toolButtons: HTMLButtonElement[];
  featureButtons: HTMLButtonElement[];
  featureStatus: HTMLElement | null;
  goalRoot: HTMLElement | null;
  lightingFeaturePanel: HTMLElement | null;
  moreToolsButtons: HTMLButtonElement[];
  moreToolsPanels: HTMLElement[];
  eraseControls: HTMLElement[];
  tileEraseControls: HTMLElement[];
  eraseBrushSelects: HTMLSelectElement[];
  clearLayerButtons: HTMLButtonElement[];
  clearAllButtons: HTMLButtonElement[];
  clearObjectButtons: HTMLButtonElement[];
  layerButtons: HTMLElement[];
  layerMiniButtons: HTMLElement[];
  layerChip: HTMLElement | null;
  layerGuideButton: HTMLButtonElement | null;
  tilesetSelect: HTMLSelectElement | null;
  flipXButton: HTMLButtonElement | null;
  flipYButton: HTMLButtonElement | null;
  paletteTabs: HTMLElement[];
  tilesetSection: HTMLElement | null;
  tilePaletteSection: HTMLElement | null;
  objectPaletteSection: HTMLElement | null;
  smartPaletteSection: HTMLElement | null;
  smartThemeSelect: HTMLSelectElement | null;
  smartMaterialSelect: HTMLSelectElement | null;
  smartDetailsCheckbox: HTMLInputElement | null;
  smartCaveFillButton: HTMLButtonElement | null;
  objectCategoryTabs: HTMLElement[];
  backgroundSelect: HTMLSelectElement | null;
  backgroundSolidControls: HTMLElement | null;
  backgroundSolidColorInput: HTMLInputElement | null;
  backgroundSolidColorValue: HTMLElement | null;
  backgroundSolidCard: HTMLButtonElement | null;
  backgroundUploadControls: HTMLElement | null;
  backgroundUploadButton: HTMLButtonElement | null;
  backgroundUploadCard: HTMLButtonElement | null;
  backgroundUploadInput: HTMLInputElement | null;
  backgroundUploadStatus: HTMLElement | null;
  backgroundPhotosButton: HTMLButtonElement | null;
  backgroundPhotoSelected: HTMLElement | null;
  backgroundPhotoFitControls: HTMLElement | null;
  backgroundPhotoFitButtons: HTMLButtonElement[];
  backgroundPhotosModal: HTMLElement | null;
  backgroundPhotosCloseButton: HTMLButtonElement | null;
  backgroundPhotosSort: HTMLSelectElement | null;
  backgroundPhotosStatus: HTMLElement | null;
  backgroundPhotosGrid: HTMLElement | null;
  backgroundUploadModal: HTMLElement | null;
  backgroundUploadModalCloseButton: HTMLButtonElement | null;
  backgroundUploadModalTitle: HTMLElement | null;
  backgroundUploadModalMeta: HTMLElement | null;
  backgroundUploadModalStatus: HTMLElement | null;
  backgroundUploadProgressBar: HTMLElement | null;
  lightingSelect: HTMLSelectElement | null;
  lightingTuningControls: HTMLElement | null;
  lightingDarknessInput: HTMLInputElement | null;
  lightingDarknessValue: HTMLElement | null;
  lightingRadiusInput: HTMLInputElement | null;
  lightingRadiusValue: HTMLElement | null;
  weatherSelect: HTMLSelectElement | null;
  weatherTuningControls: HTMLElement | null;
  weatherIntensityInput: HTMLInputElement | null;
  weatherIntensityValue: HTMLElement | null;
  backgroundButtons: HTMLButtonElement[];
  goalTypeSelect: HTMLSelectElement | null;
  npcQuestTypeRow: HTMLElement | null;
  npcQuestTypeSelect: HTMLSelectElement | null;
  goalContextNote: HTMLElement | null;
  timeLimitRow: HTMLElement | null;
  timeLimitInput: HTMLInputElement | null;
  requiredCountRow: HTMLElement | null;
  requiredCountInput: HTMLInputElement | null;
  survivalRow: HTMLElement | null;
  survivalInput: HTMLInputElement | null;
  goalIntroRow: HTMLElement | null;
  goalIntroInput: HTMLTextAreaElement | null;
  markerControls: HTMLElement | null;
  placementHint: HTMLElement | null;
  summary: HTMLElement | null;
  placeStartBtn: HTMLButtonElement | null;
  placeExitBtn: HTMLButtonElement | null;
  addCheckpointBtn: HTMLButtonElement | null;
  placeFinishBtn: HTMLButtonElement | null;
  linkNpcBtn: HTMLButtonElement | null;
  placeNpcDestinationBtn: HTMLButtonElement | null;
  clearGoalMarkersBtn: HTMLButtonElement | null;
  courseRoot: HTMLElement | null;
  courseStatus: HTMLElement | null;
  courseRoomStep: HTMLElement | null;
  courseGoalTypeSelect: HTMLSelectElement | null;
  courseTimeLimitRow: HTMLElement | null;
  courseTimeLimitInput: HTMLInputElement | null;
  courseRequiredCountRow: HTMLElement | null;
  courseRequiredCountInput: HTMLInputElement | null;
  courseSurvivalRow: HTMLElement | null;
  courseSurvivalInput: HTMLInputElement | null;
  courseMarkerControls: HTMLElement | null;
  coursePlacementHint: HTMLElement | null;
  courseSummary: HTMLElement | null;
  coursePlaceStartBtn: HTMLButtonElement | null;
  coursePlaceExitBtn: HTMLButtonElement | null;
  courseAddCheckpointBtn: HTMLButtonElement | null;
  coursePlaceFinishBtn: HTMLButtonElement | null;
  courseClearMarkersBtn: HTMLButtonElement | null;
  inspectorRoot: HTMLElement | null;
  pressurePanel: HTMLElement | null;
  pressureStatus: HTMLElement | null;
  pressureConnectBtn: HTMLButtonElement | null;
  pressureClearBtn: HTMLButtonElement | null;
  pressureDoneLaterBtn: HTMLButtonElement | null;
  containerPanel: HTMLElement | null;
  containerStatus: HTMLElement | null;
  containerClearBtn: HTMLButtonElement | null;
  swordsmanPanel: HTMLElement | null;
  swordsmanStatus: HTMLElement | null;
  swordsmanObjectiveModeSelect: HTMLSelectElement | null;
  swordsmanDefeatModeSelect: HTMLSelectElement | null;
  policePanel: HTMLElement | null;
  policeStatus: HTMLElement | null;
  policeBehaviorModeSelect: HTMLSelectElement | null;
  policePatrolShootsRow: HTMLElement | null;
  policePatrolShootsCheckbox: HTMLInputElement | null;
  npcPanel: HTMLElement | null;
  npcStatus: HTMLElement | null;
  npcModeSelect: HTMLSelectElement | null;
  npcPushableRow: HTMLElement | null;
  npcPushableCheckbox: HTMLInputElement | null;
  npcJumpFallRow: HTMLElement | null;
  npcJumpFallCheckbox: HTMLInputElement | null;
  npcPlayerCollisionCheckbox: HTMLInputElement | null;
  npcFriendlyFireCheckbox: HTMLInputElement | null;
  npcNameInput: HTMLInputElement | null;
  npcDialogueInput: HTMLTextAreaElement | null;
  npcDefeatModeSelect: HTMLSelectElement | null;
}

function byId<T extends HTMLElement>(doc: Document, id: string): T | null {
  return doc.getElementById(id) as T | null;
}

function all<T extends Element>(doc: Document, selector: string): T[] {
  return Array.from(doc.querySelectorAll<T>(selector));
}

function existing<T extends HTMLElement>(elements: Array<T | null>): T[] {
  return elements.filter((element): element is T => Boolean(element));
}

export function lookupEditorUiElements(doc: Document): EditorUiElements {
  return {
    roomTitleInput: byId<HTMLInputElement>(doc, 'room-title-input'),
    roomCoordsEls: existing([
      byId<HTMLElement>(doc, 'room-coords'),
      byId<HTMLElement>(doc, 'mobile-editor-room-coords'),
    ]),
    separatorEl: doc.querySelector<HTMLElement>('#bottom-bar .separator'),
    saveStatusEls: existing([
      byId<HTMLElement>(doc, 'editor-top-save-status'),
      byId<HTMLElement>(doc, 'room-save-status'),
      byId<HTMLElement>(doc, 'mobile-editor-save-status'),
    ]),
    publishNudgeRoot: byId<HTMLElement>(doc, 'editor-publish-nudge'),
    publishNudgeTextEl: byId<HTMLElement>(doc, 'editor-publish-nudge-text'),
    publishNudgeActionBtn: byId<HTMLButtonElement>(doc, 'btn-editor-publish-nudge'),
    zoomEls: existing([
      byId<HTMLElement>(doc, 'zoom-level'),
      byId<HTMLElement>(doc, 'mobile-editor-zoom-level'),
    ]),
    backBtn: byId<HTMLButtonElement>(doc, 'btn-editor-back'),
    playBtn: byId<HTMLButtonElement>(doc, 'btn-test-play'),
    saveBtn: byId<HTMLButtonElement>(doc, 'btn-save-draft'),
    publishBtn: byId<HTMLButtonElement>(doc, 'btn-publish-room'),
    mintBtn: byId<HTMLButtonElement>(doc, 'btn-mint-room'),
    refreshMetadataBtn: byId<HTMLButtonElement>(doc, 'btn-refresh-room-metadata'),
    historyBtn: byId<HTMLButtonElement>(doc, 'btn-room-history'),
    fitBtns: existing([
      byId<HTMLButtonElement>(doc, 'btn-fit-screen'),
      byId<HTMLButtonElement>(doc, 'btn-mobile-editor-fit'),
    ]),
    mobileZoomInBtn: byId<HTMLButtonElement>(doc, 'btn-mobile-editor-zoom-in'),
    mobileZoomOutBtn: byId<HTMLButtonElement>(doc, 'btn-mobile-editor-zoom-out'),
    toolButtons: all<HTMLButtonElement>(doc, '.tool-btn[data-tool]'),
    featureButtons: all<HTMLButtonElement>(doc, '[data-editor-feature]'),
    featureStatus: byId<HTMLElement>(doc, 'editor-feature-launcher-status'),
    goalRoot: byId<HTMLElement>(doc, 'goal-section'),
    lightingFeaturePanel: byId<HTMLElement>(doc, 'editor-lighting-feature-panel'),
    moreToolsButtons: all<HTMLButtonElement>(doc, '.editor-more-tools-toggle'),
    moreToolsPanels: all<HTMLElement>(doc, '.editor-more-tools-panel'),
    eraseControls: all<HTMLElement>(doc, '.editor-eraser-controls'),
    tileEraseControls: all<HTMLElement>(doc, '.editor-tile-erase-control'),
    eraseBrushSelects: all<HTMLSelectElement>(doc, '.editor-erase-brush-select'),
    clearLayerButtons: all<HTMLButtonElement>(doc, '.editor-clear-layer-btn'),
    clearAllButtons: all<HTMLButtonElement>(doc, '.editor-clear-all-btn'),
    clearObjectButtons: all<HTMLButtonElement>(doc, '.editor-clear-objects-btn'),
    layerButtons: all<HTMLElement>(doc, '.layer-btn'),
    layerMiniButtons: all<HTMLElement>(doc, '.layer-stack-mini-btn'),
    layerChip: byId<HTMLElement>(doc, 'editor-layer-chip'),
    layerGuideButton: byId<HTMLButtonElement>(doc, 'btn-editor-layer-guides'),
    tilesetSelect: byId<HTMLSelectElement>(doc, 'tileset-select'),
    flipXButton: byId<HTMLButtonElement>(doc, 'btn-tile-flip-x'),
    flipYButton: byId<HTMLButtonElement>(doc, 'btn-tile-flip-y'),
    paletteTabs: all<HTMLElement>(doc, '.palette-tab'),
    tilesetSection: byId<HTMLElement>(doc, 'tileset-section'),
    tilePaletteSection: byId<HTMLElement>(doc, 'tile-palette-section'),
    objectPaletteSection: byId<HTMLElement>(doc, 'object-palette-section'),
    smartPaletteSection: byId<HTMLElement>(doc, 'smart-palette-section'),
    smartThemeSelect: byId<HTMLSelectElement>(doc, 'smart-theme-select'),
    smartMaterialSelect: byId<HTMLSelectElement>(doc, 'smart-material-select'),
    smartDetailsCheckbox: byId<HTMLInputElement>(doc, 'smart-details-checkbox'),
    smartCaveFillButton: byId<HTMLButtonElement>(doc, 'btn-smart-cave-fill'),
    objectCategoryTabs: all<HTMLElement>(doc, '.obj-cat-tab'),
    backgroundSelect: byId<HTMLSelectElement>(doc, 'background-select'),
    backgroundSolidControls: byId<HTMLElement>(doc, 'background-solid-controls'),
    backgroundSolidColorInput: byId<HTMLInputElement>(doc, 'background-solid-color-input'),
    backgroundSolidColorValue: byId<HTMLElement>(doc, 'background-solid-color-value'),
    backgroundSolidCard: byId<HTMLButtonElement>(doc, 'background-solid-card'),
    backgroundUploadControls: byId<HTMLElement>(doc, 'background-upload-controls'),
    backgroundUploadButton: byId<HTMLButtonElement>(doc, 'background-upload-button'),
    backgroundUploadCard: byId<HTMLButtonElement>(doc, 'background-upload-card'),
    backgroundUploadInput: byId<HTMLInputElement>(doc, 'background-upload-input'),
    backgroundUploadStatus: byId<HTMLElement>(doc, 'background-upload-status'),
    backgroundPhotosButton: byId<HTMLButtonElement>(doc, 'background-photos-button'),
    backgroundPhotoSelected: byId<HTMLElement>(doc, 'background-photo-selected'),
    backgroundPhotoFitControls: byId<HTMLElement>(doc, 'background-photo-fit-controls'),
    backgroundPhotoFitButtons: all<HTMLButtonElement>(doc, '[data-background-photo-fit]'),
    backgroundPhotosModal: byId<HTMLElement>(doc, 'background-photos-modal'),
    backgroundPhotosCloseButton: byId<HTMLButtonElement>(doc, 'btn-background-photos-close'),
    backgroundPhotosSort: byId<HTMLSelectElement>(doc, 'background-photos-sort'),
    backgroundPhotosStatus: byId<HTMLElement>(doc, 'background-photos-status'),
    backgroundPhotosGrid: byId<HTMLElement>(doc, 'background-photos-grid'),
    backgroundUploadModal: byId<HTMLElement>(doc, 'background-upload-modal'),
    backgroundUploadModalCloseButton: byId<HTMLButtonElement>(
      doc,
      'btn-background-upload-modal-close',
    ),
    backgroundUploadModalTitle: byId<HTMLElement>(doc, 'background-upload-modal-title'),
    backgroundUploadModalMeta: byId<HTMLElement>(doc, 'background-upload-modal-meta'),
    backgroundUploadModalStatus: byId<HTMLElement>(doc, 'background-upload-modal-status'),
    backgroundUploadProgressBar: byId<HTMLElement>(doc, 'background-upload-progress-bar'),
    lightingSelect: byId<HTMLSelectElement>(doc, 'lighting-mode-select'),
    lightingTuningControls: byId<HTMLElement>(doc, 'lighting-tuning-controls'),
    lightingDarknessInput: byId<HTMLInputElement>(doc, 'lighting-darkness-range'),
    lightingDarknessValue: byId<HTMLElement>(doc, 'lighting-darkness-value'),
    lightingRadiusInput: byId<HTMLInputElement>(doc, 'lighting-radius-range'),
    lightingRadiusValue: byId<HTMLElement>(doc, 'lighting-radius-value'),
    weatherSelect: byId<HTMLSelectElement>(doc, 'weather-mode-select'),
    weatherTuningControls: byId<HTMLElement>(doc, 'weather-tuning-controls'),
    weatherIntensityInput: byId<HTMLInputElement>(doc, 'weather-intensity-range'),
    weatherIntensityValue: byId<HTMLElement>(doc, 'weather-intensity-value'),
    backgroundButtons: all<HTMLButtonElement>(doc, '[data-background-id]'),
    goalTypeSelect: byId<HTMLSelectElement>(doc, 'goal-type-select'),
    npcQuestTypeRow: byId<HTMLElement>(doc, 'goal-npc-quest-type-row'),
    npcQuestTypeSelect: byId<HTMLSelectElement>(doc, 'goal-npc-quest-type'),
    goalContextNote: byId<HTMLElement>(doc, 'goal-context-note'),
    timeLimitRow: byId<HTMLElement>(doc, 'goal-time-limit-row'),
    timeLimitInput: byId<HTMLInputElement>(doc, 'goal-time-limit-seconds'),
    requiredCountRow: byId<HTMLElement>(doc, 'goal-required-count-row'),
    requiredCountInput: byId<HTMLInputElement>(doc, 'goal-required-count'),
    survivalRow: byId<HTMLElement>(doc, 'goal-survival-row'),
    survivalInput: byId<HTMLInputElement>(doc, 'goal-survival-seconds'),
    goalIntroRow: byId<HTMLElement>(doc, 'goal-intro-text-row'),
    goalIntroInput: byId<HTMLTextAreaElement>(doc, 'goal-intro-text'),
    markerControls: byId<HTMLElement>(doc, 'goal-marker-controls'),
    placementHint: byId<HTMLElement>(doc, 'goal-placement-hint'),
    summary: byId<HTMLElement>(doc, 'goal-summary'),
    placeStartBtn: byId<HTMLButtonElement>(doc, 'btn-goal-place-start'),
    placeExitBtn: byId<HTMLButtonElement>(doc, 'btn-goal-place-exit'),
    addCheckpointBtn: byId<HTMLButtonElement>(doc, 'btn-goal-add-checkpoint'),
    placeFinishBtn: byId<HTMLButtonElement>(doc, 'btn-goal-place-finish'),
    linkNpcBtn: byId<HTMLButtonElement>(doc, 'btn-goal-link-npc'),
    placeNpcDestinationBtn: byId<HTMLButtonElement>(doc, 'btn-goal-place-npc-destination'),
    clearGoalMarkersBtn: byId<HTMLButtonElement>(doc, 'btn-goal-clear-markers'),
    courseRoot: byId<HTMLElement>(doc, 'course-goal-section'),
    courseStatus: byId<HTMLElement>(doc, 'course-editor-status'),
    courseRoomStep: byId<HTMLElement>(doc, 'course-editor-room-step'),
    courseGoalTypeSelect: byId<HTMLSelectElement>(doc, 'course-editor-goal-type-select'),
    courseTimeLimitRow: byId<HTMLElement>(doc, 'course-editor-time-limit-row'),
    courseTimeLimitInput: byId<HTMLInputElement>(doc, 'course-editor-time-limit-seconds'),
    courseRequiredCountRow: byId<HTMLElement>(doc, 'course-editor-required-count-row'),
    courseRequiredCountInput: byId<HTMLInputElement>(doc, 'course-editor-required-count'),
    courseSurvivalRow: byId<HTMLElement>(doc, 'course-editor-survival-row'),
    courseSurvivalInput: byId<HTMLInputElement>(doc, 'course-editor-survival-seconds'),
    courseMarkerControls: byId<HTMLElement>(doc, 'course-editor-marker-controls'),
    coursePlacementHint: byId<HTMLElement>(doc, 'course-editor-placement-hint'),
    courseSummary: byId<HTMLElement>(doc, 'course-editor-summary'),
    coursePlaceStartBtn: byId<HTMLButtonElement>(doc, 'btn-course-editor-place-start'),
    coursePlaceExitBtn: byId<HTMLButtonElement>(doc, 'btn-course-editor-place-exit'),
    courseAddCheckpointBtn: byId<HTMLButtonElement>(doc, 'btn-course-editor-add-checkpoint'),
    coursePlaceFinishBtn: byId<HTMLButtonElement>(doc, 'btn-course-editor-place-finish'),
    courseClearMarkersBtn: byId<HTMLButtonElement>(doc, 'btn-course-editor-clear-markers'),
    inspectorRoot: byId<HTMLElement>(doc, 'editor-inspector'),
    pressurePanel: byId<HTMLElement>(doc, 'pressure-plate-panel'),
    pressureStatus: byId<HTMLElement>(doc, 'pressure-plate-status'),
    pressureConnectBtn: byId<HTMLButtonElement>(doc, 'btn-pressure-plate-connect'),
    pressureClearBtn: byId<HTMLButtonElement>(doc, 'btn-pressure-plate-clear'),
    pressureDoneLaterBtn: byId<HTMLButtonElement>(doc, 'btn-pressure-plate-done-later'),
    containerPanel: byId<HTMLElement>(doc, 'container-contents-panel'),
    containerStatus: byId<HTMLElement>(doc, 'container-contents-status'),
    containerClearBtn: byId<HTMLButtonElement>(doc, 'btn-container-clear'),
    swordsmanPanel: byId<HTMLElement>(doc, 'swordsman-objective-panel'),
    swordsmanStatus: byId<HTMLElement>(doc, 'swordsman-objective-status'),
    swordsmanObjectiveModeSelect: byId<HTMLSelectElement>(
      doc,
      'swordsman-objective-mode-select',
    ),
    swordsmanDefeatModeSelect: byId<HTMLSelectElement>(doc, 'swordsman-defeat-mode-select'),
    policePanel: byId<HTMLElement>(doc, 'police-behavior-panel'),
    policeStatus: byId<HTMLElement>(doc, 'police-behavior-status'),
    policeBehaviorModeSelect: byId<HTMLSelectElement>(doc, 'police-behavior-mode-select'),
    policePatrolShootsRow: byId<HTMLElement>(doc, 'police-patrol-shoots-row'),
    policePatrolShootsCheckbox: byId<HTMLInputElement>(doc, 'police-patrol-shoots-checkbox'),
    npcPanel: byId<HTMLElement>(doc, 'npc-objective-panel'),
    npcStatus: byId<HTMLElement>(doc, 'npc-objective-status'),
    npcModeSelect: byId<HTMLSelectElement>(doc, 'npc-mode-select'),
    npcPushableRow: byId<HTMLElement>(doc, 'npc-pushable-row'),
    npcPushableCheckbox: byId<HTMLInputElement>(doc, 'npc-pushable-checkbox'),
    npcJumpFallRow: byId<HTMLElement>(doc, 'npc-jump-fall-row'),
    npcJumpFallCheckbox: byId<HTMLInputElement>(doc, 'npc-jump-fall-checkbox'),
    npcPlayerCollisionCheckbox: byId<HTMLInputElement>(doc, 'npc-player-collision-checkbox'),
    npcFriendlyFireCheckbox: byId<HTMLInputElement>(doc, 'npc-friendly-fire-checkbox'),
    npcNameInput: byId<HTMLInputElement>(doc, 'npc-name-input'),
    npcDialogueInput: byId<HTMLTextAreaElement>(doc, 'npc-dialogue-input'),
    npcDefeatModeSelect: byId<HTMLSelectElement>(doc, 'npc-defeat-mode-select'),
  };
}

import {
  ERASER_BRUSH_SIZES,
  TILESETS,
  editorState,
  getTilesetByKey,
  type EraserBrushSize,
  type LayerName,
  type PaletteMode,
  type ToolName,
} from '../../config';
import type { CourseGoalType } from '../../courses/model';
import type { RoomGoalType } from '../../goals/roomGoals';
import type { RoomLightingMode } from '../../lighting/model';
import { AUTH_STATE_CHANGED_EVENT } from '../../auth/client';
import type { EditorMarkerPlacementMode } from '../../ui/setup/sceneBridge';
import { EDITOR_UI_STATE_CHANGED_EVENT } from './uiEvents';

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
  roomStepText: string;
  canReturnToCourseBuilder: boolean;
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

export interface EditorInspectorState {
  visible: boolean;
  pressureVisible: boolean;
  pressureStatusText: string;
  pressureConnectHidden: boolean;
  pressureConnectDisabled: boolean;
  pressureConnectTitle: string;
  pressureClearHidden: boolean;
  pressureClearDisabled: boolean;
  pressureDoneLaterHidden: boolean;
  containerVisible: boolean;
  containerStatusText: string;
  containerClearDisabled: boolean;
  containerClearTitle: string;
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
  backButtonHidden: boolean;
  backButtonText: string;
  backButtonTitle: string;
  playHidden: boolean;
  saveHidden: boolean;
  saveButtonText: string;
  saveButtonTitle: string;
  saveDisabled: boolean;
  publishHidden: boolean;
  publishButtonText: string;
  publishButtonTitle: string;
  publishDisabled: boolean;
  mintHidden: boolean;
  mintDisabled: boolean;
  mintButtonText: string;
  refreshMetadataHidden: boolean;
  refreshMetadataDisabled: boolean;
  refreshMetadataButtonText: string;
  historyHidden: boolean;
  historyDisabled: boolean;
  fitHidden: boolean;
  goal: EditorGoalUiViewModel;
  course: EditorCourseUiViewModel;
}

interface EditorUiPaletteController {
  renderPalette(): void;
  renderTilePreview(): void;
  setObjectCategory(category: string): void;
  updateSelection(
    tilesetKey: string,
    col1: number,
    row1: number,
    col2: number,
    row2: number,
  ): void;
}

interface EditorUiRuntimeConfig {
  paletteController: EditorUiPaletteController | null;
  closePanels: () => void;
  openHistory: () => void | Promise<void>;
}

export interface EditorUiBridgeActions {
  onRequestRender: () => void;
  onDocumentKeyDown: (event: KeyboardEvent) => void;
  onAuthStateChanged: () => void;
  onBack: () => void | Promise<void>;
  onStartPlayMode: () => void | Promise<void>;
  onSaveDraft: () => void | Promise<void>;
  onPublishRoom: () => void | Promise<void>;
  onPublishNudge: () => void | Promise<void>;
  onMintRoom: () => void | Promise<void>;
  onRefreshMintMetadata: () => void | Promise<void>;
  onFitToScreen: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onSetRoomTitle: (title: string | null) => void;
  onSelectTool: (tool: ToolName) => void;
  onClearCurrentLayer: () => void;
  onClearAllTiles: () => void;
  onSelectBackground: (backgroundId: string) => void;
  onSelectLighting: (mode: RoomLightingMode) => void;
  onSetGoalType: (nextType: RoomGoalType | null) => void;
  onSetGoalTimeLimitSeconds: (seconds: number | null) => void;
  onSetGoalRequiredCount: (requiredCount: number) => void;
  onSetGoalSurvivalSeconds: (seconds: number) => void;
  onStartGoalMarkerPlacement: (mode: EditorMarkerPlacementMode) => void;
  onClearGoalMarkers: () => void;
  onSetCourseGoalType: (goalType: CourseGoalType | null) => void;
  onSetCourseGoalTimeLimitSeconds: (seconds: number | null) => void;
  onSetCourseGoalRequiredCount: (requiredCount: number) => void;
  onSetCourseGoalSurvivalSeconds: (seconds: number) => void;
  onStartCourseGoalMarkerPlacement: (mode: EditorMarkerPlacementMode) => void;
  onClearCourseGoalMarkers: () => void;
  onBeginPressurePlateConnection: () => void;
  onClearPressurePlateConnection: () => void;
  onCancelPressurePlateConnection: () => void;
  onClearContainerContents: () => void;
}

const runtimeConfig: EditorUiRuntimeConfig = {
  paletteController: null,
  closePanels: () => {},
  openHistory: () => {},
};

const PREFERRED_TILESET_OPTION_ORDER = [
  'forest',
  'forest_2',
  'desert',
  'dirt',
  'lava',
  'snow',
  'water',
  'smb_lvl1_3_5',
] as const;

function getEditorTilesets(): typeof TILESETS {
  const preferredOrder = new Map<string, number>(
    PREFERRED_TILESET_OPTION_ORDER.map((key, index) => [key, index])
  );

  return [...TILESETS].sort((left, right) => {
    const leftOrder = preferredOrder.get(left.key);
    const rightOrder = preferredOrder.get(right.key);
    if (leftOrder !== undefined || rightOrder !== undefined) {
      return (leftOrder ?? Number.MAX_SAFE_INTEGER) - (rightOrder ?? Number.MAX_SAFE_INTEGER);
    }

    return left.name.localeCompare(right.name);
  });
}

export function configureEditorUiBridgeRuntime(config: Partial<EditorUiRuntimeConfig>): void {
  if (config.paletteController !== undefined) {
    runtimeConfig.paletteController = config.paletteController;
  }
  if (config.closePanels) {
    runtimeConfig.closePanels = config.closePanels;
  }
  if (config.openHistory) {
    runtimeConfig.openHistory = config.openHistory;
  }
}

function getLayerUiLabel(layer: LayerName): string {
  switch (layer) {
    case 'background':
      return 'Back';
    case 'foreground':
      return 'Front';
    case 'terrain':
    default:
      return 'Gameplay';
  }
}

export class EditorUiBridge {
  private readonly cleanupCallbacks: Array<() => void> = [];
  private readonly roomTitleInput: HTMLInputElement | null;
  private readonly roomCoordsEls: HTMLElement[];
  private readonly separatorEl: HTMLElement | null;
  private readonly saveStatusEls: HTMLElement[];
  private readonly publishNudgeRoot: HTMLElement | null;
  private readonly publishNudgeTextEl: HTMLElement | null;
  private readonly publishNudgeActionBtn: HTMLButtonElement | null;
  private readonly zoomEls: HTMLElement[];
  private readonly backBtn: HTMLButtonElement | null;
  private readonly playBtn: HTMLButtonElement | null;
  private readonly saveBtn: HTMLButtonElement | null;
  private readonly publishBtn: HTMLButtonElement | null;
  private readonly mintBtn: HTMLButtonElement | null;
  private readonly refreshMetadataBtn: HTMLButtonElement | null;
  private readonly historyBtn: HTMLButtonElement | null;
  private readonly fitBtns: HTMLButtonElement[];
  private readonly mobileZoomInBtn: HTMLButtonElement | null;
  private readonly mobileZoomOutBtn: HTMLButtonElement | null;
  private readonly toolButtons: HTMLButtonElement[];
  private readonly moreToolsButton: HTMLButtonElement | null;
  private readonly moreToolsPanel: HTMLElement | null;
  private readonly eraseControls: HTMLElement | null;
  private readonly eraseBrushSelect: HTMLSelectElement | null;
  private readonly clearLayerButton: HTMLButtonElement | null;
  private readonly clearAllButton: HTMLButtonElement | null;
  private readonly layerButtons: HTMLElement[];
  private readonly layerMiniButtons: HTMLElement[];
  private readonly layerChip: HTMLElement | null;
  private readonly layerGuideButton: HTMLButtonElement | null;
  private readonly tilesetSelect: HTMLSelectElement | null;
  private readonly flipXButton: HTMLButtonElement | null;
  private readonly flipYButton: HTMLButtonElement | null;
  private readonly paletteTabs: HTMLElement[];
  private readonly tilesetSection: HTMLElement | null;
  private readonly tilePaletteSection: HTMLElement | null;
  private readonly objectPaletteSection: HTMLElement | null;
  private readonly objectCategoryTabs: HTMLElement[];
  private readonly backgroundSelect: HTMLSelectElement | null;
  private readonly lightingSelect: HTMLSelectElement | null;
  private readonly backgroundButtons: HTMLButtonElement[];
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
  private readonly clearGoalMarkersBtn: HTMLButtonElement | null;
  private readonly courseRoot: HTMLElement | null;
  private readonly courseStatus: HTMLElement | null;
  private readonly courseRoomStep: HTMLElement | null;
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
  private readonly courseClearMarkersBtn: HTMLButtonElement | null;
  private readonly inspectorRoot: HTMLElement | null;
  private readonly pressurePanel: HTMLElement | null;
  private readonly pressureStatus: HTMLElement | null;
  private readonly pressureConnectBtn: HTMLButtonElement | null;
  private readonly pressureClearBtn: HTMLButtonElement | null;
  private readonly pressureDoneLaterBtn: HTMLButtonElement | null;
  private readonly containerPanel: HTMLElement | null;
  private readonly containerStatus: HTMLElement | null;
  private readonly containerClearBtn: HTMLButtonElement | null;
  private destroyed = false;
  private moreToolsOpen = false;
  private currentObjectCategory = 'all';
  private lastViewModel: EditorUiViewModel | null = null;

  constructor(
    private readonly actions: EditorUiBridgeActions,
    private readonly doc: Document = document,
    private readonly windowObj: Window = window,
  ) {
    this.roomTitleInput = this.doc.getElementById('room-title-input') as HTMLInputElement | null;
    this.roomCoordsEls = [
      this.doc.getElementById('room-coords'),
      this.doc.getElementById('mobile-editor-room-coords'),
    ].filter((element): element is HTMLElement => Boolean(element));
    this.separatorEl = this.doc.querySelector('#bottom-bar .separator');
    this.saveStatusEls = [
      this.doc.getElementById('editor-top-save-status'),
      this.doc.getElementById('room-save-status'),
      this.doc.getElementById('mobile-editor-save-status'),
    ].filter((element): element is HTMLElement => Boolean(element));
    this.publishNudgeRoot = this.doc.getElementById('editor-publish-nudge');
    this.publishNudgeTextEl = this.doc.getElementById('editor-publish-nudge-text');
    this.publishNudgeActionBtn =
      this.doc.getElementById('btn-editor-publish-nudge') as HTMLButtonElement | null;
    this.zoomEls = [
      this.doc.getElementById('zoom-level'),
      this.doc.getElementById('mobile-editor-zoom-level'),
    ].filter((element): element is HTMLElement => Boolean(element));
    this.backBtn = this.doc.getElementById('btn-editor-back') as HTMLButtonElement | null;
    this.playBtn = this.doc.getElementById('btn-test-play') as HTMLButtonElement | null;
    this.saveBtn = this.doc.getElementById('btn-save-draft') as HTMLButtonElement | null;
    this.publishBtn = this.doc.getElementById('btn-publish-room') as HTMLButtonElement | null;
    this.mintBtn = this.doc.getElementById('btn-mint-room') as HTMLButtonElement | null;
    this.refreshMetadataBtn =
      this.doc.getElementById('btn-refresh-room-metadata') as HTMLButtonElement | null;
    this.historyBtn = this.doc.getElementById('btn-room-history') as HTMLButtonElement | null;
    this.fitBtns = [
      this.doc.getElementById('btn-fit-screen') as HTMLButtonElement | null,
      this.doc.getElementById('btn-mobile-editor-fit') as HTMLButtonElement | null,
    ].filter((element): element is HTMLButtonElement => Boolean(element));
    this.mobileZoomInBtn =
      this.doc.getElementById('btn-mobile-editor-zoom-in') as HTMLButtonElement | null;
    this.mobileZoomOutBtn =
      this.doc.getElementById('btn-mobile-editor-zoom-out') as HTMLButtonElement | null;
    this.toolButtons = Array.from(
      this.doc.querySelectorAll<HTMLButtonElement>('.tool-btn[data-tool]')
    );
    this.moreToolsButton = this.doc.getElementById('btn-tool-more') as HTMLButtonElement | null;
    this.moreToolsPanel = this.doc.getElementById('more-tools-panel');
    this.eraseControls = this.doc.getElementById('erase-controls');
    this.eraseBrushSelect = this.doc.getElementById('erase-brush-select') as HTMLSelectElement | null;
    this.clearLayerButton =
      this.doc.getElementById('btn-erase-clear-layer') as HTMLButtonElement | null;
    this.clearAllButton = this.doc.getElementById('btn-erase-clear-all') as HTMLButtonElement | null;
    this.layerButtons = Array.from(this.doc.querySelectorAll<HTMLElement>('.layer-btn'));
    this.layerMiniButtons = Array.from(
      this.doc.querySelectorAll<HTMLElement>('.layer-stack-mini-btn')
    );
    this.layerChip = this.doc.getElementById('editor-layer-chip');
    this.layerGuideButton =
      this.doc.getElementById('btn-editor-layer-guides') as HTMLButtonElement | null;
    this.tilesetSelect = this.doc.getElementById('tileset-select') as HTMLSelectElement | null;
    this.populateTilesetOptions();
    this.flipXButton = this.doc.getElementById('btn-tile-flip-x') as HTMLButtonElement | null;
    this.flipYButton = this.doc.getElementById('btn-tile-flip-y') as HTMLButtonElement | null;
    this.paletteTabs = Array.from(this.doc.querySelectorAll<HTMLElement>('.palette-tab'));
    this.tilesetSection = this.doc.getElementById('tileset-section');
    this.tilePaletteSection = this.doc.getElementById('tile-palette-section');
    this.objectPaletteSection = this.doc.getElementById('object-palette-section');
    this.objectCategoryTabs = Array.from(this.doc.querySelectorAll<HTMLElement>('.obj-cat-tab'));
    this.backgroundSelect =
      this.doc.getElementById('background-select') as HTMLSelectElement | null;
    this.lightingSelect =
      this.doc.getElementById('lighting-mode-select') as HTMLSelectElement | null;
    this.backgroundButtons = Array.from(
      this.doc.querySelectorAll<HTMLButtonElement>('[data-background-id]')
    );
    this.goalTypeSelect = this.doc.getElementById('goal-type-select') as HTMLSelectElement | null;
    this.goalContextNote = this.doc.getElementById('goal-context-note');
    this.timeLimitRow = this.doc.getElementById('goal-time-limit-row');
    this.timeLimitInput =
      this.doc.getElementById('goal-time-limit-seconds') as HTMLInputElement | null;
    this.requiredCountRow = this.doc.getElementById('goal-required-count-row');
    this.requiredCountInput =
      this.doc.getElementById('goal-required-count') as HTMLInputElement | null;
    this.survivalRow = this.doc.getElementById('goal-survival-row');
    this.survivalInput =
      this.doc.getElementById('goal-survival-seconds') as HTMLInputElement | null;
    this.markerControls = this.doc.getElementById('goal-marker-controls');
    this.placementHint = this.doc.getElementById('goal-placement-hint');
    this.summary = this.doc.getElementById('goal-summary');
    this.placeStartBtn = this.doc.getElementById('btn-goal-place-start') as HTMLButtonElement | null;
    this.placeExitBtn = this.doc.getElementById('btn-goal-place-exit') as HTMLButtonElement | null;
    this.addCheckpointBtn =
      this.doc.getElementById('btn-goal-add-checkpoint') as HTMLButtonElement | null;
    this.placeFinishBtn =
      this.doc.getElementById('btn-goal-place-finish') as HTMLButtonElement | null;
    this.clearGoalMarkersBtn =
      this.doc.getElementById('btn-goal-clear-markers') as HTMLButtonElement | null;
    this.courseRoot = this.doc.getElementById('course-goal-section');
    this.courseStatus = this.doc.getElementById('course-editor-status');
    this.courseRoomStep = this.doc.getElementById('course-editor-room-step');
    this.courseGoalTypeSelect =
      this.doc.getElementById('course-editor-goal-type-select') as HTMLSelectElement | null;
    this.courseTimeLimitRow = this.doc.getElementById('course-editor-time-limit-row');
    this.courseTimeLimitInput =
      this.doc.getElementById('course-editor-time-limit-seconds') as HTMLInputElement | null;
    this.courseRequiredCountRow = this.doc.getElementById('course-editor-required-count-row');
    this.courseRequiredCountInput =
      this.doc.getElementById('course-editor-required-count') as HTMLInputElement | null;
    this.courseSurvivalRow = this.doc.getElementById('course-editor-survival-row');
    this.courseSurvivalInput =
      this.doc.getElementById('course-editor-survival-seconds') as HTMLInputElement | null;
    this.courseMarkerControls = this.doc.getElementById('course-editor-marker-controls');
    this.coursePlacementHint = this.doc.getElementById('course-editor-placement-hint');
    this.courseSummary = this.doc.getElementById('course-editor-summary');
    this.coursePlaceStartBtn =
      this.doc.getElementById('btn-course-editor-place-start') as HTMLButtonElement | null;
    this.coursePlaceExitBtn =
      this.doc.getElementById('btn-course-editor-place-exit') as HTMLButtonElement | null;
    this.courseAddCheckpointBtn =
      this.doc.getElementById('btn-course-editor-add-checkpoint') as HTMLButtonElement | null;
    this.coursePlaceFinishBtn =
      this.doc.getElementById('btn-course-editor-place-finish') as HTMLButtonElement | null;
    this.courseClearMarkersBtn =
      this.doc.getElementById('btn-course-editor-clear-markers') as HTMLButtonElement | null;
    this.inspectorRoot = this.doc.getElementById('editor-inspector');
    this.pressurePanel = this.doc.getElementById('pressure-plate-panel');
    this.pressureStatus = this.doc.getElementById('pressure-plate-status');
    this.pressureConnectBtn =
      this.doc.getElementById('btn-pressure-plate-connect') as HTMLButtonElement | null;
    this.pressureClearBtn =
      this.doc.getElementById('btn-pressure-plate-clear') as HTMLButtonElement | null;
    this.pressureDoneLaterBtn =
      this.doc.getElementById('btn-pressure-plate-done-later') as HTMLButtonElement | null;
    this.containerPanel = this.doc.getElementById('container-contents-panel');
    this.containerStatus = this.doc.getElementById('container-contents-status');
    this.containerClearBtn =
      this.doc.getElementById('btn-container-clear') as HTMLButtonElement | null;

    this.bindListeners();
    this.syncEditorChromeState();
  }

  private populateTilesetOptions(): void {
    if (!this.tilesetSelect) {
      return;
    }

    const editorTilesets = getEditorTilesets();
    const selectedKey =
      getTilesetByKey(editorState.selectedTilesetKey)?.key ?? editorTilesets[0]?.key ?? '';
    this.tilesetSelect.replaceChildren(
      ...editorTilesets.map((tileset) => {
        const option = this.doc.createElement('option');
        option.value = tileset.key;
        option.textContent = tileset.name;
        return option;
      })
    );
    this.tilesetSelect.value = selectedKey;
  }

  render(viewModel: EditorUiViewModel): void {
    if (this.destroyed) {
      return;
    }

    this.lastViewModel = viewModel;
    this.setValue(this.roomTitleInput, viewModel.roomTitleValue);
    this.setText(this.roomCoordsEls, viewModel.roomCoordinatesText);
    this.separatorEl?.classList.toggle('hidden', false);
    this.renderSaveStatus(this.saveStatusEls, viewModel);
    this.setHidden(this.publishNudgeRoot, !viewModel.publishNudgeVisible);
    this.setText(this.publishNudgeTextEl, viewModel.publishNudgeText);
    this.setButtonText(this.publishNudgeActionBtn, viewModel.publishNudgeActionText);
    this.resetSaveStatusTone();
    this.setText(this.zoomEls, viewModel.zoomText);

    this.setHidden(this.backBtn, viewModel.backButtonHidden);
    this.setButtonText(this.backBtn, viewModel.backButtonText);
    this.setButtonTitle(this.backBtn, viewModel.backButtonTitle);
    this.setHidden(this.playBtn, viewModel.playHidden);
    this.setHidden(this.saveBtn, viewModel.saveHidden);
    this.setButtonText(this.saveBtn, viewModel.saveButtonText);
    this.setButtonTitle(this.saveBtn, viewModel.saveButtonTitle);
    this.setDisabled(this.saveBtn, viewModel.saveDisabled);
    this.setHidden(this.publishBtn, viewModel.publishHidden);
    this.setButtonText(this.publishBtn, viewModel.publishButtonText);
    this.setButtonTitle(this.publishBtn, viewModel.publishButtonTitle);
    this.setDisabled(this.publishBtn, viewModel.publishDisabled);
    this.setHidden(this.mintBtn, viewModel.mintHidden);
    this.setDisabled(this.mintBtn, viewModel.mintDisabled);
    this.setButtonText(this.mintBtn, viewModel.mintButtonText);
    this.setHidden(this.refreshMetadataBtn, viewModel.refreshMetadataHidden);
    this.setDisabled(this.refreshMetadataBtn, viewModel.refreshMetadataDisabled);
    this.setButtonText(this.refreshMetadataBtn, viewModel.refreshMetadataButtonText);
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
    this.setHidden(this.courseRoomStep, viewModel.course.roomStepText.length === 0);
    this.setText(this.courseRoomStep, viewModel.course.roomStepText);
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

    this.syncEditorChromeState();
  }

  renderInspector(state: EditorInspectorState): void {
    if (this.destroyed) {
      return;
    }

    this.setHidden(this.inspectorRoot, !state.visible);
    this.setHidden(this.pressurePanel, !state.pressureVisible);
    this.setText(this.pressureStatus, state.pressureStatusText);
    this.setHidden(this.pressureConnectBtn, state.pressureConnectHidden);
    this.setDisabled(this.pressureConnectBtn, state.pressureConnectDisabled);
    if (this.pressureConnectBtn) {
      this.pressureConnectBtn.title = state.pressureConnectTitle;
    }
    this.setHidden(this.pressureClearBtn, state.pressureClearHidden);
    this.setDisabled(this.pressureClearBtn, state.pressureClearDisabled);
    this.setHidden(this.pressureDoneLaterBtn, state.pressureDoneLaterHidden);
    this.setHidden(this.containerPanel, !state.containerVisible);
    this.setText(this.containerStatus, state.containerStatusText);
    this.setDisabled(this.containerClearBtn, state.containerClearDisabled);
    if (this.containerClearBtn) {
      this.containerClearBtn.title = state.containerClearTitle;
    }
  }

  notifyEditorStateChanged(): void {
    this.windowObj.dispatchEvent(new Event(EDITOR_UI_STATE_CHANGED_EVENT));
  }

  destroy(): void {
    this.setHidden(this.inspectorRoot, true);
    this.setHidden(this.pressurePanel, true);
    this.setHidden(this.containerPanel, true);
    this.destroyed = true;
    for (const cleanup of this.cleanupCallbacks) {
      cleanup();
    }
    this.cleanupCallbacks.length = 0;
  }

  private bindListeners(): void {
    this.bind(this.doc, 'keydown', (event) => {
      this.actions.onDocumentKeyDown(event as KeyboardEvent);
    });
    this.bind(this.windowObj, AUTH_STATE_CHANGED_EVENT, () => {
      this.actions.onAuthStateChanged();
    });
    this.bind(this.windowObj, EDITOR_UI_STATE_CHANGED_EVENT, () => {
      if (this.lastViewModel) {
        this.syncEditorChromeState();
      }
      this.actions.onRequestRender();
    });

    const commitRoomTitle = () => {
      this.actions.onSetRoomTitle(this.roomTitleInput?.value ?? null);
    };
    this.roomTitleInput?.addEventListener('input', commitRoomTitle);
    this.roomTitleInput?.addEventListener('change', commitRoomTitle);
    if (this.roomTitleInput) {
      this.cleanupCallbacks.push(() => {
        this.roomTitleInput?.removeEventListener('input', commitRoomTitle);
        this.roomTitleInput?.removeEventListener('change', commitRoomTitle);
      });
    }

    for (const button of this.toolButtons) {
      const handler = () => {
        const tool = button.dataset.tool as ToolName | undefined;
        if (!tool) {
          return;
        }
        this.actions.onSelectTool(tool);
        if (tool !== 'rect' && tool !== 'fill') {
          this.moreToolsOpen = false;
        }
      };
      button.addEventListener('click', handler);
      this.cleanupCallbacks.push(() => button.removeEventListener('click', handler));
    }

    if (this.moreToolsButton) {
      const toggleMoreTools = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        this.moreToolsOpen = !this.moreToolsOpen;
        this.syncEditorChromeState();
      };
      this.moreToolsButton.addEventListener('click', toggleMoreTools);
      this.cleanupCallbacks.push(() =>
        this.moreToolsButton?.removeEventListener('click', toggleMoreTools)
      );
    }

    const closeMoreToolsOnOutsideClick = (event: Event) => {
      if (!this.moreToolsPanel || !this.moreToolsOpen) {
        return;
      }
      const target = event.target as Node | null;
      if (
        target &&
        (this.moreToolsPanel.contains(target) || this.moreToolsButton?.contains(target))
      ) {
        return;
      }
      this.moreToolsOpen = false;
      this.syncEditorChromeState();
    };
    this.doc.addEventListener('click', closeMoreToolsOnOutsideClick);
    this.cleanupCallbacks.push(() =>
      this.doc.removeEventListener('click', closeMoreToolsOnOutsideClick)
    );

    const handleEraserBrushChange = () => {
      const nextSize = Number.parseInt(this.eraseBrushSelect?.value ?? '', 10);
      if (ERASER_BRUSH_SIZES.includes(nextSize as EraserBrushSize)) {
        editorState.eraserBrushSize = nextSize as EraserBrushSize;
      }
    };
    this.eraseBrushSelect?.addEventListener('change', handleEraserBrushChange);
    if (this.eraseBrushSelect) {
      this.cleanupCallbacks.push(() =>
        this.eraseBrushSelect?.removeEventListener('change', handleEraserBrushChange)
      );
    }

    this.bindButton(this.clearLayerButton, () => {
      if (!this.windowObj.confirm('Clear every tile on the current layer?')) {
        return;
      }
      this.actions.onClearCurrentLayer();
    });

    this.bindButton(this.clearAllButton, () => {
      if (!this.windowObj.confirm('Remove all tiles from Back, Gameplay, and Front?')) {
        return;
      }
      this.actions.onClearAllTiles();
    });

    const handleLayerClick = (button: HTMLElement) => {
      const layer = button.dataset.layer as LayerName | undefined;
      if (!layer) {
        return;
      }
      editorState.activeLayer = layer;
      this.syncEditorChromeState();
    };
    for (const button of [...this.layerButtons, ...this.layerMiniButtons]) {
      const handler = () => handleLayerClick(button);
      button.addEventListener('click', handler);
      this.cleanupCallbacks.push(() => button.removeEventListener('click', handler));
    }

    this.bindButton(this.layerGuideButton, () => {
      editorState.showLayerGuides = !editorState.showLayerGuides;
      this.syncEditorChromeState();
    });

    const handleTilesetChange = () => {
      if (!this.tilesetSelect) {
        return;
      }
      editorState.selectedTilesetKey = this.tilesetSelect.value;
      const tileset = getTilesetByKey(this.tilesetSelect.value);
      if (tileset) {
        runtimeConfig.paletteController?.updateSelection(tileset.key, 0, 0, 0, 0);
      }
      runtimeConfig.paletteController?.renderPalette();
      runtimeConfig.paletteController?.renderTilePreview();
      this.syncEditorChromeState();
    };
    this.tilesetSelect?.addEventListener('change', handleTilesetChange);
    if (this.tilesetSelect) {
      this.cleanupCallbacks.push(() =>
        this.tilesetSelect?.removeEventListener('change', handleTilesetChange)
      );
    }

    this.bindButton(this.flipXButton, () => {
      editorState.tileFlipX = !editorState.tileFlipX;
      runtimeConfig.paletteController?.renderTilePreview();
      this.syncEditorChromeState();
    });
    this.bindButton(this.flipYButton, () => {
      editorState.tileFlipY = !editorState.tileFlipY;
      runtimeConfig.paletteController?.renderTilePreview();
      this.syncEditorChromeState();
    });

    for (const tab of this.paletteTabs) {
      const handler = () => {
        const mode = (tab.dataset.mode as PaletteMode | undefined) ?? 'tiles';
        editorState.paletteMode = mode;
        if (mode === 'tiles') {
          editorState.selectedObjectId = null;
        } else if (editorState.activeTool !== 'eraser') {
          this.actions.onSelectTool('pencil');
        }
        runtimeConfig.paletteController?.renderTilePreview();
        this.syncEditorChromeState();
      };
      tab.addEventListener('click', handler);
      this.cleanupCallbacks.push(() => tab.removeEventListener('click', handler));
    }

    for (const tab of this.objectCategoryTabs) {
      const handler = () => {
        this.currentObjectCategory = tab.dataset.category || 'all';
        runtimeConfig.paletteController?.setObjectCategory(this.currentObjectCategory);
        this.syncEditorChromeState();
      };
      tab.addEventListener('click', handler);
      this.cleanupCallbacks.push(() => tab.removeEventListener('click', handler));
    }

    const handleBackgroundSelectChange = () => {
      if (!this.backgroundSelect) {
        return;
      }
      this.applyBackgroundSelection(this.backgroundSelect.value);
    };
    this.backgroundSelect?.addEventListener('change', handleBackgroundSelectChange);
    if (this.backgroundSelect) {
      this.cleanupCallbacks.push(() =>
        this.backgroundSelect?.removeEventListener('change', handleBackgroundSelectChange)
      );
    }

    const handleLightingSelectChange = () => {
      if (!this.lightingSelect) {
        return;
      }
      this.applyLightingSelection(this.lightingSelect.value as RoomLightingMode);
    };
    this.lightingSelect?.addEventListener('change', handleLightingSelectChange);
    if (this.lightingSelect) {
      this.cleanupCallbacks.push(() =>
        this.lightingSelect?.removeEventListener('change', handleLightingSelectChange)
      );
    }

    for (const button of this.backgroundButtons) {
      const handler = () => {
        const nextBackground = button.dataset.backgroundId;
        if (!nextBackground) {
          return;
        }
        this.applyBackgroundSelection(nextBackground);
      };
      button.addEventListener('click', handler);
      this.cleanupCallbacks.push(() => button.removeEventListener('click', handler));
    }

    const handleGoalTypeChange = () => {
      this.actions.onSetGoalType(
        this.goalTypeSelect?.value ? (this.goalTypeSelect.value as RoomGoalType) : null
      );
    };
    this.goalTypeSelect?.addEventListener('change', handleGoalTypeChange);
    if (this.goalTypeSelect) {
      this.cleanupCallbacks.push(() =>
        this.goalTypeSelect?.removeEventListener('change', handleGoalTypeChange)
      );
    }
    this.bindNumericInput(this.timeLimitInput, (input) => {
      const seconds = Number.parseInt(input.value, 10);
      this.actions.onSetGoalTimeLimitSeconds(Number.isFinite(seconds) && seconds > 0 ? seconds : null);
    });
    this.bindNumericInput(this.requiredCountInput, (input) => {
      const requiredCount = Number.parseInt(input.value, 10);
      this.actions.onSetGoalRequiredCount(Number.isFinite(requiredCount) && requiredCount > 0 ? requiredCount : 1);
    });
    this.bindNumericInput(this.survivalInput, (input) => {
      const seconds = Number.parseInt(input.value, 10);
      this.actions.onSetGoalSurvivalSeconds(Number.isFinite(seconds) && seconds > 0 ? seconds : 30);
    });
    this.bindButton(this.placeStartBtn, () => {
      this.actions.onStartGoalMarkerPlacement('start');
      this.requestPhoneEditorAutoCollapse();
    });
    this.bindButton(this.placeExitBtn, () => {
      this.actions.onStartGoalMarkerPlacement('exit');
      this.requestPhoneEditorAutoCollapse();
    });
    this.bindButton(this.addCheckpointBtn, () => {
      this.actions.onStartGoalMarkerPlacement('checkpoint');
      this.requestPhoneEditorAutoCollapse();
    });
    this.bindButton(this.placeFinishBtn, () => {
      this.actions.onStartGoalMarkerPlacement('finish');
      this.requestPhoneEditorAutoCollapse();
    });
    this.bindButton(this.clearGoalMarkersBtn, () => {
      this.actions.onClearGoalMarkers();
    });

    const handleCourseGoalTypeChange = () => {
      this.actions.onSetCourseGoalType(
        this.courseGoalTypeSelect?.value
          ? (this.courseGoalTypeSelect.value as CourseGoalType)
          : null
      );
    };
    this.courseGoalTypeSelect?.addEventListener('change', handleCourseGoalTypeChange);
    if (this.courseGoalTypeSelect) {
      this.cleanupCallbacks.push(() =>
        this.courseGoalTypeSelect?.removeEventListener('change', handleCourseGoalTypeChange)
      );
    }
    this.bindNumericInput(this.courseTimeLimitInput, (input) => {
      const seconds = Number.parseInt(input.value, 10);
      this.actions.onSetCourseGoalTimeLimitSeconds(
        Number.isFinite(seconds) && seconds > 0 ? seconds : null
      );
    });
    this.bindNumericInput(this.courseRequiredCountInput, (input) => {
      const requiredCount = Number.parseInt(input.value, 10);
      this.actions.onSetCourseGoalRequiredCount(
        Number.isFinite(requiredCount) && requiredCount > 0 ? requiredCount : 1
      );
    });
    this.bindNumericInput(this.courseSurvivalInput, (input) => {
      const seconds = Number.parseInt(input.value, 10);
      this.actions.onSetCourseGoalSurvivalSeconds(
        Number.isFinite(seconds) && seconds > 0 ? seconds : 30
      );
    });
    this.bindButton(this.coursePlaceStartBtn, () => {
      this.actions.onStartCourseGoalMarkerPlacement('start');
      this.requestPhoneEditorAutoCollapse();
    });
    this.bindButton(this.coursePlaceExitBtn, () => {
      this.actions.onStartCourseGoalMarkerPlacement('exit');
      this.requestPhoneEditorAutoCollapse();
    });
    this.bindButton(this.courseAddCheckpointBtn, () => {
      this.actions.onStartCourseGoalMarkerPlacement('checkpoint');
      this.requestPhoneEditorAutoCollapse();
    });
    this.bindButton(this.coursePlaceFinishBtn, () => {
      this.actions.onStartCourseGoalMarkerPlacement('finish');
      this.requestPhoneEditorAutoCollapse();
    });
    this.bindButton(this.courseClearMarkersBtn, () => {
      this.actions.onClearCourseGoalMarkers();
    });

    this.bindButton(this.pressureConnectBtn, () => {
      this.actions.onBeginPressurePlateConnection();
      this.requestPhoneEditorAutoCollapse();
    });
    this.bindButton(this.pressureClearBtn, () => {
      this.actions.onClearPressurePlateConnection();
    });
    this.bindButton(this.pressureDoneLaterBtn, () => {
      this.actions.onCancelPressurePlateConnection();
    });
    this.bindButton(this.containerClearBtn, () => {
      this.actions.onClearContainerContents();
    });

    this.bindButton(this.playBtn, () => {
      runtimeConfig.closePanels();
      void this.actions.onStartPlayMode();
    });
    this.bindButton(this.backBtn, () => {
      runtimeConfig.closePanels();
      void this.actions.onBack();
    });
    this.bindButton(this.saveBtn, () => {
      runtimeConfig.closePanels();
      void this.actions.onSaveDraft();
    });
    this.bindButton(this.publishBtn, () => {
      runtimeConfig.closePanels();
      void this.actions.onPublishRoom();
    });
    this.bindButton(this.publishNudgeActionBtn, () => {
      runtimeConfig.closePanels();
      void this.actions.onPublishNudge();
    });
    this.bindButton(this.mintBtn, () => {
      runtimeConfig.closePanels();
      void this.actions.onMintRoom();
    });
    this.bindButton(this.refreshMetadataBtn, () => {
      runtimeConfig.closePanels();
      void this.actions.onRefreshMintMetadata();
    });
    this.bindButton(this.historyBtn, () => {
      runtimeConfig.closePanels();
      void runtimeConfig.openHistory();
    });
    for (const fitButton of this.fitBtns) {
      this.bindButton(fitButton, () => {
        this.actions.onFitToScreen();
      });
    }
    this.bindButton(this.mobileZoomInBtn, () => {
      this.actions.onZoomIn();
    });
    this.bindButton(this.mobileZoomOutBtn, () => {
      this.actions.onZoomOut();
    });
  }

  private bindNumericInput(
    input: HTMLInputElement | null,
    onCommit: (input: HTMLInputElement) => void,
  ): void {
    if (!input) {
      return;
    }
    const handleCommit = () => onCommit(input);
    input.addEventListener('input', handleCommit);
    input.addEventListener('change', handleCommit);
    this.cleanupCallbacks.push(() => {
      input.removeEventListener('input', handleCommit);
      input.removeEventListener('change', handleCommit);
    });
  }

  private bindButton(
    button: HTMLButtonElement | HTMLElement | null,
    handler: () => void,
  ): void {
    if (!button) {
      return;
    }
    button.addEventListener('click', handler);
    this.cleanupCallbacks.push(() => button.removeEventListener('click', handler));
  }

  private bind(
    target: Document | Window,
    type: string,
    handler: EventListener,
  ): void {
    target.addEventListener(type, handler);
    this.cleanupCallbacks.push(() => target.removeEventListener(type, handler));
  }

  private applyBackgroundSelection(nextBackgroundId: string): void {
    if (!nextBackgroundId || editorState.selectedBackground === nextBackgroundId) {
      return;
    }
    editorState.selectedBackground = nextBackgroundId;
    this.actions.onSelectBackground(nextBackgroundId);
    this.syncEditorChromeState();
    this.requestPhoneEditorAutoCollapse();
  }

  private applyLightingSelection(nextLightingMode: RoomLightingMode): void {
    if (!nextLightingMode || editorState.selectedLightingMode === nextLightingMode) {
      return;
    }
    editorState.selectedLightingMode = nextLightingMode;
    this.actions.onSelectLighting(nextLightingMode);
    this.syncEditorChromeState();
    this.requestPhoneEditorAutoCollapse();
  }

  private requestPhoneEditorAutoCollapse(): void {
    this.windowObj.dispatchEvent(new Event('mobile-editor-auto-collapse'));
  }

  private syncEditorChromeState(): void {
    if (this.destroyed) {
      return;
    }

    for (const button of this.toolButtons) {
      button.classList.toggle('active', button.dataset.tool === editorState.activeTool);
    }

    const showMoreTools =
      this.moreToolsOpen ||
      (editorState.paletteMode === 'tiles' &&
        (editorState.activeTool === 'rect' || editorState.activeTool === 'fill'));
    this.moreToolsButton?.classList.toggle(
      'active',
      showMoreTools || editorState.activeTool === 'rect' || editorState.activeTool === 'fill'
    );
    this.moreToolsPanel?.classList.toggle('hidden', !showMoreTools);
    if (this.moreToolsPanel) {
      this.moreToolsPanel.dataset.open = showMoreTools ? 'true' : 'false';
    }

    const showEraseControls =
      editorState.paletteMode === 'tiles' && editorState.activeTool === 'eraser';
    this.eraseControls?.classList.toggle('hidden', !showEraseControls);
    if (this.eraseBrushSelect && this.eraseBrushSelect.value !== String(editorState.eraserBrushSize)) {
      this.eraseBrushSelect.value = String(editorState.eraserBrushSize);
    }

    for (const button of this.layerButtons) {
      button.classList.toggle('active', button.dataset.layer === editorState.activeLayer);
    }
    for (const button of this.layerMiniButtons) {
      button.classList.toggle('active', button.dataset.layer === editorState.activeLayer);
    }
    if (this.layerChip) {
      this.layerChip.textContent = `Placing on ${getLayerUiLabel(editorState.activeLayer)}`;
      this.layerChip.setAttribute('data-layer-tone', editorState.activeLayer);
    }
    if (this.layerGuideButton) {
      this.layerGuideButton.classList.toggle('active', editorState.showLayerGuides);
      this.layerGuideButton.setAttribute(
        'aria-pressed',
        editorState.showLayerGuides ? 'true' : 'false'
      );
      this.layerGuideButton.textContent = editorState.showLayerGuides
        ? 'Hide Layers'
        : 'See Layers';
    }

    this.setValue(this.tilesetSelect, editorState.selectedTilesetKey);
    if (this.flipXButton) {
      this.flipXButton.classList.toggle('active', editorState.tileFlipX);
      this.flipXButton.setAttribute('aria-pressed', editorState.tileFlipX ? 'true' : 'false');
    }
    if (this.flipYButton) {
      this.flipYButton.classList.toggle('active', editorState.tileFlipY);
      this.flipYButton.setAttribute('aria-pressed', editorState.tileFlipY ? 'true' : 'false');
    }

    for (const tab of this.paletteTabs) {
      tab.classList.toggle('active', tab.dataset.mode === editorState.paletteMode);
    }
    const paletteModeIsTiles = editorState.paletteMode === 'tiles';
    this.tilesetSection?.classList.toggle('hidden', !paletteModeIsTiles);
    this.tilePaletteSection?.classList.toggle('hidden', !paletteModeIsTiles);
    this.objectPaletteSection?.classList.toggle('hidden', paletteModeIsTiles);

    for (const tab of this.objectCategoryTabs) {
      tab.classList.toggle('active', (tab.dataset.category || 'all') === this.currentObjectCategory);
    }

    this.setValue(this.backgroundSelect, editorState.selectedBackground);
    this.setValue(this.lightingSelect, editorState.selectedLightingMode);
    for (const button of this.backgroundButtons) {
      const active = button.dataset.backgroundId === editorState.selectedBackground;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
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
    value: string,
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

  private setButtonTitle(element: HTMLButtonElement | null, title: string): void {
    if (!element) {
      return;
    }
    if (element.title !== title) {
      element.title = title;
    }
  }
}

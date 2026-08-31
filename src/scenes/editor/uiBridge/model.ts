import type { ToolName } from '../../../config';
import type { CourseGoalType } from '../../../courses/model';
import type { SwordsmanDefeatMode, SwordsmanObjectiveMode } from '../../../enemies/swordsmanObjectives';
import type { PoliceBehaviorMode } from '../../../enemies/policeEnemy';
import type { RoomGoalType } from '../../../goals/roomGoals';
import type { NpcQuestType } from '../../../goals/roomGoals';
import type { RoomLightingMode } from '../../../lighting/model';
import type { RoomWeatherMode } from '../../../weather/model';
import type { NpcMode } from '../../../npcs/model';
import type { EditorMarkerPlacementMode } from '../../../ui/setup/sceneBridge';
import type { SmartBrushId, SmartStyleId } from '../../../autotiling/model';
import type { SmartThemeId } from '../../../autotiling/registry';

export interface EditorGoalUiViewModel {
  goalTypeValue: string;
  goalTypeDisabled: boolean;
  npcQuestTypeHidden: boolean;
  npcQuestTypeValue: NpcQuestType;
  timeLimitHidden: boolean;
  timeLimitDisabled: boolean;
  timeLimitValue: string;
  requiredCountHidden: boolean;
  requiredCountDisabled: boolean;
  requiredCountValue: string;
  survivalHidden: boolean;
  survivalDisabled: boolean;
  survivalValue: string;
  introTextHidden: boolean;
  introTextDisabled: boolean;
  introTextValue: string;
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
  linkNpcHidden: boolean;
  linkNpcActive: boolean;
  placeNpcDestinationHidden: boolean;
  placeNpcDestinationActive: boolean;
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
  swordsmanVisible: boolean;
  swordsmanStatusText: string;
  swordsmanObjectiveModeValue: SwordsmanObjectiveMode;
  swordsmanObjectiveModeDisabled: boolean;
  swordsmanDefeatModeValue: SwordsmanDefeatMode;
  swordsmanDefeatModeDisabled: boolean;
  policeVisible: boolean;
  policeStatusText: string;
  policeBehaviorModeValue: PoliceBehaviorMode;
  policeBehaviorModeDisabled: boolean;
  policePatrolShootsChecked: boolean;
  policePatrolShootsHidden: boolean;
  npcVisible: boolean;
  npcStatusText: string;
  npcModeValue: NpcMode;
  npcModeDisabled: boolean;
  npcPushableChecked: boolean;
  npcPushableHidden: boolean;
  npcJumpFallChecked: boolean;
  npcJumpFallHidden: boolean;
  npcPlayerCollisionChecked: boolean;
  npcFriendlyFireChecked: boolean;
  npcNameValue: string;
  npcDialogueValue: string;
  npcDefeatModeValue: SwordsmanDefeatMode;
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
  publishButtonAriaDisabled: boolean;
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

export interface EditorUiPaletteController {
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

export interface EditorUiRuntimeConfig {
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
  onClearAllObjects: () => void;
  onSetSmartTheme: (theme: SmartThemeId) => void;
  onSetSmartMaterial: (material: SmartBrushId) => void;
  onSetSmartStyle: (style: SmartStyleId) => void;
  onSetSmartDetailsEnabled: (enabled: boolean) => void;
  onFillCaveTerrain: () => void;
  onSelectBackground: (backgroundId: string) => void;
  onSelectLighting: (mode: RoomLightingMode) => void;
  onSetLightingDarkness: (darkness: number) => void;
  onSetLightingRadius: (radius: number) => void;
  onSelectWeather: (mode: RoomWeatherMode) => void;
  onSetWeatherIntensity: (intensity: number) => void;
  onSetGoalType: (nextType: RoomGoalType | null) => void;
  onSetGoalTimeLimitSeconds: (seconds: number | null) => void;
  onSetGoalRequiredCount: (requiredCount: number) => void;
  onSetGoalSurvivalSeconds: (seconds: number) => void;
  onSetNpcQuestType: (questType: NpcQuestType) => void;
  onSetGoalIntroText: (text: string | null) => void;
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
  onSetFocusedSwordsmanObjectiveMode: (objectiveMode: SwordsmanObjectiveMode) => void;
  onSetFocusedSwordsmanDefeatMode: (defeatMode: SwordsmanDefeatMode) => void;
  onSetFocusedPoliceBehaviorMode: (mode: PoliceBehaviorMode) => void;
  onSetFocusedPolicePatrolShoots: (patrolShoots: boolean) => void;
  onSetFocusedNpcMode: (mode: NpcMode) => void;
  onSetFocusedNpcPushable: (pushable: boolean) => void;
  onSetFocusedNpcCanJumpFall: (canJumpFall: boolean) => void;
  onSetFocusedNpcPlayerCollision: (playerCollision: boolean) => void;
  onSetFocusedNpcFriendlyFire: (friendlyFire: boolean) => void;
  onSetFocusedNpcName: (name: string) => void;
  onSetFocusedNpcDialogue: (text: string) => void;
  onSetFocusedNpcDefeatMode: (defeatMode: SwordsmanDefeatMode) => void;
}

import { getSceneWithCapabilities } from './sceneCapabilityRegistry';
import type Phaser from 'phaser';
import type { EditorMusicWorkflowCoordinator } from '../../scenes/editor/musicWorkflow';
import type { CourseGoalType } from '../../courses/model';
import type { CourseEditorUiState } from '../../courses/editor/state';
import type { CustomSpriteDefinition } from '../../customSprites/model';
import type { RoomGoalType } from '../../goals/roomGoals';
import type { GoalPlacementMode } from '../../scenes/editor/editRuntime';
import type {
  RoomRushDifficulty,
  RoomRushStartRule,
} from '../../scenes/overworld/roomRushRuns';
import type { MultiplayerModeId } from '../../multiplayer/model';
import type { OverworldOnlineRosterViewEntry } from '../../scenes/overworld/hud';
import type { RoomCoordinates, RoomRecord, RoomSnapshot, RoomVersionRecord } from '../../persistence/roomModel';
import type { PerformanceAdvisorSuggestion } from '../../performance/performanceAdvisor';

export type EditorHistoryState = {
  roomId: string;
  claimerDisplayName: string | null;
  claimedAt: string | null;
  canRevert: boolean;
  canPublish: boolean;
  canMint: boolean;
  canRefreshMintMetadata: boolean;
  canonicalVersion: number | null;
  mintedTokenId: string | null;
  mintedOwnerWalletAddress: string | null;
  mintedMetadataRoomVersion: number | null;
  mintedMetadataUpdatedAt: string | null;
  mintedMetadataCurrent: boolean;
  versions: RoomVersionRecord[];
};

export type EditorMarkerPlacementMode = Exclude<GoalPlacementMode, null> | 'start';
export type EditorCourseUiState = {
  visible: boolean;
  statusHidden: boolean;
  statusText: string | null;
  roomStepText: string;
  canReturnToCourseBuilder: boolean;
  pitsAreDeadly?: boolean;
  playerHearts?: 1 | 2 | 3;
  pitsDisabled?: boolean;
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
};

/** The HTML controls can only issue public editor-music commands. */
export type EditorMusicCommands = Pick<EditorMusicWorkflowCoordinator,
  | 'setMusicModeActive'
  | 'toggleMusicMode'
  | 'setMusicPatternInstrumentTab'
  | 'setMusicComposerMode'
  | 'setRoomMusicPitchMode'
  | 'setRoomMusicKeyTonic'
  | 'setRoomMusicKeyMode'
  | 'shiftRoomMusicOctave'
  | 'shiftRoomMusicTempo'
  | 'shiftRoomMusicSwing'
  | 'startNewRoomMusicPhrase'
  | 'toggleRoomMusicPhraseMetadataEditor'
  | 'setRoomMusicPhraseNameSuffix'
  | 'saveRoomMusicDraftAndPhrases'
  | 'saveActiveRoomMusicPhrase'
  | 'saveAsActiveRoomMusicPhrase'
  | 'closeRoomMusicPhraseSavePrompt'
  | 'setRoomMusicPhraseSavePromptName'
  | 'confirmRoomMusicPhraseSavePrompt'
  | 'deleteActiveRoomMusicPhrase'
  | 'replaceLegacyRoomMusicWithPattern'
  | 'toggleRoomMusicPreview'
  | 'refreshMusicPhraseLibrary'
  | 'loadMoreMusicPhrases'
  | 'useMusicPhrase'
  | 'toggleMusicPhraseAudition'
  | 'assignMusicPhraseToArrangementSlot'
  | 'setRoomMusicArrangementSlotCount'
  | 'selectArrangementSlot'
  | 'clearSelectedArrangementSlot'
  | 'clearAllArrangementSlots'
>;

export interface EditorMusicCapability {
  getMusicWorkflow(): EditorMusicCommands;
}

export interface EditorPersistenceCapability {
  startPlayMode: () => Promise<void> | void;
  saveDraft: (
    force?: boolean,
    options?: { promptForSignInOnUnauthorized?: boolean }
  ) => Promise<RoomRecord | null>;
  publishRoom: () => Promise<RoomRecord | null>;
  returnToWorld: () => Promise<void> | void;
  returnToCourseBuilder: () => Promise<void> | void;
  setRoomTitle: (title: string | null) => void;
}

export interface EditorViewportCapability {
  fitToScreen: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  updateToolUi: () => void;
}

export interface EditorObjectCapability {
  useCustomSpriteAsTile: (sprite: CustomSpriteDefinition) => boolean;
  usesCustomSprite: (spriteId: string) => boolean;
  setPlacedSignText: (instanceId: string, text: string | null) => boolean | Promise<boolean>;
  undoAction: () => void;
  redoAction: () => void;
}

export interface EditorGoalCapability {
  setGoalType: (nextType: RoomGoalType | null) => void;
  setGoalTimeLimitSeconds: (seconds: number | null) => void;
  setGoalRequiredCount: (requiredCount: number) => void;
  setGoalSurvivalSeconds: (seconds: number) => void;
  startGoalMarkerPlacement: (mode: EditorMarkerPlacementMode) => void;
  clearGoalMarkers: () => void;
}

export interface EditorCourseGoalCapability {
  getCourseEditorState: () => EditorCourseUiState;
  setCourseGoalType: (goalType: CourseGoalType | null) => void;
  setCourseGoalTimeLimitSeconds: (seconds: number | null) => void;
  setCourseGoalRequiredCount: (requiredCount: number) => void;
  setCourseGoalSurvivalSeconds: (seconds: number) => void;
  startCourseGoalMarkerPlacement: (mode: EditorMarkerPlacementMode) => void;
  clearCourseGoalMarkers: () => void;
}

export interface EditorHistoryCapability {
  getHistoryState: () => EditorHistoryState;
  loadHistory: () => Promise<void>;
  revertToVersion: (targetVersion: number) => Promise<RoomRecord | null>;
  adminRestoreToVersion: (targetVersion: number) => Promise<RoomRecord | null>;
  setCanonicalVersion: (targetVersion: number) => Promise<RoomRecord | null>;
  setLeaderboardSourceVersion: (
    targetVersion: number,
    sourceVersion: number | null
  ) => Promise<RoomRecord | null>;
}

export interface RoomEditorPersistenceCapability {
  exportWampOGramRoomSnapshot: () => RoomSnapshot;
  handlePublishNudgeAction: () => Promise<void>;
  mintRoom: () => Promise<RoomRecord | null>;
  refreshMintMetadata: () => Promise<RoomRecord | null>;
}

export interface RoomEditorObjectCapability {
  beginFocusedPressurePlateConnection: () => void;
  clearFocusedPressurePlateConnection: () => void;
  cancelPressurePlateConnection: () => void;
  clearFocusedContainerContents: () => void;
}

export interface CourseWorkspacePersistenceCapability {
  saveCourseDraft: () => Promise<void>;
  publishCourseDraft: () => Promise<void>;
}

export interface EditorCommonSceneBridge extends EditorPersistenceCapability, EditorViewportCapability, EditorObjectCapability, EditorGoalCapability, EditorCourseGoalCapability, EditorMusicCapability {}

export interface RoomEditorSceneBridge extends EditorCommonSceneBridge, EditorHistoryCapability, RoomEditorPersistenceCapability, RoomEditorObjectCapability {}

export interface CourseWorkspaceSceneBridge extends EditorCommonSceneBridge, CourseWorkspacePersistenceCapability {}

export type EditorSceneBridge = RoomEditorSceneBridge | CourseWorkspaceSceneBridge;

export type OverworldSelectedRoomContext = {
  roomId: string;
  publishedVersion?: number | null;
  expandedRoomId?: string | null;
  expandedRoomVersion?: number | null;
  coordinates: RoomCoordinates;
  shareTitle?: string | null;
  state: 'published' | 'claimed_unpublished' | 'draft' | 'frontier' | 'empty';
  courseId: string | null;
  courseTitle: string | null;
  courseGoalType: CourseGoalType | null;
  courseRoomCount: number | null;
};

export type MobilePortraitCameraTuningInput = {
  zoomMultiplier?: number;
  targetY?: number;
};

export type MobilePortraitCameraTuningAdjustment = {
  zoomMultiplierDelta?: number;
  targetYDelta?: number;
};

export type MobilePortraitCameraTuningSnapshot = {
  enabled: boolean;
  zoomMultiplier: number;
  targetY: number;
  fitZoom: number;
  cameraZoom: number;
  playerScreen: {
    x: number;
    y: number;
  } | null;
  controlsTop: number | null;
  viewport: {
    width: number;
    height: number;
  };
};

export const COURSE_COMPOSER_STATE_CHANGED_EVENT = 'course-composer-state-changed';

export interface CourseComposerSceneBridge {
  getCourseEditorState: () => CourseEditorUiState | null;
  returnToWorld: () => Promise<void> | void;
  setCourseTitle: (title: string | null) => void;
  setCoursePitsAreDeadly: (enabled: boolean) => void;
  setCoursePlayerHearts: (hearts: number) => void;
  centerSelectedRoom: () => void;
  selectRoom: (roomId: string) => void;
  toggleSelectedRoomMembership: () => void;
  openSelectedRoom: () => Promise<void> | void;
  openCourseEditor: () => Promise<void> | void;
  moveCheckpoint: (index: number, direction: -1 | 1) => void;
  removeCheckpoint: (index: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fitCourseToView: () => void;
  /** Runs a setup panel layout change without moving the middle of the visible map. */
  keepMapCenterWhile: (change: () => void) => void;
  saveCourseDraft: () => Promise<void>;
  publishCourseDraft: () => Promise<void>;
  unpublishCourse: () => Promise<void>;
  testDraftCourse: () => Promise<void> | void;
}

export type CourseMarkerPlacementMode = 'start' | 'checkpoint' | 'finish';

export interface OverworldSceneBridge {
  getPerformanceAdvisorSuggestion: () => PerformanceAdvisorSuggestion | null;
  canPresentPerformanceAdvisorSuggestion: () => boolean;
  dismissPerformanceAdvisorSuggestion: (suggestionId: number) => boolean;
  setPerformanceSuggestionPauseRequested: (requested: boolean) => void;
  playSelectedRoom: (options?: { forceGoalIntro?: boolean; expectedCourseVersion?: number; canStart?: () => boolean }) => void | Promise<void>;
  restartCurrentRun: () => Promise<void> | void;
  startRoomRushRun: (options: {
    difficulty: RoomRushDifficulty;
    startRule: RoomRushStartRule;
  }) => Promise<boolean> | boolean;
  endRoomRushRun: () => void;
  isRoomRushRunActive: () => boolean;
  stopCurrentPlay: () => void;
  invitePvpDuel: (entry: OverworldOnlineRosterViewEntry) => Promise<void> | void;
  openMultiplayerLauncher: () => Promise<boolean> | boolean;
  inviteMultiplayer: (
    modeId: MultiplayerModeId,
    entry: OverworldOnlineRosterViewEntry,
  ) => Promise<void> | void;
  playSelectedCourse: () => Promise<void> | void;
  editSelectedRoom: (roomOnly?: boolean) => void;
  buildSelectedRoom: () => void;
  openGuestDraftRoom: (roomSnapshot: RoomSnapshot, canOpen?: () => boolean, forceRoomSnapshot?: boolean) => void | Promise<boolean>;
  zoomIn: () => void;
  zoomOut: () => void;
  /** False when an active Room Rush ended with its result in place of the jump. */
  jumpToCoordinates: (coordinates: RoomCoordinates) => Promise<boolean> | boolean;
  fitLoadedWorld: () => void;
  returnToWorld: () => void;
  getSelectedRoomContext: () => OverworldSelectedRoomContext;
  openRoomChatComposer: () => boolean;
  closeRoomChatComposer: () => void;
  isRoomChatComposerOpen: () => boolean;
  openRoomCommentComposer: () => boolean;
  closeRoomCommentComposer: () => void;
  isRoomCommentComposerOpen: () => boolean;
  toggleRoomComments: () => void;
  openCourseComposer: () => Promise<void> | void;
  openCourseEditor: () => Promise<void> | void;
  getMobilePortraitCameraTuning: () => MobilePortraitCameraTuningSnapshot;
  setMobilePortraitCameraTuning: (
    input: MobilePortraitCameraTuningInput,
    reason?: string,
  ) => MobilePortraitCameraTuningSnapshot;
  adjustMobilePortraitCameraTuning: (
    adjustment: MobilePortraitCameraTuningAdjustment,
    reason?: string,
  ) => MobilePortraitCameraTuningSnapshot;
  resetMobilePortraitCameraTuning: () => MobilePortraitCameraTuningSnapshot;
  logMobilePortraitCameraTuning: (reason?: string) => MobilePortraitCameraTuningSnapshot;
}


export function getEditorScene(game: Phaser.Game): RoomEditorSceneBridge | null {
  return getSceneWithCapabilities(game, 'EditorScene');
}

export function getCourseWorkspaceScene(game: Phaser.Game): CourseWorkspaceSceneBridge | null {
  return getSceneWithCapabilities(game, 'CourseEditorScene');
}

export function getOverworldScene(game: Phaser.Game): OverworldSceneBridge | null {
  return getSceneWithCapabilities(game, 'OverworldPlayScene');
}

export function getActiveEditorScene(game: Phaser.Game): EditorSceneBridge | null {
  if (game.scene.isActive('CourseEditorScene')) {
    return getCourseWorkspaceScene(game);
  }

  if (game.scene.isActive('EditorScene')) {
    return getEditorScene(game);
  }

  return null;
}

export function getActiveOverworldScene(game: Phaser.Game): OverworldSceneBridge | null {
  if (!game.scene.isActive('OverworldPlayScene') && !game.scene.isPaused?.('OverworldPlayScene')) {
    return null;
  }

  return getOverworldScene(game);
}

export function getCourseComposerScene(game: Phaser.Game): CourseComposerSceneBridge | null {
  return getSceneWithCapabilities(game, 'CourseComposerScene');
}

export function getActiveCourseComposerScene(game: Phaser.Game): CourseComposerSceneBridge | null {
  if (!game.scene.isActive('CourseComposerScene')) {
    return null;
  }

  return getCourseComposerScene(game);
}

export function withActiveEditorScene(
  game: Phaser.Game,
  callback: (scene: EditorSceneBridge) => void,
): void {
  const scene = getActiveEditorScene(game);
  if (!scene) {
    return;
  }

  callback(scene);
}

export function withActiveOverworldScene(
  game: Phaser.Game,
  callback: (scene: OverworldSceneBridge) => void,
): void {
  const scene = getActiveOverworldScene(game);
  if (!scene) {
    return;
  }

  callback(scene);
}

export function withActiveCourseComposerScene(
  game: Phaser.Game,
  callback: (scene: CourseComposerSceneBridge) => void,
): void {
  const scene = getActiveCourseComposerScene(game);
  if (!scene) {
    return;
  }

  callback(scene);
}

/** Room-only actions never fall through to the course workspace. */
export function getActiveRoomEditorScene(game: Phaser.Game): RoomEditorSceneBridge | null {
  return !game.scene.isActive('CourseEditorScene') && game.scene.isActive('EditorScene') ? getEditorScene(game) : null;
}

export function withActiveEditorMusic(game: Phaser.Game, callback: (music: EditorMusicCommands) => void): void {
  const scene = getActiveEditorScene(game);
  if (scene) callback(scene.getMusicWorkflow());
}

export function getActiveCourseWorkspaceScene(game: Phaser.Game): CourseWorkspaceSceneBridge | null {
  return game.scene.isActive('CourseEditorScene') ? getCourseWorkspaceScene(game) : null;
}

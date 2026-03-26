import Phaser from 'phaser';
import type { CourseGoalType, CourseRoomRef } from '../../courses/model';
import type { CourseEditorUiState } from '../../courses/editor/state';
import type { RoomGoalType } from '../../goals/roomGoals';
import type { GoalPlacementMode } from '../../scenes/editor/editRuntime';
import type { RoomCoordinates, RoomRecord, RoomVersionRecord } from '../../persistence/roomModel';

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
  canEditPreviousRoom: boolean;
  canEditNextRoom: boolean;
};

export interface EditorSceneBridge {
  getHistoryState?: () => EditorHistoryState;
  revertToVersion?: (targetVersion: number) => Promise<RoomRecord | null>;
  setCanonicalVersion?: (targetVersion: number) => Promise<RoomRecord | null>;
  setLeaderboardSourceVersion?: (
    targetVersion: number,
    sourceVersion: number | null
  ) => Promise<RoomRecord | null>;
  startPlayMode?: () => Promise<void> | void;
  saveDraft?: (
    force?: boolean,
    options?: { promptForSignInOnUnauthorized?: boolean }
  ) => Promise<RoomRecord | null>;
  publishRoom?: () => Promise<RoomRecord | null>;
  handlePublishNudgeAction?: () => Promise<void>;
  returnToWorld?: () => Promise<void> | void;
  returnToCourseBuilder?: () => Promise<void> | void;
  mintRoom?: () => Promise<RoomRecord | null>;
  refreshMintMetadata?: () => Promise<RoomRecord | null>;
  fitToScreen?: () => void;
  zoomIn?: () => void;
  zoomOut?: () => void;
  updateToolUi?: () => void;
  clearCurrentLayer?: () => void;
  clearAllTiles?: () => void;
  setRoomTitle?: (title: string | null) => void;
  setGoalType?: (nextType: RoomGoalType | null) => void;
  setGoalTimeLimitSeconds?: (seconds: number | null) => void;
  setGoalRequiredCount?: (requiredCount: number) => void;
  setGoalSurvivalSeconds?: (seconds: number) => void;
  startGoalMarkerPlacement?: (mode: EditorMarkerPlacementMode) => void;
  clearGoalMarkers?: () => void;
  getCourseEditorState?: () => EditorCourseUiState;
  setCourseGoalType?: (goalType: CourseGoalType | null) => void;
  setCourseGoalTimeLimitSeconds?: (seconds: number | null) => void;
  setCourseGoalRequiredCount?: (requiredCount: number) => void;
  setCourseGoalSurvivalSeconds?: (seconds: number) => void;
  startCourseGoalMarkerPlacement?: (mode: EditorMarkerPlacementMode) => void;
  clearCourseGoalMarkers?: () => void;
  editPreviousCourseRoom?: () => Promise<void> | void;
  editNextCourseRoom?: () => Promise<void> | void;
  beginFocusedPressurePlateConnection?: () => void;
  clearFocusedPressurePlateConnection?: () => void;
  cancelPressurePlateConnection?: () => void;
  clearFocusedContainerContents?: () => void;
  undoAction?: () => void;
  redoAction?: () => void;
}

export type OverworldSelectedRoomContext = {
  roomId: string;
  coordinates: RoomCoordinates;
  state: 'published' | 'draft' | 'frontier' | 'empty';
  courseId: string | null;
  courseTitle: string | null;
  courseGoalType: CourseGoalType | null;
  courseRoomCount: number | null;
};

export const COURSE_COMPOSER_STATE_CHANGED_EVENT = 'course-composer-state-changed';

export interface CourseComposerSceneBridge {
  getCourseEditorState?: () => CourseEditorUiState | null;
  returnToWorld?: () => Promise<void> | void;
  setCourseTitle?: (title: string | null) => void;
  centerSelectedRoom?: () => void;
  selectRoom?: (roomId: string) => void;
  toggleSelectedRoomMembership?: () => void;
  openSelectedRoom?: () => Promise<void> | void;
  openCourseEditor?: () => Promise<void> | void;
  moveCheckpoint?: (index: number, direction: -1 | 1) => void;
  removeCheckpoint?: (index: number) => void;
  zoomIn?: () => void;
  zoomOut?: () => void;
  fitCourseToView?: () => void;
  saveCourseDraft?: () => Promise<void>;
  publishCourseDraft?: () => Promise<void>;
  unpublishCourse?: () => Promise<void>;
  testDraftCourse?: () => Promise<void> | void;
}

export type CourseMarkerPlacementMode = 'start' | 'checkpoint' | 'finish';

export type CourseComposerState = {
  courseId: string | null;
  title: string;
  roomRefs: CourseRoomRef[];
  goalType: CourseGoalType | null;
  timeLimitSeconds: number | null;
  requiredCount: number | null;
  survivalSeconds: number | null;
  startPointRoomId: string | null;
  checkpointCount: number;
  finishRoomId: string | null;
  selectedRoomInDraft: boolean;
  selectedRoomEligible: boolean;
  selectedRoomId: string | null;
  canEdit: boolean;
  published: boolean;
  publishedVersion: number | null;
  publishedRoomCount: number;
  publishedStateText: string;
  publishedDraftWarningText: string | null;
  dirty: boolean;
  statusText: string | null;
  selectedRoomOrder: number | null;
  canMoveSelectedRoomEarlier: boolean;
  canMoveSelectedRoomLater: boolean;
  canEditSelectedRoom: boolean;
  canTestDraft: boolean;
  testDraftDisabledReason: string | null;
  canSaveDraft: boolean;
  saveDraftDisabledReason: string | null;
  canPublishCourse: boolean;
  publishCourseDisabledReason: string | null;
  showUnpublishCourse: boolean;
  canUnpublishCourse: boolean;
  unpublishCourseDisabledReason: string | null;
};

export interface OverworldSceneBridge {
  playSelectedRoom?: () => void;
  playSelectedCourse?: () => Promise<void> | void;
  editSelectedRoom?: () => void;
  buildSelectedRoom?: () => void;
  zoomIn?: () => void;
  zoomOut?: () => void;
  jumpToCoordinates?: (coordinates: RoomCoordinates) => Promise<void> | void;
  fitLoadedWorld?: () => void;
  returnToWorld?: () => void;
  getSelectedRoomContext?: () => OverworldSelectedRoomContext;
  openCourseComposer?: () => Promise<void> | void;
  openCourseEditor?: () => Promise<void> | void;
  closeCourseComposer?: () => void;
  getCourseComposerState?: () => CourseComposerState | null;
  selectCourseRoomInComposer?: (roomId: string) => void;
  setCourseTitle?: (title: string | null) => void;
  addSelectedRoomToCourseDraft?: () => void;
  removeSelectedRoomFromCourseDraft?: () => void;
  moveSelectedRoomEarlierInCourseDraft?: () => void;
  moveSelectedRoomLaterInCourseDraft?: () => void;
  editSelectedCourseRoom?: () => boolean;
  testDraftCourse?: () => Promise<void> | void;
  saveCourseDraft?: () => Promise<void>;
  publishCourseDraft?: () => Promise<void>;
  unpublishCourse?: () => Promise<void>;
}

function getScene<T>(game: Phaser.Game, key: string): T | null {
  try {
    return game.scene.getScene(key) as T;
  } catch {
    return null;
  }
}

export function getEditorScene(game: Phaser.Game): EditorSceneBridge | null {
  return getScene<EditorSceneBridge>(game, 'EditorScene');
}

export function getCourseWorkspaceScene(game: Phaser.Game): EditorSceneBridge | null {
  return getScene<EditorSceneBridge>(game, 'CourseEditorScene');
}

export function getOverworldScene(game: Phaser.Game): OverworldSceneBridge | null {
  return getScene<OverworldSceneBridge>(game, 'OverworldPlayScene');
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
  if (!game.scene.isActive('OverworldPlayScene')) {
    return null;
  }

  return getOverworldScene(game);
}

export function getCourseComposerScene(game: Phaser.Game): CourseComposerSceneBridge | null {
  return getScene<CourseComposerSceneBridge>(game, 'CourseComposerScene');
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

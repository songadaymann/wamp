import type Phaser from 'phaser';
import type { RoomEditorSceneBridge, CourseWorkspaceSceneBridge, OverworldSceneBridge, CourseComposerSceneBridge } from './sceneBridge';

export interface SceneCapabilities {
  EditorScene: RoomEditorSceneBridge;
  CourseEditorScene: CourseWorkspaceSceneBridge;
  OverworldPlayScene: OverworldSceneBridge;
  CourseComposerScene: CourseComposerSceneBridge;
}

type SceneKey = keyof SceneCapabilities;

/** Complete records make adding a capability fail typecheck until its runtime guard is updated. */
export const SCENE_CAPABILITY_METHODS = {
  EditorScene: {
    startPlayMode: true,
    saveDraft: true,
    publishRoom: true,
    returnToWorld: true,
    returnToCourseBuilder: true,
    setRoomTitle: true,
    fitToScreen: true,
    zoomIn: true,
    zoomOut: true,
    updateToolUi: true,
    useCustomSpriteAsTile: true,
    usesCustomSprite: true,
    setPlacedSignText: true,
    undoAction: true,
    redoAction: true,
    setGoalType: true,
    setGoalTimeLimitSeconds: true,
    setGoalRequiredCount: true,
    setGoalSurvivalSeconds: true,
    startGoalMarkerPlacement: true,
    clearGoalMarkers: true,
    getCourseEditorState: true,
    setCourseGoalType: true,
    setCourseGoalTimeLimitSeconds: true,
    setCourseGoalRequiredCount: true,
    setCourseGoalSurvivalSeconds: true,
    startCourseGoalMarkerPlacement: true,
    clearCourseGoalMarkers: true,
    getMusicWorkflow: true,
    getHistoryState: true,
    loadHistory: true,
    revertToVersion: true,
    adminRestoreToVersion: true,
    setCanonicalVersion: true,
    setLeaderboardSourceVersion: true,
    exportWampOGramRoomSnapshot: true,
    handlePublishNudgeAction: true,
    mintRoom: true,
    refreshMintMetadata: true,
    beginFocusedPressurePlateConnection: true,
    clearFocusedPressurePlateConnection: true,
    cancelPressurePlateConnection: true,
    clearFocusedContainerContents: true,
  },
  CourseEditorScene: {
    startPlayMode: true,
    saveDraft: true,
    publishRoom: true,
    returnToWorld: true,
    returnToCourseBuilder: true,
    setRoomTitle: true,
    fitToScreen: true,
    zoomIn: true,
    zoomOut: true,
    updateToolUi: true,
    useCustomSpriteAsTile: true,
    usesCustomSprite: true,
    setPlacedSignText: true,
    undoAction: true,
    redoAction: true,
    setGoalType: true,
    setGoalTimeLimitSeconds: true,
    setGoalRequiredCount: true,
    setGoalSurvivalSeconds: true,
    startGoalMarkerPlacement: true,
    clearGoalMarkers: true,
    getCourseEditorState: true,
    setCourseGoalType: true,
    setCourseGoalTimeLimitSeconds: true,
    setCourseGoalRequiredCount: true,
    setCourseGoalSurvivalSeconds: true,
    startCourseGoalMarkerPlacement: true,
    clearCourseGoalMarkers: true,
    getMusicWorkflow: true,
    saveCourseDraft: true,
    publishCourseDraft: true,
  },
  OverworldPlayScene: {
    getPerformanceAdvisorSuggestion: true,
    canPresentPerformanceAdvisorSuggestion: true,
    dismissPerformanceAdvisorSuggestion: true,
    setPerformanceSuggestionPauseRequested: true,
    playSelectedRoom: true,
    restartCurrentRun: true,
    startRoomRushRun: true,
    endRoomRushRun: true,
    isRoomRushRunActive: true,
    stopCurrentPlay: true,
    invitePvpDuel: true,
    openMultiplayerLauncher: true,
    inviteMultiplayer: true,
    playSelectedCourse: true,
    editSelectedRoom: true,
    buildSelectedRoom: true,
    openGuestDraftRoom: true,
    zoomIn: true,
    zoomOut: true,
    jumpToCoordinates: true,
    fitLoadedWorld: true,
    returnToWorld: true,
    getSelectedRoomContext: true,
    openRoomChatComposer: true,
    closeRoomChatComposer: true,
    isRoomChatComposerOpen: true,
    openRoomCommentComposer: true,
    closeRoomCommentComposer: true,
    isRoomCommentComposerOpen: true,
    toggleRoomComments: true,
    openCourseComposer: true,
    openCourseEditor: true,
    getMobilePortraitCameraTuning: true,
    setMobilePortraitCameraTuning: true,
    adjustMobilePortraitCameraTuning: true,
    resetMobilePortraitCameraTuning: true,
    logMobilePortraitCameraTuning: true,
  },
  CourseComposerScene: {
    getCourseEditorState: true,
    returnToWorld: true,
    setCourseTitle: true,
    setCoursePitsAreDeadly: true,
    setCoursePlayerHearts: true,
    centerSelectedRoom: true,
    selectRoom: true,
    toggleSelectedRoomMembership: true,
    openSelectedRoom: true,
    openCourseEditor: true,
    moveCheckpoint: true,
    removeCheckpoint: true,
    zoomIn: true,
    zoomOut: true,
    fitCourseToView: true,
    keepMapCenterWhile: true,
    saveCourseDraft: true,
    publishCourseDraft: true,
    unpublishCourse: true,
    testDraftCourse: true,
  },
} satisfies { [Key in SceneKey]: Record<keyof SceneCapabilities[Key], true> };

const validatedScenes = new WeakMap<object, Set<SceneKey>>();

function supportsCapabilities<Key extends SceneKey>(value: unknown, key: Key): value is SceneCapabilities[Key] {
  if (value === null || typeof value !== 'object') return false;
  const known = validatedScenes.get(value);
  if (known?.has(key)) return true;
  if (!Object.keys(SCENE_CAPABILITY_METHODS[key]).every(method => typeof Reflect.get(value, method) === 'function')) return false;
  const capabilities = known ?? new Set<SceneKey>();
  capabilities.add(key);
  validatedScenes.set(value, capabilities);
  return true;
}

export function getSceneWithCapabilities<Key extends SceneKey>(game: Phaser.Game, key: Key): SceneCapabilities[Key] | null {
  try {
    const scene: unknown = game.scene.getScene(key);
    return supportsCapabilities(scene, key) ? scene : null;
  } catch {
    return null;
  }
}

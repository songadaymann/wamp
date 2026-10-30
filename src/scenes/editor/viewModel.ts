import { getRoomGoalAuthoringControls } from './goalDocument';
import type { RoomGoal } from '../../goals/roomGoals';
import type { RoomCoordinates, RoomPermissions, RoomVersionRecord } from '../../persistence/roomRepository';
import type { EditorUiViewModel } from './uiBridge';
import type { GoalPlacementMode } from './editRuntime';
import type { EditorStatusDetails } from './roomSession';
import type { EditorCourseUiState } from '../../ui/setup/sceneBridge';
import { normalizePlayerHearts, type PlayerHearts } from '../../player/hearts';
import { getActiveRoomVideoRuntime, roomVideoUiFields } from '../../roomVideo/uiState';
import type { ReadyToPublishChecklist } from './clearCheck';

export interface BuildEditorUiViewModelOptions {
  clearCheck?: ReadyToPublishChecklist;
  roomTitle: string | null;
  roomCameraCentered?: boolean;
  roomPitsAreDeadly?: boolean;
  roomPlayerHearts?: PlayerHearts;
  roomVideoUrl?: string;
  roomVideoStatus?: string;
  roomVideoLoop?: boolean;
  roomVideoAutoplay?: boolean;
  roomVideoTrigger?: boolean;
  roomVideoVolume?: number;
  roomVideoMuteMusic?: boolean;
  roomVideoSnap?: boolean;
  roomVideoHasVideo?: boolean;
  roomVideoLocked?: boolean;
  roomCoordinates: RoomCoordinates;
  roomGoal: RoomGoal | null;
  roomGoalIntroText: string | null;
  roomPlacementMode: GoalPlacementMode;
  goalUsesMarkers: boolean;
  goalSummaryText: string;
  roomPermissions: RoomPermissions;
  publishValidationError: string | null;
  isProtected: boolean;
  canRefreshMintMetadata: boolean;
  saveInFlight: boolean;
  mintedMetadataCurrent: boolean;
  publishedVersion: number;
  roomVersionHistory: RoomVersionRecord[];
  entrySource: 'world' | 'direct';
  zoomText: string;
  canUndo: boolean;
  canRedo: boolean;
  saveStatus: EditorStatusDetails;
  publishNudgeVisible: boolean;
  publishNudgeText: string;
  publishNudgeActionText: string;
  courseEditorState: EditorCourseUiState;
}

export function shouldShowPublishNudge(
  publishedVersion: number,
  canSaveDraft: boolean,
  isProtected: boolean,
  roomEditCount: number,
  threshold: number,
): boolean {
  return (
    publishedVersion === 0 &&
    canSaveDraft &&
    !isProtected &&
    roomEditCount >= threshold
  );
}

export function isRoomHistoryAvailable(
  publishedVersion: number,
  roomVersionHistory: RoomVersionRecord[],
): boolean {
  return publishedVersion > 0 || roomVersionHistory.length > 0;
}

export function buildEditorUiViewModel(
  options: BuildEditorUiViewModelOptions,
): EditorUiViewModel {
  const {
    roomTitle,
    roomCoordinates,
    roomGoal,
    roomGoalIntroText,
    roomPlacementMode,
    goalUsesMarkers,
    goalSummaryText,
    roomPermissions,
    publishValidationError,
    isProtected,
    canRefreshMintMetadata,
    saveInFlight,
    publishedVersion,
    roomVersionHistory,
    entrySource,
    zoomText,
    saveStatus,
    publishNudgeVisible,
    publishNudgeText,
    publishNudgeActionText,
    courseEditorState,
  } = options;
  const canReturnToCourseBuilder = courseEditorState.canReturnToCourseBuilder;
  const activeVideo = roomVideoUiFields(getActiveRoomVideoRuntime());

  return {
    roomTitleValue: roomTitle ?? '',
    roomCameraCentered: options.roomCameraCentered === true,
    roomPitsAreDeadly: options.roomPitsAreDeadly === true,
    roomPlayerHearts: normalizePlayerHearts(options.roomPlayerHearts),
    roomVideoUrl: options.roomVideoUrl ?? activeVideo.roomVideoUrl,
    roomVideoStatus: options.roomVideoStatus ?? activeVideo.roomVideoStatus,
    roomVideoLoop: options.roomVideoLoop ?? activeVideo.roomVideoLoop,
    roomVideoAutoplay: options.roomVideoAutoplay ?? activeVideo.roomVideoAutoplay,
    roomVideoTrigger: options.roomVideoTrigger ?? activeVideo.roomVideoTrigger,
    roomVideoVolume: options.roomVideoVolume ?? activeVideo.roomVideoVolume,
    roomVideoMuteMusic: options.roomVideoMuteMusic ?? activeVideo.roomVideoMuteMusic,
    roomVideoSnap: options.roomVideoSnap ?? activeVideo.roomVideoSnap,
    roomVideoHasVideo: options.roomVideoHasVideo ?? activeVideo.roomVideoHasVideo,
    roomVideoLocked: options.roomVideoLocked ?? activeVideo.roomVideoLocked,
    roomCoordinatesText: `Room (${roomCoordinates.x}, ${roomCoordinates.y})`,
    saveStatusText: saveStatus.text,
    saveStatusAccentText: saveStatus.accentText,
    saveStatusLinkText: saveStatus.linkLabel,
    saveStatusLinkHref: saveStatus.linkHref,
    publishNudgeVisible,
    publishNudgeText,
    publishNudgeActionText,
    zoomText,
    canUndo: options.canUndo,
    canRedo: options.canRedo,
    backButtonHidden: entrySource !== 'world' && !canReturnToCourseBuilder,
    backButtonText: canReturnToCourseBuilder ? 'Expanded Room' : 'World',
    backButtonTitle: canReturnToCourseBuilder ? 'Return to Expanded Room Builder (Esc)' : 'Return to World (Esc)',
    playHidden: false,
    saveHidden: false,
    saveButtonText: 'Save Room',
    saveButtonTitle: 'Save Room Draft (Cmd/Ctrl+S)',
    saveDisabled: !roomPermissions.canSaveDraft,
    publishHidden: false,
    clearCheck: options.clearCheck,
    publishButtonText: options.clearCheck?.cleared ? 'Publish Room ✓' : 'Publish Room',
    publishButtonTitle: !roomPermissions.canPublish
      ? 'You cannot publish this room.'
      : publishValidationError ?? 'Publish Room (Cmd/Ctrl+Shift+P)',
    publishDisabled: !roomPermissions.canPublish || saveInFlight,
    publishButtonAriaDisabled: Boolean(publishValidationError),
    mintHidden: false,
    mintDisabled: isProtected || saveInFlight,
    mintButtonText: isProtected ? 'Collected & Locked' : 'Collect & Lock',
    refreshMetadataHidden: !isProtected,
    refreshMetadataDisabled: !canRefreshMintMetadata || saveInFlight,
    refreshMetadataButtonText: 'Add/update artwork',
    historyHidden: false,
    historyDisabled: !isRoomHistoryAvailable(publishedVersion, roomVersionHistory),
    fitHidden: false,
    goal: {
      goalTypeValue: roomGoal?.type ?? '',
      goalTypeDisabled: false,
      ...getRoomGoalAuthoringControls(roomGoal),
      timeLimitDisabled: false,
      requiredCountDisabled: false,
      survivalDisabled: false,
      introTextHidden: !roomGoal,
      introTextDisabled: !roomGoal,
      introTextValue: roomGoalIntroText ?? '',
      markerControlsHidden: !goalUsesMarkers,
      placementHintHidden: roomPlacementMode === null,
      placementHintText:
        roomPlacementMode === 'exit'
          ? 'Click the canvas to place the exit marker.'
          : roomPlacementMode === 'checkpoint'
            ? 'Click the canvas to add a checkpoint marker.'
            : roomPlacementMode === 'finish'
              ? 'Click the canvas to place the finish marker.'
              : roomPlacementMode === 'npc'
                ? 'Click an NPC in the room to link it.'
                : roomPlacementMode === 'npc_destination'
                  ? 'Click the canvas to set the escort destination.'
              : '',
      summaryText: goalSummaryText,
      contextHidden: true,
      contextText: '',
      placeStartHidden: true,
      placeStartActive: false,
      placeExitActive: roomPlacementMode === 'exit',
      addCheckpointActive: roomPlacementMode === 'checkpoint',
      placeFinishActive: roomPlacementMode === 'finish',
      linkNpcActive: roomPlacementMode === 'npc',
      placeNpcDestinationActive: roomPlacementMode === 'npc_destination',
    },
    course: {
      pitsAreDeadly: courseEditorState.pitsAreDeadly === true,
      playerHearts: normalizePlayerHearts(courseEditorState.playerHearts),
      pitsDisabled: courseEditorState.pitsDisabled !== false,
      visible: courseEditorState.visible,
      statusHidden: courseEditorState.statusHidden,
      statusText: courseEditorState.statusText ?? '',
      roomStepText: courseEditorState.roomStepText,
      canReturnToCourseBuilder: courseEditorState.canReturnToCourseBuilder,
      goalTypeValue: courseEditorState.goalTypeValue,
      goalTypeDisabled: courseEditorState.goalTypeDisabled,
      timeLimitHidden: courseEditorState.timeLimitHidden,
      timeLimitDisabled: courseEditorState.timeLimitDisabled,
      timeLimitValue: courseEditorState.timeLimitValue,
      requiredCountHidden: courseEditorState.requiredCountHidden,
      requiredCountDisabled: courseEditorState.requiredCountDisabled,
      requiredCountValue: courseEditorState.requiredCountValue,
      survivalHidden: courseEditorState.survivalHidden,
      survivalDisabled: courseEditorState.survivalDisabled,
      survivalValue: courseEditorState.survivalValue,
      markerControlsHidden: courseEditorState.markerControlsHidden,
      placementHintHidden: courseEditorState.placementHintHidden,
      placementHintText: courseEditorState.placementHintText,
      summaryText: courseEditorState.summaryText,
      placeStartHidden: courseEditorState.placeStartHidden,
      placeStartActive: courseEditorState.placeStartActive,
      placeExitHidden: courseEditorState.placeExitHidden,
      placeExitActive: courseEditorState.placeExitActive,
      addCheckpointHidden: courseEditorState.addCheckpointHidden,
      addCheckpointActive: courseEditorState.addCheckpointActive,
      placeFinishHidden: courseEditorState.placeFinishHidden,
      placeFinishActive: courseEditorState.placeFinishActive,
    },
  };
}

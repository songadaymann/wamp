import { goalSupportsTimeLimit, type RoomGoal } from '../../goals/roomGoals';
import type { RoomCoordinates, RoomPermissions, RoomVersionRecord } from '../../persistence/roomRepository';
import type { EditorUiViewModel } from './uiBridge';
import type { GoalPlacementMode } from './editRuntime';
import type { EditorStatusDetails } from './roomSession';
import type { EditorCourseUiState } from '../../ui/setup/sceneBridge';

export interface BuildEditorUiViewModelOptions {
  roomTitle: string | null;
  roomCoordinates: RoomCoordinates;
  roomGoal: RoomGoal | null;
  roomPlacementMode: GoalPlacementMode;
  goalUsesMarkers: boolean;
  goalSummaryText: string;
  roomPermissions: RoomPermissions;
  mintedTokenId: string | null;
  canRefreshMintMetadata: boolean;
  saveInFlight: boolean;
  mintedMetadataCurrent: boolean;
  roomVersionHistory: RoomVersionRecord[];
  entrySource: 'world' | 'direct';
  zoomText: string;
  saveStatus: EditorStatusDetails;
  publishNudgeVisible: boolean;
  publishNudgeText: string;
  publishNudgeActionText: string;
  courseEditorState: EditorCourseUiState;
}

export function shouldShowPublishNudge(
  publishedVersion: number,
  canSaveDraft: boolean,
  mintedTokenId: string | null,
  roomEditCount: number,
  threshold: number,
): boolean {
  return (
    publishedVersion === 0 &&
    canSaveDraft &&
    !mintedTokenId &&
    roomEditCount >= threshold
  );
}

export function buildEditorUiViewModel(
  options: BuildEditorUiViewModelOptions,
): EditorUiViewModel {
  const {
    roomTitle,
    roomCoordinates,
    roomGoal,
    roomPlacementMode,
    goalUsesMarkers,
    goalSummaryText,
    roomPermissions,
    mintedTokenId,
    canRefreshMintMetadata,
    saveInFlight,
    mintedMetadataCurrent,
    roomVersionHistory,
    entrySource,
    zoomText,
    saveStatus,
    publishNudgeVisible,
    publishNudgeText,
    publishNudgeActionText,
    courseEditorState,
  } = options;

  return {
    roomTitleValue: roomTitle ?? '',
    roomCoordinatesText: `Room (${roomCoordinates.x}, ${roomCoordinates.y})`,
    saveStatusText: saveStatus.text,
    saveStatusAccentText: saveStatus.accentText,
    saveStatusLinkText: saveStatus.linkLabel,
    saveStatusLinkHref: saveStatus.linkHref,
    publishNudgeVisible,
    publishNudgeText,
    publishNudgeActionText,
    zoomText,
    backToWorldHidden: entrySource !== 'world',
    backToCourseBuilderHidden: !courseEditorState.canReturnToCourseBuilder,
    playHidden: false,
    saveHidden: false,
    saveDisabled: !roomPermissions.canSaveDraft,
    publishHidden: false,
    publishDisabled: !roomPermissions.canPublish,
    mintHidden: false,
    mintDisabled: Boolean(mintedTokenId) || saveInFlight,
    mintButtonText: mintedTokenId ? 'Minted' : 'Mint Room',
    refreshMetadataHidden: !mintedTokenId,
    refreshMetadataDisabled: !canRefreshMintMetadata || saveInFlight,
    refreshMetadataButtonText: mintedMetadataCurrent
      ? 'Refresh NFT Metadata'
      : 'Refresh NFT Metadata',
    historyHidden: false,
    historyDisabled: roomVersionHistory.length === 0,
    fitHidden: false,
    goal: {
      goalTypeValue: roomGoal?.type ?? '',
      goalTypeDisabled: false,
      timeLimitHidden: !roomGoal || !goalSupportsTimeLimit(roomGoal.type),
      timeLimitDisabled: false,
      timeLimitValue:
        roomGoal &&
        goalSupportsTimeLimit(roomGoal.type) &&
        roomGoal.type !== 'survival' &&
        roomGoal.timeLimitMs
          ? String(Math.round(roomGoal.timeLimitMs / 1000))
          : '',
      requiredCountHidden: roomGoal?.type !== 'collect_target',
      requiredCountDisabled: false,
      requiredCountValue:
        roomGoal?.type === 'collect_target' ? String(roomGoal.requiredCount) : '1',
      survivalHidden: roomGoal?.type !== 'survival',
      survivalDisabled: false,
      survivalValue:
        roomGoal?.type === 'survival'
          ? String(Math.round(roomGoal.durationMs / 1000))
          : '30',
      markerControlsHidden: !goalUsesMarkers,
      placementHintHidden: roomPlacementMode === null,
      placementHintText:
        roomPlacementMode === 'exit'
          ? 'Click the canvas to place the exit marker.'
          : roomPlacementMode === 'checkpoint'
            ? 'Click the canvas to add a checkpoint marker.'
            : roomPlacementMode === 'finish'
              ? 'Click the canvas to place the finish marker.'
              : '',
      summaryText: goalSummaryText,
      contextHidden: true,
      contextText: '',
      placeStartHidden: true,
      placeStartActive: false,
      placeExitHidden: roomGoal?.type !== 'reach_exit',
      placeExitActive: roomPlacementMode === 'exit',
      addCheckpointHidden: roomGoal?.type !== 'checkpoint_sprint',
      addCheckpointActive: roomPlacementMode === 'checkpoint',
      placeFinishHidden: roomGoal?.type !== 'checkpoint_sprint',
      placeFinishActive: roomPlacementMode === 'finish',
    },
    course: {
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
      canEditPreviousRoom: courseEditorState.canEditPreviousRoom,
      canEditNextRoom: courseEditorState.canEditNextRoom,
    },
  };
}

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
  roomGoalIntroText: string | null;
  roomPlacementMode: GoalPlacementMode;
  goalUsesMarkers: boolean;
  goalSummaryText: string;
  roomPermissions: RoomPermissions;
  publishValidationError: string | null;
  mintedTokenId: string | null;
  canRefreshMintMetadata: boolean;
  saveInFlight: boolean;
  mintedMetadataCurrent: boolean;
  publishedVersion: number;
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
    mintedTokenId,
    canRefreshMintMetadata,
    saveInFlight,
    mintedMetadataCurrent,
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
    backButtonHidden: entrySource !== 'world' && !canReturnToCourseBuilder,
    backButtonText: canReturnToCourseBuilder ? 'Expanded Room' : 'World',
    backButtonTitle: canReturnToCourseBuilder ? 'Return to Expanded Room Builder (Esc)' : 'Return to World (Esc)',
    playHidden: false,
    saveHidden: false,
    saveButtonText: 'Save Room',
    saveButtonTitle: 'Save Room Draft (Cmd/Ctrl+S)',
    saveDisabled: !roomPermissions.canSaveDraft,
    publishHidden: false,
    publishButtonText: 'Publish Room',
    publishButtonTitle: !roomPermissions.canPublish
      ? 'You cannot publish this room.'
      : publishValidationError ?? 'Publish Room (Cmd/Ctrl+Shift+P)',
    publishDisabled: !roomPermissions.canPublish || saveInFlight,
    publishButtonAriaDisabled: Boolean(publishValidationError),
    mintHidden: false,
    mintDisabled: Boolean(mintedTokenId) || saveInFlight,
    mintButtonText: mintedTokenId ? 'Minted' : 'Mint Room',
    refreshMetadataHidden: !mintedTokenId,
    refreshMetadataDisabled: !canRefreshMintMetadata || saveInFlight,
    refreshMetadataButtonText: mintedMetadataCurrent
      ? 'Refresh NFT Metadata'
      : 'Refresh NFT Metadata',
    historyHidden: false,
    historyDisabled: !isRoomHistoryAvailable(publishedVersion, roomVersionHistory),
    fitHidden: false,
    goal: {
      goalTypeValue: roomGoal?.type ?? '',
      goalTypeDisabled: false,
      npcQuestTypeHidden: roomGoal?.type !== 'npc_quest',
      npcQuestTypeValue: roomGoal?.type === 'npc_quest' ? roomGoal.questType : 'protect',
      timeLimitHidden: !roomGoal || !goalSupportsTimeLimit(roomGoal.type),
      timeLimitDisabled: false,
      timeLimitValue:
        roomGoal &&
        goalSupportsTimeLimit(roomGoal.type) &&
        roomGoal.type !== 'survival' &&
        roomGoal.timeLimitMs
          ? String(Math.round(roomGoal.timeLimitMs / 1000))
          : '',
      requiredCountHidden:
        roomGoal?.type !== 'collect_target' &&
        !(roomGoal?.type === 'npc_quest' && roomGoal.questType === 'give'),
      requiredCountDisabled: false,
      requiredCountValue:
        roomGoal?.type === 'collect_target' ||
        (roomGoal?.type === 'npc_quest' && roomGoal.questType === 'give')
          ? String(roomGoal.requiredCount)
          : '1',
      survivalHidden:
        roomGoal?.type !== 'survival' &&
        !(roomGoal?.type === 'npc_quest' && roomGoal.questType === 'protect'),
      survivalDisabled: false,
      survivalValue:
        roomGoal?.type === 'survival' ||
        (roomGoal?.type === 'npc_quest' && roomGoal.questType === 'protect')
          ? String(Math.round(roomGoal.durationMs / 1000))
          : '30',
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
      placeExitHidden: roomGoal?.type !== 'reach_exit',
      placeExitActive: roomPlacementMode === 'exit',
      addCheckpointHidden: roomGoal?.type !== 'checkpoint_sprint',
      addCheckpointActive: roomPlacementMode === 'checkpoint',
      placeFinishHidden: roomGoal?.type !== 'checkpoint_sprint',
      placeFinishActive: roomPlacementMode === 'finish',
      linkNpcHidden: roomGoal?.type !== 'npc_quest',
      linkNpcActive: roomPlacementMode === 'npc',
      placeNpcDestinationHidden:
        roomGoal?.type !== 'npc_quest' || roomGoal.questType !== 'escort',
      placeNpcDestinationActive: roomPlacementMode === 'npc_destination',
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
    },
  };
}

import { goalSupportsTimeLimit, type RoomGoal } from '../../goals/roomGoals';
import {
  getDefaultRoomMusicPack,
  getRoomMusicClip,
  getRoomMusicClipsForLane,
} from '../../music/catalog';
import {
  createEmptyRoomMusicLaneAssignments,
  type RoomMusic,
  type RoomMusicLaneId,
} from '../../music/model';
import type { RoomCoordinates, RoomPermissions, RoomVersionRecord } from '../../persistence/roomRepository';
import type { EditorUiViewModel } from './uiBridge';
import type { GoalPlacementMode } from './editRuntime';
import type { EditorStatusDetails } from './roomSession';
import type { EditorCourseUiState, EditorMusicTab } from '../../ui/setup/sceneBridge';

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
  roomMusic: RoomMusic | null;
  musicModeActive: boolean;
  musicPreviewState: 'stopped' | 'playing' | 'paused';
  musicEditorTab: EditorMusicTab;
  musicPickerLaneId: RoomMusicLaneId | null;
  musicPickerBarIndex: number | null;
  musicPickerPreviewClipId: string | null;
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

function buildMusicUiViewModel(
  roomMusic: RoomMusic | null,
  options: {
    musicModeActive: boolean;
    musicPreviewState: 'stopped' | 'playing' | 'paused';
    musicEditorTab: EditorMusicTab;
    musicPickerLaneId: RoomMusicLaneId | null;
    musicPickerBarIndex: number | null;
    musicPickerPreviewClipId: string | null;
  },
): EditorUiViewModel['music'] {
  const pack = getDefaultRoomMusicPack();
  const laneAssignments =
    roomMusic?.arrangement.laneAssignments ?? createEmptyRoomMusicLaneAssignments(pack.barCount);
  const assignedCount = pack.lanes.reduce((count, lane) => {
    return count + laneAssignments[lane.id].filter((clipId) => Boolean(clipId)).length;
  }, 0);
  const pickerLane = options.musicPickerLaneId
    ? pack.lanes.find((lane) => lane.id === options.musicPickerLaneId) ?? null
    : null;
  const pickerBarIndex =
    pickerLane && options.musicPickerBarIndex !== null && options.musicPickerBarIndex >= 0
      ? Math.min(pack.barCount - 1, options.musicPickerBarIndex)
      : null;
  const pickerClipId =
    pickerLane !== null && pickerBarIndex !== null
      ? laneAssignments[pickerLane.id][pickerBarIndex] ?? null
      : null;
  const pickerClipLabel =
    pickerClipId && pickerLane && pickerBarIndex !== null
      ? `Bar ${pickerBarIndex + 1}: ${getRoomMusicClip(pack, pickerClipId)?.label ?? 'Assigned clip'}`
      : 'No clip assigned for this bar.';

  return {
    sectionHidden: false,
    modeButtonText: options.musicModeActive ? 'Close Music' : 'Edit Music',
    modeButtonActive: options.musicModeActive,
    summaryText:
      assignedCount > 0
        ? `${assignedCount}/${pack.lanes.length * pack.barCount} bar slots assigned in ${pack.label}.`
        : 'No room music yet. Pick stems for each bar to give this room its own loop.',
    overlayVisible: options.musicModeActive,
    packLabel: pack.label,
    modeStatusText:
      options.musicEditorTab === 'advanced'
        ? 'Advanced grid is reserved for phase two. Arrange stems here for now.'
        : 'Arrange mode is bar-based. Room editing stays locked until you close this overlay.',
    previewButtonText:
      options.musicPreviewState === 'playing'
        ? 'Pause'
        : options.musicPreviewState === 'paused'
          ? 'Resume'
          : 'Play',
    stopDisabled: options.musicPreviewState === 'stopped',
    arrangeTabActive: options.musicEditorTab === 'arrange',
    advancedTabActive: options.musicEditorTab === 'advanced',
    advancedDisabled: false,
    lanes: pack.lanes.map((lane) => ({
      laneId: lane.id,
      label: lane.label,
      cells: Array.from({ length: pack.barCount }, (_value, barIndex) => {
        const clipId = laneAssignments[lane.id][barIndex] ?? null;
        return {
          laneId: lane.id,
          barIndex,
          barNumber: barIndex + 1,
          clipLabel: clipId
            ? getRoomMusicClip(pack, clipId)?.label ?? 'Assigned clip'
            : `Choose ${lane.label}`,
          clipAssigned: Boolean(clipId),
        };
      }),
    })),
    picker: {
      open: pickerLane !== null && pickerBarIndex !== null,
      laneId: pickerLane?.id ?? null,
      barIndex: pickerBarIndex,
      barNumber: pickerBarIndex === null ? null : pickerBarIndex + 1,
      laneLabel: pickerLane?.label ?? '',
      currentClipLabel: pickerClipLabel,
      clearDisabled: pickerClipId === null,
      clips:
        pickerLane
          ? getRoomMusicClipsForLane(pack, pickerLane.id).map((clip) => ({
              clipId: clip.id,
              label: clip.label,
              selected: clip.id === pickerClipId,
              previewing: clip.id === options.musicPickerPreviewClipId,
            }))
          : [],
    },
  };
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
    roomMusic,
    musicModeActive,
    musicPreviewState,
    musicEditorTab,
    musicPickerLaneId,
    musicPickerBarIndex,
    musicPickerPreviewClipId,
  } = options;
  const canReturnToCourseBuilder = courseEditorState.canReturnToCourseBuilder;

  return {
    roomTitleValue: roomTitle ?? '',
    roomCoordinatesText: `Room (${roomCoordinates.x}, ${roomCoordinates.y})`,
    saveStatusText: saveStatus.text,
    saveStatusAccentText: saveStatus.accentText,
    saveStatusLinkText: saveStatus.linkLabel,
    saveStatusLinkHref: saveStatus.linkHref,
    saveButtonTitle: 'Save Room Draft (Cmd/Ctrl+S)',
    publishButtonTitle: 'Publish Room (Cmd/Ctrl+Shift+P)',
    publishNudgeVisible,
    publishNudgeText,
    publishNudgeActionText,
    zoomText,
    backButtonHidden: entrySource !== 'world' && !canReturnToCourseBuilder,
    backButtonText: canReturnToCourseBuilder ? 'Course' : 'World',
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
    music: buildMusicUiViewModel(roomMusic, {
      musicModeActive,
      musicPreviewState,
      musicEditorTab,
      musicPickerLaneId,
      musicPickerBarIndex,
      musicPickerPreviewClipId,
    }),
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

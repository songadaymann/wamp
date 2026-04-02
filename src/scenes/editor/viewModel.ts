import { goalSupportsTimeLimit, type RoomGoal } from '../../goals/roomGoals';
import {
  createDefaultRoomPatternMusic,
  getPatternInstrumentLabel,
  isPatternRoomMusic,
  isStemArrangementRoomMusic,
  type RoomMusic,
  type RoomPatternInstrumentId,
} from '../../music/model';
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
  roomMusic: RoomMusic | null;
  musicModeActive: boolean;
  musicPreviewState: 'stopped' | 'playing' | 'paused';
  musicPatternInstrumentTab: RoomPatternInstrumentId;
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
    musicPatternInstrumentTab: RoomPatternInstrumentId;
  },
): EditorUiViewModel['music'] {
  const instrumentTabs: RoomPatternInstrumentId[] = ['drums', 'triangle', 'saw', 'square'];
  const displayPattern = isPatternRoomMusic(roomMusic) ? roomMusic : createDefaultRoomPatternMusic();
  const activeInstrumentTab = options.musicPatternInstrumentTab;
  const activeOctaveShift =
    activeInstrumentTab === 'drums'
      ? null
      : displayPattern.octaveShift[activeInstrumentTab];

  let totalPatternCellCount = 0;
  if (isPatternRoomMusic(roomMusic)) {
    totalPatternCellCount += roomMusic.tabs.triangle.steps.filter((rowIndex) => rowIndex !== null).length;
    totalPatternCellCount += roomMusic.tabs.saw.steps.filter((rowIndex) => rowIndex !== null).length;
    totalPatternCellCount += roomMusic.tabs.square.steps.filter((rowIndex) => rowIndex !== null).length;
    totalPatternCellCount += Object.values(roomMusic.tabs.drums).reduce(
      (count, steps) => count + steps.length,
      0,
    );
  }

  const legacyStemVisible = isStemArrangementRoomMusic(roomMusic);
  const summaryText = legacyStemVisible
    ? 'This room still uses the older stem loop. Replace it to edit with the room sequencer.'
    : isPatternRoomMusic(roomMusic)
      ? `${totalPatternCellCount} programmed notes and hits in this room sequencer.`
      : 'No room music yet. Draw directly on the room grid to start a sequencer loop.';

  return {
    sectionHidden: false,
    modeButtonText: options.musicModeActive ? 'Close Music' : 'Edit Music',
    modeButtonActive: options.musicModeActive,
    summaryText,
    overlayVisible: options.musicModeActive,
    packLabel: legacyStemVisible ? 'Legacy Stem Loop' : 'Pattern Kit v1',
    modeStatusText: legacyStemVisible
      ? 'Legacy room music still plays, but the room-grid sequencer stays locked until you explicitly replace it.'
      : `Room grid sequencer active. ${getPatternInstrumentLabel(activeInstrumentTab)} is selected, with 32 playable steps and columns 33-40 dimmed.`,
    previewButtonText:
      options.musicPreviewState === 'playing'
        ? 'Pause'
        : options.musicPreviewState === 'paused'
          ? 'Resume'
          : 'Play',
    stopDisabled: options.musicPreviewState === 'stopped',
    gridSummaryText: '32 steps · 2 bars · 4 steps per beat · 120 BPM',
    toolHintText: 'Use Draw, Erase, and Copy on the room grid. Cmd/Ctrl+V pastes the current instrument clipboard.',
    legacyNoticeVisible: legacyStemVisible,
    legacyNoticeText: 'This room has saved WAMP stems. Playback is preserved, but sequencer editing is locked until you replace them with a new pattern.',
    replaceLegacyDisabled: false,
    instrumentTabs: instrumentTabs.map((instrumentId) => ({
      instrumentId,
      label: getPatternInstrumentLabel(instrumentId),
      active: instrumentId === activeInstrumentTab,
      disabled: false,
    })),
    pitchModes: [
      { mode: 'scale', label: 'Scale Lock', active: displayPattern.pitchMode === 'scale', disabled: legacyStemVisible },
      { mode: 'chromatic', label: 'Chromatic', active: displayPattern.pitchMode === 'chromatic', disabled: legacyStemVisible },
    ],
    octaveControlsVisible: activeOctaveShift !== null,
    octaveText: activeOctaveShift === null ? '' : `Octave ${activeOctaveShift >= 0 ? '+' : ''}${activeOctaveShift}`,
    octaveDownDisabled: legacyStemVisible || activeOctaveShift === null || activeOctaveShift <= -2,
    octaveUpDisabled: legacyStemVisible || activeOctaveShift === null || activeOctaveShift >= 2,
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
    musicPatternInstrumentTab,
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
      musicPatternInstrumentTab,
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

import type {
  CourseGoal,
  CourseGoalType,
  CourseSnapshot,
} from '../../courses/model';
import type { RoomGoal } from '../../goals/roomGoals';
import {
  roomIdFromCoordinates,
  type RoomCoordinates,
  type RoomSnapshot,
} from '../../persistence/roomModel';
import type {
  LeaderboardRankingMode,
  RoomLeaderboardEntry,
} from '../../runs/model';
import type {
  OverworldHudViewModel,
  OverworldOnlineRosterViewEntry,
} from './hud';
import type { ActiveCourseRunState } from './courseRuns';
import type { GoalRunState } from './goalRuns';
import type { ActiveSignState } from './signPosts';

export type SelectedCellState = 'published' | 'draft' | 'frontier' | 'empty';

export interface SelectedCourseContext {
  courseId: string;
  courseTitle: string | null;
  goalType: CourseGoalType | null;
  roomCount: number;
}

export interface SelectedRoomOwnershipViewData {
  claimerUserId: string | null;
  isMinted: boolean;
  mintedOwnerWalletAddress: string | null;
}

export interface SelectedCreatorProfileViewData {
  displayName: string;
  playerLevel: number;
  playerProgressFraction: number;
  curatorLevel: number;
  curatorProgressFraction: number;
  builderLevel: number;
  builderProgressFraction: number;
}

interface SelectedSummaryViewData {
  title: string | null;
  creatorUserId: string | null;
  creatorDisplayName: string | null;
}

export interface BuildOverworldHudViewModelOptions {
  selectedState: SelectedCellState;
  selectedCoordinates: RoomCoordinates;
  selectedSummary: SelectedSummaryViewData | null;
  selectedCreatorProfile: SelectedCreatorProfileViewData | null;
  selectedOwnership: SelectedRoomOwnershipViewData | null;
  selectedDraft: RoomSnapshot | null;
  selectedPublishedRoom: RoomSnapshot | null;
  selectedPublishedCourse: CourseSnapshot | null;
  selectedPopulation: number;
  selectedEditorCount: number;
  selectedEditorSummary: string | null;
  selectedCourse: SelectedCourseContext | null;
  selectedRoomInActiveCourseSession: boolean;
  frontierBuildBlocked: boolean;
  frontierClaimLimit: number | null;
  transientStatus: string | null;
  statusOverride?: string;
  mode: 'browse' | 'play';
  activeSignState: ActiveSignState | null;
  goalPersistentStatusText: string | null;
  rankingMode: LeaderboardRankingMode | null;
  roomTop: RoomLeaderboardEntry | null;
  activeCourseRun: ActiveCourseRunState | null;
  activeRoomGoalRun: GoalRunState | null;
  activeGoalRoom: RoomSnapshot | null;
  totalPlayerCount: number | null;
  onlineRosterEntries: OverworldOnlineRosterViewEntry[];
  currentUserId: string | null;
  currentWalletAddress: string | null;
  score: number;
  courseBuilderButtonDisabled: boolean;
  zoom: number;
  getRoomDisplayTitle: (title: string | null, coordinates: RoomCoordinates) => string;
  getCourseGoalBadgeText: (goal: CourseGoal | null) => string;
  getGoalBadgeText: (goal: RoomGoal) => string;
  getSelectedRoomGoalText: (room: RoomSnapshot) => string;
  getCourseGoalTimerText: (runState: ActiveCourseRunState) => string;
  getPlayGoalTimerText: (runState: GoalRunState) => string;
  getCourseGoalProgressText: (runState: ActiveCourseRunState) => string;
  getPlayGoalProgressText: (runState: GoalRunState) => string;
  truncateOverlayText: (text: string, maxChars: number) => string;
}

export function formatRoomEditorSummary(names: string[]): string | null {
  if (names.length === 0) {
    return null;
  }

  if (names.length === 1) {
    return `${names[0]} building`;
  }

  if (names.length === 2) {
    return `${names[0]} + ${names[1]} building`;
  }

  return `${names[0]} + ${names.length - 1} others building`;
}

export function buildOverworldHudViewModel(
  options: BuildOverworldHudViewModelOptions,
): OverworldHudViewModel {
  const {
    selectedState,
    selectedCoordinates,
    selectedSummary,
    selectedCreatorProfile,
    selectedOwnership,
    selectedDraft,
    selectedPublishedRoom,
    selectedPublishedCourse,
    selectedPopulation,
    selectedEditorCount,
    selectedEditorSummary,
    selectedCourse,
    frontierBuildBlocked,
    frontierClaimLimit,
    transientStatus,
    statusOverride,
    mode,
    activeSignState,
    goalPersistentStatusText,
    rankingMode,
    roomTop,
    activeCourseRun,
    activeRoomGoalRun,
    activeGoalRoom,
    totalPlayerCount,
    onlineRosterEntries,
    currentUserId,
    currentWalletAddress,
    score,
    courseBuilderButtonDisabled,
    zoom,
    getRoomDisplayTitle,
    getCourseGoalBadgeText,
    getGoalBadgeText,
    getSelectedRoomGoalText,
    getCourseGoalTimerText,
    getPlayGoalTimerText,
    getCourseGoalProgressText,
    getPlayGoalProgressText,
    truncateOverlayText,
  } = options;
  const activeRunResult = activeCourseRun?.result ?? activeRoomGoalRun?.result ?? null;
  const saveStatusTone =
    mode === 'play'
      ? activeCourseRun || activeRoomGoalRun
        ? activeRunResult === 'completed'
          ? 'challenge-complete'
          : activeRunResult === 'failed'
            ? 'challenge-failed'
            : 'challenge-active'
        : 'play-score'
      : 'default';
  const selectedRoomTitle =
    selectedState === 'published'
      ? selectedPublishedRoom?.title?.trim() || selectedSummary?.title?.trim() || null
      : selectedState === 'draft'
        ? selectedDraft?.title?.trim() || null
        : null;
  const selectedRoomTitleText = getRoomDisplayTitle(selectedRoomTitle, selectedCoordinates);
  const selectedPublishedCourseTitle = selectedPublishedCourse?.title?.trim() || null;
  const selectedCourseTitle = selectedPublishedCourseTitle || selectedCourse?.courseTitle?.trim() || null;
  const selectedCourseHasNamedRooms = Boolean(
    selectedCourseTitle &&
    selectedPublishedCourse &&
    selectedPublishedCourse.roomRefs.length > 0 &&
    selectedPublishedCourse.roomRefs.every((roomRef) => Boolean(roomRef.roomTitle?.trim()))
  );
  const selectedTitleText = selectedCourseTitle || selectedRoomTitleText;
  const selectedSubtitleText =
    selectedCourseHasNamedRooms &&
    selectedRoomTitle &&
    selectedRoomTitle !== selectedTitleText
      ? selectedRoomTitle
      : '';
  const selectedTitleSize =
    selectedTitleText.length > 24 ? 'tiny' : selectedTitleText.length > 16 ? 'compact' : 'normal';
  const selectedCreatorUserId =
    selectedState === 'published'
    && selectedSummary?.creatorUserId
    && selectedSummary.creatorDisplayName
      ? selectedSummary.creatorUserId
      : null;
  const selectedCreatorCardVisible =
    selectedState === 'published' && Boolean(selectedSummary?.creatorDisplayName?.trim());
  const selectedCreatorNameText =
    selectedCreatorProfile?.displayName?.trim()
    || selectedSummary?.creatorDisplayName?.trim()
    || '';
  const selectedCreatorFallbackText = roomIdFromCoordinates(selectedCoordinates);
  const selectedCreatorPlayerLevelText = selectedCreatorProfile
    ? String(selectedCreatorProfile.playerLevel)
    : '--';
  const selectedCreatorPlayerProgressFraction = selectedCreatorProfile
    ? Math.max(0, Math.min(1, selectedCreatorProfile.playerProgressFraction))
    : 0;
  const selectedCreatorCuratorLevelText = selectedCreatorProfile
    ? String(selectedCreatorProfile.curatorLevel)
    : '--';
  const selectedCreatorCuratorProgressFraction = selectedCreatorProfile
    ? Math.max(0, Math.min(1, selectedCreatorProfile.curatorProgressFraction))
    : 0;
  const selectedCreatorBuilderLevelText = selectedCreatorProfile
    ? String(selectedCreatorProfile.builderLevel)
    : '--';
  const selectedCreatorBuilderProgressFraction = selectedCreatorProfile
    ? Math.max(0, Math.min(1, selectedCreatorProfile.builderProgressFraction))
    : 0;
  const selectedRoomMinted = selectedState === 'published' && Boolean(selectedOwnership?.isMinted);
  const selectedTitleTone: OverworldHudViewModel['selectedTitleTone'] =
    selectedRoomMinted ? 'minted' : 'default';
  const selectedRoomClaimOwnerUserId =
    selectedOwnership?.claimerUserId
    ?? (selectedState === 'published' ? selectedSummary?.creatorUserId ?? null : null);
  const viewerOwnsSelectedRoom = Boolean(
    currentUserId &&
    selectedRoomClaimOwnerUserId &&
    currentUserId === selectedRoomClaimOwnerUserId,
  );
  const viewerOwnsMintedRoom = Boolean(
    selectedOwnership?.mintedOwnerWalletAddress &&
    currentWalletAddress &&
    currentWalletAddress === selectedOwnership.mintedOwnerWalletAddress.trim().toLowerCase(),
  );
  const canEditSelectedRoom =
    selectedState === 'draft'
      ? true
      : selectedState === 'published'
        ? selectedOwnership === null || !selectedRoomMinted || viewerOwnsMintedRoom
        : false;
  const editButtonTitle =
    selectedState !== 'published' && selectedState !== 'draft'
      ? 'Select a published or draft room to edit.'
      : selectedRoomMinted && !viewerOwnsMintedRoom
        ? 'Only the room token owner can edit a minted room.'
        : '';
  const canOpenCourseBuilder = selectedState === 'published' && viewerOwnsSelectedRoom;
  const resolvedCourseBuilderButtonDisabled =
    courseBuilderButtonDisabled || !canOpenCourseBuilder;
  const courseBuilderButtonTitle =
    courseBuilderButtonDisabled
      ? 'Loading course builder...'
      : selectedState !== 'published'
        ? 'Only published rooms can start a course.'
        : !viewerOwnsSelectedRoom
          ? 'Only the room claimer can build a course from this room.'
          : '';
  const selectedGoalText =
    selectedState === 'published' && selectedPublishedRoom?.goal
      ? getSelectedRoomGoalText(selectedPublishedRoom)
      : selectedState === 'draft' && selectedDraft?.goal
        ? getSelectedRoomGoalText(selectedDraft)
        : '';
  const selectedStateVisible = selectedState !== 'published' && !selectedRoomMinted;

  let selectedMetaText = '';
  let selectedMetaTone: OverworldHudViewModel['selectedMetaTone'] = 'default';
  if (selectedState === 'published') {
    const metaParts: string[] = [];
    if (selectedPopulation > 0) {
      metaParts.push(`${selectedPopulation} here`);
    }
    if (selectedEditorCount > 0) {
      metaParts.push(selectedEditorSummary ?? `${selectedEditorCount} building`);
    }
    selectedMetaText = metaParts.join(' · ');
  } else if (selectedState === 'draft' && selectedDraft) {
    const metaParts = ['Local draft only'];
    metaParts.push('publish to make it public');
    selectedMetaText = metaParts.join(' · ');
    selectedMetaTone = 'draft';
  } else if (selectedState === 'frontier') {
    if (frontierBuildBlocked) {
      selectedMetaText =
        frontierClaimLimit === null
          ? 'Daily new-room claim limit reached today'
          : `Daily new-room claim limit reached (${frontierClaimLimit}/${frontierClaimLimit})`;
      selectedMetaTone = 'default';
    } else {
      selectedMetaText =
        selectedEditorCount > 0
          ? `Building in progress · ${
            selectedEditorSummary
            ?? `${selectedEditorCount} ${selectedEditorCount === 1 ? 'builder' : 'builders'} here`
          }`
          : 'Build a room here';
      selectedMetaTone = 'frontier';
    }
  } else if (selectedState === 'empty') {
    if (selectedEditorCount > 0) {
      selectedMetaText = `Building in progress · ${
        selectedEditorSummary
        ?? `${selectedEditorCount} ${selectedEditorCount === 1 ? 'builder' : 'builders'} here`
      }`;
      selectedMetaTone = 'frontier';
    } else {
      selectedMetaText = 'You can only build next to an existing published room';
      selectedMetaTone = 'default';
    }
  }

  let statusText = '';
  if (statusOverride) {
    statusText = statusOverride;
  } else if (transientStatus) {
    statusText = transientStatus;
  } else if (mode === 'play') {
    statusText = goalPersistentStatusText ?? '';
  }

  let leaderboardText = '';
  if (!activeCourseRun && mode !== 'play' && roomTop && rankingMode) {
    const metric =
      rankingMode === 'time'
        ? `${(roomTop.elapsedMs / 1000).toFixed(2)}s`
        : `${roomTop.score} pts`;
    leaderboardText = `Best: ${roomTop.userDisplayName} · ${metric}`;
  }

  const saveStatusText =
    mode === 'play'
      ? `Score ${score}`
      : statusOverride ?? transientStatus ?? '';
  const goalPanelTone =
    activeRunResult === 'completed'
      ? 'complete'
      : activeRunResult === 'failed'
        ? 'failed'
        : 'active';

  return {
    saveStatusTone,
    jumpInputValue: roomIdFromCoordinates(selectedCoordinates),
    selectedTitleText,
    selectedSubtitleText,
    selectedTitleSize,
    selectedTitleTone,
    selectedCreatorCardVisible,
    selectedCreatorNameText,
    selectedCreatorFallbackText,
    selectedCreatorPlayerLevelText,
    selectedCreatorPlayerProgressFraction,
    selectedCreatorCuratorLevelText,
    selectedCreatorCuratorProgressFraction,
    selectedCreatorBuilderLevelText,
    selectedCreatorBuilderProgressFraction,
    selectedCreatorUserId,
    selectedStateVisible,
    selectedStateText:
      selectedRoomMinted
        ? 'Minted'
        : selectedState === 'published'
          ? 'Published'
        : selectedState === 'draft'
          ? 'Draft'
          : selectedState === 'frontier'
            ? 'Frontier'
            : 'Empty',
    selectedStateTone: selectedRoomMinted ? 'minted' : selectedState,
    selectedStateInfoVisible: selectedRoomMinted,
    selectedStateInfoText:
      selectedRoomMinted
        ? "Anyone can edit anyone else's room, but the one exception is that you can buy a room as a collectible. This locks the room from being edited."
        : '',
    selectedMetaText,
    selectedMetaTone,
    selectedGoalText,
    statusText,
    leaderboardText,
    zoomLabelText: `${zoom.toFixed(2)}x`,
    playButtonText: activeCourseRun ? 'Play Room' : mode === 'play' ? 'Stop' : 'Play Room',
    playButtonDisabled:
      activeCourseRun
        ? true
        : mode === 'play'
          ? false
          : selectedState !== 'published' && selectedState !== 'draft',
    playButtonActive: mode === 'play' && !activeCourseRun,
    restartButtonText: 'Restart',
    restartButtonDisabled: mode !== 'play',
    restartButtonActive: mode === 'play',
    restartButtonHidden: mode !== 'play',
    playCourseButtonText: activeCourseRun ? 'Stop Course' : 'Play Course',
    playCourseButtonDisabled: activeCourseRun ? false : !selectedCourse,
    playCourseButtonHidden: !selectedCourse && !activeCourseRun,
    playCourseButtonActive: Boolean(activeCourseRun),
    courseBuilderButtonDisabled: resolvedCourseBuilderButtonDisabled,
    courseBuilderButtonTitle,
    editButtonDisabled: !canEditSelectedRoom,
    editButtonTitle,
    buildButtonDisabled: selectedState !== 'frontier' || frontierBuildBlocked,
    roomCoordinatesText: '',
    cursorText: '',
    playersOnlineText:
      totalPlayerCount === null
        ? ''
        : `${totalPlayerCount} ${totalPlayerCount === 1 ? 'player' : 'players'} online`,
    playersOnlineSummaryText:
      totalPlayerCount === null
        ? ''
        : onlineRosterEntries.length === 0
          ? 'Live presence in loaded rooms.'
          : `${onlineRosterEntries.length} ${onlineRosterEntries.length === 1 ? 'player' : 'players'} visible right now`,
    playersOnlineEntries: onlineRosterEntries,
    saveStatusText,
    bottomBarZoomText: `Zoom: ${zoom.toFixed(2)}x`,
    goalPanelVisible: Boolean(activeCourseRun || activeRoomGoalRun),
    goalPanelTone,
    goalPanelRoomText: activeCourseRun
      ? truncateOverlayText((activeCourseRun.course.title?.trim() || 'COURSE').toUpperCase(), 22)
      : activeRoomGoalRun
        ? truncateOverlayText(
            getRoomDisplayTitle(activeGoalRoom?.title ?? null, activeRoomGoalRun.roomCoordinates).toUpperCase(),
            22,
          )
        : '',
    goalPanelGoalText: activeCourseRun
      ? getCourseGoalBadgeText(activeCourseRun.course.goal ?? null).toUpperCase()
      : activeRoomGoalRun
        ? getGoalBadgeText(activeRoomGoalRun.goal).toUpperCase()
        : '',
    goalPanelTimerText: activeCourseRun
      ? getCourseGoalTimerText(activeCourseRun)
      : activeRoomGoalRun
        ? getPlayGoalTimerText(activeRoomGoalRun)
        : '',
    goalPanelProgressText: activeCourseRun
      ? getCourseGoalProgressText(activeCourseRun)
      : activeRoomGoalRun
        ? getPlayGoalProgressText(activeRoomGoalRun)
        : '',
    signPanelVisible: mode === 'play' && Boolean(activeSignState?.text),
    signPanelLabelText: '',
    signPanelText: activeSignState?.text ?? '',
  };
}

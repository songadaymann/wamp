import type {
  CourseGoal,
  CourseGoalType,
} from '../../courses/model';
import type {
  RoomGoal,
  RoomGoalType,
} from '../../goals/roomGoals';
import { ROOM_GOAL_LABELS } from '../../goals/roomGoals';
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

interface SelectedSummaryViewData {
  title: string | null;
  creatorUserId: string | null;
  creatorDisplayName: string | null;
  goalType: RoomGoalType | null;
}

export interface BuildOverworldHudViewModelOptions {
  selectedState: SelectedCellState;
  selectedCoordinates: RoomCoordinates;
  selectedSummary: SelectedSummaryViewData | null;
  selectedOwnership: SelectedRoomOwnershipViewData | null;
  selectedDraft: RoomSnapshot | null;
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
  getCourseGoalSummaryText: (goalType: CourseGoalType | null) => string;
  getCourseGoalBadgeText: (goal: CourseGoal | null) => string;
  getGoalBadgeText: (goal: RoomGoal) => string;
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
    selectedOwnership,
    selectedDraft,
    selectedPopulation,
    selectedEditorCount,
    selectedEditorSummary,
    selectedCourse,
    frontierBuildBlocked,
    frontierClaimLimit,
    transientStatus,
    statusOverride,
    mode,
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
    getCourseGoalSummaryText,
    getCourseGoalBadgeText,
    getGoalBadgeText,
    getCourseGoalTimerText,
    getPlayGoalTimerText,
    getCourseGoalProgressText,
    getPlayGoalProgressText,
    truncateOverlayText,
  } = options;
  const activeRunResult = activeCourseRun?.result ?? activeRoomGoalRun?.result ?? null;
  const suppressRoomGoalMeta = Boolean(activeCourseRun);
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
  const selectedTitleText = getRoomDisplayTitle(
    selectedState === 'published'
      ? selectedSummary?.title ?? null
      : selectedState === 'draft'
        ? selectedDraft?.title ?? null
        : null,
    selectedCoordinates,
  );
  const selectedCreatorUserId =
    selectedState === 'published'
    && selectedSummary?.creatorUserId
    && selectedSummary.creatorDisplayName
      ? selectedSummary.creatorUserId
      : null;
  const selectedCreatorText = selectedCreatorUserId && selectedSummary?.creatorDisplayName
    ? `by ${selectedSummary.creatorDisplayName}`
    : roomIdFromCoordinates(selectedCoordinates);
  const selectedRoomMinted = selectedState === 'published' && Boolean(selectedOwnership?.isMinted);
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

  let selectedMetaText = 'No room here yet';
  let selectedMetaTone: OverworldHudViewModel['selectedMetaTone'] = 'default';
  if (selectedState === 'published') {
    const metaParts: string[] = [];
    if (selectedCourse) {
      metaParts.push(
        selectedCourse.courseTitle?.trim()
          ? `Part of course: ${selectedCourse.courseTitle}`
          : `Part of course · ${selectedCourse.roomCount} rooms`,
      );
      metaParts.push(getCourseGoalSummaryText(selectedCourse.goalType));
      selectedMetaTone = 'challenge';
    }
    if (!suppressRoomGoalMeta && selectedSummary?.goalType) {
      metaParts.push(`${ROOM_GOAL_LABELS[selectedSummary.goalType]} challenge`);
      selectedMetaTone = 'challenge';
    }
    if (metaParts.length === 0) {
      metaParts.push('No challenge');
    }
    if (selectedPopulation > 0) {
      metaParts.push(`${selectedPopulation} here`);
    }
    if (selectedEditorCount > 0) {
      metaParts.push(selectedEditorSummary ?? `${selectedEditorCount} building`);
    }
    selectedMetaText = metaParts.join(' · ');
  } else if (selectedState === 'draft' && selectedDraft) {
    const metaParts = ['Local draft only'];
    if (selectedCourse) {
      metaParts.push(
        selectedCourse.courseTitle?.trim()
          ? `Part of course: ${selectedCourse.courseTitle}`
          : `Part of course · ${selectedCourse.roomCount} rooms`,
      );
      metaParts.push(getCourseGoalSummaryText(selectedCourse.goalType));
    }
    if (!suppressRoomGoalMeta && selectedDraft.goal) {
      metaParts.push(`${ROOM_GOAL_LABELS[selectedDraft.goal.type]} challenge`);
    }
    metaParts.push('publish to make it public');
    selectedMetaText = metaParts.join(' · ');
    selectedMetaTone = selectedCourse ? 'challenge' : 'draft';
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
    selectedCreatorText,
    selectedCreatorUserId,
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
        ? 'Minted rooms are onchain room NFTs. Only the token owner can edit the live room or publish updates.'
        : '',
    selectedMetaText,
    selectedMetaTone,
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
  };
}

import { getAuthDebugState } from '../../auth/client';
import { isRoomInActiveCourseDraftSession } from '../../courses/draftSession';
import { COURSE_GOAL_LABELS, type CourseGoal, type CourseGoalType } from '../../courses/model';
import {
  getCourseGoalBadgeText as formatCourseGoalBadgeText,
  getCourseGoalProgressText as formatCourseGoalProgressText,
  getCourseGoalTimerText as formatCourseGoalTimerText,
  type ActiveCourseRunState,
} from './courseRuns';
import { ROOM_GOAL_LABELS, type RoomGoal } from '../../goals/roomGoals';
import { roomIdFromCoordinates, type RoomCoordinates, type RoomSnapshot } from '../../persistence/roomModel';
import { type WorldRoomSummary } from '../../persistence/worldModel';
import type { RoomLeaderboardResponse } from '../../runs/model';
import type { OverworldMode } from '../sceneData';
import type {
  OverworldHudViewModel,
  OverworldOnlineRosterViewEntry,
} from './hud';
import {
  buildOverworldHudViewModel,
  formatRoomEditorSummary,
  type SelectedCellState,
  type SelectedCourseContext,
  type SelectedRoomOwnershipViewData,
} from './hudViewModel';
import type { GoalRunState } from './goalRuns';

export interface SelectedRoomContext {
  roomId: string;
  coordinates: RoomCoordinates;
  state: SelectedCellState;
  courseId: string | null;
  courseTitle: string | null;
  courseGoalType: CourseGoalType | null;
  courseRoomCount: number | null;
}

interface OverworldHudStateControllerHost {
  getMode(): OverworldMode;
  getSelectedCoordinates(): RoomCoordinates;
  getCellStateAt(coordinates: RoomCoordinates): SelectedCellState;
  getRoomSummary(roomId: string): WorldRoomSummary | undefined;
  getDraftRoom(roomId: string): RoomSnapshot | null;
  getRoomPopulation(coordinates: RoomCoordinates): number;
  getRoomEditorCount(coordinates: RoomCoordinates): number;
  getRoomEditorDisplayNames(coordinates: RoomCoordinates): string[];
  getActiveCourseRun(): ActiveCourseRunState | null;
  getCurrentGoalRun(): GoalRunState | null;
  getRoomSnapshotForCoordinates(coordinates: RoomCoordinates): RoomSnapshot | null;
  getCurrentRoomLeaderboard(): RoomLeaderboardResponse | null;
  getGoalPersistentStatusText(): string | null;
  getTotalPlayerCount(): number | null;
  getOnlineRosterEntries(): OverworldOnlineRosterViewEntry[];
  loadRoomOwnershipDetails(
    roomId: string,
    coordinates: RoomCoordinates,
  ): Promise<SelectedRoomOwnershipViewData>;
  getScore(): number;
  isCourseComposerLoading(): boolean;
  getZoom(): number;
  getTransientStatusMessage(): string | null;
  renderHudViewModel(viewModel: OverworldHudViewModel): void;
  syncOverlayScale(): void;
}

export class OverworldHudStateController {
  private selectedSummary: WorldRoomSummary | null = null;
  private readonly selectedOwnershipByRoomId = new Map<string, SelectedRoomOwnershipViewData>();
  private readonly loadingOwnershipRoomIds = new Set<string>();

  constructor(private readonly host: OverworldHudStateControllerHost) {}

  reset(): void {
    this.selectedSummary = null;
    this.selectedOwnershipByRoomId.clear();
    this.loadingOwnershipRoomIds.clear();
  }

  refreshSelectedSummary(): void {
    const selectedCoordinates = this.host.getSelectedCoordinates();
    this.selectedSummary =
      this.host.getRoomSummary(roomIdFromCoordinates(selectedCoordinates)) ?? null;
  }

  getSelectedSummary(): WorldRoomSummary | null {
    return this.selectedSummary;
  }

  getSelectedCourseContext(): SelectedCourseContext | null {
    const publishedCourse = this.selectedSummary?.course ?? null;
    if (!publishedCourse) {
      return null;
    }

    return {
      courseId: publishedCourse.courseId,
      courseTitle: publishedCourse.courseTitle,
      goalType: publishedCourse.goalType,
      roomCount: publishedCourse.roomCount,
    };
  }

  getSelectedRoomContext(): SelectedRoomContext {
    const selectedCoordinates = this.host.getSelectedCoordinates();
    const selectedCourse = this.getSelectedCourseContext();
    return {
      roomId: roomIdFromCoordinates(selectedCoordinates),
      coordinates: { ...selectedCoordinates },
      state: this.host.getCellStateAt(selectedCoordinates),
      courseId: selectedCourse?.courseId ?? null,
      courseTitle: selectedCourse?.courseTitle ?? null,
      courseGoalType: selectedCourse?.goalType ?? null,
      courseRoomCount: selectedCourse?.roomCount ?? null,
    };
  }

  renderHud(statusOverride?: string): void {
    const selectedCoordinates = this.host.getSelectedCoordinates();
    const selectedRoomId = roomIdFromCoordinates(selectedCoordinates);
    const selectedState = this.host.getCellStateAt(selectedCoordinates);
    this.ensureSelectedOwnershipLoaded(selectedRoomId, selectedCoordinates, selectedState);
    const selectedDraft = this.host.getDraftRoom(selectedRoomId);
    const selectedCourse = this.getSelectedCourseContext();
    const mode = this.host.getMode();
    const activeCourseRun = mode === 'play' ? this.host.getActiveCourseRun() : null;
    const activeRoomGoalRun =
      activeCourseRun ? null : mode === 'play' ? this.host.getCurrentGoalRun() : null;
    const activeGoalRoom = activeRoomGoalRun
      ? this.host.getRoomSnapshotForCoordinates(activeRoomGoalRun.roomCoordinates)
      : null;
    const authState = getAuthDebugState();
    const currentUserId = authState.user?.id ?? null;
    const currentWalletAddress = authState.user?.walletAddress?.trim().toLowerCase() ?? null;

    this.host.renderHudViewModel(
      buildOverworldHudViewModel({
        selectedState,
        selectedCoordinates,
        selectedSummary: this.selectedSummary
          ? {
              title: this.selectedSummary.title ?? null,
              creatorUserId: this.selectedSummary.creatorUserId ?? null,
              creatorDisplayName: this.selectedSummary.creatorDisplayName ?? null,
              goalType: this.selectedSummary.goalType ?? null,
            }
          : null,
        selectedOwnership: this.selectedOwnershipByRoomId.get(selectedRoomId) ?? null,
        selectedDraft,
        selectedPopulation: this.host.getRoomPopulation(selectedCoordinates),
        selectedEditorCount: this.host.getRoomEditorCount(selectedCoordinates),
        selectedEditorSummary: formatRoomEditorSummary(
          this.host.getRoomEditorDisplayNames(selectedCoordinates),
        ),
        selectedCourse,
        selectedRoomInActiveCourseSession: isRoomInActiveCourseDraftSession(selectedRoomId),
        frontierBuildBlocked: this.isFrontierBuildBlockedByClaimLimit(authState),
        frontierClaimLimit: authState.roomDailyClaimLimit,
        transientStatus: this.host.getTransientStatusMessage(),
        statusOverride,
        mode,
        goalPersistentStatusText: this.host.getGoalPersistentStatusText(),
        rankingMode: this.host.getCurrentRoomLeaderboard()?.rankingMode ?? null,
        roomTop: this.host.getCurrentRoomLeaderboard()?.entries[0] ?? null,
        activeCourseRun,
        activeRoomGoalRun,
        activeGoalRoom,
        totalPlayerCount: this.host.getTotalPlayerCount(),
        onlineRosterEntries: this.host.getOnlineRosterEntries(),
        currentUserId,
        currentWalletAddress,
        score: this.host.getScore(),
        courseBuilderButtonDisabled: this.host.isCourseComposerLoading(),
        zoom: this.host.getZoom(),
        getRoomDisplayTitle: (title, coordinates) => this.getRoomDisplayTitle(title, coordinates),
        getCourseGoalSummaryText: (goalType) => this.getCourseGoalSummaryText(goalType),
        getCourseGoalBadgeText: (goal) => this.getCourseGoalBadgeText(goal),
        getGoalBadgeText: (goal) => this.getGoalBadgeText(goal),
        getCourseGoalTimerText: (runState) => this.getCourseGoalTimerText(runState),
        getPlayGoalTimerText: (runState) => this.getPlayGoalTimerText(runState),
        getCourseGoalProgressText: (runState) => this.getCourseGoalProgressText(runState),
        getPlayGoalProgressText: (runState) => this.getPlayGoalProgressText(runState),
        truncateOverlayText: (text, maxChars) => this.truncateOverlayText(text, maxChars),
      }),
    );
    this.host.syncOverlayScale();
  }

  private ensureSelectedOwnershipLoaded(
    roomId: string,
    coordinates: RoomCoordinates,
    selectedState: SelectedCellState,
  ): void {
    if (selectedState !== 'published' && selectedState !== 'draft') {
      return;
    }

    if (this.selectedOwnershipByRoomId.has(roomId) || this.loadingOwnershipRoomIds.has(roomId)) {
      return;
    }

    this.loadingOwnershipRoomIds.add(roomId);
    void this.host
      .loadRoomOwnershipDetails(roomId, coordinates)
      .then((details) => {
        this.loadingOwnershipRoomIds.delete(roomId);
        this.selectedOwnershipByRoomId.set(roomId, details);

        if (roomId === roomIdFromCoordinates(this.host.getSelectedCoordinates())) {
          this.renderHud();
        }
      })
      .catch((error) => {
        this.loadingOwnershipRoomIds.delete(roomId);
        console.warn('Failed to load selected room ownership details', error);
      });
  }

  private isFrontierBuildBlockedByClaimLimit(authState: ReturnType<typeof getAuthDebugState>): boolean {
    return (
      authState.authenticated &&
      authState.roomClaimsRemainingToday !== null &&
      authState.roomClaimsRemainingToday <= 0
    );
  }

  private getRoomDisplayTitle(title: string | null, coordinates: RoomCoordinates): string {
    return title?.trim() ? title : `Room ${coordinates.x},${coordinates.y}`;
  }

  private getCourseGoalSummaryText(goalType: CourseGoalType | null): string {
    return goalType ? `${COURSE_GOAL_LABELS[goalType]} course` : 'Course objective missing';
  }

  private getGoalBadgeText(goal: RoomGoal): string {
    switch (goal.type) {
      case 'reach_exit':
        return 'Reach Exit';
      case 'collect_target':
        return `Collect ${goal.requiredCount}`;
      case 'defeat_all':
        return 'Defeat All';
      case 'checkpoint_sprint':
        return `${goal.checkpoints.length || 0} Checkpoints`;
      case 'survival':
        return `Survive ${Math.max(1, Math.round(goal.durationMs / 1000))}s`;
    }
  }

  private getCourseGoalBadgeText(goal: CourseGoal | null): string {
    return formatCourseGoalBadgeText(goal);
  }

  private getPlayGoalTimerText(runState: GoalRunState): string {
    if (runState.qualificationState === 'practice') {
      return 'PRACTICE';
    }

    if (runState.goal.type === 'survival') {
      return `${this.formatOverlayTimer(Math.max(0, runState.goal.durationMs - runState.elapsedMs))} LEFT`;
    }

    if (runState.goal.timeLimitMs !== null) {
      return `${this.formatOverlayTimer(Math.max(0, runState.goal.timeLimitMs - runState.elapsedMs))} LEFT`;
    }

    return this.formatOverlayTimer(runState.elapsedMs);
  }

  private getCourseGoalTimerText(runState: ActiveCourseRunState): string {
    return formatCourseGoalTimerText(runState, (ms) => this.formatOverlayTimer(ms));
  }

  private getPlayGoalProgressText(runState: GoalRunState): string {
    if (runState.qualificationState === 'practice') {
      return runState.leaderboardEligible ? 'Reach spawn to rank' : 'Reach spawn to start';
    }

    switch (runState.goal.type) {
      case 'reach_exit':
        return runState.result === 'completed' ? 'Exit reached' : 'Reach the exit';
      case 'collect_target':
        return `${runState.collectiblesCollected}/${runState.goal.requiredCount} collected`;
      case 'defeat_all':
        return `${runState.enemiesDefeated}/${runState.enemyTarget ?? 0} defeated`;
      case 'checkpoint_sprint':
        return `${runState.checkpointsReached}/${runState.checkpointTarget ?? 0} checkpoints`;
      case 'survival':
        return runState.result === 'completed' ? 'Survived' : 'Stay alive';
    }
  }

  private getCourseGoalProgressText(runState: ActiveCourseRunState): string {
    return formatCourseGoalProgressText(runState);
  }

  private formatOverlayTimer(ms: number): string {
    const clampedMs = Math.max(0, Math.round(ms));
    const totalSeconds = Math.floor(clampedMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const tenths = Math.floor((clampedMs % 1000) / 100);
    return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`;
  }

  private truncateOverlayText(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value;
    }

    return `${value.slice(0, Math.max(1, maxLength - 1))}\u2026`;
  }
}

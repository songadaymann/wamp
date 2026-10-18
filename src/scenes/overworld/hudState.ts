import { toCourseGoalType } from '../../courses/model';
import { getAuthDebugState } from '../../auth/client';
import { isRoomInActiveCourseDraftSession } from '../../courses/draftSession';
import {
  type CourseGoal,
  type CourseGoalType,
  type CourseSnapshot,
} from '../../courses/model';
import {
  getExpandedRoomGoalBadgeText as formatCourseGoalBadgeText,
  getExpandedRoomGoalProgressText as formatCourseGoalProgressText,
  getExpandedRoomGoalTimerText as formatCourseGoalTimerText,
  type ActiveExpandedRoomRunState,
} from './expandedRoomRuns';
import { ROOM_GOAL_DEFINITIONS, type RoomGoal } from '../../goals/roomGoals';
import { formatGoalBadgeText, formatGoalSelectedText, formatRoomGoalProgressText, formatGoalTimerText } from '../../goals/goalSchema';
import { formatGoalOverlayTimer } from '../../goals/goalPresentation';
import {
  roomIdFromCoordinates,
  type RoomCoordinates,
  type RoomSnapshot,
  type RoomSnapshotView,
} from '../../persistence/roomModel';
import { type WorldRoomSummary } from '../../persistence/worldModel';
import { canBuildInActiveWorld, getActiveWorldId } from '../../worlds/clientContext';
import type { RoomLeaderboardResponse } from '../../runs/model';
import type { OverworldMode } from '../sceneData';
import type {
  OverworldHudViewModel,
  OverworldOnlineRosterViewEntry,
} from './hud';
import type { ActiveSignState } from './signPosts';
import {
  buildOverworldHudViewModel,
  formatRoomEditorSummary,
  type SelectedCellState,
  type SelectedCreatorProfileViewData,
  type SelectedCourseContext,
  type SelectedRoomOwnershipViewData,
} from './hudViewModel';
import type { GoalRunState } from './goalRuns';
import {
  getRoomRushGoalBadgeText as formatRoomRushGoalBadgeText,
  getRoomRushProgressText as formatRoomRushProgressText,
  type ActiveRoomRushRunState,
} from './roomRushRuns';

export interface SelectedRoomContext {
  roomId: string;
  publishedVersion?: number | null;
  expandedRoomId?: string | null;
  expandedRoomVersion?: number | null;
  coordinates: RoomCoordinates;
  shareTitle?: string | null;
  state: SelectedCellState;
  courseId: string | null;
  courseTitle: string | null;
  courseGoalType: CourseGoalType | null;
  courseRoomCount: number | null;
}

interface OverworldHudStateControllerHost {
  isEditorPlaytest?: () => boolean;
  getMode(): OverworldMode;
  getSelectedCoordinates(): RoomCoordinates;
  getCellStateAt(coordinates: RoomCoordinates): SelectedCellState;
  getRoomSummary(roomId: string): WorldRoomSummary | undefined;
  getDraftRoom(roomId: string): RoomSnapshot | null;
  getRoomPopulation(coordinates: RoomCoordinates): number;
  getRoomEditorCount(coordinates: RoomCoordinates): number;
  getRoomEditorDisplayNames(coordinates: RoomCoordinates): string[];
  getActiveCourseRun(): ActiveExpandedRoomRunState | null;
  getActiveRoomRushRun(): ActiveRoomRushRunState | null;
  getCurrentGoalRun(): GoalRunState | null;
  getRoomSnapshotForCoordinates(coordinates: RoomCoordinates): RoomSnapshotView | null;
  getCurrentRoomLeaderboard(): RoomLeaderboardResponse | null;
  getGoalPersistentStatusText(): string | null;
  getTotalPlayerCount(): number | null;
  getOnlineRosterEntries(): OverworldOnlineRosterViewEntry[];
  getActiveSignState(): ActiveSignState | null;
  loadRoomOwnershipDetails(
    roomId: string,
    coordinates: RoomCoordinates,
  ): Promise<SelectedRoomOwnershipViewData>;
  loadPublicProfileSummary(userId: string): Promise<SelectedCreatorProfileViewData | null>;
  loadPublishedCourseSnapshot(courseId: string): Promise<CourseSnapshot | null>;
  countRoomEnemies(room: RoomSnapshot): number;
  getScore(): number;
  areRoomCommentsVisible(): boolean;
  getZoom(): number;
  getTransientStatusMessage(): string | null;
  renderHudViewModel(viewModel: OverworldHudViewModel): void;
  syncOverlayScale(): void;
}

export class OverworldHudStateController {
  private selectedSummary: WorldRoomSummary | null = null;
  private readonly selectedOwnershipByRoomId = new Map<string, SelectedRoomOwnershipViewData>();
  private readonly selectedCreatorProfileByUserId = new Map<string, SelectedCreatorProfileViewData | null>();
  private readonly selectedPublishedCourseById = new Map<string, CourseSnapshot>();
  private readonly loadingOwnershipRoomIds = new Set<string>();
  private readonly loadingCreatorProfileUserIds = new Set<string>();
  private readonly loadingCourseIds = new Set<string>();

  constructor(private readonly host: OverworldHudStateControllerHost) {}

  reset(): void {
    this.selectedSummary = null;
    this.selectedOwnershipByRoomId.clear();
    this.selectedCreatorProfileByUserId.clear();
    this.selectedPublishedCourseById.clear();
    this.loadingOwnershipRoomIds.clear();
    this.loadingCreatorProfileUserIds.clear();
    this.loadingCourseIds.clear();
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
    const expandedRoom = this.selectedSummary?.expandedRoom ?? null;
    if (expandedRoom) {
      if (!expandedRoom.legacyCourseId) {
        return null;
      }

      return {
        courseId: expandedRoom.legacyCourseId,
        courseTitle: expandedRoom.title,
        goalType:
          toCourseGoalType(expandedRoom.goalType),
        roomCount: expandedRoom.cellCount,
      };
    }

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
    const selectedRoomId = roomIdFromCoordinates(selectedCoordinates);
    const selectedCourse = this.getSelectedCourseContext();
    const activeCourse = this.host.getMode() === 'play' ? this.host.getActiveCourseRun()?.course : null;
    const playingTitle = activeCourse?.roomRefs.some(ref => ref.roomId === selectedRoomId) ? activeCourse.title : null;
    const playingRun = activeCourse?.roomRefs.some(ref => ref.roomId === selectedRoomId)
      ? this.host.getActiveCourseRun() : null;
    const expandedRoom = this.selectedSummary?.expandedRoom;
    return {
      roomId: selectedRoomId,
      publishedVersion: this.host.getRoomSnapshotForCoordinates(selectedCoordinates)?.version ?? null,
      expandedRoomId: playingRun?.expandedRoomId ?? expandedRoom?.expandedRoomId ?? null,
      expandedRoomVersion: playingRun?.expandedRoomVersion ?? playingRun?.course.version ?? null,
      coordinates: { ...selectedCoordinates },
      shareTitle: playingTitle ?? this.selectedSummary?.expandedRoom?.title ?? selectedCourse?.courseTitle
        ?? this.host.getRoomSnapshotForCoordinates(selectedCoordinates)?.title ?? this.selectedSummary?.title ?? null,
      state: this.host.getCellStateAt(selectedCoordinates),
      courseId: playingRun?.course.id ?? selectedCourse?.courseId ?? null,
      courseTitle: playingTitle ?? expandedRoom?.title ?? selectedCourse?.courseTitle ?? null,
      courseGoalType: playingRun ? playingRun.course.goal?.type ?? null
        : expandedRoom ? toCourseGoalType(expandedRoom.goalType) : selectedCourse?.goalType ?? null,
      courseRoomCount: playingRun?.course.roomRefs.length ?? expandedRoom?.cellCount ?? selectedCourse?.roomCount ?? null,
    };
  }

  renderHud(statusOverride?: string): void {
    const selectedCoordinates = this.host.getSelectedCoordinates();
    const selectedRoomId = roomIdFromCoordinates(selectedCoordinates);
    const selectedState = this.host.getCellStateAt(selectedCoordinates);
    this.ensureSelectedOwnershipLoaded(selectedRoomId, selectedCoordinates, selectedState);
    const selectedDraft = this.host.getDraftRoom(selectedRoomId);
    const selectedCourse = this.getSelectedCourseContext();
    const selectedCreatorUserId =
      selectedState === 'published' && this.selectedSummary?.creatorUserId
        ? this.selectedSummary.creatorUserId
        : null;
    if (selectedCreatorUserId) {
      this.ensureSelectedCreatorProfileLoaded(selectedCreatorUserId);
    }
    if (selectedCourse) {
      this.ensureSelectedCourseLoaded(selectedCourse.courseId);
    }
    const selectedPublishedRoom =
      selectedState === 'published'
        ? this.host.getRoomSnapshotForCoordinates(selectedCoordinates)
        : null;
    const selectedPublishedCourse =
      selectedCourse ? this.selectedPublishedCourseById.get(selectedCourse.courseId) ?? null : null;
    const mode = this.host.getMode();
    const activeCourseRun = mode === 'play' ? this.host.getActiveCourseRun() : null;
    const activeRoomRushRun = activeCourseRun ? null : mode === 'play' ? this.host.getActiveRoomRushRun() : null;
    const activeRoomGoalRun =
      activeCourseRun || activeRoomRushRun ? null : mode === 'play' ? this.host.getCurrentGoalRun() : null;
    const activeGoalRoom = activeRoomGoalRun
      ? this.host.getRoomSnapshotForCoordinates(activeRoomGoalRun.roomCoordinates)
      : null;
    const authState = getAuthDebugState();
    const currentUserId = authState.user?.id ?? null;
    const currentWalletAddress = authState.user?.walletAddress?.trim().toLowerCase() ?? null;

    this.host.renderHudViewModel(
      buildOverworldHudViewModel({
        editorPlaytest: this.host.isEditorPlaytest?.(),
        selectedState,
        selectedCoordinates,
        selectedSummary: this.selectedSummary
          ? {
              title: this.selectedSummary.title ?? null,
              creatorUserId: this.selectedSummary.creatorUserId ?? null,
              creatorDisplayName: this.selectedSummary.creatorDisplayName ?? null,
              world: this.selectedSummary.world,
            }
          : null,
        selectedCreatorProfile: selectedCreatorUserId
          ? this.selectedCreatorProfileByUserId.get(selectedCreatorUserId) ?? null
          : null,
        selectedOwnership: this.selectedOwnershipByRoomId.get(selectedRoomId) ?? null,
        selectedDraft,
        selectedPublishedRoom: selectedPublishedRoom as RoomSnapshot | null,
        selectedPublishedCourse,
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
        activeSignState: this.host.getActiveSignState(),
        goalPersistentStatusText: this.host.getGoalPersistentStatusText(),
        rankingMode: this.host.getCurrentRoomLeaderboard()?.rankingMode ?? null,
        roomTop: this.host.getCurrentRoomLeaderboard()?.entries[0] ?? null,
        currentRoomLeaderboard: this.host.getCurrentRoomLeaderboard(),
        activeCourseRun,
        activeRoomRushRun,
        activeRoomGoalRun,
        activeGoalRoom: activeGoalRoom as RoomSnapshot | null,
        totalPlayerCount: this.host.getTotalPlayerCount(),
        onlineRosterEntries: this.host.getOnlineRosterEntries(),
        currentUserId,
        currentWalletAddress,
        score: this.host.getScore(),
        courseBuilderButtonDisabled: Boolean(this.selectedSummary?.world),
        roomCommentsVisible: this.host.areRoomCommentsVisible(),
        zoom: this.host.getZoom(),
        getRoomDisplayTitle: (title, coordinates) => this.getRoomDisplayTitle(title, coordinates),
        getExpandedRoomGoalBadgeText: (goal) => this.getExpandedRoomGoalBadgeText(goal),
        getGoalBadgeText: (goal) => this.getGoalBadgeText(goal),
        getSelectedRoomGoalText: (room) => this.getSelectedRoomGoalText(room),
        getExpandedRoomGoalTimerText: (runState) => this.getExpandedRoomGoalTimerText(runState),
        getPlayGoalTimerText: (runState) => this.getPlayGoalTimerText(runState),
        getExpandedRoomGoalProgressText: (runState) => this.getExpandedRoomGoalProgressText(runState),
        getPlayGoalProgressText: (runState) => this.getPlayGoalProgressText(runState),
        getRoomRushGoalBadgeText: (runState) => this.getRoomRushGoalBadgeText(runState),
        getRoomRushTimerText: (runState) => this.getRoomRushTimerText(runState),
        getRoomRushProgressText: (runState) => this.getRoomRushProgressText(runState),
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
    if (
      selectedState !== 'published'
      && selectedState !== 'draft'
      && selectedState !== 'claimed_unpublished'
    ) {
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

  private ensureSelectedCreatorProfileLoaded(userId: string): void {
    if (
      this.selectedCreatorProfileByUserId.has(userId)
      || this.loadingCreatorProfileUserIds.has(userId)
    ) {
      return;
    }

    this.loadingCreatorProfileUserIds.add(userId);
    void this.host
      .loadPublicProfileSummary(userId)
      .then((profile) => {
        this.loadingCreatorProfileUserIds.delete(userId);
        this.selectedCreatorProfileByUserId.set(userId, profile);

        if (userId === this.getSelectedCreatorUserId()) {
          this.renderHud();
        }
      })
      .catch((error) => {
        this.loadingCreatorProfileUserIds.delete(userId);
        console.warn('Failed to load selected creator profile summary', error);
      });
  }

  private ensureSelectedCourseLoaded(courseId: string): void {
    if (this.selectedPublishedCourseById.has(courseId) || this.loadingCourseIds.has(courseId)) {
      return;
    }

    this.loadingCourseIds.add(courseId);
    void this.host
      .loadPublishedCourseSnapshot(courseId)
      .then((snapshot) => {
        this.loadingCourseIds.delete(courseId);
        if (snapshot) {
          this.selectedPublishedCourseById.set(courseId, snapshot);
        }

        if (courseId === this.getSelectedCourseContext()?.courseId) {
          this.renderHud();
        }
      })
      .catch((error) => {
        this.loadingCourseIds.delete(courseId);
        console.warn('Failed to load selected expanded room snapshot', error);
      });
  }

  private getSelectedCreatorUserId(): string | null {
    const selectedCoordinates = this.host.getSelectedCoordinates();
    if (this.host.getCellStateAt(selectedCoordinates) !== 'published') {
      return null;
    }

    return this.selectedSummary?.creatorUserId ?? null;
  }

  private isFrontierBuildBlockedByClaimLimit(authState: ReturnType<typeof getAuthDebugState>): boolean {
    const activeWorldId = getActiveWorldId();
    if (activeWorldId && canBuildInActiveWorld(activeWorldId)) return false;
    return (
      authState.authenticated &&
      authState.roomClaimsRemainingToday !== null &&
      authState.roomClaimsRemainingToday <= 0
    );
  }

  private getRoomDisplayTitle(title: string | null, coordinates: RoomCoordinates): string {
    return title?.trim() ? title : `Room ${coordinates.x},${coordinates.y}`;
  }

  private getGoalBadgeText(goal: RoomGoal): string {
    return formatGoalBadgeText(goal, ROOM_GOAL_DEFINITIONS);
  }

  private getSelectedRoomGoalText(room: RoomSnapshot): string {
    const goal = room.goal;
    if (!goal) return '';
    const enemyCount = ROOM_GOAL_DEFINITIONS[goal.type].presentation.selectedNeedsEnemyCount
      ? this.host.countRoomEnemies(room) : 0;
    return formatGoalSelectedText(goal, ROOM_GOAL_DEFINITIONS, enemyCount);
  }

  private getExpandedRoomGoalBadgeText(goal: CourseGoal | null): string {
    return formatCourseGoalBadgeText(goal);
  }

  private getPlayGoalTimerText(runState: GoalRunState): string {
    if (runState.qualificationState === 'practice') return 'PRACTICE';
    return formatGoalTimerText(runState.goal, ROOM_GOAL_DEFINITIONS, runState.elapsedMs, formatGoalOverlayTimer);
  }

  private getExpandedRoomGoalTimerText(runState: ActiveExpandedRoomRunState): string {
    return formatCourseGoalTimerText(runState, formatGoalOverlayTimer);
  }

  private getPlayGoalProgressText(runState: GoalRunState): string {
    if (runState.qualificationState === 'practice') {
      return runState.leaderboardEligible ? 'Reach spawn to rank' : 'Reach spawn to start';
    }
    return formatRoomGoalProgressText(runState.goal, ROOM_GOAL_DEFINITIONS, runState);
  }

  private getExpandedRoomGoalProgressText(runState: ActiveExpandedRoomRunState): string {
    return formatCourseGoalProgressText(runState);
  }

  private getRoomRushGoalBadgeText(runState: ActiveRoomRushRunState): string {
    return formatRoomRushGoalBadgeText(runState);
  }

  private getRoomRushTimerText(runState: ActiveRoomRushRunState): string {
    return this.formatOverlayTimer(runState.startRule === 'weekly' && runState.result === 'active'
      ? Math.max(0, (runState.timeLimitMs ?? 300000) - runState.elapsedMs) : runState.elapsedMs);
  }

  private getRoomRushProgressText(runState: ActiveRoomRushRunState): string {
    return formatRoomRushProgressText(runState);
  }

  private formatOverlayTimer(ms: number): string {
    return formatGoalOverlayTimer(ms);
  }

  private truncateOverlayText(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value;
    }

    return `${value.slice(0, Math.max(1, maxLength - 1))}\u2026`;
  }
}

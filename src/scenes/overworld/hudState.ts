import { getAuthDebugState } from '../../auth/client';
import { isRoomInActiveCourseDraftSession } from '../../courses/draftSession';
import {
  type CourseGoal,
  type CourseGoalType,
  type CourseSnapshot,
} from '../../courses/model';
import {
  getCourseGoalBadgeText as formatCourseGoalBadgeText,
  getCourseGoalProgressText as formatCourseGoalProgressText,
  getCourseGoalTimerText as formatCourseGoalTimerText,
  type ActiveCourseRunState,
} from './courseRuns';
import type { RoomGoal } from '../../goals/roomGoals';
import {
  roomIdFromCoordinates,
  type RoomCoordinates,
  type RoomSnapshot,
  type RoomSnapshotView,
} from '../../persistence/roomModel';
import { type WorldRoomSummary } from '../../persistence/worldModel';
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
          expandedRoom.goalType === 'collect_race' || expandedRoom.goalType === 'npc_quest'
            ? null
            : expandedRoom.goalType,
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
        selectedState,
        selectedCoordinates,
        selectedSummary: this.selectedSummary
          ? {
              title: this.selectedSummary.title ?? null,
              creatorUserId: this.selectedSummary.creatorUserId ?? null,
              creatorDisplayName: this.selectedSummary.creatorDisplayName ?? null,
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
        courseBuilderButtonDisabled: false,
        roomCommentsVisible: this.host.areRoomCommentsVisible(),
        zoom: this.host.getZoom(),
        getRoomDisplayTitle: (title, coordinates) => this.getRoomDisplayTitle(title, coordinates),
        getCourseGoalBadgeText: (goal) => this.getCourseGoalBadgeText(goal),
        getGoalBadgeText: (goal) => this.getGoalBadgeText(goal),
        getSelectedRoomGoalText: (room) => this.getSelectedRoomGoalText(room),
        getCourseGoalTimerText: (runState) => this.getCourseGoalTimerText(runState),
        getPlayGoalTimerText: (runState) => this.getPlayGoalTimerText(runState),
        getCourseGoalProgressText: (runState) => this.getCourseGoalProgressText(runState),
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
        console.warn('Failed to load selected course snapshot', error);
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
    switch (goal.type) {
      case 'reach_exit':
        return 'Reach exit';
      case 'collect_target':
        return `Collect ${goal.requiredCount}`;
      case 'collect_race':
        return 'Collect race';
      case 'defeat_all':
        return 'Defeat all enemies';
      case 'checkpoint_sprint':
        return `Reach ${goal.checkpoints.length || 0} ${goal.checkpoints.length === 1 ? 'checkpoint' : 'checkpoints'}`;
      case 'survival':
        return `Survive ${Math.max(1, Math.round(goal.durationMs / 1000))} seconds`;
      case 'npc_quest':
        return goal.questType === 'protect'
          ? `Protect NPC ${Math.max(1, Math.round(goal.durationMs / 1000))} seconds`
          : goal.questType === 'escort'
            ? 'Escort NPC'
            : `Give NPC ${goal.requiredCount}`;
    }
  }

  private getSelectedRoomGoalText(room: RoomSnapshot): string {
    if (!room.goal) {
      return '';
    }

    switch (room.goal.type) {
      case 'reach_exit':
        return 'Reach exit';
      case 'collect_target':
        return `Collect ${room.goal.requiredCount}`;
      case 'collect_race':
        return 'Collect more than the Sword Hunter';
      case 'defeat_all': {
        const enemyCount = this.host.countRoomEnemies(room);
        return `Defeat ${enemyCount} ${enemyCount === 1 ? 'enemy' : 'enemies'}`;
      }
      case 'checkpoint_sprint':
        return `Reach ${room.goal.checkpoints.length} ${room.goal.checkpoints.length === 1 ? 'checkpoint' : 'checkpoints'}`;
      case 'survival':
        return `Survive ${Math.max(1, Math.round(room.goal.durationMs / 1000))} seconds`;
      case 'npc_quest':
        return room.goal.questType === 'protect'
          ? `Protect NPC for ${Math.max(1, Math.round(room.goal.durationMs / 1000))} seconds`
          : room.goal.questType === 'escort'
            ? 'Escort NPC to the destination'
            : `Collect ${room.goal.requiredCount} and return to NPC`;
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

    if (runState.goal.type === 'npc_quest' && runState.goal.questType === 'protect') {
      return `${this.formatOverlayTimer(Math.min(runState.elapsedMs, runState.goal.durationMs))} PROTECTED`;
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
      case 'collect_race':
        return `You ${runState.collectiblesCollected} · Hunter ${runState.enemyCollectiblesCollected}`;
      case 'defeat_all':
        return `${runState.enemiesDefeated}/${runState.enemyTarget ?? 0} defeated`;
      case 'checkpoint_sprint':
        return `${runState.checkpointsReached}/${runState.checkpointTarget ?? 0} checkpoints`;
      case 'survival':
        return runState.result === 'completed' ? 'Survived' : 'Stay alive';
      case 'npc_quest':
        if (runState.goal.questType === 'protect') {
          return runState.result === 'completed' ? 'NPC protected' : 'Keep NPC alive';
        }
        if (runState.goal.questType === 'escort') {
          return runState.result === 'completed' ? 'Escort complete' : 'Move NPC to destination';
        }
        return runState.collectiblesCollected >= runState.goal.requiredCount
          ? 'Return to NPC'
          : `${runState.collectiblesCollected}/${runState.goal.requiredCount} collected`;
    }
  }

  private getCourseGoalProgressText(runState: ActiveCourseRunState): string {
    return formatCourseGoalProgressText(runState);
  }

  private getRoomRushGoalBadgeText(runState: ActiveRoomRushRunState): string {
    return formatRoomRushGoalBadgeText(runState);
  }

  private getRoomRushTimerText(runState: ActiveRoomRushRunState): string {
    return this.formatOverlayTimer(runState.elapsedMs);
  }

  private getRoomRushProgressText(runState: ActiveRoomRushRunState): string {
    return formatRoomRushProgressText(runState);
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

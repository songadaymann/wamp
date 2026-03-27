import type {
  RoomCoordinates,
  RoomSnapshot,
} from '../../persistence/roomModel';
import type {
  ActiveCourseRunState,
} from './courseRuns';
import type {
  GoalRunState,
} from './goalRuns';

interface OverworldSessionResetHost {
  getCurrentGoalRun(): GoalRunState | null;
  getActiveCourseRun(): ActiveCourseRunState | null;
  setActiveCourseRun(runState: ActiveCourseRunState | null): void;
  recordGoalRunDeath(): void;
  recordCourseRunDeath(): void;
  playPlayerFailFx(): void;
  respawnPlayerToCurrentRoom(): void;
  failCourseRun(message: string): void;
  failGoalRun(message: string): void;
  showTransientStatus(message: string): void;
  getRoomSnapshotForCoordinates(coordinates: RoomCoordinates): RoomSnapshot | null;
  restartGoalRunForRoom(room: RoomSnapshot): void;
  refreshLeaderboardForSelection(): void;
  abandonGoalRun(): void;
  finalizeActiveCourseRun(result: 'failed' | 'abandoned'): void;
  clearActiveCourseRoomOverrides(): void;
  resetRoomChallengeState(room: RoomSnapshot): void;
  resetTransientPlayState(): void;
  resetGoalRunController(): void;
  redrawGoalMarkers(): void;
}

export class OverworldSessionResetController {
  constructor(private readonly host: OverworldSessionResetHost) {}

  handlePlayerDeath(reason: string): void {
    const activeRun = this.host.getCurrentGoalRun();
    const activeCourseRun = this.host.getActiveCourseRun();

    this.host.recordGoalRunDeath();
    this.host.recordCourseRunDeath();
    this.host.playPlayerFailFx();
    this.host.respawnPlayerToCurrentRoom();

    if (activeCourseRun?.course.goal?.type === 'survival') {
      this.host.failCourseRun('Course survival failed.');
      this.host.showTransientStatus(`${reason} Course run failed.`);
      return;
    }

    if (activeRun?.goal.type === 'survival') {
      const goalRoom = this.host.getRoomSnapshotForCoordinates(activeRun.roomCoordinates);
      this.host.failGoalRun('Survival failed.');
      if (goalRoom?.goal) {
        this.resetChallengeStateForRun(activeRun);
        this.host.restartGoalRunForRoom(goalRoom);
        this.host.refreshLeaderboardForSelection();
        this.host.showTransientStatus(`${reason} Survival run restarted.`);
      }
      return;
    }

    if (activeRun?.qualificationState === 'practice') {
      const goalRoom = this.host.getRoomSnapshotForCoordinates(activeRun.roomCoordinates);
      if (goalRoom?.goal) {
        this.resetChallengeStateForRun(activeRun);
        this.host.restartGoalRunForRoom(goalRoom);
        this.host.refreshLeaderboardForSelection();
        return;
      }
    }

    this.host.showTransientStatus(reason);
  }

  resetPlaySession(): void {
    const activeCourseRun = this.host.getActiveCourseRun();
    const singleRoomRunToReset = activeCourseRun ? null : this.host.getCurrentGoalRun();

    this.host.abandonGoalRun();
    if (activeCourseRun?.result === 'active') {
      this.host.finalizeActiveCourseRun('abandoned');
    }

    if (singleRoomRunToReset && this.shouldResetChallengeStateForRun(singleRoomRunToReset)) {
      this.resetChallengeStateForRun(singleRoomRunToReset);
    }

    this.host.setActiveCourseRun(null);
    this.host.clearActiveCourseRoomOverrides();
    this.host.resetTransientPlayState();
    this.host.resetGoalRunController();
    this.host.redrawGoalMarkers();
  }

  resetChallengeStateForCurrentRun(): void {
    const currentGoalRun = this.host.getCurrentGoalRun();
    if (!currentGoalRun) {
      return;
    }

    this.resetChallengeStateForRun(currentGoalRun);
  }

  resetChallengeStateForRoomExit(nextRoomCoordinates: RoomCoordinates): void {
    const activeGoalRun = this.host.getActiveCourseRun() ? null : this.host.getCurrentGoalRun();
    if (!activeGoalRun) {
      return;
    }

    if (
      nextRoomCoordinates.x === activeGoalRun.roomCoordinates.x &&
      nextRoomCoordinates.y === activeGoalRun.roomCoordinates.y
    ) {
      return;
    }

    if (!this.shouldResetChallengeStateForRun(activeGoalRun)) {
      return;
    }

    this.resetChallengeStateForRun(activeGoalRun);
  }

  private shouldResetChallengeStateForRun(runState: GoalRunState): boolean {
    return (
      runState.result === 'active' ||
      runState.result === 'completed' ||
      runState.result === 'failed'
    );
  }

  private resetChallengeStateForRun(runState: GoalRunState): void {
    const room = this.host.getRoomSnapshotForCoordinates(runState.roomCoordinates);
    if (!room) {
      return;
    }

    this.host.resetRoomChallengeState(room);
  }
}

import type {
  RoomCoordinates,
  RoomSnapshot,
} from '../../persistence/roomModel';
import {
  roomIdFromCoordinates,
} from '../../persistence/roomModel';
import type {
  ActiveCourseRunState,
} from './courseRuns';
import type {
  GoalRunState,
} from './goalRuns';
import type {
  ActiveRoomRushRunState,
} from './roomRushRuns';

interface OverworldSessionResetHost {
  getCurrentGoalRun(): GoalRunState | null;
  getActiveCourseRun(): ActiveCourseRunState | null;
  getActiveRoomRushRun(): ActiveRoomRushRunState | null;
  hasActivePvpMatch(): boolean;
  isPvpDamageActive(): boolean;
  tryAbsorbPlayerDamage?(): boolean;
  onPlayerDeath?(): void;
  cancelPlayerAttack(): void;
  setActiveCourseRun(runState: ActiveCourseRunState | null): void;
  recordGoalRunDeath(): void;
  recordRunDeathLocation?(): void;
  recordCourseRunDeath(): void;
  recordRoomRushDeath(reason: string): boolean;
  recordPvpSelfDeath(reason: string): boolean;
  playPlayerFailFx(): void;
  isPlayerDeathPending?(): boolean;
  runDeathBeat?(respawn: () => void): void;
  respawnPlayerToCurrentRoom(): void;
  clearRespawnCheckpoints?(): void;
  failCourseRun(message: string): void;
  failGoalRun(message: string): void;
  showTransientStatus(message: string): void;
  getRoomSnapshotForCoordinates(coordinates: RoomCoordinates): RoomSnapshot | null;
  restartGoalRunForRoom(room: RoomSnapshot): void;
  refreshLeaderboardForSelection(): void;
  abandonGoalRun(): void;
  abandonRoomRushRun(): void;
  finalizeActiveCourseRun(result: 'failed' | 'abandoned'): void;
  clearActiveCourseRoomOverrides(): void;
  resetRoomChallengeState(room: RoomSnapshot): void;
  resetBossChallenges?(alreadyResetRoomId: string | null): void;
  resetTransientPlayState(): void;
  resetGoalRunController(): void;
  resetRoomRushController(): void;
  redrawGoalMarkers(): void;
}

export class OverworldSessionResetController {
  constructor(private readonly host: OverworldSessionResetHost) {}

  handlePlayerDeath(reason: string, bypassHealth = false): void {
    if (this.host.isPlayerDeathPending?.()) return;
    const activeRun = this.host.getCurrentGoalRun();
    const activeCourseRun = this.host.getActiveCourseRun();
    const activeRoomRushRun = this.host.getActiveRoomRushRun();
    const activePvpMatch = this.host.hasActivePvpMatch();
    if (activePvpMatch && !this.host.isPvpDamageActive()) {
      return;
    }

    if (!activePvpMatch && !bypassHealth && this.host.tryAbsorbPlayerDamage?.()) return;
    this.host.onPlayerDeath?.();

    this.host.cancelPlayerAttack();

    // These deaths start a fresh run or end survival, so keep its original spawn.
    if (activeCourseRun?.course.goal?.type === 'survival'
      || (!activeCourseRun && (activeRun?.goal.type === 'survival' || activeRun?.qualificationState === 'practice'))) {
      this.host.clearRespawnCheckpoints?.();
    }

    this.host.recordRunDeathLocation?.();
    this.host.recordGoalRunDeath();
    this.host.recordCourseRunDeath();
    this.host.playPlayerFailFx();
    const afterBeat = () => {
      this.host.respawnPlayerToCurrentRoom();

      if (activePvpMatch) {
        const terminal = this.host.recordPvpSelfDeath(reason);
        if (terminal) {
          return;
        }
        return;
      }

      if (activeRoomRushRun) {
        const terminal = this.host.recordRoomRushDeath(reason);
        if (terminal) {
          return;
        }
        return;
      }

      if (activeCourseRun?.course.goal?.type === 'survival') {
        this.host.failCourseRun('Expanded room survival failed.');
        this.host.showTransientStatus(`${reason} Expanded room run failed.`);
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
    };
    if (this.host.runDeathBeat) this.host.runDeathBeat(afterBeat);
    else afterBeat();
  }

  resetPlaySession(): void {
    this.host.clearRespawnCheckpoints?.();
    const activeCourseRun = this.host.getActiveCourseRun();
    const activeRoomRushRun = this.host.getActiveRoomRushRun();
    const singleRoomRunToReset = activeCourseRun || activeRoomRushRun ? null : this.host.getCurrentGoalRun();

    this.host.abandonGoalRun();
    this.host.abandonRoomRushRun();
    if (activeCourseRun?.result === 'active') {
      this.host.finalizeActiveCourseRun('abandoned');
    }

    const singleRoomWasReset = singleRoomRunToReset && this.shouldResetChallengeStateForRun(singleRoomRunToReset);
    if (singleRoomWasReset) {
      this.resetChallengeStateForRun(singleRoomRunToReset);
    }

    // Cached cells can outlive an expanded run, Room Rush or goal-less play.
    this.host.resetBossChallenges?.(singleRoomWasReset ? singleRoomRunToReset.roomId : null);

    this.host.setActiveCourseRun(null);
    this.host.clearActiveCourseRoomOverrides();
    this.host.resetTransientPlayState();
    this.host.resetGoalRunController();
    this.host.resetRoomRushController();
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
    const activeCourseRun = this.host.getActiveCourseRun();
    if (activeCourseRun && this.shouldAbandonExpandedRoomRunForExit(activeCourseRun, nextRoomCoordinates)) {
      this.resetChallengeStateForCourseRun(activeCourseRun);
      if (activeCourseRun.result === 'active') {
        this.host.finalizeActiveCourseRun('abandoned');
      }
      this.host.setActiveCourseRun(null);
      this.host.clearActiveCourseRoomOverrides();
      this.host.redrawGoalMarkers();
      this.host.showTransientStatus('Expanded room run abandoned.');
      return;
    }

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

  private shouldAbandonExpandedRoomRunForExit(
    runState: ActiveCourseRunState,
    nextRoomCoordinates: RoomCoordinates,
  ): boolean {
    if (!runState.expandedRoomId || runState.result !== 'active') {
      return false;
    }

    const nextRoomId = roomIdFromCoordinates(nextRoomCoordinates);
    return !runState.course.roomRefs.some((roomRef) => roomRef.roomId === nextRoomId);
  }

  private resetChallengeStateForCourseRun(runState: ActiveCourseRunState): void {
    for (const roomRef of runState.course.roomRefs) {
      const room = this.host.getRoomSnapshotForCoordinates(roomRef.coordinates);
      if (room) {
        this.host.resetRoomChallengeState(room);
      }
    }
  }

  private resetChallengeStateForRun(runState: GoalRunState): void {
    const room = this.host.getRoomSnapshotForCoordinates(runState.roomCoordinates);
    if (!room) {
      return;
    }

    this.host.resetRoomChallengeState(room);
  }
}

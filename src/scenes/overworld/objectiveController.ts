import Phaser from 'phaser';
import type { SfxCue } from '../../audio/sfx';
import type { CourseMarkerPoint } from '../../courses/model';
import {
  recordCourseRunCollectibleCollected,
  recordCourseRunEnemyDefeated,
  tickActiveCourseRun,
  type ActiveCourseRunState,
  type CourseRunMutationResult,
} from './courseRuns';
import type {
  GoalRunMutationResult,
  GoalRunState,
  OverworldGoalRunController,
} from './goalRuns';
import type {
  GoalMarkerPoint,
} from '../../goals/roomGoals';
import type {
  RoomCoordinates,
  RoomSnapshot,
} from '../../persistence/roomModel';

interface OverworldObjectiveControllerHost {
  goalRunController: OverworldGoalRunController;
  getActiveCourseRun(): ActiveCourseRunState | null;
  getPlayer(): Phaser.GameObjects.Rectangle | null;
  getPlayerBody(): Phaser.Physics.Arcade.Body | null;
  getCurrentRoomCoordinates(): RoomCoordinates;
  getPlayerEffectOrigin(): GoalMarkerPoint | null;
  toWorldGoalPoint(roomCoordinates: RoomCoordinates, point: GoalMarkerPoint): GoalMarkerPoint;
  toWorldCoursePoint(point: CourseMarkerPoint): GoalMarkerPoint;
  resetChallengeStateForCurrentRun(): void;
  showTransientStatus(message: string): void;
  redrawGoalMarkers(): void;
  playGoalFx(
    effect: 'start' | 'checkpoint' | 'success' | 'fail' | 'abandon',
    x: number,
    y: number,
    cue?: SfxCue | null,
  ): void;
  finalizeActiveCourseRun(result: 'completed' | 'failed'): void;
}

export class OverworldObjectiveController {
  constructor(
    private readonly host: OverworldObjectiveControllerHost,
    private readonly options: { goalTouchRadius: number },
  ) {}

  syncGoalRunForRoom(
    room: RoomSnapshot | null,
    entryContext: 'transition' | 'spawn' | 'respawn' = 'transition',
  ): void {
    this.applyGoalRunMutation(this.host.goalRunController.syncRunForRoom(room, entryContext));
  }

  restartGoalRunForRoom(
    room: RoomSnapshot | null,
    entryContext: 'transition' | 'spawn' | 'respawn' = 'spawn',
  ): void {
    this.applyGoalRunMutation(this.host.goalRunController.restartRunForRoom(room, entryContext));
  }

  update(delta: number): void {
    if (this.host.getActiveCourseRun()) {
      this.updateCourseRun(delta);
      return;
    }

    const playerBody = this.host.getPlayerBody();
    if (playerBody) {
      this.applyGoalRunMutation(
        this.host.goalRunController.qualifyPracticeRunAt({
          x: playerBody.center.x,
          y: playerBody.bottom,
        }),
      );
    }

    this.applyGoalRunMutation(this.host.goalRunController.tick(delta));

    const runState = this.host.goalRunController.getCurrentRun();
    if (!runState || runState.result !== 'active') {
      return;
    }

    const player = this.host.getPlayer();
    if (!player || !playerBody) {
      return;
    }

    const currentRoomCoordinates = this.host.getCurrentRoomCoordinates();
    if (
      currentRoomCoordinates.x !== runState.roomCoordinates.x ||
      currentRoomCoordinates.y !== runState.roomCoordinates.y
    ) {
      return;
    }

    switch (runState.goal.type) {
      case 'reach_exit':
        if (
          runState.goal.exit &&
          this.playerTouchesGoalPoint(
            this.host.toWorldGoalPoint(runState.roomCoordinates, runState.goal.exit),
          )
        ) {
          this.completeGoalRun('Exit reached.');
        }
        break;
      case 'checkpoint_sprint':
        this.updateCheckpointSprintRun(runState);
        break;
      default:
        break;
    }
  }

  failGoalRun(message: string): void {
    this.applyGoalRunMutation(this.host.goalRunController.markFailed(message));
  }

  failCourseRun(message: string): void {
    const activeCourseRun = this.host.getActiveCourseRun();
    if (!activeCourseRun || activeCourseRun.result !== 'active') {
      return;
    }

    activeCourseRun.result = 'failed';
    activeCourseRun.completionMessage = message;
    this.host.showTransientStatus(message);
    const player = this.host.getPlayer();
    const playerBody = this.host.getPlayerBody();
    this.host.playGoalFx(
      'fail',
      player?.x ?? 0,
      playerBody?.bottom ?? 0,
      'goal-fail',
    );
    this.host.redrawGoalMarkers();
    this.host.finalizeActiveCourseRun('failed');
  }

  handleEnemyDefeated(roomId: string, enemyName: string): boolean {
    this.applyCourseRunMutation(recordCourseRunEnemyDefeated(this.host.getActiveCourseRun()));

    const result = this.host.goalRunController.recordEnemyDefeated(roomId, enemyName);
    this.applyGoalRunMutation(result);
    return Boolean(result.transientStatus);
  }

  handleCollectibleCollected(roomId: string): void {
    this.applyCourseRunMutation(recordCourseRunCollectibleCollected(this.host.getActiveCourseRun()));
    this.applyGoalRunMutation(this.host.goalRunController.recordCollectibleCollected(roomId));
  }

  private updateCheckpointSprintRun(runState: GoalRunState): void {
    if (runState.goal.type !== 'checkpoint_sprint') {
      return;
    }

    const nextCheckpoint = runState.goal.checkpoints[runState.nextCheckpointIndex] ?? null;
    if (nextCheckpoint) {
      const worldPoint = this.host.toWorldGoalPoint(runState.roomCoordinates, nextCheckpoint);
      if (this.playerTouchesGoalPoint(worldPoint)) {
        this.applyGoalRunMutation(this.host.goalRunController.recordCheckpointReached());
      }
      return;
    }

    if (
      runState.goal.finish &&
      this.playerTouchesGoalPoint(
        this.host.toWorldGoalPoint(runState.roomCoordinates, runState.goal.finish),
      )
    ) {
      this.completeGoalRun('Sprint clear.');
    }
  }

  private playerTouchesGoalPoint(point: GoalMarkerPoint): boolean {
    const playerBody = this.host.getPlayerBody();
    if (!playerBody) {
      return false;
    }

    const feetX = playerBody.center.x;
    const feetY = playerBody.bottom;
    return Phaser.Math.Distance.Between(feetX, feetY, point.x, point.y) <= this.options.goalTouchRadius;
  }

  private completeGoalRun(message: string): void {
    this.applyGoalRunMutation(this.host.goalRunController.markCompleted(message));
  }

  private updateCourseRun(delta: number): void {
    this.applyCourseRunMutation(
      tickActiveCourseRun(this.host.getActiveCourseRun(), {
        delta,
        touchesCoursePoint: (point) => this.playerTouchesGoalPoint(this.host.toWorldCoursePoint(point)),
        getPlayerEffectOrigin: () => this.host.getPlayerEffectOrigin(),
      }),
    );
  }

  private applyCourseRunMutation(result: CourseRunMutationResult): void {
    if (!result.changed) {
      return;
    }

    if (result.transientStatus) {
      this.host.showTransientStatus(result.transientStatus);
    }

    if (result.checkpointEffectOrigin) {
      this.host.playGoalFx(
        'checkpoint',
        result.checkpointEffectOrigin.x,
        result.checkpointEffectOrigin.y,
      );
    }

    if (result.goalMarkersChanged) {
      this.host.redrawGoalMarkers();
    }

    if (result.terminalResult === 'completed' && result.terminalMessage) {
      this.completeCourseRun(result.terminalMessage);
    } else if (result.terminalResult === 'failed' && result.terminalMessage) {
      this.failCourseRun(result.terminalMessage);
    }
  }

  private completeCourseRun(message: string): void {
    const activeCourseRun = this.host.getActiveCourseRun();
    if (!activeCourseRun || activeCourseRun.result !== 'active') {
      return;
    }

    activeCourseRun.result = 'completed';
    activeCourseRun.completionMessage = message;
    this.host.showTransientStatus(message);
    const player = this.host.getPlayer();
    const playerBody = this.host.getPlayerBody();
    this.host.playGoalFx('success', player?.x ?? 0, playerBody?.bottom ?? 0);
    this.host.redrawGoalMarkers();
    this.host.finalizeActiveCourseRun('completed');
  }

  private applyGoalRunMutation(result: GoalRunMutationResult): void {
    if (!result.changed) {
      return;
    }

    if (result.resetChallengeState) {
      this.host.resetChallengeStateForCurrentRun();
    }

    this.playGoalRunFx(result);

    if (result.transientStatus) {
      this.host.showTransientStatus(result.transientStatus);
    }

    if (result.goalMarkersChanged) {
      this.host.redrawGoalMarkers();
    }
  }

  private playGoalRunFx(result: GoalRunMutationResult): void {
    if (!result.event) {
      return;
    }

    const origin = this.host.getPlayerEffectOrigin();
    if (!origin) {
      return;
    }

    switch (result.event) {
      case 'start':
        this.host.playGoalFx('start', origin.x, origin.y);
        break;
      case 'checkpoint':
        this.host.playGoalFx('checkpoint', origin.x, origin.y);
        break;
      case 'complete':
        this.host.playGoalFx('success', origin.x, origin.y);
        break;
      case 'fail':
        this.host.playGoalFx(
          'fail',
          origin.x,
          origin.y,
          result.transientStatus === 'Time up.' ? 'time-up' : 'goal-fail',
        );
        break;
      case 'abandon':
        this.host.playGoalFx('abandon', origin.x, origin.y, 'challenge-abandon');
        break;
      default:
        break;
    }
  }
}

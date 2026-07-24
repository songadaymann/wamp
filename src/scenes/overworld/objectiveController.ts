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
  getRoomNpcState(
    roomId: string,
    requestedInstanceId: string | null,
  ): {
    instanceId: string | null;
    name: string;
    alive: boolean;
    x: number;
    y: number;
  } | null;
  setRoomNpcsVictorious(roomId: string, victorious: boolean): void;
  showTransientStatus(message: string): void;
  redrawGoalMarkers(): void;
  playGoalFx(
    effect: 'start' | 'checkpoint' | 'success' | 'fail' | 'abandon',
    x: number,
    y: number,
    cue?: SfxCue | null,
  ): void;
  finalizeActiveCourseRun(result: 'completed' | 'failed'): void;
  recordRankedGoalEvent(event: {
    type: 'checkpoint' | 'reach_exit' | 'finish' | 'complete';
    roomId: string | null;
    roomCoordinates: RoomCoordinates;
    x: number;
    y: number;
    checkpointIndex?: number | null;
  }): void;
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
    const result = this.host.goalRunController.syncRunForRoom(room, entryContext);
    this.applyGoalRunMutation(result);
    if (room?.id && !result.changed) {
      const currentRun = this.host.goalRunController.getCurrentRun();
      this.host.setRoomNpcsVictorious(
        room.id,
        currentRun?.roomId === room.id && currentRun.result === 'completed',
      );
    } else if (room?.id && !this.host.goalRunController.getCurrentRun()) {
      this.host.setRoomNpcsVictorious(room.id, false);
    }
  }

  restartGoalRunForRoom(
    room: RoomSnapshot | null,
    entryContext: 'transition' | 'spawn' | 'respawn' = 'spawn',
  ): void {
    if (room?.id) {
      this.host.setRoomNpcsVictorious(room.id, false);
    }
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
          this.host.recordRankedGoalEvent({
            type: 'reach_exit',
            roomId: runState.roomId,
            roomCoordinates: runState.roomCoordinates,
            x: runState.goal.exit.x,
            y: runState.goal.exit.y,
            checkpointIndex: null,
          });
          this.completeGoalRun('Exit reached.');
        }
        break;
      case 'checkpoint_sprint':
        this.updateCheckpointSprintRun(runState);
        break;
      case 'npc_quest':
        this.updateNpcQuestRun(runState);
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

  handleEnemyCollectibleCollected(roomId: string): void {
    this.applyGoalRunMutation(this.host.goalRunController.recordEnemyCollectibleCollected(roomId));
  }

  handleNpcDefeated(
    roomId: string,
    instanceId: string | null,
    npcName: string,
  ): boolean {
    const result = this.host.goalRunController.recordNpcDefeated(
      roomId,
      instanceId,
      npcName,
    );
    this.applyGoalRunMutation(result);
    return result.changed;
  }

  private updateNpcQuestRun(runState: GoalRunState): void {
    if (runState.goal.type !== 'npc_quest') {
      return;
    }
    const npcState = this.host.getRoomNpcState(
      runState.roomId,
      runState.goal.npcInstanceId ?? runState.npcTargetInstanceId,
    );
    if (!npcState) {
      return;
    }
    this.host.goalRunController.resolveNpcTarget(npcState.instanceId);

    if (runState.goal.questType === 'protect') {
      return;
    }
    if (runState.goal.questType === 'escort' && runState.goal.destination) {
      const destination = this.host.toWorldGoalPoint(
        runState.roomCoordinates,
        runState.goal.destination,
      );
      if (
        Phaser.Math.Distance.Between(
          npcState.x,
          npcState.y,
          destination.x,
          destination.y,
        ) <= this.options.goalTouchRadius
      ) {
        this.applyGoalRunMutation(
          this.host.goalRunController.recordNpcReachedDestination(runState.roomId),
        );
      }
      return;
    }
    if (
      runState.goal.questType === 'give' &&
      runState.collectiblesCollected >= runState.goal.requiredCount
    ) {
      const playerBody = this.host.getPlayerBody();
      if (
        playerBody &&
        Phaser.Math.Distance.Between(
          playerBody.center.x,
          playerBody.center.y,
          npcState.x,
          npcState.y,
        ) <= 52
      ) {
        this.applyGoalRunMutation(
          this.host.goalRunController.recordGiveReturned(runState.roomId),
        );
      }
    }
  }

  private updateCheckpointSprintRun(runState: GoalRunState): void {
    if (runState.goal.type !== 'checkpoint_sprint') {
      return;
    }

    const nextCheckpoint = runState.goal.checkpoints[runState.nextCheckpointIndex] ?? null;
    if (nextCheckpoint) {
      const worldPoint = this.host.toWorldGoalPoint(runState.roomCoordinates, nextCheckpoint);
      if (this.playerTouchesGoalPoint(worldPoint)) {
        this.host.recordRankedGoalEvent({
          type: 'checkpoint',
          roomId: runState.roomId,
          roomCoordinates: runState.roomCoordinates,
          x: nextCheckpoint.x,
          y: nextCheckpoint.y,
          checkpointIndex: runState.nextCheckpointIndex,
        });
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
      this.host.recordRankedGoalEvent({
        type: 'finish',
        roomId: runState.roomId,
        roomCoordinates: runState.roomCoordinates,
        x: runState.goal.finish.x,
        y: runState.goal.finish.y,
        checkpointIndex: null,
      });
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

    if (result.verificationGoalEvent) {
      this.host.recordRankedGoalEvent({
        type: result.verificationGoalEvent.type,
        roomId: result.verificationGoalEvent.marker.roomId,
        roomCoordinates: this.host.getCurrentRoomCoordinates(),
        x: result.verificationGoalEvent.marker.x,
        y: result.verificationGoalEvent.marker.y,
        checkpointIndex: result.verificationGoalEvent.checkpointIndex,
      });
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

    const playerOrigin = this.host.getPlayerEffectOrigin();
    if (playerOrigin) {
      this.host.recordRankedGoalEvent({
        type: 'complete',
        roomId: null,
        roomCoordinates: this.host.getCurrentRoomCoordinates(),
        x: playerOrigin.x,
        y: playerOrigin.y,
        checkpointIndex: null,
      });
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

    if (result.event === 'complete') {
      const runState = this.host.goalRunController.getCurrentRun();
      const origin = this.host.getPlayerEffectOrigin();
      if (runState && origin) {
        this.host.recordRankedGoalEvent({
          type: 'complete',
          roomId: runState.roomId,
          roomCoordinates: runState.roomCoordinates,
          x: origin.x,
          y: origin.y,
          checkpointIndex: null,
        });
      }
      if (runState) {
        this.host.setRoomNpcsVictorious(runState.roomId, true);
      }
    } else if (result.event === 'start' || result.event === 'fail') {
      const runState = this.host.goalRunController.getCurrentRun();
      if (runState) {
        this.host.setRoomNpcsVictorious(runState.roomId, false);
      }
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

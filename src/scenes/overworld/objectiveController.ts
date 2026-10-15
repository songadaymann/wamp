import { updateRoomGoalObjective, type RoomGoalObjectiveContext } from './goalObjectiveRules';
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
  OverworldGoalRunController,
} from './goalRuns';
import type {
  GoalMarkerPoint,
} from '../../goals/roomGoals';
import type {
  RoomCoordinates,
  RoomSnapshot,
} from '../../persistence/roomModel';

export interface OverworldObjectiveControllerHost {
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
  activateRespawnCheckpoint?(point: CourseMarkerPoint, checkpointIndex: number): void;
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
  private readonly goalObjectiveContext: RoomGoalObjectiveContext;
  constructor(
    private readonly host: OverworldObjectiveControllerHost,
    private readonly options: { goalTouchRadius: number },
  ) {
    this.goalObjectiveContext = {
      host,
      getGoalTouchRadius: () => this.options.goalTouchRadius,
      playerTouchesGoalPoint: point => this.playerTouchesGoalPoint(point),
      applyGoalRunMutation: mutation => this.applyGoalRunMutation(mutation),
      completeGoalRun: message => this.completeGoalRun(message),
    };
  }

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

  update(delta: number, interactionsSuspended = false): void {
    if (this.host.getActiveCourseRun()) {
      this.updateCourseRun(delta, interactionsSuspended);
      return;
    }

    const playerBody = this.host.getPlayerBody();
    if (playerBody && !interactionsSuspended) {
      this.applyGoalRunMutation(
        this.host.goalRunController.qualifyPracticeRunAt({
          x: playerBody.center.x,
          y: playerBody.bottom,
        }),
      );
    }

    this.applyGoalRunMutation(this.host.goalRunController.tick(delta, { suspendGoalResolution: interactionsSuspended }));
    if (interactionsSuspended) return;

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

    updateRoomGoalObjective(runState.goal, runState, this.goalObjectiveContext);
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

  private updateCourseRun(delta: number, interactionsSuspended: boolean): void {
    this.applyCourseRunMutation(
      tickActiveCourseRun(this.host.getActiveCourseRun(), {
        delta,
        suspendGoalResolution: interactionsSuspended,
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
      if (result.verificationGoalEvent.type === 'checkpoint' && result.verificationGoalEvent.checkpointIndex !== null) {
        this.host.activateRespawnCheckpoint?.(
          result.verificationGoalEvent.marker, result.verificationGoalEvent.checkpointIndex,
        );
      }
      this.host.recordRankedGoalEvent({
        type: result.verificationGoalEvent.type,
        roomId: result.verificationGoalEvent.marker.roomId,
        roomCoordinates: this.host.getActiveCourseRun()?.course.roomRefs.find(
          ref => ref.roomId === result.verificationGoalEvent?.marker.roomId,
        )?.coordinates ?? this.host.getCurrentRoomCoordinates(),
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

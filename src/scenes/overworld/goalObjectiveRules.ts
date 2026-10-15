import Phaser from 'phaser';
import type { Goal } from '../../goals/goalSchema';
import type { GoalMarkerPoint, RoomGoalType } from '../../goals/roomGoals';
import type { GoalRunMutationResult, GoalRunState } from './goalRuns';
import type { OverworldObjectiveControllerHost } from './objectiveController';

export interface RoomGoalObjectiveContext {
  readonly host: OverworldObjectiveControllerHost;
  readonly getGoalTouchRadius: () => number;
  readonly playerTouchesGoalPoint: (point: GoalMarkerPoint) => boolean;
  readonly applyGoalRunMutation: (mutation: GoalRunMutationResult) => void;
  readonly completeGoalRun: (message: string) => void;
}
type RoomGoalObjectiveRule<K extends RoomGoalType> = (goal: Goal<GoalMarkerPoint, K>, runState: Readonly<GoalRunState>, context: RoomGoalObjectiveContext) => void;
type RoomGoalObjectiveRegistry = { [K in RoomGoalType]: RoomGoalObjectiveRule<K> | null };

const updateNpcQuestObjective: RoomGoalObjectiveRule<'npc_quest'> = (goal, runState, context) => {
  const npcState = context.host.getRoomNpcState(
    runState.roomId,
    goal.npcInstanceId ?? runState.npcTargetInstanceId,
  );
  if (!npcState) {
    return;
  }
  context.host.goalRunController.resolveNpcTarget(npcState.instanceId);

  if (goal.questType === 'protect') {
    return;
  }
  if (goal.questType === 'escort' && goal.destination) {
    const destination = context.host.toWorldGoalPoint(
      runState.roomCoordinates,
      goal.destination,
    );
    if (
      Phaser.Math.Distance.Between(
        npcState.x,
        npcState.y,
        destination.x,
        destination.y,
      ) <= context.getGoalTouchRadius()
    ) {
      context.applyGoalRunMutation(
        context.host.goalRunController.recordNpcReachedDestination(runState.roomId),
      );
    }
    return;
  }
  if (
    goal.questType === 'give' &&
    runState.collectiblesCollected >= goal.requiredCount
  ) {
    const playerBody = context.host.getPlayerBody();
    if (
      playerBody &&
      Phaser.Math.Distance.Between(
        playerBody.center.x,
        playerBody.center.y,
        npcState.x,
        npcState.y,
      ) <= 52
    ) {
      context.applyGoalRunMutation(
        context.host.goalRunController.recordGiveReturned(runState.roomId),
      );
    }
  }
};

const updateCheckpointSprintObjective: RoomGoalObjectiveRule<'checkpoint_sprint'> = (goal, runState, context) => {
  const nextCheckpoint = goal.checkpoints[runState.nextCheckpointIndex] ?? null;
  if (nextCheckpoint) {
    const worldPoint = context.host.toWorldGoalPoint(runState.roomCoordinates, nextCheckpoint);
    if (context.playerTouchesGoalPoint(worldPoint)) {
      context.host.recordRankedGoalEvent({
        type: 'checkpoint',
        roomId: runState.roomId,
        roomCoordinates: runState.roomCoordinates,
        x: nextCheckpoint.x,
        y: nextCheckpoint.y,
        checkpointIndex: runState.nextCheckpointIndex,
      });
      const mutation = context.host.goalRunController.recordCheckpointReached();
      if (mutation.changed) context.host.activateRespawnCheckpoint?.(
        { roomId: runState.roomId, x: nextCheckpoint.x, y: nextCheckpoint.y },
        runState.nextCheckpointIndex - 1,
      );
      context.applyGoalRunMutation(mutation);
    }
    return;
  }

  if (
    goal.finish &&
    context.playerTouchesGoalPoint(
      context.host.toWorldGoalPoint(runState.roomCoordinates, goal.finish),
    )
  ) {
    context.host.recordRankedGoalEvent({
      type: 'finish',
      roomId: runState.roomId,
      roomCoordinates: runState.roomCoordinates,
      x: goal.finish.x,
      y: goal.finish.y,
      checkpointIndex: null,
    });
    context.completeGoalRun('Sprint clear.');
  }
};

/** Event-driven goals explicitly have no per-frame objective work. */
export const ROOM_GOAL_OBJECTIVE_RULES: RoomGoalObjectiveRegistry = {
  reach_exit: (goal, runState, context) => {
    if (goal.exit && context.playerTouchesGoalPoint(context.host.toWorldGoalPoint(runState.roomCoordinates, goal.exit))) {
      context.host.recordRankedGoalEvent({
        type: 'reach_exit', roomId: runState.roomId, roomCoordinates: runState.roomCoordinates,
        x: goal.exit.x, y: goal.exit.y, checkpointIndex: null,
      });
      context.completeGoalRun('Exit reached.');
    }
  },
  checkpoint_sprint: updateCheckpointSprintObjective,
  npc_quest: updateNpcQuestObjective,
  collect_target: null,
  collect_race: null,
  defeat_all: null,
  survival: null,
};

export function updateRoomGoalObjective<K extends RoomGoalType>(goal: Goal<GoalMarkerPoint, K>, runState: Readonly<GoalRunState>, context: RoomGoalObjectiveContext): void {
  ROOM_GOAL_OBJECTIVE_RULES[goal.type]?.(goal, runState, context);
}

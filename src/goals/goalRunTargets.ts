/** Setup-only lazy reads; goals request only the counts/NPC fallback they need. */
export interface RoomGoalTargetContext {
  readonly countCollectibles: () => number;
  readonly countEnemies: () => number;
  readonly firstNpcInstanceId: () => string | null;
}
export interface RoomGoalRunTargets {
  readonly collectibleTarget: number | null;
  readonly enemyTarget: number | null;
  readonly checkpointTarget: number | null;
  readonly npcTargetInstanceId: string | null;
  readonly npcAlive: boolean | null;
}
export const EMPTY_ROOM_GOAL_TARGETS: RoomGoalRunTargets = Object.freeze({
  collectibleTarget: null,
  enemyTarget: null,
  checkpointTarget: null,
  npcTargetInstanceId: null,
  npcAlive: null,
});

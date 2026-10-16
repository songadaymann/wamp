import type { Goal, GoalMarkerPoint, GoalType } from './goalSchema';

export interface GoalValidationMarker<P extends GoalMarkerPoint> { point: P | null; label: string; }
interface GoalSafetyRule<K extends GoalType> {
  markers: <P extends GoalMarkerPoint>(goal: Goal<P, K>) => GoalValidationMarker<P>[];
  checkpoints: <P extends GoalMarkerPoint>(goal: Goal<P, K>) => readonly P[];
  endsOnDeath: boolean;
  timed: (goal: Goal<GoalMarkerPoint, K>) => boolean;
}
export type GoalSafetyRegistry = { [K in GoalType]: GoalSafetyRule<K> };
const noMarkers = { markers: () => [], checkpoints: () => [] };
const limited = (goal: { timeLimitMs: number | null }): boolean => goal.timeLimitMs !== null;

/** Authored markers only: start safety and NPC identity stay with their owners. */
export const GOAL_SAFETY_RULES: GoalSafetyRegistry = {
  reach_exit: { ...noMarkers, markers: goal => [{ point: goal.exit, label: 'Exit' }], endsOnDeath: false, timed: limited },
  collect_target: { ...noMarkers, endsOnDeath: false, timed: limited },
  collect_race: { ...noMarkers, endsOnDeath: false, timed: limited },
  defeat_all: { ...noMarkers, endsOnDeath: false, timed: limited },
  checkpoint_sprint: {
    markers: goal => [...goal.checkpoints.map(point => ({ point, label: 'Checkpoint' })), { point: goal.finish, label: 'Finish' }],
    checkpoints: goal => goal.checkpoints,
    endsOnDeath: false, timed: limited,
  },
  survival: { ...noMarkers, endsOnDeath: true, timed: () => true },
  npc_quest: { ...noMarkers, markers: goal => goal.questType === 'escort' ? [{ point: goal.destination, label: 'Destination' }] : [], endsOnDeath: false, timed: goal => goal.questType === 'protect' },
};
export function goalValidationMarkers<P extends GoalMarkerPoint, K extends GoalType = GoalType>(goal: Goal<P, K>): GoalValidationMarker<P>[] {
  return GOAL_SAFETY_RULES[goal.type].markers(goal);
}
export function goalCheckpoints<P extends GoalMarkerPoint, K extends GoalType = GoalType>(goal: Goal<P, K> | null): readonly P[] {
  return goal ? GOAL_SAFETY_RULES[goal.type].checkpoints(goal) : [];
}
export function goalIsTimed<K extends GoalType>(goal: Goal<GoalMarkerPoint, K>): boolean {
  return GOAL_SAFETY_RULES[goal.type].timed(goal);
}

export function goalEndsOnDeath(goal: { type: GoalType } | null | undefined): boolean {
  return goal ? GOAL_SAFETY_RULES[goal.type].endsOnDeath : false;
}

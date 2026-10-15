import type { Goal, GoalMarkerPoint, GoalType } from '../../../goals/goalSchema';

export interface GoalVerificationFacts {
  collectedCount: number;
  defeatedCount: number;
  checkpointCount: number;
  requiredEnemyCount: number;
  reachedExit: boolean;
  reachedFinish: boolean;
  hasMarkerEvent: (type: 'reach_exit' | 'finish', point: GoalMarkerPoint | null) => boolean;
}

export type GoalVerificationIssue =
  | { issue: 'missing_exit' | 'missing_finish' | 'npc_quest_missing_completion' }
  | { issue: 'collect_target_shortfall' | 'npc_give_shortfall'; requiredCount: number; collectedCount: number }
  | { issue: 'defeat_all_shortfall'; requiredCount: number; defeatedCount: number }
  | { issue: 'checkpoint_shortfall'; requiredCount: number; reachedCount: number }
  | { issue: 'unverified_goal_type'; goalType: unknown };

type GoalVerificationRules = {
  [K in GoalType]: (goal: Goal<GoalMarkerPoint, K>, facts: GoalVerificationFacts) => GoalVerificationIssue | null;
};

/** Event bindings, timing and result eligibility remain the caller's responsibility. */
export const GOAL_VERIFICATION_RULES: GoalVerificationRules = {
  reach_exit: (goal, facts) => {
    if (!facts.reachedExit || !facts.hasMarkerEvent('reach_exit', goal.exit ?? null)) {
      return { issue: 'missing_exit' };
    }
    return null;
  },
  collect_target: (goal, facts) => facts.collectedCount < goal.requiredCount
    ? { issue: 'collect_target_shortfall', requiredCount: goal.requiredCount, collectedCount: facts.collectedCount }
    : null,
  // Collect Race and Survival need no extra marker/count proof after common checks.
  collect_race: () => null,
  defeat_all: (_goal, facts) => facts.defeatedCount < facts.requiredEnemyCount
    ? { issue: 'defeat_all_shortfall', requiredCount: facts.requiredEnemyCount, defeatedCount: facts.defeatedCount }
    : null,
  checkpoint_sprint: (goal, facts) => {
    if (facts.checkpointCount < goal.checkpoints.length) {
      return { issue: 'checkpoint_shortfall', requiredCount: goal.checkpoints.length, reachedCount: facts.checkpointCount };
    }
    if (!facts.reachedFinish && !facts.hasMarkerEvent('finish', goal.finish ?? null)) {
      return { issue: 'missing_finish' };
    }
    return null;
  },
  survival: () => null,
  npc_quest: (goal, facts) => {
    if (goal.questType === 'give' && facts.collectedCount < goal.requiredCount) {
      return { issue: 'npc_give_shortfall', requiredCount: goal.requiredCount, collectedCount: facts.collectedCount };
    }
    if ((goal.questType === 'escort' || goal.questType === 'give') && !facts.reachedFinish) {
      return { issue: 'npc_quest_missing_completion' };
    }
    return null;
  },
};

export function verifyGoalRule<K extends GoalType>(
  goal: Goal<GoalMarkerPoint, K>,
  facts: GoalVerificationFacts,
): GoalVerificationIssue | null {
  // Keep runtime rejection too: an unregistered or inherited key must never pass.
  if (typeof goal.type !== 'string' || !Object.prototype.hasOwnProperty.call(GOAL_VERIFICATION_RULES, goal.type)) {
    return { issue: 'unverified_goal_type', goalType: goal.type ?? null };
  }
  return GOAL_VERIFICATION_RULES[goal.type](goal, facts);
}

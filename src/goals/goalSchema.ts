import type { GoalFlagDescriptor, GoalFlagProgressFacts } from './goalMarkerPresentation';
import type { CourseGoalProgressFacts, GoalPresentation, GoalTimerFormatter, RoomGoalProgressFacts } from './goalPresentation';
import {
  createRoomGoalScoreContext,
  type GoalRankingMode,
  type GoalScoreMetrics,
  type RoomGoalRankingPolicy,
  type RoomGoalScoreContext,
} from './goalScoring';

/** Shared goal data; this module is safe for browser and Worker consumers. */
export interface GoalMarkerPoint {
  x: number;
  y: number;
}

export const NPC_QUEST_TYPES = ['protect', 'escort', 'give'] as const;
export type NpcQuestType = typeof NPC_QUEST_TYPES[number];
export interface GoalFields<P extends GoalMarkerPoint> {
  reach_exit: {
    exit: P | null;
    timeLimitMs: number | null;
  };
  collect_target: {
    requiredCount: number;
    timeLimitMs: number | null;
  };
  collect_race: {
    timeLimitMs: number | null;
  };
  defeat_all: {
    timeLimitMs: number | null;
  };
  checkpoint_sprint: {
    checkpoints: P[];
    finish: P | null;
    timeLimitMs: number | null;
  };
  survival: {
    durationMs: number;
  };
  npc_quest: {
    questType: NpcQuestType;
    npcInstanceId: string | null;
    durationMs: number;
    requiredCount: number;
    destination: P | null;
    timeLimitMs: null;
  };
}

export type GoalType = keyof GoalFields<GoalMarkerPoint>;
/** A distributive map preserves the correlation between type, data and handler. */
export type Goal<P extends GoalMarkerPoint, K extends GoalType = GoalType> = {
  [T in K]: {
    type: T;
  } & GoalFields<P>[T];
}[K];
export interface GoalTextOptions {
  enemyCount?: number | null;
}

export interface GoalPublishValidationContext {
  collectiblesPlaced: number;
  enemyCount: number;
  collectModeEnemyCount: number;
  npcInstanceIds?: string[];
}

export type RoomGoalTickResolution = 'collect_race_timeout' | 'time_up' | 'survival_clear' | 'npc_protected' | null;

interface GoalDefinitionBase<P extends GoalMarkerPoint, K extends GoalType> {
  label: string;
  markerKind: 'exit' | 'checkpoints' | 'npc_destination' | 'none';
  supportsTimeLimit: boolean;
  createDefault: () => Goal<P, K>;
  clone: (goal: Goal<P, K>) => Goal<P, K>;
  normalize: (raw: Record<string, unknown>) => Goal<P, K>;
  shortText: (goal: Goal<P, K>, options: GoalTextOptions) => string;
  introText: (goal: Goal<P, K>, options: GoalTextOptions) => string;
  validate: (goal: Goal<P, K>, context: GoalPublishValidationContext) => string | null;
  presentation: GoalPresentation<P, K>;
  markerDisplay: {
    editor: (goal: Goal<P, K>) => GoalFlagDescriptor<P>[];
    play: (goal: Goal<P, K>, facts: GoalFlagProgressFacts) => GoalFlagDescriptor<P>[];
  };
  roomTick: (goal: Goal<P, K>, elapsedMs: number) => RoomGoalTickResolution;
  roomScoring: {
    score: (goal: Goal<P, K>, context: RoomGoalScoreContext) => number;
    ranking: (goal: Goal<P, K>) => RoomGoalRankingPolicy;
  };
}

export type GoalDefinition<P extends GoalMarkerPoint, K extends GoalType> = GoalDefinitionBase<P, K> & (
  | {
    courseSupported: true;
    courseProgress: (goal: Goal<P, K>, facts: CourseGoalProgressFacts) => string;
    courseScoring: {
      score: (goal: Goal<P, K>, finish: GoalScoreMetrics) => number;
      ranking: (goal: Goal<P, K>) => GoalRankingMode;
    };
  }
  | { courseSupported: false; courseScoring: null; courseProgress: null }
);

export type GoalRegistry<P extends GoalMarkerPoint> = {
  [K in GoalType]: GoalDefinition<P, K>;
};

export interface GoalMarkerAdapter<P extends GoalMarkerPoint> {
  clone: (point: P) => P;
  normalize: (value: unknown) => P | null;
}

export function normalizeGoalPositiveInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value))
    return null;
  const rounded = Math.round(value);
  return rounded > 0 ? rounded : null;
}

export function cloneGoal<P extends GoalMarkerPoint, K extends GoalType>(goal: Goal<P, K>, registry: GoalRegistry<P>): Goal<P, K> {
  return registry[goal.type].clone(goal);
}

export function normalizeGoal<P extends GoalMarkerPoint, K extends GoalType>(value: unknown, registry: GoalRegistry<P>, allowedTypes: readonly K[]): Goal<P, K> | null {
  if (!value || typeof value !== 'object')
    return null;
  const raw = value as Record<string, unknown>;
  const type = raw.type;
  const allowed = (candidate: unknown): candidate is K => typeof candidate === 'string' && allowedTypes.some(key => key === candidate);
  return allowed(type) ? registry[type].normalize(raw) : null;
}

export function formatGoalShortText<P extends GoalMarkerPoint, K extends GoalType>(goal: Goal<P, K>, registry: GoalRegistry<P>, options: GoalTextOptions): string {
  return registry[goal.type].shortText(goal, options);
}

export function formatGoalIntroText<P extends GoalMarkerPoint, K extends GoalType>(goal: Goal<P, K>, registry: GoalRegistry<P>, options: GoalTextOptions): string {
  return registry[goal.type].introText(goal, options);
}

export function validateGoal<P extends GoalMarkerPoint, K extends GoalType>(goal: Goal<P, K>, registry: GoalRegistry<P>, context: GoalPublishValidationContext): string | null {
  return registry[goal.type].validate(goal, context);
}

export function scoreRoomGoal<P extends GoalMarkerPoint, K extends GoalType>(goal: Goal<P, K>, finish: GoalScoreMetrics, registry: GoalRegistry<P>): number {
  return registry[goal.type].roomScoring.score(goal, createRoomGoalScoreContext(finish));
}

export function roomGoalRankingPolicy<P extends GoalMarkerPoint, K extends GoalType>(goal: Goal<P, K>, registry: GoalRegistry<P>): RoomGoalRankingPolicy {
  return registry[goal.type].roomScoring.ranking(goal);
}

export function scoreCourseGoal<P extends GoalMarkerPoint, K extends GoalType>(goal: Goal<P, K>, finish: GoalScoreMetrics, registry: GoalRegistry<P>): number {
  const policy = registry[goal.type].courseScoring;
  if (!policy)
    throw new Error(`Goal ${goal.type} is not supported in courses.`);
  return policy.score(goal, finish);
}

export function courseGoalRankingMode<P extends GoalMarkerPoint, K extends GoalType>(goal: Goal<P, K>, registry: GoalRegistry<P>): GoalRankingMode {
  const policy = registry[goal.type].courseScoring;
  if (!policy)
    throw new Error(`Goal ${goal.type} is not supported in courses.`);
  return policy.ranking(goal);
}

export function formatGoalBadgeText<P extends GoalMarkerPoint, K extends GoalType>(goal: Goal<P, K>, registry: GoalRegistry<P>): string {
  return registry[goal.type].presentation.badge(goal);
}

export function formatGoalSelectedText<P extends GoalMarkerPoint, K extends GoalType>(goal: Goal<P, K>, registry: GoalRegistry<P>, enemyCount: number): string {
  return registry[goal.type].presentation.selected(goal, enemyCount);
}

export function formatRoomGoalProgressText<P extends GoalMarkerPoint, K extends GoalType>(goal: Goal<P, K>, registry: GoalRegistry<P>, facts: RoomGoalProgressFacts): string {
  return registry[goal.type].presentation.progress(goal, facts);
}

export function formatCourseGoalProgressText<P extends GoalMarkerPoint, K extends GoalType>(goal: Goal<P, K>, registry: GoalRegistry<P>, facts: CourseGoalProgressFacts): string {
  const progress = registry[goal.type].courseProgress;
  if (!progress)
    throw new Error(`Goal ${goal.type} is not supported in courses.`);
  return progress(goal, facts);
}

export function formatGoalTimerText<P extends GoalMarkerPoint, K extends GoalType>(goal: Goal<P, K>, registry: GoalRegistry<P>, elapsedMs: number, formatTimer: GoalTimerFormatter): string {
  return registry[goal.type].presentation.timer(goal, elapsedMs, formatTimer);
}

/** Eligibility, time advancement, suspension and side effects stay in the caller. */
export function resolveRoomGoalTick<P extends GoalMarkerPoint, K extends GoalType>(goal: Goal<P, K>, registry: GoalRegistry<P>, elapsedMs: number): RoomGoalTickResolution {
  return registry[goal.type].roomTick(goal, elapsedMs);
}

export function buildEditorGoalFlags<P extends GoalMarkerPoint, K extends GoalType>(goal: Goal<P, K>, registry: GoalRegistry<P>): GoalFlagDescriptor<P>[] {
  return registry[goal.type].markerDisplay.editor(goal);
}

export function buildPlayGoalFlags<P extends GoalMarkerPoint, K extends GoalType>(goal: Goal<P, K>, registry: GoalRegistry<P>, facts: GoalFlagProgressFacts): GoalFlagDescriptor<P>[] {
  return registry[goal.type].markerDisplay.play(goal, facts);
}

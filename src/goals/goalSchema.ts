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

export interface GoalDefinition<P extends GoalMarkerPoint, K extends GoalType> {
  label: string;
  courseSupported: boolean;
  markerKind: 'exit' | 'checkpoints' | 'npc_destination' | 'none';
  supportsTimeLimit: boolean;
  createDefault: () => Goal<P, K>;
  clone: (goal: Goal<P, K>) => Goal<P, K>;
  normalize: (raw: Record<string, unknown>) => Goal<P, K>;
  shortText: (goal: Goal<P, K>, options: GoalTextOptions) => string;
  introText: (goal: Goal<P, K>, options: GoalTextOptions) => string;
  validate: (goal: Goal<P, K>, context: GoalPublishValidationContext) => string | null;
}

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

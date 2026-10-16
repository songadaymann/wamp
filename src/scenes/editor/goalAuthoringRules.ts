import { ROOM_GOAL_DEFINITIONS } from '../../goals/roomGoals';
import type { Goal, GoalMarkerPoint, GoalType, NpcQuestType } from '../../goals/goalSchema';

export type GoalPlacementMode = 'exit' | 'checkpoint' | 'finish' | 'npc' | 'npc_destination' | null;
export interface RoomGoalSummaryContext {
  collectiblesPlaced: number;
  enemiesPlaced: number;
  collectModeEnemyCount: number;
  linkedNpcLabel: string;
}

interface GoalAuthoringFields {
  timeLimitSeconds: string | null;
  requiredCount: string | null;
  durationSeconds: string | null;
  npcQuestType: NpcQuestType | null;
  exit: 'hidden' | 'missing' | 'placed';
  checkpoints: boolean;
  finish: 'hidden' | 'missing' | 'placed';
  npcDestination: boolean;
}
export const EMPTY_GOAL_AUTHORING_FIELDS: GoalAuthoringFields = {
  timeLimitSeconds: null, requiredCount: null, durationSeconds: null, npcQuestType: null,
  exit: 'hidden', checkpoints: false, finish: 'hidden', npcDestination: false,
};
interface GoalAuthoringRule<K extends GoalType> {
  fields: (goal: Goal<GoalMarkerPoint, K>) => GoalAuthoringFields;
  usesMarkers: boolean;
  timeLimit: (goal: Goal<GoalMarkerPoint, K>, seconds: number | null) => void;
  requiredCount: (goal: Goal<GoalMarkerPoint, K>, count: number) => void;
  duration: (goal: Goal<GoalMarkerPoint, K>, seconds: number) => void;
  questType: (goal: Goal<GoalMarkerPoint, K>, questType: NpcQuestType) => void;
  clearMarkers: (goal: Goal<GoalMarkerPoint, K>) => void;
  placeMarker: (goal: Goal<GoalMarkerPoint, K>, mode: Exclude<GoalPlacementMode, null>, point: GoalMarkerPoint, npcId: string | null) => boolean | null;
  removeMarker: (goal: Goal<GoalMarkerPoint, K>, x: number, y: number) => Goal<GoalMarkerPoint, K> | null;
  summary: (goal: Goal<GoalMarkerPoint, K>, context: RoomGoalSummaryContext) => string;
}

export type GoalAuthoringRegistry = { [K in GoalType]: GoalAuthoringRule<K> };
const noFieldEdits = {
  timeLimit: () => {},
  requiredCount: () => {},
  duration: () => {},
  questType: () => {},
};
const noMarkerEdits = {
  usesMarkers: false,
  clearMarkers: () => {},
  placeMarker: () => null,
  removeMarker: () => null,
};
const timeLimitSeconds = (goal: { timeLimitMs: number | null }): string => goal.timeLimitMs ? String(Math.round(goal.timeLimitMs / 1000)) : '';
const timeLimit = (goal: { timeLimitMs: number | null }, seconds: number | null): void => {
  goal.timeLimitMs = seconds && seconds > 0 ? Math.round(seconds * 1000) : null;
};
const requiredCount = (goal: { requiredCount: number }, count: number): void => {
  goal.requiredCount = Math.max(1, Math.round(count));
};
const duration = (goal: { durationMs: number }, seconds: number): void => {
  goal.durationMs = Math.max(1, Math.round(seconds)) * 1000;
};
const near = (point: GoalMarkerPoint | null, x: number, y: number): boolean =>
  Boolean(point && Math.hypot(point.x - x, point.y - y) < 16);

/** Edits receive an owned clone; removal clones only a hit. Every new goal chooses its editor behavior here. */
export const GOAL_AUTHORING_RULES: GoalAuthoringRegistry = {
  reach_exit: {
    fields: goal => ({ ...EMPTY_GOAL_AUTHORING_FIELDS, timeLimitSeconds: timeLimitSeconds(goal), exit: goal.exit ? 'placed' : 'missing' }),
    ...noFieldEdits,
    timeLimit,
    usesMarkers: true,
    clearMarkers: goal => { goal.exit = null; },
    placeMarker: (goal, mode, point) => {
      if (mode !== 'exit') return null;
      goal.exit = { ...point };
      return true;
    },
    removeMarker: (goal, x, y) => {
      if (!near(goal.exit, x, y)) return null;
      const copy = ROOM_GOAL_DEFINITIONS.reach_exit.clone(goal);
      copy.exit = null;
      return copy;
    },
    summary: goal => goal.exit ? 'Reach the exit marker to clear the room.' : 'Set an exit marker to finish the room.',
  },
  collect_target: {
    fields: goal => ({ ...EMPTY_GOAL_AUTHORING_FIELDS, timeLimitSeconds: timeLimitSeconds(goal), requiredCount: String(goal.requiredCount) }),
    ...noFieldEdits, ...noMarkerEdits,
    timeLimit, requiredCount,
    summary: (goal, context) => `Collect ${goal.requiredCount} item${goal.requiredCount === 1 ? '' : 's'} (${context.collectiblesPlaced} placed).`,
  },
  collect_race: {
    fields: goal => ({ ...EMPTY_GOAL_AUTHORING_FIELDS, timeLimitSeconds: timeLimitSeconds(goal) }),
    ...noFieldEdits, ...noMarkerEdits,
    timeLimit,
    summary: (_goal, context) => `Collect more items than the Sword Hunter (${context.collectiblesPlaced} collectibles, ${context.collectModeEnemyCount} collector${context.collectModeEnemyCount === 1 ? '' : 's'}).`,
  },
  defeat_all: {
    fields: goal => ({ ...EMPTY_GOAL_AUTHORING_FIELDS, timeLimitSeconds: timeLimitSeconds(goal) }),
    ...noFieldEdits, ...noMarkerEdits,
    timeLimit,
    summary: (_goal, context) => `Defeat every enemy in the room (${context.enemiesPlaced} placed).`,
  },
  checkpoint_sprint: {
    fields: goal => ({ ...EMPTY_GOAL_AUTHORING_FIELDS, timeLimitSeconds: timeLimitSeconds(goal), checkpoints: true, finish: goal.finish ? 'placed' : 'missing' }),
    ...noFieldEdits,
    timeLimit,
    usesMarkers: true,
    clearMarkers: goal => { goal.checkpoints = []; goal.finish = null; },
    placeMarker: (goal, mode, point) => {
      if (mode === 'checkpoint') {
        goal.checkpoints = [...goal.checkpoints, { ...point }];
        return false;
      }
      if (mode !== 'finish') return null;
      goal.finish = { ...point };
      return true;
    },
    removeMarker: (goal, x, y) => {
      // Finish wins even when a checkpoint is nearer. Equal-distance checkpoints keep their order.
      if (near(goal.finish, x, y)) {
        const copy = ROOM_GOAL_DEFINITIONS.checkpoint_sprint.clone(goal);
        copy.finish = null;
        return copy;
      }
      let bestIndex = -1;
      let bestDistance = 16;
      goal.checkpoints.forEach((point, index) => {
        const distance = Math.hypot(point.x - x, point.y - y);
        if (distance < bestDistance) { bestDistance = distance; bestIndex = index; }
      });
      if (bestIndex < 0) return null;
      const copy = ROOM_GOAL_DEFINITIONS.checkpoint_sprint.clone(goal);
      copy.checkpoints.splice(bestIndex, 1);
      return copy;
    },
    summary: goal => `Hit ${goal.checkpoints.length} checkpoint${goal.checkpoints.length === 1 ? '' : 's'} then reach the finish marker.`,
  },
  survival: {
    fields: goal => ({ ...EMPTY_GOAL_AUTHORING_FIELDS, durationSeconds: String(Math.round(goal.durationMs / 1000)) }),
    ...noFieldEdits, ...noMarkerEdits,
    duration,
    summary: goal => `Stay alive for ${Math.round(goal.durationMs / 1000)} seconds.`,
  },
  npc_quest: {
    fields: goal => ({
      ...EMPTY_GOAL_AUTHORING_FIELDS,
      requiredCount: goal.questType === 'give' ? String(goal.requiredCount) : null,
      durationSeconds: goal.questType === 'protect' ? String(Math.round(goal.durationMs / 1000)) : null,
      npcQuestType: goal.questType,
      npcDestination: goal.questType === 'escort',
    }),
    ...noFieldEdits,
    requiredCount: (goal, count) => { if (goal.questType === 'give') requiredCount(goal, count); },
    duration: (goal, seconds) => { if (goal.questType === 'protect') duration(goal, seconds); },
    questType: (goal, questType) => { goal.questType = questType; },
    usesMarkers: true,
    clearMarkers: goal => { goal.npcInstanceId = null; goal.destination = null; },
    placeMarker: (goal, mode, point, npcId) => {
      if (mode === 'npc' && npcId) { goal.npcInstanceId = npcId; return true; }
      if (mode === 'npc_destination') { goal.destination = { ...point }; return true; }
      return null;
    },
    removeMarker: (goal, x, y) => {
      if (!near(goal.destination, x, y)) return null;
      const copy = ROOM_GOAL_DEFINITIONS.npc_quest.clone(goal);
      copy.destination = null;
      return copy;
    },
    summary: (goal, context) => {
      if (goal.questType === 'protect') return `Protect ${context.linkedNpcLabel} for ${Math.round(goal.durationMs / 1000)} seconds.`;
      if (goal.questType === 'escort') return `Escort ${context.linkedNpcLabel} to ${goal.destination ? 'the destination' : 'a destination you still need to place'}.`;
      return `Collect ${goal.requiredCount} item${goal.requiredCount === 1 ? '' : 's'}, then return to ${context.linkedNpcLabel}.`;
    },
  },
};

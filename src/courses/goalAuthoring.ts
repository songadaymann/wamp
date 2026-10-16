import { buildEditorGoalFlags, type Goal } from '../goals/goalSchema';
import { COURSE_GOAL_DEFINITIONS, type CourseGoalType, type CourseMarkerPoint, type CourseSnapshot } from './model';

export type ExpandedGoalMarkerMode = 'start' | 'exit' | 'checkpoint' | 'finish' | 'npc' | 'npc_destination';
type ExpandedGoal<K extends CourseGoalType> = Goal<CourseMarkerPoint, K>;
interface NumericFields { timeLimitMs: number | null; requiredCount: number | null; durationMs: number | null; }
interface ExpandedGoalAuthoringRule<K extends CourseGoalType> {
  requiredCountEditable: boolean;
  durationEditable: boolean;
  fields: (goal: ExpandedGoal<K>) => NumericFields;
  timeLimit: (goal: ExpandedGoal<K>, value: number | null) => boolean;
  requiredCount: (goal: ExpandedGoal<K>, value: number) => boolean;
  duration: (goal: ExpandedGoal<K>, value: number) => boolean;
  clearMarkers: (goal: ExpandedGoal<K>) => void;
  placeMarker: (goal: ExpandedGoal<K>, mode: ExpandedGoalMarkerMode, point: CourseMarkerPoint) => boolean;
  removeMarker: (goal: ExpandedGoal<K>, roomId: string, x: number, y: number) => boolean;
  finish: (goal: ExpandedGoal<K>) => CourseMarkerPoint | null;
  checkpoints: (goal: ExpandedGoal<K>) => readonly CourseMarkerPoint[];
  moveCheckpoint: (goal: ExpandedGoal<K>, index: number, direction: -1 | 1) => void;
  removeCheckpoint: (goal: ExpandedGoal<K>, index: number) => void;
  finishLabel: 'EXIT' | 'FINISH' | null;
  cellFinishLabel: 'FINISH' | null;
  cellSummary: (goal: ExpandedGoal<K>, startSet: boolean, collectiblesPlaced?: number) => string[];
  composerSummary: (goal: ExpandedGoal<K>, startSet: boolean) => string[];
  setupError: (goal: ExpandedGoal<K>) => string | null;
  roomRemovalReason: (goal: ExpandedGoal<K>, roomId: string) => string | null;
}
export type ExpandedGoalAuthoringRegistry = { [K in CourseGoalType]: ExpandedGoalAuthoringRule<K> };
const EMPTY_POINTS: readonly CourseMarkerPoint[] = [];
const noFieldEdits = { requiredCountEditable: false, durationEditable: false, timeLimit: () => false, requiredCount: () => false, duration: () => false };
const noMarkers = {
  clearMarkers: () => {}, placeMarker: () => false, removeMarker: () => false,
  finish: () => null, checkpoints: () => EMPTY_POINTS, moveCheckpoint: () => {}, removeCheckpoint: () => {},
  finishLabel: null, cellFinishLabel: null, setupError: () => null, roomRemovalReason: () => null,
};
const editTime = (goal: { timeLimitMs: number | null }, value: number | null): boolean => {
  if (!('timeLimitMs' in goal)) return false;
  goal.timeLimitMs = value; return true;
};
const editCount = (goal: { requiredCount: number }, value: number): boolean => { goal.requiredCount = value; return true; };
const editDuration = (goal: { durationMs: number }, value: number): boolean => { goal.durationMs = value; return true; };
const near = (point: CourseMarkerPoint | null, roomId: string, x: number, y: number): boolean =>
  Boolean(point && point.roomId === roomId && Math.hypot(point.x - x, point.y - y) < 16);
const missingExit = 'Expanded room goal is authored in Edit Expanded Room. Open Edit Expanded Room to place an exit marker.';
const missingCheckpoint = 'Expanded room goal is authored in Edit Expanded Room. Open Edit Expanded Room to add at least one checkpoint first.';
const missingFinish = 'Expanded room goal is authored in Edit Expanded Room. Open Edit Expanded Room to place a finish marker.';
const exitSummary = (goal: ExpandedGoal<'reach_exit'>, start: boolean): string[] => ['Reach Exit', start ? 'start set' : 'start missing', goal.exit ? 'exit set' : 'exit missing'];
const sprintSummary = (goal: ExpandedGoal<'checkpoint_sprint'>, start: boolean): string[] => ['Checkpoint Sprint', start ? 'start set' : 'start missing', `${goal.checkpoints.length} checkpoint${goal.checkpoints.length === 1 ? '' : 's'}`, goal.finish ? 'finish set' : 'finish missing'];

/** Values are already normalized by each editor surface; their rounding rules intentionally differ. */
export const EXPANDED_GOAL_AUTHORING_RULES: ExpandedGoalAuthoringRegistry = {
  reach_exit: {
    ...noFieldEdits, ...noMarkers,
    fields: goal => ({ timeLimitMs: goal.timeLimitMs, requiredCount: null, durationMs: null }),
    timeLimit: editTime,
    clearMarkers: goal => { goal.exit = null; },
    placeMarker: (goal, mode, point) => { if (mode !== 'exit') return false; goal.exit = point; return true; },
    removeMarker: (goal, roomId, x, y) => { if (!near(goal.exit, roomId, x, y)) return false; goal.exit = null; return true; },
    finish: goal => goal.exit,
    finishLabel: 'EXIT',
    cellSummary: exitSummary, composerSummary: exitSummary,
    setupError: goal => goal.exit ? null : missingExit,
    roomRemovalReason: (goal, roomId) => goal.exit?.roomId === roomId ? 'Remove the expanded room exit marker first.' : null,
  },
  collect_target: {
    ...noFieldEdits, ...noMarkers,
    requiredCountEditable: true,
    fields: goal => ({ timeLimitMs: goal.timeLimitMs, requiredCount: goal.requiredCount, durationMs: null }),
    timeLimit: editTime, requiredCount: editCount,
    cellSummary: (goal, _start, count) => [`Collect Target · ${goal.requiredCount} required${typeof count === 'number' ? ` (${count} placed)` : ''}`],
    composerSummary: goal => [`Collect ${goal.requiredCount}`],
  },
  defeat_all: {
    ...noFieldEdits, ...noMarkers,
    fields: goal => ({ timeLimitMs: goal.timeLimitMs, requiredCount: null, durationMs: null }),
    timeLimit: editTime,
    cellSummary: () => ['Defeat All'], composerSummary: () => ['Defeat All'],
  },
  checkpoint_sprint: {
    ...noFieldEdits, ...noMarkers,
    fields: goal => ({ timeLimitMs: goal.timeLimitMs, requiredCount: null, durationMs: null }),
    timeLimit: editTime,
    clearMarkers: goal => { goal.checkpoints = []; goal.finish = null; },
    placeMarker: (goal, mode, point) => {
      if (mode === 'checkpoint') { goal.checkpoints = [...goal.checkpoints, point]; return true; }
      if (mode === 'finish') { goal.finish = point; return true; }
      return false;
    },
    removeMarker: (goal, roomId, x, y) => {
      if (near(goal.finish, roomId, x, y)) { goal.finish = null; return true; }
      // Cell editing removes the first matching checkpoint, even when a later one is nearer.
      const index = goal.checkpoints.findIndex(point => near(point, roomId, x, y));
      if (index < 0) return false;
      goal.checkpoints.splice(index, 1); return true;
    },
    finish: goal => goal.finish,
    checkpoints: goal => goal.checkpoints,
    moveCheckpoint: (goal, index, direction) => {
      const nextIndex = Math.max(0, Math.min(goal.checkpoints.length - 1, index + direction));
      if (nextIndex === index) return;
      const points = [...goal.checkpoints];
      const [moved] = points.splice(index, 1); points.splice(nextIndex, 0, moved); goal.checkpoints = points;
    },
    removeCheckpoint: (goal, index) => { goal.checkpoints = goal.checkpoints.filter((_point, i) => i !== index); },
    finishLabel: 'FINISH', cellFinishLabel: 'FINISH',
    cellSummary: sprintSummary, composerSummary: sprintSummary,
    setupError: goal => !goal.checkpoints.length ? missingCheckpoint : goal.finish ? null : missingFinish,
    roomRemovalReason: (goal, roomId) => goal.finish?.roomId === roomId ? 'Remove the finish marker first.' : goal.checkpoints.some(point => point.roomId === roomId) ? 'Remove checkpoints in this room first.' : null,
  },
  survival: {
    ...noFieldEdits, ...noMarkers,
    durationEditable: true,
    fields: goal => ({ timeLimitMs: null, requiredCount: null, durationMs: goal.durationMs }),
    duration: editDuration,
    cellSummary: goal => [`Survival · ${Math.max(1, Math.round(goal.durationMs / 1000))}s`],
    composerSummary: goal => [`Survival ${Math.max(1, Math.round(goal.durationMs / 1000))}s`],
  },
};

export function getExpandedGoalAuthoringFields<K extends CourseGoalType>(goal: ExpandedGoal<K> | null) {
  if (!goal) return { timeLimitEditable: false, requiredCountEditable: false, durationEditable: false, usesMarkers: false, exitEditable: false, checkpointsEditable: false, timeLimitMs: null, requiredCount: null, durationMs: null };
  const rule = EXPANDED_GOAL_AUTHORING_RULES[goal.type];
  const markerKind = COURSE_GOAL_DEFINITIONS[goal.type].markerKind;
  return { timeLimitEditable: COURSE_GOAL_DEFINITIONS[goal.type].supportsTimeLimit, requiredCountEditable: rule.requiredCountEditable, durationEditable: rule.durationEditable, usesMarkers: markerKind === 'exit' || markerKind === 'checkpoints', exitEditable: markerKind === 'exit', checkpointsEditable: markerKind === 'checkpoints', ...rule.fields(goal) };
}
export function setExpandedGoalTimeLimit<K extends CourseGoalType>(goal: ExpandedGoal<K> | null, value: number | null): boolean {
  return goal ? EXPANDED_GOAL_AUTHORING_RULES[goal.type].timeLimit(goal, value) : false;
}
export function setExpandedGoalRequiredCount<K extends CourseGoalType>(goal: ExpandedGoal<K> | null, value: number): boolean {
  return goal ? EXPANDED_GOAL_AUTHORING_RULES[goal.type].requiredCount(goal, value) : false;
}
export function setExpandedGoalDuration<K extends CourseGoalType>(goal: ExpandedGoal<K> | null, value: number): boolean {
  return goal ? EXPANDED_GOAL_AUTHORING_RULES[goal.type].duration(goal, value) : false;
}
export function clearExpandedGoalMarkers<K extends CourseGoalType>(goal: ExpandedGoal<K> | null): void {
  if (goal) EXPANDED_GOAL_AUTHORING_RULES[goal.type].clearMarkers(goal);
}
export function placeExpandedGoalMarker<K extends CourseGoalType>(goal: ExpandedGoal<K> | null, mode: ExpandedGoalMarkerMode, point: CourseMarkerPoint): boolean {
  return goal ? EXPANDED_GOAL_AUTHORING_RULES[goal.type].placeMarker(goal, mode, point) : false;
}
export function removeExpandedGoalMarker<K extends CourseGoalType>(goal: ExpandedGoal<K>, roomId: string, x: number, y: number): boolean {
  return EXPANDED_GOAL_AUTHORING_RULES[goal.type].removeMarker(goal, roomId, x, y);
}
export function getExpandedGoalFinish<K extends CourseGoalType>(goal: ExpandedGoal<K> | null): CourseMarkerPoint | null {
  return goal ? EXPANDED_GOAL_AUTHORING_RULES[goal.type].finish(goal) : null;
}
export function getExpandedGoalCheckpoints<K extends CourseGoalType>(goal: ExpandedGoal<K> | null): readonly CourseMarkerPoint[] {
  return goal ? EXPANDED_GOAL_AUTHORING_RULES[goal.type].checkpoints(goal) : EMPTY_POINTS;
}
export function moveExpandedGoalCheckpoint<K extends CourseGoalType>(goal: ExpandedGoal<K> | null, index: number, direction: -1 | 1): void {
  if (goal) EXPANDED_GOAL_AUTHORING_RULES[goal.type].moveCheckpoint(goal, index, direction);
}
export function removeExpandedGoalCheckpoint<K extends CourseGoalType>(goal: ExpandedGoal<K> | null, index: number): void {
  if (goal) EXPANDED_GOAL_AUTHORING_RULES[goal.type].removeCheckpoint(goal, index);
}
export function expandedGoalSetupError<K extends CourseGoalType>(goal: ExpandedGoal<K>): string | null {
  return EXPANDED_GOAL_AUTHORING_RULES[goal.type].setupError(goal);
}
export function expandedGoalRoomRemovalReason<K extends CourseGoalType>(goal: ExpandedGoal<K> | null, roomId: string): string | null {
  return goal ? EXPANDED_GOAL_AUTHORING_RULES[goal.type].roomRemovalReason(goal, roomId) : null;
}
export function expandedGoalSummaryParts<K extends CourseGoalType>(goal: ExpandedGoal<K>, startSet: boolean, surface: 'cell' | 'composer', count?: number): string[] {
  return surface === 'cell' ? EXPANDED_GOAL_AUTHORING_RULES[goal.type].cellSummary(goal, startSet, count) : EXPANDED_GOAL_AUTHORING_RULES[goal.type].composerSummary(goal, startSet);
}
export interface ExpandedEditorMarker { point: CourseMarkerPoint; label: string | null; finish: boolean; }
function goalEditorMarkers<K extends CourseGoalType>(goal: ExpandedGoal<K>, surface: 'cell' | 'canvas'): ExpandedEditorMarker[] {
  const rule = EXPANDED_GOAL_AUTHORING_RULES[goal.type];
  return buildEditorGoalFlags(goal, COURSE_GOAL_DEFINITIONS).map(flag => ({ point: flag.point, label: flag.variant === 'finish-pending' ? surface === 'cell' ? rule.cellFinishLabel : rule.finishLabel : flag.label, finish: flag.variant === 'finish-pending' }));
}
export function buildExpandedEditorMarkers(draft: CourseSnapshot | null, surface: 'cell' | 'canvas'): ExpandedEditorMarker[] {
  if (!draft?.goal) return [];
  return [ ...(draft.startPoint ? [{ point: draft.startPoint, label: 'START', finish: false }] : []), ...goalEditorMarkers(draft.goal, surface) ];
}

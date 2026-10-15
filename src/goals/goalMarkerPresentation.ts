import type { GoalMarkerPoint } from './goalSchema';
import type { GoalMarkerFlagVariant } from './markerFlags';

/** Local goal coordinates; scene owners retain room-to-world conversion and sprites. */
export interface GoalFlagDescriptor<P extends GoalMarkerPoint> {
  point: P;
  label: string | null;
  variant: GoalMarkerFlagVariant;
  textColor: string;
  alpha?: number;
}
export interface GoalFlagProgressFacts {
  readonly result: string;
  readonly nextCheckpointIndex: number;
}
export function finishGoalFlag<P extends GoalMarkerPoint>(point: P, completed: boolean, label: string | null = null): GoalFlagDescriptor<P> {
  return { point, label, variant: completed ? 'finish-cleared' : 'finish-pending', textColor: completed ? '#f6e6a6' : '#ffefef' };
}
export function editorCheckpointFlags<P extends GoalMarkerPoint>(checkpoints: readonly P[], finish: P | null): GoalFlagDescriptor<P>[] {
  return [
    ...checkpoints.map((point, index): GoalFlagDescriptor<P> => ({ point, label: `${index + 1}`, variant: 'checkpoint-pending', textColor: '#ffefef' })),
    ...(finish ? [finishGoalFlag(finish, false)] : []),
  ];
}
export function playCheckpointFlags<P extends GoalMarkerPoint>(checkpoints: readonly P[], finish: P | null, facts: GoalFlagProgressFacts): GoalFlagDescriptor<P>[] {
  return [
    ...checkpoints.map((point, index): GoalFlagDescriptor<P> => {
      const reached = index < facts.nextCheckpointIndex;
      return { point, label: `${index + 1}`, variant: reached ? 'checkpoint-reached' : 'checkpoint-pending', textColor: reached ? '#a9ffd0' : '#ffefef', alpha: reached ? 0.55 : undefined };
    }),
    ...(finish ? [finishGoalFlag(finish, facts.result === 'completed')] : []),
  ];
}

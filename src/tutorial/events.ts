import type { ActiveSignState } from '../scenes/overworld/signPosts';
import type { RoomCoordinates, RoomSnapshot } from '../persistence/roomModel';
import type { TutorialSceneContext } from './model';

export const TUTORIAL_EDITOR_MUTATION_EVENT = 'tutorial-editor-mutation';
export const TUTORIAL_PLAYTEST_REQUESTED_EVENT = 'tutorial-playtest-requested';
export const TUTORIAL_PLAYTEST_CANCELLED_EVENT = 'tutorial-playtest-cancelled';
export const TUTORIAL_ROOM_GOAL_COMPLETED_EVENT = 'tutorial-room-goal-completed';
export const TUTORIAL_ACTIVE_SIGN_CHANGED_EVENT = 'tutorial-active-sign-changed';
export const TUTORIAL_CLAIM_REQUESTED_EVENT = 'tutorial-claim-requested';

export interface TutorialEditorMutationDetail {
  context: TutorialSceneContext;
  snapshot: RoomSnapshot;
  reason: 'mutation' | 'playtest' | 'leave_editor';
}

export interface TutorialPlaytestDetail {
  context: TutorialSceneContext;
  snapshot: RoomSnapshot;
}

export interface TutorialPlaytestCancelledDetail {
  context: TutorialSceneContext;
}

export interface TutorialRoomGoalCompletedDetail {
  context: TutorialSceneContext;
  roomId: string;
  roomCoordinates: RoomCoordinates;
  goalType: string;
}

export interface TutorialActiveSignChangedDetail {
  context: TutorialSceneContext;
  sign: ActiveSignState | null;
}

export interface TutorialClaimRequestedDetail {
  context: TutorialSceneContext;
  coordinates: RoomCoordinates;
}

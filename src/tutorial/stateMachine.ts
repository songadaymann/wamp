import {
  getTutorialTerminalStatus,
  type TutorialProgressV1,
  type TutorialStage,
} from './model';

export type TutorialTransitionEvent =
  | 'BEGIN'
  | 'DREAM_FINISHED'
  | 'WAKE_FINISHED'
  | 'BRIDGE_SIGN_REACHED'
  | 'OPEN_BRIDGE_EDITOR'
  | 'BEGIN_PLAYTEST'
  | 'CANCEL_PLAYTEST'
  | 'COMPLETE_PLAYTEST'
  | 'BEGIN_CREATIVE_EDIT'
  | 'RESTORE_BRIDGE'
  | 'CONTINUE_TO_CLAIM'
  | 'CLAIM_SUCCEEDED'
  | 'DISMISS'
  | 'REPLAY'
  | 'RESUME_INTERRUPTED_PLAYTEST';

const LEGAL_TRANSITIONS: Readonly<Record<TutorialStage, Partial<Record<TutorialTransitionEvent, TutorialStage>>>> = {
  dream: {
    BEGIN: 'dream',
    DREAM_FINISHED: 'wake',
    DISMISS: 'dismissed',
    REPLAY: 'dream',
  },
  wake: {
    WAKE_FINISHED: 'room_traversal',
    DISMISS: 'dismissed',
    REPLAY: 'dream',
  },
  room_traversal: {
    BRIDGE_SIGN_REACHED: 'bridge_prompt',
    DISMISS: 'dismissed',
    REPLAY: 'dream',
  },
  bridge_prompt: {
    OPEN_BRIDGE_EDITOR: 'bridge_edit',
    DISMISS: 'dismissed',
    REPLAY: 'dream',
  },
  bridge_edit: {
    BEGIN_PLAYTEST: 'bridge_playtest',
    DISMISS: 'dismissed',
    REPLAY: 'dream',
  },
  bridge_playtest: {
    CANCEL_PLAYTEST: 'bridge_edit',
    COMPLETE_PLAYTEST: 'bridge_complete',
    RESUME_INTERRUPTED_PLAYTEST: 'bridge_edit',
    DISMISS: 'dismissed',
    REPLAY: 'dream',
  },
  bridge_complete: {
    BEGIN_CREATIVE_EDIT: 'creative_edit',
    CONTINUE_TO_CLAIM: 'awaiting_claim',
    DISMISS: 'dismissed',
    REPLAY: 'dream',
  },
  creative_edit: {
    RESTORE_BRIDGE: 'bridge_complete',
    CONTINUE_TO_CLAIM: 'awaiting_claim',
    DISMISS: 'dismissed',
    REPLAY: 'dream',
  },
  awaiting_claim: {
    CLAIM_SUCCEEDED: 'completed',
    DISMISS: 'dismissed',
    REPLAY: 'dream',
  },
  completed: {
    REPLAY: 'dream',
  },
  dismissed: {
    REPLAY: 'dream',
  },
};

export class IllegalTutorialTransitionError extends Error {
  constructor(stage: TutorialStage, event: TutorialTransitionEvent) {
    super(`Illegal tutorial transition: ${stage} + ${event}`);
    this.name = 'IllegalTutorialTransitionError';
  }
}

export function getNextTutorialStage(
  stage: TutorialStage,
  event: TutorialTransitionEvent,
): TutorialStage {
  const next = LEGAL_TRANSITIONS[stage][event];
  if (!next) {
    throw new IllegalTutorialTransitionError(stage, event);
  }
  return next;
}

export function transitionTutorialProgress(
  progress: TutorialProgressV1,
  event: TutorialTransitionEvent,
  nowIso: string = new Date().toISOString(),
): TutorialProgressV1 {
  const stage = getNextTutorialStage(progress.stage, event);
  return {
    ...progress,
    stage,
    terminalStatus: getTutorialTerminalStatus(stage),
    updatedAt: nowIso,
  };
}

export function canTransitionTutorial(
  stage: TutorialStage,
  event: TutorialTransitionEvent,
): boolean {
  return Boolean(LEGAL_TRANSITIONS[stage][event]);
}

import { describe, expect, it } from 'vitest';
import { TUTORIAL_TEMPLATE_VERSIONS } from './config';
import { createEmptyCreativeChecklist, type TutorialProgressV1 } from './model';
import {
  IllegalTutorialTransitionError,
  transitionTutorialProgress,
  type TutorialTransitionEvent,
} from './stateMachine';

function progress(stage: TutorialProgressV1['stage'] = 'dream'): TutorialProgressV1 {
  return {
    version: 1,
    sessionId: 'session-test',
    stage,
    templateVersions: { ...TUTORIAL_TEMPLATE_VERSIONS },
    workingSnapshot: null,
    bridgeBackupSnapshot: null,
    creativeChecklist: createEmptyCreativeChecklist(),
    selectedClaimCoordinates: null,
    terminalStatus: stage === 'completed' ? 'completed' : stage === 'dismissed' ? 'dismissed' : 'active',
    updatedAt: '2026-08-14T12:00:00.000Z',
  };
}

describe('tutorial state machine', () => {
  it('covers the mandatory bridge route through a successful claim', () => {
    const events: TutorialTransitionEvent[] = [
      'DREAM_FINISHED',
      'WAKE_FINISHED',
      'BRIDGE_SIGN_REACHED',
      'OPEN_BRIDGE_EDITOR',
      'BEGIN_PLAYTEST',
      'COMPLETE_PLAYTEST',
      'CONTINUE_TO_CLAIM',
      'CLAIM_SUCCEEDED',
    ];
    const stages = events.reduce<string[]>((result, event) => {
      const current = transitionTutorialProgress(
        progress(result.at(-1) as TutorialProgressV1['stage'] ?? 'dream'),
        event,
      );
      result.push(current.stage);
      return result;
    }, ['dream']);
    expect(stages).toEqual([
      'dream',
      'wake',
      'room_traversal',
      'bridge_prompt',
      'bridge_edit',
      'bridge_playtest',
      'bridge_complete',
      'awaiting_claim',
      'completed',
    ]);
  });

  it('covers cancel, creative reset, restore, resume, skip, and replay transitions', () => {
    expect(transitionTutorialProgress(progress('bridge_playtest'), 'CANCEL_PLAYTEST').stage)
      .toBe('bridge_edit');
    expect(transitionTutorialProgress(progress('bridge_playtest'), 'RESUME_INTERRUPTED_PLAYTEST').stage)
      .toBe('bridge_edit');
    expect(transitionTutorialProgress(progress('bridge_complete'), 'BEGIN_CREATIVE_EDIT').stage)
      .toBe('creative_edit');
    expect(transitionTutorialProgress(progress('creative_edit'), 'RESTORE_BRIDGE').stage)
      .toBe('bridge_complete');
    expect(transitionTutorialProgress(progress('creative_edit'), 'CONTINUE_TO_CLAIM').stage)
      .toBe('awaiting_claim');
    expect(transitionTutorialProgress(progress('wake'), 'DISMISS').terminalStatus)
      .toBe('dismissed');
    expect(transitionTutorialProgress(progress('completed'), 'REPLAY').stage)
      .toBe('dream');
    expect(transitionTutorialProgress(progress('dismissed'), 'REPLAY').terminalStatus)
      .toBe('active');
  });

  it('rejects transitions that skip required stages', () => {
    expect(() => transitionTutorialProgress(progress('dream'), 'CLAIM_SUCCEEDED'))
      .toThrow(IllegalTutorialTransitionError);
    expect(() => transitionTutorialProgress(progress('bridge_edit'), 'CONTINUE_TO_CLAIM'))
      .toThrow(IllegalTutorialTransitionError);
  });
});

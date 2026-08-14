import { describe, expect, it } from 'vitest';
import { TUTORIAL_TEMPLATE_VERSIONS } from './config';
import { buildTutorialCoachmark } from './coachmarks';
import { createEmptyCreativeChecklist, type TutorialProgressV1 } from './model';

function awaitingClaimProgress(selected = true): TutorialProgressV1 {
  return {
    version: 1,
    sessionId: 'session-1',
    stage: 'awaiting_claim',
    templateVersions: { ...TUTORIAL_TEMPLATE_VERSIONS },
    workingSnapshot: null,
    bridgeBackupSnapshot: null,
    creativeChecklist: createEmptyCreativeChecklist(),
    selectedClaimCoordinates: selected ? { x: 4, y: 5 } : null,
    terminalStatus: 'active',
    updatedAt: '2026-08-14T12:00:00.000Z',
  };
}

describe('tutorial account-creation coachmark', () => {
  it('asks a signed-out claimant to create an account in the tutorial panel', () => {
    const model = buildTutorialCoachmark(awaitingClaimProgress(), {
      accountCreation: { email: '', state: 'idle' },
    });

    expect(model).toMatchObject({
      title: 'Create your WAMP account',
      accountCreation: { state: 'idle' },
    });
    expect(model?.body).toContain('bring you back');
  });

  it('explains the email round trip after the link is sent', () => {
    const model = buildTutorialCoachmark(awaitingClaimProgress(), {
      accountCreation: { email: 'player@example.com', state: 'sent' },
    });

    expect(model).toMatchObject({ title: 'Check your email' });
    expect(model?.body).toContain('player@example.com');
    expect(model?.body).toContain('your room will still be waiting');
  });

  it('keeps the ordinary frontier chooser before a room has been selected', () => {
    const model = buildTutorialCoachmark(awaitingClaimProgress(false));
    expect(model).toMatchObject({ title: 'Choose where this dream will wake' });
    expect(model?.accountCreation).toBeUndefined();
  });
});

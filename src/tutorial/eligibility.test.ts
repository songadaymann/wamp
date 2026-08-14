import { describe, expect, it } from 'vitest';
import { TUTORIAL_TEMPLATE_VERSIONS } from './config';
import { createEmptyCreativeChecklist, type TutorialProgressV1 } from './model';
import { decideTutorialEligibility, tutorialReplayForced } from './eligibility';

function progress(terminalStatus: TutorialProgressV1['terminalStatus']): TutorialProgressV1 {
  return {
    version: 1,
    sessionId: 'session',
    stage: terminalStatus === 'active' ? 'bridge_edit' : terminalStatus,
    templateVersions: { ...TUTORIAL_TEMPLATE_VERSIONS },
    workingSnapshot: null,
    bridgeBackupSnapshot: null,
    creativeChecklist: createEmptyCreativeChecklist(),
    selectedClaimCoordinates: null,
    terminalStatus,
    updatedAt: '2026-08-14T12:00:00.000Z',
  };
}

describe('tutorial eligibility', () => {
  it('starts only for genuinely new root-page visitors', () => {
    expect(decideTutorialEligibility({
      progress: null,
      legacyWelcomeSeen: false,
      hasFocusedCoordinates: false,
      forceReplay: false,
    })).toBe('start_new');
    expect(decideTutorialEligibility({
      progress: null,
      legacyWelcomeSeen: true,
      hasFocusedCoordinates: false,
      forceReplay: false,
    })).toBe('ineligible');
    expect(decideTutorialEligibility({
      progress: null,
      legacyWelcomeSeen: false,
      hasFocusedCoordinates: true,
      forceReplay: false,
    })).toBe('ineligible');
  });

  it('resumes active progress across a direct-link magic-link reload', () => {
    expect(decideTutorialEligibility({
      progress: progress('active'),
      legacyWelcomeSeen: true,
      hasFocusedCoordinates: true,
      forceReplay: false,
    })).toBe('resume');
  });

  it('keeps completed and dismissed players out unless replay is forced', () => {
    expect(decideTutorialEligibility({
      progress: progress('completed'),
      legacyWelcomeSeen: true,
      hasFocusedCoordinates: false,
      forceReplay: false,
    })).toBe('ineligible');
    expect(decideTutorialEligibility({
      progress: progress('dismissed'),
      legacyWelcomeSeen: true,
      hasFocusedCoordinates: true,
      forceReplay: true,
    })).toBe('force_replay');
    expect(tutorialReplayForced({ search: '?tutorial=replay' })).toBe(true);
  });
});

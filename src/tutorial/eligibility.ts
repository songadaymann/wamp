import {
  LEGACY_WELCOME_SEEN_STORAGE_KEY,
  TUTORIAL_PROGRESS_STORAGE_KEY,
  type TutorialProgressV1,
} from './model';

export interface TutorialEligibilityInput {
  progress: TutorialProgressV1 | null;
  legacyWelcomeSeen: boolean;
  hasFocusedCoordinates: boolean;
  forceReplay: boolean;
}

export type TutorialEligibilityDecision =
  | 'start_new'
  | 'resume'
  | 'force_replay'
  | 'ineligible';

export function decideTutorialEligibility(
  input: TutorialEligibilityInput,
): TutorialEligibilityDecision {
  if (input.forceReplay) return 'force_replay';
  if (input.progress?.terminalStatus === 'active') return 'resume';
  if (input.hasFocusedCoordinates || input.legacyWelcomeSeen) return 'ineligible';
  return 'start_new';
}

export function hasLegacyWelcomeBeenSeen(storage: Storage): boolean {
  return storage.getItem(LEGACY_WELCOME_SEEN_STORAGE_KEY) === '1';
}

export function arbitrateLegacyWelcome(storage: Storage): void {
  storage.setItem(LEGACY_WELCOME_SEEN_STORAGE_KEY, '1');
}

export function tutorialReplayForced(location: Pick<Location, 'search'>): boolean {
  const value = new URLSearchParams(location.search).get('tutorial');
  return value !== null && ['1', 'true', 'yes', 'on', 'replay'].includes(value.toLowerCase());
}

export function shouldSuppressLegacyWelcome(input: {
  storage: Storage;
  location: Pick<Location, 'search'>;
  hasFocusedCoordinates: boolean;
}): boolean {
  let progress: TutorialProgressV1 | null = null;
  try {
    const raw = input.storage.getItem(TUTORIAL_PROGRESS_STORAGE_KEY);
    progress = raw ? JSON.parse(raw) as TutorialProgressV1 : null;
  } catch {
    progress = null;
  }
  return decideTutorialEligibility({
    progress,
    legacyWelcomeSeen: hasLegacyWelcomeBeenSeen(input.storage),
    hasFocusedCoordinates: input.hasFocusedCoordinates,
    forceReplay: tutorialReplayForced(input.location),
  }) !== 'ineligible';
}

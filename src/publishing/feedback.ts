import { getAuthDebugState } from '../auth/client';
import { createProfileRepository, type ProfileRepository } from '../profiles/profileRepository';
import type { ProgressionSummary } from '../progression/model';
import { dispatchProgressionFeedback } from '../progression/progressionFeedback';
import { loadSeenRewardProgression, saveSeenRewardProgression } from '../progression/rewardStingSeenState';
import { requestProfileInvalidation } from '../ui/setup/profileEvents';

export async function capturePublishProgression(userId: string | null,
  repository: ProfileRepository = createProfileRepository()): Promise<ProgressionSummary | null> {
  if (!userId) return null;
  try { return (await repository.loadProfile(userId, { fresh: true })).progression; }
  catch { return null; }
}

export async function reportPublishProgression(options: {
  userId: string;
  previousProgression: ProgressionSummary | null;
  contentType: 'room' | 'expanded_room';
  contentId: string;
  title: string | null;
}, repository: ProfileRepository = createProfileRepository()): Promise<void> {
  try {
    const current = (await repository.loadProfile(options.userId, { fresh: true })).progression;
    const auth = getAuthDebugState();
    if (!auth.authenticated || auth.user?.id !== options.userId) return;
    // A rating or catch-up may already have displayed part of this change while the fetch was pending.
    const seen = loadSeenRewardProgression(options.userId);
    const previous = options.previousProgression;
    if (!previous) return; // Leave unavailable feedback recoverable through the normal catch-up.
    const baseline = { ...previous };
    for (const lane of ['player', 'builder', 'curator'] as const) {
      if (seen && seen[lane].xp > baseline[lane].xp) baseline[lane] = seen[lane];
      // Never regress stored progression if a more recent action completed first.
      if (current[lane].xp < baseline[lane].xp) return;
    }
    saveSeenRewardProgression(options.userId, current);
    dispatchProgressionFeedback({ previousProgression: baseline, currentProgression: current,
      previousViewerRank: null, currentViewerRank: null, contentType: options.contentType,
      contentId: options.contentId, contentTitle: options.title, reason: `Published ${options.title || 'room'}` });
    requestProfileInvalidation(options.userId);
  } catch { /* Publishing has already succeeded. Optional XP feedback must not change its result. */ }
}

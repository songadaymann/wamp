import { AUTH_SESSION_REFRESHED_EVENT, type AuthDebugState } from '../../auth/client';
import { createProfileRepository, type ProfileRepository } from '../../profiles/profileRepository';
import {
  loadSeenRewardProgression,
  saveSeenRewardProgression,
} from '../../progression/rewardStingSeenState';
import { dispatchProgressionFeedback } from '../../progression/progressionFeedback';
import {
  PROFILE_INVALIDATED_EVENT,
  type ProfileInvalidatedDetail,
} from './profileEvents';

export class RewardStingCatchupController {
  private activeUserId: string | null = null;
  private checking = false;
  private queued = false;

  private readonly handleSessionRefreshed = (event: Event) => {
    const detail =
      event instanceof CustomEvent
        ? (event.detail as AuthDebugState | undefined)
        : undefined;
    const nextUserId = detail?.authenticated ? detail.user?.id?.trim() ?? '' : '';
    if (!nextUserId) {
      this.activeUserId = null;
      this.queued = false;
      return;
    }

    this.activeUserId = nextUserId;
    this.requestCheck();
  };

  private readonly handleProfileInvalidated = (event: Event) => {
    const detail =
      event instanceof CustomEvent
        ? (event.detail as ProfileInvalidatedDetail | undefined)
        : undefined;
    const invalidatedUserId = detail?.userId?.trim() ?? '';
    if (!invalidatedUserId || invalidatedUserId !== this.activeUserId) {
      return;
    }

    this.requestCheck();
  };

  constructor(
    private readonly profileRepository: ProfileRepository = createProfileRepository(),
    private readonly windowObj: Window = window,
    private readonly storage: Storage = window.localStorage,
  ) {}

  init(): void {
    this.windowObj.addEventListener(
      AUTH_SESSION_REFRESHED_EVENT,
      this.handleSessionRefreshed as EventListener,
    );
    this.windowObj.addEventListener(
      PROFILE_INVALIDATED_EVENT,
      this.handleProfileInvalidated as EventListener,
    );
  }

  destroy(): void {
    this.windowObj.removeEventListener(
      AUTH_SESSION_REFRESHED_EVENT,
      this.handleSessionRefreshed as EventListener,
    );
    this.windowObj.removeEventListener(
      PROFILE_INVALIDATED_EVENT,
      this.handleProfileInvalidated as EventListener,
    );
    this.activeUserId = null;
    this.checking = false;
    this.queued = false;
  }

  private requestCheck(): void {
    if (!this.activeUserId) {
      return;
    }

    if (this.checking) {
      this.queued = true;
      return;
    }

    void this.runCheck(this.activeUserId);
  }

  private async runCheck(userId: string): Promise<void> {
    this.checking = true;
    try {
      const profile = await this.profileRepository.loadProfile(userId);
      if (this.activeUserId !== userId) {
        return;
      }

      const previousProgression = loadSeenRewardProgression(userId, this.storage);
      saveSeenRewardProgression(userId, profile.progression, this.storage);
      if (!previousProgression) {
        return;
      }

      dispatchProgressionFeedback({
        previousProgression,
        currentProgression: profile.progression,
        previousViewerRank: null,
        currentViewerRank: null,
        contentType: 'room',
        contentId: 'profile-catchup',
        contentTitle: null,
        reason: 'While you were away',
        windowObj: this.windowObj,
      });
    } catch {
      // Leave catch-up optional when profile refreshes are unavailable.
    } finally {
      this.checking = false;
      if (this.queued && this.activeUserId) {
        this.queued = false;
        void this.runCheck(this.activeUserId);
      }
    }
  }
}

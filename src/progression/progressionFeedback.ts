import type { ProgressionDelta, ProgressionSummary } from './model';
import {
  buildRewardStings,
  notifyRewardStings,
  type BuildRewardStingsOptions,
} from './rewardStings';
import {
  buildXpReceipts,
  notifyXpReceipts,
  XP_RECEIPTS_IDLE_EVENT,
} from './xpReceipts';

export function dispatchProgressionFeedback(
  options: BuildRewardStingsOptions & {
    progressionDelta?: ProgressionDelta | null;
    reason: string;
    windowObj?: Window;
  },
): void {
  const windowObj = options.windowObj ?? window;
  const receipts = buildXpReceipts({
    previousProgression: options.previousProgression,
    currentProgression: options.currentProgression,
    progressionDelta: options.progressionDelta ?? null,
    reason: options.reason,
  });
  const rewards = buildRewardStings(options);

  if (receipts.length > 0 && rewards.length > 0) {
    windowObj.addEventListener(
      XP_RECEIPTS_IDLE_EVENT,
      () => {
        notifyRewardStings(rewards);
      },
      { once: true },
    );
  }

  if (receipts.length > 0) {
    notifyXpReceipts(receipts);
  }

  if (rewards.length === 0) {
    return;
  }

  if (receipts.length === 0) {
    notifyRewardStings(rewards);
  }
}

import type {
  ProgressionDelta,
  ProgressionLane,
  ProgressionLaneSummary,
  ProgressionSummary,
} from './model';

export const XP_RECEIPTS_EVENT = 'xp-receipts';
export const XP_RECEIPTS_IDLE_EVENT = 'xp-receipts-idle';

export interface XpReceipt {
  lane: ProgressionLane;
  amount: number;
  amountText: string;
  reason: string;
  iconSrc: string;
  iconAlt: string;
  levelText: string;
  detailText: string;
  progressFrom: number;
  progressTo: number;
}

export interface XpReceiptsDetail {
  receipts: XpReceipt[];
}

const PLAYER_ICON_SRC = '/assets/ui-progress-player.png';
const BUILDER_ICON_SRC = '/assets/ui-progress-builder.png';
const CURATOR_ICON_SRC = '/assets/ui-progress-curator.png';

export function notifyXpReceipts(receipts: XpReceipt[]): void {
  if (receipts.length === 0) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<XpReceiptsDetail>(XP_RECEIPTS_EVENT, {
      detail: { receipts },
    }),
  );
}

export function buildXpReceipts(options: {
  previousProgression: ProgressionSummary | null;
  currentProgression: ProgressionSummary;
  reason: string;
  progressionDelta?: ProgressionDelta | null;
}): XpReceipt[] {
  const { previousProgression, currentProgression, reason, progressionDelta } = options;
  const receipts: XpReceipt[] = [];

  for (const lane of ['player', 'builder', 'curator'] as const) {
    const amount = getLaneDeltaAmount(lane, previousProgression, currentProgression, progressionDelta);
    if (amount <= 0) {
      continue;
    }

    const currentLane = currentProgression[lane];
    const previousLane = previousProgression?.[lane] ?? null;
    receipts.push({
      lane,
      amount,
      amountText: `+${amount} ${getLaneShortLabel(lane)}`,
      reason,
      iconSrc: getLaneIconSrc(lane),
      iconAlt: `${lane} xp icon`,
      levelText: `LVL ${currentLane.level}`,
      detailText: formatLaneDetail(currentLane),
      progressFrom: getProgressFrom(previousLane, currentLane),
      progressTo: Math.max(0, Math.min(1, currentLane.progressFraction)),
    });
  }

  return receipts;
}

function getLaneDeltaAmount(
  lane: ProgressionLane,
  previousProgression: ProgressionSummary | null,
  currentProgression: ProgressionSummary,
  progressionDelta?: ProgressionDelta | null,
): number {
  if (progressionDelta) {
    if (lane === 'player') {
      return Math.max(0, progressionDelta.pxp);
    }
    if (lane === 'builder') {
      return Math.max(0, progressionDelta.bxp);
    }
    return Math.max(0, progressionDelta.cxp);
  }

  const previousXp = previousProgression?.[lane]?.xp ?? currentProgression[lane].xp;
  return Math.max(0, currentProgression[lane].xp - previousXp);
}

function getLaneShortLabel(lane: ProgressionLane): string {
  if (lane === 'builder') {
    return 'BXP';
  }
  if (lane === 'curator') {
    return 'CXP';
  }
  return 'PXP';
}

function getLaneIconSrc(lane: ProgressionLane): string {
  if (lane === 'builder') {
    return BUILDER_ICON_SRC;
  }
  if (lane === 'curator') {
    return CURATOR_ICON_SRC;
  }
  return PLAYER_ICON_SRC;
}

function formatLaneDetail(summary: ProgressionLaneSummary): string {
  if (summary.nextLevelXp <= summary.currentLevelStartXp) {
    return 'MAX LEVEL';
  }
  return `${summary.xp} / ${summary.nextLevelXp} XP`;
}

function getProgressFrom(
  previousLane: ProgressionLaneSummary | null,
  currentLane: ProgressionLaneSummary,
): number {
  if (!previousLane) {
    return Math.max(0, currentLane.progressFraction - 0.14);
  }

  if (currentLane.level > previousLane.level) {
    return 0;
  }

  return Math.max(0, Math.min(1, previousLane.progressFraction));
}

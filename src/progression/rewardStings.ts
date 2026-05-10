import type { SfxCue } from '../audio/sfx';
import type {
  BadgeAwardSummary,
  ProgressionBadgeCategory,
  ProgressionLaneSummary,
  ProgressionSummary,
  TrophyAwardSummary,
} from './model';

export const REWARD_STINGS_EVENT = 'reward-stings';
export const REWARD_STINGS_IDLE_EVENT = 'reward-stings-idle';

export type RewardStingKind =
  | 'room-clear'
  | 'course-clear'
  | 'player-level-up'
  | 'builder-level-up'
  | 'curator-level-up'
  | 'badge-earned'
  | 'trophy-earned'
  | 'top-10-entry'
  | 'number-one-takeover';

export type RewardStingTone =
  | 'player'
  | 'builder'
  | 'curator'
  | 'badge'
  | 'trophy'
  | 'leaderboard'
  | 'takeover';

export interface RewardSting {
  kind: RewardStingKind;
  tone: RewardStingTone;
  kicker: string;
  title: string;
  subtitle: string;
  detail: string | null;
  progressValue?: number | null;
  iconSrc: string;
  iconAlt: string;
  emphasis: 'normal' | 'hero';
  durationMs: number;
  sfxCue?: SfxCue | null;
}

export interface RewardStingsDetail {
  rewards: RewardSting[];
}

export interface BuildRewardStingsOptions {
  previousProgression: ProgressionSummary | null;
  currentProgression: ProgressionSummary;
  previousViewerRank: number | null;
  currentViewerRank: number | null;
  contentType: 'room' | 'course';
  contentId: string;
  contentTitle: string | null;
}

const PLAYER_ICON_SRC = '/assets/ui-progress-player.png';
const BUILDER_ICON_SRC = '/assets/ui-progress-builder.png';
const CURATOR_ICON_SRC = '/assets/ui-progress-curator.png';
const TROPHY_ICON_SRC = '/assets/objects/flag-checkered-gold.png';
const TOP_TEN_BADGE_ID = 'player_top10_entrant';
const NUMBER_ONE_BADGE_ID = 'player_top1_finisher';
const DEFAULT_REWARD_STING_DURATIONS_MS: Record<RewardStingKind, number> = {
  'room-clear': 1550,
  'course-clear': 1550,
  'player-level-up': 1800,
  'builder-level-up': 1800,
  'curator-level-up': 1800,
  'badge-earned': 1900,
  'trophy-earned': 2000,
  'top-10-entry': 1850,
  'number-one-takeover': 2400,
};
const REWARD_STING_SFX_DURATIONS_MS: Partial<Record<SfxCue, number>> = {
  'progression-player-level-up': 2325,
  'progression-builder-level-up': 3213,
  'progression-curator-level-up': 2638,
  'progression-top-10': 4101,
  'progression-first-place': 2351,
};

export function notifyRewardStings(rewards: RewardSting[]): void {
  if (rewards.length === 0) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<RewardStingsDetail>(REWARD_STINGS_EVENT, {
      detail: { rewards },
    }),
  );
}

export function buildRewardStings(options: BuildRewardStingsOptions): RewardSting[] {
  const rewards: RewardSting[] = buildLeaderboardRankRewardStings({
    previousViewerRank: options.previousViewerRank,
    currentViewerRank: options.currentViewerRank,
    contentTitle: options.contentTitle,
  });
  const suppressedBadgeIds = new Set<string>();
  const newBadges = options.previousProgression
    ? getNewBadges(options.previousProgression, options.currentProgression)
    : [];

  if (rewards.some((reward) => reward.kind === 'number-one-takeover')) {
    suppressedBadgeIds.add(NUMBER_ONE_BADGE_ID);
  } else if (rewards.some((reward) => reward.kind === 'top-10-entry')) {
    suppressedBadgeIds.add(TOP_TEN_BADGE_ID);
  } else if (newBadges.some((badge) => badge.badgeId === NUMBER_ONE_BADGE_ID)) {
    suppressedBadgeIds.add(NUMBER_ONE_BADGE_ID);
    rewards.push(createNumberOneReward(options.contentTitle, null));
  } else if (newBadges.some((badge) => badge.badgeId === TOP_TEN_BADGE_ID)) {
    suppressedBadgeIds.add(TOP_TEN_BADGE_ID);
    rewards.push(createTopTenReward(options.contentTitle, null));
  }

  if (!options.previousProgression) {
    return rewards;
  }

  const previous = options.previousProgression;
  const current = options.currentProgression;

  rewards.push(
    ...buildLaneLevelRewards(previous.player, current.player),
    ...buildLaneLevelRewards(previous.builder, current.builder),
    ...buildLaneLevelRewards(previous.curator, current.curator),
  );

  for (const badge of newBadges) {
    if (suppressedBadgeIds.has(badge.badgeId)) {
      continue;
    }
    rewards.push(createBadgeReward(badge));
  }

  for (const trophy of getNewTrophies(previous, current)) {
    rewards.push(createTrophyReward(trophy, options));
  }

  return rewards;
}

export function buildLeaderboardRankRewardStings(options: {
  previousViewerRank: number | null;
  currentViewerRank: number | null;
  contentTitle: string | null;
}): RewardSting[] {
  if (options.currentViewerRank === null) {
    return [];
  }

  if (options.currentViewerRank === 1 && options.previousViewerRank !== 1) {
    return [
      createNumberOneReward(
        options.contentTitle,
        buildRankShiftText(options.previousViewerRank, options.currentViewerRank),
      ),
    ];
  }

  if (
    options.currentViewerRank <= 10 &&
    (options.previousViewerRank === null || options.previousViewerRank > 10)
  ) {
    return [
      createTopTenReward(
        options.contentTitle,
        buildRankShiftText(options.previousViewerRank, options.currentViewerRank),
      ),
    ];
  }

  return [];
}

export function createPostRunClearReward(options: {
  contentType: 'room' | 'course';
  contentTitle: string | null;
  elapsedMs: number;
  deaths: number;
  score: number | null;
}): RewardSting {
  const isCourse = options.contentType === 'course';
  return {
    kind: isCourse ? 'course-clear' : 'room-clear',
    tone: isCourse ? 'curator' : 'player',
    kicker: isCourse ? 'Course Clear' : 'Room Clear',
    title: isCourse ? 'COURSE CLEAR!' : 'ROOM CLEAR!',
    subtitle: options.contentTitle?.trim() || (isCourse ? 'Course complete' : 'Room complete'),
    detail: formatPostRunClearDetail(options.elapsedMs, options.deaths, options.score),
    iconSrc: isCourse ? CURATOR_ICON_SRC : PLAYER_ICON_SRC,
    iconAlt: isCourse ? 'Course clear icon' : 'Room clear icon',
    emphasis: 'normal',
    durationMs: getRewardStingDurationMs(isCourse ? 'course-clear' : 'room-clear', isCourse ? 'curator' : 'player'),
    sfxCue: 'goal-success',
  };
}

function createTopTenReward(contentTitle: string | null | undefined, detail: string | null): RewardSting {
  return {
    kind: 'top-10-entry',
    tone: 'leaderboard',
    kicker: 'Leaderboard',
    title: 'YOU MADE THE TOP TEN!',
    subtitle: contentTitle?.trim() || 'New leaderboard entry',
    detail,
    iconSrc: PLAYER_ICON_SRC,
    iconAlt: 'Player rank badge',
    emphasis: 'normal',
    durationMs: getRewardStingDurationMs('top-10-entry', 'leaderboard'),
    sfxCue: getRewardStingSfxCue('top-10-entry', 'leaderboard'),
  };
}

function createNumberOneReward(contentTitle: string | null | undefined, detail: string | null): RewardSting {
  return {
    kind: 'number-one-takeover',
    tone: 'takeover',
    kicker: 'Leaderboard',
    title: 'YOU GOT FIRST PLACE!',
    subtitle: contentTitle?.trim() || 'New World Leader',
    detail,
    iconSrc: TROPHY_ICON_SRC,
    iconAlt: 'Gold flag trophy',
    emphasis: 'hero',
    durationMs: getRewardStingDurationMs('number-one-takeover', 'takeover'),
    sfxCue: getRewardStingSfxCue('number-one-takeover', 'takeover'),
  };
}

function buildLaneLevelRewards(
  previous: ProgressionLaneSummary,
  current: ProgressionLaneSummary,
): RewardSting[] {
  if (current.level <= previous.level) {
    return [];
  }

  return [
    {
      kind: `${current.lane}-level-up` as RewardStingKind,
      tone: current.lane,
      kicker: 'Progress',
      title: 'YOU LEVELED UP!',
      subtitle: `LVL ${previous.level} -> LVL ${current.level}`,
      detail: formatLaneProgressDetail(current),
      progressValue: current.progressFraction,
      iconSrc: getLaneIconSrc(current.lane),
      iconAlt: `${current.lane} progression icon`,
      emphasis: 'normal',
      durationMs: getRewardStingDurationMs(`${current.lane}-level-up` as RewardStingKind, current.lane),
      sfxCue: getRewardStingSfxCue(`${current.lane}-level-up` as RewardStingKind, current.lane),
    },
  ];
}

function createBadgeReward(badge: BadgeAwardSummary): RewardSting {
  const tone = getBadgeTone(badge.category);
  return {
    kind: 'badge-earned',
    tone,
    kicker: 'Badge',
    title: 'YOU EARNED A BADGE!',
    subtitle: badge.label,
    detail: badge.description,
    iconSrc: getBadgeIconSrc(badge.category),
    iconAlt: `${badge.category} badge icon`,
    emphasis: 'normal',
    durationMs: getRewardStingDurationMs('badge-earned', tone),
    sfxCue: getRewardStingSfxCue('badge-earned', tone),
  };
}

function createTrophyReward(
  trophy: TrophyAwardSummary,
  options: Pick<BuildRewardStingsOptions, 'contentId' | 'contentTitle' | 'contentType'>,
): RewardSting {
  return {
    kind: 'trophy-earned',
    tone: 'trophy',
    kicker: 'Trophy',
    title: 'YOU EARNED A TROPHY!',
    subtitle: formatTrophyLabel(trophy.trophyType),
    detail: formatTrophyDetail(trophy, options),
    iconSrc: TROPHY_ICON_SRC,
    iconAlt: 'Gold trophy flag',
    emphasis: 'normal',
    durationMs: getRewardStingDurationMs('trophy-earned', 'trophy'),
    sfxCue: getRewardStingSfxCue('trophy-earned', 'trophy'),
  };
}

export function getRewardStingSfxCue(kind: RewardStingKind, tone: RewardStingTone): SfxCue | null {
  switch (kind) {
    case 'room-clear':
    case 'course-clear':
      return 'goal-success';
    case 'player-level-up':
      return 'progression-player-level-up';
    case 'builder-level-up':
      return 'progression-builder-level-up';
    case 'curator-level-up':
      return 'progression-curator-level-up';
    case 'top-10-entry':
      return 'progression-top-10';
    case 'number-one-takeover':
      return 'progression-first-place';
    case 'badge-earned':
      if (tone === 'builder') {
        return 'progression-builder-level-up';
      }
      if (tone === 'curator') {
        return 'progression-curator-level-up';
      }
      return 'progression-player-level-up';
    case 'trophy-earned':
      return 'progression-player-level-up';
    default:
      return null;
  }
}

export function getRewardStingDurationMs(kind: RewardStingKind, tone: RewardStingTone): number {
  const cue = getRewardStingSfxCue(kind, tone);
  if (cue) {
    const soundDuration = REWARD_STING_SFX_DURATIONS_MS[cue];
    if (typeof soundDuration === 'number' && soundDuration > 0) {
      return soundDuration;
    }
  }

  return DEFAULT_REWARD_STING_DURATIONS_MS[kind];
}

function getNewBadges(previous: ProgressionSummary, current: ProgressionSummary): BadgeAwardSummary[] {
  const previousBadgeIds = new Set(previous.featuredBadges.map((badge) => badge.badgeId));
  return current.featuredBadges.filter((badge) => !previousBadgeIds.has(badge.badgeId));
}

function getNewTrophies(previous: ProgressionSummary, current: ProgressionSummary): TrophyAwardSummary[] {
  const previousTrophyKeys = new Set(previous.recentTrophies.map(getTrophyKey));
  return current.recentTrophies.filter((trophy) => !previousTrophyKeys.has(getTrophyKey(trophy)));
}

function getTrophyKey(trophy: TrophyAwardSummary): string {
  return `${trophy.contentType}:${trophy.contentId}:${trophy.versionKey}:${trophy.trophyType}`;
}

function getLaneIconSrc(lane: ProgressionLaneSummary['lane']): string {
  if (lane === 'builder') {
    return BUILDER_ICON_SRC;
  }
  if (lane === 'curator') {
    return CURATOR_ICON_SRC;
  }
  return PLAYER_ICON_SRC;
}

function getBadgeIconSrc(category: ProgressionBadgeCategory): string {
  if (category === 'builder') {
    return BUILDER_ICON_SRC;
  }
  if (category === 'curator') {
    return CURATOR_ICON_SRC;
  }
  return PLAYER_ICON_SRC;
}

function getBadgeTone(category: ProgressionBadgeCategory): RewardStingTone {
  if (category === 'builder') {
    return 'builder';
  }
  if (category === 'curator') {
    return 'curator';
  }
  if (category === 'player') {
    return 'player';
  }
  return 'badge';
}

function formatLaneProgressDetail(summary: ProgressionLaneSummary): string {
  if (summary.nextLevelXp <= summary.currentLevelStartXp) {
    return 'Max level reached';
  }
  return `${summary.xp} / ${summary.nextLevelXp} XP`;
}

function buildRankShiftText(previousRank: number | null, currentRank: number): string {
  if (previousRank === null) {
    return `Now ranked #${currentRank}`;
  }
  return `#${previousRank} -> #${currentRank}`;
}

function formatTrophyLabel(trophyType: string): string {
  const normalized = trophyType.trim();
  if (!normalized) {
    return 'Leaderboard Trophy';
  }

  return normalized
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function formatTrophyDetail(
  trophy: TrophyAwardSummary,
  options: Pick<BuildRewardStingsOptions, 'contentId' | 'contentTitle' | 'contentType'>,
): string {
  if (trophy.contentType === options.contentType && trophy.contentId === options.contentId && options.contentTitle) {
    return options.contentTitle;
  }

  const targetLabel =
    trophy.contentType === 'course'
      ? `Course ${trophy.contentId}`
      : `Room ${trophy.contentId}`;
  return `${targetLabel} v${trophy.versionKey}`;
}

function formatPostRunClearDetail(
  elapsedMs: number,
  deaths: number,
  score: number | null,
): string {
  const parts = [formatElapsedMs(elapsedMs), `${deaths} death${deaths === 1 ? '' : 's'}`];
  if (typeof score === 'number') {
    parts.push(`${score} pts`);
  }
  return parts.join(' · ');
}

function formatElapsedMs(elapsedMs: number): string {
  const totalMs = Math.max(0, Math.round(elapsedMs));
  const totalSeconds = Math.floor(totalMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const tenths = Math.floor((totalMs % 1000) / 100);
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${tenths}`;
}

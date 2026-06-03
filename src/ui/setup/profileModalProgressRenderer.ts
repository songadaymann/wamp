import type { ProfileStatsSummary } from '../../profiles/model';
import type { ProgressionLaneSummary, ProgressionSummary } from '../../progression/model';

type ProfileTone = 'player' | 'builder' | 'curator';

type ProfileInfoItem = {
  label: string;
  value: string;
  iconSrc?: string;
};

type ProfileInfoCard = {
  tone: ProfileTone;
  title: string;
  items: ProfileInfoItem[];
};

type ProfileProgressElements = {
  heroLanes: HTMLElement | null;
  heroProgress: HTMLElement | null;
  progressList: HTMLElement | null;
};

type ProfileStatsElements = {
  statsList: HTMLElement | null;
};

const PROFILE_LANE_VISUALS: Record<
  ProfileTone,
  { iconSrc: string; iconLabel: string; fillClass: string }
> = {
  player: {
    iconSrc: '/assets/ui-progress-player.png',
    iconLabel: 'Player',
    fillClass: 'profile-hero-lane-fill-player',
  },
  builder: {
    iconSrc: '/assets/ui-progress-builder.png',
    iconLabel: 'Builder',
    fillClass: 'profile-hero-lane-fill-builder',
  },
  curator: {
    iconSrc: '/assets/ui-progress-curator.png',
    iconLabel: 'Curator',
    fillClass: 'profile-hero-lane-fill-curator',
  },
};

export function renderProfileStats(
  doc: Document,
  elements: ProfileStatsElements,
  stats: ProfileStatsSummary | null,
  publishedCourseCount: number,
): void {
  if (!elements.statsList) {
    return;
  }

  if (!stats) {
    elements.statsList.replaceChildren(
      createInfoCard(doc, {
        tone: 'curator',
        title: 'Stats',
        items: [{ label: 'Status', value: 'No stats yet.' }],
      }),
    );
    return;
  }

  const cards: ProfileInfoCard[] = [
    {
      tone: 'player',
      title: 'Runs',
      items: [
        {
          label: 'Completed',
          value: String(stats.completedRuns),
          iconSrc: '/assets/ui-progress-player.png',
        },
        {
          label: 'Failed',
          value: String(stats.failedRuns),
          iconSrc: '/assets/enemies/saw.png',
        },
        {
          label: 'Abandoned',
          value: String(stats.abandonedRuns),
          iconSrc: '/assets/objects/sign_arrow.png',
        },
        {
          label: 'Best score',
          value: String(stats.bestScore),
          iconSrc: '/assets/objects/flag-checkered-gold.png',
        },
        {
          label: 'Fastest clear',
          value: stats.fastestClearMs ? formatDuration(stats.fastestClearMs) : 'None yet',
          iconSrc: '/assets/objects/flag-checkered.png',
        },
      ],
    },
    {
      tone: 'player',
      title: 'PVP',
      items: [
        {
          label: 'Wins',
          value: String(stats.pvpWins),
          iconSrc: '/assets/objects/crown.png',
        },
        {
          label: 'Losses',
          value: String(stats.pvpLosses),
          iconSrc: '/assets/objects/skull.png',
        },
        {
          label: 'Draws',
          value: String(stats.pvpDraws),
          iconSrc: '/assets/objects/heart.png',
        },
      ],
    },
    {
      tone: 'builder',
      title: 'Built',
      items: [
        {
          label: 'Rooms published',
          value: String(stats.totalRoomsPublished),
          iconSrc: '/assets/ui-progress-builder.png',
        },
        {
          label: 'Expanded rooms published',
          value: String(publishedCourseCount),
          iconSrc: '/assets/objects/flag-green.png',
        },
      ],
    },
    {
      tone: 'curator',
      title: 'World',
      items: [
        {
          label: 'Total points',
          value: String(stats.totalPoints),
          iconSrc: '/assets/ui-progress-curator.png',
        },
        {
          label: 'Global rank',
          value: stats.globalRank ? `#${stats.globalRank}` : 'Unranked',
          iconSrc: '/assets/objects/flag-checkered-gold.png',
        },
        {
          label: 'Collectibles',
          value: String(stats.totalCollectibles),
          iconSrc: '/assets/objects/coin_small_gold.png',
        },
        {
          label: 'Enemies',
          value: String(stats.totalEnemiesDefeated),
          iconSrc: '/assets/enemies/slime_red.png',
        },
        {
          label: 'Checkpoints',
          value: String(stats.totalCheckpoints),
          iconSrc: '/assets/objects/flag-green.png',
        },
        {
          label: 'Deaths',
          value: String(stats.totalDeaths),
          iconSrc: '/assets/enemies/saw.png',
        },
      ],
    },
  ];

  elements.statsList.replaceChildren(...cards.map((card) => createInfoCard(doc, card)));
}

export function renderProfileProgress(
  doc: Document,
  elements: ProfileProgressElements,
  progression: ProgressionSummary | null,
): void {
  if (elements.heroLanes) {
    if (!progression) {
      elements.heroLanes.replaceChildren();
    } else {
      elements.heroLanes.replaceChildren(
        createHeroLaneRow(doc, progression.player, 'player'),
        createHeroLaneRow(doc, progression.builder, 'builder'),
        createHeroLaneRow(doc, progression.curator, 'curator'),
      );
    }
  }

  if (elements.heroProgress) {
    const chips: HTMLElement[] = [];
    if (progression && progression.founderNumber !== null) {
      chips.push(createHeroSummaryChip(doc, `WAMP #${progression.founderNumber}`, 'curator'));
    }
    if (progression) {
      chips.push(createHeroSummaryChip(doc, `${progression.badgeCount} ${pluralize('badge', progression.badgeCount)}`, 'builder'));
      chips.push(createHeroSummaryChip(doc, `${progression.trophyCount} ${pluralize('trophy', progression.trophyCount)}`, 'player'));
    }
    elements.heroProgress.replaceChildren(...chips);
    elements.heroProgress.classList.toggle('hidden', chips.length === 0);
  }

  if (!elements.progressList) {
    return;
  }

  if (!progression) {
    elements.progressList.replaceChildren(
      createInfoCard(doc, {
        tone: 'curator',
        title: 'Progress',
        items: [{ label: 'Status', value: 'No progression data yet.' }],
      }),
    );
    return;
  }

  const milestoneItems: ProfileInfoItem[] = [];
  if (progression.builderCaps.overrideActive) {
    milestoneItems.push({
      label: 'Cap boost',
      value: 'Admin boost active',
      iconSrc: '/assets/ui-progress-builder.png',
    });
  }
  for (const badge of progression.featuredBadges.slice(0, 3)) {
    milestoneItems.push({
      label: badge.category,
      value: `${badge.label} · ${badge.description}`,
      iconSrc: '/assets/ui-progress-curator.png',
    });
  }
  for (const trophy of progression.recentTrophies.slice(0, 3)) {
    milestoneItems.push({
      label: 'Trophy',
      value: `${trophy.contentType} ${trophy.contentId} v${trophy.versionKey} · ${trophy.trophyType}`,
      iconSrc: '/assets/objects/flag-checkered-gold.png',
    });
  }

  const cards: ProfileInfoCard[] = [
    {
      tone: 'builder',
      title: 'Build Limits',
      items: [
        {
          label: 'Placed objects',
          value: String(progression.builderCaps.objectLimit),
          iconSrc: '/assets/ui-progress-builder.png',
        },
        {
          label: 'Collectibles',
          value: String(progression.builderCaps.collectibleLimit),
          iconSrc: '/assets/objects/coin_small_gold.png',
        },
        {
          label: 'Expanded cells',
          value: String(progression.builderCaps.expandedRoomCellLimit),
          iconSrc: '/assets/objects/key.png',
        },
      ],
    },
    {
      tone: 'builder',
      title: 'Daily Rhythm',
      items: [
        {
          label: 'Publish / day',
          value: String(progression.builderCaps.publishLimitPerDay),
          iconSrc: '/assets/objects/flag-green.png',
        },
        {
          label: 'Claim / day',
          value: String(progression.builderCaps.claimLimitPerDay),
          iconSrc: '/assets/objects/key.png',
        },
      ],
    },
  ];

  if (milestoneItems.length > 0) {
    cards.push({
      tone: 'curator',
      title: 'Milestones',
      items: milestoneItems,
    });
  }

  elements.progressList.replaceChildren(...cards.map((card) => createInfoCard(doc, card)));
}

function createHeroLaneRow(
  doc: Document,
  lane: ProgressionLaneSummary,
  tone: ProfileTone,
): HTMLElement {
  const visual = PROFILE_LANE_VISUALS[tone];
  const row = doc.createElement('div');
  row.className = `profile-hero-lane profile-hero-lane-${tone}`;

  const labelWrap = doc.createElement('div');
  labelWrap.className = 'profile-hero-lane-label-wrap';

  const icon = doc.createElement('img');
  icon.className = 'profile-hero-lane-icon';
  icon.src = visual.iconSrc;
  icon.alt = '';
  icon.setAttribute('aria-hidden', 'true');

  const label = doc.createElement('span');
  label.className = 'profile-hero-lane-label';
  label.textContent = `LVL ${lane.level}`;

  labelWrap.append(icon, label);

  const progress = doc.createElement('div');
  progress.className = 'profile-hero-lane-progress';

  const fill = doc.createElement('div');
  fill.className = `profile-hero-lane-fill ${visual.fillClass}`;
  fill.style.width = `${(Math.max(0, Math.min(1, lane.progressFraction)) * 100).toFixed(1)}%`;
  progress.appendChild(fill);

  const total = doc.createElement('span');
  total.className = 'profile-hero-lane-total';
  total.textContent = formatLaneTarget(lane);

  row.append(labelWrap, progress, total);
  row.setAttribute('aria-label', `${visual.iconLabel} level ${lane.level}, ${formatLaneTarget(lane)} to next level`);
  return row;
}

function createHeroSummaryChip(doc: Document, text: string, tone: ProfileTone): HTMLElement {
  const chip = doc.createElement('div');
  chip.className = `profile-hero-summary-chip profile-hero-summary-chip-${tone}`;
  chip.textContent = text;
  return chip;
}

function createInfoCard(doc: Document, card: ProfileInfoCard): HTMLElement {
  const visual = PROFILE_LANE_VISUALS[card.tone];
  const section = doc.createElement('section');
  section.className = `profile-info-card profile-info-card-${card.tone}`;

  const header = doc.createElement('div');
  header.className = 'profile-info-card-header';

  const icon = doc.createElement('img');
  icon.className = 'profile-info-card-header-icon';
  icon.src = visual.iconSrc;
  icon.alt = '';
  icon.setAttribute('aria-hidden', 'true');

  const title = doc.createElement('div');
  title.className = 'profile-info-card-title';
  title.textContent = card.title;

  header.append(icon, title);

  const grid = doc.createElement('div');
  grid.className = 'profile-info-card-grid';

  for (const item of card.items) {
    const row = doc.createElement('div');
    row.className = 'profile-info-item';

    if (item.iconSrc) {
      const rowIcon = doc.createElement('img');
      rowIcon.className = 'profile-info-item-icon';
      rowIcon.src = item.iconSrc;
      rowIcon.alt = '';
      rowIcon.setAttribute('aria-hidden', 'true');
      row.appendChild(rowIcon);
    }

    const copy = doc.createElement('div');
    copy.className = 'profile-info-item-copy';

    const label = doc.createElement('div');
    label.className = 'profile-info-item-label';
    label.textContent = item.label;

    const value = doc.createElement('div');
    value.className = 'profile-info-item-value';
    value.textContent = item.value;

    copy.append(label, value);
    row.appendChild(copy);
    grid.appendChild(row);
  }

  section.append(header, grid);
  return section;
}

function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return '0.00s';
  }

  if (milliseconds < 60_000) {
    return `${(milliseconds / 1000).toFixed(2)}s`;
  }

  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const hundredths = Math.floor((milliseconds % 1000) / 10);
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${hundredths.toString().padStart(2, '0')}`;
}

function formatLaneTarget(lane: ProgressionLaneSummary): string {
  const span = Math.max(1, lane.nextLevelXp - lane.currentLevelStartXp);
  const current = Math.max(0, Math.min(span, lane.xp - lane.currentLevelStartXp));
  return `${current}/${span}`;
}

function pluralize(label: string, count: number): string {
  return count === 1 ? label : `${label}s`;
}

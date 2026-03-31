import type { DashboardStatsResponse } from './dashboard/model';
import { getApiBaseUrl } from './api/baseUrl';

const REFRESH_INTERVAL_MS = 60_000;
const chartDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
});
const numberFormatter = new Intl.NumberFormat();
const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const refreshButton = document.getElementById('refresh-button') as HTMLButtonElement | null;
const historyGrid = document.getElementById('history-grid') as HTMLDivElement | null;
const lastUpdated = document.getElementById('last-updated') as HTMLDivElement | null;
const status = document.getElementById('status') as HTMLDivElement | null;
const statsGrid = document.getElementById('stats-grid') as HTMLDivElement | null;

let snapshot: DashboardStatsResponse | null = null;
let refreshInFlight = false;
let lastGoodFetchAt: string | null = null;
let lastError: string | null = null;
let refreshTimer: number | null = null;

refreshButton?.addEventListener('click', () => {
  void refreshDashboard(true);
});

document.addEventListener('visibilitychange', () => {
  syncRefreshTimer();
  if (document.visibilityState === 'visible') {
    void refreshDashboard();
  }
});

syncRefreshTimer();
void refreshDashboard(true);

function syncRefreshTimer(): void {
  const shouldRefresh = document.visibilityState === 'visible';
  if (!shouldRefresh) {
    if (refreshTimer !== null) {
      window.clearInterval(refreshTimer);
      refreshTimer = null;
    }
    return;
  }

  if (refreshTimer === null) {
    refreshTimer = window.setInterval(() => {
      void refreshDashboard();
    }, REFRESH_INTERVAL_MS);
  }
}

async function refreshDashboard(force = false): Promise<void> {
  if (refreshInFlight) {
    return;
  }

  if (!force && document.visibilityState !== 'visible') {
    return;
  }

  refreshInFlight = true;
  render();

  try {
    const response = await fetch(`${getApiBaseUrl()}/api/dashboard/stats`, {
      cache: 'no-store',
    });

    if (!response.ok) {
      const text = (await response.text()).trim();
      throw new Error(text || `Request failed with status ${response.status}.`);
    }

    snapshot = (await response.json()) as DashboardStatsResponse;
    lastGoodFetchAt = new Date().toISOString();
    lastError = null;
  } catch (error) {
    lastError = error instanceof Error ? error.message : 'Unknown dashboard failure.';
  } finally {
    refreshInFlight = false;
    render();
  }
}

function render(): void {
  renderMeta();
  renderStats();
  renderHistory();
}

function renderMeta(): void {
  if (refreshButton) {
    refreshButton.disabled = refreshInFlight;
  }

  if (lastUpdated) {
    if (!snapshot) {
      lastUpdated.textContent = 'No snapshot yet';
    } else {
      const snapshotTime = formatTimestamp(snapshot.generatedAt);
      const fetchTime = lastGoodFetchAt ? formatTimestamp(lastGoodFetchAt) : 'n/a';
      lastUpdated.textContent = `Snapshot ${snapshotTime} | fetched ${fetchTime}`;
    }
  }

  if (!status) {
    return;
  }

  if (refreshInFlight && !snapshot) {
    status.textContent = 'Fetching';
    return;
  }

  if (refreshInFlight) {
    status.textContent = 'Refreshing';
    return;
  }

  if (lastError) {
    status.textContent = `${lastError} | showing last good snapshot`;
    return;
  }

  status.textContent = 'Auto refresh 60s';
}

function renderStats(): void {
  if (!statsGrid) {
    return;
  }

  const cards = [
    { label: 'Users', value: snapshot ? numberFormatter.format(snapshot.users.total) : '--', tone: 'question' },
    { label: 'Playfun', value: snapshot ? numberFormatter.format(snapshot.users.playfunLinked) : '--', tone: 'pipe' },
    { label: 'Non Playfun', value: snapshot ? numberFormatter.format(snapshot.users.nonPlayfun) : '--', tone: 'brick' },
    { label: 'Rooms Built', value: snapshot ? numberFormatter.format(snapshot.rooms.totalBuilt) : '--', tone: 'brick' },
    { label: 'Unique Builders', value: snapshot ? numberFormatter.format(snapshot.rooms.uniqueBuilders) : '--', tone: 'question' },
    { label: '2+ Rooms', value: snapshot ? numberFormatter.format(snapshot.rooms.buildersWithMultipleRooms) : '--', tone: 'brick' },
    { label: 'Completes', value: snapshot ? numberFormatter.format(snapshot.challenges.completed) : '--', tone: 'pipe' },
  ] as const;

  statsGrid.innerHTML = cards
    .map((card) => createCardMarkup(card.label, card.value, card.tone))
    .join('');
}

function renderHistory(): void {
  if (!historyGrid) {
    return;
  }

  const history = snapshot?.history ?? null;
  const cards = [
    {
      label: 'Non-Playfun Signups',
      points: history?.nonPlayfunSignupsPerDay ?? [],
      windowDays: history?.windowDays ?? 30,
      tone: 'question',
    },
    {
      label: 'Room Claims',
      points: history?.roomClaimsPerDay ?? [],
      windowDays: history?.windowDays ?? 30,
      tone: 'pipe',
    },
  ] as const;

  historyGrid.innerHTML = cards
    .map((card) => createHistoryCardMarkup(card.label, card.points, card.windowDays, card.tone))
    .join('');
}

function createCardMarkup(label: string, value: string, tone: DashboardTone): string {
  return `
    <article class="stat-card" data-tone="${escapeHtml(tone)}">
      <div class="stat-label">${escapeHtml(label)}</div>
      <div class="stat-value">${escapeHtml(value)}</div>
    </article>
  `;
}

function createHistoryCardMarkup(
  label: string,
  points: DashboardStatsResponse['history']['nonPlayfunSignupsPerDay'],
  windowDays: number,
  tone: DashboardTone
): string {
  const summary = summarizeSeries(points);
  const startLabel = points.length > 0 ? formatChartDay(points[0].date) : '--';
  const endLabel = points.length > 0 ? formatChartDay(points[points.length - 1].date) : '--';

  return `
    <article class="history-card" data-tone="${escapeHtml(tone)}">
      <div class="history-card-header">
        <div class="history-label">${escapeHtml(label)}</div>
        <div class="history-pill">${escapeHtml(`${windowDays}d ${numberFormatter.format(summary.total)}`)}</div>
      </div>
      <div class="history-chart-wrap">
        ${createHistoryChartMarkup(points, tone)}
      </div>
      <div class="history-axis">
        <span>${escapeHtml(startLabel)}</span>
        <span>${escapeHtml(endLabel)}</span>
      </div>
    </article>
  `;
}

function createHistoryChartMarkup(
  points: DashboardStatsResponse['history']['nonPlayfunSignupsPerDay'],
  tone: DashboardTone
): string {
  const chartWidth = 320;
  const chartHeight = 112;
  const innerHeight = 84;
  const gap = 2;
  const barWidth = points.length > 0 ? (chartWidth - gap * Math.max(0, points.length - 1)) / points.length : chartWidth;
  const maxCount = Math.max(1, ...points.map((point) => point.count));
  const fill = tone === 'pipe' ? '#f7fbff' : '#1b2437';
  const accent = tone === 'pipe' ? 'rgba(255,255,255,0.22)' : 'rgba(17,24,39,0.14)';

  const bars = points.map((point, index) => {
    const height = point.count <= 0 ? 4 : Math.max(8, (point.count / maxCount) * innerHeight);
    const x = index * (barWidth + gap);
    const y = chartHeight - height - 16;
    return `
      <g>
        <title>${escapeHtml(`${formatChartDay(point.date)}: ${numberFormatter.format(point.count)}`)}</title>
        <rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${height.toFixed(2)}" rx="2" ry="2" fill="${fill}" />
      </g>
    `;
  }).join('');

  return `
    <svg class="history-chart" viewBox="0 0 ${chartWidth} ${chartHeight}" role="img" aria-label="${escapeHtml(labelSeries(points))}">
      <rect x="0" y="0" width="${chartWidth}" height="${chartHeight}" rx="12" ry="12" fill="${accent}" />
      <line x1="0" y1="${chartHeight - 16}" x2="${chartWidth}" y2="${chartHeight - 16}" stroke="${fill}" stroke-opacity="0.24" stroke-width="2" />
      ${bars}
    </svg>
  `;
}

function summarizeSeries(points: DashboardStatsResponse['history']['nonPlayfunSignupsPerDay']): { total: number } {
  return {
    total: points.reduce((sum, point) => sum + point.count, 0),
  };
}

function labelSeries(points: DashboardStatsResponse['history']['nonPlayfunSignupsPerDay']): string {
  if (points.length === 0) {
    return 'No history available.';
  }

  const total = points.reduce((sum, point) => sum + point.count, 0);
  return `${numberFormatter.format(total)} total across ${points.length} days, from ${formatChartDay(points[0].date)} to ${formatChartDay(points[points.length - 1].date)}.`;
}

function formatChartDay(value: string): string {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed)) {
    return value;
  }

  return chartDateFormatter.format(parsed);
}

function formatTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }

  return timestampFormatter.format(parsed);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type DashboardTone = 'question' | 'brick' | 'pipe';

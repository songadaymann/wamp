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

historyGrid?.addEventListener('pointermove', (event) => {
  const target = event.target instanceof Element ? event.target.closest('.history-bar-hit') : null;
  if (!(target instanceof SVGElement)) {
    hideAllHistoryTooltips();
    return;
  }

  showHistoryTooltip(target, event.clientX, event.clientY);
});

historyGrid?.addEventListener('pointerleave', () => {
  hideAllHistoryTooltips();
});

historyGrid?.addEventListener('focusin', (event) => {
  const target = event.target instanceof Element ? event.target.closest('.history-bar-hit') : null;
  if (!(target instanceof SVGElement)) {
    return;
  }

  showHistoryTooltip(target);
});

historyGrid?.addEventListener('focusout', () => {
  window.requestAnimationFrame(() => {
    const active = document.activeElement;
    if (!(active instanceof Element) || !active.closest('.history-chart-wrap')) {
      hideAllHistoryTooltips();
    }
  });
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
        <div class="history-tooltip" hidden></div>
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
  const leftAxisWidth = 30;
  const topPadding = 8;
  const rightPadding = 4;
  const bottomPadding = 16;
  const plotHeight = chartHeight - topPadding - bottomPadding;
  const plotWidth = chartWidth - leftAxisWidth - rightPadding;
  const gap = 2;
  const barWidth = points.length > 0
    ? (plotWidth - gap * Math.max(0, points.length - 1)) / points.length
    : plotWidth;
  const maxCount = Math.max(1, ...points.map((point) => point.count));
  const fill = tone === 'pipe' ? '#f7fbff' : '#1b2437';
  const accent = tone === 'pipe' ? 'rgba(255,255,255,0.22)' : 'rgba(17,24,39,0.14)';
  const gridStroke = tone === 'pipe' ? 'rgba(247,251,255,0.24)' : 'rgba(27,36,55,0.18)';
  const labelFill = tone === 'pipe' ? '#f7fbff' : '#1b2437';
  const tickValues = Array.from(new Set([maxCount, Math.ceil(maxCount / 2), 0]));

  const grid = tickValues.map((tick) => {
    const y = topPadding + plotHeight - (tick / maxCount) * plotHeight;
    return `
      <g>
        <text x="${leftAxisWidth - 4}" y="${(y + 3).toFixed(2)}" text-anchor="end" fill="${labelFill}" fill-opacity="0.88" font-size="7">${escapeHtml(numberFormatter.format(tick))}</text>
        <line x1="${leftAxisWidth}" y1="${y.toFixed(2)}" x2="${(chartWidth - rightPadding).toFixed(2)}" y2="${y.toFixed(2)}" stroke="${gridStroke}" stroke-width="2" />
      </g>
    `;
  }).join('');

  const bars = points.map((point, index) => {
    const height = point.count <= 0 ? 4 : Math.max(8, (point.count / maxCount) * plotHeight);
    const x = leftAxisWidth + index * (barWidth + gap);
    const y = topPadding + plotHeight - height;
    const tooltip = `${formatChartDay(point.date)} · ${numberFormatter.format(point.count)}`;
    return `
      <g>
        <rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${height.toFixed(2)}" rx="2" ry="2" fill="${fill}" />
        <rect
          class="history-bar-hit"
          x="${x.toFixed(2)}"
          y="${topPadding}"
          width="${barWidth.toFixed(2)}"
          height="${plotHeight.toFixed(2)}"
          rx="2"
          ry="2"
          fill="transparent"
          tabindex="0"
          data-tooltip="${escapeHtml(tooltip)}"
          aria-label="${escapeHtml(tooltip)}"
        >
          <title>${escapeHtml(tooltip)}</title>
        </rect>
      </g>
    `;
  }).join('');

  return `
    <svg class="history-chart" viewBox="0 0 ${chartWidth} ${chartHeight}" role="img" aria-label="${escapeHtml(labelSeries(points))}">
      <rect x="0" y="0" width="${chartWidth}" height="${chartHeight}" rx="12" ry="12" fill="${accent}" />
      ${grid}
      ${bars}
    </svg>
  `;
}

function showHistoryTooltip(target: SVGElement, clientX?: number, clientY?: number): void {
  const wrap = target.closest('.history-chart-wrap');
  if (!(wrap instanceof HTMLElement)) {
    return;
  }

  hideAllHistoryTooltips();

  const tooltip = wrap.querySelector('.history-tooltip');
  if (!(tooltip instanceof HTMLDivElement)) {
    return;
  }

  const text = target.getAttribute('data-tooltip');
  if (!text) {
    return;
  }

  tooltip.textContent = text;
  tooltip.hidden = false;

  const wrapRect = wrap.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const x = clientX !== undefined
    ? clientX - wrapRect.left
    : targetRect.left - wrapRect.left + targetRect.width / 2;
  const y = clientY !== undefined
    ? clientY - wrapRect.top - 12
    : targetRect.top - wrapRect.top - 8;

  const clampedX = clamp(x, 48, Math.max(48, wrapRect.width - 48));
  const clampedY = Math.max(10, y);

  tooltip.style.left = `${clampedX}px`;
  tooltip.style.top = `${clampedY}px`;
}

function hideAllHistoryTooltips(): void {
  document.querySelectorAll<HTMLDivElement>('.history-tooltip').forEach((tooltip) => {
    tooltip.hidden = true;
  });
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

type DashboardTone = 'question' | 'brick' | 'pipe';

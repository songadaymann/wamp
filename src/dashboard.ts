import type { DashboardStatsResponse } from './dashboard/model';
import { getApiBaseUrl } from './api/baseUrl';

const REFRESH_INTERVAL_MS = 60_000;
const numberFormatter = new Intl.NumberFormat();
const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const refreshButton = document.getElementById('refresh-button') as HTMLButtonElement | null;
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
}

function renderMeta(): void {
  if (refreshButton) {
    refreshButton.disabled = refreshInFlight;
  }

  if (lastUpdated) {
    if (!snapshot) {
      lastUpdated.textContent = 'No snapshot loaded yet.';
    } else {
      const snapshotTime = formatTimestamp(snapshot.generatedAt);
      const fetchTime = lastGoodFetchAt ? formatTimestamp(lastGoodFetchAt) : 'n/a';
      lastUpdated.textContent = `Snapshot ${snapshotTime} · fetched ${fetchTime}`;
    }
  }

  if (!status) {
    return;
  }

  if (refreshInFlight && !snapshot) {
    status.textContent = 'Fetching current totals.';
    return;
  }

  if (refreshInFlight) {
    status.textContent = 'Refreshing snapshot.';
    return;
  }

  if (lastError) {
    status.textContent = `${lastError} Showing the last good snapshot.`;
    return;
  }

  status.textContent = 'Refreshing every 60s while this tab is visible.';
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

function createCardMarkup(label: string, value: string, tone: 'question' | 'brick' | 'pipe'): string {
  return `
    <article class="stat-card" data-tone="${escapeHtml(tone)}">
      <div class="stat-label">${escapeHtml(label)}</div>
      <div class="stat-value">${escapeHtml(value)}</div>
    </article>
  `;
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

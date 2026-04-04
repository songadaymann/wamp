import type {
  LaunchStatsActivityWindow,
  LaunchStatsRecentEvent,
  LaunchStatsResponse,
  PartyKitShardHeartbeat,
} from './admin/model';
import { getApiBaseUrl } from './api/baseUrl';

const ADMIN_KEY_STORAGE_KEY = 'ep_launch_admin_api_key';
const POLL_INTERVAL_MS = 10_000;
const WARN_AGE_MS = 30_000;
const CRITICAL_AGE_MS = 90_000;

const adminKeyInput = document.getElementById('admin-key-input') as HTMLInputElement | null;
const saveKeyButton = document.getElementById('save-key-button') as HTMLButtonElement | null;
const refreshButton = document.getElementById('refresh-button') as HTMLButtonElement | null;
const clearKeyButton = document.getElementById('clear-key-button') as HTMLButtonElement | null;
const authStatus = document.getElementById('auth-status') as HTMLDivElement | null;
const lastUpdated = document.getElementById('last-updated') as HTMLDivElement | null;
const warnings = document.getElementById('warnings') as HTMLDivElement | null;
const configChips = document.getElementById('config-chips') as HTMLDivElement | null;
const totalsGrid = document.getElementById('totals-grid') as HTMLDivElement | null;
const activityGrid = document.getElementById('activity-grid') as HTMLDivElement | null;
const activityFeed = document.getElementById('activity-feed') as HTMLDivElement | null;
const partykitSummary = document.getElementById('partykit-summary') as HTMLDivElement | null;
const partykitShardsBody = document.getElementById('partykit-shards-body') as HTMLTableSectionElement | null;

let adminKey = window.sessionStorage.getItem(ADMIN_KEY_STORAGE_KEY) ?? '';
let lastSnapshot: LaunchStatsResponse | null = null;
let lastError: string | null = null;
let lastGoodSnapshotAt: string | null = null;
let pollingTimer: number | null = null;
let refreshInFlight = false;

if (adminKeyInput) {
  adminKeyInput.value = adminKey;
}

saveKeyButton?.addEventListener('click', () => {
  const nextKey = adminKeyInput?.value.trim() ?? '';
  adminKey = nextKey;
  if (adminKey) {
    window.sessionStorage.setItem(ADMIN_KEY_STORAGE_KEY, adminKey);
    lastError = null;
    syncPolling();
    void refreshSnapshot();
  } else {
    render();
  }
});

refreshButton?.addEventListener('click', () => {
  void refreshSnapshot(true);
});

clearKeyButton?.addEventListener('click', () => {
  adminKey = '';
  lastError = null;
  window.sessionStorage.removeItem(ADMIN_KEY_STORAGE_KEY);
  if (adminKeyInput) {
    adminKeyInput.value = '';
  }
  syncPolling();
  render();
});

document.addEventListener('visibilitychange', () => {
  syncPolling();
  if (document.visibilityState === 'visible' && adminKey) {
    void refreshSnapshot();
  }
});

syncPolling();
if (adminKey) {
  void refreshSnapshot();
} else {
  render();
}

function syncPolling(): void {
  const shouldPoll = Boolean(adminKey) && document.visibilityState === 'visible';
  if (!shouldPoll) {
    if (pollingTimer !== null) {
      window.clearInterval(pollingTimer);
      pollingTimer = null;
    }
    return;
  }

  if (pollingTimer === null) {
    pollingTimer = window.setInterval(() => {
      void refreshSnapshot();
    }, POLL_INTERVAL_MS);
  }
}

async function refreshSnapshot(force = false): Promise<void> {
  if (!adminKey) {
    lastError = 'Paste the admin key to start polling.';
    render();
    return;
  }

  if (document.visibilityState !== 'visible' && !force) {
    return;
  }

  if (refreshInFlight) {
    return;
  }

  refreshInFlight = true;
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/admin/launch-stats`, {
      headers: {
        'x-admin-key': adminKey,
      },
    });

    if (!response.ok) {
      const text = (await response.text()).trim();
      if (response.status === 403) {
        throw new Error('Invalid admin key.');
      }
      throw new Error(text || `Request failed with status ${response.status}.`);
    }

    lastSnapshot = (await response.json()) as LaunchStatsResponse;
    lastGoodSnapshotAt = new Date().toISOString();
    lastError = null;
  } catch (error) {
    lastError = error instanceof Error ? error.message : 'Unknown launch-stats failure.';
  } finally {
    refreshInFlight = false;
    render();
  }
}

function render(): void {
  renderMeta();
  renderWarnings();
  renderConfig();
  renderTotals();
  renderActivity();
  renderPartykitSummary();
  renderShards();
}

function renderMeta(): void {
  if (authStatus) {
    const normalizedError =
      lastError && lastError.endsWith('.') ? lastError.slice(0, -1) : lastError;
    authStatus.textContent = adminKey
      ? normalizedError
        ? `Last error: ${normalizedError}. Retaining the last good snapshot.`
        : 'Polling every 10s while this tab is visible.'
      : 'Paste the admin key to start polling.';
  }

  if (!lastUpdated) {
    return;
  }

  if (!lastSnapshot) {
    lastUpdated.textContent = 'No snapshot loaded yet.';
    return;
  }

  const generated = formatTimestamp(lastSnapshot.generatedAt);
  const fetched = lastGoodSnapshotAt ? formatTimestamp(lastGoodSnapshotAt) : 'n/a';
  lastUpdated.textContent = `Snapshot ${generated} · last good fetch ${fetched}`;
}

function renderWarnings(): void {
  if (!warnings) {
    return;
  }

  const items: Array<{ level: 'warn' | 'danger'; text: string }> = [];
  if (lastError) {
    items.push({
      level: 'danger',
      text: lastError,
    });
  }

  if (lastSnapshot?.config.debugMagicLinks) {
    items.push({
      level: 'danger',
      text: 'AUTH_DEBUG_MAGIC_LINKS is enabled in this environment.',
    });
  }

  if (lastSnapshot?.config.testResetEnabled) {
    items.push({
      level: 'danger',
      text: 'ENABLE_TEST_RESET is enabled in this environment.',
    });
  }

  if (lastSnapshot && lastSnapshot.partykit.configured && !lastSnapshot.partykit.reachable) {
    items.push({
      level: 'danger',
      text: `PartyKit is unreachable: ${lastSnapshot.partykit.error ?? 'Unknown failure.'}`,
    });
  }

  const shardState = summarizeShardAges(lastSnapshot?.partykit.stats?.shards ?? []);
  if (shardState.critical > 0) {
    items.push({
      level: 'danger',
      text: `${shardState.critical} shard heartbeat${shardState.critical === 1 ? ' is' : 's are'} older than 90s.`,
    });
  } else if (shardState.warning > 0) {
    items.push({
      level: 'warn',
      text: `${shardState.warning} shard heartbeat${shardState.warning === 1 ? ' is' : 's are'} older than 30s.`,
    });
  }

  warnings.innerHTML =
    items.length > 0
      ? items
          .map(
            (item) =>
              `<div class="warning${item.level === 'danger' ? ' danger' : ''}">${escapeHtml(
                item.text
              )}</div>`
          )
          .join('')
      : '<div class="meta">No active warnings.</div>';
}

function renderConfig(): void {
  if (!configChips) {
    return;
  }

  if (!lastSnapshot) {
    configChips.innerHTML = '<div class="meta">No config data yet.</div>';
    return;
  }

  const chips = [
    buildChip(
      'Email',
      lastSnapshot.config.emailConfigured ? 'configured' : 'missing',
      lastSnapshot.config.emailConfigured ? 'good' : 'warn'
    ),
    buildChip(
      'Debug links',
      lastSnapshot.config.debugMagicLinks ? 'enabled' : 'off',
      lastSnapshot.config.debugMagicLinks ? 'danger' : 'good'
    ),
    buildChip(
      'Test reset',
      lastSnapshot.config.testResetEnabled ? 'enabled' : 'off',
      lastSnapshot.config.testResetEnabled ? 'danger' : 'good'
    ),
    buildChip(
      'PartyKit',
      lastSnapshot.config.partykitConfigured ? 'configured' : 'off',
      lastSnapshot.config.partykitConfigured ? 'good' : 'warn'
    ),
  ];

  configChips.innerHTML = chips.join('');
}

function renderTotals(): void {
  if (!totalsGrid) {
    return;
  }

  if (!lastSnapshot) {
    totalsGrid.innerHTML = '<div class="meta">No totals yet.</div>';
    return;
  }

  const totals = lastSnapshot.totals;
  const cards: Array<[string, number]> = [
    ['Users', totals.users],
    ['Active Sessions', totals.activeSessions],
    ['Rooms', totals.rooms],
    ['Published Rooms', totals.publishedRooms],
    ['Room Runs', totals.roomRuns],
    ['Courses', totals.courses],
    ['Course Runs', totals.courseRuns],
    ['Chat Messages', totals.chatMessages],
    ['Agents', totals.agents],
    ['Agent Tokens', totals.agentTokens],
  ];

  totalsGrid.innerHTML = cards
    .map(
      ([label, value]) => `
        <article class="card">
          <span class="label">${escapeHtml(label)}</span>
          <span class="value">${formatNumber(value)}</span>
        </article>
      `
    )
    .join('');
}

function renderActivity(): void {
  if (!activityGrid) {
    return;
  }

  if (!lastSnapshot) {
    activityGrid.innerHTML = '<div class="meta">No activity yet.</div>';
    if (activityFeed) {
      activityFeed.innerHTML = '<div class="meta">No recent events yet.</div>';
    }
    return;
  }

  const windows: Array<[string, LaunchStatsActivityWindow]> = [
    ['Last 5m', lastSnapshot.activity.last5m],
    ['Last 15m', lastSnapshot.activity.last15m],
    ['Last 60m', lastSnapshot.activity.last60m],
  ];

  activityGrid.innerHTML = windows
    .map(
      ([label, windowStats]) => `
        <article class="card stack">
          <span class="label">${escapeHtml(label)}</span>
          <div class="meta">Users ${formatNumber(windowStats.newUsers)} · Magic links ${formatNumber(
            windowStats.magicLinksCreated
          )}</div>
          <div class="meta">Chat ${formatNumber(windowStats.chatMessages)} · Room publishes ${formatNumber(
            windowStats.roomPublishes
          )}</div>
          <div class="meta">Room runs ${formatNumber(windowStats.roomRunStarts)} start / ${formatNumber(
            windowStats.roomRunFinishes
          )} finish</div>
          <div class="meta">Course runs ${formatNumber(
            windowStats.courseRunStarts
          )} start / ${formatNumber(windowStats.courseRunFinishes)} finish</div>
        </article>
      `
    )
    .join('');

  if (!activityFeed) {
    return;
  }

  const events = lastSnapshot.recentEvents ?? [];
  if (events.length === 0) {
    activityFeed.innerHTML = '<div class="meta">No recent events yet.</div>';
    return;
  }

  activityFeed.innerHTML = events
    .map(
      (event) => `
        <article class="card activity-row">
          <div class="activity-head">
            <span class="label">${escapeHtml(renderEventKindLabel(event.kind))}</span>
            <span class="meta">${escapeHtml(formatTimestamp(event.at))}</span>
          </div>
          <div>${escapeHtml(renderEventSummary(event))}</div>
          <div class="meta">${escapeHtml(renderEventDetail(event))}</div>
        </article>
      `
    )
    .join('');
}

function renderPartykitSummary(): void {
  if (!partykitSummary) {
    return;
  }

  if (!lastSnapshot) {
    partykitSummary.innerHTML = '<div class="meta">No PartyKit data yet.</div>';
    return;
  }

  const { partykit } = lastSnapshot;
  const stats = partykit.stats;
  const cards = [
    ['Configured', partykit.configured ? 'Yes' : 'No'],
    ['Reachable', partykit.reachable ? 'Yes' : 'No'],
    ['Shards', formatNumber(stats?.shardCount ?? 0)],
    ['Connections', formatNumber(stats?.totalConnections ?? 0)],
    ['Play Ghosts', formatNumber(stats?.totalPlayConnections ?? 0)],
    ['Editors', formatNumber(stats?.totalEditConnections ?? 0)],
  ];

  partykitSummary.innerHTML =
    cards
      .map(
        ([label, value]) => `
          <article class="card">
            <span class="label">${escapeHtml(label)}</span>
            <span class="value">${escapeHtml(value)}</span>
          </article>
        `
      )
      .join('') +
    (partykit.error
      ? `<article class="card"><span class="label">Last Error</span><div class="meta">${escapeHtml(
          partykit.error
        )}</div></article>`
      : '') +
    (stats
      ? `<article class="card"><span class="label">Metrics Snapshot</span><div class="meta">${escapeHtml(
          formatTimestamp(stats.fetchedAt)
        )} · pruned ${formatNumber(stats.staleShardCount)} stale shard${
          stats.staleShardCount === 1 ? '' : 's'
        }</div></article>`
      : '');
}

function renderShards(): void {
  if (!partykitShardsBody) {
    return;
  }

  const shards = lastSnapshot?.partykit.stats?.shards ?? [];
  if (shards.length === 0) {
    partykitShardsBody.innerHTML =
      '<tr><td colspan="5" class="meta">No shard data yet.</td></tr>';
    return;
  }

  partykitShardsBody.innerHTML = shards
    .map((shard) => {
      const ageMs = Math.max(0, Date.now() - Date.parse(shard.updatedAt));
      const rowClass = ageMs > CRITICAL_AGE_MS ? 'danger' : ageMs > WARN_AGE_MS ? 'warn' : '';

      return `
        <tr class="${rowClass}">
          <td>${escapeHtml(shard.shardId)}</td>
          <td>${formatNumber(shard.totalConnections)}</td>
          <td>${formatNumber(shard.playConnections)}</td>
          <td>${formatNumber(shard.editConnections)}</td>
          <td>${escapeHtml(formatAge(ageMs))}</td>
        </tr>
      `;
    })
    .join('');
}

function summarizeShardAges(shards: PartyKitShardHeartbeat[]): {
  warning: number;
  critical: number;
} {
  let warning = 0;
  let critical = 0;

  for (const shard of shards) {
    const ageMs = Math.max(0, Date.now() - Date.parse(shard.updatedAt));
    if (ageMs > CRITICAL_AGE_MS) {
      critical += 1;
    } else if (ageMs > WARN_AGE_MS) {
      warning += 1;
    }
  }

  return { warning, critical };
}

function buildChip(label: string, value: string, tone: 'good' | 'warn' | 'danger'): string {
  return `<span class="chip ${tone}">${escapeHtml(label)}: ${escapeHtml(value)}</span>`;
}

function renderEventKindLabel(kind: LaunchStatsRecentEvent['kind']): string {
  switch (kind) {
    case 'room_claim':
      return 'Room Claim';
    case 'room_publish':
      return 'Room Publish';
    case 'room_attempt_burst':
      return 'Attempt Burst';
    default:
      return 'Event';
  }
}

function renderEventSummary(event: LaunchStatsRecentEvent): string {
  const actor = event.actorDisplayName || 'Unknown';
  const roomLabel = formatRoomLabel(event);

  switch (event.kind) {
    case 'room_claim':
      return `${actor} claimed ${roomLabel}.`;
    case 'room_publish':
      return `${actor} published ${roomLabel}${event.roomVersion ? ` v${event.roomVersion}` : ''}.`;
    case 'room_attempt_burst': {
      const attempts = event.attemptCount ?? 0;
      const completions = event.completedCount ?? 0;
      const completionSuffix =
        completions > 0 ? `, including ${completions} completion${completions === 1 ? '' : 's'}` : '';
      return `${actor} did ${attempts} attempt${attempts === 1 ? '' : 's'} in ${roomLabel}${completionSuffix}.`;
    }
    default:
      return `${actor} did something in ${roomLabel}.`;
  }
}

function renderEventDetail(event: LaunchStatsRecentEvent): string {
  const parts: string[] = [];
  if (event.roomId) {
    parts.push(`room ${event.roomId}`);
  }
  if (event.roomX !== null && event.roomY !== null) {
    parts.push(`${event.roomX},${event.roomY}`);
  }
  return parts.join(' · ') || 'No additional detail.';
}

function formatRoomLabel(event: LaunchStatsRecentEvent): string {
  const title = event.roomTitle?.trim();
  if (title) {
    return `"${title}"`;
  }
  if (event.roomX !== null && event.roomY !== null) {
    return `room ${event.roomX},${event.roomY}`;
  }
  return 'a room';
}

function formatTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }

  return new Date(parsed).toLocaleString();
}

function formatAge(ageMs: number): string {
  const seconds = Math.round(ageMs / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

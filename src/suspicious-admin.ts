import type {
  SuspiciousInvalidationPreviewResponse,
  SuspiciousInvalidationResult,
  SuspiciousSeverity,
  SuspiciousSummaryResponse,
  SuspiciousUserCase,
  SuspiciousUserDetailResponse,
  SuspiciousUsersResponse,
} from './admin/model';
import { getApiBaseUrl } from './api/baseUrl';

const ADMIN_KEY_STORAGE_KEY = 'ep_launch_admin_api_key';

const adminKeyInput = document.getElementById('admin-key-input') as HTMLInputElement | null;
const saveKeyButton = document.getElementById('save-key-button') as HTMLButtonElement | null;
const refreshButton = document.getElementById('refresh-button') as HTMLButtonElement | null;
const clearKeyButton = document.getElementById('clear-key-button') as HTMLButtonElement | null;
const authStatus = document.getElementById('auth-status') as HTMLDivElement | null;
const lastUpdated = document.getElementById('last-updated') as HTMLDivElement | null;

const windowHoursSelect = document.getElementById('window-hours-select') as HTMLSelectElement | null;
const severitySelect = document.getElementById('severity-select') as HTMLSelectElement | null;
const signalSelect = document.getElementById('signal-select') as HTMLSelectElement | null;
const searchInput = document.getElementById('search-input') as HTMLInputElement | null;
const applyFiltersButton = document.getElementById('apply-filters-button') as HTMLButtonElement | null;

const summaryGrid = document.getElementById('summary-grid') as HTMLDivElement | null;
const recentInvalidations = document.getElementById('recent-invalidations') as HTMLDivElement | null;
const queueCount = document.getElementById('queue-count') as HTMLDivElement | null;
const queueList = document.getElementById('queue-list') as HTMLDivElement | null;

const detailEmpty = document.getElementById('detail-empty') as HTMLDivElement | null;
const detailShell = document.getElementById('detail-shell') as HTMLDivElement | null;
const detailStatus = document.getElementById('detail-status') as HTMLDivElement | null;
const detailUserName = document.getElementById('detail-user-name') as HTMLDivElement | null;
const detailUserSeverity = document.getElementById('detail-user-severity') as HTMLSpanElement | null;
const detailUserMeta = document.getElementById('detail-user-meta') as HTMLDivElement | null;
const detailSignals = document.getElementById('detail-signals') as HTMLDivElement | null;
const reasonInput = document.getElementById('reason-input') as HTMLTextAreaElement | null;
const operatorLabelInput = document.getElementById('operator-label-input') as HTMLInputElement | null;
const selectionSummary = document.getElementById('selection-summary') as HTMLDivElement | null;
const previewButton = document.getElementById('preview-button') as HTMLButtonElement | null;
const executeButton = document.getElementById('execute-button') as HTMLButtonElement | null;
const actionStatus = document.getElementById('action-status') as HTMLDivElement | null;
const detailRoomRuns = document.getElementById('detail-room-runs') as HTMLTableSectionElement | null;
const detailCourseRuns = document.getElementById('detail-course-runs') as HTMLTableSectionElement | null;
const detailPointEvents = document.getElementById('detail-point-events') as HTMLTableSectionElement | null;
const detailInvalidations = document.getElementById('detail-invalidations') as HTMLDivElement | null;
const previewEmpty = document.getElementById('preview-empty') as HTMLDivElement | null;
const previewShell = document.getElementById('preview-shell') as HTMLDivElement | null;
const previewMeta = document.getElementById('preview-meta') as HTMLDivElement | null;
const previewUsers = document.getElementById('preview-users') as HTMLDivElement | null;
const previewPointEvents = document.getElementById('preview-point-events') as HTMLTableSectionElement | null;

type SeverityFilter = 'all' | SuspiciousSeverity;

interface ViewState {
  adminKey: string;
  windowHours: number;
  severity: SeverityFilter;
  signal: string;
  query: string;
  summary: SuspiciousSummaryResponse | null;
  users: SuspiciousUserCase[];
  selectedUserId: string | null;
  detail: SuspiciousUserDetailResponse | null;
  preview: SuspiciousInvalidationPreviewResponse | SuspiciousInvalidationResult | null;
  selectedRoomRunIds: Set<string>;
  selectedCourseRunIds: Set<string>;
  selectedPointEventIds: Set<string>;
  loading: boolean;
  detailLoading: boolean;
  previewLoading: boolean;
  actionLoading: boolean;
  lastError: string | null;
}

const state: ViewState = {
  adminKey: window.sessionStorage.getItem(ADMIN_KEY_STORAGE_KEY) ?? '',
  windowHours: 24,
  severity: 'all',
  signal: 'all',
  query: '',
  summary: null,
  users: [],
  selectedUserId: null,
  detail: null,
  preview: null,
  selectedRoomRunIds: new Set<string>(),
  selectedCourseRunIds: new Set<string>(),
  selectedPointEventIds: new Set<string>(),
  loading: false,
  detailLoading: false,
  previewLoading: false,
  actionLoading: false,
  lastError: null,
};

if (adminKeyInput) {
  adminKeyInput.value = state.adminKey;
}
if (windowHoursSelect) {
  windowHoursSelect.value = String(state.windowHours);
}
if (severitySelect) {
  severitySelect.value = state.severity;
}
if (signalSelect) {
  signalSelect.value = state.signal;
}

saveKeyButton?.addEventListener('click', () => {
  const nextKey = adminKeyInput?.value.trim() ?? '';
  state.adminKey = nextKey;
  if (nextKey) {
    window.sessionStorage.setItem(ADMIN_KEY_STORAGE_KEY, nextKey);
  } else {
    window.sessionStorage.removeItem(ADMIN_KEY_STORAGE_KEY);
  }
  state.lastError = null;
  void refreshAll();
});

refreshButton?.addEventListener('click', () => {
  void refreshAll(true);
});

clearKeyButton?.addEventListener('click', () => {
  state.adminKey = '';
  state.lastError = null;
  state.summary = null;
  state.users = [];
  state.selectedUserId = null;
  state.detail = null;
  state.preview = null;
  state.selectedRoomRunIds.clear();
  state.selectedCourseRunIds.clear();
  state.selectedPointEventIds.clear();
  window.sessionStorage.removeItem(ADMIN_KEY_STORAGE_KEY);
  if (adminKeyInput) {
    adminKeyInput.value = '';
  }
  render();
});

applyFiltersButton?.addEventListener('click', () => {
  syncFiltersFromInputs();
  void refreshAll();
});

queueList?.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const button = target.closest<HTMLButtonElement>('button[data-user-id]');
  if (!button) {
    return;
  }
  const userId = button.dataset.userId?.trim() ?? '';
  if (!userId) {
    return;
  }
  void loadDetail(userId);
});

detailRoomRuns?.addEventListener('change', handleSelectionChange);
detailCourseRuns?.addEventListener('change', handleSelectionChange);
detailPointEvents?.addEventListener('change', handleSelectionChange);

previewButton?.addEventListener('click', () => {
  void previewInvalidation();
});

executeButton?.addEventListener('click', () => {
  void executeInvalidation();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.adminKey) {
    void refreshAll();
  }
});

render();
if (state.adminKey) {
  void refreshAll();
}

async function refreshAll(force = false): Promise<void> {
  if (!state.adminKey) {
    render();
    return;
  }

  if (state.loading && !force) {
    return;
  }

  syncFiltersFromInputs();
  state.loading = true;
  state.lastError = null;
  render();

  try {
    const [summary, usersResponse] = await Promise.all([
      adminRequest<SuspiciousSummaryResponse>(buildAdminPath('/api/admin/suspicious/summary')),
      adminRequest<SuspiciousUsersResponse>(buildAdminPath('/api/admin/suspicious/users')),
    ]);
    state.summary = summary;
    state.users = usersResponse.items;

    if (state.selectedUserId && !state.users.some((user) => user.userId === state.selectedUserId)) {
      state.selectedUserId = null;
      state.detail = null;
      state.preview = null;
      state.selectedRoomRunIds.clear();
      state.selectedCourseRunIds.clear();
      state.selectedPointEventIds.clear();
    }

    if (state.selectedUserId) {
      await loadDetail(state.selectedUserId, true);
    }
  } catch (error) {
    state.lastError = getErrorMessage(error, 'Failed to load suspicious activity.');
  } finally {
    state.loading = false;
    render();
  }
}

async function loadDetail(userId: string, preserveSelection = false): Promise<void> {
  if (!state.adminKey) {
    return;
  }

  state.selectedUserId = userId;
  state.detailLoading = true;
  state.preview = null;
  render();

  try {
    const detail = await adminRequest<SuspiciousUserDetailResponse>(
      buildAdminPath(`/api/admin/suspicious/users/${encodeURIComponent(userId)}`)
    );
    state.detail = detail;
    if (!preserveSelection) {
      state.selectedRoomRunIds = new Set(detail.roomRuns.map((run) => run.attemptId));
      state.selectedCourseRunIds = new Set(detail.courseRuns.map((run) => run.attemptId));
      state.selectedPointEventIds =
        detail.roomRuns.length === 0 && detail.courseRuns.length === 0
          ? new Set(detail.recentPointEvents.map((event) => event.id))
          : new Set();
    }
  } catch (error) {
    state.detail = null;
    state.preview = null;
    state.selectedRoomRunIds.clear();
    state.selectedCourseRunIds.clear();
    state.selectedPointEventIds.clear();
    setStatus(detailStatus, getErrorMessage(error, 'Failed to load suspicious user detail.'), true);
  } finally {
    state.detailLoading = false;
    render();
  }
}

async function previewInvalidation(): Promise<void> {
  if (!state.selectedUserId || !state.detail) {
    return;
  }

  const reason = reasonInput?.value.trim() ?? '';
  if (!reason) {
    setStatus(actionStatus, 'Reason is required for preview.', true);
    return;
  }

  state.previewLoading = true;
  setStatus(actionStatus, 'Loading preview...', false);
  render();

  try {
    state.preview = await adminRequest<SuspiciousInvalidationPreviewResponse>(
      `/api/admin/suspicious/users/${encodeURIComponent(state.selectedUserId)}/invalidate-preview`,
      {
        method: 'POST',
        body: JSON.stringify({
          roomRunAttemptIds: [...state.selectedRoomRunIds],
          courseRunAttemptIds: [...state.selectedCourseRunIds],
          pointEventIds: [...state.selectedPointEventIds],
          reason,
        }),
      }
    );
    setStatus(actionStatus, 'Preview ready.', false, true);
  } catch (error) {
    setStatus(actionStatus, getErrorMessage(error, 'Failed to preview invalidation.'), true);
  } finally {
    state.previewLoading = false;
    render();
  }
}

async function executeInvalidation(): Promise<void> {
  if (!state.selectedUserId || !state.detail) {
    return;
  }

  const reason = reasonInput?.value.trim() ?? '';
  const operatorLabel = operatorLabelInput?.value.trim() ?? '';
  if (!reason) {
    setStatus(actionStatus, 'Reason is required before invalidating.', true);
    return;
  }
  if (!operatorLabel) {
    setStatus(actionStatus, 'Operator label is required before invalidating.', true);
    return;
  }

  if (!window.confirm('Delete the selected local runs and point events? This cannot be undone from the UI.')) {
    return;
  }

  state.actionLoading = true;
  setStatus(actionStatus, 'Executing invalidation...', false);
  render();

  try {
    state.preview = await adminRequest<SuspiciousInvalidationResult>(
      `/api/admin/suspicious/users/${encodeURIComponent(state.selectedUserId)}/invalidate`,
      {
        method: 'POST',
        body: JSON.stringify({
          roomRunAttemptIds: [...state.selectedRoomRunIds],
          courseRunAttemptIds: [...state.selectedCourseRunIds],
          pointEventIds: [...state.selectedPointEventIds],
          reason,
          operatorLabel,
        }),
      }
    );
    setStatus(actionStatus, 'Invalidation complete.', false, true);
    await refreshAll(true);
  } catch (error) {
    setStatus(actionStatus, getErrorMessage(error, 'Failed to execute invalidation.'), true);
  } finally {
    state.actionLoading = false;
    render();
  }
}

function handleSelectionChange(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') {
    return;
  }
  const attemptId = target.dataset.attemptId?.trim() ?? '';
  const kind = target.dataset.kind;
  if (!attemptId || (kind !== 'room' && kind !== 'course' && kind !== 'point')) {
    return;
  }

  const set =
    kind === 'room'
      ? state.selectedRoomRunIds
      : kind === 'course'
        ? state.selectedCourseRunIds
        : state.selectedPointEventIds;
  if (target.checked) {
    set.add(attemptId);
  } else {
    set.delete(attemptId);
  }
  state.preview = null;
  render();
}

async function adminRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-key': state.adminKey,
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = (await response.text()).trim();
    if (response.status === 403) {
      throw new Error('Invalid admin key.');
    }
    throw new Error(text || `Request failed with status ${response.status}.`);
  }

  return (await response.json()) as T;
}

function buildAdminPath(pathname: string): string {
  const params = new URLSearchParams();
  params.set('windowHours', String(state.windowHours));
  if (state.severity !== 'all') {
    params.set('severity', state.severity);
  }
  if (state.signal !== 'all') {
    params.set('signal', state.signal);
  }
  const query = searchInput?.value.trim() ?? state.query;
  if (query) {
    params.set('q', query);
  }
  return `${pathname}?${params.toString()}`;
}

function syncFiltersFromInputs(): void {
  state.windowHours = Number(windowHoursSelect?.value ?? state.windowHours) || 24;
  state.severity = (severitySelect?.value as SeverityFilter | undefined) ?? 'all';
  state.signal = signalSelect?.value ?? 'all';
  state.query = searchInput?.value.trim() ?? '';
}

function render(): void {
  renderMeta();
  renderSummary();
  renderRecentInvalidations();
  renderQueue();
  renderDetail();
  renderPreview();
}

function renderMeta(): void {
  if (lastUpdated) {
    if (state.summary) {
      lastUpdated.textContent = `Snapshot ${formatTimestamp(state.summary.generatedAt)} · window ${state.summary.windowHours}h`;
    } else {
      lastUpdated.textContent = 'No snapshot loaded yet.';
    }
  }

  if (!authStatus) {
    return;
  }

  if (!state.adminKey) {
    setStatus(authStatus, 'Paste the admin key to start reviewing suspicious activity.', false);
    return;
  }

  if (state.lastError) {
    setStatus(authStatus, state.lastError, true);
    return;
  }

  const loadingLabel = state.loading ? 'Loading suspicious activity…' : 'Ready.';
  setStatus(authStatus, loadingLabel, false);
}

function renderSummary(): void {
  if (!summaryGrid) {
    return;
  }

  const counts = state.summary?.counts ?? { openCases: 0, high: 0, medium: 0, low: 0 };
  const cards = [
    ['Open Cases', String(counts.openCases)],
    ['High Severity', String(counts.high)],
    ['Medium Severity', String(counts.medium)],
    ['Low Severity', String(counts.low)],
  ];

  summaryGrid.replaceChildren();
  for (const [label, value] of cards) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<span class="label">${escapeHtml(label)}</span><div class="value">${escapeHtml(value)}</div>`;
    summaryGrid.appendChild(card);
  }
}

function renderRecentInvalidations(): void {
  if (!recentInvalidations) {
    return;
  }

  recentInvalidations.replaceChildren();
  const items = state.summary?.recentInvalidations ?? [];
  if (items.length === 0) {
    recentInvalidations.appendChild(buildEmpty('No invalidations yet.'));
    return;
  }

  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'audit-row';
    row.innerHTML = `
      <div class="audit-title">
        <strong>${escapeHtml(item.targetUserDisplayName)}</strong>
        <span class="chip ${item.remoteFollowUpRequired ? 'high' : 'low'}">
          ${item.remoteFollowUpRequired ? 'Remote follow-up needed' : 'Local only'}
        </span>
      </div>
      <div class="audit-meta">
        <div>${escapeHtml(item.reason)}</div>
        <div>${escapeHtml(item.operatorLabel)} · ${formatTimestamp(item.createdAt)}</div>
        <div>${item.roomRunCount} room runs · ${item.courseRunCount} course runs · ${item.pointEventCount} point events</div>
      </div>
    `;
    recentInvalidations.appendChild(row);
  }
}

function renderQueue(): void {
  if (queueCount) {
    queueCount.textContent = `${state.users.length} user${state.users.length === 1 ? '' : 's'}`;
  }
  if (!queueList) {
    return;
  }

  queueList.replaceChildren();
  if (state.loading && state.users.length === 0) {
    queueList.appendChild(buildEmpty('Loading suspicious users...'));
    return;
  }
  if (state.users.length === 0) {
    queueList.appendChild(buildEmpty('No suspicious users in the selected window.'));
    return;
  }

  for (const user of state.users) {
    const row = document.createElement('div');
    row.className = `queue-row${user.userId === state.selectedUserId ? ' active' : ''}`;
    row.innerHTML = `
      <button type="button" data-user-id="${escapeHtml(user.userId)}">
        <div class="queue-title">
          <strong>${escapeHtml(user.userDisplayName)}</strong>
          <span class="chip ${user.strongestSeverity}">${escapeHtml(user.strongestSeverity.toUpperCase())}</span>
        </div>
        <div class="queue-meta">
          <div>${user.recentCompletedRuns} recent runs · ${user.recentPoints} recent pts</div>
          <div>${escapeHtml(user.userId)}</div>
          <div>${escapeHtml(user.ogpId ?? 'No Play.fun link')} · ${user.lastActivityAt ? formatTimestamp(user.lastActivityAt) : 'No activity timestamp'}</div>
          <div class="chips">${user.signals
            .slice(0, 3)
            .map((signal) => `<span class="chip ${signal.severity}">${escapeHtml(signal.label)}</span>`)
            .join('')}</div>
        </div>
      </button>
    `;
    queueList.appendChild(row);
  }
}

function renderDetail(): void {
  const detail = state.detail;
  if (!detail || !detailShell || !detailEmpty) {
    if (detailShell) {
      detailShell.hidden = true;
    }
    if (detailEmpty) {
      detailEmpty.hidden = false;
    }
    return;
  }

  detailShell.hidden = false;
  detailEmpty.hidden = true;
  setStatus(detailStatus, state.detailLoading ? 'Loading detail…' : '', false);

  if (detailUserName) {
    detailUserName.textContent = detail.user.userDisplayName;
  }
  if (detailUserSeverity) {
    detailUserSeverity.className = `chip ${detail.user.strongestSeverity}`;
    detailUserSeverity.textContent = detail.user.strongestSeverity.toUpperCase();
  }
  if (detailUserMeta) {
    detailUserMeta.innerHTML = `
      <div>User id: ${escapeHtml(detail.user.userId)}</div>
      <div>OGP: ${escapeHtml(detail.user.ogpId ?? 'none')} · Player: ${escapeHtml(detail.user.playerId ?? 'none')}</div>
      <div>Created: ${formatTimestamp(detail.user.userCreatedAt)} · Last activity: ${detail.user.lastActivityAt ? formatTimestamp(detail.user.lastActivityAt) : 'n/a'}</div>
      <div>Total points: ${detail.user.totalPoints} · Completed runs: ${detail.user.completedRuns} · Recent points: ${detail.user.recentPoints}</div>
    `;
  }
  if (detailSignals) {
    detailSignals.innerHTML = detail.user.signals
      .map((signal) => `<span class="chip ${signal.severity}" title="${escapeHtml(signal.summary)}">${escapeHtml(signal.label)}</span>`)
      .join('');
  }

  renderRunTable(detailRoomRuns, detail.roomRuns, 'room');
  renderRunTable(detailCourseRuns, detail.courseRuns, 'course');
  renderPointEvents(detailPointEvents, detail.recentPointEvents);
  renderAuditList(detailInvalidations, detail.recentInvalidations, 'No prior invalidations for this user.');
  renderSelectionSummary();
}

function renderRunTable(
  body: HTMLTableSectionElement | null,
  runs: SuspiciousUserDetailResponse['roomRuns'] | SuspiciousUserDetailResponse['courseRuns'],
  kind: 'room' | 'course'
): void {
  if (!body) {
    return;
  }
  body.replaceChildren();
  if (runs.length === 0) {
    const row = document.createElement('tr');
    row.innerHTML = `<td colspan="5" class="meta">No suspicious ${kind} runs.</td>`;
    body.appendChild(row);
    return;
  }

  const selected = kind === 'room' ? state.selectedRoomRunIds : state.selectedCourseRunIds;
  for (const run of runs) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><input type="checkbox" data-kind="${kind}" data-attempt-id="${escapeHtml(run.attemptId)}" ${selected.has(run.attemptId) ? 'checked' : ''} /></td>
      <td>
        <strong>${escapeHtml(run.title ?? run.sourceId)}</strong><br />
        <span class="meta">${kind === 'room' ? `${run.roomX},${run.roomY} · ` : ''}v${run.version}</span>
      </td>
      <td>${escapeHtml(formatRunMetric(run))}</td>
      <td>${run.ruleCodes.map((code) => `<span class="chip ${run.severity}">${escapeHtml(code)}</span>`).join(' ')}</td>
      <td>${run.finishedAt ? formatTimestamp(run.finishedAt) : 'n/a'}</td>
    `;
    body.appendChild(row);
  }
}

function renderPointEvents(
  body: HTMLTableSectionElement | null,
  events: SuspiciousUserDetailResponse['recentPointEvents']
): void {
  if (!body) {
    return;
  }
  body.replaceChildren();
  if (events.length === 0) {
    const row = document.createElement('tr');
    row.innerHTML = '<td colspan="4" class="meta">No recent point events.</td>';
    body.appendChild(row);
    return;
  }

  for (const event of events) {
    const row = document.createElement('tr');
    const checked = state.selectedPointEventIds.has(event.id) ? 'checked' : '';
    row.innerHTML = `
      <td><input type="checkbox" data-kind="point" data-attempt-id="${escapeHtml(event.id)}" ${checked} /></td>
      <td>${escapeHtml(event.eventType)}</td>
      <td>${event.points}</td>
      <td>${formatTimestamp(event.createdAt)}</td>
    `;
    body.appendChild(row);
  }
}

function renderAuditList(
  container: HTMLDivElement | null,
  items: Array<{ targetUserDisplayName: string; operatorLabel: string; reason: string; createdAt: string; roomRunCount: number; courseRunCount: number; pointEventCount: number; remoteFollowUpRequired: boolean }>,
  emptyMessage: string
): void {
  if (!container) {
    return;
  }
  container.replaceChildren();
  if (items.length === 0) {
    container.appendChild(buildEmpty(emptyMessage));
    return;
  }

  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'audit-row';
    row.innerHTML = `
      <div class="audit-title">
        <strong>${escapeHtml(item.operatorLabel)}</strong>
        <span class="chip ${item.remoteFollowUpRequired ? 'high' : 'low'}">${item.remoteFollowUpRequired ? 'Remote follow-up' : 'Local only'}</span>
      </div>
      <div class="audit-meta">
        <div>${escapeHtml(item.reason)}</div>
        <div>${formatTimestamp(item.createdAt)}</div>
        <div>${item.roomRunCount} room runs · ${item.courseRunCount} course runs · ${item.pointEventCount} point events</div>
      </div>
    `;
    container.appendChild(row);
  }
}

function renderPreview(): void {
  const preview = state.preview;
  const hasPreview = Boolean(preview);
  if (previewEmpty) {
    previewEmpty.hidden = hasPreview;
  }
  if (!previewShell) {
    return;
  }
  previewShell.hidden = !hasPreview;
  if (!preview || !previewMeta || !previewUsers || !previewPointEvents) {
    return;
  }

  const followUpCount = preview.playfunSync.filter((row) => row.status === 'sent').length;
  previewMeta.innerHTML = `
    <div>${preview.summary.roomRunsDeleted} room runs · ${preview.summary.courseRunsDeleted} course runs</div>
    <div>${preview.summary.selectedPointEventsDeleted} selected point events · ${preview.summary.runPointEventsDeleted} run point events · ${preview.summary.creatorPointEventsDeleted} creator point events</div>
    <div>${preview.remoteFollowUpRequired ? `Remote Play.fun follow-up required for ${followUpCount} synced row${followUpCount === 1 ? '' : 's'}.` : 'No remote Play.fun follow-up required.'}</div>
  `;

  previewUsers.innerHTML = preview.affectedUsers
    .map((user) => `<span class="chip low">${escapeHtml(user.userDisplayName)}</span>`)
    .join('');

  previewPointEvents.replaceChildren();
  const pointEvents = [...preview.selectedPointEvents, ...preview.runPointEvents, ...preview.creatorPointEvents];
  if (pointEvents.length === 0) {
    const row = document.createElement('tr');
    row.innerHTML = '<td colspan="3" class="meta">No affected point events.</td>';
    previewPointEvents.appendChild(row);
  } else {
    for (const event of pointEvents) {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${escapeHtml(event.eventType)}</td>
        <td>${event.points}</td>
        <td>${formatTimestamp(event.createdAt)}</td>
      `;
      previewPointEvents.appendChild(row);
    }
  }
}

function renderSelectionSummary(): void {
  if (!selectionSummary) {
    return;
  }
  const roomCount = state.selectedRoomRunIds.size;
  const courseCount = state.selectedCourseRunIds.size;
  const pointCount = state.selectedPointEventIds.size;
  selectionSummary.textContent = `${roomCount} room runs, ${courseCount} course runs, and ${pointCount} point events selected.`;
}

function formatRunMetric(run: SuspiciousUserDetailResponse['roomRuns'][number]): string {
  const primary = run.rankingMode === 'time'
    ? `${formatDuration(run.elapsedMs)} · ${run.deaths} deaths`
    : `${run.score} score · ${run.deaths} deaths`;
  if (run.improvementMs !== null && run.improvementRatio !== null) {
    return `${primary} · ${formatDuration(run.improvementMs)} faster (${Math.round(run.improvementRatio * 100)}%)`;
  }
  if (run.repeatGroupCount !== null) {
    return `${primary} · ${run.repeatGroupCount} repeats`;
  }
  return primary;
}

function formatDuration(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return 'n/a';
  }
  if (value < 1_000) {
    return `${value}ms`;
  }
  return `${(value / 1_000).toFixed(2)}s`;
}

function formatTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }
  return new Date(parsed).toLocaleString();
}

function buildEmpty(message: string): HTMLDivElement {
  const element = document.createElement('div');
  element.className = 'empty';
  element.textContent = message;
  return element;
}

function setStatus(element: HTMLDivElement | null, message: string, isError: boolean, isSuccess = false): void {
  if (!element) {
    return;
  }
  element.textContent = message;
  element.className = `status${isError ? ' error' : isSuccess ? ' success' : ''}`;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function escapeHtml(value: string): string {
  return value
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;')
    .split("'").join('&#39;');
}

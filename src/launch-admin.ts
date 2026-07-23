import type {
  AdminProgressionCapsUpdateRequest,
  AdminProgressionUserCapsResponse,
  AdminProgressionUserLookupEntry,
  AdminProgressionUserLookupResponse,
  LaunchStatsActivityRange,
  LaunchStatsActivityRangeKey,
  LaunchStatsRecentCourseReference,
  LaunchStatsRecentRoomReference,
  LaunchStatsRecentSummary,
  LaunchStatsResponse,
  PartyKitShardHeartbeat,
} from './admin/model';
import { getApiBaseUrl } from './api/baseUrl';
import type {
  AdminRoomCommentListResponse,
  AdminRoomCommentRecord,
  AdminRoomCommentReviewResponse,
  RoomCommentStatus,
} from './roomComments/model';

const ADMIN_KEY_STORAGE_KEY = 'ep_launch_admin_api_key';
const ACTIVITY_RANGE_STORAGE_KEY = 'ep_launch_admin_activity_range';
const ACTIVITY_FILTER_STORAGE_KEY = 'ep_launch_admin_activity_filter';
const POLL_INTERVAL_MS = 10_000;
const WARN_AGE_MS = 30_000;
const CRITICAL_AGE_MS = 90_000;

type LaunchAdminActivityFilterKey =
  | 'all'
  | 'signups'
  | 'visit_only'
  | 'guest_play_build'
  | 'room_play'
  | 'room_claims'
  | 'room_publishes'
  | 'course_publishes';

const ACTIVITY_FILTERS: Array<{
  key: LaunchAdminActivityFilterKey;
  label: string;
}> = [
  { key: 'all', label: 'All Activity' },
  { key: 'signups', label: 'Signups' },
  { key: 'visit_only', label: 'Visit Only' },
  { key: 'guest_play_build', label: 'Guest Play/Build' },
  { key: 'room_play', label: 'Room Plays' },
  { key: 'room_claims', label: 'Room Claims' },
  { key: 'room_publishes', label: 'Room Publishes' },
  { key: 'course_publishes', label: 'Expanded/Course Publishes' },
];

const adminKeyInput = document.getElementById('admin-key-input') as HTMLInputElement | null;
const saveKeyButton = document.getElementById('save-key-button') as HTMLButtonElement | null;
const refreshButton = document.getElementById('refresh-button') as HTMLButtonElement | null;
const clearKeyButton = document.getElementById('clear-key-button') as HTMLButtonElement | null;
const authStatus = document.getElementById('auth-status') as HTMLDivElement | null;
const lastUpdated = document.getElementById('last-updated') as HTMLDivElement | null;
const warnings = document.getElementById('warnings') as HTMLDivElement | null;
const configChips = document.getElementById('config-chips') as HTMLDivElement | null;
const totalsGrid = document.getElementById('totals-grid') as HTMLDivElement | null;
const activityRangeSelect = document.getElementById('activity-range-select') as HTMLSelectElement | null;
const activityRangeSummary = document.getElementById('activity-range-summary') as HTMLDivElement | null;
const activityFilterList = document.getElementById('activity-filter-list') as HTMLDivElement | null;
const activityGrid = document.getElementById('activity-grid') as HTMLDivElement | null;
const activityFeed = document.getElementById('activity-feed') as HTMLDivElement | null;
const partykitSummary = document.getElementById('partykit-summary') as HTMLDivElement | null;
const partykitShardsBody = document.getElementById('partykit-shards-body') as HTMLTableSectionElement | null;
const progressionPanel = document.getElementById('progression-admin-panel') as HTMLElement | null;
const progressionQueryInput = document.getElementById('progression-query-input') as HTMLInputElement | null;
const progressionSearchButton = document.getElementById('progression-search-button') as HTMLButtonElement | null;
const progressionOperatorInput = document.getElementById('progression-operator-input') as HTMLInputElement | null;
const progressionStatus = document.getElementById('progression-status') as HTMLDivElement | null;
const progressionResults = document.getElementById('progression-results') as HTMLDivElement | null;
const progressionSelected = document.getElementById('progression-selected') as HTMLDivElement | null;
const progressionClaimInput = document.getElementById('progression-claim-input') as HTMLInputElement | null;
const progressionPublishInput = document.getElementById('progression-publish-input') as HTMLInputElement | null;
const progressionObjectInput = document.getElementById('progression-object-input') as HTMLInputElement | null;
const progressionCollectibleInput = document.getElementById('progression-collectible-input') as HTMLInputElement | null;
const progressionExpandedRoomInput = document.getElementById('progression-expanded-room-input') as HTMLInputElement | null;
const progressionReasonInput = document.getElementById('progression-reason-input') as HTMLTextAreaElement | null;
const progressionSaveButton = document.getElementById('progression-save-button') as HTMLButtonElement | null;
const progressionClearButton = document.getElementById('progression-clear-button') as HTMLButtonElement | null;
const roomCommentsStatusFilter = document.getElementById('room-comments-status-filter') as HTMLSelectElement | null;
const roomCommentsOperatorInput = document.getElementById('room-comments-operator-input') as HTMLInputElement | null;
const roomCommentsRefreshButton = document.getElementById('room-comments-refresh-button') as HTMLButtonElement | null;
const roomCommentsStatus = document.getElementById('room-comments-status') as HTMLDivElement | null;
const roomCommentsList = document.getElementById('room-comments-list') as HTMLDivElement | null;

let adminKey = window.sessionStorage.getItem(ADMIN_KEY_STORAGE_KEY) ?? '';
let lastSnapshot: LaunchStatsResponse | null = null;
let lastError: string | null = null;
let lastGoodSnapshotAt: string | null = null;
let pollingTimer: number | null = null;
let refreshInFlight = false;
let selectedActivityRangeKey =
  (window.localStorage.getItem(ACTIVITY_RANGE_STORAGE_KEY) as LaunchStatsActivityRangeKey | null) ??
  null;
let selectedActivityFilterKey = normalizeActivityFilterKey(
  window.localStorage.getItem(ACTIVITY_FILTER_STORAGE_KEY),
);
let progressionStatusMessage = 'Search for a user to inspect or raise their builder caps.';
let progressionResultsSnapshot: AdminProgressionUserLookupEntry[] = [];
let selectedProgressionUser: AdminProgressionUserCapsResponse | null = null;
let roomCommentsStatusMessage = 'Paste the admin key to load room comments.';
let roomCommentsSnapshot: AdminRoomCommentRecord[] = [];
let roomCommentsLoading = false;

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
  void refreshRoomComments();
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

activityRangeSelect?.addEventListener('change', () => {
  selectedActivityRangeKey = activityRangeSelect.value as LaunchStatsActivityRangeKey;
  window.localStorage.setItem(ACTIVITY_RANGE_STORAGE_KEY, selectedActivityRangeKey);
  renderActivity();
});

activityFilterList?.addEventListener('click', handleActivityFilterClick);
activityGrid?.addEventListener('click', handleActivityFilterClick);

progressionSearchButton?.addEventListener('click', () => {
  void searchProgressionUsers();
});

progressionQueryInput?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') {
    return;
  }
  event.preventDefault();
  void searchProgressionUsers();
});

progressionSaveButton?.addEventListener('click', () => {
  void saveProgressionOverride(false);
});

progressionClearButton?.addEventListener('click', () => {
  void saveProgressionOverride(true);
});

roomCommentsRefreshButton?.addEventListener('click', () => {
  void refreshRoomComments();
});

roomCommentsStatusFilter?.addEventListener('change', () => {
  void refreshRoomComments();
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
  void refreshRoomComments();
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
  renderProgressionAdmin();
  renderRoomCommentsAdmin();
  renderConfig();
  renderTotals();
  renderActivity();
  renderPartykitSummary();
  renderShards();
}

async function searchProgressionUsers(): Promise<void> {
  if (!adminKey) {
    progressionStatusMessage = 'Paste the admin key before searching for progression users.';
    render();
    return;
  }

  const query = progressionQueryInput?.value.trim() ?? '';
  if (!query) {
    progressionResultsSnapshot = [];
    selectedProgressionUser = null;
    progressionStatusMessage = 'Enter a user id, email, or display name.';
    populateProgressionForm(null);
    render();
    return;
  }

  progressionStatusMessage = `Searching for "${query}"...`;
  render();

  try {
    const response = await fetch(
      `${getApiBaseUrl()}/api/admin/progression/users?query=${encodeURIComponent(query)}`,
      {
        headers: {
          'x-admin-key': adminKey,
        },
      },
    );

    if (!response.ok) {
      const text = (await response.text()).trim();
      throw new Error(text || `Search failed with status ${response.status}.`);
    }

    const payload = (await response.json()) as AdminProgressionUserLookupResponse;
    progressionResultsSnapshot = payload.items;
    progressionStatusMessage =
      payload.items.length > 0
        ? `Found ${payload.items.length} matching ${payload.items.length === 1 ? 'user' : 'users'}.`
        : `No progression users matched "${query}".`;
    render();
  } catch (error) {
    progressionStatusMessage =
      error instanceof Error ? error.message : 'Unknown progression search failure.';
    render();
  }
}

async function loadProgressionUser(userId: string): Promise<void> {
  if (!adminKey) {
    progressionStatusMessage = 'Paste the admin key before loading a user.';
    render();
    return;
  }

  progressionStatusMessage = 'Loading progression caps...';
  render();
  scrollProgressionPanelIntoView();

  try {
    const response = await fetch(`${getApiBaseUrl()}/api/admin/progression/users/${encodeURIComponent(userId)}/caps`, {
      headers: {
        'x-admin-key': adminKey,
      },
    });

    if (!response.ok) {
      const text = (await response.text()).trim();
      throw new Error(text || `Load failed with status ${response.status}.`);
    }

    selectedProgressionUser = (await response.json()) as AdminProgressionUserCapsResponse;
    populateProgressionForm(selectedProgressionUser);
    progressionStatusMessage = `Loaded ${selectedProgressionUser.displayName}.`;
    render();
    emphasizeProgressionSelection();
  } catch (error) {
    progressionStatusMessage =
      error instanceof Error ? error.message : 'Unknown progression load failure.';
    render();
    emphasizeProgressionSelection();
  }
}

function populateProgressionForm(user: AdminProgressionUserCapsResponse | null): void {
  if (progressionClaimInput) {
    progressionClaimInput.value = user?.override.claimLimitPerDay ? String(user.override.claimLimitPerDay) : '';
  }
  if (progressionPublishInput) {
    progressionPublishInput.value = user?.override.publishLimitPerDay ? String(user.override.publishLimitPerDay) : '';
  }
  if (progressionObjectInput) {
    progressionObjectInput.value = user?.override.objectLimit ? String(user.override.objectLimit) : '';
  }
  if (progressionCollectibleInput) {
    progressionCollectibleInput.value = user?.override.collectibleLimit ? String(user.override.collectibleLimit) : '';
  }
  if (progressionExpandedRoomInput) {
    progressionExpandedRoomInput.value = user?.override.expandedRoomCellLimit ? String(user.override.expandedRoomCellLimit) : '';
  }
  if (progressionReasonInput) {
    progressionReasonInput.value = user?.override.reason ?? '';
  }
}

async function saveProgressionOverride(clear: boolean): Promise<void> {
  if (!adminKey) {
    progressionStatusMessage = 'Paste the admin key before saving overrides.';
    render();
    return;
  }
  if (!selectedProgressionUser) {
    progressionStatusMessage = 'Load a user before saving overrides.';
    render();
    return;
  }

  const operatorLabel = progressionOperatorInput?.value.trim() || 'Admin';
  const body: AdminProgressionCapsUpdateRequest = clear
    ? {
        claimLimitPerDay: null,
        publishLimitPerDay: null,
        objectLimit: null,
        collectibleLimit: null,
        expandedRoomCellLimit: null,
        reason: null,
        operatorLabel,
      }
    : {
        claimLimitPerDay: readOptionalPositiveInteger(progressionClaimInput),
        publishLimitPerDay: readOptionalPositiveInteger(progressionPublishInput),
        objectLimit: readOptionalPositiveInteger(progressionObjectInput),
        collectibleLimit: readOptionalPositiveInteger(progressionCollectibleInput),
        expandedRoomCellLimit: readOptionalPositiveInteger(progressionExpandedRoomInput),
        reason: progressionReasonInput?.value.trim() || null,
        operatorLabel,
      };

  progressionStatusMessage = clear ? 'Clearing cap override...' : 'Saving cap override...';
  render();

  try {
    const response = await fetch(
      `${getApiBaseUrl()}/api/admin/progression/users/${encodeURIComponent(selectedProgressionUser.userId)}/caps`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-admin-key': adminKey,
        },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const text = (await response.text()).trim();
      throw new Error(text || `Save failed with status ${response.status}.`);
    }

    selectedProgressionUser = (await response.json()) as AdminProgressionUserCapsResponse;
    progressionResultsSnapshot = progressionResultsSnapshot.map((entry) =>
      entry.userId === selectedProgressionUser?.userId ? selectedProgressionUser : entry,
    );
    populateProgressionForm(selectedProgressionUser);
    progressionStatusMessage = clear
      ? `Cleared override for ${selectedProgressionUser.displayName}.`
      : `Saved override for ${selectedProgressionUser.displayName}.`;
    render();
  } catch (error) {
    progressionStatusMessage =
      error instanceof Error ? error.message : 'Unknown progression save failure.';
    render();
  }
}

async function refreshRoomComments(): Promise<void> {
  if (!adminKey) {
    roomCommentsStatusMessage = 'Paste the admin key before loading room comments.';
    render();
    return;
  }

  if (roomCommentsLoading) {
    return;
  }

  const status = readRoomCommentsStatusFilter();
  roomCommentsLoading = true;
  roomCommentsStatusMessage = `Loading ${formatCommentStatus(status).toLowerCase()} comments...`;
  render();

  try {
    const response = await fetch(
      `${getApiBaseUrl()}/api/admin/room-comments?status=${encodeURIComponent(status)}&limit=80`,
      {
        headers: {
          'x-admin-key': adminKey,
        },
      },
    );
    if (!response.ok) {
      const text = (await response.text()).trim();
      throw new Error(text || `Comment load failed with status ${response.status}.`);
    }

    const payload = (await response.json()) as AdminRoomCommentListResponse;
    roomCommentsSnapshot = payload.comments;
    roomCommentsStatusMessage =
      payload.comments.length > 0
        ? `${payload.comments.length} ${formatCommentStatus(status).toLowerCase()} comment${payload.comments.length === 1 ? '' : 's'}.`
        : `No ${formatCommentStatus(status).toLowerCase()} comments.`;
  } catch (error) {
    roomCommentsStatusMessage =
      error instanceof Error ? error.message : 'Unknown room comment load failure.';
  } finally {
    roomCommentsLoading = false;
    render();
  }
}

async function reviewRoomComment(
  commentId: string,
  decision: Extract<RoomCommentStatus, 'approved' | 'rejected'>,
): Promise<void> {
  if (!adminKey) {
    roomCommentsStatusMessage = 'Paste the admin key before reviewing comments.';
    render();
    return;
  }

  const reason = window.prompt(`${decision === 'approved' ? 'Approval' : 'Rejection'} reason`, '') ?? '';
  const operatorLabel =
    roomCommentsOperatorInput?.value.trim()
    || progressionOperatorInput?.value.trim()
    || 'Admin';
  roomCommentsStatusMessage = `${decision === 'approved' ? 'Approving' : 'Rejecting'} comment...`;
  render();

  try {
    const response = await fetch(
      `${getApiBaseUrl()}/api/admin/room-comments/${encodeURIComponent(commentId)}/review`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-admin-key': adminKey,
        },
        body: JSON.stringify({
          decision,
          reason,
          operatorLabel,
        }),
      },
    );
    if (!response.ok) {
      const text = (await response.text()).trim();
      throw new Error(text || `Review failed with status ${response.status}.`);
    }

    const payload = (await response.json()) as AdminRoomCommentReviewResponse;
    roomCommentsSnapshot = roomCommentsSnapshot.map((comment) =>
      comment.id === payload.comment.id ? payload.comment : comment,
    );
    const emailStatus = payload.email.sent
      ? ' Builder email sent.'
      : payload.email.error
        ? ` Builder email failed: ${payload.email.error}`
        : payload.email.skippedReason
          ? ` Builder email skipped: ${payload.email.skippedReason}`
          : '';
    roomCommentsStatusMessage =
      `${decision === 'approved' ? 'Approved' : 'Rejected'} comment.${emailStatus}`;
    render();
  } catch (error) {
    roomCommentsStatusMessage =
      error instanceof Error ? error.message : 'Unknown room comment review failure.';
    render();
  }
}

function renderRoomCommentsAdmin(): void {
  if (roomCommentsStatus) {
    roomCommentsStatus.textContent = roomCommentsStatusMessage;
  }

  if (!roomCommentsList) {
    return;
  }

  if (roomCommentsLoading) {
    roomCommentsList.innerHTML = '<div class="meta">Loading room comments...</div>';
    return;
  }

  if (roomCommentsSnapshot.length === 0) {
    roomCommentsList.innerHTML = '<div class="meta">No comments loaded.</div>';
    return;
  }

  roomCommentsList.innerHTML = roomCommentsSnapshot
    .map((comment) => renderRoomCommentCard(comment))
    .join('');
  wireRoomCommentReviewButtons(roomCommentsList);
}

function renderRoomCommentCard(comment: AdminRoomCommentRecord): string {
  const roomLabel = comment.roomTitle?.trim()
    ? `"${comment.roomTitle.trim()}"`
    : `Room ${comment.roomCoordinates.x},${comment.roomCoordinates.y}`;
  const roomHref = `/r/${encodeURIComponent(String(comment.roomCoordinates.x))}/${encodeURIComponent(String(comment.roomCoordinates.y))}`;
  const canReview = comment.status === 'pending_review';
  const emailMeta =
    comment.notifiedAt
      ? `Builder email sent ${formatTimestamp(comment.notifiedAt)}`
      : comment.notificationError
        ? `Builder email error: ${comment.notificationError}`
        : comment.builderEmail
          ? `Builder email ready: ${comment.builderEmail}`
          : 'Builder email unavailable';

  return `
    <article class="card comment-review-card" data-status="${escapeHtml(comment.status)}">
      <div class="activity-head">
        <span class="label">${escapeHtml(formatCommentStatus(comment.status))}</span>
        <span class="meta">${escapeHtml(formatTimestamp(comment.createdAt))}</span>
      </div>
      <div class="comment-review-body">${escapeHtml(comment.body)}</div>
      <div class="meta">
        ${escapeHtml(comment.authorDisplayName)}${comment.authorEmail ? ` (${escapeHtml(comment.authorEmail)})` : ''}
        on <a href="${escapeHtml(roomHref)}" target="_blank" rel="noreferrer">${escapeHtml(roomLabel)}</a>
        v${escapeHtml(String(comment.roomVersion))}
        at ${escapeHtml(`${comment.position.x},${comment.position.y}`)}
      </div>
      <div class="meta">
        Builder: ${escapeHtml(comment.builderDisplayName ?? comment.builderUserId ?? 'unknown')} · ${escapeHtml(emailMeta)}
      </div>
      ${
        comment.reviewedAt
          ? `<div class="meta">Reviewed ${escapeHtml(formatTimestamp(comment.reviewedAt))} by ${escapeHtml(comment.reviewedByLabel ?? 'Admin')}${comment.reviewReason ? ` · ${escapeHtml(comment.reviewReason)}` : ''}</div>`
          : ''
      }
      ${
        canReview
          ? `
            <div class="controls">
              <button type="button" data-room-comment-review="approved" data-room-comment-id="${escapeHtml(comment.id)}">Approve</button>
              <button type="button" class="secondary" data-room-comment-review="rejected" data-room-comment-id="${escapeHtml(comment.id)}">Reject</button>
            </div>
          `
          : ''
      }
    </article>
  `;
}

function wireRoomCommentReviewButtons(root: ParentNode): void {
  for (const button of Array.from(root.querySelectorAll<HTMLButtonElement>('[data-room-comment-review]'))) {
    if (button.dataset.roomCommentReviewBound === '1') {
      continue;
    }

    button.dataset.roomCommentReviewBound = '1';
    button.addEventListener('click', () => {
      const commentId = button.dataset.roomCommentId?.trim();
      const decision = button.dataset.roomCommentReview;
      if (!commentId || (decision !== 'approved' && decision !== 'rejected')) {
        return;
      }
      void reviewRoomComment(commentId, decision);
    });
  }
}

function readRoomCommentsStatusFilter(): RoomCommentStatus | 'all' {
  const value = roomCommentsStatusFilter?.value ?? 'pending_review';
  if (value === 'approved' || value === 'rejected' || value === 'pending_review' || value === 'all') {
    return value;
  }
  return 'pending_review';
}

function formatCommentStatus(status: RoomCommentStatus | 'all'): string {
  switch (status) {
    case 'pending_review':
      return 'Pending Review';
    case 'approved':
      return 'Approved';
    case 'rejected':
      return 'Rejected';
    case 'all':
      return 'All';
    default:
      return 'Comments';
  }
}

function renderProgressionAdmin(): void {
  if (progressionStatus) {
    progressionStatus.textContent = progressionStatusMessage;
  }

  if (progressionResults) {
    progressionResults.innerHTML =
      progressionResultsSnapshot.length > 0
        ? progressionResultsSnapshot
            .map(
              (item) => `
                <button class="result-button" type="button" data-progression-user-id="${escapeHtml(item.userId)}">
                  <strong>${escapeHtml(item.displayName)}</strong>
                  <div class="meta">${escapeHtml(item.email ?? item.userId)}</div>
                  <div class="meta">Trust ${escapeHtml(item.trust.effectiveTier)} (${formatNumber(
                    item.trust.effectiveScore,
                  )}) · Player ${formatNumber(item.stats.player.level)} · Builder ${formatNumber(
                    item.stats.builder.level,
                  )} · Curator ${formatNumber(item.stats.curator.level)}</div>
                  <div class="meta">Caps ${formatCapSummary(item.builderCaps)} · founder ${
                    item.founderNumber === null ? 'unassigned' : `#${item.founderNumber}`
                  }</div>
                </button>
              `,
            )
            .join('')
        : '<div class="meta">No search results yet.</div>';

    wireProgressionLookupButtons(progressionResults);
  }

  if (progressionSelected) {
    progressionSelected.innerHTML = selectedProgressionUser
      ? `
          <strong>${escapeHtml(selectedProgressionUser.displayName)}</strong>
          <div class="meta">${escapeHtml(selectedProgressionUser.email ?? selectedProgressionUser.userId)}</div>
          <div class="meta">Founder ${
            selectedProgressionUser.founderNumber === null ? 'unassigned' : `#${escapeHtml(String(selectedProgressionUser.founderNumber))}`
          }${
            selectedProgressionUser.stats.firstIdentityQualifiedAt
              ? ` · qualified ${escapeHtml(formatTimestamp(selectedProgressionUser.stats.firstIdentityQualifiedAt))}`
              : ''
          }</div>
          <div class="meta">Trust ${escapeHtml(formatTrustSummary(selectedProgressionUser.trust))}</div>
          <div class="meta">Player ${escapeHtml(formatLaneSummary(selectedProgressionUser.stats.player))}</div>
          <div class="meta">Builder ${escapeHtml(formatLaneSummary(selectedProgressionUser.stats.builder))}</div>
          <div class="meta">Curator ${escapeHtml(formatLaneSummary(selectedProgressionUser.stats.curator))}</div>
          <div class="meta">Badges ${escapeHtml(formatNumber(selectedProgressionUser.stats.badgeCount))} · Trophies ${escapeHtml(
            formatNumber(selectedProgressionUser.stats.trophyCount),
          )}</div>
          <div class="meta">Effective caps: ${escapeHtml(formatCapSummary(selectedProgressionUser.builderCaps))}</div>
          <div class="meta">Trust tier ${escapeHtml(selectedProgressionUser.builderCaps.trustTier)}${
            selectedProgressionUser.builderCaps.overrideActive ? ' · admin boost active' : ''
          }</div>
          <div class="meta">Override: ${escapeHtml(formatOverrideSummary(selectedProgressionUser))}</div>
        `
      : 'No user selected.';
  }
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
    ['Game Jam Signups', totals.jamRegistrations],
    ['Active Sessions', totals.activeSessions],
    ['Guest Visitors', totals.guestVisitors],
    ['Guest Visits', totals.guestVisits],
    ['Rooms', totals.rooms],
    ['Published Rooms', totals.publishedRooms],
    ['Room Runs', totals.roomRuns],
    ['Courses', totals.courses],
    ['Course Runs', totals.courseRuns],
    ['Expanded Rooms', totals.expandedRooms],
    ['Expanded Room Runs', totals.expandedRoomRuns],
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
    if (activityRangeSummary) {
      activityRangeSummary.textContent =
        'Choose a time window to see who actually played, built, signed up, or published in that period.';
    }
    if (activityRangeSelect) {
      activityRangeSelect.innerHTML = '';
    }
    if (activityFilterList) {
      activityFilterList.innerHTML = '';
    }
    if (activityFeed) {
      activityFeed.innerHTML = '<div class="meta">No recent summaries yet.</div>';
    }
    return;
  }

  const selectedRange = getSelectedActivityRange();
  renderActivityRangeOptions(selectedRange);
  renderActivityFilters(selectedRange);

  if (!selectedRange) {
    activityGrid.innerHTML = '<div class="meta">No activity ranges returned yet.</div>';
    if (activityFeed) {
      activityFeed.innerHTML = '<div class="meta">No recent summaries yet.</div>';
    }
    return;
  }

  if (activityRangeSummary) {
    const filterLabel = getActivityFilterLabel(selectedActivityFilterKey);
    const filterPhrase =
      selectedActivityFilterKey === 'all'
        ? 'grouped player, guest, build, and signup activity'
        : `${filterLabel.toLowerCase()} activity`;
    activityRangeSummary.textContent =
      `Showing ${filterPhrase} in ${selectedRange.description}. ` +
      'Browse-only guest tabs are counted in guest visitors, but only play/build guests appear in the feed.';
  }

  activityGrid.innerHTML = renderActivityWindowCards(selectedRange);

  if (!activityFeed) {
    return;
  }

  const summaries = selectedRange.recentSummaries ?? [];
  const filteredSummaries = summaries.filter((summary) =>
    matchesActivityFilter(summary, selectedActivityFilterKey)
  );

  if (filteredSummaries.length === 0) {
    const filterLabel =
      selectedActivityFilterKey === 'all'
        ? 'activity'
        : getActivityFilterLabel(selectedActivityFilterKey).toLowerCase();
    activityFeed.innerHTML =
      `<div class="meta">No ${escapeHtml(filterLabel)} summaries in ${escapeHtml(
        selectedRange.description
      )}.</div>`;
    return;
  }

  activityFeed.innerHTML = filteredSummaries
    .map((summary) => {
      const detail = renderRecentSummaryDetail(summary, selectedRange);

      return `
        <article class="card activity-row ${escapeHtml(getActivityRowClass(summary))}">
          <div class="activity-head">
            <span class="label">${escapeHtml(renderRecentSummaryKindLabel(summary, selectedActivityFilterKey))}</span>
            <span class="meta">${escapeHtml(formatTimestamp(summary.at))}</span>
          </div>
          <div class="activity-summary">${renderRecentSummaryMarkup(summary, selectedRange)}</div>
          ${detail ? `<div class="meta activity-detail">${escapeHtml(detail)}</div>` : ''}
        </article>
      `;
    })
    .join('');

  wireProgressionLookupButtons(activityFeed);
}

function getSelectedActivityRange(): LaunchStatsActivityRange | null {
  const ranges = lastSnapshot?.activity.ranges ?? [];
  if (ranges.length === 0) {
    return null;
  }

  const defaultKey = lastSnapshot?.activity.defaultRangeKey ?? ranges[0].key;
  const selected =
    ranges.find((range) => range.key === selectedActivityRangeKey) ??
    ranges.find((range) => range.key === defaultKey) ??
    ranges[0];
  selectedActivityRangeKey = selected.key;
  return selected;
}

function handleActivityFilterClick(event: MouseEvent): void {
  if (!(event.target instanceof Element)) {
    return;
  }

  const button = event.target.closest<HTMLButtonElement>('[data-activity-filter]');
  const rawFilterKey = button?.dataset.activityFilter;
  if (!rawFilterKey) {
    return;
  }

  const nextFilterKey = normalizeActivityFilterKey(rawFilterKey);
  if (nextFilterKey === selectedActivityFilterKey) {
    return;
  }

  selectedActivityFilterKey = nextFilterKey;
  window.localStorage.setItem(ACTIVITY_FILTER_STORAGE_KEY, selectedActivityFilterKey);
  renderActivity();
}

function normalizeActivityFilterKey(value: string | null | undefined): LaunchAdminActivityFilterKey {
  switch (value) {
    case 'signups':
    case 'visit_only':
    case 'guest_play_build':
    case 'room_play':
    case 'room_claims':
    case 'room_publishes':
    case 'course_publishes':
    case 'all':
      return value;
    default:
      return 'all';
  }
}

function getActivityFilterLabel(filterKey: LaunchAdminActivityFilterKey): string {
  return ACTIVITY_FILTERS.find((filter) => filter.key === filterKey)?.label ?? 'All Activity';
}

function getActivityFilterCountLabel(
  range: LaunchStatsActivityRange,
  filterKey: LaunchAdminActivityFilterKey,
): string {
  const activity = range.activity;
  switch (filterKey) {
    case 'all':
      return `${formatNumber(range.recentSummaries.length)} rows`;
    case 'signups':
      return formatCountWithNoun(activity.newUsers, 'signup');
    case 'visit_only':
      return formatFilteredRowCount(range, filterKey);
    case 'guest_play_build':
      return formatCountWithNoun(activity.guestPlayBuildVisitors, 'guest');
    case 'room_play':
      return formatCountWithNoun(activity.roomRunStarts, 'start');
    case 'room_claims':
      return formatCountWithNoun(activity.roomClaims, 'claim');
    case 'room_publishes':
      return formatCountWithNoun(activity.roomPublishes, 'publish', 'publishes');
    case 'course_publishes':
      return formatCountWithNoun(
        activity.expandedRoomPublishes + activity.coursePublishes,
        'publish',
        'publishes',
      );
    default:
      return '0 rows';
  }
}

function formatFilteredRowCount(
  range: LaunchStatsActivityRange,
  filterKey: LaunchAdminActivityFilterKey,
): string {
  const rowCount = range.recentSummaries.filter((summary) =>
    matchesActivityFilter(summary, filterKey)
  ).length;
  return `${formatNumber(rowCount)} row${rowCount === 1 ? '' : 's'}`;
}

function matchesActivityFilter(
  summary: LaunchStatsRecentSummary,
  filterKey: LaunchAdminActivityFilterKey,
): boolean {
  switch (filterKey) {
    case 'all':
      return true;
    case 'signups':
      return summary.kind === 'signup';
    case 'visit_only':
      return summary.kind === 'visit_only';
    case 'guest_play_build':
      return summary.kind === 'guest_visit';
    case 'room_play':
      return summary.kind === 'room_play';
    case 'room_claims':
      return summary.kind === 'room_build' && (summary.claimCount ?? 0) > 0;
    case 'room_publishes':
      return summary.kind === 'room_build' && (summary.roomPublishCount ?? 0) > 0;
    case 'course_publishes':
      return summary.kind === 'course_build' && (summary.coursePublishCount ?? 0) > 0;
    default:
      return false;
  }
}

function renderActivityRangeOptions(selectedRange: LaunchStatsActivityRange | null): void {
  if (!activityRangeSelect) {
    return;
  }

  const ranges = lastSnapshot?.activity.ranges ?? [];
  activityRangeSelect.innerHTML = ranges
    .map((range) => {
      const selected = selectedRange?.key === range.key ? 'selected' : '';
      return `<option value="${escapeHtml(range.key)}" ${selected}>${escapeHtml(range.label)}</option>`;
    })
    .join('');
}

function renderActivityFilters(selectedRange: LaunchStatsActivityRange | null): void {
  if (!activityFilterList) {
    return;
  }

  if (!selectedRange) {
    activityFilterList.innerHTML = '';
    return;
  }

  activityFilterList.innerHTML = ACTIVITY_FILTERS
    .map((filter) => {
      const active = filter.key === selectedActivityFilterKey;
      const countLabel = getActivityFilterCountLabel(selectedRange, filter.key);
      return `
        <button
          class="activity-filter-button"
          type="button"
          data-activity-filter="${escapeHtml(filter.key)}"
          aria-pressed="${active ? 'true' : 'false'}"
        >
          <span>${escapeHtml(filter.label)}</span>
          <span class="activity-filter-count">${escapeHtml(countLabel)}</span>
        </button>
      `;
    })
    .join('');
}

function renderActivityWindowCards(range: LaunchStatsActivityRange): string {
  const windowStats = range.activity;
  const cards: Array<{
    filterKey: LaunchAdminActivityFilterKey | null;
    label: string;
    value: string;
    detail: string;
    tone: string;
  }> = [
    {
      filterKey: 'signups',
      label: 'Signups',
      value: formatCountWithNoun(windowStats.newUsers, 'signup'),
      detail: `${formatFilteredRowCount(range, 'signups')} in feed · ${formatCountWithNoun(windowStats.logins, 'login')}`,
      tone: 'people',
    },
    {
      filterKey: 'visit_only',
      label: 'Visit Only',
      value: `${formatFilteredRowCount(range, 'visit_only')}`,
      detail: `Signed-in sessions without play/build in ${range.description}`,
      tone: 'people',
    },
    {
      filterKey: 'guest_play_build',
      label: 'Guest Play/Build',
      value: formatCountWithNoun(windowStats.guestPlayBuildVisitors, 'guest'),
      detail: `play ${formatDurationSeconds(windowStats.guestPlaySeconds)} · build ${formatDurationSeconds(windowStats.guestEditSeconds)}`,
      tone: 'guest',
    },
    {
      filterKey: 'room_play',
      label: 'Room Plays',
      value: formatCountWithNoun(windowStats.roomRunStarts, 'room start'),
      detail: formatCountWithNoun(windowStats.roomRunFinishes, 'room finish', 'room finishes'),
      tone: 'play',
    },
    {
      filterKey: 'room_claims',
      label: 'Room Claims',
      value: formatCountWithNoun(windowStats.roomClaims, 'claim'),
      detail: `${formatFilteredRowCount(range, 'room_claims')} in feed`,
      tone: 'build',
    },
    {
      filterKey: 'room_publishes',
      label: 'Room Publishes',
      value: formatCountWithNoun(windowStats.roomPublishes, 'room publish', 'room publishes'),
      detail: `${formatFilteredRowCount(range, 'room_publishes')} in feed`,
      tone: 'build',
    },
    {
      filterKey: 'course_publishes',
      label: 'Expanded/Course Publishes',
      value: formatCountWithNoun(
        windowStats.expandedRoomPublishes + windowStats.coursePublishes,
        'publish',
        'publishes',
      ),
      detail: `${formatNumber(windowStats.expandedRoomPublishes)} expanded · ${formatNumber(
        windowStats.coursePublishes,
      )} legacy · ${formatFilteredRowCount(range, 'course_publishes')} legacy feed rows`,
      tone: 'build',
    },
    {
      filterKey: null,
      label: 'Expanded Room Runs',
      value: formatCountWithNoun(
        windowStats.expandedRoomRunStarts,
        'expanded room start',
        'expanded room starts',
      ),
      detail: formatCountWithNoun(
        windowStats.expandedRoomRunFinishes,
        'expanded room finish',
        'expanded room finishes',
      ),
      tone: 'play',
    },
    {
      filterKey: null,
      label: 'Support',
      value: `${formatNumber(windowStats.chatMessages)} chat`,
      detail: `${formatNumber(windowStats.magicLinksCreated)} magic link${windowStats.magicLinksCreated === 1 ? '' : 's'}`,
      tone: 'support',
    },
  ];

  return cards
    .map((card) => {
      const active = card.filterKey !== null && card.filterKey === selectedActivityFilterKey;
      const content = `
          <span class="label">${escapeHtml(card.label)}</span>
          <span class="value">${escapeHtml(card.value)}</span>
          <div class="meta">${escapeHtml(card.detail)}</div>
      `;

      if (!card.filterKey) {
        return `
          <article class="card stack activity-stat-card activity-tone-${escapeHtml(card.tone)}">
            ${content}
          </article>
        `;
      }

      return `
        <button
          class="card stack activity-stat-card activity-stat-button activity-tone-${escapeHtml(card.tone)}"
          type="button"
          data-activity-filter="${escapeHtml(card.filterKey)}"
          aria-pressed="${active ? 'true' : 'false'}"
        >
          ${content}
        </button>
      `;
    })
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

function renderRecentSummaryKindLabel(
  summary: LaunchStatsRecentSummary,
  filterKey: LaunchAdminActivityFilterKey = 'all',
): string {
  switch (summary.kind) {
    case 'signup':
      return 'Sign Up';
    case 'guest_visit':
      return renderGuestVisitSummaryLabel(summary);
    case 'visit_only':
      return 'Visit Only';
    case 'room_play':
      return 'Room Play';
    case 'room_build':
      if (filterKey === 'room_claims') {
        return 'Room Claim';
      }
      if (filterKey === 'room_publishes') {
        return 'Room Publish';
      }
      return 'Room Build';
    case 'course_build':
      if (filterKey === 'course_publishes') {
        return 'Course Publish';
      }
      return 'Course Build';
    default:
      return 'Activity';
  }
}

function getActivityRowClass(summary: LaunchStatsRecentSummary): string {
  switch (summary.kind) {
    case 'guest_visit':
      return 'activity-kind-guest-visit';
    case 'visit_only':
      return 'activity-kind-visit-only';
    case 'room_play':
      return 'activity-kind-room-play';
    case 'room_build':
      return 'activity-kind-room-build';
    case 'course_build':
      return 'activity-kind-course-build';
    case 'signup':
    default:
      return 'activity-kind-signup';
  }
}

function renderRecentSummaryMarkup(
  summary: LaunchStatsRecentSummary,
  range: LaunchStatsActivityRange,
): string {
  const actorMarkup = renderRecentSummaryActorMarkup(summary);
  return `${actorMarkup} ${escapeHtml(renderRecentSummaryBody(summary, range))}`;
}

function renderRecentSummaryActorMarkup(summary: LaunchStatsRecentSummary): string {
  const actor = escapeHtml(summary.actorDisplayName || 'Unknown');
  if (summary.actorGuestId) {
    return `<span class="activity-actor" title="${escapeHtml(summary.actorGuestId)}">${actor}</span>`;
  }

  if (!summary.actorUserId) {
    return `<span class="activity-actor">${actor}</span>`;
  }

  return `<button class="activity-actor-button" type="button" data-progression-user-id="${escapeHtml(summary.actorUserId)}">${actor}</button>`;
}

function renderRecentSummaryBody(
  summary: LaunchStatsRecentSummary,
  range: LaunchStatsActivityRange,
): string {
  const rangePhrase = `in ${range.description}`;
  switch (summary.kind) {
    case 'signup':
      return summary.signupSource === 'wallet'
        ? 'signed up with a wallet.'
        : summary.signupSource === 'email'
          ? 'signed up with email.'
          : 'signed up.';
    case 'guest_visit': {
      return renderGuestVisitSummaryBody(summary);
    }
    case 'visit_only': {
      const sessions = summary.sessionCount ?? 0;
      return sessions <= 1
        ? `logged in ${rangePhrase} and did not build or play anything yet.`
        : `logged in ${formatNumber(sessions)} times ${rangePhrase} and did not build or play anything yet.`;
    }
    case 'room_play': {
      const attempts = summary.attemptCount ?? 0;
      const roomCount = summary.roomCount ?? summary.topRooms.length;
      return `did ${formatNumber(attempts)} room attempt${attempts === 1 ? '' : 's'} ${rangePhrase} across ${formatNumber(
        roomCount
      )} room${roomCount === 1 ? '' : 's'}.`;
    }
    case 'room_build': {
      const claims = summary.claimCount ?? 0;
      const publishes = summary.roomPublishCount ?? 0;
      const roomCount = summary.roomCount ?? summary.topRooms.length;

      if (claims > 0 && publishes > 0) {
        return `claimed ${formatNumber(claims)} room${claims === 1 ? '' : 's'} and published ${formatNumber(
          publishes
        )} room version${publishes === 1 ? '' : 's'} ${rangePhrase} across ${formatNumber(roomCount)} room${
          roomCount === 1 ? '' : 's'
        }.`;
      }

      if (claims > 0) {
        return `claimed ${formatNumber(claims)} room${claims === 1 ? '' : 's'} ${rangePhrase}.`;
      }

      return `published ${formatNumber(publishes)} room version${publishes === 1 ? '' : 's'} ${rangePhrase} across ${formatNumber(
        roomCount
      )} room${roomCount === 1 ? '' : 's'}.`;
    }
    case 'course_build': {
      const courses = summary.courseCount ?? summary.topCourses.length;
      const publishes = summary.coursePublishCount ?? courses;
      if (publishes > courses) {
        return `published ${formatNumber(publishes)} course version${publishes === 1 ? '' : 's'} ${rangePhrase} across ${formatNumber(
          courses
        )} course${courses === 1 ? '' : 's'}.`;
      }

      return `published ${formatNumber(courses)} course${courses === 1 ? '' : 's'} ${rangePhrase}.`;
    }
    default:
      return 'showed up recently.';
  }
}

function renderRecentSummaryDetail(
  summary: LaunchStatsRecentSummary,
  range: LaunchStatsActivityRange,
): string | null {
  switch (summary.kind) {
    case 'signup':
      return summary.signupSource === 'wallet'
        ? 'New wallet account.'
        : summary.signupSource === 'email'
          ? 'New email account.'
          : 'New account.';
    case 'guest_visit': {
      const parts = [
        formatGuestPlayBuildBreakdown(summary),
        `${formatNumber(summary.heartbeatCount ?? 0)} heartbeat${summary.heartbeatCount === 1 ? '' : 's'}`,
      ];
      if ((summary.browseSeconds ?? 0) > 0) {
        parts.push(`browse/idle ${formatDurationSeconds(summary.browseSeconds ?? 0)}`);
      }
      if ((summary.durationSeconds ?? 0) > 0) {
        parts.push(`visit span ${formatDurationSeconds(summary.durationSeconds ?? 0)}`);
      }
      const room = formatGuestRoom(summary);
      if (room) {
        parts.push(`last room ${room}`);
      }
      if (summary.lastPath) {
        parts.push(`last path ${summary.lastPath}`);
      }
      return parts.join(' · ');
    }
    case 'visit_only': {
      const sessions = summary.sessionCount ?? 0;
      return `${formatNumber(sessions)} login session${sessions === 1 ? '' : 's'} · no room or course play/build in ${range.description}.`;
    }
    case 'room_play': {
      const parts = [
        `${formatNumber(summary.completedCount ?? 0)} completed`,
        `${formatNumber(summary.failedCount ?? 0)} failed`,
        `${formatNumber(summary.abandonedCount ?? 0)} abandoned`,
      ];
      const rooms = formatRoomReferenceList(summary.topRooms, summary.roomCount);
      if (rooms) {
        parts.push(`Rooms: ${rooms}`);
      }
      return parts.join(' · ');
    }
    case 'room_build': {
      const parts: string[] = [];
      if ((summary.claimCount ?? 0) > 0) {
        parts.push(`${formatNumber(summary.claimCount ?? 0)} claim${summary.claimCount === 1 ? '' : 's'}`);
      }
      if ((summary.roomPublishCount ?? 0) > 0) {
        parts.push(
          `${formatNumber(summary.roomPublishCount ?? 0)} publish${summary.roomPublishCount === 1 ? '' : 'es'}`
        );
      }
      const rooms = formatRoomReferenceList(summary.topRooms, summary.roomCount);
      if (rooms) {
        parts.push(`Rooms: ${rooms}`);
      }
      return parts.join(' · ') || null;
    }
    case 'course_build': {
      const parts: string[] = [];
      if (
        summary.coursePublishCount !== null &&
        summary.courseCount !== null &&
        summary.coursePublishCount > summary.courseCount
      ) {
        parts.push(`${formatNumber(summary.coursePublishCount)} publish versions`);
      }
      const courses = formatCourseReferenceList(summary.topCourses, summary.courseCount);
      if (courses) {
        parts.push(`Courses: ${courses}`);
      }
      return parts.join(' · ') || null;
    }
    default:
      return null;
  }
}

function formatRoomReferenceList(
  rooms: LaunchStatsRecentRoomReference[],
  totalCount: number | null
): string {
  if (rooms.length === 0) {
    return '';
  }

  const labels = rooms.map((room) => formatRoomReference(room));
  const remainingCount = totalCount !== null ? Math.max(0, totalCount - rooms.length) : 0;
  if (remainingCount > 0) {
    labels.push(`+${formatNumber(remainingCount)} more`);
  }

  return labels.join(' · ');
}

function formatCourseReferenceList(
  courses: LaunchStatsRecentCourseReference[],
  totalCount: number | null
): string {
  if (courses.length === 0) {
    return '';
  }

  const labels = courses.map((course) => formatCourseReference(course));
  const remainingCount = totalCount !== null ? Math.max(0, totalCount - courses.length) : 0;
  if (remainingCount > 0) {
    labels.push(`+${formatNumber(remainingCount)} more`);
  }

  return labels.join(' · ');
}

function formatRoomReference(room: LaunchStatsRecentRoomReference): string {
  const title = room.roomTitle?.trim();
  const coordinates =
    room.roomX !== null && room.roomY !== null ? `${room.roomX},${room.roomY}` : null;

  if (title) {
    return coordinates ? `"${title}" (${coordinates})` : `"${title}"`;
  }

  if (coordinates) {
    return coordinates;
  }

  return room.roomId ? `room ${room.roomId}` : 'unknown room';
}

function formatCourseReference(course: LaunchStatsRecentCourseReference): string {
  const title = course.courseTitle?.trim();
  const coordinateLabels = course.coordinates.map((coordinate) => `${coordinate.x},${coordinate.y}`);
  const coordinateSummary = coordinateLabels.join(' · ');

  if (title) {
    return coordinateSummary ? `"${title}" (${coordinateSummary})` : `"${title}"`;
  }

  if (coordinateSummary) {
    return coordinateSummary;
  }

  return `course ${course.courseId}`;
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

function formatDurationSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function renderGuestVisitSummaryLabel(summary: LaunchStatsRecentSummary): string {
  const playSeconds = summary.playSeconds ?? 0;
  const editSeconds = summary.editSeconds ?? 0;

  if (playSeconds > 0 && editSeconds > 0) {
    return 'Guest Play/Build';
  }
  if (playSeconds > 0) {
    return 'Guest Play';
  }
  if (editSeconds > 0) {
    return 'Guest Build';
  }
  return 'Guest Browse';
}

function renderGuestVisitSummaryBody(summary: LaunchStatsRecentSummary): string {
  const parts: string[] = [];
  if ((summary.playSeconds ?? 0) > 0) {
    parts.push(`played ${formatDurationSeconds(summary.playSeconds ?? 0)}`);
  }
  if ((summary.editSeconds ?? 0) > 0) {
    parts.push(`built ${formatDurationSeconds(summary.editSeconds ?? 0)}`);
  }

  if (parts.length > 0) {
    return `${joinSentenceParts(parts)} as a guest.`;
  }

  return 'has not played or built yet.';
}

function formatGuestPlayBuildBreakdown(summary: LaunchStatsRecentSummary): string {
  return [
    `play ${formatDurationSeconds(summary.playSeconds ?? 0)}`,
    `build ${formatDurationSeconds(summary.editSeconds ?? 0)}`,
  ].join(' / ');
}

function joinSentenceParts(parts: string[]): string {
  if (parts.length <= 1) {
    return parts[0] ?? '';
  }

  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function formatGuestRoom(summary: LaunchStatsRecentSummary): string | null {
  if (summary.lastRoomX !== null && summary.lastRoomX !== undefined && summary.lastRoomY !== null && summary.lastRoomY !== undefined) {
    return `${summary.lastRoomX},${summary.lastRoomY}`;
  }

  return summary.lastRoomId?.trim() || null;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatCountWithNoun(value: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(value)} ${value === 1 ? singular : plural}`;
}

function readOptionalPositiveInteger(input: HTMLInputElement | null): number | null {
  const trimmed = input?.value.trim() ?? '';
  if (!trimmed) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer: "${trimmed}".`);
  }
  return parsed;
}

function formatCapSummary(caps: AdminProgressionUserLookupEntry['builderCaps']): string {
  return `${formatNumber(caps.objectLimit)} objects · ${formatNumber(caps.collectibleLimit)} collectibles · ${formatNumber(
    caps.publishLimitPerDay,
  )} publish/day · ${formatNumber(caps.claimLimitPerDay)} claim/day · ${formatNumber(caps.expandedRoomCellLimit)} expanded cells`;
}

function formatLaneSummary(lane: AdminProgressionUserCapsResponse['stats']['player']): string {
  return `L${formatNumber(lane.level)} · ${formatNumber(lane.xp)} XP · ${lane.medalLabel}`;
}

function formatTrustSummary(trust: AdminProgressionUserCapsResponse['trust']): string {
  const parts = [
    `effective ${trust.effectiveTier} (${formatNumber(trust.effectiveScore)})`,
    `raw ${trust.rawTier} (${formatNumber(trust.rawScore)})`,
  ];

  if (trust.penaltyActive) {
    const reasons = [
      trust.suspiciousPenaltyActive ? 'suspicious-admin hold' : null,
      trust.chatPenaltyActive ? 'chat-ban hold' : null,
    ].filter((value): value is string => Boolean(value));
    parts.push(reasons.length > 0 ? reasons.join(' + ') : 'penalty active');
  }

  return parts.join(' · ');
}

function formatOverrideSummary(user: AdminProgressionUserCapsResponse): string {
  if (!user.builderCaps.overrideActive) {
    return 'none';
  }

  const parts = [
    user.override.objectLimit !== null ? `${formatNumber(user.override.objectLimit)} objects` : null,
    user.override.collectibleLimit !== null ? `${formatNumber(user.override.collectibleLimit)} collectibles` : null,
    user.override.expandedRoomCellLimit !== null ? `${formatNumber(user.override.expandedRoomCellLimit)} expanded cells` : null,
    user.override.publishLimitPerDay !== null ? `${formatNumber(user.override.publishLimitPerDay)} publish/day` : null,
    user.override.claimLimitPerDay !== null ? `${formatNumber(user.override.claimLimitPerDay)} claim/day` : null,
    user.override.reason,
    user.override.updatedBy ? `by ${user.override.updatedBy}` : null,
  ].filter((value): value is string => Boolean(value));

  return parts.join(' · ');
}

function wireProgressionLookupButtons(root: ParentNode): void {
  for (const button of Array.from(root.querySelectorAll<HTMLButtonElement>('[data-progression-user-id]'))) {
    if (button.dataset.progressionLookupBound === '1') {
      continue;
    }

    button.dataset.progressionLookupBound = '1';
    button.addEventListener('click', () => {
      const userId = button.dataset.progressionUserId?.trim();
      if (!userId) {
        return;
      }
      void loadProgressionUser(userId);
    });
  }
}

function scrollProgressionPanelIntoView(): void {
  progressionPanel?.scrollIntoView({
    behavior: 'smooth',
    block: 'start',
  });
}

function emphasizeProgressionSelection(): void {
  if (!progressionSelected) {
    return;
  }

  progressionSelected.classList.remove('selected-flash');
  void progressionSelected.offsetWidth;
  progressionSelected.classList.add('selected-flash');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

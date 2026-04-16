import type { AdminProgressionUserLookupEntry, AdminProgressionUserLookupResponse } from './admin/model';
import { getApiBaseUrl } from './api/baseUrl';
import type { BackgroundImageSummary } from './backgrounds/client';

const ADMIN_KEY_STORAGE_KEY = 'ep_launch_admin_api_key';

const adminKeyInput = document.getElementById('admin-key-input') as HTMLInputElement | null;
const saveKeyButton = document.getElementById('save-key-button') as HTMLButtonElement | null;
const clearKeyButton = document.getElementById('clear-key-button') as HTMLButtonElement | null;
const refreshButton = document.getElementById('refresh-button') as HTMLButtonElement | null;
const authStatus = document.getElementById('auth-status') as HTMLElement | null;
const statusFilter = document.getElementById('status-filter') as HTMLSelectElement | null;
const queueStatus = document.getElementById('queue-status') as HTMLElement | null;
const queue = document.getElementById('queue') as HTMLElement | null;
const userQueryInput = document.getElementById('user-query-input') as HTMLInputElement | null;
const userSearchButton = document.getElementById('user-search-button') as HTMLButtonElement | null;
const userSearchStatus = document.getElementById('user-search-status') as HTMLElement | null;
const userResults = document.getElementById('user-results') as HTMLElement | null;
const permissionPanel = document.getElementById('permission-panel') as HTMLElement | null;
const permissionUserName = document.getElementById('permission-user-name') as HTMLElement | null;
const permissionUserMeta = document.getElementById('permission-user-meta') as HTMLElement | null;
const permissionCanUpload = document.getElementById('permission-can-upload') as HTMLInputElement | null;
const permissionAutoApprove = document.getElementById('permission-auto-approve') as HTMLInputElement | null;
const permissionReason = document.getElementById('permission-reason') as HTMLTextAreaElement | null;
const permissionOperator = document.getElementById('permission-operator') as HTMLInputElement | null;
const permissionSaveButton = document.getElementById('permission-save-button') as HTMLButtonElement | null;

let adminKey = window.sessionStorage.getItem(ADMIN_KEY_STORAGE_KEY) ?? '';
let selectedUserId: string | null = null;

if (adminKeyInput) {
  adminKeyInput.value = adminKey;
}

saveKeyButton?.addEventListener('click', () => {
  adminKey = adminKeyInput?.value.trim() ?? '';
  if (adminKey) {
    window.sessionStorage.setItem(ADMIN_KEY_STORAGE_KEY, adminKey);
    void refreshQueue();
  }
  renderAuthStatus();
});

clearKeyButton?.addEventListener('click', () => {
  adminKey = '';
  window.sessionStorage.removeItem(ADMIN_KEY_STORAGE_KEY);
  if (adminKeyInput) {
    adminKeyInput.value = '';
  }
  renderAuthStatus();
});

refreshButton?.addEventListener('click', () => {
  void refreshQueue();
});

statusFilter?.addEventListener('change', () => {
  void refreshQueue();
});

userSearchButton?.addEventListener('click', () => {
  void searchUsers();
});

userQueryInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    void searchUsers();
  }
});

permissionSaveButton?.addEventListener('click', () => {
  void savePermission();
});

renderAuthStatus();
if (adminKey) {
  void refreshQueue();
}

async function refreshQueue(): Promise<void> {
  if (!adminKey) {
    setStatus(queueStatus, 'Paste the admin key first.', true);
    return;
  }
  setStatus(queueStatus, 'Loading uploads...', false);

  try {
    const payload = await adminRequest<{ items: BackgroundImageSummary[] }>(
      `/api/admin/background-images?status=${encodeURIComponent(statusFilter?.value ?? 'pending_review')}`,
    );
    renderQueue(payload.items);
    setStatus(queueStatus, `${payload.items.length} upload${payload.items.length === 1 ? '' : 's'}.`, false);
  } catch (error) {
    setStatus(queueStatus, getErrorMessage(error), true);
  }
}

function renderQueue(items: BackgroundImageSummary[]): void {
  if (!queue) {
    return;
  }
  queue.replaceChildren();
  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'meta';
    empty.textContent = 'No uploads in this bucket.';
    queue.appendChild(empty);
    return;
  }

  for (const item of items) {
    const card = document.createElement('article');
    card.className = 'card';

    if (item.imageUrl && item.status !== 'blocked') {
      const image = document.createElement('img');
      image.className = shouldBlur(item) ? 'preview blurred' : 'preview';
      image.alt = item.filename;
      image.src = item.thumbnailUrl ?? item.imageUrl;
      card.appendChild(image);
      if (shouldBlur(item)) {
        const reveal = document.createElement('button');
        reveal.type = 'button';
        reveal.className = 'secondary';
        reveal.textContent = 'Reveal';
        reveal.addEventListener('click', () => {
          image.classList.toggle('blurred');
          reveal.textContent = image.classList.contains('blurred') ? 'Reveal' : 'Blur';
        });
        card.appendChild(reveal);
      }
    } else {
      const hidden = document.createElement('div');
      hidden.className = 'meta';
      hidden.textContent = item.status === 'blocked' ? 'Blocked image is not shown.' : 'Image not available yet.';
      card.appendChild(hidden);
    }

    const title = document.createElement('h3');
    title.textContent = item.filename;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${item.ownerDisplayName} · ${item.status} · ${formatTimestamp(item.createdAt)}`;
    const chips = document.createElement('div');
    chips.className = 'chips';
    chips.append(
      buildChip(item.moderationStatus, item.moderationStatus === 'passed' ? 'good' : item.moderationStatus === 'flagged' ? 'warn' : item.moderationStatus === 'blocked' ? 'danger' : ''),
      buildChip(item.moderationScore === null ? 'no score' : `${Math.round(item.moderationScore * 100)}%`, ''),
      ...item.moderationLabels.map((label) => buildChip(label, '')),
    );
    const reason = document.createElement('div');
    reason.className = 'meta';
    reason.textContent = item.moderationReason ?? 'No moderation note.';

    const actions = document.createElement('div');
    actions.className = 'actions';
    const approve = document.createElement('button');
    approve.type = 'button';
    approve.textContent = 'Approve';
    approve.disabled = item.status === 'approved' || item.status === 'blocked';
    approve.addEventListener('click', () => void reviewUpload(item.id, 'approved'));
    const reject = document.createElement('button');
    reject.type = 'button';
    reject.className = 'danger';
    reject.textContent = 'Reject';
    reject.disabled = item.status === 'rejected';
    reject.addEventListener('click', () => void reviewUpload(item.id, 'rejected'));
    actions.append(approve, reject);

    card.append(title, meta, chips, reason, actions);
    queue.appendChild(card);
  }
}

async function reviewUpload(id: string, decision: 'approved' | 'rejected'): Promise<void> {
  const reason = window.prompt(`${decision === 'approved' ? 'Approval' : 'Rejection'} reason`, '') ?? '';
  try {
    await adminRequest(`/api/admin/background-images/${encodeURIComponent(id)}/review`, {
      method: 'POST',
      body: JSON.stringify({
        decision,
        reason,
        operatorLabel: 'Admin',
      }),
    });
    await refreshQueue();
  } catch (error) {
    setStatus(queueStatus, getErrorMessage(error), true);
  }
}

async function searchUsers(): Promise<void> {
  const query = userQueryInput?.value.trim() ?? '';
  if (!query) {
    setStatus(userSearchStatus, 'Enter a user id, email, or display name.', true);
    return;
  }
  setStatus(userSearchStatus, 'Searching...', false);
  try {
    const payload = await adminRequest<AdminProgressionUserLookupResponse>(
      `/api/admin/progression/users?query=${encodeURIComponent(query)}`,
    );
    renderUserResults(payload.items);
    setStatus(userSearchStatus, `${payload.items.length} matching user${payload.items.length === 1 ? '' : 's'}.`, false);
  } catch (error) {
    setStatus(userSearchStatus, getErrorMessage(error), true);
  }
}

function renderUserResults(items: AdminProgressionUserLookupEntry[]): void {
  if (!userResults) {
    return;
  }
  userResults.replaceChildren();
  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'result-button';
    button.innerHTML = `<strong>${escapeHtml(item.displayName)}</strong><div class="meta">${escapeHtml(item.email ?? item.userId)} · Trust ${escapeHtml(item.builderCaps.trustTier)}</div>`;
    button.addEventListener('click', () => void loadPermission(item.userId));
    userResults.appendChild(button);
  }
}

async function loadPermission(userId: string): Promise<void> {
  selectedUserId = userId;
  try {
    const payload = await adminRequest<{
      user: { userId: string; displayName: string; email: string | null };
      trustTier: string;
      permission: {
        canUpload: boolean;
        autoApprove: boolean;
        reason: string | null;
        updatedBy: string | null;
        updatedAt: string;
      } | null;
    }>(`/api/admin/background-images/permissions/${encodeURIComponent(userId)}`);
    if (permissionPanel) {
      permissionPanel.hidden = false;
    }
    if (permissionUserName) {
      permissionUserName.textContent = payload.user.displayName;
    }
    if (permissionUserMeta) {
      permissionUserMeta.textContent = `${payload.user.email ?? payload.user.userId} · Trust ${payload.trustTier}`;
    }
    if (permissionCanUpload) {
      permissionCanUpload.checked = payload.permission?.canUpload ?? true;
    }
    if (permissionAutoApprove) {
      permissionAutoApprove.checked = payload.permission?.autoApprove ?? false;
    }
    if (permissionReason) {
      permissionReason.value = payload.permission?.reason ?? '';
    }
  } catch (error) {
    setStatus(userSearchStatus, getErrorMessage(error), true);
  }
}

async function savePermission(): Promise<void> {
  if (!selectedUserId) {
    return;
  }
  try {
    await adminRequest(`/api/admin/background-images/permissions/${encodeURIComponent(selectedUserId)}`, {
      method: 'POST',
      body: JSON.stringify({
        canUpload: permissionCanUpload?.checked ?? false,
        autoApprove: permissionAutoApprove?.checked ?? false,
        reason: permissionReason?.value ?? '',
        operatorLabel: permissionOperator?.value.trim() || 'Admin',
      }),
    });
    setStatus(userSearchStatus, 'Access saved.', false);
  } catch (error) {
    setStatus(userSearchStatus, getErrorMessage(error), true);
  }
}

async function adminRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!adminKey) {
    throw new Error('Admin key is required.');
  }
  const headers = new Headers(init.headers);
  headers.set('x-admin-key', adminKey);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
    const text = (await response.text()).trim();
    throw new Error(text || `Request failed with status ${response.status}.`);
  }
  return (await response.json()) as T;
}

function shouldBlur(item: BackgroundImageSummary): boolean {
  return item.moderationStatus === 'flagged' || (item.moderationScore !== null && item.moderationScore >= 0.9);
}

function buildChip(label: string, tone: string): HTMLElement {
  const chip = document.createElement('span');
  chip.className = tone ? `chip ${tone}` : 'chip';
  chip.textContent = label;
  return chip;
}

function renderAuthStatus(): void {
  setStatus(authStatus, adminKey ? 'Admin key saved for this tab.' : 'Paste the admin key to review background uploads.', false);
}

function setStatus(element: HTMLElement | null, message: string, error: boolean): void {
  if (!element) {
    return;
  }
  element.textContent = message;
  element.classList.toggle('error', error);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error.';
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#039;';
      default:
        return char;
    }
  });
}

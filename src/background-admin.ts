import type {
  AdminProgressionUserLookupEntry,
  AdminProgressionUserLookupResponse,
} from './admin/model';
import { getApiBaseUrl } from './api/baseUrl';
import type { BackgroundImageSummary } from './backgrounds/client';

export interface BackgroundAdminController {
  refresh(): Promise<void>;
  handleAdminKeyChange(): void;
}

interface BackgroundAdminControllerOptions {
  getAdminKey(): string;
}

export function setupBackgroundAdminController(
  options: BackgroundAdminControllerOptions,
): BackgroundAdminController {
  const statusFilter = byId<HTMLSelectElement>('background-status-filter');
  const refreshButton = byId<HTMLButtonElement>('background-review-refresh-button');
  const queueStatus = byId<HTMLElement>('background-queue-status');
  const queue = byId<HTMLElement>('background-queue');
  const reviewOperator = byId<HTMLInputElement>('background-review-operator-input');
  const navCount = byId<HTMLElement>('photo-review-nav-count');
  const userQueryInput = byId<HTMLInputElement>('background-user-query-input');
  const userSearchButton = byId<HTMLButtonElement>('background-user-search-button');
  const userSearchStatus = byId<HTMLElement>('background-user-search-status');
  const userResults = byId<HTMLElement>('background-user-results');
  const permissionPanel = byId<HTMLElement>('background-permission-panel');
  const permissionUserName = byId<HTMLElement>('background-permission-user-name');
  const permissionUserMeta = byId<HTMLElement>('background-permission-user-meta');
  const permissionCanUpload = byId<HTMLInputElement>('background-permission-can-upload');
  const permissionAutoApprove = byId<HTMLInputElement>('background-permission-auto-approve');
  const permissionReason = byId<HTMLTextAreaElement>('background-permission-reason');
  const permissionOperator = byId<HTMLInputElement>('background-permission-operator');
  const permissionSaveButton = byId<HTMLButtonElement>('background-permission-save-button');

  let selectedUserId: string | null = null;

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

  renderKeyRequiredState();

  return {
    refresh: refreshQueue,
    handleAdminKeyChange() {
      if (options.getAdminKey()) {
        void refreshQueue();
        return;
      }
      selectedUserId = null;
      if (permissionPanel) {
        permissionPanel.hidden = true;
      }
      if (userResults) {
        userResults.replaceChildren();
      }
      renderKeyRequiredState();
    },
  };

  async function refreshQueue(): Promise<void> {
    if (!options.getAdminKey()) {
      renderKeyRequiredState();
      return;
    }
    setStatus(queueStatus, 'Loading photo uploads...', false);

    try {
      const payload = await adminRequest<{ items: BackgroundImageSummary[] }>(
        `/api/admin/background-images?status=${encodeURIComponent(statusFilter?.value ?? 'pending_review')}`,
      );
      renderQueue(payload.items);
      const label = payload.items.length === 1 ? 'photo' : 'photos';
      setStatus(queueStatus, `${payload.items.length} ${label} in this queue.`, false);
      if (navCount) {
        navCount.textContent = String(payload.items.length);
        navCount.hidden = false;
      }
    } catch (error) {
      setStatus(queueStatus, getErrorMessage(error), true);
      if (navCount) {
        navCount.hidden = true;
      }
    }
  }

  function renderQueue(items: BackgroundImageSummary[]): void {
    if (!queue) {
      return;
    }
    queue.replaceChildren();
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'admin-empty-state';
      empty.innerHTML = '<span aria-hidden="true">✓</span><strong>Queue clear</strong><span>No photos in this bucket.</span>';
      queue.appendChild(empty);
      return;
    }

    for (const item of items) {
      queue.appendChild(buildPhotoCard(item));
    }
  }

  function buildPhotoCard(item: BackgroundImageSummary): HTMLElement {
    const card = document.createElement('article');
    card.className = 'card photo-review-card';
    card.dataset.status = item.status;

    const previewWrap = document.createElement('div');
    previewWrap.className = 'photo-preview-wrap';
    if (item.imageUrl && item.status !== 'blocked') {
      const image = document.createElement('img');
      image.className = shouldBlur(item) ? 'photo-preview blurred' : 'photo-preview';
      image.alt = item.filename;
      image.src = item.thumbnailUrl ?? item.imageUrl;
      previewWrap.appendChild(image);
      if (shouldBlur(item)) {
        const reveal = document.createElement('button');
        reveal.type = 'button';
        reveal.className = 'photo-reveal-button secondary';
        reveal.textContent = 'Reveal flagged photo';
        reveal.addEventListener('click', () => {
          image.classList.toggle('blurred');
          reveal.textContent = image.classList.contains('blurred')
            ? 'Reveal flagged photo'
            : 'Blur flagged photo';
        });
        previewWrap.appendChild(reveal);
      }
    } else {
      const hidden = document.createElement('div');
      hidden.className = 'photo-preview-unavailable';
      hidden.innerHTML = `<span aria-hidden="true">${item.status === 'blocked' ? '⊘' : '◌'}</span><span>${item.status === 'blocked' ? 'Blocked photo hidden' : 'Photo not available yet'}</span>`;
      previewWrap.appendChild(hidden);
    }

    const copy = document.createElement('div');
    copy.className = 'photo-card-copy stack';

    const head = document.createElement('div');
    head.className = 'photo-card-head';
    const titleWrap = document.createElement('div');
    const eyebrow = document.createElement('span');
    eyebrow.className = 'label';
    eyebrow.textContent = item.ownerDisplayName;
    const title = document.createElement('h3');
    title.textContent = item.filename;
    titleWrap.append(eyebrow, title);
    const status = buildChip(formatStatus(item.status), statusTone(item.status));
    head.append(titleWrap, status);

    const details = document.createElement('div');
    details.className = 'photo-card-details';
    details.innerHTML = [
      `<span><strong>${escapeHtml(formatFileSize(item.sizeBytes))}</strong> ${escapeHtml(item.mimeType)}</span>`,
      `<span><strong>${escapeHtml(String(item.usageCount))}</strong> room use${item.usageCount === 1 ? '' : 's'}</span>`,
      `<span>${escapeHtml(formatTimestamp(item.createdAt))}</span>`,
    ].join('');

    const chips = document.createElement('div');
    chips.className = 'chips';
    chips.append(
      buildChip(
        formatStatus(item.moderationStatus),
        item.moderationStatus === 'passed'
          ? 'good'
          : item.moderationStatus === 'flagged'
            ? 'warn'
            : item.moderationStatus === 'blocked'
              ? 'danger'
              : '',
      ),
      buildChip(
        item.moderationScore === null
          ? 'No moderation score'
          : `${Math.round(item.moderationScore * 100)}% confidence`,
        '',
      ),
      ...item.moderationLabels.map((label) => buildChip(label, '')),
    );

    const reason = document.createElement('div');
    reason.className = 'photo-moderation-note';
    reason.textContent = item.moderationReason ?? 'No moderation note.';

    const actions = document.createElement('div');
    actions.className = 'photo-actions';
    const approve = document.createElement('button');
    approve.type = 'button';
    approve.className = 'success';
    approve.innerHTML = '<span aria-hidden="true">✓</span> Approve';
    approve.disabled = item.status === 'approved' || item.status === 'blocked';
    approve.addEventListener('click', () => void reviewUpload(item.id, 'approved'));
    const reject = document.createElement('button');
    reject.type = 'button';
    reject.className = 'danger';
    reject.innerHTML = '<span aria-hidden="true">×</span> Reject';
    reject.disabled = item.status === 'rejected';
    reject.addEventListener('click', () => void reviewUpload(item.id, 'rejected'));
    actions.append(approve, reject);

    copy.append(head, details, chips, reason, actions);
    card.append(previewWrap, copy);
    return card;
  }

  async function reviewUpload(
    id: string,
    decision: 'approved' | 'rejected',
  ): Promise<void> {
    const reason =
      window.prompt(`${decision === 'approved' ? 'Approval' : 'Rejection'} reason`, '') ?? '';
    setStatus(
      queueStatus,
      `${decision === 'approved' ? 'Approving' : 'Rejecting'} photo...`,
      false,
    );
    try {
      await adminRequest(`/api/admin/background-images/${encodeURIComponent(id)}/review`, {
        method: 'POST',
        body: JSON.stringify({
          decision,
          reason,
          operatorLabel: reviewOperator?.value.trim() || 'Admin',
        }),
      });
      await refreshQueue();
    } catch (error) {
      setStatus(queueStatus, getErrorMessage(error), true);
    }
  }

  async function searchUsers(): Promise<void> {
    if (!options.getAdminKey()) {
      setStatus(userSearchStatus, 'Paste the admin key before searching.', true);
      return;
    }
    const query = userQueryInput?.value.trim() ?? '';
    if (!query) {
      setStatus(userSearchStatus, 'Enter a user id, email, or display name.', true);
      return;
    }
    setStatus(userSearchStatus, 'Searching builders...', false);
    try {
      const payload = await adminRequest<AdminProgressionUserLookupResponse>(
        `/api/admin/progression/users?query=${encodeURIComponent(query)}`,
      );
      renderUserResults(payload.items);
      setStatus(
        userSearchStatus,
        `${payload.items.length} matching builder${payload.items.length === 1 ? '' : 's'}.`,
        false,
      );
    } catch (error) {
      setStatus(userSearchStatus, getErrorMessage(error), true);
    }
  }

  function renderUserResults(items: AdminProgressionUserLookupEntry[]): void {
    if (!userResults) {
      return;
    }
    userResults.replaceChildren();
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'meta';
      empty.textContent = 'No builders matched that search.';
      userResults.appendChild(empty);
      return;
    }
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
    setStatus(userSearchStatus, 'Loading photo access...', false);
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
      setStatus(userSearchStatus, `Loaded photo access for ${payload.user.displayName}.`, false);
    } catch (error) {
      setStatus(userSearchStatus, getErrorMessage(error), true);
    }
  }

  async function savePermission(): Promise<void> {
    if (!selectedUserId) {
      setStatus(userSearchStatus, 'Select a builder before saving photo access.', true);
      return;
    }
    try {
      await adminRequest(
        `/api/admin/background-images/permissions/${encodeURIComponent(selectedUserId)}`,
        {
          method: 'POST',
          body: JSON.stringify({
            canUpload: permissionCanUpload?.checked ?? false,
            autoApprove: permissionAutoApprove?.checked ?? false,
            reason: permissionReason?.value ?? '',
            operatorLabel: permissionOperator?.value.trim() || 'Admin',
          }),
        },
      );
      setStatus(userSearchStatus, 'Photo access saved.', false);
    } catch (error) {
      setStatus(userSearchStatus, getErrorMessage(error), true);
    }
  }

  async function adminRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const adminKey = options.getAdminKey();
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

  function renderKeyRequiredState(): void {
    setStatus(queueStatus, 'Paste the admin key to load photo approvals.', false);
    setStatus(userSearchStatus, 'Paste the admin key to manage photo access.', false);
    if (queue) {
      queue.innerHTML =
        '<div class="admin-empty-state"><span aria-hidden="true">▣</span><strong>Photo review is locked</strong><span>Use the admin key above to open the queue.</span></div>';
    }
    if (navCount) {
      navCount.hidden = true;
    }
  }
}

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function shouldBlur(item: BackgroundImageSummary): boolean {
  return (
    item.moderationStatus === 'flagged' ||
    (item.moderationScore !== null && item.moderationScore >= 0.9)
  );
}

function buildChip(label: string, tone: string): HTMLElement {
  const chip = document.createElement('span');
  chip.className = tone ? `chip ${tone}` : 'chip';
  chip.textContent = label;
  return chip;
}

function statusTone(status: BackgroundImageSummary['status']): string {
  switch (status) {
    case 'approved':
      return 'good';
    case 'rejected':
    case 'blocked':
      return 'danger';
    case 'pending_review':
    case 'upload_pending':
      return 'warn';
  }
}

function formatStatus(value: string): string {
  return value
    .split('_')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) {
    return `${kilobytes.toFixed(kilobytes >= 100 ? 0 : 1)} KB`;
  }
  const megabytes = kilobytes / 1024;
  return `${megabytes.toFixed(megabytes >= 10 ? 1 : 2)} MB`;
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

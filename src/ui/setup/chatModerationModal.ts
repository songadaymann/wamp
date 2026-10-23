import { formatAccountIdentity } from '../../auth/displayIdentity';
import { ChatAdminPicker } from './chatAdminPicker';
import { setLiveMessage } from '../friendlyError';
import {
  AUTH_STATE_CHANGED_EVENT,
  getAuthDebugState,
  type AuthDebugState,
} from '../../auth/client';
import type { ChatBanRecord, ChatModerationUserRecord } from '../../chat/model';
import {
  fetchChatAdmins,
  fetchChatBans,
  grantChatAdmin,
  revokeChatAdmin,
  unbanChatUser,
} from '../chat/client';

type ChatModerationModalElements = {
  openButton: HTMLButtonElement | null;
  modal: HTMLElement | null;
  closeButton: HTMLButtonElement | null;
  status: HTMLElement | null;
  adminSection: HTMLElement | null;
  adminForm: HTMLFormElement | null;
  adminInput: HTMLInputElement | null;
  adminAddButton: HTMLButtonElement | null;
  adminList: HTMLElement | null;
  banSection: HTMLElement | null;
  banList: HTMLElement | null;
};

export class ChatModerationModalController {
  private readonly elements: ChatModerationModalElements;
  private authState: AuthDebugState = getAuthDebugState();
  private admins: ChatModerationUserRecord[] = [];
  private bans: ChatBanRecord[] = [];
  private loading = false;
  private actionPending = false;
  private readonly picker: ChatAdminPicker;
  private loadGeneration = 0;

  private readonly handleCloseClick = () => {
    this.close();
  };

  private readonly handleBackdropClick = (event: Event) => {
    if (event.target === this.elements.modal) {
      this.close();
    }
  };

  private readonly handleDocumentKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || this.elements.modal?.classList.contains('hidden')) {
      return;
    }

    this.close();
  };

  private readonly handleAuthStateChanged = (event: Event) => {
    const detail = event instanceof CustomEvent ? (event.detail as AuthDebugState | undefined) : undefined;
    const next = detail ?? getAuthDebugState();
    if (next.user?.id !== this.authState.user?.id || next.chatModeration.role !== this.authState.chatModeration.role) {
      this.loadGeneration += 1;
      this.picker.clear();
      this.admins = []; this.bans = [];
      this.loading = false;
    }
    this.authState = next;
    if (this.authState.chatModeration.role === 'none') {
      this.close();
    }
    this.render();
  };

  private readonly handleAdminFormSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    void this.submitAdminGrant();
  };

  constructor(private readonly doc: Document = document) {
    this.elements = {
      openButton: this.doc.getElementById('btn-chat-moderation-open') as HTMLButtonElement | null,
      modal: this.doc.getElementById('chat-moderation-modal'),
      closeButton: this.doc.getElementById('btn-chat-moderation-close') as HTMLButtonElement | null,
      status: this.doc.getElementById('chat-moderation-status'),
      adminSection: this.doc.getElementById('chat-moderation-admin-section'),
      adminForm: this.doc.getElementById('chat-moderation-admin-form') as HTMLFormElement | null,
      adminInput: this.doc.getElementById('chat-moderation-admin-input') as HTMLInputElement | null,
      adminAddButton: this.doc.getElementById('btn-chat-moderation-admin-add') as HTMLButtonElement | null,
      adminList: this.doc.getElementById('chat-moderation-admin-list'),
      banSection: this.doc.getElementById('chat-moderation-ban-section'),
      banList: this.doc.getElementById('chat-moderation-ban-list'),
    };
    this.picker = new ChatAdminPicker({ doc: this.doc, input: this.elements.adminInput,
      results: this.doc.getElementById('chat-moderation-admin-results'),
      status: this.doc.getElementById('chat-moderation-admin-search-status'),
      changed: () => this.render(),
    });
  }

  init(): void {
    this.picker.init();
    this.elements.closeButton?.addEventListener('click', this.handleCloseClick);
    this.elements.modal?.addEventListener('click', this.handleBackdropClick);
    this.elements.adminForm?.addEventListener('submit', this.handleAdminFormSubmit);
    this.doc.addEventListener('keydown', this.handleDocumentKeydown);
    window.addEventListener(AUTH_STATE_CHANGED_EVENT, this.handleAuthStateChanged as EventListener);
    this.render();
  }

  destroy(): void {
    this.elements.closeButton?.removeEventListener('click', this.handleCloseClick);
    this.elements.modal?.removeEventListener('click', this.handleBackdropClick);
    this.elements.adminForm?.removeEventListener('submit', this.handleAdminFormSubmit);
    this.doc.removeEventListener('keydown', this.handleDocumentKeydown);
    window.removeEventListener(AUTH_STATE_CHANGED_EVENT, this.handleAuthStateChanged as EventListener);
    this.close();
    this.picker.destroy();
  }

  async open(): Promise<void> {
    if (!this.elements.modal || this.authState.chatModeration.role === 'none') {
      return;
    }

    this.picker.clear();
    this.elements.modal.classList.remove('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'false');
    const generation = this.loadGeneration + 1;
    await this.load();
    if (generation !== this.loadGeneration || this.elements.modal.classList.contains('hidden')) return;
    if (this.authState.chatModeration.role === 'owner') {
      this.elements.adminInput?.focus();
      this.elements.adminInput?.select();
    }
  }

  close(): void {
    if (!this.elements.modal) {
      return;
    }

    this.elements.modal.classList.add('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'true');
    this.loadGeneration += 1;
    this.loading = false;
    this.picker.clear();
    this.setStatus('', false);
  }

  private async load(): Promise<void> {
    const generation = ++this.loadGeneration;
    this.loading = true;
    this.render();

    try {
      if (this.authState.chatModeration.role === 'owner') {
        const [adminsResponse, bansResponse] = await Promise.all([
          fetchChatAdmins(),
          fetchChatBans(),
        ]);
        if (generation !== this.loadGeneration) return;
        this.admins = adminsResponse.admins;
        this.bans = bansResponse.bans;
      } else {
        const bansResponse = await fetchChatBans();
        if (generation !== this.loadGeneration) return;
        this.admins = [];
        this.bans = bansResponse.bans;
      }
      this.setStatus('', false);
    } catch (error) {
      if (generation !== this.loadGeneration) return;
      console.error('Failed to load chat moderation data', error);
      this.setStatus(getErrorMessage(error, 'Failed to load chat moderation data.'), true);
    } finally {
      if (generation === this.loadGeneration) { this.loading = false; this.render(); }
    }
  }

  private async submitAdminGrant(): Promise<void> {
    if (
      this.authState.chatModeration.role !== 'owner'
      || this.actionPending
      || !this.elements.adminInput
    ) {
      return;
    }

    const selected = this.picker.getSelection();
    if (!selected) {
      this.setStatus('Select a matching account first.', true);
      return;
    }

    const generation = this.loadGeneration;
    const displayName = formatAccountIdentity(selected.displayName, selected.username);
    this.actionPending = true;
    this.setStatus(`Adding ${displayName} as chat admin...`, false);
    this.render();

    try {
      await grantChatAdmin(selected.userId);
      if (generation !== this.loadGeneration) return;
      this.picker.clear();
      await this.load();
      if (generation + 1 !== this.loadGeneration) return;
      this.setStatus(`${displayName} is now a chat admin.`, false);
    } catch (error) {
      if (generation !== this.loadGeneration) return;
      console.error('Failed to grant chat admin', error);
      this.setStatus(getErrorMessage(error, 'Failed to grant chat admin.'), true);
    } finally {
      this.actionPending = false;
      this.render();
    }
  }

  private async handleRevokeAdmin(admin: ChatModerationUserRecord): Promise<void> {
    if (
      this.authState.chatModeration.role !== 'owner'
      || this.actionPending
      || !window.confirm(`Remove ${formatAccountIdentity(admin.displayName, admin.username)} as chat admin?`)
    ) {
      return;
    }

    this.actionPending = true;
    this.setStatus(`Removing ${formatAccountIdentity(admin.displayName, admin.username)}...`, false);
    this.render();

    try {
      await revokeChatAdmin(admin.userId);
      await this.load();
      this.setStatus(`${formatAccountIdentity(admin.displayName, admin.username)} is no longer a chat admin.`, false);
    } catch (error) {
      console.error('Failed to revoke chat admin', error);
      this.setStatus(getErrorMessage(error, 'Failed to revoke chat admin.'), true);
    } finally {
      this.actionPending = false;
      this.render();
    }
  }

  private async handleUnban(ban: ChatBanRecord): Promise<void> {
    if (
      this.authState.chatModeration.role === 'none'
      || this.actionPending
      || !window.confirm(`Unban ${formatAccountIdentity(ban.displayName, ban.username)} from chat?`)
    ) {
      return;
    }

    this.actionPending = true;
    this.setStatus(`Unbanning ${formatAccountIdentity(ban.displayName, ban.username)}...`, false);
    this.render();

    try {
      await unbanChatUser(ban.userId);
      await this.load();
      this.setStatus(`${formatAccountIdentity(ban.displayName, ban.username)} was unbanned from chat.`, false);
    } catch (error) {
      console.error('Failed to unban chat user', error);
      this.setStatus(getErrorMessage(error, 'Failed to unban chat user.'), true);
    } finally {
      this.actionPending = false;
      this.render();
    }
  }

  private render(): void {
    this.elements.openButton?.classList.toggle('hidden', this.authState.chatModeration.role === 'none');
    if (this.elements.openButton) {
      this.elements.openButton.disabled = this.authState.loading;
    }

    this.elements.adminSection?.classList.toggle('hidden', this.authState.chatModeration.role !== 'owner');
    this.elements.banSection?.classList.toggle('hidden', this.authState.chatModeration.role === 'none');

    this.picker.setEnabled(!this.loading && !this.actionPending && this.authState.chatModeration.role === 'owner'
      && !this.elements.modal?.classList.contains('hidden'));

    if (this.elements.adminAddButton) {
      this.elements.adminAddButton.disabled = this.loading || this.actionPending || this.authState.chatModeration.role !== 'owner'
        || !this.picker.getSelection();
    }

    this.renderAdminList();
    this.renderBanList();
  }

  private renderAdminList(): void {
    if (!this.elements.adminList) {
      return;
    }

    this.elements.adminList.replaceChildren();
    if (this.authState.chatModeration.role !== 'owner') {
      return;
    }

    if (this.loading) {
      this.elements.adminList.appendChild(this.buildEmptyRow('Loading chat admins...'));
      return;
    }

    if (this.admins.length === 0) {
      this.elements.adminList.appendChild(this.buildEmptyRow('No delegated chat admins yet.'));
      return;
    }

    for (const admin of this.admins) {
      const row = this.doc.createElement('div');
      row.className = 'chat-moderation-item';

      const text = this.doc.createElement('div');
      text.className = 'chat-moderation-item-text';

      const title = this.doc.createElement('div');
      title.className = 'chat-moderation-item-title';
      title.textContent = formatAccountIdentity(admin.displayName, admin.username);

      const meta = this.doc.createElement('div');
      meta.className = 'chat-moderation-item-meta';
      meta.textContent = admin.grantedByDisplayName
        ? `Granted by ${formatAccountIdentity(admin.grantedByDisplayName, admin.grantedByUsername)}`
        : 'Granted by owner';

      const action = this.doc.createElement('button');
      action.className = 'bar-btn bar-btn-small';
      action.type = 'button';
      action.textContent = this.actionPending ? 'Working...' : 'Remove';
      action.disabled = this.loading || this.actionPending;
      action.addEventListener('click', () => {
        void this.handleRevokeAdmin(admin);
      });

      text.append(title, meta);
      row.append(text, action);
      this.elements.adminList.appendChild(row);
    }
  }

  private renderBanList(): void {
    if (!this.elements.banList) {
      return;
    }

    this.elements.banList.replaceChildren();
    if (this.authState.chatModeration.role === 'none') {
      return;
    }

    if (this.loading) {
      this.elements.banList.appendChild(this.buildEmptyRow('Loading banned users...'));
      return;
    }

    if (this.bans.length === 0) {
      this.elements.banList.appendChild(this.buildEmptyRow('No one is banned from chat.'));
      return;
    }

    for (const ban of this.bans) {
      const row = this.doc.createElement('div');
      row.className = 'chat-moderation-item';

      const text = this.doc.createElement('div');
      text.className = 'chat-moderation-item-text';

      const title = this.doc.createElement('div');
      title.className = 'chat-moderation-item-title';
      title.textContent = formatAccountIdentity(ban.displayName, ban.username);

      const meta = this.doc.createElement('div');
      meta.className = 'chat-moderation-item-meta';
      meta.textContent = ban.bannedByDisplayName
        ? `Banned by ${formatAccountIdentity(ban.bannedByDisplayName, ban.bannedByUsername)}`
        : 'Banned';

      const action = this.doc.createElement('button');
      action.className = 'bar-btn bar-btn-small';
      action.type = 'button';
      action.textContent = this.actionPending ? 'Working...' : 'Unban';
      action.disabled = this.loading || this.actionPending;
      action.addEventListener('click', () => {
        void this.handleUnban(ban);
      });

      text.append(title, meta);
      row.append(text, action);
      this.elements.banList.appendChild(row);
    }
  }

  private buildEmptyRow(label: string): HTMLElement {
    const empty = this.doc.createElement('div');
    empty.className = 'chat-moderation-empty';
    empty.textContent = label;
    return empty;
  }

  private setStatus(message: string, isError: boolean): void {
    if (!this.elements.status) {
      return;
    }

    setLiveMessage(this.elements.status, message, isError ? 'error' : 'status');
    this.elements.status.classList.toggle('history-modal-error', Boolean(message) && isError);
    this.elements.status.classList.toggle('chat-moderation-status-success', Boolean(message) && !isError);
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(error.message) as { error?: string };
    return parsed.error ?? fallback;
  } catch {
    return error.message || fallback;
  }
}

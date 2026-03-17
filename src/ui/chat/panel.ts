import {
  type ChatMessageListResponse,
  CHAT_MESSAGE_MAX_LENGTH,
  DEFAULT_CHAT_MESSAGE_LIMIT,
  type ChatMessageRecord,
} from '../../chat/model';
import {
  AUTH_STATE_CHANGED_EVENT,
  getAuthDebugState,
  syncChatModerationState,
  type AuthDebugState,
} from '../../auth/client';
import { playSfx } from '../../audio/sfx';
import { isPlayfunMode } from '../../playfun/client';
import { APP_READY_EVENT, isAppReady } from '../appFeedback';
import { getDeviceLayoutState } from '../deviceLayout';
import { isTextInputFocused } from '../keyboardFocus';
import { banChatUser, deleteChatMessage, fetchChatMessages, sendChatMessage } from './client';

const CHAT_POLL_INTERVAL_MS = 3000;
const MAX_RENDERED_MESSAGES = 100;
const TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

type ChatElements = {
  root: HTMLElement | null;
  toggleButton: HTMLButtonElement | null;
  body: HTMLElement | null;
  unreadBadge: HTMLElement | null;
  messages: HTMLElement | null;
  empty: HTMLElement | null;
  form: HTMLFormElement | null;
  input: HTMLInputElement | null;
  sendButton: HTMLButtonElement | null;
  status: HTMLElement | null;
};

declare global {
  interface Window {
    get_chat_debug_state?: () => Record<string, unknown>;
  }
}

export class ChatPanelController {
  private readonly elements: ChatElements;
  private readonly seenMessageIds = new Set<string>();
  private readonly appModeObserver: MutationObserver;
  private pollTimer: number | null = null;
  private authState: AuthDebugState = getAuthDebugState();
  private messages: ChatMessageRecord[] = [];
  private latestCreatedAt: string | null = null;
  private unreadCount = 0;
  private open = false;
  private openedOnFirstWorldVisit = false;
  private historyLoaded = false;
  private initialLoadInFlight = false;
  private loading = false;
  private sending = false;
  private moderationActionMessageId: string | null = null;
  private destroyed = false;

  private readonly handleToggleClick = () => {
    if (this.open) {
      this.closePanel();
      return;
    }

    this.openPanel(true);
  };

  private readonly handleFormSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    void this.submitMessage();
  };

  private readonly handleDocumentKeydown = (event: KeyboardEvent) => {
    if (!this.isWorldModeActive()) {
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
      if (isTextInputFocused()) {
        return;
      }

      event.preventDefault();
      this.openPanel(true);
      return;
    }

    if (event.key === 'Escape' && this.open) {
      event.preventDefault();
      this.closePanel();
    }
  };

  private readonly handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      void this.ensureLoaded();
      void this.pollForNewMessages();
    }
  };

  private readonly handleAppReady = () => {
    if (this.isWorldModeActive()) {
      void this.ensureLoaded();
      void this.pollForNewMessages();
    }
  };

  private readonly handleAuthStateChanged = (event: Event) => {
    const detail = event instanceof CustomEvent ? (event.detail as AuthDebugState | undefined) : undefined;
    this.authState = detail ?? getAuthDebugState();
    this.render();
    this.renderMessages();
  };

  constructor(
    private readonly doc: Document = document,
    private readonly windowObj: Window = window
  ) {
    this.elements = {
      root: this.doc.getElementById('global-chat'),
      toggleButton: this.doc.getElementById('btn-chat-toggle') as HTMLButtonElement | null,
      body: this.doc.getElementById('global-chat-body'),
      unreadBadge: this.doc.getElementById('chat-unread-badge'),
      messages: this.doc.getElementById('chat-messages'),
      empty: this.doc.getElementById('chat-empty'),
      form: this.doc.getElementById('chat-form') as HTMLFormElement | null,
      input: this.doc.getElementById('chat-input') as HTMLInputElement | null,
      sendButton: this.doc.getElementById('btn-chat-send') as HTMLButtonElement | null,
      status: this.doc.getElementById('chat-status'),
    };

    this.appModeObserver = new MutationObserver(() => {
      this.handleAppModeChange();
    });
  }

  init(): void {
    if (!this.elements.root) {
      return;
    }

    this.elements.input?.setAttribute('maxlength', String(CHAT_MESSAGE_MAX_LENGTH));
    this.elements.toggleButton?.addEventListener('click', this.handleToggleClick);
    this.elements.form?.addEventListener('submit', this.handleFormSubmit);
    this.doc.addEventListener('keydown', this.handleDocumentKeydown);
    this.doc.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.windowObj.addEventListener(AUTH_STATE_CHANGED_EVENT, this.handleAuthStateChanged as EventListener);
    this.windowObj.addEventListener(APP_READY_EVENT, this.handleAppReady as EventListener);
    this.appModeObserver.observe(this.doc.body, {
      attributes: true,
      attributeFilter: ['data-app-mode'],
    });

    this.pollTimer = this.windowObj.setInterval(() => {
      void this.pollForNewMessages();
    }, CHAT_POLL_INTERVAL_MS);

    this.windowObj.get_chat_debug_state = () => this.getDebugState();
    this.handleAppModeChange();
    this.render();
  }

  destroy(): void {
    this.destroyed = true;
    this.elements.toggleButton?.removeEventListener('click', this.handleToggleClick);
    this.elements.form?.removeEventListener('submit', this.handleFormSubmit);
    this.doc.removeEventListener('keydown', this.handleDocumentKeydown);
    this.doc.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.windowObj.removeEventListener(AUTH_STATE_CHANGED_EVENT, this.handleAuthStateChanged as EventListener);
    this.windowObj.removeEventListener(APP_READY_EVENT, this.handleAppReady as EventListener);
    this.appModeObserver.disconnect();

    if (this.pollTimer !== null) {
      this.windowObj.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    delete this.windowObj.get_chat_debug_state;
  }

  getDebugState(): Record<string, unknown> {
    return {
      visible: this.isWorldModeActive(),
      open: this.open,
      authenticated: this.authState.authenticated,
      loading: this.loading,
      sending: this.sending,
      role: this.authState.chatModeration.role,
      banned: this.authState.chatModeration.banned,
      moderationActionMessageId: this.moderationActionMessageId,
      messageCount: this.messages.length,
      unreadCount: this.unreadCount,
      latestCreatedAt: this.latestCreatedAt,
      latestMessage:
        this.messages.length > 0 ? this.messages[this.messages.length - 1] : null,
    };
  }

  private handleAppModeChange(): void {
    if (this.isWorldModeActive()) {
      if (!this.openedOnFirstWorldVisit) {
        this.openedOnFirstWorldVisit = true;
        if (this.shouldAutoOpenOnFirstWorldVisit()) {
          this.openPanel(false);
          return;
        }
      }

      this.render();
      if (isAppReady()) {
        void this.ensureLoaded();
      }
      return;
    }

    this.closePanel(false);
  }

  private isWorldModeActive(): boolean {
    const mode = this.doc.body.dataset.appMode;
    return mode === 'world' || mode === 'play-world';
  }

  private shouldAutoOpenOnFirstWorldVisit(): boolean {
    const layout = getDeviceLayoutState();
    return !isPlayfunMode() && !layout.coarsePointer;
  }

  private canPost(): boolean {
    return this.authState.authenticated && !this.authState.loading && !this.authState.chatModeration.banned;
  }

  private canModerateMessages(): boolean {
    return this.authState.chatModeration.role === 'owner' || this.authState.chatModeration.role === 'admin';
  }

  private async ensureLoaded(): Promise<void> {
    if (
      !this.isWorldModeActive() ||
      !isAppReady() ||
      this.historyLoaded ||
      this.initialLoadInFlight ||
      this.loading
    ) {
      return;
    }

    this.initialLoadInFlight = true;
    this.loading = true;
    this.render();

    try {
      const response = await fetchChatMessages({ limit: DEFAULT_CHAT_MESSAGE_LIMIT });
      this.applyChatResponse(response, false);
      this.historyLoaded = true;
    } catch (error) {
      console.error('Failed to load chat history', error);
      this.setStatus(this.canPost() ? 'Chat failed to load.' : 'Chat is read-only right now.');
    } finally {
      this.initialLoadInFlight = false;
      this.loading = false;
      this.render();
    }
  }

  private async pollForNewMessages(): Promise<void> {
    if (!this.shouldPoll() || this.loading) {
      return;
    }

    if (!this.historyLoaded) {
      await this.ensureLoaded();
      return;
    }

    this.loading = true;

    try {
      const response = this.latestCreatedAt
        ? await fetchChatMessages({
            after: this.latestCreatedAt,
            limit: DEFAULT_CHAT_MESSAGE_LIMIT,
          })
        : await fetchChatMessages({
            limit: DEFAULT_CHAT_MESSAGE_LIMIT,
          });
      this.applyChatResponse(response, true);
    } catch (error) {
      console.error('Failed to poll chat messages', error);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private shouldPoll(): boolean {
    return this.isWorldModeActive() && isAppReady() && this.doc.visibilityState === 'visible' && !this.destroyed;
  }

  private replaceMessages(nextMessages: ChatMessageRecord[]): void {
    this.seenMessageIds.clear();
    this.messages = [];
    this.latestCreatedAt = null;
    this.appendMessages(nextMessages, false);
    this.unreadCount = 0;
  }

  private applyChatResponse(response: ChatMessageListResponse, countUnread: boolean): void {
    this.authState = {
      ...this.authState,
      chatModeration: response.viewer,
    };
    syncChatModerationState(response.viewer);
    if (!this.historyLoaded || !countUnread) {
      this.replaceMessages(response.messages);
      return;
    }

    this.appendMessages(response.messages, true);
  }

  private appendMessages(nextMessages: ChatMessageRecord[], countUnread: boolean): void {
    if (nextMessages.length === 0) {
      return;
    }

    let appended = 0;
    for (const message of nextMessages) {
      if (this.seenMessageIds.has(message.id)) {
        continue;
      }

      this.seenMessageIds.add(message.id);
      this.messages.push(message);
      this.latestCreatedAt = message.createdAt;
      appended += 1;
    }

    if (appended === 0) {
      return;
    }

    if (this.messages.length > MAX_RENDERED_MESSAGES) {
      const overflow = this.messages.length - MAX_RENDERED_MESSAGES;
      const removed = this.messages.splice(0, overflow);
      for (const message of removed) {
        this.seenMessageIds.delete(message.id);
      }
    }

    if (countUnread && !this.open) {
      this.unreadCount += appended;
    }

    if (countUnread) {
      playSfx('chat-receive');
    }

    this.renderMessages();
    if (this.open) {
      this.scrollMessagesToBottom();
    }
  }

  private openPanel(focusComposer: boolean): void {
    this.open = true;
    this.unreadCount = 0;
    if (isAppReady()) {
      void this.ensureLoaded();
    }
    this.render();
    this.scrollMessagesToBottom();

    if (focusComposer && this.canPost()) {
      this.elements.input?.focus();
      this.elements.input?.select();
    }
  }

  private closePanel(blurComposer: boolean = true): void {
    this.open = false;
    this.unreadCount = 0;
    if (blurComposer && this.doc.activeElement === this.elements.input) {
      this.elements.input?.blur();
    }
    this.render();
  }

  private async submitMessage(): Promise<void> {
    if (!this.canPost() || !this.elements.input || this.sending) {
      return;
    }

    const rawValue = this.elements.input.value;
    const trimmed = rawValue.trim();
    if (!trimmed) {
      this.setStatus('Type a message first.');
      this.render();
      return;
    }

    this.sending = true;
    this.setStatus('Sending...');
    this.render();

    try {
      const message = await sendChatMessage(trimmed);
      this.elements.input.value = '';
      this.appendMessages([message], false);
      playSfx('chat-send');
      this.setStatus('Sent.');
    } catch (error) {
      console.error('Failed to send chat message', error);
      this.setStatus(getErrorMessage(error, 'Failed to send chat message.'));
    } finally {
      this.sending = false;
      this.render();
    }
  }

  private async handleDeleteMessage(message: ChatMessageRecord): Promise<void> {
    if (
      !this.canModerateMessages()
      || this.moderationActionMessageId
      || !this.windowObj.confirm(`Delete ${message.userDisplayName}'s chat message?`)
    ) {
      return;
    }

    this.moderationActionMessageId = message.id;
    this.setStatus('Deleting message...');
    this.render();

    try {
      const response = await deleteChatMessage(message.id);
      this.authState = {
        ...this.authState,
        chatModeration: response.viewer,
      };
      syncChatModerationState(response.viewer);
      await this.reloadMessages();
      this.setStatus('Message deleted.');
    } catch (error) {
      console.error('Failed to delete chat message', error);
      this.setStatus(getErrorMessage(error, 'Failed to delete chat message.'));
    } finally {
      this.moderationActionMessageId = null;
      this.render();
    }
  }

  private async handleBanUser(message: ChatMessageRecord): Promise<void> {
    if (
      !this.canModerateMessages()
      || this.moderationActionMessageId
      || !this.windowObj.confirm(`Ban ${message.userDisplayName} from chat?`)
    ) {
      return;
    }

    this.moderationActionMessageId = message.id;
    this.setStatus(`Banning ${message.userDisplayName}...`);
    this.render();

    try {
      const response = await banChatUser(message.userId);
      this.authState = {
        ...this.authState,
        chatModeration: response.viewer,
      };
      syncChatModerationState(response.viewer);
      await this.reloadMessages();
      this.setStatus(`${message.userDisplayName} was banned from chat.`);
    } catch (error) {
      console.error('Failed to ban chat user', error);
      this.setStatus(getErrorMessage(error, 'Failed to ban chat user.'));
    } finally {
      this.moderationActionMessageId = null;
      this.render();
    }
  }

  private async reloadMessages(): Promise<void> {
    const response = await fetchChatMessages({ limit: DEFAULT_CHAT_MESSAGE_LIMIT });
    this.historyLoaded = true;
    this.applyChatResponse(response, false);
  }

  private setStatus(message: string): void {
    if (this.elements.status) {
      this.elements.status.textContent = message;
    }
  }

  private render(): void {
    if (!this.elements.root) {
      return;
    }

    this.elements.root.classList.toggle('is-open', this.open);

    if (this.elements.body) {
      this.elements.body.classList.toggle('hidden', !this.open);
    }

    if (this.elements.unreadBadge) {
      this.elements.unreadBadge.textContent = String(this.unreadCount);
      this.elements.unreadBadge.classList.toggle('hidden', this.unreadCount <= 0);
    }

    if (this.elements.toggleButton) {
      this.elements.toggleButton.textContent = this.open ? 'World Chat -' : 'World Chat +';
      if (this.elements.unreadBadge) {
        this.elements.toggleButton.appendChild(this.elements.unreadBadge);
      }
    }

    if (this.elements.input) {
      this.elements.input.disabled = !this.canPost() || this.sending;
      this.elements.input.placeholder =
        this.authState.chatModeration.banned
          ? 'Chat banned'
          : this.canPost()
            ? 'Say something...'
            : 'Sign in to chat';
    }

    if (this.elements.sendButton) {
      this.elements.sendButton.disabled = !this.canPost() || this.sending;
      this.elements.sendButton.textContent = this.sending ? 'Sending...' : 'Send';
    }

    if (this.elements.empty) {
      this.elements.empty.classList.toggle('hidden', this.messages.length > 0);
    }

    if (!this.elements.status) {
      return;
    }

    if (this.sending) {
      return;
    }

    if (this.authState.chatModeration.banned) {
      this.elements.status.textContent = 'You are banned from chat. You can still read messages.';
      return;
    }

    if (!this.canPost()) {
      this.elements.status.textContent = 'Signed-in players can post. Guests can read only.';
      return;
    }

    if (this.messages.length === 0 && !this.loading) {
      this.elements.status.textContent = 'No messages yet.';
      return;
    }

    if (this.loading && this.messages.length === 0) {
      this.elements.status.textContent = 'Loading chat...';
      return;
    }

    if (this.elements.status.textContent === 'Sending...') {
      this.elements.status.textContent = 'Signed in. Chat is live.';
      return;
    }

    if (
      this.elements.status.textContent === 'Sent.' ||
      this.elements.status.textContent === 'No messages yet.' ||
      this.elements.status.textContent === 'Loading chat...'
    ) {
      this.elements.status.textContent = 'Signed in. Chat is live.';
    }
  }

  private renderMessages(): void {
    if (!this.elements.messages) {
      return;
    }

    this.elements.messages.replaceChildren();

    for (const message of this.messages) {
      const row = this.doc.createElement('div');
      row.className = 'chat-message';

      const header = this.doc.createElement('div');
      header.className = 'chat-message-header';

      const author = this.doc.createElement('span');
      author.className = 'chat-message-author';
      author.textContent = message.userDisplayName;

      const timestamp = this.doc.createElement('span');
      timestamp.className = 'chat-message-time';
      timestamp.textContent = formatMessageTimestamp(message.createdAt);

      const body = this.doc.createElement('div');
      body.className = 'chat-message-body';
      body.textContent = message.body;

      const canModerateThisMessage =
        this.canModerateMessages()
        && message.userId !== (this.authState.user?.id ?? null);

      if (canModerateThisMessage) {
        const actions = this.doc.createElement('div');
        actions.className = 'chat-message-actions';

        const deleteButton = this.doc.createElement('button');
        deleteButton.className = 'bar-btn bar-btn-small chat-message-action';
        deleteButton.type = 'button';
        deleteButton.textContent =
          this.moderationActionMessageId === message.id ? 'Working...' : 'Delete';
        deleteButton.disabled = this.moderationActionMessageId !== null;
        deleteButton.addEventListener('click', () => {
          void this.handleDeleteMessage(message);
        });

        const banButton = this.doc.createElement('button');
        banButton.className = 'bar-btn bar-btn-small bar-btn-danger chat-message-action';
        banButton.type = 'button';
        banButton.textContent =
          this.moderationActionMessageId === message.id ? 'Working...' : 'Ban';
        banButton.disabled = this.moderationActionMessageId !== null;
        banButton.addEventListener('click', () => {
          void this.handleBanUser(message);
        });

        header.append(author, timestamp);
        actions.append(deleteButton, banButton);
        row.append(header, body, actions);
        this.elements.messages.appendChild(row);
        continue;
      }

      header.append(author, timestamp);
      row.append(header, body);
      this.elements.messages.appendChild(row);
    }
  }

  private scrollMessagesToBottom(): void {
    if (!this.elements.messages) {
      return;
    }

    this.elements.messages.scrollTop = this.elements.messages.scrollHeight;
  }
}

function formatMessageTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  const now = new Date();
  const sameDay =
    parsed.getFullYear() === now.getFullYear() &&
    parsed.getMonth() === now.getMonth() &&
    parsed.getDate() === now.getDate();

  return sameDay ? TIME_FORMATTER.format(parsed) : DATE_TIME_FORMATTER.format(parsed);
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

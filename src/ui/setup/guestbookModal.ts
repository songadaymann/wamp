import { getGuestVisitSessionId } from '../../analytics/guestActivity';
import { getAuthDebugState } from '../../auth/client';
import { fetchGuestbookEntries, signGuestbook } from '../../guestbook/client';
import {
  DEFAULT_GUESTBOOK_LIMIT,
  GUESTBOOK_DISPLAY_NAME_MAX_LENGTH,
  GUESTBOOK_MESSAGE_MAX_LENGTH,
  type GuestbookConfigResponse,
  type GuestbookEntry,
} from '../../guestbook/model';
import { resolveWorldPresenceIdentity } from '../../presence/worldPresence';

type GuestbookModalElements = {
  openButton: HTMLButtonElement | null;
  modal: HTMLElement | null;
  closeButton: HTMLButtonElement | null;
  list: HTMLElement | null;
  empty: HTMLElement | null;
  status: HTMLElement | null;
  form: HTMLFormElement | null;
  nameInput: HTMLInputElement | null;
  messageInput: HTMLTextAreaElement | null;
  counter: HTMLElement | null;
  submitButton: HTMLButtonElement | null;
  turnstile: HTMLElement | null;
};

type TurnstileApi = {
  render(container: HTMLElement, options: {
    sitekey: string;
    action?: string;
    callback?: (token: string) => void;
    'expired-callback'?: () => void;
    'error-callback'?: () => void;
    theme?: 'auto' | 'light' | 'dark';
  }): string;
  reset(widgetId?: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const TURNSTILE_SCRIPT_ID = 'cf-turnstile-script';

export class GuestbookModalController {
  private readonly elements: GuestbookModalElements;
  private entries: GuestbookEntry[] = [];
  private config: GuestbookConfigResponse = {
    turnstileSiteKey: null,
    turnstileRequired: false,
  };
  private loading = false;
  private submitting = false;
  private turnstileToken: string | null = null;
  private turnstileWidgetId: string | null = null;
  private turnstileLoading: Promise<void> | null = null;

  private readonly handleOpenClick = () => {
    void this.open();
  };

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

  private readonly handleFormSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    void this.submit();
  };

  private readonly handleMessageInput = () => {
    this.renderCounter();
  };

  constructor(private readonly doc: Document = document) {
    this.elements = {
      openButton: this.doc.getElementById('btn-guestbook-open') as HTMLButtonElement | null,
      modal: this.doc.getElementById('guestbook-modal'),
      closeButton: this.doc.getElementById('btn-guestbook-close') as HTMLButtonElement | null,
      list: this.doc.getElementById('guestbook-list'),
      empty: this.doc.getElementById('guestbook-empty'),
      status: this.doc.getElementById('guestbook-status'),
      form: this.doc.getElementById('guestbook-form') as HTMLFormElement | null,
      nameInput: this.doc.getElementById('guestbook-name-input') as HTMLInputElement | null,
      messageInput: this.doc.getElementById('guestbook-message-input') as HTMLTextAreaElement | null,
      counter: this.doc.getElementById('guestbook-message-counter'),
      submitButton: this.doc.getElementById('btn-guestbook-submit') as HTMLButtonElement | null,
      turnstile: this.doc.getElementById('guestbook-turnstile'),
    };
  }

  init(): void {
    this.elements.openButton?.addEventListener('click', this.handleOpenClick);
    this.elements.closeButton?.addEventListener('click', this.handleCloseClick);
    this.elements.modal?.addEventListener('click', this.handleBackdropClick);
    this.elements.form?.addEventListener('submit', this.handleFormSubmit);
    this.elements.messageInput?.addEventListener('input', this.handleMessageInput);
    this.doc.addEventListener('keydown', this.handleDocumentKeydown);
    this.syncDefaultName();
    this.renderCounter();
  }

  destroy(): void {
    this.elements.openButton?.removeEventListener('click', this.handleOpenClick);
    this.elements.closeButton?.removeEventListener('click', this.handleCloseClick);
    this.elements.modal?.removeEventListener('click', this.handleBackdropClick);
    this.elements.form?.removeEventListener('submit', this.handleFormSubmit);
    this.elements.messageInput?.removeEventListener('input', this.handleMessageInput);
    this.doc.removeEventListener('keydown', this.handleDocumentKeydown);
    this.close();
  }

  async open(): Promise<void> {
    if (!this.elements.modal) {
      return;
    }

    this.elements.modal.classList.remove('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'false');
    this.syncDefaultName();
    await this.load();
    this.elements.messageInput?.focus();
  }

  close(): void {
    if (!this.elements.modal) {
      return;
    }

    this.elements.modal.classList.add('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'true');
    this.setStatus('', false);
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.render();

    try {
      const response = await fetchGuestbookEntries(DEFAULT_GUESTBOOK_LIMIT);
      this.entries = response.entries;
      this.config = response.config;
      this.setStatus('', false);
      await this.renderTurnstile();
    } catch (error) {
      this.setStatus(getErrorMessage(error, 'Failed to load the guestbook.'), true);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private async submit(): Promise<void> {
    if (this.submitting || !this.elements.nameInput || !this.elements.messageInput) {
      return;
    }

    if (getAuthDebugState().schoolManaged) {
      this.setStatus('Classroom accounts cannot sign the guestbook.', true);
      return;
    }

    const displayName = this.elements.nameInput.value.replace(/\s+/g, ' ').trim();
    const body = this.elements.messageInput.value.replace(/\s+/g, ' ').trim();
    if (!displayName || !body) {
      this.setStatus('Add your name and message first.', true);
      return;
    }

    if (this.config.turnstileRequired && !this.turnstileToken) {
      this.setStatus('Complete the Turnstile check first.', true);
      return;
    }

    this.submitting = true;
    this.setStatus('Signing guestbook...', false);
    this.render();

    try {
      const response = await signGuestbook({
        displayName,
        body,
        guestSessionId: getGuestVisitSessionId(),
        turnstileToken: this.turnstileToken,
      });
      this.config = response.config;
      this.entries = [response.entry, ...this.entries].slice(0, DEFAULT_GUESTBOOK_LIMIT);
      this.elements.messageInput.value = '';
      this.turnstileToken = null;
      this.resetTurnstile();
      this.setStatus('Signed. Thanks for visiting WAMP.', false);
      this.renderCounter();
    } catch (error) {
      this.turnstileToken = null;
      this.resetTurnstile();
      this.setStatus(getErrorMessage(error, 'Failed to sign guestbook.'), true);
    } finally {
      this.submitting = false;
      this.render();
    }
  }

  private syncDefaultName(): void {
    if (!this.elements.nameInput || this.elements.nameInput.value.trim()) {
      return;
    }

    const authState = getAuthDebugState();
    const displayName = authState.authenticated && authState.user
      ? authState.user.displayName
      : resolveWorldPresenceIdentity().displayName;
    this.elements.nameInput.value = displayName.slice(0, GUESTBOOK_DISPLAY_NAME_MAX_LENGTH);
  }

  private render(): void {
    this.renderEntries();
    this.renderCounter();
    const schoolManaged = getAuthDebugState().schoolManaged;
    if (this.elements.nameInput) {
      this.elements.nameInput.disabled = schoolManaged || this.loading || this.submitting;
    }
    if (this.elements.messageInput) {
      this.elements.messageInput.disabled = schoolManaged || this.loading || this.submitting;
      this.elements.messageInput.placeholder = schoolManaged
        ? 'Classroom guestbook signing is disabled'
        : '';
    }
    if (this.elements.submitButton) {
      this.elements.submitButton.disabled = schoolManaged || this.loading || this.submitting;
      this.elements.submitButton.textContent = this.submitting ? 'Signing...' : 'Sign Guestbook';
    }
  }

  private renderEntries(): void {
    if (!this.elements.list || !this.elements.empty) {
      return;
    }

    this.elements.list.replaceChildren();
    this.elements.empty.classList.toggle('hidden', this.loading || this.entries.length > 0);
    if (this.loading) {
      const loading = this.doc.createElement('div');
      loading.className = 'guestbook-empty';
      loading.textContent = 'Loading signatures...';
      this.elements.list.append(loading);
      return;
    }

    for (const entry of this.entries) {
      this.elements.list.append(this.renderEntry(entry));
    }
  }

  private renderEntry(entry: GuestbookEntry): HTMLElement {
    const item = this.doc.createElement('article');
    item.className = 'guestbook-entry';

    const header = this.doc.createElement('div');
    header.className = 'guestbook-entry-header';

    const name = this.doc.createElement('div');
    name.className = 'guestbook-entry-name';
    name.textContent = entry.displayName;

    const time = this.doc.createElement('time');
    time.className = 'guestbook-entry-time';
    time.dateTime = entry.createdAt;
    time.textContent = formatGuestbookTime(entry.createdAt);

    header.append(name, time);

    const message = this.doc.createElement('div');
    message.className = 'guestbook-entry-message';
    message.textContent = entry.body;

    item.append(header, message);
    return item;
  }

  private renderCounter(): void {
    if (!this.elements.counter || !this.elements.messageInput) {
      return;
    }

    const count = this.elements.messageInput.value.length;
    this.elements.counter.textContent = `${count}/${GUESTBOOK_MESSAGE_MAX_LENGTH}`;
  }

  private async renderTurnstile(): Promise<void> {
    if (!this.elements.turnstile) {
      return;
    }

    this.elements.turnstile.replaceChildren();
    this.turnstileToken = null;
    this.turnstileWidgetId = null;

    if (!this.config.turnstileRequired) {
      this.elements.turnstile.classList.add('hidden');
      return;
    }

    this.elements.turnstile.classList.remove('hidden');
    if (!this.config.turnstileSiteKey) {
      this.elements.turnstile.textContent = 'Turnstile is not configured yet.';
      return;
    }

    await this.loadTurnstileScript();
    if (!window.turnstile) {
      this.elements.turnstile.textContent = 'Turnstile failed to load.';
      return;
    }

    this.turnstileWidgetId = window.turnstile.render(this.elements.turnstile, {
      sitekey: this.config.turnstileSiteKey,
      action: 'turnstile-spin-v2',
      theme: 'dark',
      callback: (token) => {
        this.turnstileToken = token;
        this.setStatus('', false);
      },
      'expired-callback': () => {
        this.turnstileToken = null;
      },
      'error-callback': () => {
        this.turnstileToken = null;
        this.setStatus('Turnstile had trouble. Try again.', true);
      },
    });
  }

  private loadTurnstileScript(): Promise<void> {
    if (window.turnstile) {
      return Promise.resolve();
    }

    if (this.turnstileLoading) {
      return this.turnstileLoading;
    }

    this.turnstileLoading = new Promise((resolve, reject) => {
      const existing = this.doc.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null;
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('Turnstile failed to load.')), { once: true });
        return;
      }

      const script = this.doc.createElement('script');
      script.id = TURNSTILE_SCRIPT_ID;
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.addEventListener('load', () => resolve(), { once: true });
      script.addEventListener('error', () => reject(new Error('Turnstile failed to load.')), { once: true });
      this.doc.head.append(script);
    });

    return this.turnstileLoading;
  }

  private resetTurnstile(): void {
    if (this.turnstileWidgetId && window.turnstile) {
      window.turnstile.reset(this.turnstileWidgetId);
    }
  }

  private setStatus(message: string, isError: boolean): void {
    if (!this.elements.status) {
      return;
    }

    this.elements.status.textContent = message;
    this.elements.status.classList.toggle('hidden', !message);
    this.elements.status.classList.toggle('guestbook-status-error', isError);
  }
}

function formatGuestbookTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

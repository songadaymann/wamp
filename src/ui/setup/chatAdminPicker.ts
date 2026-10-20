import { formatAccountIdentity } from '../../auth/displayIdentity';
import type { ChatMentionUserRecord } from '../../chat/model';
import { fetchChatMentionUsers } from '../chat/client';

/** Owns only the open moderation form's search and explicit account selection. */
export class ChatAdminPicker {
  private selected: ChatMentionUserRecord | null = null;
  private enabled = false;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private request: AbortController | null = null;

  constructor(private readonly options: {
    doc: Document;
    input: HTMLInputElement | null;
    results: HTMLElement | null;
    status: HTMLElement | null;
    changed: () => void;
    search?: typeof fetchChatMentionUsers;
  }) {}

  init(): void {
    this.options.input?.addEventListener('input', this.handleInput);
  }

  destroy(): void {
    this.options.input?.removeEventListener('input', this.handleInput);
    this.clear();
  }

  setEnabled(enabled: boolean): void {
    if (this.options.input) this.options.input.disabled = !enabled;
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.cancelSearch();
    else {
      const selected = this.getSelection();
      if (selected) this.setStatus(`Selected: ${this.label(selected)}`);
    }
  }

  getSelection(): ChatMentionUserRecord | null {
    return this.selected && this.options.input?.value === this.label(this.selected)
      ? this.selected : null;
  }

  clear(): void {
    this.cancelSearch();
    this.selected = null;
    if (this.options.input) this.options.input.value = '';
    this.options.changed();
  }

  private readonly handleInput = (): void => {
    this.cancelSearch();
    this.selected = null;
    this.options.changed();
    const query = this.options.input?.value.trim() ?? '';
    if (!this.enabled || !query) return;
    const generation = this.generation;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.search(query, generation);
    }, 200);
  };

  private async search(query: string, generation: number): Promise<void> {
    const controller = new AbortController();
    this.request = controller;
    this.setStatus('Searching...');
    try {
      const response = await (this.options.search ?? fetchChatMentionUsers)(query, { signal: controller.signal });
      if (generation !== this.generation || !this.enabled) return;
      this.setStatus(response.users.length ? '' : 'No matching accounts.');
      for (const user of response.users) {
        const button = this.options.doc.createElement('button');
        button.type = 'button';
        button.className = 'bar-btn chat-admin-search-result';
        button.textContent = this.label(user);
        button.addEventListener('click', () => {
          if (!this.enabled || generation !== this.generation) return;
          this.cancelSearch();
          this.selected = user;
          if (this.options.input) this.options.input.value = this.label(user);
          this.setStatus(`Selected: ${this.label(user)}`);
          this.options.changed();
          this.options.input?.focus();
        });
        this.options.results?.appendChild(button);
      }
    } catch {
      if (generation === this.generation && this.enabled) this.setStatus('Search failed. Try again.');
    } finally {
      if (this.request === controller) this.request = null;
    }
  }

  private cancelSearch(): void {
    this.generation += 1;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.request?.abort();
    this.request = null;
    this.options.results?.replaceChildren();
    this.setStatus('');
  }

  private label(user: ChatMentionUserRecord): string {
    return formatAccountIdentity(user.displayName, user.username);
  }

  private setStatus(message: string): void {
    if (this.options.status) this.options.status.textContent = message;
  }
}

import { AUTH_STATE_CHANGED_EVENT, AUTH_SESSION_REFRESHED_EVENT, getAuthDebugState } from '../../auth/client';
import { BUILD_PROMPT_ENTRY_RESULT, BUILD_PROMPT_PUBLISH_REQUEST, type PromptEntryResult, type PromptPublishRequest } from '../../buildPrompts/publishing';
import { createBuildPromptRepository, type BuildPromptRepository } from '../../buildPrompts/repository';
import type { BuildPromptEntry, BuildPromptsResponse } from '../../buildPrompts/model';
import { APP_MODE_CHANGED_EVENT } from '../appMode';
import { createModalLifecycle } from './modalLifecycle';
import { createProfileTriggerElement } from './profileEvents';
import { ROOM_SEQUENCE_START_EVENT, type RoomSequenceEntry, type RoomSequenceStartDetail } from './roomSequenceEvents';

export class BuildPromptsController {
  private readonly modal;
  private readonly publishModal;
  private readonly lifecycle;
  private readonly publishLifecycle;
  private readonly checkbox;
  private readonly openButton;
  private readonly menuButton;
  private readonly blockedKeys = new Set<string>();
  private readonly banner;
  private pending: PromptPublishRequest | null = null;
  private result: PromptEntryResult | null = null;
  private response: BuildPromptsResponse | null = null;
  private entries: BuildPromptEntry[] = [];
  private offsets = new Map<string, number>();
  private generation = 0;
  private busy = false;
  private destroyed = false;
  private openingMode: string | undefined;
  private returnFocus: HTMLElement | null = null;
  private bannerTimer: number | null = null;
  private accountId = getAuthDebugState().user?.id;
  constructor(private readonly closeExplore: () => void,
    private readonly doc: Document = document, private readonly win: Window = window,
    private readonly repository: BuildPromptRepository = createBuildPromptRepository()) {
    this.modal = doc.getElementById('build-prompt-modal');
    this.publishModal = doc.getElementById('build-prompt-publish-modal');
    this.checkbox = doc.getElementById('build-prompt-enter') as HTMLInputElement | null;
    this.openButton = doc.getElementById('btn-explore-build-prompt');
    this.menuButton = doc.getElementById('btn-auth-build-prompt');
    this.banner = doc.getElementById('build-prompt-result');
    this.lifecycle = createModalLifecycle({ doc, modal: this.modal, onClose: () => this.close() });
    this.publishLifecycle = createModalLifecycle({ doc, modal: this.publishModal, onClose: () => this.cancelPublish() });
  }
  init(): void {
    this.lifecycle.attach(); this.publishLifecycle.attach();
    this.openButton?.addEventListener('click', this.onOpen);
    this.menuButton?.addEventListener('click', this.onOpen);
    this.doc.getElementById('btn-build-prompt-close')?.addEventListener('click', this.onClose);
    this.doc.getElementById('btn-build-prompt-refresh')?.addEventListener('click', this.onRefresh);
    this.doc.getElementById('btn-build-prompt-more')?.addEventListener('click', this.onMore);
    this.doc.getElementById('btn-build-prompt-play-all')?.addEventListener('click', this.onPlayAll);
    this.doc.getElementById('build-prompt-history')?.addEventListener('change', this.onHistory);
    this.doc.getElementById('build-prompt-publish-form')?.addEventListener('submit', this.onPublish);
    this.doc.getElementById('btn-build-prompt-publish-cancel')?.addEventListener('click', this.onCancelPublish);
    this.doc.getElementById('btn-build-prompt-entry-retry')?.addEventListener('click', this.onRetryEntry);
    this.doc.getElementById('btn-build-prompt-result-close')?.addEventListener('click', this.onDismissResult);
    this.doc.getElementById('btn-build-prompt-view')?.addEventListener('click', this.onViewResult);
    for (const name of [AUTH_STATE_CHANGED_EVENT, AUTH_SESSION_REFRESHED_EVENT]) this.win.addEventListener(name, this.onAuth);
    this.win.addEventListener(APP_MODE_CHANGED_EVENT, this.onMode);
    this.win.addEventListener(BUILD_PROMPT_PUBLISH_REQUEST, this.onPublishRequest);
    this.win.addEventListener(BUILD_PROMPT_ENTRY_RESULT, this.onEntryResult);
    this.win.addEventListener('keydown', this.onKey, true);
    this.win.addEventListener('keyup', this.onKeyup, true);
    this.renderMenu();
  }
  destroy(): void {
    this.destroyed = true; this.close(); this.cancelPublish(); this.dismissResult();
    this.lifecycle.detach(); this.publishLifecycle.detach();
    this.openButton?.removeEventListener('click', this.onOpen);
    this.menuButton?.removeEventListener('click', this.onOpen);
    for (const [id, listener] of [
      ['btn-build-prompt-close', this.onClose], ['btn-build-prompt-refresh', this.onRefresh],
      ['btn-build-prompt-more', this.onMore], ['btn-build-prompt-play-all', this.onPlayAll],
      ['build-prompt-history', this.onHistory], ['build-prompt-publish-form', this.onPublish],
      ['btn-build-prompt-publish-cancel', this.onCancelPublish], ['btn-build-prompt-entry-retry', this.onRetryEntry],
      ['btn-build-prompt-result-close', this.onDismissResult], ['btn-build-prompt-view', this.onViewResult],
    ] as const) this.doc.getElementById(id)?.removeEventListener(id === 'build-prompt-history' ? 'change' : id === 'build-prompt-publish-form' ? 'submit' : 'click', listener);
    for (const name of [AUTH_STATE_CHANGED_EVENT, AUTH_SESSION_REFRESHED_EVENT]) this.win.removeEventListener(name, this.onAuth);
    this.win.removeEventListener(APP_MODE_CHANGED_EVENT, this.onMode);
    this.win.removeEventListener(BUILD_PROMPT_PUBLISH_REQUEST, this.onPublishRequest);
    this.win.removeEventListener(BUILD_PROMPT_ENTRY_RESULT, this.onEntryResult);
    this.win.removeEventListener('keydown', this.onKey, true);
    this.win.removeEventListener('keyup', this.onKeyup, true);
    this.blockedKeys.clear();
  }
  private text(id: string, value: string): void { const element = this.doc.getElementById(id); if (element) element.textContent = value; }
  private button(id: string, disabled: boolean): void { const button = this.doc.getElementById(id) as HTMLButtonElement | null; if (button) button.disabled = disabled; }
  private readonly onOpen = () => this.open();
  private open(slug?: string): void {
    if (this.destroyed) return;
    this.returnFocus = this.doc.activeElement instanceof HTMLElement ? this.doc.activeElement : this.openButton;
    this.closeExplore(); this.doc.getElementById('auth-panel')?.classList.remove('menu-open');
    if (!this.returnFocus?.getClientRects().length) this.returnFocus = this.doc.getElementById('menu-toggle');
    this.openingMode = this.doc.body.dataset.appMode;
    this.lifecycle.show(); this.doc.getElementById('btn-build-prompt-close')?.focus(); void this.refresh(slug);
  }
  close(): void { this.generation++; this.busy = false; this.lifecycle.hide(); this.restoreFocus(); }
  private restoreFocus(): void { if (this.returnFocus?.isConnected && this.returnFocus.getClientRects().length) this.returnFocus.focus(); this.returnFocus = null; }
  private readonly onClose = () => this.close();
  private readonly onRefresh = () => { void this.refresh(this.response?.prompt?.slug); };
  private readonly onMore = () => { if (this.response?.nextOffset !== null && this.response?.nextOffset !== undefined) void this.refresh(this.response.prompt?.slug, this.response.nextOffset); };
  private readonly onHistory = () => { const select = this.doc.getElementById('build-prompt-history') as HTMLSelectElement | null; void this.refresh(select?.value || undefined); };
  private readonly onAuth = () => {
    const id = getAuthDebugState().user?.id;
    if (id === this.accountId) return;
    this.accountId = id; this.generation++; this.busy = false; this.cancelPublish(); this.dismissResult();
    if (this.lifecycle.isOpen()) void this.refresh(this.response?.prompt?.slug);
  };
  private canPlay(): boolean { return ['world', 'play-world'].includes(this.doc.body.dataset.appMode ?? ''); }
  private renderMenu(): void { this.menuButton?.classList.toggle('hidden', !this.canPlay()); }
  private readonly onMode = () => {
    this.renderMenu();
    if (this.openingMode !== this.doc.body.dataset.appMode) { this.close(); this.cancelPublish(); }
  };
  private readonly onKey = (event: KeyboardEvent) => {
    const modal = this.publishLifecycle.isOpen() ? this.publishModal : this.lifecycle.isOpen() ? this.modal : null;
    if (!modal) return;
    this.blockedKeys.add(event.code || event.key); event.stopImmediatePropagation();
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); this.publishLifecycle.isOpen() ? this.cancelPublish() : this.close(); }
    if (event.key === 'Tab') {
      const controls = Array.from(modal.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]')).filter(el => el.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && this.doc.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && this.doc.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  };
  private readonly onKeyup = (event: KeyboardEvent) => { if (this.blockedKeys.delete(event.code || event.key)) event.stopImmediatePropagation(); };
  private async refresh(slug?: string, offset = 0): Promise<void> {
    if (this.busy || this.destroyed) return;
    this.busy = true; const generation = ++this.generation;
    this.text('build-prompt-status', 'Loading Build Prompt…'); this.setBusy(true);
    try {
      const response = await this.repository.load(slug, offset);
      if (this.destroyed || generation !== this.generation) return;
      if (!offset) { this.entries = []; this.offsets.clear(); }
      for (const entry of response.entries) { this.offsets.set(entry.targetKey, offset); }
      this.entries = [...this.entries.filter(entry => !response.entries.some(next => next.targetKey === entry.targetKey)), ...response.entries];
      this.response = response; this.render();
    } catch (error) {
      if (generation !== this.generation || this.destroyed) return;
      if (!offset) { this.response = null; this.entries = []; this.render(); }
      this.text('build-prompt-status', error instanceof Error ? `Could not load Build Prompt. ${error.message} Try Refresh.` : 'Could not load Build Prompt. Try Refresh.');
    } finally { if (generation === this.generation) { this.busy = false; this.setBusy(false); } }
  }
  private setBusy(value: boolean): void {
    this.button('btn-build-prompt-refresh', value); this.button('btn-build-prompt-more', value);
    this.button('btn-build-prompt-play-all', value || !this.canPlay() || !this.entries.some(entry => entry.available));
    const select = this.doc.getElementById('build-prompt-history') as HTMLSelectElement | null; if (select) select.disabled = value;
  }
  private render(): void {
    const response = this.response, prompt = response?.prompt;
    this.text('build-prompt-title', prompt?.title ?? 'Build Prompt');
    this.text('build-prompt-constraint', prompt?.constraint ?? 'No prompt scheduled yet. A new building challenge will appear here when it opens.');
    const open = !!prompt && response?.current?.slug === prompt.slug;
    this.text('build-prompt-window', prompt ? `${prompt.startsAt.slice(0, 10)} – ${prompt.endsAt.slice(0, 10)} · Monday to Monday, 00:00 UTC${open ? ' · Open' : ' · Closed'}` : '');
    this.text('build-prompt-status', prompt ? `${prompt.entryCount} ${prompt.entryCount === 1 ? 'entry' : 'entries'}${open ? ' · Publish your public goal level and select “Enter this week’s prompt”.' : prompt.settledAt ? ' · Results are final.' : ' · Results are being settled.'}` : 'You can keep building and publishing while no prompt is active.');
    const history = this.doc.getElementById('build-prompt-history') as HTMLSelectElement | null;
    history?.replaceChildren();
    const choices = [response?.current, ...(response?.recent ?? [])].filter(item => !!item);
    for (const item of choices) { const option = this.doc.createElement('option'); option.value = item.slug; option.textContent = `${item.startsAt.slice(0,10)} · ${item.title}`; history?.append(option); }
    if (history) { history.value = prompt?.slug ?? ''; history.classList.toggle('hidden', choices.length < 2); }
    const list = this.doc.getElementById('build-prompt-entries'); list?.replaceChildren();
    for (const entry of this.entries) {
      const row = this.doc.createElement('li'); row.dataset.targetKey = entry.targetKey;
      const title = this.doc.createElement('h3'); title.textContent = `${entry.winnerRank ? `#${entry.winnerRank} Prompt Winner · ` : ''}${entry.title}`;
      const builder = createProfileTriggerElement(this.doc, entry.builderUserId, `by ${entry.builderDisplayName}`, 'bar-btn bar-btn-small');
      const info = this.doc.createElement('p'); info.textContent = `v${entry.version}${entry.cellCount > 1 ? ` · ${entry.cellCount} cells` : ''} · ${entry.voteCount} verified ${entry.voteCount === 1 ? 'rating' : 'ratings'}${entry.adjustedAverage === null ? '' : ` · ${entry.adjustedAverage.toFixed(2)} adjusted quality`}${entry.available ? '' : ' · Submitted version unavailable'}`;
      const actions = this.doc.createElement('div'); actions.className = 'build-prompt-actions'; actions.append(builder);
      const play = this.doc.createElement('button'); play.type = 'button'; play.className = 'bar-btn bar-btn-small'; play.textContent = 'Play'; play.disabled = !entry.available || !this.canPlay();
      play.addEventListener('click', () => this.start([entry])); actions.append(play);
      if (open && getAuthDebugState().user?.id === entry.builderUserId) {
        const withdraw = this.doc.createElement('button'); withdraw.type = 'button'; withdraw.className = 'bar-btn bar-btn-small'; withdraw.textContent = 'Withdraw';
        withdraw.addEventListener('click', () => { void this.withdraw(prompt!.slug, withdraw); }); actions.append(withdraw);
      }
      row.append(title, info, actions); list?.append(row);
    }
    if (prompt && !this.entries.length) { const empty = this.doc.createElement('li'); empty.textContent = open ? 'No entries yet. Build the first one!' : 'No public entries for this prompt.'; list?.append(empty); }
    const more = this.doc.getElementById('btn-build-prompt-more'); more?.classList.toggle('hidden', response?.nextOffset === null || !response);
    this.text('btn-build-prompt-play-all', response?.nextOffset !== null && response ? `Play Loaded (${this.entries.filter(entry => entry.available).length})` : 'Play All');
    this.doc.getElementById('build-prompt-rules')?.classList.toggle('hidden', !prompt);
    this.setBusy(this.busy);
  }
  private readonly onPlayAll = () => this.start(this.entries.filter(entry => entry.available));
  private start(entries: BuildPromptEntry[]): void {
    const prompt = this.response?.prompt;
    if (this.busy || !prompt || !entries.length || !this.canPlay()) return;
    const queued: RoomSequenceEntry[] = entries.filter(entry => entry.available).map(entry => ({
      roomId: entry.roomId, roomCoordinates: entry.coordinates, roomVersion: entry.roomVersion, roomTitle: entry.title,
      expandedRoomId: entry.contentType === 'expanded_room' ? entry.contentId : null,
      expandedRoomVersion: entry.contentType === 'expanded_room' ? entry.version : null,
      expandedRoomCellCount: entry.cellCount, legacyCourseId: entry.legacyCourseId,
      buildPrompt: { slug: prompt.slug, targetKey: entry.targetKey, offset: this.offsets.get(entry.targetKey) ?? 0 },
    }));
    if (!queued.length) return;
    this.close(); this.win.dispatchEvent(new CustomEvent<RoomSequenceStartDetail>(ROOM_SEQUENCE_START_EVENT, {
      detail: { mode: 'play', kind: 'build-prompt', entries: queued, sourceLabel: prompt.title, kickerLabel: 'Build Prompt', forceGoalIntro: true },
    }));
  }
  private async withdraw(slug: string, button: HTMLButtonElement): Promise<void> {
    if (this.busy) return;
    const generation = this.generation, account = getAuthDebugState().user?.id;
    this.busy = true; button.disabled = true; this.setBusy(true);
    try {
      await this.repository.withdraw(slug);
      if (this.destroyed || generation !== this.generation || account !== getAuthDebugState().user?.id) return;
      this.busy = false; await this.refresh(slug);
    } catch (error) { if (generation === this.generation) this.text('build-prompt-status', error instanceof Error ? error.message : 'Could not withdraw. Try again.'); }
    finally { if (generation === this.generation) { this.busy = false; button.disabled = false; this.setBusy(false); } }
  }
  private readonly onPublishRequest = (event: Event) => {
    const detail = (event as CustomEvent<PromptPublishRequest>).detail;
    if (this.destroyed || detail.userId !== getAuthDebugState().user?.id || !this.publishModal) return;
    event.preventDefault(); this.cancelPublish(); this.close(); this.pending = detail;
    this.returnFocus = this.doc.activeElement instanceof HTMLElement ? this.doc.activeElement : null;
    this.openingMode = this.doc.body.dataset.appMode;
    this.text('build-prompt-publish-title', detail.prompt?.title ?? 'Build Prompt could not load');
    this.text('build-prompt-publish-constraint', detail.prompt?.constraint ?? 'Your level can still be published. Refresh Build Prompt later to check this week’s challenge.');
    if (this.checkbox) { this.checkbox.checked = false; this.checkbox.disabled = detail.loadError; }
    this.publishLifecycle.show(); this.doc.getElementById('btn-build-prompt-publish')?.focus();
  };
  private readonly onPublish = (event: Event) => {
    event.preventDefault(); const pending = this.pending;
    if (!pending || pending.userId !== getAuthDebugState().user?.id) { this.cancelPublish(); return; }
    const choice = { slug: !pending.loadError && this.checkbox?.checked ? pending.prompt?.slug ?? null : null };
    this.pending = null; this.publishLifecycle.hide(); this.restoreFocus(); pending.resolve(choice);
  };
  private readonly onCancelPublish = () => this.cancelPublish();
  private cancelPublish(): void { const pending = this.pending; this.pending = null; this.publishLifecycle.hide(); pending?.resolve(null); this.restoreFocus(); }
  private readonly onEntryResult = (event: Event) => {
    const result = (event as CustomEvent<PromptEntryResult>).detail;
    if (this.destroyed || result.userId !== getAuthDebugState().user?.id) return;
    this.dismissResult(); this.result = result; this.banner?.classList.remove('hidden');
    this.text('build-prompt-result-status', result.error ? `“${result.title}” was published, but the prompt entry was not saved. ${result.error}` : `“${result.title}” was published and entered in Build Prompt.`);
    this.doc.getElementById('btn-build-prompt-entry-retry')?.classList.toggle('hidden', !result.error);
    this.button('btn-build-prompt-entry-retry', false);
    if (!result.error) this.bannerTimer = this.win.setTimeout(() => this.dismissResult(), 10000);
  };
  private readonly onRetryEntry = async () => { const result = this.result; if (!result || result.userId !== getAuthDebugState().user?.id) return; this.button('btn-build-prompt-entry-retry', true); await result.retry(); };
  private readonly onDismissResult = () => this.dismissResult();
  private readonly onViewResult = () => { const slug = this.result?.slug; this.dismissResult(); this.open(slug); };
  private dismissResult(): void { if (this.bannerTimer !== null) this.win.clearTimeout(this.bannerTimer); this.bannerTimer = null; this.result = null; this.banner?.classList.add('hidden'); }
}

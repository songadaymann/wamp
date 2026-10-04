import type Phaser from 'phaser';
import { AUTH_SESSION_REFRESHED_EVENT, AUTH_STATE_CHANGED_EVENT, promptForSignIn } from '../../auth/client';
import { submitGuestRoomDraft } from '../../guestRooms/client';
import { GuestDraftRecoveryService, guestDraftAccountId, type GuestDraftRecoveryItem } from '../../guestRooms/draftRecoveryService';
import type { RoomCoordinates, RoomSnapshot } from '../../persistence/roomModel';
import { renderRoomSnapshotToPngDataUrl } from '../../mint/roomMetadataRender';
import { APP_MODE_CHANGED_EVENT } from '../appMode';
import { APP_READY_EVENT } from '../appFeedback';
import { getOverworldScene } from './sceneBridge';
import { createModalLifecycle } from './modalLifecycle';
import { requestProfileInvalidation } from './profileEvents';

export const PENDING_SIGN_IN_DRAFT_KEY = 'ep_guest_room_recovery_pending_signin_draft_v1';
export const GUEST_DRAFT_SEEN_PREFIX = 'wamp_guest_draft_seen_v1:';
interface Options {
  service?: Pick<GuestDraftRecoveryService, 'sync' | 'transfer'>;
  account?: () => string | null;
  preview?: typeof renderRoomSnapshotToPngDataUrl;
  openEditor?: (snapshot: RoomSnapshot) => void | boolean | Promise<boolean>;
}

export class GuestRoomRecoveryModalController {
  private readonly service;
  private readonly account;
  private readonly preview;
  private readonly openEditor;
  private readonly modal;
  private readonly lifecycle;
  private readonly signInButton;
  private readonly submitButton;
  private readonly goButton;
  private readonly closeButton;
  private readonly menu;
  private readonly selector;
  private readonly seen = new Set<string>();
  private readonly invalidated = new Set<string>();
  private items: GuestDraftRecoveryItem[] = [];
  private itemsAccount: string | null = null;
  private active: GuestDraftRecoveryItem | null = null;
  private visibleAccount: string | null = null;
  private pendingId: string | null = null;
  private syncing = false;
  private rerun = false;
  private loading = false;
  private destroyed = false;
  private generation = 0;
  private syncTimer: number | null = null;
  private presentTimer: number | null = null;

  constructor(private readonly game: Phaser.Game, private readonly doc: Document = document,
    private readonly win: Window = window, options: Options = {}) {
    this.service = options.service ?? new GuestDraftRecoveryService(); this.account = options.account ?? guestDraftAccountId;
    this.preview = options.preview ?? renderRoomSnapshotToPngDataUrl;
    this.openEditor = options.openEditor ?? (snapshot => getOverworldScene(this.game)?.openGuestDraftRoom?.(snapshot) ?? false);
    this.modal = doc.getElementById('guest-room-recovery-modal');
    this.signInButton = doc.getElementById('btn-guest-room-recovery-signin'); this.submitButton = doc.getElementById('btn-guest-room-recovery-submit');
    this.goButton = doc.getElementById('btn-guest-room-recovery-go'); this.closeButton = doc.getElementById('btn-guest-room-recovery-close');
    this.menu = doc.getElementById('btn-auth-guest-drafts'); this.selector = doc.getElementById('guest-room-recovery-drafts') as HTMLSelectElement | null;
    this.lifecycle = createModalLifecycle({ doc, modal: this.modal, onClose: () => this.close() });
  }

  init(): void {
    this.signInButton?.addEventListener('click', this.onSignIn); this.submitButton?.addEventListener('click', this.onSubmit);
    this.goButton?.addEventListener('click', this.onGo); this.closeButton?.addEventListener('click', this.onClose);
    this.menu?.addEventListener('click', this.onMenu); this.selector?.addEventListener('change', this.onSelection);
    for (const event of [AUTH_STATE_CHANGED_EVENT, AUTH_SESSION_REFRESHED_EVENT, 'focus', 'online']) this.win.addEventListener(event, this.onWake);
    for (const event of [APP_MODE_CHANGED_EVENT, APP_READY_EVENT]) this.win.addEventListener(event, this.onMode);
    this.win.addEventListener('storage', this.onStorage); this.doc.addEventListener('visibilitychange', this.onVisibility);
    this.lifecycle.attach(); this.scheduleSync(3500);
    this.game.events?.once('destroy', this.onGameDestroy);
  }

  destroy(): void {
    this.destroyed = true; this.generation++;
    this.signInButton?.removeEventListener('click', this.onSignIn); this.submitButton?.removeEventListener('click', this.onSubmit);
    this.goButton?.removeEventListener('click', this.onGo); this.closeButton?.removeEventListener('click', this.onClose);
    this.menu?.removeEventListener('click', this.onMenu); this.selector?.removeEventListener('change', this.onSelection);
    for (const event of [AUTH_STATE_CHANGED_EVENT, AUTH_SESSION_REFRESHED_EVENT, 'focus', 'online']) this.win.removeEventListener(event, this.onWake);
    for (const event of [APP_MODE_CHANGED_EVENT, APP_READY_EVENT]) this.win.removeEventListener(event, this.onMode);
    this.win.removeEventListener('storage', this.onStorage); this.doc.removeEventListener('visibilitychange', this.onVisibility);
    if (this.syncTimer !== null) this.win.clearTimeout(this.syncTimer);
    if (this.presentTimer !== null) this.win.clearTimeout(this.presentTimer);
    this.lifecycle.detach(); this.lifecycle.hide();
    this.game.events?.off('destroy', this.onGameDestroy);
  }

  close(): void {
    if (this.lifecycle.isOpen() && this.active) this.markSeen(this.active);
    this.generation++; this.lifecycle.hide(); this.visibleAccount = null;
  }

  private readonly onClose = () => this.close();
  private readonly onGameDestroy = () => this.destroy();
  private readonly onSelection = () => {
    this.active = this.items.find(item => item.draft.id === this.selector?.value) ?? this.active;
    this.generation++; if (this.active) this.render(this.active);
  };
  private readonly onWake = () => {
    if (this.itemsAccount !== this.account() || this.lifecycle.isOpen() && this.visibleAccount !== this.account()) {
      this.close(); this.items = []; this.active = null; this.itemsAccount = this.account();
    }
    this.scheduleSync(200);
  };
  private readonly onMode = () => {
    if (this.doc.body.dataset.appMode !== 'world') this.close();
    else { this.scheduleSync(200); this.tryPresent(); }
  };
  private readonly onVisibility = () => { if (this.doc.visibilityState === 'visible') this.onWake(); };
  private readonly onStorage = (event: Event) => {
    const key = (event as StorageEvent).key;
    if (key === null || key === 'ep_guest_recovery_token_v1' || key === 'ep_presence_guest_identity_v1' || key?.startsWith(GUEST_DRAFT_SEEN_PREFIX)) this.scheduleSync(200);
  };
  private readonly onMenu = () => {
    this.doc.getElementById('auth-panel')?.classList.remove('menu-open');
    if (!this.canPresent()) return;
    this.open(this.items[0] ?? null); this.scheduleSync(0);
  };
  private readonly onSignIn = () => {
    if (this.loading || !this.active) return;
    if (this.account()) { void this.transfer(); return; }
    this.pendingId = this.active.draft.id;
    try { this.win.sessionStorage.setItem(PENDING_SIGN_IN_DRAFT_KEY, this.pendingId); } catch { /* Keep same-tab intent in memory. */ }
    this.close(); promptForSignIn('Sign in to save this guest draft to your account.');
  };
  private readonly onGo = () => { void this.resume(); };
  private readonly onSubmit = async () => {
    if (!this.active || this.loading || this.account()) return;
    const item = this.active; const generation = this.generation; this.setLoading(true); this.status('Publishing to Guest Rooms...');
    try {
      const response = await submitGuestRoomDraft(item.draft.id);
      if (this.generation !== generation || this.account() || this.destroyed) return;
      item.draft = response.draft; this.status('Published to Guest Rooms. It is playable there without XP or account benefits.');
    } catch (error) { if (this.generation === generation) this.status(error instanceof Error ? error.message : 'Could not publish to Guest Rooms.', true); }
    finally { this.setLoading(false); this.submitButton?.toggleAttribute('disabled', item.draft.status !== 'active'); }
  };

  private scheduleSync(delay: number): void {
    if (this.destroyed) return;
    if (this.syncTimer !== null) this.win.clearTimeout(this.syncTimer);
    this.syncTimer = this.win.setTimeout(() => { this.syncTimer = null; void this.sync(); }, delay);
  }
  private async sync(): Promise<void> {
    // Never replace active editor work or claim an older autosave while that editor is still running.
    if (this.destroyed || this.doc.visibilityState !== 'visible' || this.doc.body.dataset.appReady !== 'true'
      || this.doc.body.dataset.appMode !== 'world') return;
    if (this.syncing || this.loading) { this.rerun = true; return; }
    this.syncing = true;
    try {
      const result = await this.service.sync();
      if (this.destroyed || !result || this.account() !== result.userId) return;
      this.items = result.items; this.itemsAccount = result.userId;
      for (const item of result.items) if (item.transfer?.outcome === 'claimed') {
        const key = `${result.userId}:${item.draft.id}`;
        if (!this.invalidated.has(key)) { this.invalidated.add(key); requestProfileInvalidation(item.transfer.userId); }
      }
      if (result.items.some(item => item.retry)) this.scheduleSync(20_000);
      if (this.lifecycle.isOpen()) {
        this.active = this.items.find(item => item.draft.id === this.active?.draft.id) ?? this.items[0] ?? null;
        if (this.active) this.render(this.active); else this.status('There are no saved guest drafts for this browser.');
      }
      this.tryPresent();
    } catch {
      if (this.lifecycle.isOpen()) this.status('Your guest draft is waiting for a connection. Try again when you are online.', true);
      this.scheduleSync(20_000);
    } finally {
      this.syncing = false;
      if (this.rerun) { this.rerun = false; this.scheduleSync(200); }
    }
  }

  private canPresent(): boolean {
    if (this.destroyed || !this.modal || this.doc.visibilityState !== 'visible' || !this.doc.hasFocus()
      || this.doc.body.dataset.appReady !== 'true' || this.doc.body.dataset.appMode !== 'world'
      || this.doc.getElementById('auth-panel')?.classList.contains('menu-open')) return false;
    if (['busy-overlay', 'reward-sting-layer', 'xp-receipt-layer'].some(id => {
      const element = this.doc.getElementById(id); return element && !element.classList.contains('hidden');
    })) return false;
    return !Array.from(this.doc.querySelectorAll<HTMLElement>('.history-modal, .pvp-modal[aria-modal="true"]'))
      .some(modal => modal !== this.modal && !modal.classList.contains('hidden') && modal.getAttribute('aria-hidden') !== 'true');
  }
  private tryPresent(): void {
    if (this.destroyed || this.lifecycle.isOpen() || this.loading || this.itemsAccount !== this.account()) return;
    if (this.presentTimer !== null) { this.win.clearTimeout(this.presentTimer); this.presentTimer = null; }
    try { this.pendingId ??= this.win.sessionStorage.getItem(PENDING_SIGN_IN_DRAFT_KEY); } catch { /* Memory intent still works. */ }
    const item = this.items.find(value => value.draft.id === this.pendingId)
      ?? this.items.find(value => !this.wasSeen(value));
    if (!item) return;
    if (!this.canPresent()) { this.presentTimer = this.win.setTimeout(() => { this.presentTimer = null; this.tryPresent(); }, 300); return; }
    this.active = item;
    if (this.account() && item.draft.id === this.pendingId && item.transfer?.outcome === 'claimed') { void this.resume(); return; }
    this.open(item);
  }
  private open(item: GuestDraftRecoveryItem | null): void {
    this.active = item; this.visibleAccount = this.account(); this.lifecycle.show(); this.generation++;
    if (item) { this.markSeen(item); this.render(item); }
    else { this.text('guest-room-recovery-title', 'Guest drafts'); this.text('guest-room-recovery-copy', 'Checking for saved guest drafts in this browser...');
      this.signInButton?.classList.add('hidden'); this.submitButton?.classList.add('hidden'); this.goButton?.classList.add('hidden'); }
  }
  private render(item: GuestDraftRecoveryItem): void {
    const signedIn = Boolean(this.account()); const claimed = item.transfer?.outcome === 'claimed' ? item.transfer : null;
    this.text('guest-room-recovery-title', claimed ? 'Your guest draft is saved to your account' : 'You left a room unfinished');
    this.text('guest-room-recovery-meta', `${item.draft.title || 'Untitled room'} · Room ${claimed ? claimed.roomId : `${item.draft.roomX},${item.draft.roomY}`}`);
    this.text('guest-room-recovery-copy', claimed ? 'Continue building whenever you are ready. Publishing is a separate step.'
      : item.transfer?.outcome === 'conflict' ? item.transfer.message
      : signedIn ? 'Your guest draft is still saved. Retry the transfer to continue in your account.'
      : 'Your room is saved for this browser. Sign in to make it yours and publish it in the world.');
    this.doc.getElementById('guest-room-recovery-benefits')?.classList.toggle('hidden', signedIn);
    this.signInButton?.classList.toggle('hidden', claimed !== null || item.transfer?.outcome === 'conflict');
    if (this.signInButton) this.signInButton.textContent = signedIn ? 'Try Transfer Again' : 'Sign In To Publish';
    this.submitButton?.classList.toggle('hidden', signedIn); this.submitButton?.toggleAttribute('disabled', item.draft.status !== 'active');
    this.goButton?.classList.toggle('hidden', signedIn && !claimed);
    if (this.goButton) this.goButton.textContent = claimed ? 'Continue Building' : 'Go To Room';
    this.goButton?.toggleAttribute('disabled', claimed !== null && !claimed.room.permissions.canSaveDraft);
    if (this.selector) {
      this.selector.textContent = '';
      for (const value of this.items) { const option = this.doc.createElement('option'); option.value = value.draft.id;
        option.textContent = `${value.draft.title || 'Untitled room'} (${value.draft.roomX},${value.draft.roomY})`; this.selector.appendChild(option); }
      this.selector.value = item.draft.id; this.doc.getElementById('guest-room-recovery-drafts-label')?.classList.toggle('hidden', this.items.length < 2);
    }
    const locations = this.doc.getElementById('guest-room-recovery-locations');
    if (locations) {
      locations.textContent = ''; locations.classList.toggle('hidden', item.transfer?.outcome !== 'conflict');
      if (item.transfer?.outcome === 'conflict') {
        for (const coordinates of item.transfer.suggestedCoordinates) {
          const button = this.doc.createElement('button'); button.type = 'button'; button.className = 'bar-btn bar-btn-small';
          button.textContent = `Move to Room ${coordinates.x},${coordinates.y}`;
          button.addEventListener('click', () => { void this.transfer(coordinates); }); locations.appendChild(button);
        }
        if (!item.transfer.suggestedCoordinates.length) locations.textContent = 'No open spot is available right now. Your draft is safe; check again later.';
      }
    }
    this.status(item.error ?? '', Boolean(item.error)); void this.renderPreview(item);
  }
  private async renderPreview(item: GuestDraftRecoveryItem): Promise<void> {
    const preview = this.doc.getElementById('guest-room-recovery-preview'); if (!preview) return;
    const generation = this.generation; preview.querySelector('img')?.remove();
    this.doc.getElementById('guest-room-recovery-preview-fallback')?.classList.remove('hidden');
    try {
      const snapshot = item.transfer?.outcome === 'claimed' ? item.transfer.room.draft : item.draft.snapshot;
      const url = await this.preview(snapshot, { tilePixelSize: 2 });
      if (this.destroyed || this.generation !== generation || this.active !== item) return;
      preview.querySelector('img')?.remove(); const image = this.doc.createElement('img'); image.src = url; image.alt = 'Saved room preview';
      image.className = 'guest-room-recovery-preview-image'; preview.appendChild(image);
      this.doc.getElementById('guest-room-recovery-preview-fallback')?.classList.add('hidden');
    } catch { /* Keep the labelled fallback. */ }
  }
  private async transfer(coordinates?: RoomCoordinates): Promise<void> {
    const item = this.active; const userId = this.account(); if (!item || !userId || this.loading) return;
    const generation = this.generation; this.setLoading(true); this.status('Saving your draft to your account...');
    try {
      const response = await this.service.transfer(item.draft.id, userId, coordinates);
      if (this.destroyed || this.generation !== generation || this.account() !== userId || !response) return;
      item.transfer = response; item.error = null; this.render(item);
      if (response.outcome === 'claimed') { requestProfileInvalidation(userId); this.markSeen(item); }
    } catch (error) { if (this.generation === generation) this.status(error instanceof Error ? error.message : 'Your guest draft is still saved. Try again.', true); }
    finally { this.setLoading(false); if (this.rerun) { this.rerun = false; this.scheduleSync(200); } }
  }
  private async resume(): Promise<void> {
    const item = this.active; if (!item || this.loading || !this.canPresent()) return;
    const userId = this.account(); if (userId && (item.transfer?.outcome !== 'claimed' || item.transfer.userId !== userId)) return;
    const snapshot = item.transfer?.outcome === 'claimed' ? item.transfer.room.draft : item.draft.snapshot;
    this.setLoading(true);
    try {
      const opened = await this.openEditor(snapshot);
      if (this.destroyed || this.account() !== userId) return;
      if (opened === false) { this.status('The editor could not open. Your draft is still saved. Try again.', true); return; }
      if (this.pendingId === item.draft.id) {
        this.pendingId = null; try { this.win.sessionStorage.removeItem(PENDING_SIGN_IN_DRAFT_KEY); } catch { /* Memory intent is cleared. */ }
      }
      this.markSeen(item); this.close();
    } catch { this.status('The editor could not open. Your draft is still saved. Try again.', true); }
    finally { this.setLoading(false); }
  }
  private stamp(item: GuestDraftRecoveryItem): string {
    return item.transfer?.outcome === 'claimed' ? `claimed:${item.transfer.claimedAt}` : `${item.draft.updatedAt}:${item.transfer?.outcome ?? 'guest'}`;
  }
  private key(item: GuestDraftRecoveryItem): string { return `${GUEST_DRAFT_SEEN_PREFIX}${this.account() ?? 'guest'}:${item.draft.id}`; }
  private wasSeen(item: GuestDraftRecoveryItem): boolean {
    const key = this.key(item); const stamp = this.stamp(item); if (this.seen.has(`${key}:${stamp}`)) return true;
    try { return this.win.localStorage.getItem(key) === stamp; } catch { return false; }
  }
  private markSeen(item: GuestDraftRecoveryItem): void {
    const key = this.key(item); const stamp = this.stamp(item); this.seen.add(`${key}:${stamp}`);
    try { this.win.localStorage.setItem(key, stamp); } catch { /* Do not prevent recovery when storage is blocked. */ }
  }
  private setLoading(value: boolean): void {
    this.loading = value;
    this.signInButton?.toggleAttribute('disabled', value); this.selector?.toggleAttribute('disabled', value);
    this.submitButton?.toggleAttribute('disabled', value || this.active?.draft.status !== 'active');
    this.goButton?.toggleAttribute('disabled', value || this.active?.transfer?.outcome === 'claimed' && !this.active.transfer.room.permissions.canSaveDraft);
    for (const button of this.doc.querySelectorAll('#guest-room-recovery-locations button')) button.toggleAttribute('disabled', value);
  }
  private status(text: string, error = false): void {
    const element = this.doc.getElementById('guest-room-recovery-status'); if (!element) return;
    element.textContent = text; element.classList.toggle('hidden', !text); element.classList.toggle('guest-room-recovery-status-error', error);
  }
  private text(id: string, text: string): void { const element = this.doc.getElementById(id); if (element) element.textContent = text; }
}

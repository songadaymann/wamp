import { AUTH_STATE_CHANGED_EVENT, AUTH_SESSION_REFRESHED_EVENT, getAuthDebugState } from '../../auth/client';
import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../../config';
import { renderRoomSnapshotToPngDataUrl } from '../../mint/roomMetadataRender';
import { createRoomRepository, type RoomRepository } from '../../persistence/roomRepository';
import {
  ROOM_FIRST_PUBLISHED_EVENT, ROOM_PUBLISH_NAME_REQUEST_EVENT,
  type FirstPublishedRoom, type RoomPublishNameRequest,
} from '../../publishing/events';
import { buildRoomSharePath } from '../../social/roomShareLinks';
import { openTwitterShareIntent } from '../../social/runShare';
import { APP_MODE_CHANGED_EVENT } from '../appMode';
import { createModalLifecycle } from './modalLifecycle';

interface Options {
  account?: () => string | null;
  preview?: typeof renderRoomSnapshotToPngDataUrl;
  rooms?: Pick<RoomRepository, 'queryRoomSnapshots'>;
}

export class FirstPublishModalController {
  private readonly modal;
  private readonly lifecycle;
  private readonly nameInput;
  private readonly form;
  private readonly closeButton;
  private readonly share;
  private readonly copy;
  private readonly twitter;
  private readonly play;
  private readonly wampogram;
  private readonly account;
  private readonly preview;
  private readonly rooms;
  private pending: RoomPublishNameRequest | null = null;
  private active: FirstPublishedRoom | null = null;
  private returnFocus: HTMLElement | null = null;
  private openingMode: string | undefined;
  private generation = 0;
  private shareUrl = '';
  private readonly blockedKeys = new Set<string>();

  constructor(private readonly doc: Document = document, private readonly win: Window = window, options: Options = {}) {
    this.modal = doc.getElementById('first-publish-modal');
    this.form = doc.getElementById('first-publish-name-form') as HTMLFormElement | null;
    this.nameInput = doc.getElementById('first-publish-name') as HTMLInputElement | null;
    this.closeButton = doc.getElementById('btn-first-publish-close');
    this.share = doc.getElementById('btn-first-publish-share');
    this.copy = doc.getElementById('btn-first-publish-copy');
    this.twitter = doc.getElementById('btn-first-publish-x');
    this.play = doc.getElementById('btn-first-publish-play');
    this.wampogram = doc.getElementById('btn-first-publish-wampogram');
    this.account = options.account ?? (() => { const auth = getAuthDebugState(); return auth.authenticated ? auth.user?.id ?? null : null; });
    this.preview = options.preview ?? renderRoomSnapshotToPngDataUrl;
    this.rooms = options.rooms ?? createRoomRepository();
    this.lifecycle = createModalLifecycle({ doc, modal: this.modal, onClose: () => this.close() });
  }

  init(): void {
    this.lifecycle.attach(); this.closeButton?.addEventListener('click', this.onClose);
    this.form?.addEventListener('submit', this.onSubmit);
    this.share?.addEventListener('click', this.onShare); this.copy?.addEventListener('click', this.onCopy);
    this.twitter?.addEventListener('click', this.onTwitter); this.play?.addEventListener('click', this.onPlay);
    this.wampogram?.addEventListener('click', this.onWampogram);
    this.win.addEventListener(ROOM_PUBLISH_NAME_REQUEST_EVENT, this.onName);
    this.win.addEventListener(ROOM_FIRST_PUBLISHED_EVENT, this.onPublished);
    for (const event of [AUTH_STATE_CHANGED_EVENT, AUTH_SESSION_REFRESHED_EVENT]) this.win.addEventListener(event, this.onAuth);
    this.win.addEventListener(APP_MODE_CHANGED_EVENT, this.onMode);
    this.win.addEventListener('keydown', this.onKeydown, true); this.win.addEventListener('keyup', this.onKeyup, true);
  }

  destroy(): void {
    this.close(); this.lifecycle.detach(); this.closeButton?.removeEventListener('click', this.onClose);
    this.form?.removeEventListener('submit', this.onSubmit);
    this.share?.removeEventListener('click', this.onShare); this.copy?.removeEventListener('click', this.onCopy);
    this.twitter?.removeEventListener('click', this.onTwitter); this.play?.removeEventListener('click', this.onPlay);
    this.wampogram?.removeEventListener('click', this.onWampogram);
    this.win.removeEventListener(ROOM_PUBLISH_NAME_REQUEST_EVENT, this.onName);
    this.win.removeEventListener(ROOM_FIRST_PUBLISHED_EVENT, this.onPublished);
    for (const event of [AUTH_STATE_CHANGED_EVENT, AUTH_SESSION_REFRESHED_EVENT]) this.win.removeEventListener(event, this.onAuth);
    this.win.removeEventListener(APP_MODE_CHANGED_EVENT, this.onMode);
    this.win.removeEventListener('keydown', this.onKeydown, true); this.win.removeEventListener('keyup', this.onKeyup, true);
    this.blockedKeys.clear();
  }

  close(): void {
    const resolve = this.pending?.resolve;
    this.pending = null; this.active = null; this.shareUrl = ''; this.generation++;
    this.lifecycle.hide();
    if (this.returnFocus?.isConnected && this.returnFocus.getClientRects().length) this.returnFocus.focus({ preventScroll: true });
    this.returnFocus = null; resolve?.(null);
  }

  private open(): void {
    this.returnFocus = this.doc.activeElement instanceof HTMLElement ? this.doc.activeElement : null;
    this.openingMode = this.doc.body.dataset.appMode;
    this.generation++; this.status(''); this.lifecycle.show();
  }
  private text(id: string, value: string): void { const element = this.doc.getElementById(id); if (element) element.textContent = value; }
  private status(value: string): void { this.text('first-publish-status', value); }
  private valid(): boolean { return this.lifecycle.isOpen() && this.account() === (this.pending?.userId ?? this.active?.userId); }

  private readonly onClose = () => this.close();
  private readonly onAuth = () => { if (this.lifecycle.isOpen() && !this.valid()) this.close(); };
  private readonly onMode = () => { if (this.doc.body.dataset.appMode !== this.openingMode) this.close(); };
  private readonly onName = (event: Event) => {
    const detail = (event as CustomEvent<RoomPublishNameRequest>).detail;
    if (!this.modal || !this.nameInput || !detail || this.account() !== detail.userId) return;
    event.preventDefault(); this.close(); this.pending = detail; this.open();
    this.text('first-publish-heading', 'Name your room');
    this.form?.classList.remove('hidden'); this.doc.getElementById('first-publish-live')?.classList.add('hidden');
    this.nameInput.value = detail.suggestedTitle.slice(0, 40); this.nameInput.focus(); this.nameInput.select();
    this.closeButton?.setAttribute('aria-label', 'Cancel publishing');
  };
  private readonly onSubmit = (event: Event) => {
    event.preventDefault(); if (!this.pending || !this.valid()) return;
    const title = this.nameInput?.value.trim().slice(0, 40) ?? '';
    if (!title) { this.status('Add a name before publishing.'); this.nameInput?.focus(); return; }
    const resolve = this.pending.resolve; this.pending = null; this.close(); resolve(title);
  };
  private readonly onPublished = (event: Event) => {
    const detail = (event as CustomEvent<FirstPublishedRoom>).detail;
    if (!this.modal || !detail || this.account() !== detail.userId) return;
    this.close(); this.active = detail; this.open();
    // An editor URL may contain a draft, world or QA mode. Shared links always open the public room.
    this.shareUrl = new URL(buildRoomSharePath(detail.coordinates), this.win.location.origin).toString();
    this.text('first-publish-heading', 'Your room is live!'); this.text('first-publish-title', detail.title);
    this.form?.classList.add('hidden'); this.doc.getElementById('first-publish-live')?.classList.remove('hidden');
    const link = this.doc.getElementById('first-publish-link') as HTMLInputElement | null;
    if (link) link.value = this.shareUrl;
    this.wampogram?.classList.toggle('hidden', detail.contentType !== 'room');
    this.closeButton?.setAttribute('aria-label', 'Close published room'); this.share?.focus();
    void this.renderPreview(detail);
  };

  private async renderPreview(detail: FirstPublishedRoom): Promise<void> {
    const container = this.doc.getElementById('first-publish-preview'); if (!container) return;
    const generation = this.generation; container.replaceChildren();
    const current = () => this.generation === generation && this.active === detail && this.valid();
    this.text('first-publish-preview-fallback', 'Loading published preview…');
    this.doc.getElementById('first-publish-preview-fallback')?.classList.remove('hidden');
    try {
      const refs = detail.expandedSnapshot?.roomRefs ?? [];
      const snapshots = detail.snapshot ? [detail.snapshot] : (await this.rooms.queryRoomSnapshots(refs.map(ref => ({
        kind: 'version' as const, roomId: ref.roomId, version: ref.roomVersion!,
      })))).snapshots.map(entry => entry.snapshot);
      if (!current()) return;
      const minX = Math.min(...snapshots.map(snapshot => snapshot.coordinates.x));
      const minY = Math.min(...snapshots.map(snapshot => snapshot.coordinates.y));
      const columns = Math.max(...snapshots.map(snapshot => snapshot.coordinates.x)) - minX + 1;
      const rows = Math.max(...snapshots.map(snapshot => snapshot.coordinates.y)) - minY + 1;
      const ratio = columns * ROOM_PX_WIDTH / (rows * ROOM_PX_HEIGHT);
      container.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
      container.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
      container.style.aspectRatio = String(ratio);
      container.style.maxWidth = `calc(var(--first-publish-preview-height) * ${ratio})`;
      const urls = await Promise.all(snapshots.map(snapshot => this.preview(snapshot, { tilePixelSize: 2 })));
      if (!current()) return;
      if (!snapshots.length || (refs.length && snapshots.length !== refs.length)) throw new Error('Published preview incomplete');
      snapshots.forEach((snapshot, index) => {
        const image = this.doc.createElement('img'); image.src = urls[index]; image.alt = `Published room ${snapshot.coordinates.x},${snapshot.coordinates.y}`;
        image.style.gridColumn = String(snapshot.coordinates.x - minX + 1); image.style.gridRow = String(snapshot.coordinates.y - minY + 1);
        container.append(image);
      });
      this.doc.getElementById('first-publish-preview-fallback')?.classList.add('hidden');
    } catch { if (current()) this.text('first-publish-preview-fallback', 'Preview unavailable. Your room is live.'); }
  }

  private readonly onCopy = () => { void this.copyLink(); };
  private async copyLink(): Promise<void> {
    if (!this.active || !this.valid()) return;
    const generation = this.generation, url = this.shareUrl;
    try {
      if (!this.win.navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await this.win.navigator.clipboard.writeText(url);
      if (generation === this.generation) this.status('Room link copied.');
    } catch {
      if (generation !== this.generation) return;
      const link = this.doc.getElementById('first-publish-link') as HTMLInputElement | null;
      link?.focus(); link?.select(); this.status('Copy the selected link.');
    }
  }
  private readonly onShare = () => { void this.shareLink(); };
  private async shareLink(): Promise<void> {
    if (!this.active || !this.valid()) return;
    if (!this.win.navigator.share) { await this.copyLink(); return; }
    const generation = this.generation;
    try { await this.win.navigator.share({ title: this.active.title, text: `I made ${this.active.title} in WAMP. Come play!`, url: this.shareUrl }); }
    catch (error) {
      if (generation !== this.generation || (error instanceof Error && error.name === 'AbortError')) return;
      await this.copyLink();
    }
  }
  private readonly onTwitter = () => {
    if (this.active && this.valid()) openTwitterShareIntent(this.win, `I made ${this.active.title} in WAMP. Come play!`, this.shareUrl);
  };
  private readonly onPlay = () => { if (!this.active || !this.valid()) return; const play = this.active.play; this.close(); play(); };
  private readonly onWampogram = () => {
    if (!this.active || !this.valid() || this.active.contentType !== 'room') return;
    this.close(); this.doc.getElementById('btn-wamp-o-gram')?.click();
  };
  private readonly onKeydown = (event: KeyboardEvent) => {
    if (!this.lifecycle.isOpen()) return;
    this.blockedKeys.add(event.code || event.key); event.stopImmediatePropagation();
    if (event.key === 'Escape') { event.preventDefault(); this.close(); }
    else if (event.key === 'Enter' && event.target === this.nameInput) { event.preventDefault(); this.onSubmit(event); }
    else if (event.key === 'Tab') {
      const targets = [...(this.modal?.querySelectorAll<HTMLElement>('button, input, a[href]') ?? [])]
        .filter(element => !element.hasAttribute('disabled') && element.getClientRects().length);
      const index = targets.indexOf(this.doc.activeElement as HTMLElement);
      if (targets.length && (event.shiftKey ? index <= 0 : index < 0 || index === targets.length - 1)) {
        event.preventDefault(); targets[event.shiftKey ? targets.length - 1 : 0].focus();
      }
    }
  };
  private readonly onKeyup = (event: KeyboardEvent) => {
    if (this.blockedKeys.delete(event.code || event.key)) event.stopImmediatePropagation();
  };
}

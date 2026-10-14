import { getAuthDebugState, AUTH_STATE_CHANGED_EVENT, AUTH_SESSION_REFRESHED_EVENT } from '../../auth/client';
import { ROOM_FIRST_PUBLISHED_EVENT, ROOM_PUBLISH_NAME_REQUEST_EVENT, type FirstPublishedRoom, type RoomPublishNameRequest } from '../../publishing/events';
import { APP_MODE_CHANGED_EVENT } from '../appMode';
import type { FirstPublishModalController } from './firstPublishModal';

type Controller = Pick<FirstPublishModalController, 'init' | 'destroy' | 'close' | 'requestName' | 'announcePublished'>;
type Request = { kind: 'name'; detail: RoomPublishNameRequest } | { kind: 'published'; detail: FirstPublishedRoom };

/** Accept the synchronous name request before downloading its dialog; never leave a publisher waiting. */
export class LazyFirstPublishController {
  private instance: Controller | null = null;
  private loading: Promise<void> | null = null;
  private pending: Request | null = null;
  private destroyed = false;
  private pendingMode: string | undefined;
  constructor(private readonly load: () => Promise<Controller>, private readonly win: Window = window,
    private readonly account = () => { const auth = getAuthDebugState(); return auth.authenticated ? auth.user?.id ?? null : null; }, private readonly mode = () => document.body.dataset.appMode) {}

  init(): void {
    this.win.addEventListener(ROOM_PUBLISH_NAME_REQUEST_EVENT, this.onName);
    this.win.addEventListener(ROOM_FIRST_PUBLISHED_EVENT, this.onPublished);
    for (const name of [AUTH_STATE_CHANGED_EVENT, AUTH_SESSION_REFRESHED_EVENT, APP_MODE_CHANGED_EVENT]) this.win.addEventListener(name, this.onTransition);
  }
  private readonly onName = (event: Event) => {
    const detail = (event as CustomEvent<RoomPublishNameRequest>).detail;
    if (this.instance || this.destroyed || !detail || this.account() !== detail.userId) return;
    event.preventDefault(); this.queue({ kind: 'name', detail });
  };
  private readonly onPublished = (event: Event) => {
    const detail = (event as CustomEvent<FirstPublishedRoom>).detail;
    if (!this.instance && !this.destroyed && detail && this.account() === detail.userId) this.queue({ kind: 'published', detail });
  };
  private readonly onTransition = (event: Event) => {
    if (this.pending && ((event.type === APP_MODE_CHANGED_EVENT && this.mode() !== this.pendingMode) || this.account() !== this.pending.detail.userId)) this.close();
  };
  private queue(request: Request): void {
    this.cancelPending(); this.pending = request; this.pendingMode = this.mode();
    this.loading ??= this.load().then(controller => {
      if (this.destroyed) return;
      controller.init(); this.instance = controller;
      const pending = this.pending;
      if (!pending) return;
      if (pending.kind === 'name') {
        if (!controller.requestName(pending.detail)) pending.detail.resolve(null);
      } else controller.announcePublished(pending.detail);
      this.pending = null;
    }).catch(() => { this.loading = null; this.cancelPending(); });
  }
  private cancelPending(): void {
    const pending = this.pending; this.pending = null;
    if (pending?.kind === 'name') pending.detail.resolve(null);
  }
  close(): void { this.cancelPending(); this.instance?.close(); }
  destroy(): void {
    this.destroyed = true; this.close(); this.instance?.destroy();
    this.win.removeEventListener(ROOM_PUBLISH_NAME_REQUEST_EVENT, this.onName);
    this.win.removeEventListener(ROOM_FIRST_PUBLISHED_EVENT, this.onPublished);
    for (const name of [AUTH_STATE_CHANGED_EVENT, AUTH_SESSION_REFRESHED_EVENT, APP_MODE_CHANGED_EVENT]) this.win.removeEventListener(name, this.onTransition);
  }
}

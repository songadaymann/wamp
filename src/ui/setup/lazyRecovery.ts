import { AUTH_STATE_CHANGED_EVENT, AUTH_SESSION_REFRESHED_EVENT } from '../../auth/client';
import { APP_READY_EVENT } from '../appFeedback';
import { APP_MODE_CHANGED_EVENT } from '../appMode';

type Controller = { init(): void; close(): void; destroy(): void };

/** Recovery is an automatic service. Start it after readiness, or immediately on an explicit history request. */
export class LazyRecoveryController<T extends Controller> {
  private instance: T | null = null;
  private loading: Promise<T> | null = null;
  private timer: number | null = null;
  private destroyed = false;
  private generation = 0;
  private button: HTMLElement | null = null;
  private readonly wakeEvents = [APP_READY_EVENT, APP_MODE_CHANGED_EVENT, AUTH_STATE_CHANGED_EVENT, AUTH_SESSION_REFRESHED_EVENT, 'focus', 'online', 'storage'];
  /** `onLoadError` explains a download the player asked for (a click); the automatic start stays quiet. */
  constructor(private readonly load: () => Promise<T>, private readonly buttonId: string, private readonly delay: number,
    private readonly onLoadError?: (error: unknown) => void,
    private readonly doc: Document = document, private readonly win: Window = window) {}

  init(): void {
    this.button = this.doc.getElementById(this.buttonId);
    this.button?.addEventListener('click', this.onClick);
    for (const name of this.wakeEvents) this.win.addEventListener(name, this.onWake);
    this.doc.addEventListener('visibilitychange', this.onWake);
    this.schedule();
  }
  private readonly onWake = () => this.schedule();
  private schedule(delay = this.delay): void {
    if (this.instance || this.loading || this.destroyed || this.timer !== null || this.doc.body.dataset.appReady !== 'true') return;
    this.timer = this.win.setTimeout(() => {
      this.timer = null;
      void this.ensure().catch(() => this.schedule(20_000));
    }, delay);
  }
  private readonly onClick = () => {
    if (!this.instance) void this.invoke(() => this.button?.click()).catch(() => this.schedule(20_000));
  };
  async invoke(action: (controller: T) => void): Promise<void> {
    if (this.destroyed) return;
    const generation = ++this.generation;
    let controller: T;
    try {
      controller = await this.ensure();
    } catch (error) {
      if (!this.onLoadError) throw error;
      if (!this.destroyed && generation === this.generation) this.onLoadError(error);
      return;
    }
    if (!this.destroyed && generation === this.generation) action(controller);
  }
  private ensure(): Promise<T> {
    if (this.timer !== null) { this.win.clearTimeout(this.timer); this.timer = null; }
    this.loading ??= this.load().then(controller => {
      if (!this.destroyed) { controller.init(); this.instance = controller; }
      return controller;
    }).catch((error: unknown) => { this.loading = null; throw error; });
    return this.loading;
  }
  close(): void { this.generation++; this.instance?.close(); }
  destroy(): void {
    this.destroyed = true; this.generation++; this.instance?.destroy();
    if (this.timer !== null) this.win.clearTimeout(this.timer);
    this.button?.removeEventListener('click', this.onClick);
    for (const name of this.wakeEvents) this.win.removeEventListener(name, this.onWake);
    this.doc.removeEventListener('visibilitychange', this.onWake);
  }
}

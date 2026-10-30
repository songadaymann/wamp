// A room edge that holds the player while the next room loads is otherwise a
// silent invisible wall, and the world HUD status line is hidden on phones.
// This chip sits over the play area on every device (F355).

export const SEAM_WAIT_NOTICE_DELAY_MS = 600;
export const SEAM_WAIT_SLOW_NOTICE_DELAY_MS = 4_000;
const NOTICE_ELEMENT_ID = 'play-connection-notice';

export type ConnectionNoticeTone = 'loading' | 'offline';

export interface ConnectionNotice {
  readonly tone: ConnectionNoticeTone;
  readonly text: string;
}

/**
 * `seamWaitMs` is how long the player has been held at an unready seam, or
 * null when they are not. Short holds stay silent so normal streaming never
 * flashes a message.
 */
export function resolveConnectionNotice(input: {
  readonly online: boolean;
  readonly seamWaitMs: number | null;
}): ConnectionNotice | null {
  const waiting = input.seamWaitMs !== null && input.seamWaitMs >= SEAM_WAIT_NOTICE_DELAY_MS;
  if (!input.online) {
    return {
      tone: 'offline',
      text: waiting
        ? 'No connection. The next room loads when you reconnect.'
        : 'Offline. New rooms load when you reconnect.',
    };
  }
  if (!waiting || input.seamWaitMs === null) return null;
  return {
    tone: 'loading',
    text: input.seamWaitMs >= SEAM_WAIT_SLOW_NOTICE_DELAY_MS
      ? 'Still loading the next room. Retrying…'
      : 'Loading next room…',
  };
}

interface NoticeElement {
  textContent: string | null;
  readonly dataset: Record<string, string | undefined>;
  readonly classList: { toggle(name: string, force?: boolean): boolean };
}

interface NoticeWindow {
  readonly navigator?: { readonly onLine?: boolean };
  addEventListener(type: 'online' | 'offline', listener: () => void): void;
  removeEventListener(type: 'online' | 'offline', listener: () => void): void;
  setTimeout(handler: () => void, timeout: number): number;
  clearTimeout(id: number): void;
}

export interface OverworldConnectionNoticeOptions {
  /** Called when the browser comes back online, to retry streaming at once. */
  readonly onOnline?: () => void;
  readonly doc?: { getElementById(id: string): unknown };
  readonly win?: NoticeWindow;
}

export class OverworldConnectionNoticeController {
  private element: NoticeElement | null = null;
  private win: NoticeWindow | null = null;
  private online = true;
  private seamWaitMs: number | null = null;
  private readonly timers: number[] = [];

  constructor(private readonly options: OverworldConnectionNoticeOptions = {}) {}

  start(): void {
    if (this.win) return;
    const win = this.options.win ?? (window as unknown as NoticeWindow);
    const doc = this.options.doc ?? document;
    this.win = win;
    this.element = doc.getElementById(NOTICE_ELEMENT_ID) as NoticeElement | null;
    this.online = win.navigator?.onLine !== false;
    win.addEventListener('online', this.handleOnline);
    win.addEventListener('offline', this.handleOffline);
    this.render();
  }

  destroy(): void {
    this.clearTimers();
    this.seamWaitMs = null;
    if (this.element) {
      this.element.textContent = '';
      this.element.dataset.tone = '';
      this.element.classList.toggle('hidden', true);
    }
    this.win?.removeEventListener('online', this.handleOnline);
    this.win?.removeEventListener('offline', this.handleOffline);
    this.win = null;
    this.element = null;
  }

  setSeamWaiting(waiting: boolean): void {
    if (waiting === (this.seamWaitMs !== null)) return;
    this.clearTimers();
    this.seamWaitMs = waiting ? 0 : null;
    if (waiting && this.win) {
      for (const delay of [SEAM_WAIT_NOTICE_DELAY_MS, SEAM_WAIT_SLOW_NOTICE_DELAY_MS]) {
        this.timers.push(this.win.setTimeout(() => {
          if (this.seamWaitMs === null) return;
          this.seamWaitMs = delay;
          this.render();
        }, delay));
      }
    }
    this.render();
  }

  getNotice(): ConnectionNotice | null {
    return resolveConnectionNotice({ online: this.online, seamWaitMs: this.seamWaitMs });
  }

  private readonly handleOnline = (): void => {
    this.online = true;
    this.render();
    this.options.onOnline?.();
  };

  private readonly handleOffline = (): void => {
    this.online = false;
    this.render();
  };

  private clearTimers(): void {
    for (const timer of this.timers.splice(0)) this.win?.clearTimeout(timer);
  }

  private render(): void {
    const element = this.element;
    if (!element) return;
    const notice = this.getNotice();
    const text = notice?.text ?? '';
    if (element.textContent !== text) element.textContent = text;
    element.dataset.tone = notice?.tone ?? '';
    element.classList.toggle('hidden', !notice);
  }
}

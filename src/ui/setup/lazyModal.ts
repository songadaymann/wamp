import { reportClientError } from '../../main/clientErrorReporter';
import { canReplaceBusyCard, showBusyError } from '../appFeedback';
import { beginPendingDialog } from '../pendingDialog';

/** What other UI needs from a pop-up: open it and close it. */
export interface ModalController {
  init(): void;
  open(...args: never[]): void | Promise<void>;
  close(): void;
  destroy?(): void;
}

/**
 * A pop-up that downloads and sets itself up on its first open instead of at boot
 * (F019). Closing during the download cancels its pending open; failures can be retried.
 */
export class LazyModal<T extends ModalController> {
  private instance: T | null = null;
  private loading: Promise<T> | null = null;
  private openGeneration = 0;
  private destroyed = false;
  private pendingOpens = new Set<() => void>();

  constructor(
    private readonly load: () => Promise<T>,
    private readonly deferredRoots: readonly string[] = [],
    /** Explains a failed download or setup instead of a click that does nothing. */
    private readonly onLoadError?: (error: unknown) => void,
  ) {}

  /** True once the pop-up has loaded and handles its own triggers. */
  get loaded(): boolean {
    return this.instance !== null;
  }

  async open(...args: Parameters<T['open']>): Promise<void> {
    if (this.destroyed) return;
    const generation = ++this.openGeneration;
    const release = beginPendingDialog();
    this.pendingOpens.add(release);
    try {
      let modal: T;
      try {
        modal = await this.ensure();
      } catch (error) {
        if (!this.onLoadError) throw error;
        // Closed meanwhile: the player has moved on, so there is nothing to explain.
        if (generation === this.openGeneration && !this.destroyed) this.onLoadError(error);
        return;
      }
      if (generation !== this.openGeneration) return;
      const opening = (modal.open as (...openArgs: Parameters<T['open']>) => void | Promise<void>)(...args);
      // The visible dialog now owns the pause. Its later API work must not hold
      // an invisible pause after its own Close button has hidden the dialog.
      release();
      await opening;
    } finally {
      this.pendingOpens.delete(release);
      release();
    }
  }

  close(): void {
    this.openGeneration++;
    for (const release of this.pendingOpens) release();
    this.pendingOpens.clear();
    this.instance?.close();
  }

  destroy(): void {
    this.destroyed = true;
    this.close();
    this.instance?.destroy?.();
  }

  ensure(): Promise<T> {
    if (!this.loading) {
      for (const id of this.deferredRoots) {
        const template = document.getElementById(`deferred-${id}`);
        if (template instanceof HTMLTemplateElement) template.replaceWith(template.content);
      }
      this.loading = this.load().then((modal) => {
        if (this.destroyed) return modal;
        modal.init();
        this.instance = modal;
        return modal;
      }).catch((error: unknown) => {
        this.loading = null;
        throw error;
      });
    }
    return this.loading;
  }
}

/**
 * A menu's `onLoadError`: a card that names the menu and offers a reload. Browsers keep a failed
 * download for the life of the page, so trying again without one would fail the same way. It is
 * an error card, so after a release F374's update offer replaces it; like that offer, it never
 * covers a choice or a save in progress. The failure is reported either way. `menu` reads as it
 * would mid-sentence ("version history", "Leaderboard"); the card's title starts it with a capital.
 */
export function explainMenuLoadFailure(menu: string, reload: () => void = () => window.location.reload()): (error: unknown) => void {
  return (error) => {
    console.error(`The ${menu} failed to load`, error);
    reportClientError({
      type: 'unhandledrejection',
      message: `${menu} failed to load: ${error instanceof Error ? error.message : String(error)}`,
      stack: error instanceof Error ? error.stack ?? null : null,
    });
    if (!canReplaceBusyCard()) return;
    showBusyError(`The ${menu} couldn't load. Check your connection, then reload WAMP. Save anything you are working on first.`, {
      title: menu.charAt(0).toUpperCase() + menu.slice(1), retryLabel: 'Reload', closeLabel: 'Not now', retryHandler: reload,
    });
  };
}

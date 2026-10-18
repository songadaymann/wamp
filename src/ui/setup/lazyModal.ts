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
      const modal = await this.ensure();
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

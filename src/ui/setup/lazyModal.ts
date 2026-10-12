/** What other UI needs from a pop-up: open it and close it. */
export interface ModalController {
  init(): void;
  open(...args: never[]): Promise<void>;
  close(): void;
}

/**
 * A pop-up that downloads and sets itself up on its first open instead of at boot
 * (F019). Closing it before then does nothing; a failed download can be retried.
 */
export class LazyModal<T extends ModalController> {
  private instance: T | null = null;
  private loading: Promise<T> | null = null;

  constructor(private readonly load: () => Promise<T>) {}

  /** True once the pop-up has loaded and handles its own triggers. */
  get loaded(): boolean {
    return this.instance !== null;
  }

  async open(...args: Parameters<T['open']>): Promise<void> {
    const modal = await this.ensure();
    await (modal.open as (...openArgs: Parameters<T['open']>) => Promise<void>)(...args);
  }

  close(): void {
    this.instance?.close();
  }

  ensure(): Promise<T> {
    this.loading ??= this.load().then(
      (modal) => {
        modal.init();
        this.instance = modal;
        return modal;
      },
      (error: unknown) => {
        this.loading = null;
        throw error;
      },
    );
    return this.loading;
  }
}

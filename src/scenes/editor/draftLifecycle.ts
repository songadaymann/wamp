export interface EditorDraftLifecycleHost {
  isActive(): boolean;
  hasUnsavedChanges(): boolean;
  flush(): void;
}

/** Browser lifecycle callbacks must flush synchronously; a mobile tab can die immediately afterward. */
export class EditorDraftLifecycle {
  private started = false;
  private readonly browserWindow: Window;
  private readonly browserDocument: Document;

  constructor(
    private readonly host: EditorDraftLifecycleHost,
    targets?: { window: Window; document: Document },
  ) {
    this.browserWindow = targets?.window ?? window;
    this.browserDocument = targets?.document ?? document;
  }

  private readonly beforeUnload = (event: BeforeUnloadEvent): void => {
    if (!this.host.isActive() || !this.host.hasUnsavedChanges()) return;
    this.host.flush();
    event.preventDefault();
    event.returnValue = '';
  };

  private readonly pageHide = (): void => {
    if (this.host.isActive()) this.host.flush();
  };

  private readonly visibilityChange = (): void => {
    if (this.browserDocument.visibilityState === 'hidden') this.pageHide();
  };

  start(): void {
    if (this.started) return;
    this.started = true;
    this.browserWindow.addEventListener('beforeunload', this.beforeUnload);
    this.browserWindow.addEventListener('pagehide', this.pageHide);
    this.browserDocument.addEventListener('visibilitychange', this.visibilityChange);
  }

  destroy(): void {
    if (!this.started) return;
    this.pageHide();
    this.started = false;
    this.browserWindow.removeEventListener('beforeunload', this.beforeUnload);
    this.browserWindow.removeEventListener('pagehide', this.pageHide);
    this.browserDocument.removeEventListener('visibilitychange', this.visibilityChange);
  }
}

export class DraftBackupDebouncer {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly write: () => void, private readonly delayMs = 500) {}

  schedule(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delayMs);
  }

  flush(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.write();
  }

  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

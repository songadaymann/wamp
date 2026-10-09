/** Authored changes commit immediately; only the expensive preview request waits. */
export class EditorPreviewRefresh {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly refresh: () => void) {}

  schedule(): void {
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.refresh();
    }, 150);
  }

  flush(): void {
    if (this.timer !== null) {
      this.cancel();
      this.refresh();
    }
  }

  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

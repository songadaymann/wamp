/** Shared room/expanded-room history controls, including workbench ownership. */
export class EditorHistoryControls {
  private static readonly owners = new WeakMap<Document, EditorHistoryControls>();
  private canUndo = false;
  private canRedo = false;
  private readonly observer: MutationObserver;
  private readonly buttons: HTMLButtonElement[];

  constructor(
    private readonly doc: Document,
    private readonly undo: () => void,
    private readonly redo: () => void,
    private readonly isActive: () => boolean = () => true,
  ) {
    this.buttons = [...doc.querySelectorAll<HTMLButtonElement>('[data-editor-history]')];
    for (const button of this.buttons) button.addEventListener('click', this.handleClick);
    this.observer = new MutationObserver(() => this.sync());
    this.observer.observe(doc.body, { attributes: true, attributeFilter: [
      'data-app-mode', 'data-editor-music-mode', 'data-editor-music-ui-locked', 'data-editor-sprite-ui-locked',
    ] });
    this.sync();
  }

  render(canUndo: boolean, canRedo: boolean): void {
    if (!this.isActive()) return;
    EditorHistoryControls.owners.set(this.doc, this);
    this.canUndo = canUndo;
    this.canRedo = canRedo;
    this.sync();
  }

  destroy(): void {
    this.observer.disconnect();
    for (const button of this.buttons) button.removeEventListener('click', this.handleClick);
    if (EditorHistoryControls.owners.get(this.doc) === this) {
      EditorHistoryControls.owners.delete(this.doc);
      for (const button of this.buttons) button.disabled = true;
    }
  }

  private isLocked(button?: HTMLButtonElement): boolean {
    const state = this.doc.body.dataset;
    const musicHistory = button?.dataset.editorMusicHistory !== undefined && state.editorMusicMode === 'true';
    return !this.isActive() || state.appMode !== 'editor' || state.editorSpriteUiLocked === 'true'
      || (!musicHistory && (state.editorMusicMode === 'true' || state.editorMusicUiLocked === 'true'));
  }

  private sync(): void {
    if (EditorHistoryControls.owners.get(this.doc) !== this) return;
    for (const button of this.buttons) {
      const available = button.dataset.editorHistory === 'undo' ? this.canUndo : this.canRedo;
      button.disabled = this.isLocked(button) || !available;
    }
  }

  private readonly handleClick = (event: Event): void => {
    const button = event.currentTarget as HTMLButtonElement;
    if (EditorHistoryControls.owners.get(this.doc) !== this) return;
    if (this.isLocked(button) || button.disabled) return;
    if (button.dataset.editorHistory === 'undo' && this.canUndo) this.undo();
    if (button.dataset.editorHistory === 'redo' && this.canRedo) this.redo();
  };
}

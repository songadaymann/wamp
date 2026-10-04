import type { EditorInspectorState } from './uiBridge/model';
import { EDITOR_SIDEBAR_RESIZED_EVENT } from '../../ui/setup/sidebarSections';

/** Presents the existing pinned inspector without changing selection or edit semantics. */
export class EditorPhoneInspector {
  private static readonly owners = new WeakMap<Document, EditorPhoneInspector>();
  private state: EditorInspectorState | null = null;
  private readonly observer: MutationObserver;
  private readonly done: HTMLButtonElement | null;
  private readonly cancel: HTMLButtonElement | null;
  private lastSelectionId: string | null = null;

  constructor(
    private readonly doc: Document,
    private readonly isActive: () => boolean,
    private readonly clearSelection: () => void,
    private readonly cancelLink: () => void,
  ) {
    this.done = doc.getElementById('btn-editor-inspector-done') as HTMLButtonElement | null;
    this.cancel = doc.getElementById('btn-editor-link-cancel') as HTMLButtonElement | null;
    this.done?.addEventListener('click', this.handleDone);
    this.cancel?.addEventListener('click', this.handleCancel);
    this.done?.addEventListener('keydown', this.handleKey);
    this.cancel?.addEventListener('keydown', this.handleKey);
    this.observer = new MutationObserver(() => this.sync());
    this.observer.observe(doc.body, { attributes: true, attributeFilter: [
      'data-app-mode', 'data-device-class', 'data-editor-music-mode',
      'data-editor-music-ui-locked', 'data-editor-sprite-ui-locked',
    ] });
  }

  render(state: EditorInspectorState): void {
    if (!this.isActive()) return;
    EditorPhoneInspector.owners.set(this.doc, this);
    this.state = state;
    this.sync();
  }

  destroy(): void {
    this.observer.disconnect();
    this.done?.removeEventListener('click', this.handleDone);
    this.cancel?.removeEventListener('click', this.handleCancel);
    this.done?.removeEventListener('keydown', this.handleKey);
    this.cancel?.removeEventListener('keydown', this.handleKey);
    if (EditorPhoneInspector.owners.get(this.doc) === this) {
      this.state = null;
      this.sync();
      EditorPhoneInspector.owners.delete(this.doc);
    }
  }

  private sync(): void {
    if (EditorPhoneInspector.owners.get(this.doc) !== this) return;
    const body = this.doc.body;
    const phone = body.dataset.deviceClass === 'phone';
    const eligible = phone && this.isActive() && body.dataset.appMode === 'editor'
      && body.dataset.editorMusicMode !== 'true' && body.dataset.editorMusicUiLocked !== 'true'
      && body.dataset.editorSpriteUiLocked !== 'true';
    const linking = eligible && this.state?.visible === true && this.state.connecting;
    const open = eligible && this.state?.visible === true && this.state.pinned && !linking;
    let changed = false;
    for (const [key, value] of [['editorPhoneInspector', open], ['editorPhoneLinking', linking]] as const) {
      const next = value ? 'true' : 'false';
      if (body.dataset[key] !== next) { body.dataset[key] = next; changed = true; }
    }
    const root = this.doc.getElementById('editor-inspector');
    root?.setAttribute('aria-hidden', String(phone ? !open : !this.state?.visible));
    this.doc.getElementById('editor-phone-link-prompt')?.setAttribute('aria-hidden', String(!linking));
    const status = this.doc.getElementById('editor-phone-link-status');
    const text = linking ? (this.state?.pressureStatusText ?? '').replace(/\bClick\b/g, 'Tap') : '';
    if (status && status.textContent !== text) status.textContent = text;
    if (open && this.state?.selectionId !== this.lastSelectionId) {
      for (const panel of root?.querySelectorAll<HTMLElement>('.pressure-plate-panel') ?? []) panel.scrollTop = 0;
    }
    this.lastSelectionId = open ? this.state?.selectionId ?? null : null;
    if (changed) this.doc.defaultView?.requestAnimationFrame(() => {
      this.doc.defaultView?.dispatchEvent(new Event(EDITOR_SIDEBAR_RESIZED_EVENT));
      this.doc.defaultView?.dispatchEvent(new Event('resize'));
    });
  }

  private readonly handleDone = (): void => {
    if (this.isOwner()) this.clearSelection();
  };
  private readonly handleCancel = (): void => {
    if (this.isOwner()) this.cancelLink();
  };
  private readonly handleKey = (event: KeyboardEvent): void => {
    if (!this.isOwner() || (event.key !== 'Enter' && event.code !== 'Space')) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) (event.currentTarget as HTMLButtonElement).click();
  };
  private isOwner(): boolean {
    return EditorPhoneInspector.owners.get(this.doc) === this && this.isActive()
      && this.doc.body.dataset.appMode === 'editor' && this.doc.body.dataset.deviceClass === 'phone'
      && this.doc.body.dataset.editorMusicMode !== 'true' && this.doc.body.dataset.editorMusicUiLocked !== 'true'
      && this.doc.body.dataset.editorSpriteUiLocked !== 'true';
  }
}

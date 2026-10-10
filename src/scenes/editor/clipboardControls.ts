import type { EditorClipboardState } from './clipboard';
import { deleteEditorStamp, listEditorStamps, saveEditorStamp } from './stampStorage';

export interface EditorClipboardControlActions {
  isActive: () => boolean;
  getClipboard: () => EditorClipboardState | null;
  /** Start the paste preview with the current clipboard. */
  paste: () => void;
  /** Make a stamp the clipboard and start pasting it. */
  useClipboard: (clipboard: EditorClipboardState) => void;
  showStatus: (message: string) => void;
}

/** Copy-tool panel shared by the room and Expanded editors: Paste, Save stamp and My Stamps. */
export class EditorClipboardControls {
  private static readonly owners = new WeakMap<Document, EditorClipboardControls>();

  constructor(private readonly doc: Document, private readonly actions: EditorClipboardControlActions) {
    doc.addEventListener('click', this.handleClick);
  }

  render(): void {
    if (!this.actions.isActive()) return;
    EditorClipboardControls.owners.set(this.doc, this);
    const hasClipboard = Boolean(this.actions.getClipboard());
    for (const button of this.doc.querySelectorAll<HTMLButtonElement>('[data-editor-clipboard-action]')) {
      button.disabled = !hasClipboard;
    }
    const stamps = listEditorStamps();
    const signature = stamps.map((stamp) => stamp.id).join(',');
    for (const list of this.doc.querySelectorAll<HTMLElement>('.editor-copy-stamps')) {
      if (list.dataset.stampSignature === signature) continue;
      list.dataset.stampSignature = signature;
      if (stamps.length === 0) {
        const empty = this.doc.createElement('p');
        empty.className = 'editor-copy-stamps-empty';
        empty.textContent = 'No stamps yet. Copy an area, then Save stamp to reuse it in any room.';
        list.replaceChildren(empty);
        continue;
      }
      list.replaceChildren(...stamps.map((stamp) => {
        const row = this.doc.createElement('div');
        row.className = 'editor-copy-stamp';
        row.setAttribute('role', 'listitem');
        const use = this.doc.createElement('button');
        use.type = 'button';
        use.className = 'editor-copy-stamp-use';
        use.dataset.editorStampId = stamp.id;
        use.textContent = stamp.name;
        use.title = `Paste stamp: ${stamp.name}`;
        const remove = this.doc.createElement('button');
        remove.type = 'button';
        remove.className = 'editor-copy-stamp-delete';
        remove.dataset.editorStampDelete = stamp.id;
        remove.textContent = '×';
        remove.ariaLabel = `Delete stamp ${stamp.name}`;
        remove.title = remove.ariaLabel;
        row.append(use, remove);
        return row;
      }));
    }
  }

  destroy(): void {
    this.doc.removeEventListener('click', this.handleClick);
    if (EditorClipboardControls.owners.get(this.doc) === this) EditorClipboardControls.owners.delete(this.doc);
  }

  private readonly handleClick = (event: Event): void => {
    if (EditorClipboardControls.owners.get(this.doc) !== this || !this.actions.isActive()) return;
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      '[data-editor-clipboard-action], [data-editor-stamp-id], [data-editor-stamp-delete]',
    );
    if (!target || (target instanceof HTMLButtonElement && target.disabled)) return;

    if (target.dataset.editorClipboardAction === 'paste') {
      this.actions.paste();
    } else if (target.dataset.editorClipboardAction === 'save-stamp') {
      const clipboard = this.actions.getClipboard();
      if (!clipboard) return;
      const result = saveEditorStamp(clipboard);
      this.actions.showStatus(result.stamp ? `Saved stamp: ${result.stamp.name}.` : result.error);
    } else if (target.dataset.editorStampId) {
      const stamp = listEditorStamps().find((candidate) => candidate.id === target.dataset.editorStampId);
      if (stamp) this.actions.useClipboard(stamp.clipboard);
    } else if (target.dataset.editorStampDelete) {
      deleteEditorStamp(target.dataset.editorStampDelete);
    }
    this.render();
  };
}

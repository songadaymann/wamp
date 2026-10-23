import { setToggleState } from '../toggleState';

const SWITCH_TOOLS = ['pencil', 'eraser'] as const;

/**
 * The phone dock's one-tap Draw/Erase switch (F369). The tool row lives in the library sheet,
 * which hides after every pick, so this mirrors the editor's own Draw and Erase buttons and taps
 * them. Going through those buttons keeps each editor's tool handling, and the selected tile or
 * object stays as it was.
 */
export class EditorPhoneToolSwitch {
  constructor(private readonly doc: Document, private readonly isActive: () => boolean) {
    for (const button of this.buttons()) {
      button.addEventListener('click', () => this.choose(button.dataset.editorPhoneTool));
    }
    const win = doc.defaultView;
    if (win?.MutationObserver) {
      const observer = new win.MutationObserver(() => this.render());
      for (const tool of SWITCH_TOOLS) {
        const target = this.toolButton(tool);
        if (target) observer.observe(target, { attributes: true, attributeFilter: ['class', 'disabled'], childList: true, characterData: true, subtree: true });
      }
    }
    this.render();
  }

  render(): void {
    for (const button of this.buttons()) {
      const target = this.toolButton(button.dataset.editorPhoneTool);
      setToggleState(button, Boolean(target?.classList.contains('active')));
      button.disabled = !target || target.disabled;
      // Draw reads Spray while the pencil sprays, as the tool row does.
      const [icon, label] = button.children;
      const targetIcon = target?.querySelector('.tool-icon')?.textContent;
      const targetLabel = target?.querySelector('.tool-label')?.textContent;
      if (icon && targetIcon) icon.textContent = targetIcon;
      if (label && targetLabel) label.textContent = targetLabel;
    }
  }

  private choose(tool: string | undefined): void {
    const target = this.toolButton(tool);
    // Choosing the current tool again would switch Draw to Spray; a switch leaves it as it is.
    if (!this.isActive() || !target || target.disabled || target.classList.contains('active')) return;
    target.click();
  }

  private buttons(): HTMLButtonElement[] {
    return [...this.doc.querySelectorAll<HTMLButtonElement>('[data-editor-phone-tool]')];
  }

  private toolButton(tool: string | undefined): HTMLButtonElement | null {
    return tool ? this.doc.querySelector<HTMLButtonElement>(`.editor-shell-tools .tool-btn[data-tool="${tool}"]`) : null;
  }
}

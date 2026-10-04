import { EDITOR_SHELL_ESCAPE_REQUESTED_EVENT, type EditorShellEscapeRequestedDetail } from '../../scenes/editor/uiEvents';
import { EDITOR_SIDEBAR_RESIZED_EVENT } from './sidebarSections';

/** Phone presentation of the shared dock: existing controls retain their listeners and state. */
export class EditorPhoneDock {
  private active = false;
  private collapsed = false;
  private menuOpen = false;
  private readonly moved: Array<{ element: HTMLElement; home: Comment }> = [];

  constructor(private readonly doc: Document, private readonly cancelSpawn: () => void, private readonly closePopovers: () => void) {
    for (const id of ['btn-editor-phone-menu', 'btn-editor-phone-account', 'btn-mobile-editor-toggle']) {
      doc.getElementById(id)?.addEventListener('keydown', event => {
        if (!this.active || (event.key !== 'Enter' && event.code !== 'Space')) return;
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) (event.currentTarget as HTMLButtonElement).click();
      });
    }
    doc.getElementById('btn-editor-phone-menu')?.addEventListener('click', () => {
      if (!this.active) return;
      this.closeInspector();
      this.menuOpen = !this.menuOpen;
      if (this.menuOpen) this.closePopovers();
      this.render();
    });
    doc.getElementById('btn-mobile-editor-toggle')?.addEventListener('click', () => {
      if (!this.active) return;
      if (doc.body.dataset.editorPhoneInspector === 'true' || doc.body.dataset.editorPhoneLinking === 'true') this.closeInspector();
      else if (doc.body.dataset.editorSpawnPlacement === 'true') this.cancelSpawn();
      else this.setCollapsed(!this.collapsed);
    });
    doc.getElementById('btn-editor-phone-account')?.addEventListener('click', event => {
      if (!this.active) return;
      event.stopPropagation();
      this.closeMenu();
      doc.getElementById('menu-toggle')?.click();
    });
    doc.getElementById('editor-phone-menu')?.addEventListener('click', event => {
      if ((event.target as Element).closest('[data-editor-shell-action]')) this.closeMenu();
    });
    doc.addEventListener('pointerdown', event => {
      const target = event.target as Node;
      if (this.active && this.menuOpen && !doc.getElementById('editor-phone-menu')?.contains(target)
        && !doc.getElementById('btn-editor-phone-menu')?.contains(target)) this.closeMenu();
    });
    doc.defaultView?.addEventListener('mobile-editor-auto-collapse', () => {
      if (this.active) this.setCollapsed(true);
    });
    doc.defaultView?.addEventListener(EDITOR_SHELL_ESCAPE_REQUESTED_EVENT, event => {
      const detail = (event as CustomEvent<EditorShellEscapeRequestedDetail>).detail;
      if (this.active && this.menuOpen && !detail.handled) {
        this.closeMenu();
        doc.getElementById('btn-editor-phone-menu')?.focus({ preventScroll: true });
        detail.handled = true;
      }
    });
  }

  sync(): void {
    const shouldBeActive = this.doc.body.dataset.appMode === 'editor' && this.doc.body.dataset.deviceClass === 'phone';
    if (shouldBeActive !== this.active) {
      this.active = shouldBeActive;
      this.menuOpen = false;
      if (this.active) this.activate();
      else this.restore();
      this.resize();
    }
    if (this.active) this.render();
  }

  expand(): void { if (this.active) { this.closeInspector(); this.setCollapsed(false); } }
  collapse(): void { if (this.active) this.setCollapsed(true); }

  private closeInspector(): void {
    if (this.doc.body.dataset.editorPhoneInspector === 'true' || this.doc.body.dataset.editorPhoneLinking === 'true') {
      this.doc.getElementById('btn-editor-inspector-done')?.click();
    }
  }

  private move(element: HTMLElement | null, target: HTMLElement | null, before?: HTMLElement | null): void {
    if (!element || !target) return;
    const home = this.doc.createComment('phone dock control home');
    element.before(home);
    this.moved.push({ element, home });
    target.insertBefore(element, before ?? null);
  }

  private activate(): void {
    this.collapsed = false;
    this.doc.body.dataset.editorPhoneDock = 'true';
    const bar = this.doc.getElementById('editor-shell-phone-bar');
    const menuButton = this.doc.getElementById('btn-editor-phone-menu');
    for (const action of ['undo', 'redo']) this.move(this.doc.querySelector(`.editor-shell-tools [data-editor-history="${action}"]`), bar, menuButton);
    for (const action of ['test', 'publish']) this.move(this.doc.querySelector(`[data-editor-shell-action="${action}"]`), bar, menuButton);
    this.move(this.doc.getElementById('btn-mobile-editor-toggle'), bar);
    this.doc.getElementById('btn-mobile-editor-toggle')?.classList.add('editor-shell-chunky-button');
    const menu = this.doc.getElementById('editor-phone-menu');
    this.move(this.doc.getElementById('room-title-section'), menu);
    for (const action of ['room', 'share', 'save', 'back']) this.move(this.doc.querySelector(`[data-editor-shell-action="${action}"]`), menu);
    this.move(this.doc.querySelector('.editor-shell-tools'), this.doc.getElementById('editor-phone-tools'));
    for (const id of ['editor-shell-pencil-picker', 'editor-shell-eraser-size-picker', 'editor-shell-randomize-picker']) {
      this.move(this.doc.getElementById(id), this.doc.getElementById('editor-phone-tools'));
    }
  }

  private restore(): void {
    for (const { element, home } of this.moved.reverse()) home.replaceWith(element);
    this.moved.length = 0;
    this.doc.getElementById('btn-mobile-editor-toggle')?.classList.remove('editor-shell-chunky-button');
    this.doc.getElementById('btn-mobile-editor-toggle')?.setAttribute('aria-label', 'Hide editor panels');
    delete this.doc.body.dataset.editorPhoneDock;
    this.doc.body.dataset.mobileEditorCollapsed = 'false';
    this.doc.getElementById('editor-phone-menu')?.classList.add('hidden');
    this.doc.getElementById('editor-phone-menu')?.setAttribute('aria-hidden', 'true');
  }

  private setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    this.menuOpen = false;
    this.render();
    this.resize();
  }

  private closeMenu(): void {
    this.menuOpen = false;
    this.render();
  }

  private render(): void {
    if (!this.active) return;
    const locked = this.doc.body.dataset.editorMusicMode === 'true' || this.doc.body.dataset.editorMusicUiLocked === 'true'
      || this.doc.body.dataset.editorSpriteUiLocked === 'true';
    const inspecting = this.doc.body.dataset.editorPhoneInspector === 'true' || this.doc.body.dataset.editorPhoneLinking === 'true';
    const placingSpawn = this.doc.body.dataset.editorSpawnPlacement === 'true';
    this.doc.body.dataset.mobileEditorCollapsed = this.collapsed ? 'true' : 'false';
    delete this.doc.body.dataset.mobileEditorSheet;
    const sidebar = this.doc.getElementById('sidebar');
    sidebar?.setAttribute('aria-hidden', this.collapsed || locked ? 'true' : 'false');
    const toggle = this.doc.getElementById('btn-mobile-editor-toggle') as HTMLButtonElement | null;
    if (toggle) {
      toggle.textContent = inspecting ? 'Done' : placingSpawn ? 'Cancel' : this.collapsed ? 'Show' : 'Hide';
      toggle.setAttribute('aria-label', inspecting ? 'Close object settings' : placingSpawn ? 'Cancel spawn placement' : this.collapsed ? 'Show editor library' : 'Hide editor library');
      toggle.setAttribute('aria-expanded', this.collapsed ? 'false' : 'true');
      toggle.setAttribute('aria-controls', 'sidebar');
      toggle.disabled = locked;
    }
    const button = this.doc.getElementById('btn-editor-phone-menu') as HTMLButtonElement | null;
    if (button) { button.setAttribute('aria-expanded', this.menuOpen ? 'true' : 'false'); button.disabled = locked; }
    const menu = this.doc.getElementById('editor-phone-menu');
    menu?.classList.toggle('hidden', !this.menuOpen || locked);
    menu?.setAttribute('aria-hidden', this.menuOpen && !locked ? 'false' : 'true');
  }

  private resize(): void {
    this.doc.defaultView?.requestAnimationFrame(() => {
      this.doc.defaultView?.dispatchEvent(new Event(EDITOR_SIDEBAR_RESIZED_EVENT));
      this.doc.defaultView?.dispatchEvent(new Event('resize'));
    });
  }
}

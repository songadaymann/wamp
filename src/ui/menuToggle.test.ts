import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const dialogs = vi.hoisted(() => ({ modal: false, pending: false }));
vi.mock('./modalState', () => ({ hasBlockingModalOpen: () => dialogs.modal }));
vi.mock('./pendingDialog', () => ({ hasPendingDialog: () => dialogs.pending }));
import { installMenuToggle } from './menuToggle';

const observers: Array<() => void> = [];
class Observer { constructor(callback: () => void) { observers.push(callback); } observe() {} disconnect() {} }
const flush = () => { for (const callback of observers) callback(); };
class Node extends EventTarget {
  classes = new Set<string>(); attributes = new Map<string, string>(); inside: Node[] = [];
  classList = { contains: (c: string) => this.classes.has(c), remove: (c: string) => this.classes.delete(c),
    toggle: (c: string) => { if (this.classes.has(c)) this.classes.delete(c); else this.classes.add(c); } };
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  contains(node: unknown): boolean { return node === this || this.inside.some(child => child.contains(node)); }
  focus() { doc.activeElement = this; }
  blur() { if (doc.activeElement === this) doc.activeElement = doc.body; }
}
const doc = Object.assign(new EventTarget(), {
  body: new Node(), activeElement: null as Node | null, walletWindowOpen: false,
  querySelector: (selector: string) => selector.includes('w3m-modal.open') && doc.walletWindowOpen ? new Node() : null,
});
function fixture() {
  const panel = new Node(), toggle = new Node(), menu = new Node(), field = new Node(), game = new Node(), canvas = new Node(), outside = new Node();
  menu.inside.push(field); panel.inside.push(toggle, menu); game.inside.push(canvas);
  const dispose = installMenuToggle({ panel, toggle, game } as never, doc as unknown as Document);
  const later = vi.fn();
  doc.addEventListener('keydown', later);
  disposers.push(dispose, () => doc.removeEventListener('keydown', later));
  return { panel, toggle, field, canvas, outside, later, open: () => panel.classes.has('menu-open') };
}
function clickOn(target: Node) {
  const event = new Event('click');
  Object.defineProperty(event, 'target', { value: target });
  doc.dispatchEvent(event);
}
// A click from Enter or Space reports no click count; a mouse click reports 1.
const clickToggle = (toggle: Node, detail: number) => toggle.dispatchEvent(Object.assign(new Event('click'), { detail }));
function key(type: 'keydown' | 'keyup', repeat = false) {
  const event = Object.assign(new Event(type, { cancelable: true }), { key: 'Escape', isComposing: false, repeat });
  doc.dispatchEvent(event);
  return event;
}
const escape = (repeat = false) => key('keydown', repeat);
const disposers: Array<() => void> = [];
beforeEach(() => { vi.stubGlobal('MutationObserver', Observer); doc.activeElement = doc.body; });
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  observers.length = 0; dialogs.modal = false; dialogs.pending = false; doc.walletWindowOpen = false;
  vi.unstubAllGlobals();
});

describe('main menu button (F478)', () => {
  it('reports the open state, whichever code path opens or closes the menu', () => {
    const f = fixture();
    expect(f.toggle.getAttribute('aria-expanded')).toBe('false');
    clickToggle(f.toggle, 1);
    flush();
    expect(f.open()).toBe(true);
    expect(f.toggle.getAttribute('aria-expanded')).toBe('true');
    f.panel.classList.remove('menu-open');
    flush();
    expect(f.toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on a click outside the panel but not inside it', () => {
    const f = fixture();
    f.panel.classes.add('menu-open');
    clickOn(f.field);
    expect(f.open()).toBe(true);
    clickOn(f.outside);
    expect(f.open()).toBe(false);
  });

  it('spends Escape on closing the menu and lets the next Escape through', () => {
    const f = fixture();
    clickToggle(f.toggle, 1);
    const first = escape();
    expect(f.open()).toBe(false);
    expect(first.defaultPrevented).toBe(true);
    expect(f.later).not.toHaveBeenCalled();
    const second = escape();
    expect(second.defaultPrevented).toBe(false);
    expect(f.later).toHaveBeenCalledOnce();
  });

  it('hands focus back to the page after a mouse or sign-in opening, and to the button after a keyboard one', () => {
    const f = fixture();
    f.toggle.focus(); clickToggle(f.toggle, 1);
    escape();
    expect(doc.activeElement).toBe(doc.body);

    f.panel.classes.add('menu-open'); flush(); f.field.focus(); // promptForSignIn focuses the email field
    escape();
    expect(doc.activeElement).toBe(doc.body);

    f.toggle.focus(); clickToggle(f.toggle, 0); f.field.focus();
    escape();
    expect(f.open()).toBe(false);
    expect(doc.activeElement).toBe(f.toggle);
  });

  it('closes from the game canvas and leaves focus there', () => {
    const f = fixture();
    f.panel.classes.add('menu-open');
    f.canvas.focus();
    expect(escape().defaultPrevented).toBe(true);
    expect(f.open()).toBe(false);
    expect(doc.activeElement).toBe(f.canvas);
  });

  it('leaves Escape to the wallet window, a dialog, a pending pop-up, or whatever outside the panel has focus', () => {
    const f = fixture();
    f.panel.classes.add('menu-open');
    doc.walletWindowOpen = true;
    expect(escape().defaultPrevented).toBe(false);
    doc.walletWindowOpen = false; f.outside.focus();
    expect(escape().defaultPrevented).toBe(false);
    f.field.focus(); dialogs.modal = true;
    expect(escape().defaultPrevented).toBe(false);
    dialogs.modal = false; dialogs.pending = true;
    expect(escape().defaultPrevented).toBe(false);
    expect(f.open()).toBe(true);
    expect(f.later).toHaveBeenCalledTimes(4);
  });

  it('keeps the repeats of a held Escape it used from reaching the editor or the game', () => {
    const f = fixture();
    f.panel.classes.add('menu-open');
    escape();
    expect(escape(true).defaultPrevented).toBe(true);
    expect(escape(true).defaultPrevented).toBe(true);
    expect(f.later).not.toHaveBeenCalled();
    key('keyup');
    expect(escape().defaultPrevented).toBe(false);
    expect(escape(true).defaultPrevented).toBe(false);
    expect(f.later).toHaveBeenCalledTimes(2);
  });
});

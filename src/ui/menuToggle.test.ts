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
}
const doc = Object.assign(new EventTarget(), { activeElement: null as Node | null });
function fixture() {
  const panel = new Node(), toggle = new Node(), menu = new Node(), field = new Node(), game = new Node();
  menu.inside.push(field); panel.inside.push(toggle, menu);
  const dispose = installMenuToggle(panel as never, toggle as never, menu as never, doc as unknown as Document);
  const later = vi.fn();
  doc.addEventListener('keydown', later);
  return { panel, toggle, field, game, later, dispose, open: () => panel.classes.has('menu-open') };
}
function clickOn(target: Node) {
  const event = new Event('click');
  Object.defineProperty(event, 'target', { value: target });
  doc.dispatchEvent(event);
}
function escape() {
  const event = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape', isComposing: false });
  doc.dispatchEvent(event);
  return event;
}
const disposers: Array<() => void> = [];
beforeEach(() => { vi.stubGlobal('MutationObserver', Observer); });
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  observers.length = 0; dialogs.modal = false; dialogs.pending = false; doc.activeElement = null;
  vi.unstubAllGlobals();
});
const setup = () => { const f = fixture(); disposers.push(f.dispose, () => doc.removeEventListener('keydown', f.later)); return f; };

describe('main menu button (F478)', () => {
  it('reports the open state, whichever code path opens or closes the menu', () => {
    const f = setup();
    expect(f.toggle.getAttribute('aria-expanded')).toBe('false');
    f.toggle.dispatchEvent(new Event('click'));
    flush();
    expect(f.open()).toBe(true);
    expect(f.toggle.getAttribute('aria-expanded')).toBe('true');
    f.panel.classList.remove('menu-open');
    flush();
    expect(f.toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on a click outside the panel but not inside it', () => {
    const f = setup();
    f.panel.classes.add('menu-open');
    clickOn(f.field);
    expect(f.open()).toBe(true);
    clickOn(f.game);
    expect(f.open()).toBe(false);
  });

  it('spends Escape on closing the menu, returns focus to the button, and lets the next Escape through', () => {
    const f = setup();
    f.panel.classes.add('menu-open');
    f.field.focus();
    const first = escape();
    expect(f.open()).toBe(false);
    expect(first.defaultPrevented).toBe(true);
    expect(f.later).not.toHaveBeenCalled();
    expect(doc.activeElement).toBe(f.toggle);
    const second = escape();
    expect(second.defaultPrevented).toBe(false);
    expect(f.later).toHaveBeenCalledOnce();
  });

  it('leaves focus on the game when it was never in the menu', () => {
    const f = setup();
    f.panel.classes.add('menu-open');
    f.game.focus();
    escape();
    expect(f.open()).toBe(false);
    expect(doc.activeElement).toBe(f.game);
  });

  it('lets a dialog over the menu keep its own Escape', () => {
    const f = setup();
    f.panel.classes.add('menu-open');
    dialogs.modal = true;
    expect(escape().defaultPrevented).toBe(false);
    dialogs.modal = false; dialogs.pending = true;
    expect(escape().defaultPrevented).toBe(false);
    expect(f.open()).toBe(true);
    expect(f.later).toHaveBeenCalledTimes(2);
  });
});

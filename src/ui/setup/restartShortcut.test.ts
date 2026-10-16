import { afterEach, describe, expect, it, vi } from 'vitest';
const focus = vi.hoisted(() => ({ yielded: false }));
vi.mock('../keyboardFocus', () => ({ isGameKeyboardYielded: () => focus.yielded,
  isTextInputElement: (element: { textInput?: boolean }) => Boolean(element?.textInput) }));
import { installRestartShortcut } from './restartShortcut';

class Element { textInput = false; }
class Key extends Event {
  key = 'r'; repeat = false; ctrlKey = false; metaKey = false; altKey = false;
  constructor(changes: Partial<Key> = {}) { super('keydown', { cancelable: true }); Object.assign(this, changes); }
}
function harness() {
  vi.stubGlobal('Element', Element); focus.yielded = false;
  let menuOpen = false;
  const doc = Object.assign(new EventTarget(), { body: { dataset: { appMode: 'play-world' } },
    getElementById: () => ({ classList: { contains: () => menuOpen } }) });
  const restart = vi.fn(); const dispose = installRestartShortcut(restart, doc as unknown as Document);
  const key = (changes: Partial<Key> = {}) => { const event = new Key(changes); doc.dispatchEvent(event); return event; };
  return { doc, restart, dispose, key, openMenu: () => { menuOpen = true; } };
}
afterEach(() => vi.unstubAllGlobals());
describe('R quick restart', () => {
  it('restarts on R only during play and releases its listener on teardown', () => {
    const h = harness(); expect(h.key().defaultPrevented).toBe(true); expect(h.restart).toHaveBeenCalledOnce();
    h.dispose(); h.key(); expect(h.restart).toHaveBeenCalledOnce();
  });
  it('accepts uppercase R without changing other keys', () => {
    const h = harness(); h.key({ key: 'R' }); expect(h.restart).toHaveBeenCalledOnce();
    expect(h.key({ key: 'q' }).defaultPrevented).toBe(false); expect(h.restart).toHaveBeenCalledOnce();
  });
  it.each([{ repeat: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }])('leaves repeated or browser shortcuts alone: %j', changes => {
    const h = harness(); expect(h.key(changes).defaultPrevented).toBe(false); expect(h.restart).not.toHaveBeenCalled();
  });
  it.each(['world', 'editor', 'course-editor'])('does not restart outside play (%s)', mode => {
    const h = harness(); h.doc.body.dataset.appMode = mode; h.key(); expect(h.restart).not.toHaveBeenCalled();
  });
  it('does not restart while a dialog, text field or native form control owns focus', () => {
    const h = harness(); focus.yielded = true; expect(h.key().defaultPrevented).toBe(false); expect(h.restart).not.toHaveBeenCalled();
  });
  it('does not restart behind the open menu drawer', () => {
    const h = harness(); h.openMenu(); h.key(); expect(h.restart).not.toHaveBeenCalled();
  });
  it('respects a keyboard event already handled by another UI control', () => {
    const h = harness(); const event = new Key(); event.preventDefault(); h.doc.dispatchEvent(event); expect(h.restart).not.toHaveBeenCalled();
  });
  it('does not consume an event originating from an editable target', () => {
    const h = harness(), target = new Element(); target.textInput = true;
    const event = new Key(); Object.defineProperty(event, 'target', { value: target }); h.doc.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false); expect(h.restart).not.toHaveBeenCalled();
  });
});

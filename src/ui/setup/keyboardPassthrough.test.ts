import { afterEach, expect, it, vi } from 'vitest';
const sync = vi.hoisted(() => vi.fn());
vi.mock('../keyboardFocus', () => ({ syncGameKeyboardFocus: sync }));
import { setupKeyboardShortcutPassthrough } from './keyboardPassthrough';
afterEach(() => { vi.unstubAllGlobals(); sync.mockClear(); });
it('clicking the game releases a menu/form focus even when Phaser cancels the native focus change', () => {
  class Element { blur = vi.fn(); getAttributeNames(): string[] { return []; } tagName = 'BUTTON'; childNodes: unknown[] = []; }
  vi.stubGlobal('HTMLElement', Element);
  const canvas = new Element(), focused = new Element();
  const doc = Object.assign(new EventTarget(), { activeElement: focused, getElementById: () => null });
  const game = { canvas }; setupKeyboardShortcutPassthrough(game as never, doc as unknown as Document);
  // A different canvas/control keeps its focus. Only the actual game receives keyboard ownership.
  const other = new Event('pointerdown', { cancelable: true }); Object.defineProperty(other, 'target', { value: new Element() });
  doc.dispatchEvent(other); expect(focused.blur).not.toHaveBeenCalled(); expect(sync).not.toHaveBeenCalled();
  const pointer = new Event('pointerdown', { cancelable: true }); Object.defineProperty(pointer, 'target', { value: canvas });
  doc.addEventListener('pointerdown', e => { e.preventDefault(); expect(focused.blur).toHaveBeenCalledOnce(); });
  doc.dispatchEvent(pointer); expect(pointer.defaultPrevented).toBe(true); expect(sync.mock.calls.length).toBe(1); expect(sync.mock.calls[0]?.[0] === game).toBe(true);
});

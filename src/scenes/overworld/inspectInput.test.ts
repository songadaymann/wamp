import { afterEach, describe, expect, it, vi } from 'vitest';
import { OverworldInspectInputController } from './inspectInput';
import { installMenuToggle } from '../../ui/menuToggle';
import { isGameKeyboardYielded } from '../../ui/keyboardFocus';

vi.mock('phaser', () => ({ default: { Math: { Distance: { Between: vi.fn(() => 100) } } } }));
vi.mock('../../ui/deviceLayout', () => ({ getDeviceLayoutState: () => ({ coarsePointer: false }) }));
vi.mock('../../settings/userSettings', () => ({ getGameSettings: () => ({ panningStyle: 'option-drag' }) }));
const modal = vi.hoisted(() => ({ open: false }));
vi.mock('../../ui/modalState', () => ({ hasBlockingModalOpen: () => modal.open, isInWalletWindow: () => false }));

describe('overworld fit shortcut', () => {
  it('uses 0 instead of F and removes the listener on destroy', () => {
    const keyboard = { on: vi.fn(), off: vi.fn() };
    const input = { keyboard, on: vi.fn(), off: vi.fn() };
    const scene = { input, game: { events: { on: vi.fn(), off: vi.fn() } }, cameras: { main: { scrollX: 0, scrollY: 0 } } };
    const fitLoadedWorld = vi.fn();
    const controller = new OverworldInspectInputController(scene as never, {
      getMode: () => 'browse',
      getCameraMode: () => 'inspect',
      setCameraMode: vi.fn(),
      applyCameraMode: vi.fn(),
      fitLoadedWorld,
      closeComposerForEscape: () => false,
      stopCurrentPlay: vi.fn(),
      adjustZoomByFactor: vi.fn(),
      constrainInspectCamera: vi.fn(),
      getRoomCoordinatesForPoint: () => ({ x: 0, y: 0 }),
      isWithinLoadedRoomBounds: () => true,
      onSelectCoordinates: vi.fn(),
      syncBrowseWindowToCamera: vi.fn(),
    });

    controller.initialize();
    const fitListener = keyboard.on.mock.calls.find(([event]) => event === 'keydown-ZERO')?.[1];
    expect(fitListener).toBeTypeOf('function');
    expect(keyboard.on).not.toHaveBeenCalledWith('keydown-F', expect.any(Function));
    fitListener();
    expect(fitLoadedWorld).toHaveBeenCalledOnce();

    controller.destroy();
    expect(keyboard.off).toHaveBeenCalledWith('keydown-ZERO', fitListener);
  });
});

type Handler = (...args: unknown[]) => void;
function harness(mode: 'browse' | 'play' = 'browse') {
  const handlers = new Map<string, Handler>();
  const register = (prefix: string) => ({ on: vi.fn((event: string, fn: Handler) => handlers.set(prefix + event, fn)), off: vi.fn() });
  const camera = { scrollX: 0, scrollY: 0, zoom: 1, setScroll: vi.fn(), getWorldPoint: (x: number, y: number) => ({ x, y }) };
  const activePointer = mouse({ isDown: false });
  const scene = { input: { ...register('input:'), keyboard: register('key:'), activePointer }, game: { events: register('game:') }, cameras: { main: camera } };
  const host = {
    getMode: () => mode, getCameraMode: () => 'inspect' as const, setCameraMode: vi.fn(), applyCameraMode: vi.fn(),
    fitLoadedWorld: vi.fn(), closeComposerForEscape: vi.fn(() => false), stopCurrentPlay: vi.fn(),
    adjustZoomByFactor: vi.fn(), constrainInspectCamera: vi.fn(),
    getRoomCoordinatesForPoint: () => ({ x: 3, y: 4 }), isWithinLoadedRoomBounds: () => true,
    onSelectCoordinates: vi.fn(), syncBrowseWindowToCamera: vi.fn(),
  };
  new OverworldInspectInputController(scene as never, host).initialize();
  const fire = (name: string, ...args: unknown[]) => handlers.get(name)!(...args);
  return { fire, camera, host, scene, handlers };
}
function mouse(overrides: { isDown?: boolean; buttons?: number; altKey?: boolean; middle?: boolean; x?: number } = {}) {
  return { id: 1, x: overrides.x ?? 100, y: 100, wasTouch: false, isDown: overrides.isDown ?? true,
    event: { buttons: overrides.buttons ?? 4, altKey: overrides.altKey ?? false }, middleButtonDown: () => overrides.middle ?? false };
}

describe('map panning after a release the canvas never saw (F054)', () => {
  it('stops panning when the button is released over a panel', () => {
    const h = harness();
    h.fire('input:pointerdown', mouse({ middle: true }));
    h.fire('input:pointermove', mouse({ middle: true, x: 200 }));
    expect(h.camera.setScroll).toHaveBeenCalledTimes(1);
    h.fire('input:pointerupoutside', mouse({ isDown: false, buttons: 0 }));
    expect(h.host.syncBrowseWindowToCamera).toHaveBeenCalledOnce();
    h.fire('input:pointermove', mouse({ isDown: false, buttons: 0, x: 300 }));
    expect(h.camera.setScroll).toHaveBeenCalledTimes(1);
  });

  it('treats a move with no buttons held as the release when none arrived', () => {
    const h = harness();
    h.fire('input:pointerdown', mouse({ middle: true }));
    h.fire('input:pointermove', mouse({ buttons: 0, x: 200 }));
    h.fire('input:pointermove', mouse({ buttons: 0, x: 300 }));
    expect(h.camera.setScroll).not.toHaveBeenCalled();
    expect(h.host.syncBrowseWindowToCamera).toHaveBeenCalledOnce();
  });
});

describe('pan keys after focus leaves the game (F059)', () => {
  it('reads Alt from the click, so an Alt-Tab cannot leave it held', () => {
    const h = harness();
    expect(h.handlers.has('key:keydown-ALT')).toBe(false);
    h.fire('input:pointerdown', mouse({ buttons: 1 }));
    expect(h.host.onSelectCoordinates).toHaveBeenCalled();
    h.fire('input:pointerup', mouse({ isDown: false, buttons: 0 }));
    h.fire('input:pointerdown', mouse({ buttons: 1, altKey: true }));
    h.fire('input:pointermove', mouse({ buttons: 1, altKey: true, x: 200 }));
    expect(h.camera.setScroll).toHaveBeenCalledTimes(1);
  });

  it('forgets a held Space and ends a pan when the window loses focus', () => {
    const h = harness();
    h.fire('key:keydown-SPACE');
    h.scene.input.activePointer.isDown = true;
    h.fire('input:pointerdown', mouse({ buttons: 1 }));
    expect(h.host.onSelectCoordinates).not.toHaveBeenCalled();
    h.fire('game:blur');
    expect(h.host.syncBrowseWindowToCamera).toHaveBeenCalledOnce();
    h.fire('input:pointerdown', mouse({ buttons: 1 }));
    expect(h.host.onSelectCoordinates).toHaveBeenCalled();
  });
});

describe('one ordered Escape (F378, F385)', () => {
  const escape = (changes: Partial<KeyboardEvent> = {}) => ({ repeat: false, ctrlKey: false, metaKey: false, altKey: false, ...changes });
  const menu = { open: false };
  const stubMenu = () => vi.stubGlobal('document', {
    getElementById: (id: string) => id === 'auth-panel' ? { classList: { contains: (name: string) => name === 'menu-open' && menu.open } } : null,
  });
  afterEach(() => { vi.unstubAllGlobals(); menu.open = false; });

  it('stops play through the shared stop path, which ends a Room Rush with its result', () => {
    stubMenu();
    const h = harness('play');
    h.fire('key:keydown-ESC', escape());
    expect(h.host.closeComposerForEscape).toHaveBeenCalledOnce();
    expect(h.host.stopCurrentPlay).toHaveBeenCalledOnce();
  });

  it('spends the key on a blurred composer and never also ends the run', () => {
    stubMenu();
    const h = harness('play');
    h.host.closeComposerForEscape.mockReturnValueOnce(true);
    h.fire('key:keydown-ESC', escape());
    expect(h.host.stopCurrentPlay).not.toHaveBeenCalled();
    h.fire('key:keydown-ESC', escape());
    expect(h.host.stopCurrentPlay).toHaveBeenCalledOnce();
  });

  it('still closes a composer in browse, and leaves play alone behind a dialog or a held key', () => {
    stubMenu();
    const browse = harness();
    browse.host.closeComposerForEscape.mockReturnValueOnce(true);
    browse.fire('key:keydown-ESC', escape());
    browse.fire('key:keydown-ESC', escape());
    expect(browse.host.closeComposerForEscape).toHaveBeenCalledTimes(2);
    expect(browse.host.stopCurrentPlay).not.toHaveBeenCalled();

    const play = harness('play');
    play.fire('key:keydown-ESC', escape({ repeat: true }));
    play.fire('key:keydown-ESC', escape({ metaKey: true }));
    modal.open = true;
    try { play.fire('key:keydown-ESC', escape()); } finally { modal.open = false; }
    expect(play.host.stopCurrentPlay).not.toHaveBeenCalled();
  });

  it('leaves play alone while the game menu is open, as P and the gamepad do', () => {
    stubMenu();
    const h = harness('play');
    menu.open = true;
    h.fire('key:keydown-ESC', escape());
    expect(h.host.stopCurrentPlay).not.toHaveBeenCalled();
    menu.open = false;
    h.fire('key:keydown-ESC', escape());
    expect(h.host.stopCurrentPlay).toHaveBeenCalledOnce();
  });

  // The page as the game's keyboard sees it: a button focused during a key press, or reached with
  // Tab, matches :focus-visible, and then isGameKeyboardYielded() hands the keys to that button.
  function menuPage() {
    class El extends EventTarget {
      classes = new Set<string>(); inside: El[] = []; focusVisible = false; isContentEditable = false;
      constructor(readonly isButton = false) { super(); }
      classList = { contains: (c: string) => this.classes.has(c), remove: (c: string) => this.classes.delete(c),
        toggle: (c: string) => { if (this.classes.has(c)) this.classes.delete(c); else this.classes.add(c); } };
      contains(node: unknown): boolean { return node === this || this.inside.some(child => child.contains(node)); }
      getAttribute() { return null; } setAttribute() {}
      matches(selector: string) { return selector === ':focus-visible' ? this.focusVisible : this.isButton && selector.includes('button'); }
      focus() { page.activeElement = this; this.focusVisible = page.keyPressing || this.focusVisible; }
      blur() { if (page.activeElement === this) { page.activeElement = page.body; this.focusVisible = false; } }
    }
    vi.stubGlobal('HTMLElement', El);
    for (const name of ['HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement']) vi.stubGlobal(name, class {});
    vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} });
    const panel = new El(), toggle = new El(true), emailField = new El();
    panel.inside.push(toggle, emailField);
    const page = Object.assign(new EventTarget(), { body: new El(), activeElement: null as El | null, keyPressing: false,
      getElementById: (id: string) => id === 'auth-panel' ? panel : null, querySelector: () => null });
    page.activeElement = page.body;
    vi.stubGlobal('document', page);
    const dispose = installMenuToggle({ panel, toggle, game: null } as never, page as unknown as Document);
    const h = harness('play');
    // Phaser hears keys after the page, skips handled ones, and gets none while the page holds them.
    page.addEventListener('keydown', (event) => {
      if (!event.defaultPrevented && !isGameKeyboardYielded(page as unknown as Document)) h.fire('key:keydown-ESC', event);
    });
    const press = () => {
      page.keyPressing = true;
      page.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape', isComposing: false, ...escape() }));
      page.keyPressing = false;
    };
    const clickToggle = (detail: number) => toggle.dispatchEvent(Object.assign(new Event('click'), { detail }));
    return { panel, toggle, emailField, page, h, press, clickToggle, dispose, open: () => panel.classes.has('menu-open') };
  }

  it('lets the menu spend the Escape that closes it, so the next Escape stops play (F478)', () => {
    const m = menuPage();
    m.toggle.focus(); m.clickToggle(1); // a mouse click focuses the button without a focus ring
    m.press();
    expect(m.open()).toBe(false);
    expect(m.h.host.stopCurrentPlay).not.toHaveBeenCalled();
    expect(m.page.activeElement).toBe(m.page.body);
    m.press();
    expect(m.h.host.stopCurrentPlay).toHaveBeenCalledOnce();
    m.dispose();
  });

  it('gives the game its keys back after Escape closes the menu sign-in opened (F478)', () => {
    const m = menuPage();
    m.panel.classes.add('menu-open'); m.emailField.focus(); // promptForSignIn() after a run
    m.press();
    expect(m.open()).toBe(false);
    expect(isGameKeyboardYielded(m.page as unknown as Document)).toBe(false);
    m.press();
    expect(m.h.host.stopCurrentPlay).toHaveBeenCalledOnce();
    m.dispose();
  });

  it('returns a keyboard player to the menu button, which keeps the keys as any tabbed-to button does (F478)', () => {
    const m = menuPage();
    m.toggle.focusVisible = true; m.toggle.focus(); m.clickToggle(0); // Tab, then Enter
    m.press();
    expect(m.open()).toBe(false);
    expect(m.page.activeElement).toBe(m.toggle);
    m.press();
    expect(m.h.host.stopCurrentPlay).not.toHaveBeenCalled();
    m.dispose();
  });
});

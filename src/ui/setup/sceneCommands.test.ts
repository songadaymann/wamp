import { afterEach, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({ scene: null as Record<string, unknown> | null }));
vi.mock('phaser', () => ({ default: {} }));
vi.mock('../keyboardFocus', () => ({ isGameKeyboardYielded: () => false, isTextInputElement: () => false }));
vi.mock('./gameMenu', () => ({ setupGameMenu: vi.fn() }));
vi.mock('./roomSharing', () => ({ RoomSharingController: class {} }));
vi.mock('./settingsModal', () => ({ SettingsModalController: class {} }));
vi.mock('./welcomeModal', () => ({ REQUEST_BUILDER_MODE_EVENT: 'request-builder-mode' }));
vi.mock('../../scenes/overworld/hud', () => ({ configureOverworldHudBridgeRuntime: vi.fn() }));
vi.mock('../../reports/requestReport', () => ({ requestReport: vi.fn() }));
vi.mock('./sceneBridge', () => ({
  getActiveOverworldScene: () => bridge.scene,
  getOverworldScene: () => bridge.scene,
  getActiveCourseWorkspaceScene: () => null,
}));

import { setupSceneCommands } from './sceneCommands';
import { configureOverworldHudBridgeRuntime } from '../../scenes/overworld/hud';

class Key extends Event {
  code = 'KeyP'; key = 'p'; repeat = false; ctrlKey = false; metaKey = false; altKey = false;
  constructor(changes: Partial<Key> = {}) { super('keydown', { cancelable: true }); Object.assign(this, changes); }
}

afterEach(() => { vi.unstubAllGlobals(); bridge.scene = null; });

function setup() {
  const modal = { open: vi.fn(), close: vi.fn() };
  const doc = Object.assign(new EventTarget(), {
    body: { dataset: { appMode: 'play-world' } }, defaultView: {}, getElementById: () => null,
  });
  setupSceneCommands({} as never, modal, modal, modal, modal, modal as never, modal, modal, modal, modal, modal,
    doc as unknown as Document);
  return doc;
}

describe('keyboard stop shortcut (F378)', () => {
  it('stops through the shared stop path, so P ends a Room Rush with its result', () => {
    vi.stubGlobal('Element', class {});
    const stopCurrentPlay = vi.fn(), returnToWorld = vi.fn();
    bridge.scene = { stopCurrentPlay, returnToWorld };
    const doc = setup();

    const event = new Key();
    doc.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(stopCurrentPlay).toHaveBeenCalledOnce();
    expect(returnToWorld).not.toHaveBeenCalled();
  });
});

describe('HUD jump command (F383)', () => {
  it('hands the jump result back, so Join can stop when a Room Rush result took the jump', async () => {
    bridge.scene = { jumpToCoordinates: vi.fn(async () => false) };
    setup();
    const config = vi.mocked(configureOverworldHudBridgeRuntime).mock.lastCall![0];
    await expect(config.onJumpToCoordinates!({ x: 3, y: 1 })).resolves.toBe(false);
  });
});

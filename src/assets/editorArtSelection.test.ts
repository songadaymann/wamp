import { EventEmitter } from 'node:events';
import type Phaser from 'phaser';
import { afterEach, expect, it, vi } from 'vitest';
import { createDefaultEditorState, updateEditorState } from '../config/editorState';
import { refreshEditorUi } from '../scenes/editor/uiEvents';
import { bindEditorArtSelection } from './editorArtSelection';
import { ensureSceneObjectTexturesLoaded } from './sceneArt';
vi.mock('./sceneArt', () => ({ ensureSceneObjectTexturesLoaded: vi.fn().mockResolvedValue(undefined) }));
const tick = () => new Promise<void>(resolve => queueMicrotask(resolve));
const scenes: EventEmitter[] = [];
function fixture() {
  const events = new EventEmitter(), target = new EventTarget() as Window;
  const active = { value: true };
  const scene = { game: { canvas: { ownerDocument: { defaultView: target } } }, events,
    scene: { isActive: () => active.value } } as unknown as Phaser.Scene;
  scenes.push(events); return { scene, events, active, target };
}
afterEach(async () => {
  for (const events of scenes.splice(0)) events.emit('destroy');
  updateEditorState(createDefaultEditorState()); await tick(); vi.clearAllMocks();
});
it('preloads a new decoration from the state command, without a manual UI event', async () => {
  const f = fixture(); bindEditorArtSelection(f.scene);
  updateEditorState({ selectedObjectId: 'tree_pack_weeping_willow_02' }); await tick();
  expect(ensureSceneObjectTexturesLoaded).toHaveBeenCalledExactlyOnceWith(f.scene, ['tree_pack_weeping_willow_02']);
});
it('binds once, ignores unrelated camera updates, removes pending work and can rebind on entry', async () => {
  const f = fixture(); bindEditorArtSelection(f.scene); bindEditorArtSelection(f.scene);
  updateEditorState({ zoom: 3 }); await tick(); expect(ensureSceneObjectTexturesLoaded).not.toHaveBeenCalled();
  updateEditorState({ selectedObjectId: 'rock' }); f.events.emit('shutdown'); await tick();
  expect(ensureSceneObjectTexturesLoaded).not.toHaveBeenCalled();
  expect(f.events.listenerCount('destroy')).toBe(0);
  bindEditorArtSelection(f.scene); expect(ensureSceneObjectTexturesLoaded).toHaveBeenCalledExactlyOnceWith(f.scene, ['rock']);
  f.events.emit('destroy'); updateEditorState({ selectedObjectId: 'coin_gold' }); await tick();
  expect(ensureSceneObjectTexturesLoaded).toHaveBeenCalledOnce();
});
it('does not load for a sleeping scene and still refreshes its selected art on explicit entry', async () => {
  const f = fixture(); f.active.value = false; bindEditorArtSelection(f.scene);
  updateEditorState({ selectedObjectId: 'sign' }); await tick(); expect(ensureSceneObjectTexturesLoaded).not.toHaveBeenCalled();
  f.active.value = true; refreshEditorUi(f.target);
  expect(ensureSceneObjectTexturesLoaded).toHaveBeenCalledExactlyOnceWith(f.scene, ['sign']);
});

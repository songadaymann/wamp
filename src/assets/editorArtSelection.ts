import type Phaser from 'phaser';
import { editorState } from '../config';
import { EDITOR_UI_STATE_CHANGED_EVENT } from '../scenes/editor/uiEvents';
import { ensureSceneObjectTexturesLoaded } from './sceneArt';

const boundScenes = new WeakSet<Phaser.Scene>();

/** Rebound on editor entry, and removed when its scene loader stops. */
export function bindEditorArtSelection(scene: Phaser.Scene): void {
  if (boundScenes.has(scene)) return;
  const windowObject = scene.game.canvas.ownerDocument.defaultView;
  if (!windowObject) return;
  const preload = () => {
    if (!scene.scene.isActive() || !editorState.selectedObjectId) return;
    void ensureSceneObjectTexturesLoaded(scene, [editorState.selectedObjectId])
      .catch(error => console.warn('Failed to load selected decoration art.', error));
  };
  const cleanup = () => {
    windowObject.removeEventListener(EDITOR_UI_STATE_CHANGED_EVENT, preload);
    scene.events.off('shutdown', cleanup);
    scene.events.off('destroy', cleanup);
    boundScenes.delete(scene);
  };
  windowObject.addEventListener(EDITOR_UI_STATE_CHANGED_EVENT, preload);
  scene.events.once('shutdown', cleanup);
  scene.events.once('destroy', cleanup);
  boundScenes.add(scene);
  preload();
}

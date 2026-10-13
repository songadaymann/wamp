import type Phaser from 'phaser';
import { ensureEditorUiReady } from '../ui/setup/editorUiLoader';

let editorSceneRegistration: Promise<void> | null = null;

export function ensureEditorScenesRegistered(game: Phaser.Game): Promise<void> {
  if (editorScenesAreRegistered(game)) return Promise.resolve();
  if (editorSceneRegistration) return editorSceneRegistration;

  editorSceneRegistration = Promise.all([
    import('./EditorScene'),
    import('./CourseComposerScene'),
    import('./CourseEditorScene'),
    import('../roomVideo/sceneHooks'),
    ensureEditorUiReady(game),
  ]).then(([editor, composer, courseEditor, roomVideo]) => {
    roomVideo.installRoomVideoEditorHooks(editor.EditorScene, courseEditor.CourseEditorScene);
    if (!game.scene.keys.EditorScene) game.scene.add('EditorScene', editor.EditorScene, false);
    if (!game.scene.keys.CourseComposerScene) game.scene.add('CourseComposerScene', composer.CourseComposerScene, false);
    if (!game.scene.keys.CourseEditorScene) game.scene.add('CourseEditorScene', courseEditor.CourseEditorScene, false);
  }).catch((error: unknown) => {
    editorSceneRegistration = null;
    throw error;
  });

  return editorSceneRegistration;
}

function editorScenesAreRegistered(game: Phaser.Game): boolean {
  return Boolean(
    game.scene.keys.EditorScene
    && game.scene.keys.CourseComposerScene
    && game.scene.keys.CourseEditorScene,
  );
}

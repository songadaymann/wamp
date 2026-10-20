import type Phaser from 'phaser';
import { subscribeEditorState } from '../../config/editorState';
import { CUSTOM_SPRITES_CHANGED_EVENT } from '../../customSprites/registry';
import { configureEditorUiBridgeRuntime } from '../../scenes/editor/uiBridge';
import { CourseComposerPanelController } from './courseComposerPanel';
import { setupCustomSpriteEditor } from './customSpriteEditor';
import { setupEditorDockShell } from './editorDockShell';
import type { EditorUiHost } from './editorUiLoader';
import { setupRoomMusicControls } from './musicControls';
import { PaletteController } from './paletteController';
import {
  EDITOR_SIDEBAR_RESIZED_EVENT,
  setupCollapsibleSidebarSections,
  setupEditorSidebarShell,
} from './sidebarSections';

/** Sets up the builder-only UI, in the order boot used to (see editorUiLoader). */
export function setupEditorUi(game: Phaser.Game, host: EditorUiHost): void {
  const paletteController = new PaletteController();
  paletteController.init();
  configureEditorUiBridgeRuntime({
    paletteController,
    closePanels: () => host.closePanels(),
    openHistory: () => host.openHistory(),
  });
  setupEditorSidebarShell();
  const dockShell = setupEditorDockShell(paletteController);
  game.events.once('destroy', () => dockShell.destroy());
  setupCollapsibleSidebarSections();
  new CourseComposerPanelController(game).init();
  setupRoomMusicControls(game);
  setupCustomSpriteEditor(game);
  game.events.once('destroy', setupPaletteRefreshListeners(paletteController));
}

function setupPaletteRefreshListeners(paletteController: PaletteController): () => void {
  const refreshPaletteSurfaces = () => {
    paletteController.renderPalette();
    paletteController.renderObjectGrid();
    paletteController.renderTilePreview();
  };

  window.addEventListener(EDITOR_SIDEBAR_RESIZED_EVENT, refreshPaletteSurfaces);
  window.requestAnimationFrame(refreshPaletteSurfaces);

  const stopState = subscribeEditorState(({ keys }) => {
    if (keys.includes('selectedTilesetKey')) paletteController.renderPalette();
    if (keys.some(key => ['selectedObjectId', 'paletteMode', 'objectFacing'].includes(key))) {
      paletteController.renderObjectGrid();
    }
    if (keys.some(key => ['selection', 'selectedTilesetKey', 'selectedObjectId', 'paletteMode', 'tileFlipXMode', 'tileFlipYMode'].includes(key))) {
      paletteController.renderTilePreview();
    }
  });

  const refreshObjects = () => {
    paletteController.renderObjectGrid();
    paletteController.renderTilePreview();
  };
  window.addEventListener(CUSTOM_SPRITES_CHANGED_EVENT, refreshObjects);
  return () => {
    stopState();
    window.removeEventListener(EDITOR_SIDEBAR_RESIZED_EVENT, refreshPaletteSurfaces);
    window.removeEventListener(CUSTOM_SPRITES_CHANGED_EVENT, refreshObjects);
  };
}

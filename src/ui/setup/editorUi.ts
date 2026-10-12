import type Phaser from 'phaser';
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
  setupEditorDockShell(paletteController);
  setupCollapsibleSidebarSections();
  new CourseComposerPanelController(game).init();
  setupRoomMusicControls(game);
  setupCustomSpriteEditor(game);
  setupPaletteRefreshListeners(paletteController);
}

function setupPaletteRefreshListeners(paletteController: PaletteController): void {
  const refreshPaletteSurfaces = () => {
    paletteController.renderPalette();
    paletteController.renderObjectGrid();
    paletteController.renderTilePreview();
  };

  window.addEventListener(EDITOR_SIDEBAR_RESIZED_EVENT, refreshPaletteSurfaces);
  window.requestAnimationFrame(refreshPaletteSurfaces);

  window.addEventListener('tileset-changed', () => {
    paletteController.renderPalette();
  });

  window.addEventListener('tile-selected', () => {
    paletteController.renderTilePreview();
  });

  window.addEventListener(CUSTOM_SPRITES_CHANGED_EVENT, () => {
    paletteController.renderObjectGrid();
    paletteController.renderTilePreview();
  });
}

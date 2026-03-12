import Phaser from 'phaser';
import { ChatPanelController } from './chat/panel';
import { initializeDeviceLayout } from './deviceLayout';
import { MobileUiController } from './mobile/controller';
import { setupButtonFeedback } from './setup/buttonFeedback';
import { ControlsModalController } from './setup/controlsModal';
import { setupEditorControls } from './setup/editorControls';
import { RoomHistoryModalController } from './setup/historyModal';
import { setupKeyboardShortcutPassthrough } from './setup/keyboardPassthrough';
import { LeaderboardModalController } from './setup/leaderboardModal';
import { PaletteController } from './setup/paletteController';
import { setupSceneCommands } from './setup/sceneCommands';

export function setupUI(game: Phaser.Game): void {
  initializeDeviceLayout();
  const paletteController = new PaletteController();
  const historyModal = new RoomHistoryModalController(game);
  const leaderboardModal = new LeaderboardModalController(game);
  const controlsModal = new ControlsModalController();
  const chatPanel = new ChatPanelController();
  const mobileUi = new MobileUiController(game);

  paletteController.init();
  setupEditorControls(game, paletteController);
  historyModal.init();
  leaderboardModal.init();
  controlsModal.init();
  chatPanel.init();
  mobileUi.init();
  setupSceneCommands(game, historyModal, leaderboardModal, controlsModal);
  setupButtonFeedback();
  setupKeyboardShortcutPassthrough();

  window.addEventListener('tileset-changed', () => {
    paletteController.renderPalette();
  });

  window.addEventListener('tile-selected', () => {
    paletteController.renderTilePreview();
  });
}

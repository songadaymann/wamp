import Phaser from 'phaser';
import { ChatPanelController } from './chat/panel';
import { initializeDeviceLayout } from './deviceLayout';
import { MobileUiController } from './mobile/controller';
import { AboutModalController } from './setup/aboutModal';
import { setupButtonFeedback } from './setup/buttonFeedback';
import { ChatModerationModalController } from './setup/chatModerationModal';
import { ControlsModalController } from './setup/controlsModal';
import { CourseModalController } from './setup/courseModal';
import { setupEditorControls } from './setup/editorControls';
import { RoomHistoryModalController } from './setup/historyModal';
import { setupKeyboardShortcutPassthrough } from './setup/keyboardPassthrough';
import { LeaderboardModalController } from './setup/leaderboardModal';
import { InstallHelpController } from './setup/installHelp';
import { PaletteController } from './setup/paletteController';
import { ProfileModalController } from './setup/profileModal';
import { setupCollapsibleSidebarSections } from './setup/sidebarSections';
import { setupSceneCommands } from './setup/sceneCommands';

export function setupUI(game: Phaser.Game): void {
  initializeDeviceLayout();
  const paletteController = new PaletteController();
  const historyModal = new RoomHistoryModalController(game);
  const leaderboardModal = new LeaderboardModalController(game);
  const installHelp = new InstallHelpController();
  const controlsModal = new ControlsModalController();
  const aboutModal = new AboutModalController();
  const chatModerationModal = new ChatModerationModalController();
  const courseModal = new CourseModalController(game);
  const profileModal = new ProfileModalController(game);
  const chatPanel = new ChatPanelController();
  const mobileUi = new MobileUiController(game);

  paletteController.init();
  setupCollapsibleSidebarSections();
  setupEditorControls(game, paletteController);
  historyModal.init();
  leaderboardModal.init();
  installHelp.init();
  controlsModal.init();
  aboutModal.init();
  chatModerationModal.init();
  courseModal.init();
  profileModal.init();
  chatPanel.init();
  mobileUi.init();
  setupSceneCommands(
    game,
    historyModal,
    leaderboardModal,
    controlsModal,
    aboutModal,
    chatModerationModal,
    courseModal
  );
  setupButtonFeedback();
  setupKeyboardShortcutPassthrough();

  window.addEventListener('tileset-changed', () => {
    paletteController.renderPalette();
  });

  window.addEventListener('tile-selected', () => {
    paletteController.renderTilePreview();
  });
}

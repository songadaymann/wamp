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
  paletteController.init();

  const modals = {
    historyModal: new RoomHistoryModalController(game),
    leaderboardModal: new LeaderboardModalController(game),
    controlsModal: new ControlsModalController(),
    aboutModal: new AboutModalController(),
    chatModerationModal: new ChatModerationModalController(),
    courseModal: new CourseModalController(game),
  };
  const installHelp = new InstallHelpController();
  const profileModal = new ProfileModalController(game);
  const chatPanel = new ChatPanelController();
  const mobileUi = new MobileUiController(game);

  setupCollapsibleSidebarSections();
  setupEditorControls(game, paletteController);
  modals.historyModal.init();
  modals.leaderboardModal.init();
  installHelp.init();
  modals.controlsModal.init();
  modals.aboutModal.init();
  modals.chatModerationModal.init();
  modals.courseModal.init();
  profileModal.init();
  chatPanel.init();
  mobileUi.init();
  setupSceneCommands(game, modals);
  setupButtonFeedback();
  setupKeyboardShortcutPassthrough();

  window.addEventListener('tileset-changed', () => {
    paletteController.renderPalette();
  });

  window.addEventListener('tile-selected', () => {
    paletteController.renderTilePreview();
  });
}

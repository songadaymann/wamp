import Phaser from 'phaser';
import { ChatPanelController } from './chat/panel';
import { initializeDeviceLayout } from './deviceLayout';
import { MobileUiController } from './mobile/controller';
import { AboutModalController } from './setup/aboutModal';
import { setupButtonFeedback } from './setup/buttonFeedback';
import { ChatModerationModalController } from './setup/chatModerationModal';
import { ControlsModalController } from './setup/controlsModal';
import { CourseModalController } from './setup/courseModal';
import { CourseComposerPanelController } from './setup/courseComposerPanel';
import { ExploreModalController } from './setup/exploreModal';
import { RoomHistoryModalController } from './setup/historyModal';
import { setupKeyboardShortcutPassthrough } from './setup/keyboardPassthrough';
import { LeaderboardModalController } from './setup/leaderboardModal';
import { PaletteController } from './setup/paletteController';
import { setupRoomMusicControls } from './setup/musicControls';
import { ProfileModalController } from './setup/profileModal';
import { RewardStingController } from './setup/rewardStings';
import { RewardStingCatchupController } from './setup/rewardStingCatchup';
import { RoomGoalIntroModalController } from './setup/roomGoalIntroModal';
import { RunRatingModalController } from './setup/runRatingModal';
import { SignTextModalController } from './setup/signTextModal';
import { setupCollapsibleSidebarSections, setupEditorSidebarShell } from './setup/sidebarSections';
import { setupSceneCommands } from './setup/sceneCommands';
import { XpReceiptController } from './setup/xpReceipts';
import { WelcomeModalController } from './setup/welcomeModal';
import { configureEditorUiBridgeRuntime } from '../scenes/editor/uiBridge';

export function setupUI(game: Phaser.Game): void {
  initializeDeviceLayout();
  const paletteController = new PaletteController();
  const historyModal = new RoomHistoryModalController(game);
  const leaderboardModal = new LeaderboardModalController(game);
  const exploreModal = new ExploreModalController(game);
  const controlsModal = new ControlsModalController();
  const aboutModal = new AboutModalController();
  const chatModerationModal = new ChatModerationModalController();
  const courseModal = new CourseModalController(game);
  const courseComposerPanel = new CourseComposerPanelController(game);
  const profileModal = new ProfileModalController(game);
  const rewardStings = new RewardStingController();
  const xpReceipts = new XpReceiptController();
  const rewardStingCatchup = new RewardStingCatchupController();
  const roomGoalIntroModal = new RoomGoalIntroModalController();
  const runRatingModal = new RunRatingModalController(game);
  const signTextModal = new SignTextModalController(game);
  const welcomeModal = new WelcomeModalController(game);
  const chatPanel = new ChatPanelController();
  const mobileUi = new MobileUiController(game);

  paletteController.init();
  configureEditorUiBridgeRuntime({
    paletteController,
    closePanels: () => {
      historyModal.close();
      leaderboardModal.close();
      exploreModal.close();
      controlsModal.close();
      aboutModal.close();
      courseModal.close();
      chatModerationModal.close();
    },
    openHistory: () => historyModal.open(),
  });
  setupEditorSidebarShell();
  setupCollapsibleSidebarSections();
  historyModal.init();
  leaderboardModal.init();
  exploreModal.init();
  controlsModal.init();
  aboutModal.init();
  chatModerationModal.init();
  courseModal.init();
  courseComposerPanel.init();
  profileModal.init();
  rewardStings.init();
  xpReceipts.init();
  rewardStingCatchup.init();
  roomGoalIntroModal.init();
  runRatingModal.init();
  signTextModal.init();
  welcomeModal.init();
  chatPanel.init();
  mobileUi.init();
  setupSceneCommands(
    game,
    historyModal,
    leaderboardModal,
    exploreModal,
    controlsModal,
    aboutModal,
    chatModerationModal,
    courseModal
  );
  setupRoomMusicControls(game);
  setupButtonFeedback();
  setupKeyboardShortcutPassthrough();

  window.addEventListener('tileset-changed', () => {
    paletteController.renderPalette();
  });

  window.addEventListener('tile-selected', () => {
    paletteController.renderTilePreview();
  });
}

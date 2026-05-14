import Phaser from 'phaser';
import { ChatPanelController } from '../chat/panel';
import { MobileUiController } from '../mobile/controller';
import { AboutModalController } from './aboutModal';
import { setupButtonFeedback } from './buttonFeedback';
import { ChatModerationModalController } from './chatModerationModal';
import { ControlsModalController } from './controlsModal';
import { CourseModalController } from './courseModal';
import { CourseComposerPanelController } from './courseComposerPanel';
import { setupCustomSpriteEditor } from './customSpriteEditor';
import { ExploreModalController } from './exploreModal';
import { GuestBuilderClaimModalController } from './guestBuilderClaimModal';
import { GuestbookModalController } from './guestbookModal';
import { RoomHistoryModalController } from './historyModal';
import { setupKeyboardShortcutPassthrough } from './keyboardPassthrough';
import { LeaderboardModalController } from './leaderboardModal';
import { PaletteController } from './paletteController';
import { setupRoomMusicControls } from './musicControls';
import { ProfileModalController } from './profileModal';
import { RewardStingController } from './rewardStings';
import { RewardStingCatchupController } from './rewardStingCatchup';
import { RoomGoalIntroModalController } from './roomGoalIntroModal';
import { RoomRushModalController } from './roomRushModal';
import { RoomRushResultModalController } from './roomRushResultModal';
import { RunRatingModalController } from './runRatingModal';
import { SettingsModalController } from './settingsModal';
import { SignTextModalController } from './signTextModal';
import { setupCollapsibleSidebarSections, setupEditorSidebarShell } from './sidebarSections';
import { setupSceneCommands } from './sceneCommands';
import { XpReceiptController } from './xpReceipts';
import { WelcomeModalController } from './welcomeModal';
import { configureEditorUiBridgeRuntime } from '../../scenes/editor/uiBridge';
import { CUSTOM_SPRITES_CHANGED_EVENT } from '../../customSprites/registry';

interface UiControllers {
  paletteController: PaletteController;
  historyModal: RoomHistoryModalController;
  leaderboardModal: LeaderboardModalController;
  exploreModal: ExploreModalController;
  guestBuilderClaimModal: GuestBuilderClaimModalController;
  guestbookModal: GuestbookModalController;
  settingsModal: SettingsModalController;
  controlsModal: ControlsModalController;
  aboutModal: AboutModalController;
  chatModerationModal: ChatModerationModalController;
  courseModal: CourseModalController;
  courseComposerPanel: CourseComposerPanelController;
  profileModal: ProfileModalController;
  rewardStings: RewardStingController;
  xpReceipts: XpReceiptController;
  rewardStingCatchup: RewardStingCatchupController;
  roomGoalIntroModal: RoomGoalIntroModalController;
  roomRushModal: RoomRushModalController;
  roomRushResultModal: RoomRushResultModalController;
  runRatingModal: RunRatingModalController;
  signTextModal: SignTextModalController;
  welcomeModal: WelcomeModalController;
  chatPanel: ChatPanelController;
  mobileUi: MobileUiController;
}

export function setupUiControllers(game: Phaser.Game): void {
  const controllers = createUiControllers(game);

  controllers.paletteController.init();
  configureEditorBridge(controllers);
  setupEditorSidebarShell();
  setupCollapsibleSidebarSections();
  initUiControllers(controllers);
  setupUiControllerCommands(game, controllers);
  setupRoomMusicControls(game);
  setupCustomSpriteEditor(game);
  setupButtonFeedback();
  setupKeyboardShortcutPassthrough();
  setupPaletteRefreshListeners(controllers.paletteController);
}

function createUiControllers(game: Phaser.Game): UiControllers {
  return {
    paletteController: new PaletteController(),
    historyModal: new RoomHistoryModalController(game),
    leaderboardModal: new LeaderboardModalController(game),
    exploreModal: new ExploreModalController(game),
    guestBuilderClaimModal: new GuestBuilderClaimModalController(),
    guestbookModal: new GuestbookModalController(),
    settingsModal: new SettingsModalController(),
    controlsModal: new ControlsModalController(),
    aboutModal: new AboutModalController(),
    chatModerationModal: new ChatModerationModalController(),
    courseModal: new CourseModalController(game),
    courseComposerPanel: new CourseComposerPanelController(game),
    profileModal: new ProfileModalController(game),
    rewardStings: new RewardStingController(),
    xpReceipts: new XpReceiptController(),
    rewardStingCatchup: new RewardStingCatchupController(),
    roomGoalIntroModal: new RoomGoalIntroModalController(),
    roomRushModal: new RoomRushModalController(game),
    roomRushResultModal: new RoomRushResultModalController(game),
    runRatingModal: new RunRatingModalController(game),
    signTextModal: new SignTextModalController(game),
    welcomeModal: new WelcomeModalController(game),
    chatPanel: new ChatPanelController(),
    mobileUi: new MobileUiController(game),
  };
}

function initUiControllers(controllers: UiControllers): void {
  controllers.historyModal.init();
  controllers.leaderboardModal.init();
  controllers.exploreModal.init();
  controllers.guestBuilderClaimModal.init();
  controllers.guestbookModal.init();
  controllers.settingsModal.init();
  controllers.controlsModal.init();
  controllers.aboutModal.init();
  controllers.chatModerationModal.init();
  controllers.courseModal.init();
  controllers.courseComposerPanel.init();
  controllers.profileModal.init();
  controllers.rewardStings.init();
  controllers.xpReceipts.init();
  controllers.rewardStingCatchup.init();
  controllers.roomGoalIntroModal.init();
  controllers.roomRushModal.init();
  controllers.roomRushResultModal.init();
  controllers.runRatingModal.init();
  controllers.signTextModal.init();
  controllers.welcomeModal.init();
  controllers.chatPanel.init();
  controllers.mobileUi.init();
}

function configureEditorBridge(controllers: UiControllers): void {
  configureEditorUiBridgeRuntime({
    paletteController: controllers.paletteController,
    closePanels: () => {
      controllers.historyModal.close();
      controllers.leaderboardModal.close();
      controllers.exploreModal.close();
      controllers.guestBuilderClaimModal.close();
      controllers.guestbookModal.close();
      controllers.settingsModal.close();
      controllers.controlsModal.close();
      controllers.aboutModal.close();
      controllers.courseModal.close();
      controllers.chatModerationModal.close();
    },
    openHistory: () => controllers.historyModal.open(),
  });
}

function setupUiControllerCommands(game: Phaser.Game, controllers: UiControllers): void {
  setupSceneCommands(
    game,
    controllers.historyModal,
    controllers.leaderboardModal,
    controllers.exploreModal,
    controllers.guestbookModal,
    controllers.settingsModal,
    controllers.controlsModal,
    controllers.aboutModal,
    controllers.chatModerationModal,
    controllers.courseModal,
    controllers.roomRushModal,
    controllers.roomRushResultModal
  );
}

function setupPaletteRefreshListeners(paletteController: PaletteController): void {
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

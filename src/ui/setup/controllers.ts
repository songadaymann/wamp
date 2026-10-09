import { BuildPromptsController } from './buildPrompts';
import { RoomInsightsController } from './roomInsights';
import { DailyRoomController } from './dailyRoom';
import { FirstPublishModalController } from './firstPublishModal';
import { ActivityInboxController } from './activityInbox';
import Phaser from 'phaser';
import { ChatPanelController } from '../chat/panel';
import { MobileUiController } from '../mobile/controller';
import { AboutModalController } from './aboutModal';
import { setupButtonFeedback } from './buttonFeedback';
import { ChatModerationModalController } from './chatModerationModal';
import { ControlsModalController } from './controlsModal';
import { CourseComposerPanelController } from './courseComposerPanel';
import { setupCustomSpriteEditor } from './customSpriteEditor';
import { ExploreModalController } from './exploreModal';
import { setupEditorDockShell } from './editorDockShell';
import { GuestBuilderClaimModalController } from './guestBuilderClaimModal';
import { GuestRoomRecoveryModalController } from './guestRoomRecoveryModal';
import { GuestProgressClaimModalController } from './guestProgressClaimModal';
import { GuestbookModalController } from './guestbookModal';
import { RoomHistoryModalController } from './historyModal';
import { setupKeyboardShortcutPassthrough } from './keyboardPassthrough';
import { LeaderboardModalController } from './leaderboardModal';
import { PaletteController } from './paletteController';
import { PlaylistModalController } from './playlistModal';
import { PlaylistIntroModalController } from './playlistIntroModal';
import { PerformanceSuggestionModalController } from './performanceSuggestionModal';
import { RoomSequenceController } from './roomSequenceController';
import { setupRoomMusicControls } from './musicControls';
import { ProfileModalController } from './profileModal';
import { RewardStingController } from './rewardStings';
import { RewardStingCatchupController } from './rewardStingCatchup';
import { RoomGoalIntroModalController } from './roomGoalIntroModal';
import { RoomRushModalController } from './roomRushModal';
import { RoomRushResultModalController } from './roomRushResultModal';
import { RunRatingModalController } from './runRatingModal';
import { PostRunReminderController } from './postRunReminder';
import { SettingsModalController } from './settingsModal';
import { SignTextModalController } from './signTextModal';
import {
  EDITOR_SIDEBAR_RESIZED_EVENT,
  setupCollapsibleSidebarSections,
  setupEditorSidebarShell,
} from './sidebarSections';
import { setupSceneCommands } from './sceneCommands';
import { WampOGramModalController } from './wampOGramModal';
import { XpReceiptController } from './xpReceipts';
import { WelcomeModalController } from './welcomeModal';
import { FirstStepsSummaryController } from './firstStepsSummary';
import { configureEditorUiBridgeRuntime } from '../../scenes/editor/uiBridge';
import { CUSTOM_SPRITES_CHANGED_EVENT } from '../../customSprites/registry';
import { WorldsController } from '../worlds/controller';
import { setupLostSongProgress } from './lostSongs';

interface UiControllers {
  firstPublishModal: FirstPublishModalController;
  activityInbox: ActivityInboxController;
  roomInsights: RoomInsightsController;
  paletteController: PaletteController;
  historyModal: RoomHistoryModalController;
  leaderboardModal: LeaderboardModalController;
  exploreModal: ExploreModalController;
  roomSequence: RoomSequenceController;
  guestBuilderClaimModal: GuestBuilderClaimModalController;
  guestRoomRecoveryModal: GuestRoomRecoveryModalController;
  guestProgressClaimModal: GuestProgressClaimModalController;
  guestbookModal: GuestbookModalController;
  settingsModal: SettingsModalController;
  controlsModal: ControlsModalController;
  aboutModal: AboutModalController;
  chatModerationModal: ChatModerationModalController;
  courseComposerPanel: CourseComposerPanelController;
  profileModal: ProfileModalController;
  playlistModal: PlaylistModalController;
  playlistIntroModal: PlaylistIntroModalController;
  performanceSuggestionModal: PerformanceSuggestionModalController;
  rewardStings: RewardStingController;
  xpReceipts: XpReceiptController;
  rewardStingCatchup: RewardStingCatchupController;
  roomGoalIntroModal: RoomGoalIntroModalController;
  roomRushModal: RoomRushModalController;
  roomRushResultModal: RoomRushResultModalController;
  runRatingModal: RunRatingModalController;
  postRunReminder: PostRunReminderController;
  signTextModal: SignTextModalController;
  wampOGramModal: WampOGramModalController;
  welcomeModal: WelcomeModalController;
  chatPanel: ChatPanelController;
  mobileUi: MobileUiController;
  worlds: WorldsController;
}

export function setupUiControllers(game: Phaser.Game): void {
  game.events.once('destroy', setupLostSongProgress());
  const controllers = createUiControllers(game);
  const dailyRoom = new DailyRoomController(); dailyRoom.init();
  game.events.once('destroy',()=>dailyRoom.destroy());
  game.events.once('destroy', () => { controllers.activityInbox.destroy(); controllers.roomInsights.destroy(); controllers.postRunReminder.destroy(); controllers.firstPublishModal.destroy(); });

  controllers.paletteController.init();
  configureEditorBridge(controllers);
  setupEditorSidebarShell();
  setupEditorDockShell(controllers.paletteController);
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
  const leaderboardModal = new LeaderboardModalController(game);
  const controlsModal = new ControlsModalController();
  const playlistIntroModal = new PlaylistIntroModalController();
  const exploreModal = new ExploreModalController(game);
  const buildPrompts = new BuildPromptsController(() => exploreModal.close()); buildPrompts.init();
  game.events.once('destroy', () => buildPrompts.destroy());
  const runRatingModal = new RunRatingModalController(game);
  const guestProgressClaimModal = new GuestProgressClaimModalController();
  const openExplore = () => exploreModal.open();
  const welcomeModal = new WelcomeModalController(game, undefined, undefined, undefined, undefined, undefined, { explore: openExplore });
  const firstStepsSummary = new FirstStepsSummaryController({
    explore: () => { void openExplore(); }, build: () => welcomeModal.beginBuild(),
  });
  firstStepsSummary.init();
  game.events.once('destroy', () => firstStepsSummary.destroy());

  return {
    firstPublishModal: new FirstPublishModalController(),
    activityInbox: new ActivityInboxController(),
    roomInsights: new RoomInsightsController(game),
    paletteController: new PaletteController(),
    historyModal: new RoomHistoryModalController(game),
    leaderboardModal,
    exploreModal,
    roomSequence: new RoomSequenceController(game, leaderboardModal, playlistIntroModal, welcomeModal, undefined, undefined, firstStepsSummary, runRatingModal),
    guestBuilderClaimModal: new GuestBuilderClaimModalController(),
    guestRoomRecoveryModal: new GuestRoomRecoveryModalController(game),
    guestProgressClaimModal,
    guestbookModal: new GuestbookModalController(),
    settingsModal: new SettingsModalController(),
    controlsModal,
    aboutModal: new AboutModalController(),
    chatModerationModal: new ChatModerationModalController(),
    courseComposerPanel: new CourseComposerPanelController(game),
    profileModal: new ProfileModalController(game),
    playlistModal: new PlaylistModalController(game),
    playlistIntroModal,
    performanceSuggestionModal: new PerformanceSuggestionModalController(game),
    rewardStings: new RewardStingController(),
    xpReceipts: new XpReceiptController(),
    rewardStingCatchup: new RewardStingCatchupController(),
    roomGoalIntroModal: new RoomGoalIntroModalController(),
    roomRushModal: new RoomRushModalController(game),
    roomRushResultModal: new RoomRushResultModalController(game),
    runRatingModal,
    postRunReminder: new PostRunReminderController({
      openUnrated: () => { void exploreModal.open('unrated'); },
      openGuestHistory: () => guestProgressClaimModal.openFromReminder(),
      beforeOpen: () => runRatingModal.close(),
    }),
    signTextModal: new SignTextModalController(game),
    wampOGramModal: new WampOGramModalController(game),
    welcomeModal,
    chatPanel: new ChatPanelController(),
    mobileUi: new MobileUiController(game),
    worlds: new WorldsController(game),
  };
}

function initUiControllers(controllers: UiControllers): void {
  controllers.firstPublishModal.init();
  controllers.activityInbox.init();
  controllers.roomInsights.init();
  controllers.historyModal.init();
  controllers.leaderboardModal.init();
  controllers.exploreModal.init();
  controllers.roomSequence.init();
  controllers.guestBuilderClaimModal.init();
  controllers.guestRoomRecoveryModal.init();
  controllers.guestProgressClaimModal.init();
  controllers.guestbookModal.init();
  controllers.settingsModal.init();
  controllers.controlsModal.init();
  controllers.aboutModal.init();
  controllers.chatModerationModal.init();
  controllers.courseComposerPanel.init();
  controllers.profileModal.init();
  controllers.roomGoalIntroModal.init();
  controllers.playlistModal.init();
  controllers.playlistIntroModal.init();
  controllers.performanceSuggestionModal.init();
  controllers.rewardStings.init();
  controllers.xpReceipts.init();
  controllers.rewardStingCatchup.init();
  controllers.roomRushModal.init();
  controllers.roomRushResultModal.init();
  controllers.runRatingModal.init();
  controllers.postRunReminder.init();
  controllers.signTextModal.init();
  controllers.wampOGramModal.init();
  controllers.welcomeModal.init();
  controllers.chatPanel.init();
  controllers.mobileUi.init();
  controllers.worlds.init();
}

function configureEditorBridge(controllers: UiControllers): void {
  configureEditorUiBridgeRuntime({
    paletteController: controllers.paletteController,
    closePanels: () => {
      controllers.firstPublishModal.close();
      controllers.historyModal.close();
      controllers.leaderboardModal.close();
      controllers.exploreModal.close();
      controllers.guestBuilderClaimModal.close();
      controllers.guestRoomRecoveryModal.close();
      controllers.guestProgressClaimModal.close();
      controllers.guestbookModal.close();
      controllers.settingsModal.close();
      controllers.controlsModal.close();
      controllers.aboutModal.close();
      controllers.chatModerationModal.close();
      controllers.playlistModal.close();
      controllers.playlistIntroModal.close();
      controllers.performanceSuggestionModal.deferForAppModeTransition();
      controllers.roomSequence.stop({ returnToWorld: false });
      controllers.wampOGramModal.close();
      controllers.worlds.close();
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
    controllers.roomRushModal,
    controllers.roomRushResultModal
  );
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

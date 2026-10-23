import { BuildPromptsController } from './buildPrompts';
import { RoomInsightsController } from './roomInsights';
import { DailyRoomController } from './dailyRoom';
import { LazyFirstPublishController } from './lazyFirstPublish';
import { ActivityInboxController } from './activityInbox';
import Phaser from 'phaser';
import { ChatPanelController } from '../chat/panel';
import { MobileUiController } from '../mobile/controller';
import type { AboutModalController } from './aboutModal';
import { setupButtonFeedback } from './buttonFeedback';
import type { ChatModerationModalController } from './chatModerationModal';
import type { ControlsModalController } from './controlsModal';
import type { ExploreModalController } from './exploreModal';
import type { GuestBuilderClaimModalController } from './guestBuilderClaimModal';
import type { GuestRoomRecoveryModalController } from './guestRoomRecoveryModal';
import type { GuestProgressClaimModalController } from './guestProgressClaimModal';
import type { GuestbookModalController } from './guestbookModal';
import type { RoomHistoryModalController } from './historyModal';
import { setupKeyboardShortcutPassthrough } from './keyboardPassthrough';
import type { LeaderboardModalController } from './leaderboardModal';
import type { PlaylistModalController } from './playlistModal';
import { PlaylistIntroModalController } from './playlistIntroModal';
import { PerformanceSuggestionModalController } from './performanceSuggestionModal';
import { RoomSequenceController } from './roomSequenceController';
import type { ProfileModalController } from './profileModal';
import { explainMenuLoadFailure, LazyModal } from './lazyModal';
import { LazyRecoveryController } from './lazyRecovery';
import { setupRemainingModalTriggers } from './remainingModalTriggers';
import { PROFILE_OPEN_REQUEST_EVENT, type ProfileOpenRequestDetail } from './profileEvents';
import { RewardStingController } from './rewardStings';
import { RewardStingCatchupController } from './rewardStingCatchup';
import { RoomGoalIntroModalController } from './roomGoalIntroModal';
import type { RoomRushModalController } from './roomRushModal';
import type { RoomRushResultModalController } from './roomRushResultModal';
import { LazyRunRatingController } from './lazyRunRating';
import { PostRunReminderController } from './postRunReminder';
import { SettingsModalController } from './settingsModal';
import type { SignTextModalController } from './signTextModal';
import { configureEditorUiHost } from './editorUiLoader';
import { setupSceneCommands } from './sceneCommands';
import type { WampOGramModalController } from './wampOGramModal';
import { XpReceiptController } from './xpReceipts';
import { WelcomeModalController } from './welcomeModal';
import { FirstStepsSummaryController } from './firstStepsSummary';
import { WorldsController } from '../worlds/controller';
import { setupLostSongProgress } from './lostSongs';
import { PLAYLIST_OPEN_REQUEST_EVENT, type PlaylistOpenRequestDetail } from './playlistEvents';
import { parsePlaylistSharePath } from '../../playlists/model';
import { SIGN_TEXT_EDIT_REQUEST_EVENT, type SignTextEditRequestDetail } from '../../signs/events';

interface UiControllers {
  firstPublishModal: LazyFirstPublishController;
  activityInbox: ActivityInboxController;
  roomInsights: RoomInsightsController;
  historyModal: LazyModal<RoomHistoryModalController>;
  leaderboardModal: LazyModal<LeaderboardModalController>;
  exploreModal: LazyModal<ExploreModalController>;
  roomSequence: RoomSequenceController;
  guestBuilderClaimModal: LazyModal<GuestBuilderClaimModalController>;
  guestRoomRecoveryModal: LazyRecoveryController<GuestRoomRecoveryModalController>;
  guestProgressClaimModal: LazyRecoveryController<GuestProgressClaimModalController>;
  guestbookModal: LazyModal<GuestbookModalController>;
  settingsModal: SettingsModalController;
  controlsModal: LazyModal<ControlsModalController>;
  aboutModal: LazyModal<AboutModalController>;
  chatModerationModal: LazyModal<ChatModerationModalController>;
  profileModal: LazyModal<ProfileModalController>;
  playlistModal: LazyModal<PlaylistModalController>;
  playlistIntroModal: PlaylistIntroModalController;
  performanceSuggestionModal: PerformanceSuggestionModalController;
  rewardStings: RewardStingController;
  xpReceipts: XpReceiptController;
  rewardStingCatchup: RewardStingCatchupController;
  roomGoalIntroModal: RoomGoalIntroModalController;
  roomRushModal: LazyModal<RoomRushModalController>;
  roomRushResultModal: LazyModal<RoomRushResultModalController>;
  runRatingModal: LazyRunRatingController;
  postRunReminder: PostRunReminderController;
  signTextModal: LazyModal<SignTextModalController>;
  wampOGramModal: LazyModal<WampOGramModalController>;
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

  configureEditorBridge(controllers);
  initUiControllers(controllers);
  setupLazyModalTriggers(controllers);
  const removeRemainingTriggers = setupRemainingModalTriggers(controllers);
  game.events.once('destroy', () => {
    removeRemainingTriggers();
    controllers.guestRoomRecoveryModal.destroy(); controllers.guestProgressClaimModal.destroy();
    controllers.chatModerationModal.destroy(); controllers.guestBuilderClaimModal.destroy();
    controllers.roomRushModal.destroy(); controllers.roomRushResultModal.destroy();
  });
  const sharedPlaylist = parsePlaylistSharePath(window.location.pathname);
  if (sharedPlaylist) void controllers.playlistModal.open(sharedPlaylist, { autoPlay: true });
  setupUiControllerCommands(game, controllers);
  setupButtonFeedback();
  setupKeyboardShortcutPassthrough(game);
}

function createUiControllers(game: Phaser.Game): UiControllers {
  // Rarely opened pop-ups load on first open (F019).
  const leaderboardModal = new LazyModal(async () => new (await import('./leaderboardModal')).LeaderboardModalController(game), ['leaderboard-modal'],
    explainMenuLoadFailure('Leaderboard'));
  const controlsModal = new LazyModal(async () => new (await import('./controlsModal')).ControlsModalController());
  const playlistIntroModal = new PlaylistIntroModalController();
  const exploreModal = new LazyModal(async () => new (await import('./exploreModal')).ExploreModalController(game), ['explore-modal']);
  const roomRushResultModal = new LazyModal(async () => new (await import('./roomRushResultModal')).RoomRushResultModalController(game));
  const buildPrompts = new BuildPromptsController(() => exploreModal.close()); buildPrompts.init();
  game.events.once('destroy', () => buildPrompts.destroy());
  const runRatingModal = new LazyRunRatingController(async () => new (await import('./runRatingModal')).RunRatingModalController(game));
  game.events.once('destroy', () => runRatingModal.destroy());
  const guestProgressClaimModal = new LazyRecoveryController(async () => new (await import('./guestProgressClaimModal')).GuestProgressClaimModalController(), 'btn-auth-guest-progress', 200);
  const openExplore = () => exploreModal.open();
  const welcomeModal = new WelcomeModalController(game, undefined, undefined, undefined, undefined, undefined, { explore: openExplore });
  const firstStepsSummary = new FirstStepsSummaryController({
    explore: () => { void openExplore(); }, build: () => welcomeModal.beginBuild(),
  });
  firstStepsSummary.init();
  game.events.once('destroy', () => firstStepsSummary.destroy());

  return {
    firstPublishModal: new LazyFirstPublishController(async () => new (await import('./firstPublishModal')).FirstPublishModalController()),
    activityInbox: new ActivityInboxController(),
    roomInsights: new RoomInsightsController(game),
    historyModal: new LazyModal(async () => new (await import('./historyModal')).RoomHistoryModalController(game), ['room-history-modal']),
    leaderboardModal,
    exploreModal,
    roomSequence: new RoomSequenceController(game, leaderboardModal, playlistIntroModal, welcomeModal, undefined, undefined, firstStepsSummary, runRatingModal),
    guestBuilderClaimModal: new LazyModal(async () => new (await import('./guestBuilderClaimModal')).GuestBuilderClaimModalController()),
    guestRoomRecoveryModal: new LazyRecoveryController(async () => new (await import('./guestRoomRecoveryModal')).GuestRoomRecoveryModalController(game), 'btn-auth-guest-drafts', 200),
    guestProgressClaimModal,
    guestbookModal: new LazyModal(async () => new (await import('./guestbookModal')).GuestbookModalController()),
    settingsModal: new SettingsModalController(),
    controlsModal,
    aboutModal: new LazyModal(async () => new (await import('./aboutModal')).AboutModalController()),
    chatModerationModal: new LazyModal(async () => new (await import('./chatModerationModal')).ChatModerationModalController()),
    profileModal: new LazyModal(async () => new (await import('./profileModal')).ProfileModalController(game), ['profile-modal', 'avatar-picker-modal']),
    playlistModal: new LazyModal(async () => new (await import('./playlistModal')).PlaylistModalController(game)),
    playlistIntroModal,
    performanceSuggestionModal: new PerformanceSuggestionModalController(game),
    rewardStings: new RewardStingController(),
    xpReceipts: new XpReceiptController(),
    rewardStingCatchup: new RewardStingCatchupController(),
    roomGoalIntroModal: new RoomGoalIntroModalController(),
    roomRushModal: new LazyModal(async () => {
      // A Rush's score is sent from its result dialog, so download that while this tab's build is
      // still live; after a release the run would otherwise end with nowhere to send it (F374).
      void roomRushResultModal.ensure().catch(() => undefined);
      return new (await import('./roomRushModal')).RoomRushModalController(game);
    }),
    roomRushResultModal,
    runRatingModal,
    postRunReminder: new PostRunReminderController({
      openUnrated: () => { void exploreModal.open('unrated'); },
      openGuestHistory: () => { void guestProgressClaimModal.invoke(controller => controller.openFromReminder()); },
      beforeOpen: () => runRatingModal.close(),
    }),
    signTextModal: new LazyModal(async () => new (await import('./signTextModal')).SignTextModalController(game)),
    wampOGramModal: new LazyModal(async () => new (await import('./wampOGramModal')).WampOGramModalController(game)),
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
  controllers.roomSequence.init();
  controllers.guestRoomRecoveryModal.init();
  controllers.guestProgressClaimModal.init();
  controllers.settingsModal.init();
  controllers.roomGoalIntroModal.init();
  controllers.playlistIntroModal.init();
  controllers.performanceSuggestionModal.init();
  controllers.rewardStings.init();
  controllers.xpReceipts.init();
  controllers.rewardStingCatchup.init();
  controllers.runRatingModal.init();
  controllers.postRunReminder.init();
  controllers.welcomeModal.init();
  controllers.chatPanel.init();
  controllers.mobileUi.init();
  controllers.worlds.init();
}

/** The builder UI loads with the editor scenes (editorUiLoader); this is what it needs from here. */
function configureEditorBridge(controllers: UiControllers): void {
  configureEditorUiHost({
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
    openHistory: () => { void controllers.historyModal.open(); },
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

/** Boot-time triggers for the lazy pop-ups; once one loads, its own listeners take over. */
function setupLazyModalTriggers(controllers: UiControllers): void {
  window.addEventListener(PROFILE_OPEN_REQUEST_EVENT, (event) => {
    if (controllers.profileModal.loaded) return;
    const detail = (event as CustomEvent<ProfileOpenRequestDetail>).detail;
    if (detail?.userId) void controllers.profileModal.open(detail.userId, detail.tab);
  });
  document.getElementById('btn-wamp-o-gram')?.addEventListener('click', () => {
    if (!controllers.wampOGramModal.loaded) void controllers.wampOGramModal.open();
  });
  window.addEventListener(PLAYLIST_OPEN_REQUEST_EVENT, (event) => {
    const detail = (event as CustomEvent<PlaylistOpenRequestDetail>).detail;
    if (!controllers.playlistModal.loaded && detail?.slug) void controllers.playlistModal.open(detail.slug);
  });
  window.addEventListener(SIGN_TEXT_EDIT_REQUEST_EVENT, (event) => {
    const detail = (event as CustomEvent<SignTextEditRequestDetail>).detail;
    if (!controllers.signTextModal.loaded && detail) void controllers.signTextModal.open(detail);
  });
  document.getElementById('btn-guestbook-open')?.addEventListener('click', () => {
    if (!controllers.guestbookModal.loaded) void controllers.guestbookModal.open();
  });
  document.getElementById('btn-auth-leaderboard')?.addEventListener('click', () => {
    if (controllers.leaderboardModal.loaded) return;
    document.getElementById('auth-panel')?.classList.remove('menu-open');
    void controllers.leaderboardModal.open('global');
  });
  document.getElementById('btn-menu-room-leaderboard')?.addEventListener('click', () => {
    if (controllers.leaderboardModal.loaded) return;
    document.getElementById('auth-panel')?.classList.remove('menu-open');
    void controllers.leaderboardModal.open();
  });
}

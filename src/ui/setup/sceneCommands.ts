import { setupGameMenu } from './gameMenu';
import { installRestartShortcut } from './restartShortcut';
import Phaser from 'phaser';
import type { LazyModal } from './lazyModal';
import type { AboutModalController } from './aboutModal';
import type { ChatModerationModalController } from './chatModerationModal';
import type { ControlsModalController } from './controlsModal';
import type { ExploreModalController } from './exploreModal';
import type { GuestbookModalController } from './guestbookModal';
import type { RoomHistoryModalController } from './historyModal';
import type { LeaderboardModalController } from './leaderboardModal';
import type { RoomRushModalController } from './roomRushModal';
import type { RoomRushResultModalController } from './roomRushResultModal';
import { SettingsModalController } from './settingsModal';
import {
  getActiveCourseWorkspaceScene,
  getActiveOverworldScene,
  getOverworldScene,
} from './sceneBridge';
import { REQUEST_BUILDER_MODE_EVENT } from './welcomeModal';
import { getGameSettings } from '../../settings/userSettings';
import { configureOverworldHudBridgeRuntime } from '../../scenes/overworld/hud';
import { RoomSharingController } from './roomSharing';
import { asyncListener } from '../asyncListener';

export function setupSceneCommands(
  game: Phaser.Game,
  historyModal: Pick<RoomHistoryModalController, 'open' | 'close'>,
  leaderboardModal: Pick<LeaderboardModalController, 'open' | 'close'>,
  exploreModal: Pick<ExploreModalController, 'open' | 'close'>,
  guestbookModal: Pick<LazyModal<GuestbookModalController>, 'open' | 'close'>,
  settingsModal: SettingsModalController,
  controlsModal: Pick<LazyModal<ControlsModalController>, 'open' | 'close'>,
  aboutModal: Pick<LazyModal<AboutModalController>, 'open' | 'close'>,
  chatModerationModal: Pick<LazyModal<ChatModerationModalController>, 'open' | 'close'>,
  roomRushModal: Pick<LazyModal<RoomRushModalController>, 'open' | 'close'>,
  roomRushResultModal: Pick<LazyModal<RoomRushResultModalController>, 'open' | 'close'>,
  doc: Document = document,
): void {
  const authPanel = doc.getElementById('auth-panel');
  const aboutOpenBtn = doc.getElementById('btn-about-open');
  const chatModerationOpenBtn = doc.getElementById('btn-chat-moderation-open');
  const worldJumpInput = doc.getElementById('world-jump-input') as HTMLInputElement | null;
  const courseSaveBtn = doc.getElementById('btn-course-editor-save-course');
  const coursePublishBtn = doc.getElementById('btn-course-editor-publish-course');
  const roomSharing = new RoomSharingController(() => getActiveOverworldScene(game)?.getSelectedRoomContext() ?? null, doc, doc.defaultView ?? window);

  const closeMenu = () => {
    authPanel?.classList.remove('menu-open');
  };
  const closeWorldPanels = () => {
    leaderboardModal.close();
    exploreModal.close();
    guestbookModal.close();
    settingsModal.close();
    controlsModal.close();
    aboutModal.close();
    roomRushModal.close();
    roomRushResultModal.close();
    chatModerationModal.close();
    getActiveOverworldScene(game)?.closeRoomCommentComposer();
  };

  const handleWorldJump = () => {
    const overworldScene = getActiveOverworldScene(game);
    if (!overworldScene?.jumpToCoordinates || !worldJumpInput) {
      return;
    }

    const match = /^\s*(-?\d+)\s*,\s*(-?\d+)\s*$/.exec(worldJumpInput.value);
    if (!match) {
      return;
    }

    void overworldScene.jumpToCoordinates({
      x: Number(match[1]),
      y: Number(match[2]),
    });
  };
  const isEditableKeyboardTarget = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    const tagName = target.tagName.toLowerCase();
    return tagName === 'input' || tagName === 'textarea' || target.isContentEditable;
  };
  const handleRoomChatShortcut = (event: KeyboardEvent) => {
    if (
      event.key.toLowerCase() !== 't' ||
      event.repeat ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      isEditableKeyboardTarget(event.target)
    ) {
      return;
    }

    const overworldScene = getOverworldScene(game);
    if (!overworldScene?.openRoomChatComposer || overworldScene.isRoomChatComposerOpen()) {
      return;
    }

    const opened = overworldScene.openRoomChatComposer();
    if (!opened) {
      if (doc.body.dataset.appMode === 'play-world') {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  };

  const handleRoomCommentShortcut = (event: KeyboardEvent) => {
    if (
      event.key.toLowerCase() !== 'c' ||
      event.repeat ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      isEditableKeyboardTarget(event.target)
    ) {
      return;
    }

    const overworldScene = getOverworldScene(game);
    if (!overworldScene?.openRoomCommentComposer || overworldScene.isRoomCommentComposerOpen()) {
      return;
    }

    const opened = overworldScene.openRoomCommentComposer();
    if (!opened) {
      if (doc.body.dataset.appMode === 'play-world') {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  };

  installRestartShortcut(() => getActiveOverworldScene(game)?.restartCurrentRun(), doc);
  doc.addEventListener('keydown', handleRoomChatShortcut, { capture: true });
  doc.addEventListener('keydown', handleRoomCommentShortcut, { capture: true });

  configureOverworldHudBridgeRuntime({
    onShareRoom: () => roomSharing.shareSelectedRoom(),
    onPlayRoom: () => {
      const overworldScene = getActiveOverworldScene(game);
      closeWorldPanels();
      void overworldScene?.playSelectedRoom();
    },
    onRestartRun: () => {
      closeWorldPanels();
      void getActiveOverworldScene(game)?.restartCurrentRun();
    },
    onPlayCourse: () => {
      closeWorldPanels();
      void getActiveOverworldScene(game)?.playSelectedCourse();
    },
    onEditRoom: () => {
      closeWorldPanels();
      getActiveOverworldScene(game)?.editSelectedRoom();
    },
    onBuildRoom: () => {
      const startBuild = () => {
        closeWorldPanels();
        getActiveOverworldScene(game)?.buildSelectedRoom();
      };
      if (getGameSettings().builderMode === 'unselected') {
        window.dispatchEvent(new CustomEvent(REQUEST_BUILDER_MODE_EVENT, {
          detail: { onSelected: startBuild },
        }));
        return;
      }
      startBuild();
    },
    onOpenCourseBuilder: () => {
      closeWorldPanels();
      void (getActiveOverworldScene(game)?.openCourseEditor() ??
        getActiveOverworldScene(game)?.openCourseComposer());
    },
    onJumpToCoordinates: (coordinates) => {
      void getActiveOverworldScene(game)?.jumpToCoordinates(coordinates);
    },
    onZoomIn: () => {
      getActiveOverworldScene(game)?.zoomIn();
    },
    onZoomOut: () => {
      getActiveOverworldScene(game)?.zoomOut();
    },
    onOpenExplore: () => {
      leaderboardModal.close();
      guestbookModal.close();
      settingsModal.close();
      controlsModal.close();
      aboutModal.close();
      roomRushModal.close();
      roomRushResultModal.close();
      chatModerationModal.close();
      void exploreModal.open();
    },
    onOpenLeaderboard: () => {
      exploreModal.close();
      guestbookModal.close();
      settingsModal.close();
      controlsModal.close();
      aboutModal.close();
      roomRushModal.close();
      roomRushResultModal.close();
      chatModerationModal.close();
      void leaderboardModal.open();
    },
    onOpenRoomRush: () => {
      leaderboardModal.close();
      exploreModal.close();
      guestbookModal.close();
      historyModal.close();
      settingsModal.close();
      controlsModal.close();
      aboutModal.close();
      chatModerationModal.close();
      roomRushResultModal.close();
      const scene = getActiveOverworldScene(game);
      if (scene?.isRoomRushRunActive()) {
        scene.endRoomRushRun();
        return;
      }
      void roomRushModal.open();
    },
    onOpenMultiplayer: () => {
      leaderboardModal.close();
      exploreModal.close();
      guestbookModal.close();
      historyModal.close();
      settingsModal.close();
      controlsModal.close();
      aboutModal.close();
      roomRushModal.close();
      roomRushResultModal.close();
      chatModerationModal.close();
      return getActiveOverworldScene(game)?.openMultiplayerLauncher() ?? false;
    },
    onInviteMultiplayer: (modeId, entry) => {
      leaderboardModal.close();
      exploreModal.close();
      guestbookModal.close();
      historyModal.close();
      settingsModal.close();
      controlsModal.close();
      aboutModal.close();
      roomRushModal.close();
      roomRushResultModal.close();
      chatModerationModal.close();
      void getActiveOverworldScene(game)?.inviteMultiplayer(modeId, entry);
    },
    onOpenRoomComment: () => {
      leaderboardModal.close();
      exploreModal.close();
      guestbookModal.close();
      historyModal.close();
      settingsModal.close();
      controlsModal.close();
      aboutModal.close();
      roomRushModal.close();
      roomRushResultModal.close();
      chatModerationModal.close();
      getActiveOverworldScene(game)?.openRoomCommentComposer();
    },
    onToggleRoomComments: () => {
      leaderboardModal.close();
      exploreModal.close();
      guestbookModal.close();
      historyModal.close();
      settingsModal.close();
      controlsModal.close();
      aboutModal.close();
      roomRushModal.close();
      roomRushResultModal.close();
      chatModerationModal.close();
      getActiveOverworldScene(game)?.toggleRoomComments();
    },
    onFitWorld: () => {
      if (game.scene.isActive('EditorScene')) {
        return;
      }

      controlsModal.close();
      settingsModal.close();
      guestbookModal.close();
      aboutModal.close();
      roomRushModal.close();
      roomRushResultModal.close();
      chatModerationModal.close();
      getActiveOverworldScene(game)?.fitLoadedWorld();
    },
  });

  aboutOpenBtn?.addEventListener('click', () => {
    closeMenu();
    historyModal.close();
    leaderboardModal.close();
    exploreModal.close();
    guestbookModal.close();
    controlsModal.close();
    roomRushModal.close();
    roomRushResultModal.close();
    chatModerationModal.close();
    void aboutModal.open();
  });

  setupGameMenu(() => { closeWorldPanels(); historyModal.close(); }, doc, doc.defaultView ?? window);
  doc.getElementById('btn-world-settings')?.addEventListener('click', () => {
    closeMenu(); closeWorldPanels(); doc.getElementById('btn-chat-close')?.click(); settingsModal.open();
  });
  doc.getElementById('btn-menu-chat')?.addEventListener('click', () => {
    closeMenu(); closeWorldPanels(); doc.getElementById('btn-chat-toggle')?.click();
  });
  doc.getElementById('btn-world-controls')?.addEventListener('click', () => {
    closeMenu();
    closeWorldPanels();
    void controlsModal.open();
  });

  chatModerationOpenBtn?.addEventListener('click', () => {
    closeMenu();
    historyModal.close();
    leaderboardModal.close();
    exploreModal.close();
    guestbookModal.close();
    controlsModal.close();
    aboutModal.close();
    roomRushModal.close();
    roomRushResultModal.close();
    void chatModerationModal.open();
  });

  worldJumpInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      handleWorldJump();
    }
  });

  courseSaveBtn?.addEventListener('click', asyncListener(async () => {
    controlsModal.close();
    aboutModal.close();
    chatModerationModal.close();
    exploreModal.close();
    roomRushResultModal.close();
    const editorScene = getActiveCourseWorkspaceScene(game);
    if (editorScene) {
      await editorScene.saveCourseDraft();
    }
  }));

  coursePublishBtn?.addEventListener('click', asyncListener(async () => {
    controlsModal.close();
    aboutModal.close();
    chatModerationModal.close();
    roomRushResultModal.close();
    const editorScene = getActiveCourseWorkspaceScene(game);
    if (editorScene) {
      await editorScene.publishCourseDraft();
    }
  }));
}

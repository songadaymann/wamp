import Phaser from 'phaser';
import { AboutModalController } from './aboutModal';
import { ChatModerationModalController } from './chatModerationModal';
import { ControlsModalController } from './controlsModal';
import { CourseModalController } from './courseModal';
import { ExploreModalController } from './exploreModal';
import { GuestbookModalController } from './guestbookModal';
import { RoomHistoryModalController } from './historyModal';
import { LeaderboardModalController } from './leaderboardModal';
import { RoomRushModalController } from './roomRushModal';
import { RoomRushResultModalController } from './roomRushResultModal';
import {
  getActiveEditorScene,
  getActiveOverworldScene,
  getOverworldScene,
} from './sceneBridge';
import { configureOverworldHudBridgeRuntime } from '../../scenes/overworld/hud';

export function setupSceneCommands(
  game: Phaser.Game,
  historyModal: RoomHistoryModalController,
  leaderboardModal: LeaderboardModalController,
  exploreModal: ExploreModalController,
  guestbookModal: GuestbookModalController,
  controlsModal: ControlsModalController,
  aboutModal: AboutModalController,
  chatModerationModal: ChatModerationModalController,
  courseModal: CourseModalController,
  roomRushModal: RoomRushModalController,
  roomRushResultModal: RoomRushResultModalController,
  doc: Document = document,
): void {
  const authPanel = doc.getElementById('auth-panel');
  const aboutOpenBtn = doc.getElementById('btn-about-open');
  const chatModerationOpenBtn = doc.getElementById('btn-chat-moderation-open');
  const worldJumpInput = doc.getElementById('world-jump-input') as HTMLInputElement | null;
  const editorBackBtn = doc.getElementById('btn-editor-back');
  const playBtn = doc.getElementById('btn-test-play');
  const saveBtn = doc.getElementById('btn-save-draft');
  const publishBtn = doc.getElementById('btn-publish-room');
  const publishNudgeBtn = doc.getElementById('btn-editor-publish-nudge');
  const historyBtn = doc.getElementById('btn-room-history');
  const mintBtn = doc.getElementById('btn-mint-room');
  const refreshMetadataBtn = doc.getElementById('btn-refresh-room-metadata');
  const fitBtn = doc.getElementById('btn-fit-screen');
  const mobileFitBtn = doc.getElementById('btn-mobile-editor-fit');
  const mobileZoomInBtn = doc.getElementById('btn-mobile-editor-zoom-in');
  const mobileZoomOutBtn = doc.getElementById('btn-mobile-editor-zoom-out');
  const courseSaveBtn = doc.getElementById('btn-course-editor-save-course');
  const coursePublishBtn = doc.getElementById('btn-course-editor-publish-course');

  const closeMenu = () => {
    authPanel?.classList.remove('menu-open');
  };
  const closeWorldPanels = () => {
    leaderboardModal.close();
    exploreModal.close();
    guestbookModal.close();
    controlsModal.close();
    aboutModal.close();
    courseModal.close();
    roomRushModal.close();
    roomRushResultModal.close();
    chatModerationModal.close();
    getActiveOverworldScene(game)?.closeRoomCommentComposer?.();
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
    if (!overworldScene?.openRoomChatComposer || overworldScene.isRoomChatComposerOpen?.()) {
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
    if (!overworldScene?.openRoomCommentComposer || overworldScene.isRoomCommentComposerOpen?.()) {
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

  doc.addEventListener('keydown', handleRoomChatShortcut, { capture: true });
  doc.addEventListener('keydown', handleRoomCommentShortcut, { capture: true });

  configureOverworldHudBridgeRuntime({
    onPlayRoom: () => {
      closeWorldPanels();
      getActiveOverworldScene(game)?.playSelectedRoom?.();
    },
    onRestartRun: () => {
      closeWorldPanels();
      void getActiveOverworldScene(game)?.restartCurrentRun?.();
    },
    onPlayCourse: () => {
      closeWorldPanels();
      void getActiveOverworldScene(game)?.playSelectedCourse?.();
    },
    onEditRoom: () => {
      closeWorldPanels();
      getActiveOverworldScene(game)?.editSelectedRoom?.();
    },
    onBuildRoom: () => {
      closeWorldPanels();
      getActiveOverworldScene(game)?.buildSelectedRoom?.();
    },
    onOpenCourseBuilder: () => {
      closeWorldPanels();
      void (getActiveOverworldScene(game)?.openCourseEditor?.() ??
        getActiveOverworldScene(game)?.openCourseComposer?.());
    },
    onJumpToCoordinates: (coordinates) => {
      void getActiveOverworldScene(game)?.jumpToCoordinates?.(coordinates);
    },
    onZoomIn: () => {
      getActiveOverworldScene(game)?.zoomIn?.();
    },
    onZoomOut: () => {
      getActiveOverworldScene(game)?.zoomOut?.();
    },
    onOpenExplore: () => {
      leaderboardModal.close();
      guestbookModal.close();
      controlsModal.close();
      aboutModal.close();
      courseModal.close();
      roomRushModal.close();
      roomRushResultModal.close();
      chatModerationModal.close();
      void exploreModal.open();
    },
    onOpenLeaderboard: () => {
      exploreModal.close();
      guestbookModal.close();
      controlsModal.close();
      aboutModal.close();
      courseModal.close();
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
      controlsModal.close();
      aboutModal.close();
      courseModal.close();
      chatModerationModal.close();
      roomRushResultModal.close();
      const scene = getActiveOverworldScene(game);
      if (scene?.isRoomRushRunActive?.()) {
        scene.endRoomRushRun?.();
        return;
      }
      roomRushModal.open();
    },
    onInvitePvp: (entry) => {
      leaderboardModal.close();
      exploreModal.close();
      guestbookModal.close();
      historyModal.close();
      controlsModal.close();
      aboutModal.close();
      courseModal.close();
      roomRushModal.close();
      roomRushResultModal.close();
      chatModerationModal.close();
      getActiveOverworldScene(game)?.invitePvpDuel?.(entry);
    },
    onOpenRoomComment: () => {
      leaderboardModal.close();
      exploreModal.close();
      guestbookModal.close();
      historyModal.close();
      controlsModal.close();
      aboutModal.close();
      courseModal.close();
      roomRushModal.close();
      roomRushResultModal.close();
      chatModerationModal.close();
      getActiveOverworldScene(game)?.openRoomCommentComposer?.();
    },
    onToggleRoomComments: () => {
      leaderboardModal.close();
      exploreModal.close();
      guestbookModal.close();
      historyModal.close();
      controlsModal.close();
      aboutModal.close();
      courseModal.close();
      roomRushModal.close();
      roomRushResultModal.close();
      chatModerationModal.close();
      getActiveOverworldScene(game)?.toggleRoomComments?.();
    },
    onOpenControls: () => {
      leaderboardModal.close();
      exploreModal.close();
      guestbookModal.close();
      historyModal.close();
      aboutModal.close();
      courseModal.close();
      roomRushModal.close();
      roomRushResultModal.close();
      chatModerationModal.close();
      controlsModal.open();
    },
    onFitWorld: () => {
      if (game.scene.isActive('EditorScene')) {
        return;
      }

      controlsModal.close();
      guestbookModal.close();
      aboutModal.close();
      courseModal.close();
      roomRushModal.close();
      roomRushResultModal.close();
      chatModerationModal.close();
      getActiveOverworldScene(game)?.fitLoadedWorld?.();
    },
  });

  aboutOpenBtn?.addEventListener('click', () => {
    closeMenu();
    historyModal.close();
    leaderboardModal.close();
    exploreModal.close();
    guestbookModal.close();
    controlsModal.close();
    courseModal.close();
    roomRushModal.close();
    roomRushResultModal.close();
    chatModerationModal.close();
    aboutModal.open();
  });

  chatModerationOpenBtn?.addEventListener('click', () => {
    closeMenu();
    historyModal.close();
    leaderboardModal.close();
    exploreModal.close();
    guestbookModal.close();
    controlsModal.close();
    aboutModal.close();
    courseModal.close();
    roomRushModal.close();
    roomRushResultModal.close();
    void chatModerationModal.open();
  });

  worldJumpInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      handleWorldJump();
    }
  });

  playBtn?.addEventListener('click', () => {
    historyModal.close();
    leaderboardModal.close();
    exploreModal.close();
    guestbookModal.close();
    controlsModal.close();
    aboutModal.close();
    courseModal.close();
    roomRushResultModal.close();
    chatModerationModal.close();
    getActiveEditorScene(game)?.startPlayMode?.();
  });

  editorBackBtn?.addEventListener('click', () => {
    historyModal.close();
    leaderboardModal.close();
    exploreModal.close();
    controlsModal.close();
    aboutModal.close();
    courseModal.close();
    roomRushResultModal.close();
    chatModerationModal.close();
    const editorScene = getActiveEditorScene(game);
    const canReturnToCourseBuilder = editorScene?.getCourseEditorState?.().canReturnToCourseBuilder ?? false;
    if (canReturnToCourseBuilder && editorScene?.returnToCourseBuilder) {
      void editorScene.returnToCourseBuilder();
      return;
    }

    if (editorScene?.returnToWorld) {
      void editorScene.returnToWorld();
      return;
    }

    getActiveOverworldScene(game)?.returnToWorld?.();
  });

  saveBtn?.addEventListener('click', async () => {
    controlsModal.close();
    aboutModal.close();
    courseModal.close();
    chatModerationModal.close();
    exploreModal.close();
    roomRushResultModal.close();
    const editorScene = getActiveEditorScene(game);
    if (editorScene?.saveDraft) {
      await editorScene.saveDraft(true, { promptForSignInOnUnauthorized: true });
    }
  });

  publishBtn?.addEventListener('click', async () => {
    controlsModal.close();
    aboutModal.close();
    courseModal.close();
    chatModerationModal.close();
    exploreModal.close();
    roomRushResultModal.close();
    const editorScene = getActiveEditorScene(game);
    if (editorScene?.publishRoom) {
      await editorScene.publishRoom();
    }
  });

  courseSaveBtn?.addEventListener('click', async () => {
    controlsModal.close();
    aboutModal.close();
    courseModal.close();
    chatModerationModal.close();
    exploreModal.close();
    roomRushResultModal.close();
    const editorScene = getActiveEditorScene(game);
    if (editorScene?.saveCourseDraft) {
      await editorScene.saveCourseDraft();
    }
  });

  coursePublishBtn?.addEventListener('click', async () => {
    controlsModal.close();
    aboutModal.close();
    courseModal.close();
    chatModerationModal.close();
    roomRushResultModal.close();
    const editorScene = getActiveEditorScene(game);
    if (editorScene?.publishCourseDraft) {
      await editorScene.publishCourseDraft();
    }
  });

  publishNudgeBtn?.addEventListener('click', async () => {
    controlsModal.close();
    aboutModal.close();
    courseModal.close();
    chatModerationModal.close();
    const editorScene = getActiveEditorScene(game);
    if (editorScene?.handlePublishNudgeAction) {
      await editorScene.handlePublishNudgeAction();
    }
  });

  mintBtn?.addEventListener('click', async () => {
    controlsModal.close();
    aboutModal.close();
    courseModal.close();
    chatModerationModal.close();
    const editorScene = getActiveEditorScene(game);
    if (editorScene?.mintRoom) {
      await editorScene.mintRoom();
    }
  });

  refreshMetadataBtn?.addEventListener('click', async () => {
    controlsModal.close();
    aboutModal.close();
    courseModal.close();
    chatModerationModal.close();
    const editorScene = getActiveEditorScene(game);
    if (editorScene?.refreshMintMetadata) {
      await editorScene.refreshMintMetadata();
    }
  });

  historyBtn?.addEventListener('click', () => {
    controlsModal.close();
    aboutModal.close();
    courseModal.close();
    chatModerationModal.close();
    void historyModal.open();
  });

  fitBtn?.addEventListener('click', () => {
    const editorScene = getActiveEditorScene(game);
    if (editorScene?.fitToScreen) {
      editorScene.fitToScreen();
      return;
    }

    controlsModal.close();
    aboutModal.close();
    courseModal.close();
    chatModerationModal.close();
    getActiveOverworldScene(game)?.fitLoadedWorld?.();
  });

  mobileFitBtn?.addEventListener('click', () => {
    getActiveEditorScene(game)?.fitToScreen?.();
  });

  mobileZoomInBtn?.addEventListener('click', () => {
    getActiveEditorScene(game)?.zoomIn?.();
  });

  mobileZoomOutBtn?.addEventListener('click', () => {
    getActiveEditorScene(game)?.zoomOut?.();
  });
}

import Phaser from 'phaser';
import { AboutModalController } from './aboutModal';
import { ChatModerationModalController } from './chatModerationModal';
import { ControlsModalController } from './controlsModal';
import { CourseModalController } from './courseModal';
import { RoomHistoryModalController } from './historyModal';
import { LeaderboardModalController } from './leaderboardModal';
import {
  getActiveEditorScene,
  getActiveOverworldScene,
} from './sceneBridge';
import { configureOverworldHudBridgeRuntime } from '../../scenes/overworld/hud';

export function setupSceneCommands(
  game: Phaser.Game,
  historyModal: RoomHistoryModalController,
  leaderboardModal: LeaderboardModalController,
  controlsModal: ControlsModalController,
  aboutModal: AboutModalController,
  chatModerationModal: ChatModerationModalController,
  courseModal: CourseModalController,
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
    controlsModal.close();
    aboutModal.close();
    courseModal.close();
    chatModerationModal.close();
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

  configureOverworldHudBridgeRuntime({
    onPlayRoom: () => {
      closeWorldPanels();
      getActiveOverworldScene(game)?.playSelectedRoom?.();
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
    onOpenLeaderboard: () => {
      controlsModal.close();
      aboutModal.close();
      courseModal.close();
      chatModerationModal.close();
      void leaderboardModal.open();
    },
    onOpenControls: () => {
      leaderboardModal.close();
      historyModal.close();
      aboutModal.close();
      courseModal.close();
      chatModerationModal.close();
      controlsModal.open();
    },
    onFitWorld: () => {
      if (game.scene.isActive('EditorScene')) {
        return;
      }

      controlsModal.close();
      aboutModal.close();
      courseModal.close();
      chatModerationModal.close();
      getActiveOverworldScene(game)?.fitLoadedWorld?.();
    },
  });

  aboutOpenBtn?.addEventListener('click', () => {
    closeMenu();
    historyModal.close();
    leaderboardModal.close();
    controlsModal.close();
    courseModal.close();
    chatModerationModal.close();
    aboutModal.open();
  });

  chatModerationOpenBtn?.addEventListener('click', () => {
    closeMenu();
    historyModal.close();
    leaderboardModal.close();
    controlsModal.close();
    aboutModal.close();
    courseModal.close();
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
    controlsModal.close();
    aboutModal.close();
    courseModal.close();
    chatModerationModal.close();
    getActiveEditorScene(game)?.startPlayMode?.();
  });

  editorBackBtn?.addEventListener('click', () => {
    historyModal.close();
    leaderboardModal.close();
    controlsModal.close();
    aboutModal.close();
    courseModal.close();
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

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
  const worldPlayBtn = doc.getElementById('btn-world-play');
  const worldEditBtn = doc.getElementById('btn-world-edit');
  const worldBuildBtn = doc.getElementById('btn-world-build');
  const worldJumpBtn = doc.getElementById('btn-world-jump');
  const worldZoomInBtn = doc.getElementById('btn-world-zoom-in-footer');
  const worldZoomOutBtn = doc.getElementById('btn-world-zoom-out-footer');
  const worldLeaderboardBtn = doc.getElementById('btn-world-leaderboard');
  const worldPlayCourseBtn = doc.getElementById('btn-world-play-course');
  const worldCourseBuilderBtn = doc.getElementById('btn-world-course-builder');
  const worldControlsBtn = doc.getElementById('btn-world-controls');
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

  const closeMenu = () => {
    authPanel?.classList.remove('menu-open');
  };

  worldPlayBtn?.addEventListener('click', () => {
    leaderboardModal.close();
    controlsModal.close();
    aboutModal.close();
    courseModal.close();
    chatModerationModal.close();
    getActiveOverworldScene(game)?.playSelectedRoom?.();
  });

  worldPlayCourseBtn?.addEventListener('click', () => {
    leaderboardModal.close();
    controlsModal.close();
    aboutModal.close();
    chatModerationModal.close();
    void getActiveOverworldScene(game)?.playSelectedCourse?.();
  });

  worldEditBtn?.addEventListener('click', () => {
    leaderboardModal.close();
    controlsModal.close();
    aboutModal.close();
    courseModal.close();
    chatModerationModal.close();
    getActiveOverworldScene(game)?.editSelectedRoom?.();
  });

  worldBuildBtn?.addEventListener('click', () => {
    leaderboardModal.close();
    controlsModal.close();
    aboutModal.close();
    courseModal.close();
    chatModerationModal.close();
    getActiveOverworldScene(game)?.buildSelectedRoom?.();
  });

  worldCourseBuilderBtn?.addEventListener('click', () => {
    leaderboardModal.close();
    controlsModal.close();
    aboutModal.close();
    chatModerationModal.close();
    void getActiveOverworldScene(game)?.openCourseComposer?.();
    courseModal.open();
  });

  worldZoomInBtn?.addEventListener('click', () => {
    getActiveOverworldScene(game)?.zoomIn?.();
  });

  worldZoomOutBtn?.addEventListener('click', () => {
    getActiveOverworldScene(game)?.zoomOut?.();
  });

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

  worldJumpBtn?.addEventListener('click', handleWorldJump);
  worldLeaderboardBtn?.addEventListener('click', () => {
    controlsModal.close();
    aboutModal.close();
    courseModal.close();
    chatModerationModal.close();
    void leaderboardModal.open();
  });
  worldControlsBtn?.addEventListener('click', () => {
    leaderboardModal.close();
    historyModal.close();
    aboutModal.close();
    courseModal.close();
    chatModerationModal.close();
    controlsModal.open();
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

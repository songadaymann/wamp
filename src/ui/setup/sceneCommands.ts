import Phaser from 'phaser';
import { AboutModalController } from './aboutModal';
import { ChatModerationModalController } from './chatModerationModal';
import { ControlsModalController } from './controlsModal';
import { CourseModalController } from './courseModal';
import { RoomHistoryModalController } from './historyModal';
import { LeaderboardModalController } from './leaderboardModal';
import {
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
  const fitBtn = doc.getElementById('btn-fit-screen');

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
    courseModal.close();
    void (getActiveOverworldScene(game)?.openCourseEditor?.() ??
      getActiveOverworldScene(game)?.openCourseComposer?.());
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

  fitBtn?.addEventListener('click', () => {
    if (game.scene.isActive('EditorScene')) {
      return;
    }

    controlsModal.close();
    aboutModal.close();
    courseModal.close();
    chatModerationModal.close();
    getActiveOverworldScene(game)?.fitLoadedWorld?.();
  });
}

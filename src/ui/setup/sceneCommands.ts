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
}

import Phaser from 'phaser';
import { ControlsModalController } from './controlsModal';
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
  doc: Document = document,
): void {
  const worldPlayBtn = doc.getElementById('btn-world-play');
  const worldEditBtn = doc.getElementById('btn-world-edit');
  const worldBuildBtn = doc.getElementById('btn-world-build');
  const worldJumpBtn = doc.getElementById('btn-world-jump');
  const worldZoomInBtn = doc.getElementById('btn-world-zoom-in-footer');
  const worldZoomOutBtn = doc.getElementById('btn-world-zoom-out-footer');
  const worldLeaderboardBtn = doc.getElementById('btn-world-leaderboard');
  const worldControlsBtn = doc.getElementById('btn-world-controls');
  const worldJumpInput = doc.getElementById('world-jump-input') as HTMLInputElement | null;
  const backToWorldBtn = doc.getElementById('btn-back-to-world');
  const playBtn = doc.getElementById('btn-test-play');
  const saveBtn = doc.getElementById('btn-save-draft');
  const publishBtn = doc.getElementById('btn-publish-room');
  const historyBtn = doc.getElementById('btn-room-history');
  const mintBtn = doc.getElementById('btn-mint-room');
  const fitBtn = doc.getElementById('btn-fit-screen');
  const mobileFitBtn = doc.getElementById('btn-mobile-editor-fit');
  const mobileZoomInBtn = doc.getElementById('btn-mobile-editor-zoom-in');
  const mobileZoomOutBtn = doc.getElementById('btn-mobile-editor-zoom-out');

  worldPlayBtn?.addEventListener('click', () => {
    leaderboardModal.close();
    controlsModal.close();
    getActiveOverworldScene(game)?.playSelectedRoom?.();
  });

  worldEditBtn?.addEventListener('click', () => {
    leaderboardModal.close();
    controlsModal.close();
    getActiveOverworldScene(game)?.editSelectedRoom?.();
  });

  worldBuildBtn?.addEventListener('click', () => {
    leaderboardModal.close();
    controlsModal.close();
    getActiveOverworldScene(game)?.buildSelectedRoom?.();
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
    void leaderboardModal.open();
  });
  worldControlsBtn?.addEventListener('click', () => {
    leaderboardModal.close();
    historyModal.close();
    controlsModal.open();
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
    getActiveEditorScene(game)?.startPlayMode?.();
  });

  backToWorldBtn?.addEventListener('click', () => {
    historyModal.close();
    leaderboardModal.close();
    controlsModal.close();
    const editorScene = getActiveEditorScene(game);
    if (editorScene?.returnToWorld) {
      void editorScene.returnToWorld();
      return;
    }

    getActiveOverworldScene(game)?.returnToWorld?.();
  });

  saveBtn?.addEventListener('click', async () => {
    controlsModal.close();
    const editorScene = getActiveEditorScene(game);
    if (editorScene?.saveDraft) {
      await editorScene.saveDraft(true);
    }
  });

  publishBtn?.addEventListener('click', async () => {
    controlsModal.close();
    const editorScene = getActiveEditorScene(game);
    if (editorScene?.publishRoom) {
      await editorScene.publishRoom();
    }
  });

  mintBtn?.addEventListener('click', async () => {
    controlsModal.close();
    const editorScene = getActiveEditorScene(game);
    if (editorScene?.mintRoom) {
      await editorScene.mintRoom();
    }
  });

  historyBtn?.addEventListener('click', () => {
    controlsModal.close();
    void historyModal.open();
  });

  fitBtn?.addEventListener('click', () => {
    const editorScene = getActiveEditorScene(game);
    if (editorScene?.fitToScreen) {
      editorScene.fitToScreen();
      return;
    }

    controlsModal.close();
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

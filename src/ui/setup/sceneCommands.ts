import Phaser from 'phaser';
import { AboutModalController } from './aboutModal';
import { ChatModerationModalController } from './chatModerationModal';
import { ControlsModalController } from './controlsModal';
import { CourseModalController } from './courseModal';
import { RoomHistoryModalController } from './historyModal';
import { LeaderboardModalController } from './leaderboardModal';
import { getActiveEditorScene, getActiveOverworldScene } from './sceneBridge';

type CommandHandler = () => void | Promise<void>;

export interface SceneCommandModals {
  historyModal: RoomHistoryModalController;
  leaderboardModal: LeaderboardModalController;
  controlsModal: ControlsModalController;
  aboutModal: AboutModalController;
  chatModerationModal: ChatModerationModalController;
  courseModal: CourseModalController;
}

interface SceneCommandBindingContext {
  game: Phaser.Game;
  modals: SceneCommandModals;
  closeMenu: () => void;
}

export function setupSceneCommands(
  game: Phaser.Game,
  modals: SceneCommandModals,
  doc: Document = document
): void {
  const authPanel = doc.getElementById('auth-panel');
  const closeMenu = () => {
    authPanel?.classList.remove('menu-open');
  };

  const context: SceneCommandBindingContext = {
    game,
    modals,
    closeMenu,
  };

  bindClick(doc, 'btn-world-play', () => {
    closeWorldPanels(modals);
    getActiveOverworldScene(game)?.playSelectedRoom?.();
  });

  bindClick(doc, 'btn-world-play-course', () => {
    closePanels(
      modals.leaderboardModal,
      modals.controlsModal,
      modals.aboutModal,
      modals.chatModerationModal
    );
    void getActiveOverworldScene(game)?.playSelectedCourse?.();
  });

  bindClick(doc, 'btn-world-edit', () => {
    closeWorldPanels(modals);
    getActiveOverworldScene(game)?.editSelectedRoom?.();
  });

  bindClick(doc, 'btn-world-build', () => {
    closeWorldPanels(modals);
    getActiveOverworldScene(game)?.buildSelectedRoom?.();
  });

  bindClick(doc, 'btn-world-course-builder', () => {
    closePanels(
      modals.leaderboardModal,
      modals.controlsModal,
      modals.aboutModal,
      modals.chatModerationModal
    );
    void getActiveOverworldScene(game)?.openCourseComposer?.();
    modals.courseModal.open();
  });

  bindClick(doc, 'btn-world-zoom-in-footer', () => {
    getActiveOverworldScene(game)?.zoomIn?.();
  });

  bindClick(doc, 'btn-world-zoom-out-footer', () => {
    getActiveOverworldScene(game)?.zoomOut?.();
  });

  bindClick(doc, 'btn-world-jump', () => {
    void handleWorldJump(doc, game);
  });
  bindEnter(doc, 'world-jump-input', () => {
    void handleWorldJump(doc, game);
  });

  bindClick(doc, 'btn-world-leaderboard', () => {
    closePanels(
      modals.controlsModal,
      modals.aboutModal,
      modals.courseModal,
      modals.chatModerationModal
    );
    void modals.leaderboardModal.open();
  });

  bindClick(doc, 'btn-world-controls', () => {
    closePanels(
      modals.leaderboardModal,
      modals.historyModal,
      modals.aboutModal,
      modals.courseModal,
      modals.chatModerationModal
    );
    modals.controlsModal.open();
  });

  bindClick(doc, 'btn-about-open', () => {
    context.closeMenu();
    closePanels(
      modals.historyModal,
      modals.leaderboardModal,
      modals.controlsModal,
      modals.courseModal,
      modals.chatModerationModal
    );
    modals.aboutModal.open();
  });

  bindClick(doc, 'btn-chat-moderation-open', () => {
    context.closeMenu();
    closePanels(
      modals.historyModal,
      modals.leaderboardModal,
      modals.controlsModal,
      modals.aboutModal,
      modals.courseModal
    );
    void modals.chatModerationModal.open();
  });

  bindClick(doc, 'btn-test-play', () => {
    closeEditorPanels(modals);
    getActiveEditorScene(game)?.startPlayMode?.();
  });

  bindClick(doc, 'btn-editor-back', () => {
    closeEditorPanels(modals);
    void returnFromEditor(game);
  });

  bindClick(doc, 'btn-save-draft', async () => {
    closePanels(modals.controlsModal, modals.aboutModal, modals.courseModal, modals.chatModerationModal);
    const editorScene = getActiveEditorScene(game);
    if (editorScene?.saveDraft) {
      await editorScene.saveDraft(true, { promptForSignInOnUnauthorized: true });
    }
  });

  bindClick(doc, 'btn-publish-room', async () => {
    closePanels(modals.controlsModal, modals.aboutModal, modals.courseModal, modals.chatModerationModal);
    await getActiveEditorScene(game)?.publishRoom?.();
  });

  bindClick(doc, 'btn-editor-publish-nudge', async () => {
    closePanels(modals.controlsModal, modals.aboutModal, modals.courseModal, modals.chatModerationModal);
    await getActiveEditorScene(game)?.handlePublishNudgeAction?.();
  });

  bindClick(doc, 'btn-mint-room', async () => {
    closePanels(modals.controlsModal, modals.aboutModal, modals.courseModal, modals.chatModerationModal);
    await getActiveEditorScene(game)?.mintRoom?.();
  });

  bindClick(doc, 'btn-refresh-room-metadata', async () => {
    closePanels(modals.controlsModal, modals.aboutModal, modals.courseModal, modals.chatModerationModal);
    await getActiveEditorScene(game)?.refreshMintMetadata?.();
  });

  bindClick(doc, 'btn-room-history', () => {
    closePanels(modals.controlsModal, modals.aboutModal, modals.courseModal, modals.chatModerationModal);
    void modals.historyModal.open();
  });

  bindClick(doc, 'btn-fit-screen', () => {
    const editorScene = getActiveEditorScene(game);
    if (editorScene?.fitToScreen) {
      editorScene.fitToScreen();
      return;
    }

    closePanels(modals.controlsModal, modals.aboutModal, modals.courseModal, modals.chatModerationModal);
    getActiveOverworldScene(game)?.fitLoadedWorld?.();
  });

  bindClick(doc, 'btn-mobile-editor-fit', () => {
    getActiveEditorScene(game)?.fitToScreen?.();
  });
  bindClick(doc, 'btn-mobile-editor-zoom-in', () => {
    getActiveEditorScene(game)?.zoomIn?.();
  });
  bindClick(doc, 'btn-mobile-editor-zoom-out', () => {
    getActiveEditorScene(game)?.zoomOut?.();
  });
}

function bindClick(doc: Document, id: string, handler: CommandHandler): void {
  doc.getElementById(id)?.addEventListener('click', () => {
    void handler();
  });
}

function bindEnter(doc: Document, id: string, handler: CommandHandler): void {
  const element = doc.getElementById(id);
  if (!(element instanceof HTMLInputElement)) {
    return;
  }

  element.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') {
      return;
    }

    event.preventDefault();
    void handler();
  });
}

function closePanels(...controllers: Array<{ close: () => void }>): void {
  for (const controller of controllers) {
    controller.close();
  }
}

function closeWorldPanels(modals: SceneCommandModals): void {
  closePanels(
    modals.leaderboardModal,
    modals.controlsModal,
    modals.aboutModal,
    modals.courseModal,
    modals.chatModerationModal
  );
}

function closeEditorPanels(modals: SceneCommandModals): void {
  closePanels(
    modals.historyModal,
    modals.leaderboardModal,
    modals.controlsModal,
    modals.aboutModal,
    modals.courseModal,
    modals.chatModerationModal
  );
}

async function handleWorldJump(doc: Document, game: Phaser.Game): Promise<void> {
  const overworldScene = getActiveOverworldScene(game);
  const worldJumpInput = doc.getElementById('world-jump-input');
  if (!overworldScene?.jumpToCoordinates || !(worldJumpInput instanceof HTMLInputElement)) {
    return;
  }

  const match = /^\s*(-?\d+)\s*,\s*(-?\d+)\s*$/.exec(worldJumpInput.value);
  if (!match) {
    return;
  }

  await overworldScene.jumpToCoordinates({
    x: Number(match[1]),
    y: Number(match[2]),
  });
}

async function returnFromEditor(game: Phaser.Game): Promise<void> {
  const editorScene = getActiveEditorScene(game);
  const canReturnToCourseBuilder =
    editorScene?.getCourseEditorState?.().canReturnToCourseBuilder ?? false;
  if (canReturnToCourseBuilder && editorScene?.returnToCourseBuilder) {
    await editorScene.returnToCourseBuilder();
    return;
  }

  if (editorScene?.returnToWorld) {
    await editorScene.returnToWorld();
    return;
  }

  getActiveOverworldScene(game)?.returnToWorld?.();
}

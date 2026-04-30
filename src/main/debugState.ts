import Phaser from 'phaser';

const SCENE_DEBUG_ORDER = ['CourseEditorScene', 'CourseComposerScene', 'OverworldPlayScene', 'EditorScene', 'BootScene'];

export function getGameDebugState(game: Phaser.Game): Record<string, unknown> {
  for (const sceneKey of SCENE_DEBUG_ORDER) {
    if (!game.scene.isActive(sceneKey)) continue;

    const scene = game.scene.getScene(sceneKey) as {
      describeState?: () => Record<string, unknown>;
    };

    if (scene.describeState) {
      return scene.describeState();
    }

    return { scene: sceneKey };
  }

  for (const sceneKey of SCENE_DEBUG_ORDER) {
    if (!game.scene.isPaused(sceneKey) && !game.scene.isSleeping(sceneKey)) continue;

    const scene = game.scene.getScene(sceneKey) as {
      describeState?: () => Record<string, unknown>;
    };

    if (scene.describeState) {
      return scene.describeState();
    }

    return { scene: sceneKey };
  }

  return { scene: 'none' };
}

export function getSwordHunterDebugState(game: Phaser.Game): Record<string, unknown> {
  const activeScene = getGameDebugState(game);
  const liveObjects = Array.isArray(activeScene.liveObjects)
    ? activeScene.liveObjects
    : null;

  return {
    scene: typeof activeScene.scene === 'string' ? activeScene.scene : 'unknown',
    available: liveObjects !== null,
    swordsmen:
      liveObjects?.filter(
        (liveObject): liveObject is Record<string, unknown> =>
          Boolean(liveObject) &&
          typeof liveObject === 'object' &&
          liveObject.id === 'swordsman_ai',
      ) ?? [],
  };
}

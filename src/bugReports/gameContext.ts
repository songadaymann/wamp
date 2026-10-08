import type Phaser from 'phaser';
import { normalizeBugContext, type BugContext } from './model';

const SCENES = ['CourseEditorScene', 'CourseComposerScene', 'EditorScene', 'OverworldPlayScene'];
type ContextGame = { scene: {
  isActive(key: string): boolean;
  isPaused(key: string): boolean;
  getScene(key: string): unknown;
} };
type BugScene = {
  getBugReportContext?: () => Record<string, unknown>;
  canCaptureBugReportImages?: () => boolean;
};
function contextScene(game: ContextGame): BugScene | null {
  // An editor stays paused during Test; the running play scene owns that report.
  for (const running of [true, false]) {
    for (const key of SCENES) {
      if (running ? !game.scene.isActive(key) : !game.scene.isPaused(key)) continue;
      const scene = game.scene.getScene(key) as BugScene;
      if (scene.getBugReportContext) return scene;
    }
  }
  return null;
}
export function readBugGameContext(game: ContextGame): BugContext {
  return normalizeBugContext(contextScene(game)?.getBugReportContext?.());
}
export function canCaptureBugReportImages(game: ContextGame): boolean {
  // Paused scenes can still render. Avoid every canvas frame containing a chat bubble.
  for (const key of SCENES) {
    if (!game.scene.isActive(key) && !game.scene.isPaused(key)) continue;
    const scene = game.scene.getScene(key) as BugScene;
    if (scene.canCaptureBugReportImages?.() === false) return false;
  }
  return true;
}
export function pauseForBugReport(game: Phaser.Game): () => void {
  const paused = game.scene.getScenes(true).map(scene => scene.sys.settings.key);
  for (const key of paused) { game.scene.getScene(key).input.keyboard?.resetKeys(); game.scene.pause(key); }
  return () => {
    for (const key of paused) {
      if (!game.scene.isPaused(key)) continue;
      game.scene.getScene(key).input.keyboard?.resetKeys(); game.scene.resume(key);
    }
  };
}

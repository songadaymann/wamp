import { expect, it } from 'vitest';
import { canCaptureBugReportImages, readBugGameContext } from './gameContext';

function game(active: string[], paused: string[], blocked: string[] = []) {
  return { scene: {
    isActive: (key: string) => active.includes(key),
    isPaused: (key: string) => paused.includes(key),
    getScene: (key: string) => ({ canCaptureBugReportImages: () => !blocked.includes(key), getBugReportContext: () => ({
      scene: key, mode: key === 'OverworldPlayScene' ? 'play' : 'edit',
      source: key === 'OverworldPlayScene' ? 'published' : 'draft',
    }) }),
  } };
}

it('reports active gameplay when the builder remains paused during Test', () => {
  const context = readBugGameContext(game(['OverworldPlayScene'], ['EditorScene']));
  expect(context).toMatchObject({ scene: 'OverworldPlayScene', mode: 'play', source: 'published' });
});

it('retains paused scene context after opening the report dialog', () => {
  expect(readBugGameContext(game([], ['CourseEditorScene']))).toMatchObject({
    scene: 'CourseEditorScene', mode: 'edit', source: 'draft',
  });
});

it('returns unknown context when no gameplay or editor scene is available', () => {
  expect(readBugGameContext(game([], []))).toMatchObject({ scene: 'unknown', mode: 'browse', source: 'unknown' });
});

it('blocks canvas capture while the active play scene renders chat bubbles', () => {
  const host = game(['OverworldPlayScene'], ['EditorScene'], ['OverworldPlayScene']);
  expect(canCaptureBugReportImages(host)).toBe(false);
  expect(readBugGameContext(host)).toMatchObject({ mode: 'play', source: 'published' });
});

it('also blocks chat in a paused scene because paused scenes can still render', () => {
  expect(canCaptureBugReportImages(game(['EditorScene'], ['OverworldPlayScene'], ['OverworldPlayScene']))).toBe(false);
});

it('ignores chat in a stopped scene which cannot render', () => {
  expect(canCaptureBugReportImages(game(['EditorScene'], [], ['OverworldPlayScene']))).toBe(true);
});

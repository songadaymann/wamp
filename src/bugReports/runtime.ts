import type Phaser from 'phaser';
import { REPLAY_ACTIONS, type ReplayAction } from '../analytics/replay/model';
import { REPLAY_EDITOR_EVENT } from '../analytics/replay/editorEvents';
import { captureReplayCanvas } from '../analytics/replay/canvasCapture';
import { BUG_FRAME_LIMIT, BUG_RECORDING_CHANGED, normalizeBugDiagnostics, type BugDiagnostic } from './model';
import { RecentBugReplay } from './recentReplay';
import { bugRecordingAllowed } from './recordingPreference';
import { canCaptureBugReportImages, pauseForBugReport, readBugGameContext } from './gameContext';
import { initializeBugReportDialog } from './reporter';
import { resetTouchInputState } from '../ui/mobile/touchControls';

export function initializeBugReporter(game: Phaser.Game) {
  const replay = new RecentBugReplay(() => canCaptureBugReportImages(game) ? captureReplayCanvas(game.canvas, {
    width: document.body.dataset.deviceClass === 'phone' ? 320 : 480, height: 360, limit: BUG_FRAME_LIMIT,
  }) : Promise.resolve(null));
  const errors: BugDiagnostic[] = [], actions: ReplayAction[] = [];
  replay.setAllowed(bugRecordingAllowed());
  const dialog = initializeBugReportDialog({
    freeze: () => replay.freeze(), context: () => readBugGameContext(game), errors: () => [...errors],
    pause: () => { resetTouchInputState(); return pauseForBugReport(game); },
    resumeCapture: () => { resetTouchInputState(); replay.setFrozen(false); },
  });
  const frame = () => {
    if (document.visibilityState !== 'visible' || dialog.isOpen() || !bugRecordingAllowed()) return;
    replay.setPhone(document.body.dataset.deviceClass === 'phone');
    void replay.onFrame(() => readBugGameContext(game), actions).catch(() => {});
  };
  const append = (input: unknown) => { errors.push(...normalizeBugDiagnostics([input])); if (errors.length > 12) errors.shift(); };
  const runtimeError = (event: ErrorEvent) => {
    let source: string | null = null;
    try { const url = new URL(event.filename); if (url.origin === location.origin) source = url.pathname.replace(/^\//, ''); } catch { /* Untrusted source omitted. */ }
    append({ kind: 'runtime', source, line: event.lineno, column: event.colno, time: Math.round(performance.now()) });
  };
  const rejection = () => append({ kind: 'unhandled_rejection', time: Math.round(performance.now()) });
  const graphicsLost = () => append({ kind: 'graphics_lost', time: Math.round(performance.now()) });
  const editorAction = (event: Event) => {
    const action = (event as CustomEvent<ReplayAction>).detail;
    if (REPLAY_ACTIONS.includes(action) && actions.length < 12) actions.push(action);
  };
  const preference = () => replay.setAllowed(bugRecordingAllowed());
  game.events.on('postrender', frame);
  window.addEventListener('error', runtimeError); window.addEventListener('unhandledrejection', rejection);
  game.canvas.addEventListener('webglcontextlost', graphicsLost);
  window.addEventListener(REPLAY_EDITOR_EVENT, editorAction); window.addEventListener(BUG_RECORDING_CHANGED, preference);
  window.addEventListener('storage', preference);
  return { latestImage: () => replay.latestImage(), debug: () => replay.debug(), destroy(): void {
    dialog.destroy(); replay.destroy(); game.events.off('postrender', frame);
    window.removeEventListener('error', runtimeError); window.removeEventListener('unhandledrejection', rejection);
    game.canvas.removeEventListener('webglcontextlost', graphicsLost); window.removeEventListener(REPLAY_EDITOR_EVENT, editorAction);
    window.removeEventListener(BUG_RECORDING_CHANGED, preference); window.removeEventListener('storage', preference);
  } };
}

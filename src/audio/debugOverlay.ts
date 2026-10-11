import type { AudioEngine } from './engine';

const REFRESH_MS = 500;
const LOG_LINES = 14;

/**
 * With `?audiodebug` in the URL, shows the shared audio context's state and its recent
 * lifecycle events (page hidden/visible, interruptions, resumes) on screen, so a phone
 * test can be read from a screenshot without a console.
 */
export function mountAudioDebugOverlay(
  engine: AudioEngine,
  getSfxState: () => Record<string, unknown>,
  doc: Document = document
): void {
  const panel = doc.createElement('pre');
  panel.id = 'audio-debug-overlay';
  panel.setAttribute('aria-hidden', 'true');
  Object.assign(panel.style, {
    position: 'fixed',
    left: '4px',
    top: '96px',
    zIndex: '2147483647',
    maxWidth: 'min(92vw, 380px)',
    margin: '0',
    padding: '6px',
    font: '10px/1.35 ui-monospace, Menlo, monospace',
    color: '#fff',
    background: 'rgba(0, 0, 0, 0.75)',
    pointerEvents: 'none',
    whiteSpace: 'pre-wrap',
  });
  doc.body.appendChild(panel);
  const startedAt = Date.now();
  const seconds = (at: number) => `${((at - startedAt) / 1000).toFixed(1).padStart(6)}s`;
  const render = () => {
    const state = engine.getDebugState();
    const sfx = getSfxState();
    const history = (sfx.history as { cue: string; status: string }[] | undefined) ?? [];
    const notPlayed = history.filter((entry) => entry.status !== 'played' && entry.status !== 'cooldown').slice(-3);
    panel.textContent = [
      `audio ${state.audioContextState ?? 'none'} · session ${state.audioSessionType ?? 'n/a'} · tapped ${state.userInteracted ? 'yes' : 'no'} · page ${doc.hidden ? 'hidden' : 'visible'}`,
      `sfx loaded ${JSON.stringify(sfx.buffers)} playing ${String(sfx.activeCount)} waiting ${String(sfx.pendingCount)}`,
      notPlayed.length ? `sfx skipped: ${notPlayed.map((entry) => `${entry.cue} ${entry.status}`).join(', ')}` : 'sfx skipped: none',
      ...state.lifecycleLog.slice(-LOG_LINES).map((entry) => `${seconds(entry.at)} ${entry.event} [${entry.state ?? '-'}]`),
    ].join('\n');
  };
  render();
  doc.defaultView?.setInterval(render, REFRESH_MS);
}

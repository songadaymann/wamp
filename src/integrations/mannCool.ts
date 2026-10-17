import { isGameKeyboardYielded } from '../ui/keyboardFocus';
import {
  getMannCoolInputDebugState, isMannCoolParentMessage, MannCoolControllerInput, setMannCoolInputSource,
} from './mannCoolInput';
import { MannCoolPlayReporter } from './mannCoolPlays';

let reporter: MannCoolPlayReporter | null = null;
let installedCleanup: (() => void) | null = null;

export function installMannCoolIntegration(): () => void {
  if (installedCleanup) return installedCleanup;
  reporter = new MannCoolPlayReporter({ hostname: location.hostname, referrer: document.referrer, fetch: window.fetch.bind(window) });
  const report = () => { void reporter?.report(); };
  window.addEventListener('wamp:app-ready', report, { once: true });
  if (document.body.dataset.appReady === 'true') report();
  const controller = window.parent !== window ? new MannCoolControllerInput() : null;
  setMannCoolInputSource(controller);
  const refresh = () => controller?.setEnabled(document.body.dataset.appMode === 'play-world'
    && !document.hidden && !isGameKeyboardYielded()
    && !document.getElementById('auth-panel')?.classList.contains('menu-open'));
  const message = (event: MessageEvent) => {
    if (!controller || !isMannCoolParentMessage(event, window.parent, window)) return;
    refresh(); controller.handle(event.data);
  };
  const release = () => controller?.clear();
  const observer = controller ? new MutationObserver(refresh) : null;
  if (observer) {
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-app-mode'] });
    for (const modal of document.querySelectorAll('.history-modal, #auth-panel')) {
      observer.observe(modal, { attributes: true, attributeFilter: ['class', 'aria-hidden'] });
    }
    window.addEventListener('message', message);
    window.addEventListener('blur', release);
    window.addEventListener('pagehide', release);
    window.addEventListener('pageshow', refresh);
    document.addEventListener('visibilitychange', refresh);
    document.addEventListener('focusin', refresh);
    document.addEventListener('focusout', refresh);
    refresh();
  }
  const cleanup = () => {
    if (installedCleanup !== cleanup) return;
    observer?.disconnect(); release(); setMannCoolInputSource(null);
    window.removeEventListener('wamp:app-ready', report);
    window.removeEventListener('message', message); window.removeEventListener('blur', release);
    window.removeEventListener('pagehide', release); window.removeEventListener('pageshow', refresh);
    document.removeEventListener('visibilitychange', refresh);
    document.removeEventListener('focusin', refresh); document.removeEventListener('focusout', refresh);
    reporter?.destroy(); installedCleanup = null;
  };
  installedCleanup = cleanup;
  return cleanup;
}

export function getMannCoolDebugState(): Record<string, unknown> {
  return { playReport: reporter?.status ?? 'idle', controller: getMannCoolInputDebugState() };
}

if (import.meta.hot) import.meta.hot.dispose(() => installedCleanup?.());

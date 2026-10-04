const LAYOUT_REMEASURE_DELAYS_MS = [0, 32, 96];
export const APP_MODE_CHANGED_EVENT = 'wamp:app-mode-changed';

export function setAppMode(mode: string): void {
  document.body.dataset.appMode = mode;
  window.dispatchEvent(new Event(APP_MODE_CHANGED_EVENT));

  const dispatchResize = () => {
    window.dispatchEvent(new Event('resize'));
  };

  dispatchResize();
  window.requestAnimationFrame(dispatchResize);

  for (const delayMs of LAYOUT_REMEASURE_DELAYS_MS) {
    window.setTimeout(dispatchResize, delayMs);
  }
}

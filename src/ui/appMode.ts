const LAYOUT_REMEASURE_DELAYS_MS = [0, 32, 96];

export function setAppMode(mode: string): void {
  document.body.dataset.appMode = mode;

  const dispatchResize = () => {
    window.dispatchEvent(new Event('resize'));
  };

  dispatchResize();
  window.requestAnimationFrame(dispatchResize);

  for (const delayMs of LAYOUT_REMEASURE_DELAYS_MS) {
    window.setTimeout(dispatchResize, delayMs);
  }
}

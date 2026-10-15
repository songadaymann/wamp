/** Phaser also listens for mouse and touch starts on window, beneath HTML controls. */
export function keepHtmlPointerOutsideGame(
  event: Pick<Event, 'target' | 'stopPropagation'>,
  gameCanvas: EventTarget,
): void {
  if (event.target && event.target !== gameCanvas) event.stopPropagation();
}

/**
 * True when a mouse move reports no buttons held for a press the game never saw
 * released. A press that started on the canvas can end outside the browser window,
 * where no release event may reach the game; this move is that release.
 */
export function mouseButtonsReleased(pointer: { wasTouch: boolean; isDown: boolean; event: unknown }): boolean {
  const event = pointer.event as { buttons?: unknown } | null;
  return !pointer.wasTouch && pointer.isDown && typeof event?.buttons === 'number' && event.buttons === 0;
}

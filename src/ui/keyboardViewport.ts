/** Occluded layout space below a focused field; pinch zoom is a different viewport change. */
export function keyboardViewportInset(layoutHeight: number, viewport: { height: number; offsetTop: number; scale: number } | null): number {
  if (!viewport || Math.abs(viewport.scale - 1) > 0.01) return 0;
  return Math.max(0, Math.round(layoutHeight - viewport.height - viewport.offsetTop));
}

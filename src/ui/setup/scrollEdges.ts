/** Which ends of a sideways scroller still hide content, allowing for subpixel scroll positions. */
export function hiddenScrollEdges(scrollLeft: number, scrollWidth: number, clientWidth: number): { before: boolean; after: boolean } {
  return { before: scrollLeft > 1, after: scrollLeft + clientWidth < scrollWidth - 1 };
}

/**
 * Sets data-scroll-before and data-scroll-after on the host while the scroller hides content on
 * that side, so the phone dock can fade that edge and show an arrow (F367). Returns the cleanup.
 */
export function trackScrollEdges(scroller: HTMLElement, host: HTMLElement): () => void {
  const sync = () => {
    const edges = hiddenScrollEdges(scroller.scrollLeft, scroller.scrollWidth, scroller.clientWidth);
    host.dataset.scrollBefore = edges.before ? 'true' : 'false';
    host.dataset.scrollAfter = edges.after ? 'true' : 'false';
  };
  scroller.addEventListener('scroll', sync, { passive: true });
  const Observer = scroller.ownerDocument.defaultView?.ResizeObserver;
  // Watch the buttons too: a longer label or a larger text size widens the row without resizing it.
  const observer = Observer ? new Observer(sync) : null;
  for (const element of [scroller, ...scroller.children]) observer?.observe(element);
  sync();
  return () => {
    scroller.removeEventListener('scroll', sync);
    observer?.disconnect();
    delete host.dataset.scrollBefore;
    delete host.dataset.scrollAfter;
  };
}

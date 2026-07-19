export interface StartupDynamicOverlayLoadOptions {
  awaitBeforeReady: boolean;
  loadSnapshots: () => Promise<void>;
  isCurrent: () => boolean;
  mergeDeferredSnapshots: () => Promise<void> | void;
  onDeferredError?: (error: unknown) => void;
}

/**
 * Legacy/compact rendering still needs its initial snapshots before it can
 * become visible. Once coarse tiled coverage has established the browse
 * cutover, dynamic construction imagery may arrive later without holding the
 * world's ready gate open. The current-generation checks keep a late response
 * from being attached after a refresh, reset, or scene transition.
 */
export async function loadStartupDynamicOverlaySnapshots(
  options: StartupDynamicOverlayLoadOptions,
): Promise<'awaited' | 'deferred'> {
  if (options.awaitBeforeReady) {
    await options.loadSnapshots();
    return 'awaited';
  }

  void (async () => {
    await options.loadSnapshots();
    if (!options.isCurrent()) return;
    await options.mergeDeferredSnapshots();
    if (!options.isCurrent()) return;
  })().catch((error) => options.onDeferredError?.(error));
  return 'deferred';
}

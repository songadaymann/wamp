export interface StartupDynamicOverlayLoadOptions {
  awaitBeforeReady: boolean;
  loadSnapshots: () => Promise<void>;
  isCurrent: () => boolean;
  waitForDeferredStart?: () => Promise<boolean>;
  onDeferredStartStopped?: () => void;
  mergeDeferredSnapshots: () => Promise<void> | void;
  onDeferredError?: (error: unknown) => void;
}

export function stopStartupDynamicOverlayGeneration(input: {
  generation: number;
  startupDynamicOverlayGeneration: number;
  fullPreviewUpgradeGeneration: number;
}): {
  startupDynamicOverlayGeneration: number;
  fullPreviewUpgradeGeneration: number;
} {
  return {
    startupDynamicOverlayGeneration:
      input.startupDynamicOverlayGeneration === input.generation
        ? -1
        : input.startupDynamicOverlayGeneration,
    fullPreviewUpgradeGeneration:
      input.fullPreviewUpgradeGeneration === input.generation
        ? -1
        : input.fullPreviewUpgradeGeneration,
  };
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
    const canStart = await (options.waitForDeferredStart?.() ?? Promise.resolve(true));
    if (!canStart) {
      options.onDeferredStartStopped?.();
      return;
    }
    if (!options.isCurrent()) return;
    await options.loadSnapshots();
    if (!options.isCurrent()) return;
    await options.mergeDeferredSnapshots();
    if (!options.isCurrent()) return;
  })().catch((error) => options.onDeferredError?.(error));
  return 'deferred';
}

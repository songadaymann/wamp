export interface WorldTileBackgroundStartupOptions {
  prepare: () => Promise<boolean>;
  shouldLoadInitialCoverage: () => boolean;
  ensureInitialCoverage: () => Promise<boolean>;
  onError?: (error: unknown) => void;
}

/**
 * Starts tiled-world preparation without putting it on the critical path for
 * compact/legacy world rendering.
 */
export function startWorldTileBootstrapInBackground(
  options: WorldTileBackgroundStartupOptions,
): void {
  void options.prepare()
    .then((prepared) => {
      if (!prepared || !options.shouldLoadInitialCoverage()) return;
      return options.ensureInitialCoverage();
    })
    .catch((error) => options.onError?.(error));
}

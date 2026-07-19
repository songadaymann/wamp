export interface WorldTileInitialCoverageStartupOptions {
  prepare: () => Promise<boolean>;
  shouldLoadInitialCoverage: () => boolean;
  ensureInitialCoverage: () => Promise<boolean>;
  shouldAwaitInitialCoverage?: () => boolean;
  onError?: (error: unknown) => void;
}

/**
 * Starts tiled-world preparation immediately so it can overlap the compact
 * summary request. The returned promise is the gate before published snapshot
 * hydration. Shadow mode can leave coverage running in the background while
 * retaining legacy imagery by returning false from shouldAwaitInitialCoverage.
 */
export async function resolveWorldTileInitialCoverage(
  options: WorldTileInitialCoverageStartupOptions,
): Promise<boolean> {
  try {
    const prepared = await options.prepare();
    if (!prepared || !options.shouldLoadInitialCoverage()) return false;

    const initialCoveragePromise = options.ensureInitialCoverage();
    if (options.shouldAwaitInitialCoverage?.() === false) {
      void initialCoveragePromise.catch((error) => options.onError?.(error));
      return false;
    }

    return await initialCoveragePromise;
  } catch (error) {
    options.onError?.(error);
    return false;
  }
}

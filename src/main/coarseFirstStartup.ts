export const COARSE_FIRST_MAIN_TIMEOUT_MS = 750;
export const COARSE_FIRST_REFINEMENT_TIMEOUT_MS = 650;
export const COARSE_FIRST_MAIN_START_CEILING_MS = 1_400;

export type CoarseFirstStartupResult = 'absent' | 'settled' | 'timeout';
export type EarlyWorldTileSharpCancellationReason = 'coarse-timeout' | 'refinement-timeout';

export interface EarlyWorldTileReadyHandle {
  readonly ready: PromiseLike<unknown>;
  readonly sharp?: PromiseLike<unknown>;
  readonly cancelSharp?: (reason: EarlyWorldTileSharpCancellationReason) => void;
}

/**
 * Gives the pre-Phaser L0 cover first use of the cold-start network and decode
 * budget. The 750 ms ceiling leaves 150 ms of margin inside the 900 ms cold
 * coarse-coverage gate, while guaranteeing the application can always start.
 */
export async function waitForEarlyWorldTileCoverage(
  handle: EarlyWorldTileReadyHandle | undefined,
  timeoutMs = COARSE_FIRST_MAIN_TIMEOUT_MS,
): Promise<CoarseFirstStartupResult> {
  if (!handle) return 'absent';

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<CoarseFirstStartupResult>((resolve) => {
    timeoutId = setTimeout(() => resolve('timeout'), timeoutMs);
  });

  try {
    return await Promise.race([
      Promise.resolve(handle.ready).then(
        () => 'settled' as const,
        () => 'settled' as const,
      ),
      timeout,
    ]);
  } catch {
    // A non-standard handle or thenable must never prevent app startup.
    return 'settled';
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

export async function startMainAfterEarlyWorldTiles(options: {
  handle: EarlyWorldTileReadyHandle | undefined;
  importMain: () => Promise<unknown>;
  timeoutMs?: number;
}): Promise<void> {
  const startedAtMs = performance.now();
  const coarseTimeoutMs = Math.min(
    options.timeoutMs ?? COARSE_FIRST_MAIN_TIMEOUT_MS,
    COARSE_FIRST_MAIN_TIMEOUT_MS,
  );
  const coarseResult = await waitForEarlyWorldTileCoverage(options.handle, coarseTimeoutMs);
  if (coarseResult === 'timeout') {
    cancelEarlyWorldTileSharp(options.handle, 'coarse-timeout');
  }
  if (coarseResult === 'settled' && options.handle?.sharp) {
    const remainingMainStartBudgetMs = Math.max(
      0,
      COARSE_FIRST_MAIN_START_CEILING_MS - (performance.now() - startedAtMs),
    );
    const refinementResult = await waitForEarlyWorldTileCoverage(
      { ready: options.handle.sharp },
      Math.min(COARSE_FIRST_REFINEMENT_TIMEOUT_MS, remainingMainStartBudgetMs),
    );
    if (refinementResult === 'timeout') {
      cancelEarlyWorldTileSharp(options.handle, 'refinement-timeout');
    }
  }
  await options.importMain();
}

function cancelEarlyWorldTileSharp(
  handle: EarlyWorldTileReadyHandle | undefined,
  reason: EarlyWorldTileSharpCancellationReason,
): void {
  try {
    handle?.cancelSharp?.(reason);
  } catch {
    // Bootstrap cancellation is best-effort and must never prevent app startup.
  }
}

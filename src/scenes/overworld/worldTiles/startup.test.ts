import { describe, expect, it, vi } from 'vitest';
import { startWorldTileBootstrapInBackground } from './startup';

describe('world tile background startup', () => {
  it('does not block compact startup while config and coarse coverage are pending', async () => {
    let resolvePrepare!: (value: boolean) => void;
    const prepare = vi.fn(() => new Promise<boolean>((resolve) => {
      resolvePrepare = resolve;
    }));
    const ensureInitialCoverage = vi.fn(async () => true);
    const compactStartup = vi.fn();

    startWorldTileBootstrapInBackground({
      prepare,
      shouldLoadInitialCoverage: () => true,
      ensureInitialCoverage,
    });
    compactStartup();

    expect(compactStartup).toHaveBeenCalledOnce();
    expect(ensureInitialCoverage).not.toHaveBeenCalled();
    resolvePrepare(true);
    await Promise.resolve();
    expect(ensureInitialCoverage).toHaveBeenCalledOnce();
  });

  it('skips initial coverage outside browse mode or when tiled reads are disabled', async () => {
    const ensureInitialCoverage = vi.fn(async () => true);
    startWorldTileBootstrapInBackground({
      prepare: async () => true,
      shouldLoadInitialCoverage: () => false,
      ensureInitialCoverage,
    });
    startWorldTileBootstrapInBackground({
      prepare: async () => false,
      shouldLoadInitialCoverage: () => true,
      ensureInitialCoverage,
    });
    await Promise.resolve();
    expect(ensureInitialCoverage).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { resolveWorldTileInitialCoverage } from './startup';

describe('world tile initial coverage startup', () => {
  it('overlaps compact summary loading but gates snapshot hydration on coarse coverage', async () => {
    let resolvePrepare!: (value: boolean) => void;
    let resolveCoverage!: (value: boolean) => void;
    const prepare = vi.fn(() => new Promise<boolean>((resolve) => {
      resolvePrepare = resolve;
    }));
    const ensureInitialCoverage = vi.fn(() => new Promise<boolean>((resolve) => {
      resolveCoverage = resolve;
    }));
    const loadCompactSummaries = vi.fn();
    let hydrationAllowed = false;

    const initialCoveragePromise = resolveWorldTileInitialCoverage({
      prepare,
      shouldLoadInitialCoverage: () => true,
      ensureInitialCoverage,
    });
    void initialCoveragePromise.then(() => {
      hydrationAllowed = true;
    });
    loadCompactSummaries();

    expect(loadCompactSummaries).toHaveBeenCalledOnce();
    expect(ensureInitialCoverage).not.toHaveBeenCalled();
    expect(hydrationAllowed).toBe(false);
    resolvePrepare(true);
    await Promise.resolve();
    expect(ensureInitialCoverage).toHaveBeenCalledOnce();
    expect(hydrationAllowed).toBe(false);

    resolveCoverage(true);
    await expect(initialCoveragePromise).resolves.toBe(true);
    await Promise.resolve();
    expect(hydrationAllowed).toBe(true);
  });

  it('falls through to legacy rendering outside browse mode or when tiled reads are disabled', async () => {
    const ensureInitialCoverage = vi.fn(async () => true);
    await expect(resolveWorldTileInitialCoverage({
      prepare: async () => true,
      shouldLoadInitialCoverage: () => false,
      ensureInitialCoverage,
    })).resolves.toBe(false);
    await expect(resolveWorldTileInitialCoverage({
      prepare: async () => false,
      shouldLoadInitialCoverage: () => true,
      ensureInitialCoverage,
    })).resolves.toBe(false);
    expect(ensureInitialCoverage).not.toHaveBeenCalled();
  });

  it('keeps shadow coverage in the background without delaying legacy imagery', async () => {
    let resolveCoverage!: (value: boolean) => void;
    const ensureInitialCoverage = vi.fn(() => new Promise<boolean>((resolve) => {
      resolveCoverage = resolve;
    }));

    await expect(resolveWorldTileInitialCoverage({
      prepare: async () => true,
      shouldLoadInitialCoverage: () => true,
      shouldAwaitInitialCoverage: () => false,
      ensureInitialCoverage,
    })).resolves.toBe(false);
    expect(ensureInitialCoverage).toHaveBeenCalledOnce();

    resolveCoverage(true);
    await Promise.resolve();
  });

  it('reports unexpected coverage failures and opens the legacy gate', async () => {
    const error = new Error('coverage failed');
    const onError = vi.fn();

    await expect(resolveWorldTileInitialCoverage({
      prepare: async () => true,
      shouldLoadInitialCoverage: () => true,
      ensureInitialCoverage: async () => {
        throw error;
      },
      onError,
    })).resolves.toBe(false);
    expect(onError).toHaveBeenCalledWith(error);
  });
});

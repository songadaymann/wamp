import type { WorldRepository } from '../../../persistence/worldRepository';
import { WORLD_TILE_COVERAGE_TIMEOUT_MS } from './retryFallback';
import type { WorldTileBounds, WorldTileLevel, WorldTileManifest } from './types';

export interface WorldTileManifestLoad {
  generation: number;
  manifest: WorldTileManifest | null;
  obsolete: boolean;
}

export class WorldTileManifestLoader {
  private generation = 0;
  private abortController: AbortController | null = null;
  private pending = 0;

  constructor(private readonly repository: WorldRepository) {}

  get pendingCount(): number {
    return this.pending;
  }

  async load(level: WorldTileLevel, bounds: WorldTileBounds): Promise<WorldTileManifestLoad> {
    const generation = ++this.generation;
    this.abortController?.abort();
    const abortController = new AbortController();
    this.abortController = abortController;
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      abortController.abort();
    }, WORLD_TILE_COVERAGE_TIMEOUT_MS);
    this.pending += 1;
    try {
      const manifest = await this.repository.loadWorldTileManifest(level, bounds, abortController.signal);
      return {
        generation,
        manifest,
        obsolete: abortController.signal.aborted || generation !== this.generation,
      };
    } catch (error) {
      if (timedOut) {
        throw new Error('World tile manifest request timed out before complete coverage.');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
      this.pending = Math.max(0, this.pending - 1);
      if (this.abortController === abortController) this.abortController = null;
    }
  }

  cancel(): void {
    this.generation += 1;
    this.abortController?.abort();
    this.abortController = null;
  }
}

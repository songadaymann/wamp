import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoomSnapshot } from '../../persistence/roomModel';
import { OverworldWorldStreamingController } from './worldStreaming';

vi.mock('phaser', () => ({ default: {} }));

describe('world streaming replacement coverage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    [true, 'compact'],
    [false, 'legacy'],
  ] as const)('publishes %s fallback readiness only after preview imagery is installed', (
    compactWorldActive,
    expectedSource,
  ) => {
    let imageryInstalled = false;
    const dispatchEvent = vi.fn((event: Event) => {
      if (event.type === 'wamp:world-tiles-replacement-ready') {
        expect(imageryInstalled).toBe(true);
      }
      return true;
    });
    vi.stubGlobal('window', { dispatchEvent, __wampWorldReplacementCoverage: null });
    const renderChunkPreviews = vi.fn(() => {
      imageryInstalled = true;
    });
    const harness = createHarness({ compactWorldActive, renderChunkPreviews });

    renderForGeneration(harness, 4);

    expect(renderChunkPreviews).toHaveBeenCalledOnce();
    expect(window.__wampWorldReplacementCoverage).toMatchObject({
      key: `world-stream:${expectedSource}:4`,
      source: expectedSource,
      generation: 4,
    });
  });

  it('invalidates an owned ready state at the start of a newer generation and rejects stale paint', () => {
    const dispatchEvent = vi.fn(() => true);
    vi.stubGlobal('window', { dispatchEvent, __wampWorldReplacementCoverage: null });
    const renderChunkPreviews = vi.fn();
    const harness = createHarness({ compactWorldActive: true, renderChunkPreviews });
    renderForGeneration(harness, 4);
    dispatchEvent.mockClear();
    renderChunkPreviews.mockClear();

    expect(beginLoadGeneration(harness)).toBe(5);
    expect(window.__wampWorldReplacementCoverage).toBeNull();
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'wamp:world-tiles-replacement-invalidated',
    }));

    renderForGeneration(harness, 4);
    expect(renderChunkPreviews).not.toHaveBeenCalled();
    expect(window.__wampWorldReplacementCoverage).toBeNull();
  });

  it('does not publish fallback readiness while tiled browse coverage owns the replacement', () => {
    vi.stubGlobal('window', { dispatchEvent: vi.fn(() => true), __wampWorldReplacementCoverage: null });
    const renderChunkPreviews = vi.fn();
    const harness = createHarness({
      compactWorldActive: true,
      renderChunkPreviews,
      tiledCutover: true,
    });

    renderForGeneration(harness, 4);

    expect(renderChunkPreviews).toHaveBeenCalledOnce();
    expect(window.__wampWorldReplacementCoverage).toBeNull();
  });
});

function createHarness(input: {
  compactWorldActive: boolean;
  renderChunkPreviews: (rooms: RoomSnapshot[]) => void;
  tiledCutover?: boolean;
}): Record<string, unknown> {
  return Object.assign(
    Object.create(OverworldWorldStreamingController.prototype) as Record<string, unknown>,
    {
      destroyed: false,
      loadGeneration: 4,
      compactWorldActive: input.compactWorldActive,
      publishedReplacementCoverageKey: null,
      previewRenderer: { renderChunkPreviews: input.renderChunkPreviews },
      worldTileController: {
        isBrowseCutoverActive: () => input.tiledCutover ?? false,
      },
    },
  );
}

function renderForGeneration(harness: Record<string, unknown>, generation: number): void {
  const method = OverworldWorldStreamingController.prototype as unknown as {
    renderChunkPreviewsForGeneration(
      this: Record<string, unknown>,
      rooms: RoomSnapshot[],
      generation: number,
    ): void;
  };
  method.renderChunkPreviewsForGeneration.call(harness, [], generation);
}

function beginLoadGeneration(harness: Record<string, unknown>): number {
  const method = OverworldWorldStreamingController.prototype as unknown as {
    beginLoadGeneration(this: Record<string, unknown>): number;
  };
  return method.beginLoadGeneration.call(harness);
}

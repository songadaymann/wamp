import { describe, expect, it } from 'vitest';
import { getChunkPreviewTileSize } from './previewStreaming';

describe('overworld preview detail thresholds', () => {
  it('keeps inspectable browse rooms detailed around 0.17x and 0.18x', () => {
    for (const zoom of [0.17, 0.18]) {
      expect(getChunkPreviewTileSize({
        mode: 'browse',
        performanceProfile: 'default',
        zoom,
      })).toBe(4);
    }
  });

  it('uses compact overview textures only at the far overview zoom', () => {
    expect(getChunkPreviewTileSize({
      mode: 'browse',
      performanceProfile: 'default',
      zoom: 0.14,
    })).toBe(2);
    expect(getChunkPreviewTileSize({
      mode: 'browse',
      performanceProfile: 'default',
      zoom: 0.141,
    })).toBe(4);
  });
});

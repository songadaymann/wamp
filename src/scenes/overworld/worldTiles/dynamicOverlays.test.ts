import { describe, expect, it } from 'vitest';
import { shouldRenderLegacyWorldTileOverlay } from './dynamicOverlays';

describe('world tile dynamic overlay precedence', () => {
  it('does not hydrate unchanged published browse rooms through the legacy renderer', () => {
    expect(shouldRenderLegacyWorldTileOverlay({
      draft: null,
      sharedPreview: null,
      summary: { state: 'published' },
    }, false)).toBe(false);
  });

  it('keeps drafts, saved construction, and optimistic mutations above raster tiles', () => {
    expect(shouldRenderLegacyWorldTileOverlay({
      draft: {},
      sharedPreview: null,
      summary: { state: 'published' },
    }, false)).toBe(true);
    expect(shouldRenderLegacyWorldTileOverlay({
      draft: null,
      sharedPreview: null,
      summary: { state: 'claimed_unpublished' },
    }, false)).toBe(true);
    expect(shouldRenderLegacyWorldTileOverlay({
      draft: null,
      sharedPreview: null,
      summary: { state: 'published' },
    }, true)).toBe(true);
  });

  it('continues to ignore PartyKit previews when the canonical room is published', () => {
    expect(shouldRenderLegacyWorldTileOverlay({
      draft: null,
      sharedPreview: {},
      summary: { state: 'published' },
    }, false)).toBe(false);
  });
});


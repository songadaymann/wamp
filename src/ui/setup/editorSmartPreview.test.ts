import { describe, expect, it } from 'vitest';
import { buildSmartPreviewTiles, SMART_PREVIEW_COLUMNS, SMART_PREVIEW_ROWS } from './editorSmartPreview';

describe('editor Smart previews', () => {
  it.each([
    ['forest.ground', 'forest'],
    ['desert.ground', 'desert'],
    ['cave.ground', 'cave'],
    ['gothic.ground', 'gothic'],
    ['cyber.concrete', 'cyber-yellow'],
  ] as const)('renders actual connected output for %s', (brushId, styleId) => {
    const tiles = buildSmartPreviewTiles(brushId, styleId);
    expect(tiles.length).toBeGreaterThanOrEqual(9);
    expect(new Set(tiles.map((tile) => `${tile.path}:${tile.sourceX},${tile.sourceY}`)).size).toBeGreaterThan(2);
    expect(tiles.every((tile) => (
      tile.x >= 0 && tile.x < SMART_PREVIEW_COLUMNS
      && tile.y >= 0 && tile.y < SMART_PREVIEW_ROWS
    ))).toBe(true);
  });

  it('keeps the registry-derived water backdrop available', () => {
    expect(buildSmartPreviewTiles('water.tunnel', 'water')).toHaveLength(9);
  });
});

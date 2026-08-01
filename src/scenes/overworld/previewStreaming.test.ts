import { describe, expect, it } from 'vitest';
import {
  computeOverworldPreviewSelection,
  getChunkPreviewTileSize,
  type PreviewSelectionCandidate,
} from './previewStreaming';

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

  it('retains the focused full room when pressure limits the budget to one', () => {
    const candidates = createNeighborhoodCandidates().reverse();

    const selection = computeOverworldPreviewSelection({
      mode: 'play',
      performanceProfile: 'default',
      zoom: 1,
      focusCoordinates: { x: 0, y: 0 },
      roomCandidates: candidates,
      visibleRoomBounds: null,
      fullRoomBudgetOverride: 1,
    });

    expect(selection.fullRoomBudget).toBe(1);
    expect(Array.from(selection.fullRoomIds)).toEqual(['0,0']);
  });

  it('selects all cardinal neighbors before any diagonal room', () => {
    const candidates = createNeighborhoodCandidates().sort((left, right) =>
      right.id.localeCompare(left.id)
    );

    const selection = computeOverworldPreviewSelection({
      mode: 'play',
      performanceProfile: 'default',
      zoom: 1,
      focusCoordinates: { x: 0, y: 0 },
      roomCandidates: candidates,
      visibleRoomBounds: null,
      fullRoomBudgetOverride: 5,
    });

    expect(selection.fullRoomIds).toEqual(new Set([
      '0,0',
      '0,-1',
      '-1,0',
      '1,0',
      '0,1',
    ]));
    expect(Array.from(selection.fullRoomIds).some((roomId) => {
      const [x, y] = roomId.split(',').map(Number);
      return Math.abs(x) === 1 && Math.abs(y) === 1;
    })).toBe(false);
  });
});

function createNeighborhoodCandidates(): PreviewSelectionCandidate[] {
  const candidates: PreviewSelectionCandidate[] = [];
  for (let y = -1; y <= 1; y += 1) {
    for (let x = -1; x <= 1; x += 1) {
      candidates.push({
        id: `${x},${y}`,
        coordinates: { x, y },
        isRenderable: true,
        allowFullRoomLoad: true,
      });
    }
  }
  return candidates;
}

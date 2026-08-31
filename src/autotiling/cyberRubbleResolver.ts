import type { LayerName } from '../config/room';
import type { resolveCyberRubbleBorderTile } from './cyberProfile';

export interface CyberRubbleBorderNeighbors {
  above: boolean;
  right: boolean;
  below: boolean;
  left: boolean;
}

export interface CyberRubbleBorderPlacement {
  part: Parameters<typeof resolveCyberRubbleBorderTile>[1];
  flipX?: boolean;
  layer?: Extract<LayerName, 'foreground' | 'background'>;
}

/** Pure topology-to-border mapping; document ownership remains in recipeSolver. */
export function resolveCyberRubbleBorderPlacements(
  neighbors: CyberRubbleBorderNeighbors,
): CyberRubbleBorderPlacement[] {
  const { above, right, below, left } = neighbors;
  const cardinalCount = Number(above) + Number(right) + Number(below) + Number(left);
  if (cardinalCount === 1) {
    if (below) return [{ part: 'top' }];
    if (above) return [{ part: 'bottom' }];
    if (right) return [{ part: 'left' }];
    if (left) return [{ part: 'right' }];
  }
  if (cardinalCount === 2) {
    if (below && right) return [{ part: 'topLeft' }];
    if (below && left) return [{ part: 'topLeft', flipX: true }];
    if (above && right) return [{ part: 'bottomRight', flipX: true }];
    if (above && left) return [{ part: 'bottomRight' }];
  }
  if (cardinalCount === 3) {
    if (!right) return [
      { part: 'topLeft', flipX: true },
      { part: 'bottom', layer: 'background' },
    ];
    if (!left) return [
      { part: 'topLeft' },
      { part: 'bottom', layer: 'background' },
    ];
    if (!below) return [
      { part: 'bottomRight' },
      { part: 'left', layer: 'background' },
    ];
    if (!above) return [
      { part: 'topLeft', flipX: true },
      { part: 'left', layer: 'background' },
    ];
  }
  return [];
}

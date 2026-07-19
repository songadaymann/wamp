import { describe, expect, it } from 'vitest';
import { orderWorldTilesForContextRestoration } from './restoration';
import type { WorldTileAddress } from './types';

describe('world tile WebGL restoration priority', () => {
  it('restores visible tiles, then fallback ancestors, then guards with deduplication', () => {
    const visible = address(4, 0);
    const fallback = address(3, 0);
    const guard = address(4, 1);
    expect(orderWorldTilesForContextRestoration({
      visible: [visible],
      fallbackAncestors: [fallback, visible],
      guards: [guard, fallback],
    })).toEqual([visible, fallback, guard]);
  });
});

function address(level: 0 | 1 | 2 | 3 | 4, x: number): WorldTileAddress {
  return { rendererVersion: 'renderer-v1', level, x, y: 0 };
}


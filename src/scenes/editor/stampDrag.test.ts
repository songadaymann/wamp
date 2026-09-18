import { describe, expect, it } from 'vitest';
import { resolvePencilStampOrigin } from './stampDrag';

describe('resolvePencilStampOrigin', () => {
  it('snaps multi-tile stamps to the selection grid while dragging', () => {
    expect(resolvePencilStampOrigin({ x: 4, y: 2 }, { x: 7, y: 2 }, 3, 1, false)).toEqual({ x: 7, y: 2 });
    expect(resolvePencilStampOrigin({ x: 4, y: 2 }, { x: 6, y: 2 }, 3, 1, false)).toEqual({ x: 4, y: 2 });
    expect(resolvePencilStampOrigin({ x: 4, y: 2 }, { x: 7, y: 4 }, 3, 2, false)).toEqual({ x: 7, y: 4 });
  });

  it('places on every hovered tile when continuous stamping is on', () => {
    expect(resolvePencilStampOrigin({ x: 4, y: 2 }, { x: 6, y: 3 }, 3, 1, true)).toEqual({ x: 6, y: 3 });
  });
});

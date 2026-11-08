import { describe, expect, it } from 'vitest';
import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH, TILE_SIZE } from './room';
import {
  containDraggedTriangle,
  dragTriangleHandle,
  placedTriangleContainsWorldPoint,
  pointInTriangle,
  trianglePixelIsStroke,
  triangleVertices,
} from './trianglePiece';

const room = { minX: 0, minY: 0, maxX: ROOM_PX_WIDTH, maxY: ROOM_PX_HEIGHT };

function placed(anchorX: number, anchorY: number, legX: number, legY: number) {
  return { id: 'triangle_piece', x: anchorX, y: anchorY, triangleLegX: legX, triangleLegY: legY };
}

describe('triangle placement hit testing', () => {
  it('ignores the empty corner of the bounding box so another ramp can be placed there', () => {
    const ramp = placed(0, 64, 64, -64);
    expect(placedTriangleContainsWorldPoint(ramp, 16, 48)).toBe(true);
    expect(placedTriangleContainsWorldPoint(ramp, 48, 16)).toBe(false);
  });
});

describe('triangle handle room limits', () => {
  const start = { anchorX: 32, anchorY: 64, legX: 32, legY: -32 };

  it('stops a moved ramp at the room edge', () => {
    const moved = dragTriangleHandle(start, 'anchor', -16, 64, 32, 64, room);
    expect(moved.anchorX).toBe(0);
    expect(moved.anchorY).toBe(64);
    expect(moved.legX).toBe(32);
    expect(moved.legY).toBe(-32);
  });

  it('stops a corner on the room edge', () => {
    const wide = dragTriangleHandle(start, 'horizontalCorner', ROOM_PX_WIDTH + TILE_SIZE * 4, 64, 64, 64, room);
    expect(wide.anchorX).toBe(32);
    expect(wide.anchorX + wide.legX).toBe(ROOM_PX_WIDTH);
    const tall = dragTriangleHandle(start, 'verticalCorner', 32, -TILE_SIZE * 4, 32, 32, room);
    expect(tall.anchorY + tall.legY).toBe(0);
  });

  it('does not pull a side handle outside the room', () => {
    const dropped = containDraggedTriangle(
      start,
      { ...start, anchorY: ROOM_PX_HEIGHT + 48, legY: start.legY - 48 },
      'horizontalSide',
      room,
    );
    expect(dropped.anchorY).toBeLessThanOrEqual(ROOM_PX_HEIGHT);
    expect(dropped.anchorY + dropped.legY).toBe(start.anchorY + start.legY);
    expect(dropped.anchorY).toBeGreaterThanOrEqual(0);
  });

  it('paints the hypotenuse as one pixel instead of a two-pixel ribbon', () => {
    const anchorX = 0;
    const anchorY = 32;
    const legX = 32;
    const legY = -32;
    const verts = triangleVertices(anchorX, anchorY, legX, legY);
    const corners = [verts.rightAngle, verts.horizontal, verts.vertical];
    const contains = (point: { x: number; y: number }) => pointInTriangle(point, corners[0], corners[1], corners[2]);
    const stroke: Array<[number, number]> = [];
    for (let y = 0; y < 32; y += 1) {
      for (let x = 0; x < 32; x += 1) {
        if (!contains({ x: x + 0.5, y: y + 0.5 })) continue;
        if (trianglePixelIsStroke(x, y, contains)) stroke.push([x, y]);
      }
    }
    const hypotenuse = stroke.filter(([x, y]) => x !== 0 && y !== 31);
    expect(hypotenuse.length).toBeGreaterThan(10);
    for (const [x, y] of hypotenuse) {
      const touches = hypotenuse.some(([sx, sy]) => Math.abs(sx - x) + Math.abs(sy - y) === 1);
      expect(touches).toBe(false);
    }
  });

  it('keeps a continuous one-pixel hypotenuse on a shallow ramp', () => {
    const width = 96;
    const height = 16;
    const verts = triangleVertices(0, height, width, -height);
    const corners = [verts.rightAngle, verts.horizontal, verts.vertical];
    const contains = (point: { x: number; y: number }) => pointInTriangle(point, corners[0], corners[1], corners[2]);
    const slope = new Map<number, number>();
    for (let y = 0; y < height - 1; y += 1) {
      for (let x = 1; x < width; x += 1) {
        if (!trianglePixelIsStroke(x, y, contains)) continue;
        expect(slope.has(x)).toBe(false);
        slope.set(x, y);
      }
    }
    const columns = [...slope.keys()].sort((a, b) => a - b);
    expect(columns.length).toBeGreaterThan(width - height);
    for (let i = 1; i < columns.length; i += 1) {
      expect(columns[i] - columns[i - 1]).toBe(1);
      const here = slope.get(columns[i]) ?? 0;
      const previous = slope.get(columns[i - 1]) ?? 0;
      expect(Math.abs(here - previous)).toBeLessThanOrEqual(1);
    }
  });
});

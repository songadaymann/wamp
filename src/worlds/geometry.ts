import { WORLD_ORIGIN_SPACING } from './model';

export interface WorldLatticePoint {
  x: number;
  y: number;
}

/**
 * Maps WAMP numbers onto an outward counter-clockwise square spiral.
 * Room-coordinate Y increases downward, so counter-clockwise from east uses
 * negative Y: 0=(0,0), 1=(1,0), 2=(1,-1), 3=(0,-1), ...
 */
export function getWorldLatticePoint(worldNumber: number): WorldLatticePoint {
  if (!Number.isSafeInteger(worldNumber) || worldNumber < 0) {
    throw new RangeError('World number must be a non-negative safe integer.');
  }
  if (worldNumber === 0) return { x: 0, y: 0 };

  const layer = Math.ceil((Math.sqrt(worldNumber + 1) - 1) / 2);
  const legLength = layer * 2;
  const ringMaximum = (layer * 2 + 1) ** 2 - 1;
  const offset = ringMaximum - worldNumber;

  if (offset < legLength) {
    return { x: layer - offset, y: layer };
  }
  if (offset < legLength * 2) {
    return { x: -layer, y: layer - (offset - legLength) };
  }
  if (offset < legLength * 3) {
    return { x: -layer + (offset - legLength * 2), y: -layer };
  }
  return { x: layer, y: -layer + (offset - legLength * 3) };
}

export function getWorldOrigin(worldNumber: number): WorldLatticePoint {
  const point = getWorldLatticePoint(worldNumber);
  return {
    x: point.x * WORLD_ORIGIN_SPACING,
    y: point.y * WORLD_ORIGIN_SPACING,
  };
}

export function buildWorldSharePath(worldNumber: number): string {
  if (!Number.isSafeInteger(worldNumber) || worldNumber < 0) {
    throw new RangeError('World number must be a non-negative safe integer.');
  }
  return `/w/${worldNumber}`;
}

export function parseWorldSharePath(pathname: string): number | null {
  const match = /^\/w\/(0|[1-9]\d*)\/?$/.exec(pathname);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) ? number : null;
}

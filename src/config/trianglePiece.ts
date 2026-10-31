import { TILE_SIZE } from './room';

export const TRIANGLE_PIECE_OBJECT_ID = 'triangle_piece';
const TRIANGLE_MIN_LEG = TILE_SIZE;
const TRIANGLE_DEFAULT_LEG_X = 32;
const TRIANGLE_DEFAULT_LEG_Y = -32;
export const DEFAULT_TRIANGLE_FILL = '#8A8F98';
export const DEFAULT_TRIANGLE_STROKE = '#2C3138';
const TRIANGLE_SLIDE_SPEED = 70;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export interface TriangleGeometry {
  anchorX: number;
  anchorY: number;
  legX: number;
  legY: number;
  fill: string;
  stroke: string;
}

export interface TrianglePoint {
  x: number;
  y: number;
}

export type TriangleHandle =
  | 'anchor'
  | 'horizontalCorner'
  | 'verticalCorner'
  | 'horizontalSide'
  | 'verticalSide';

export type TriangleHandleMotion = 'move' | 'vertical' | 'horizontal';

export interface SlopeWalk {
  supported: boolean;
  feetY: number;
  slideX: number;
  blockUphill: boolean;
  downhillX: -1 | 1;
}

export interface FlatWalk {
  supported: boolean;
  feetY: number;
}

export function isTrianglePieceObjectId(id: string | null | undefined): boolean {
  return id === TRIANGLE_PIECE_OBJECT_ID;
}

export function parseHexColor(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim() ?? '';
  return HEX_COLOR.test(trimmed) ? trimmed.toUpperCase() : fallback;
}

export function hexToRgb(value: string): { r: number; g: number; b: number } {
  const hex = parseHexColor(value, '#000000');
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

export function snapTriangleLeg(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const snapped = Math.max(TRIANGLE_MIN_LEG, Math.round(Math.abs(value) / TILE_SIZE) * TILE_SIZE);
  return sign * snapped;
}

function snapTriangleCoord(value: number): number {
  return Math.round(value / TILE_SIZE) * TILE_SIZE;
}

export function isFloorTriangle(legY: number): boolean {
  return legY < 0;
}

export function isSteepTriangle(legX: number, legY: number): boolean {
  return Math.abs(legY) > Math.abs(legX);
}

/** Floor slopes a butt stomp slides down: 45 degrees and steeper. */
export function isButtStompSlideTriangle(legX: number, legY: number): boolean {
  return isFloorTriangle(legY) && legX !== 0 && Math.abs(legY) >= Math.abs(legX);
}

function downhillSignX(legX: number, legY: number): -1 | 1 {
  if (legX === 0) return 1;
  return -legY / legX >= 0 ? 1 : -1;
}

/** Constant-speed slide along the floor hypotenuse, pointing downhill. */
export function slopeSlideVelocity(legX: number, legY: number): { x: number; y: number } {
  const length = Math.hypot(legX, legY) || 1;
  const downhillX = downhillSignX(legX, legY);
  return {
    x: downhillX * TRIANGLE_SLIDE_SPEED * Math.abs(legX) / length,
    y: TRIANGLE_SLIDE_SPEED * Math.abs(legY) / length,
  };
}

/**
 * Horizontal correction that removes this step's uphill travel.
 * A jump does not earn an exception: a steep face cannot be climbed.
 */
export function uphillTravelCorrection(input: {
  legX: number;
  legY: number;
  traveledX: number;
  feetDelta: number;
}): number {
  if (!isFloorTriangle(input.legY) || !isSteepTriangle(input.legX, input.legY)) return 0;
  if (input.feetDelta < -8 || input.feetDelta > 20) return 0;
  const downhill = downhillSignX(input.legX, input.legY);
  if (input.traveledX * downhill >= 0) return 0;
  return -input.traveledX;
}

export interface SteepSlopeMotion {
  dx: number;
  dy: number;
  vx: number;
  vy: number;
}

/**
 * Slide down a steep floor. The returned dy is never upward: a held direction
 * or a jump cannot raise the body while it is on the face.
 */
export function steepSlopeMotion(input: {
  anchorX: number;
  anchorY: number;
  legX: number;
  legY: number;
  feetX: number;
  feetY: number;
  traveledX: number;
  traveledY: number;
  deltaSeconds: number;
  /** Butt-stomp slide. Applies on a 45 degree floor and anything steeper. */
  forceSlide?: boolean;
  verticalVelocity?: number;
}): SteepSlopeMotion | null {
  const steep = isFloorTriangle(input.legY) && isSteepTriangle(input.legX, input.legY);
  const stompSlide = input.forceSlide === true && isButtStompSlideTriangle(input.legX, input.legY);
  if (!steep && !stompSlide) return null;
  const surfaceY = hypotenuseY(input.anchorX, input.anchorY, input.legX, input.legY, input.feetX);
  if (surfaceY == null) return null;
  const delta = input.feetY - surfaceY;
  if (delta < -8 || delta > 14) return null;
  if (!steep && (input.verticalVelocity ?? 0) < -40 && delta < 0) return null;
  if (steep && Math.abs(input.feetY - input.anchorY) <= 6) return null;

  const slide = slopeSlideVelocity(input.legX, input.legY);
  const downhill = Math.sign(slide.x) || 1;
  let dx = input.traveledX * downhill < 0 ? -input.traveledX : 0;
  let dy = input.traveledY < 0 ? -input.traveledY : 0;
  const snapDown = (feetX: number, feetY: number) => {
    const surface = hypotenuseY(input.anchorX, input.anchorY, input.legX, input.legY, feetX);
    if (surface != null && surface > feetY) dy += surface - feetY;
  };
  snapDown(input.feetX + dx, input.feetY + dy);
  const already = Math.max(0, (input.traveledX + dx) * downhill);
  const extra = Math.max(0, Math.abs(slide.x) * input.deltaSeconds - already);
  dx += downhill * extra;
  snapDown(input.feetX + dx, input.feetY + dy);
  return { dx, dy, vx: slide.x, vy: slide.y };
}

export function triangleVertices(anchorX: number, anchorY: number, legX: number, legY: number): {
  rightAngle: TrianglePoint;
  horizontal: TrianglePoint;
  vertical: TrianglePoint;
} {
  return {
    rightAngle: { x: anchorX, y: anchorY },
    horizontal: { x: anchorX + legX, y: anchorY },
    vertical: { x: anchorX, y: anchorY + legY },
  };
}

export interface TriangleEdge {
  a: TrianglePoint;
  b: TrianglePoint;
  nx: number;
  ny: number;
}

export function triangleEdges(anchorX: number, anchorY: number, legX: number, legY: number): TriangleEdge[] {
  const verts = triangleVertices(anchorX, anchorY, legX, legY);
  const length = Math.hypot(legX, legY) || 1;
  return [
    {
      a: verts.rightAngle,
      b: verts.horizontal,
      nx: 0,
      ny: legY < 0 ? 1 : -1,
    },
    {
      a: verts.rightAngle,
      b: verts.vertical,
      nx: legX < 0 ? 1 : -1,
      ny: 0,
    },
    {
      a: verts.horizontal,
      b: verts.vertical,
      // Perpendicular to (-legX, legY), pointing out of the solid. The leg vector
      // itself is only perpendicular to the hypotenuse when both legs match.
      nx: (legX * legY < 0 ? -legY : legY) / length,
      ny: (legX * legY < 0 ? -legX : legX) / length,
    },
  ];
}

function hypotenuseY(
  anchorX: number,
  anchorY: number,
  legX: number,
  legY: number,
  x: number,
): number | null {
  if (legX === 0) return null;
  const minX = Math.min(anchorX, anchorX + legX);
  const maxX = Math.max(anchorX, anchorX + legX);
  if (x < minX || x > maxX) return null;
  return anchorY + (legY * (anchorX + legX - x)) / legX;
}

export function pointInTriangle(point: TrianglePoint, a: TrianglePoint, b: TrianglePoint, c: TrianglePoint): boolean {
  const sign = (p1: TrianglePoint, p2: TrianglePoint, p3: TrianglePoint) =>
    (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
  const d1 = sign(point, a, b);
  const d2 = sign(point, b, c);
  const d3 = sign(point, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

export function separationFromTriangle(
  anchorX: number,
  anchorY: number,
  legX: number,
  legY: number,
  x: number,
  y: number,
): { dx: number; dy: number } | null {
  let bestSigned = Number.NEGATIVE_INFINITY;
  let best: TriangleEdge | null = null;
  for (const edge of triangleEdges(anchorX, anchorY, legX, legY)) {
    const signed = (x - edge.a.x) * edge.nx + (y - edge.a.y) * edge.ny;
    if (signed > bestSigned) {
      bestSigned = signed;
      best = edge;
    }
  }
  if (!best || bestSigned >= -0.01) return null;
  return {
    dx: best.nx * (-bestSigned + 0.5),
    dy: best.ny * (-bestSigned + 0.5),
  };
}

export function evaluateSlopeWalk(input: {
  anchorX: number;
  anchorY: number;
  legX: number;
  legY: number;
  feetX: number;
  feetY: number;
  verticalVelocity: number;
  horizontalIntent: number;
  deltaSeconds: number;
}): SlopeWalk | null {
  if (!isFloorTriangle(input.legY)) return null;
  const surfaceY = hypotenuseY(input.anchorX, input.anchorY, input.legX, input.legY, input.feetX);
  if (surfaceY == null) return null;
  const delta = input.feetY - surfaceY;
  // Feet have to be on the hypotenuse. The vertical and horizontal legs only
  // collide; standing beside them must not snap the body up to the slope.
  if (delta < -8 || delta > 14) return null;
  if (input.verticalVelocity < -40 && delta < 0) return null;
  const steep = isSteepTriangle(input.legX, input.legY);
  const downhillX = downhillSignX(input.legX, input.legY);
  const uphillIntent = input.horizontalIntent * downhillX < 0;
  // The low tip is the floor. Grabbing it while walking uphill slides the body
  // back off, then the walk speed pulls it in again.
  if (steep && uphillIntent && Math.abs(input.feetY - input.anchorY) <= 6) {
    return null;
  }
  return {
    supported: true,
    feetY: surfaceY,
    slideX: steep ? slopeSlideVelocity(input.legX, input.legY).x * input.deltaSeconds : 0,
    blockUphill: steep && uphillIntent,
    downhillX,
  };
}

/** Stand on the axis-aligned top of a downward-pointing triangle like a platform. */
export function evaluateFlatWalk(input: {
  anchorX: number;
  anchorY: number;
  legX: number;
  legY: number;
  feetX: number;
  feetY: number;
  verticalVelocity: number;
}): FlatWalk | null {
  if (isFloorTriangle(input.legY)) return null;
  const minX = Math.min(input.anchorX, input.anchorX + input.legX);
  const maxX = Math.max(input.anchorX, input.anchorX + input.legX);
  if (input.feetX < minX || input.feetX > maxX) return null;
  const surfaceY = input.anchorY;
  const delta = input.feetY - surfaceY;
  if (delta < -8 || delta > 14) return null;
  if (input.verticalVelocity < -40 && delta < 0) return null;
  return { supported: true, feetY: surfaceY };
}

export function triangleHandlePoints(
  anchorX: number,
  anchorY: number,
  legX: number,
  legY: number,
): Array<{ id: TriangleHandle; x: number; y: number }> {
  const verts = triangleVertices(anchorX, anchorY, legX, legY);
  return [
    { id: 'anchor', x: verts.rightAngle.x, y: verts.rightAngle.y },
    { id: 'horizontalCorner', x: verts.horizontal.x, y: verts.horizontal.y },
    { id: 'verticalCorner', x: verts.vertical.x, y: verts.vertical.y },
    { id: 'horizontalSide', x: (verts.rightAngle.x + verts.horizontal.x) / 2, y: (verts.rightAngle.y + verts.horizontal.y) / 2 },
    { id: 'verticalSide', x: (verts.rightAngle.x + verts.vertical.x) / 2, y: (verts.rightAngle.y + verts.vertical.y) / 2 },
  ];
}

export function hitTriangleHandle(
  anchorX: number,
  anchorY: number,
  legX: number,
  legY: number,
  x: number,
  y: number,
  radius = 8,
): TriangleHandle | null {
  const points = triangleHandlePoints(anchorX, anchorY, legX, legY);
  const corners = points.filter((point) => point.id === 'anchor' || point.id.endsWith('Corner'));
  const sides = points.filter((point) => !corners.includes(point));
  const half = radius;
  for (const point of [...corners, ...sides]) {
    if (Math.abs(point.x - x) <= half && Math.abs(point.y - y) <= half) return point.id;
  }
  return null;
}

export function dragTriangleHandle(
  start: { anchorX: number; anchorY: number; legX: number; legY: number },
  handle: TriangleHandle,
  pointerX: number,
  pointerY: number,
  pointerStartX: number,
  pointerStartY: number,
): { anchorX: number; anchorY: number; legX: number; legY: number } {
  if (handle === 'anchor') {
    const dx = snapTriangleCoord(pointerX - pointerStartX);
    const dy = snapTriangleCoord(pointerY - pointerStartY);
    return { ...start, anchorX: start.anchorX + dx, anchorY: start.anchorY + dy };
  }
  if (handle === 'horizontalCorner') {
    return { ...start, legX: snapTriangleLeg(pointerX - start.anchorX) };
  }
  if (handle === 'verticalCorner') {
    return { ...start, legY: snapTriangleLeg(pointerY - start.anchorY) };
  }
  if (handle === 'horizontalSide') {
    const fixedY = start.anchorY + start.legY;
    const legY = snapTriangleLeg(fixedY - snapTriangleCoord(pointerY));
    return { ...start, anchorY: fixedY - legY, legY };
  }
  const fixedX = start.anchorX + start.legX;
  const nextLegX = snapTriangleLeg(fixedX - snapTriangleCoord(pointerX));
  return { ...start, anchorX: fixedX - nextLegX, legX: nextLegX };
}

export function triangleBitmapLayout(legX: number, legY: number): {
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
} {
  const width = Math.max(1, Math.abs(Math.round(legX)));
  const height = Math.max(1, Math.abs(Math.round(legY)));
  return {
    width,
    height,
    anchorX: legX < 0 ? width : 0,
    anchorY: legY < 0 ? height : 0,
  };
}

export function triangleSpriteCenter(
  anchorX: number,
  anchorY: number,
  legX: number,
  legY: number,
): TrianglePoint {
  const layout = triangleBitmapLayout(legX, legY);
  return {
    x: anchorX + layout.width / 2 - layout.anchorX,
    y: anchorY + layout.height / 2 - layout.anchorY,
  };
}

export function defaultTriangleLegs(flipX: boolean, flipY: boolean): { legX: number; legY: number } {
  return {
    legX: flipX ? -TRIANGLE_DEFAULT_LEG_X : TRIANGLE_DEFAULT_LEG_X,
    legY: flipY ? -TRIANGLE_DEFAULT_LEG_Y : TRIANGLE_DEFAULT_LEG_Y,
  };
}

export function triangleFlipFromLegs(legX: number, legY: number): { flipX: boolean; flipY: boolean } {
  return { flipX: legX < 0, flipY: legY > 0 };
}

export type TriangleOrientId = 'ne' | 'nw' | 'se' | 'sw';

export function triangleOrientId(flipX: boolean, flipY: boolean): TriangleOrientId {
  if (flipX && flipY) return 'sw';
  if (flipX) return 'nw';
  if (flipY) return 'se';
  return 'ne';
}

export function triangleFlipFromOrient(id: TriangleOrientId): { flipX: boolean; flipY: boolean } {
  return {
    flipX: id === 'nw' || id === 'sw',
    flipY: id === 'se' || id === 'sw',
  };
}

export function trianglePlacementAtTile(
  tileX: number,
  tileY: number,
  flipX: boolean,
  flipY: boolean,
): { anchorX: number; anchorY: number; legX: number; legY: number } {
  const legs = defaultTriangleLegs(flipX, flipY);
  return {
    anchorX: tileX * TILE_SIZE,
    anchorY: (tileY + 1) * TILE_SIZE,
    legX: legs.legX,
    legY: legs.legY,
  };
}

export function applyTriangleStampOrientation(
  legX: number,
  legY: number,
  flipX: boolean,
  flipY: boolean,
): { legX: number; legY: number } {
  return {
    legX: snapTriangleLeg(Math.abs(legX) * (flipX ? -1 : 1)),
    legY: snapTriangleLeg(Math.abs(legY) * (flipY ? 1 : -1)),
  };
}

export function triangleHandleMotion(id: TriangleHandle): TriangleHandleMotion {
  if (id === 'anchor') return 'move';
  if (id === 'verticalCorner' || id === 'horizontalSide') return 'vertical';
  return 'horizontal';
}

export function normalizePlacedTriangle(placed: {
  id: string;
  x: number;
  y: number;
  triangleLegX?: number | null;
  triangleLegY?: number | null;
  triangleFill?: string | null;
  triangleStroke?: string | null;
}): TriangleGeometry | null {
  if (!isTrianglePieceObjectId(placed.id)) return null;
  return {
    anchorX: placed.x,
    anchorY: placed.y,
    legX: snapTriangleLeg(placed.triangleLegX ?? TRIANGLE_DEFAULT_LEG_X),
    legY: snapTriangleLeg(placed.triangleLegY ?? TRIANGLE_DEFAULT_LEG_Y),
    fill: parseHexColor(placed.triangleFill, DEFAULT_TRIANGLE_FILL),
    stroke: parseHexColor(placed.triangleStroke, DEFAULT_TRIANGLE_STROKE),
  };
}

export function triangleTextureKey(legX: number, legY: number, fill: string, stroke: string): string {
  return `triangle-piece:${legX}:${legY}:${fill}:${stroke}:edge`;
}

import Phaser from 'phaser';
import { editorState, type PlacedObject } from '../../config';
import {
  hexToRgb,
  normalizePlacedTriangle,
  parseHexColor,
  triangleFlipFromLegs,
  trianglePlacementAtTile,
  triangleVertices,
  DEFAULT_TRIANGLE_FILL,
  DEFAULT_TRIANGLE_STROKE,
} from '../../config/trianglePiece';

export function captureTriangleStamp(placed: PlacedObject): void {
  const geometry = normalizePlacedTriangle(placed);
  if (!geometry) return;
  editorState.triangleStampFill = geometry.fill;
  editorState.triangleStampStroke = geometry.stroke;
  const flip = triangleFlipFromLegs(geometry.legX, geometry.legY);
  editorState.triangleStampFlipX = flip.flipX;
  editorState.triangleStampFlipY = flip.flipY;
}

export function triangleStampStatus(): string {
  return editorState.trianglePaintMode
    ? 'Click ramps to paint this fill and stroke.'
    : 'Click empty space to place. Click a ramp to select it.';
}

export function triangleStampPlacement(tileX: number, tileY: number): {
  anchorX: number;
  anchorY: number;
  legX: number;
  legY: number;
  fill: string;
  stroke: string;
} {
  const placement = trianglePlacementAtTile(
    tileX,
    tileY,
    editorState.triangleStampFlipX,
    editorState.triangleStampFlipY,
  );
  return {
    ...placement,
    fill: parseHexColor(editorState.triangleStampFill, DEFAULT_TRIANGLE_FILL),
    stroke: parseHexColor(editorState.triangleStampStroke, DEFAULT_TRIANGLE_STROKE),
  };
}

export function stampedTriangleFields(placed: PlacedObject): Partial<PlacedObject> {
  const geometry = normalizePlacedTriangle(placed);
  if (!geometry) return {};
  return {
    triangleFill: parseHexColor(editorState.triangleStampFill, geometry.fill),
    triangleStroke: parseHexColor(editorState.triangleStampStroke, geometry.stroke),
  };
}

export function drawTriangleStampPreview(
  graphics: Phaser.GameObjects.Graphics,
  tileX: number,
  tileY: number,
  origin = { x: 0, y: 0 },
): void {
  const stamp = triangleStampPlacement(tileX, tileY);
  const verts = triangleVertices(
    origin.x + stamp.anchorX,
    origin.y + stamp.anchorY,
    stamp.legX,
    stamp.legY,
  );
  const fill = hexToInt(stamp.fill);
  const stroke = hexToInt(stamp.stroke);
  graphics.fillStyle(fill, editorState.trianglePaintMode ? 0.28 : 0.48);
  graphics.fillTriangle(
    verts.rightAngle.x,
    verts.rightAngle.y,
    verts.horizontal.x,
    verts.horizontal.y,
    verts.vertical.x,
    verts.vertical.y,
  );
  graphics.lineStyle(2, stroke, 0.95);
  graphics.strokeTriangle(
    verts.rightAngle.x,
    verts.rightAngle.y,
    verts.horizontal.x,
    verts.horizontal.y,
    verts.vertical.x,
    verts.vertical.y,
  );
}

function hexToInt(hex: string): number {
  const rgb = hexToRgb(hex);
  return (rgb.r << 16) + (rgb.g << 8) + rgb.b;
}

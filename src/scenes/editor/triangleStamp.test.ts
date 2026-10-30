import { describe, expect, it } from 'vitest';
import { editorState, type PlacedObject } from '../../config';
import { stampedTriangleFields, triangleStampStatus } from './triangleStamp';

function triangle(overrides: Partial<PlacedObject> = {}): PlacedObject {
  return {
    id: 'triangle_piece',
    instanceId: 'tri-1',
    x: 32,
    y: 64,
    layer: 'terrain',
    triangleLegX: 48,
    triangleLegY: -64,
    triangleFill: '#111111',
    triangleStroke: '#222222',
    ...overrides,
  };
}

describe('triangle stamp paint', () => {
  it('paints fill and stroke without changing orientation', () => {
    const previous = {
      fill: editorState.triangleStampFill,
      stroke: editorState.triangleStampStroke,
      flipX: editorState.triangleStampFlipX,
      flipY: editorState.triangleStampFlipY,
      paint: editorState.trianglePaintMode,
    };
    editorState.triangleStampFill = '#FF0000';
    editorState.triangleStampStroke = '#00FF00';
    editorState.triangleStampFlipX = true;
    editorState.triangleStampFlipY = true;
    editorState.trianglePaintMode = true;
    try {
      expect(stampedTriangleFields(triangle())).toEqual({
        triangleFill: '#FF0000',
        triangleStroke: '#00FF00',
      });
      expect(triangleStampStatus()).toBe('Click ramps to paint this fill and stroke.');
    } finally {
      editorState.triangleStampFill = previous.fill;
      editorState.triangleStampStroke = previous.stroke;
      editorState.triangleStampFlipX = previous.flipX;
      editorState.triangleStampFlipY = previous.flipY;
      editorState.trianglePaintMode = previous.paint;
    }
  });
});

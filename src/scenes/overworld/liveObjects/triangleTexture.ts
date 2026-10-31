import Phaser from 'phaser';
import {
  hexToRgb,
  pointInTriangle,
  triangleBitmapLayout,
  triangleEdges,
  triangleSpriteCenter,
  triangleTextureKey,
  triangleVertices,
} from '../../../config/trianglePiece';

function paintTriangleCanvas(
  canvas: HTMLCanvasElement,
  legX: number,
  legY: number,
  fill: string,
  stroke: string,
): void {
  const layout = triangleBitmapLayout(legX, legY);
  canvas.width = layout.width;
  canvas.height = layout.height;
  const context = canvas.getContext('2d');
  if (!context) return;
  const image = context.createImageData(layout.width, layout.height);
  const verts = triangleVertices(layout.anchorX, layout.anchorY, legX, legY);
  const edges = triangleEdges(layout.anchorX, layout.anchorY, legX, legY);
  const fillRgb = hexToRgb(fill);
  const strokeRgb = hexToRgb(stroke);
  const points = [verts.rightAngle, verts.horizontal, verts.vertical];
  for (let y = 0; y < layout.height; y += 1) {
    for (let x = 0; x < layout.width; x += 1) {
      const point = { x: x + 0.5, y: y + 0.5 };
      if (!pointInTriangle(point, points[0], points[1], points[2])) continue;
      let nearest = Number.POSITIVE_INFINITY;
      for (const edge of edges) {
        const signed = Math.abs((point.x - edge.a.x) * edge.nx + (point.y - edge.a.y) * edge.ny);
        nearest = Math.min(nearest, signed);
      }
      const color = nearest < 1 ? strokeRgb : fillRgb;
      const offset = (y * layout.width + x) * 4;
      image.data[offset] = color.r;
      image.data[offset + 1] = color.g;
      image.data[offset + 2] = color.b;
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
}

function ensureTriangleTexture(
  scene: Phaser.Scene,
  legX: number,
  legY: number,
  fill: string,
  stroke: string,
): string {
  const key = triangleTextureKey(legX, legY, fill, stroke);
  if (scene.textures.exists(key)) return key;
  const canvas = document.createElement('canvas');
  paintTriangleCanvas(canvas, legX, legY, fill, stroke);
  const texture = scene.textures.addCanvas(key, canvas);
  texture?.setFilter(Phaser.Textures.FilterMode.NEAREST);
  return key;
}

export function placeTriangleSprite(
  sprite: Phaser.GameObjects.Sprite,
  worldAnchorX: number,
  worldAnchorY: number,
  legX: number,
  legY: number,
  fill: string,
  stroke: string,
): void {
  const key = ensureTriangleTexture(sprite.scene, legX, legY, fill, stroke);
  sprite.setTexture(key);
  sprite.setOrigin(0.5, 0.5);
  const center = triangleSpriteCenter(worldAnchorX, worldAnchorY, legX, legY);
  sprite.setPosition(center.x, center.y);
  sprite.setFlip(false, false);
  sprite.rotation = 0;
}

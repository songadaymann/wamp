import Phaser from 'phaser';
import { TILE_SIZE } from '../../../config/room';
import { getTilesetByGid } from '../../../config/tilesets';
import {
  triangleCellFlip,
  trianglePixelLayer,
  triangleTilePoolIndex,
  type TriangleTilePaint,
} from '../../../config/triangleTileFill';
import {
  hexToRgb,
  pointInTriangle,
  triangleBitmapLayout,
  trianglePixelIsStroke,
  triangleSpriteCenter,
  triangleTextureKey,
  triangleVertices,
} from '../../../config/trianglePiece';

function tilePixels(
  scene: Phaser.Scene,
  cache: Map<string, Uint8ClampedArray | null>,
  gid: number,
  flipX: boolean,
  flipY: boolean,
): Uint8ClampedArray | null {
  const cacheKey = `${gid}:${flipX ? 1 : 0}:${flipY ? 1 : 0}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null;
  const tileset = getTilesetByGid(gid);
  let pixels: Uint8ClampedArray | null = null;
  if (tileset && typeof document !== 'undefined' && scene.textures.exists(tileset.key)) {
    const source = scene.textures.get(tileset.key).getSourceImage() as CanvasImageSource | null;
    const localIndex = gid - tileset.firstGid;
    const col = localIndex % tileset.columns;
    const row = Math.floor(localIndex / tileset.columns);
    const tileCanvas = document.createElement('canvas');
    tileCanvas.width = TILE_SIZE;
    tileCanvas.height = TILE_SIZE;
    const tileContext = tileCanvas.getContext('2d', { willReadFrequently: true });
    if (source && tileContext) {
      tileContext.imageSmoothingEnabled = false;
      tileContext.translate(flipX ? TILE_SIZE : 0, flipY ? TILE_SIZE : 0);
      tileContext.scale(flipX ? -1 : 1, flipY ? -1 : 1);
      tileContext.drawImage(
        source,
        col * TILE_SIZE,
        row * TILE_SIZE,
        TILE_SIZE,
        TILE_SIZE,
        0,
        0,
        TILE_SIZE,
        TILE_SIZE,
      );
      pixels = tileContext.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;
    }
  }
  cache.set(cacheKey, pixels);
  return pixels;
}

function paintTriangleCanvas(
  canvas: HTMLCanvasElement,
  scene: Phaser.Scene,
  legX: number,
  legY: number,
  fill: string,
  stroke: string,
  tiles: TriangleTilePaint | null,
  strokeOn: boolean,
  backgroundOn: boolean,
): void {
  const layout = triangleBitmapLayout(legX, legY);
  canvas.width = layout.width;
  canvas.height = layout.height;
  const context = canvas.getContext('2d');
  if (!context) return;
  const image = context.createImageData(layout.width, layout.height);
  const verts = triangleVertices(layout.anchorX, layout.anchorY, legX, legY);
  const fillRgb = hexToRgb(fill);
  const strokeRgb = hexToRgb(stroke);
  const points = [verts.rightAngle, verts.horizontal, verts.vertical];
  const contains = (point: { x: number; y: number }) => pointInTriangle(point, points[0], points[1], points[2]);
  const samples = new Map<string, Uint8ClampedArray | null>();
  const tileFill = Boolean(tiles?.fill && tiles.gids.length > 0);
  for (let y = 0; y < layout.height; y += 1) {
    for (let x = 0; x < layout.width; x += 1) {
      const point = { x: x + 0.5, y: y + 0.5 };
      if (!contains(point)) continue;
      const cellX = Math.floor((point.x - layout.anchorX) / TILE_SIZE);
      const cellY = Math.floor((point.y - layout.anchorY) / TILE_SIZE);
      let tileAlpha: number | null = null;
      let sample: { r: number; g: number; b: number; a: number } | null = null;
      if (tileFill && tiles) {
        const poolIndex = triangleTilePoolIndex(
          tiles.mode,
          cellX,
          cellY,
          legX,
          legY,
          tiles.gids.length,
          tiles.instanceKey,
          tiles.slopeOnly,
        );
        const gid = tiles.gids[poolIndex];
        const flipX = triangleCellFlip(tiles.flipX, tiles.instanceKey, 'x', cellX, cellY);
        const flipY = triangleCellFlip(tiles.flipY, tiles.instanceKey, 'y', cellX, cellY);
        const pixels = tilePixels(scene, samples, gid, flipX, flipY);
        if (pixels) {
          const localX = Math.floor(point.x - layout.anchorX) - cellX * TILE_SIZE;
          const localY = Math.floor(point.y - layout.anchorY) - cellY * TILE_SIZE;
          const sampleX = ((localX % TILE_SIZE) + TILE_SIZE) % TILE_SIZE;
          const sampleY = ((localY % TILE_SIZE) + TILE_SIZE) % TILE_SIZE;
          const sampleOffset = (sampleY * TILE_SIZE + sampleX) * 4;
          sample = {
            r: pixels[sampleOffset],
            g: pixels[sampleOffset + 1],
            b: pixels[sampleOffset + 2],
            a: pixels[sampleOffset + 3],
          };
          tileAlpha = sample.a;
        }
      }
      const onStroke = strokeOn && trianglePixelIsStroke(x, y, contains);
      const layer = trianglePixelLayer(onStroke ? 0 : Number.POSITIVE_INFINITY, tileFill ? tileAlpha : null);
      if (layer === 'background' && !backgroundOn) continue;
      const flatTile = layer === 'tile' && sample && !backgroundOn;
      const color = layer === 'stroke'
        ? strokeRgb
        : layer === 'tile' && sample
          ? flatTile
            ? { r: sample.r, g: sample.g, b: sample.b }
            : {
                r: Math.round(sample.r * (sample.a / 255) + fillRgb.r * (1 - sample.a / 255)),
                g: Math.round(sample.g * (sample.a / 255) + fillRgb.g * (1 - sample.a / 255)),
                b: Math.round(sample.b * (sample.a / 255) + fillRgb.b * (1 - sample.a / 255)),
              }
          : fillRgb;
      const offset = (y * layout.width + x) * 4;
      image.data[offset] = color.r;
      image.data[offset + 1] = color.g;
      image.data[offset + 2] = color.b;
      image.data[offset + 3] = flatTile && sample ? sample.a : 255;
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
  tiles: TriangleTilePaint | null,
  strokeOn = true,
  backgroundOn = true,
): string {
  const key = triangleTextureKey(legX, legY, fill, stroke, tiles, strokeOn, backgroundOn);
  if (scene.textures.exists(key)) return key;
  const canvas = document.createElement('canvas');
  paintTriangleCanvas(canvas, scene, legX, legY, fill, stroke, tiles, strokeOn, backgroundOn);
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
  tiles: TriangleTilePaint | null = null,
  strokeOn = true,
  backgroundOn = true,
): void {
  const key = ensureTriangleTexture(sprite.scene, legX, legY, fill, stroke, tiles, strokeOn, backgroundOn);
  sprite.setTexture(key);
  sprite.setOrigin(0.5, 0.5);
  const center = triangleSpriteCenter(worldAnchorX, worldAnchorY, legX, legY);
  sprite.setPosition(center.x, center.y);
  sprite.setFlip(false, false);
  sprite.rotation = 0;
}

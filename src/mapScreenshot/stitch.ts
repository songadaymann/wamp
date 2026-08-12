import type { StitchTile } from './tiles';
import {
  SCREENSHOT_BACKGROUND,
  SCREENSHOT_HEIGHT,
  SCREENSHOT_WIDTH,
} from './config';
import { TILE_CONTENT_HEIGHT, TILE_CONTENT_WIDTH, TILE_OVERLAP } from './bounds';

export interface StitchRequest {
  width: number;
  height: number;
  zoom: number;
  cameraLeft: number;
  cameraTop: number;
  background: string;
  overlap: number;
  contentWidth: number;
  contentHeight: number;
  tiles: Array<Pick<StitchTile, 'url' | 'worldX' | 'worldY' | 'worldWidth' | 'worldHeight'>>;
}

export function buildStitchRequest(input: {
  zoom: number;
  centerWorldX: number;
  centerWorldY: number;
  tiles: StitchTile[];
}): StitchRequest {
  const zoom = input.zoom;
  return {
    width: SCREENSHOT_WIDTH,
    height: SCREENSHOT_HEIGHT,
    zoom,
    cameraLeft: input.centerWorldX - SCREENSHOT_WIDTH / (2 * zoom),
    cameraTop: input.centerWorldY - SCREENSHOT_HEIGHT / (2 * zoom),
    background: SCREENSHOT_BACKGROUND,
    overlap: TILE_OVERLAP,
    contentWidth: TILE_CONTENT_WIDTH,
    contentHeight: TILE_CONTENT_HEIGHT,
    tiles: input.tiles.map((tile) => ({
      url: tile.url,
      worldX: tile.worldX,
      worldY: tile.worldY,
      worldWidth: tile.worldWidth,
      worldHeight: tile.worldHeight,
    })),
  };
}

/** Inline HTML loaded into Cloudflare Browser Rendering via setContent. */
export function buildStitchPageHtml(): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>WAMP map screenshot stitch</title>
  <style>
    html, body { margin: 0; background: #050505; }
    canvas { display: block; image-rendering: pixelated; }
  </style>
</head>
<body>
<script>
window.__MAP_SCREENSHOT_STITCH__ = {
  async render(request) {
    const canvas = document.createElement('canvas');
    canvas.width = request.width;
    canvas.height = request.height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2d canvas unavailable');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = request.background || '#050505';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const loaded = await Promise.all(request.tiles.map(async (tile) => {
      try {
        const image = await loadImage(tile.url);
        return { tile, image };
      } catch (error) {
        console.warn('tile load failed', tile.url, error);
        return null;
      }
    }));

    for (const entry of loaded) {
      if (!entry) continue;
      const { tile, image } = entry;
      const destX = (tile.worldX - request.cameraLeft) * request.zoom;
      const destY = (tile.worldY - request.cameraTop) * request.zoom;
      const destW = tile.worldWidth * request.zoom;
      const destH = tile.worldHeight * request.zoom;
      ctx.drawImage(
        image,
        request.overlap,
        request.overlap,
        request.contentWidth,
        request.contentHeight,
        destX,
        destY,
        destW,
        destH
      );
    }

    return canvas.toDataURL('image/png');
  }
};
window.__MAP_SCREENSHOT_STITCH_READY__ = true;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load tile image'));
    image.src = url;
  });
}
</script>
</body>
</html>`;
}

export function pngDataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const prefix = 'data:image/png;base64,';
  if (!dataUrl.startsWith(prefix)) {
    throw new Error('Stitch did not return a PNG data URL.');
  }
  const binary = atob(dataUrl.slice(prefix.length));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

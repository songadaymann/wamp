import type { StitchTile } from './tiles';
import {
  GRID_EMPTY_COLOR,
  GRID_PUBLISHED_COLOR,
  INFO_OVERLAY_INSET_PX,
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
  SCREENSHOT_BACKGROUND,
  SCREENSHOT_HEIGHT,
  SCREENSHOT_WIDTH,
} from './config';
import { TILE_CONTENT_HEIGHT, TILE_CONTENT_WIDTH, TILE_OVERLAP } from './bounds';

export interface StitchGridRoomBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface StitchInfoOverlayData {
  date: string;
  players: string;
  builders: string;
  rooms: string;
}

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
  publishedRooms: Array<{ x: number; y: number }>;
  roomPxW: number;
  roomPxH: number;
  gridPublishedColor: string;
  gridEmptyColor: string;
  gridRoomBounds: StitchGridRoomBounds;
  /** Kept for editable template sync; HUD is drawn via canvas fillText (SVG foreignObject cannot load font data URLs). */
  infoHtml: string;
  infoOverlay: StitchInfoOverlayData;
  earlyGameboyDataUrl: string;
  homeVideoDataUrl: string;
  infoInset: number;
  /** Cached composite starfield PNG data URL; when set, drawn instead of regenerating. */
  starfieldDataUrl: string | null;
  /** When true (and no starfieldDataUrl), generate once with fixed seeds and return starfield PNG. */
  generateStarfield: boolean;
}

export function buildStitchRequest(input: {
  zoom: number;
  centerWorldX: number;
  centerWorldY: number;
  tiles: StitchTile[];
  publishedRooms: Array<{ x: number; y: number }>;
  gridRoomBounds: StitchGridRoomBounds;
  infoHtml: string;
  infoOverlay: StitchInfoOverlayData;
  earlyGameboyDataUrl: string;
  homeVideoDataUrl: string;
  infoInset?: number;
  starfieldDataUrl?: string | null;
  generateStarfield?: boolean;
}): StitchRequest {
  const zoom = input.zoom;
  const starfieldDataUrl = input.starfieldDataUrl ?? null;
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
    publishedRooms: input.publishedRooms,
    roomPxW: ROOM_PX_WIDTH,
    roomPxH: ROOM_PX_HEIGHT,
    gridPublishedColor: GRID_PUBLISHED_COLOR,
    gridEmptyColor: GRID_EMPTY_COLOR,
    gridRoomBounds: input.gridRoomBounds,
    infoHtml: input.infoHtml,
    infoOverlay: input.infoOverlay,
    earlyGameboyDataUrl: input.earlyGameboyDataUrl,
    homeVideoDataUrl: input.homeVideoDataUrl,
    infoInset: input.infoInset ?? INFO_OVERLAY_INSET_PX,
    starfieldDataUrl,
    generateStarfield: input.generateStarfield ?? !starfieldDataUrl,
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
    const debug = {
      stage: 'start',
      tileCount: (request.tiles && request.tiles.length) || 0,
      width: request.width,
      height: request.height,
      infoHtmlLen: (request.infoHtml && request.infoHtml.length) || 0,
      fontCssLen: 0,
      hasEarlyFont: Boolean(request.earlyGameboyDataUrl),
      hasHomeFont: Boolean(request.homeVideoDataUrl),
      drawMode: 'canvas-fillText',
      failedUrlPrefix: null,
      failedUrlLen: null,
      failedLabel: null,
    };
    try {
      const canvas = document.createElement('canvas');
      canvas.width = request.width;
      canvas.height = request.height;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('2d canvas unavailable');
      ctx.imageSmoothingEnabled = false;

      debug.stage = 'starfield';
      ctx.fillStyle = request.background || '#050505';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const starfieldResult = await drawStarfieldBackdrop(ctx, request);
      debug.hasCachedStarfield = Boolean(request.starfieldDataUrl);
      debug.generatedStarfield = Boolean(starfieldResult);

      debug.stage = 'tiles';
      const loaded = await Promise.all(request.tiles.map(async (tile, index) => {
        try {
          const image = await loadImage(tile.url, 'tile:' + index);
          return { tile, image };
        } catch (error) {
          debug.failedLabel = 'tile:' + index;
          debug.failedUrlPrefix = String(tile.url || '').slice(0, 48);
          debug.failedUrlLen = String(tile.url || '').length;
          throw error;
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

      debug.stage = 'seams';
      drawSharedRoomSeams(ctx, request);

      debug.stage = 'infoOverlay';
      try {
        await drawInfoOverlay(ctx, request);
      } catch (error) {
        debug.failedLabel = 'infoOverlay';
        throw error;
      }

      debug.stage = 'cornerMark';
      try {
        await drawCornerMark(ctx, request);
      } catch (error) {
        debug.failedLabel = 'cornerMark';
        throw error;
      }

      debug.stage = 'done';
      return {
        ok: true,
        dataUrl: canvas.toDataURL('image/png'),
        starfieldDataUrl: starfieldResult || undefined,
        debug,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        debug,
      };
    }
  }
};
window.__MAP_SCREENSHOT_STITCH_READY__ = true;

function loadImage(url, label) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(
      'Failed to load image [' + (label || 'unknown') + '] len=' + String(url || '').length
      + ' prefix=' + String(url || '').slice(0, 40)
    ));
    image.src = url;
  });
}

function nextSeed(seed) {
  return (Math.imul(seed, 1664525) + 1013904223) >>> 0;
}

/** Full-frame unique starfield (no tiling). Port of starfield.ts density. */
function createFullStarfield(width, height, seed) {
  const field = document.createElement('canvas');
  field.width = width;
  field.height = height;
  const tctx = field.getContext('2d', { alpha: false });
  if (!tctx) throw new Error('starfield context unavailable');
  tctx.imageSmoothingEnabled = false;
  tctx.fillStyle = '#050505';
  tctx.fillRect(0, 0, width, height);

  let localSeed = (seed >>> 0) || 0x05260527;
  const starCount = Math.max(18, Math.round((width * height) / 2200));
  for (let index = 0; index < starCount; index++) {
    localSeed = nextSeed(localSeed);
    const x = localSeed % width;
    localSeed = nextSeed(localSeed);
    const y = localSeed % height;
    localSeed = nextSeed(localSeed);
    const brightness = localSeed & 0xff;
    const starSize = brightness > 232 ? 2 : 1;
    tctx.globalAlpha = brightness > 210 ? 0.95 : brightness > 120 ? 0.65 : 0.35;
    if (brightness > 242) tctx.fillStyle = '#ffd79a';
    else if (brightness < 18) tctx.fillStyle = '#7de5ff';
    else tctx.fillStyle = '#f3eee2';
    tctx.fillRect(x, y, starSize, starSize);
  }
  tctx.globalAlpha = 1;
  return field;
}

/**
 * Draw the composite starfield once.
 * - If request.starfieldDataUrl is set, reuse the cached PNG (no regeneration).
 * - Else generate with fixed seeds at request.width × request.height and return
 *   the starfield-only PNG data URL so the Worker can cache it in R2.
 */
async function drawStarfieldBackdrop(ctx, request) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (request.starfieldDataUrl) {
    const image = await loadImage(request.starfieldDataUrl, 'starfield-cache');
    ctx.drawImage(image, 0, 0);
    return null;
  }

  // Fixed seeds + fixed canvas size → bit-identical stars every generation.
  const composite = document.createElement('canvas');
  composite.width = request.width;
  composite.height = request.height;
  const cctx = composite.getContext('2d', { alpha: false });
  if (!cctx) throw new Error('starfield composite context unavailable');
  cctx.imageSmoothingEnabled = false;
  cctx.fillStyle = request.background || '#050505';
  cctx.fillRect(0, 0, composite.width, composite.height);

  const layers = [
    { alpha: 1, seed: 0x05260527 },
    { alpha: 0.28, seed: 0x11a4c33d },
  ];
  for (const layer of layers) {
    const field = createFullStarfield(request.width, request.height, layer.seed);
    cctx.save();
    cctx.globalAlpha = layer.alpha;
    cctx.drawImage(field, 0, 0);
    cctx.restore();
  }

  ctx.drawImage(composite, 0, 0);
  if (request.generateStarfield) {
    return composite.toDataURL('image/png');
  }
  return null;
}

function roomKey(x, y) {
  return x + ',' + y;
}

function drawSharedRoomSeams(ctx, request) {
  const bounds = request.gridRoomBounds;
  if (!bounds) return;
  const published = new Set((request.publishedRooms || []).map((r) => roomKey(r.x, r.y)));
  const roomW = request.roomPxW;
  const roomH = request.roomPxH;
  const zoom = request.zoom;
  const gray = request.gridPublishedColor || '#808080';
  const dark = request.gridEmptyColor || '#1a0f0b';

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.lineWidth = 1;

  // Vertical seams at room x boundaries minX .. maxX+1
  for (let x = bounds.minX; x <= bounds.maxX + 1; x += 1) {
    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
      const touchesPublished = published.has(roomKey(x - 1, y)) || published.has(roomKey(x, y));
      const worldX = x * roomW;
      const worldY0 = y * roomH;
      const worldY1 = (y + 1) * roomH;
      const sx = Math.round((worldX - request.cameraLeft) * zoom) + 0.5;
      const sy0 = Math.round((worldY0 - request.cameraTop) * zoom);
      const sy1 = Math.round((worldY1 - request.cameraTop) * zoom);
      ctx.strokeStyle = touchesPublished ? gray : dark;
      ctx.beginPath();
      ctx.moveTo(sx, sy0);
      ctx.lineTo(sx, sy1);
      ctx.stroke();
    }
  }

  // Horizontal seams at room y boundaries minY .. maxY+1
  for (let y = bounds.minY; y <= bounds.maxY + 1; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const touchesPublished = published.has(roomKey(x, y - 1)) || published.has(roomKey(x, y));
      const worldY = y * roomH;
      const worldX0 = x * roomW;
      const worldX1 = (x + 1) * roomW;
      const sy = Math.round((worldY - request.cameraTop) * zoom) + 0.5;
      const sx0 = Math.round((worldX0 - request.cameraLeft) * zoom);
      const sx1 = Math.round((worldX1 - request.cameraLeft) * zoom);
      ctx.strokeStyle = touchesPublished ? gray : dark;
      ctx.beginPath();
      ctx.moveTo(sx0, sy);
      ctx.lineTo(sx1, sy);
      ctx.stroke();
    }
  }

  ctx.restore();
}

async function ensureHudFonts(request) {
  if (!document.fonts || typeof FontFace === 'undefined') {
    throw new Error('FontFace API unavailable in stitch browser.');
  }
  if (!request._fontsReady) {
    const early = new FontFace('Early Gameboy', 'url(' + request.earlyGameboyDataUrl + ')');
    const home = new FontFace('HomeVideo', 'url(' + request.homeVideoDataUrl + ')');
    const loaded = await Promise.all([early.load(), home.load()]);
    for (const face of loaded) document.fonts.add(face);
    request._fontsReady = true;
  }
  await document.fonts.ready;
  await document.fonts.load('36px "Early Gameboy"');
  await document.fonts.load('28px HomeVideo');
  await document.fonts.load('100px "Early Gameboy"');
}

async function drawInfoOverlay(ctx, request) {
  const inset = typeof request.infoInset === 'number' ? request.infoInset : 50;
  const info = request.infoOverlay || {};
  await ensureHudFonts(request);

  const padX = 28;
  const padY = 22;
  const border = 5;
  const titleSize = 36;
  const dateSize = 32;
  const bodySize = 28;
  const titleGap = 14;
  const lineGap = bodySize * 1.45;

  const titleLines = ['We All Make A', 'Platformer'];
  const date = String(info.date || '');
  const lines = [
    { label: 'Players: ', value: String(info.players || '') },
    { label: 'Builders: ', value: String(info.builders || '') },
    { label: 'Rooms Built: ', value: String(info.rooms || '') },
  ];

  ctx.save();
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  ctx.font = titleSize + 'px "Early Gameboy"';
  let contentW = 0;
  for (const line of titleLines) contentW = Math.max(contentW, ctx.measureText(line).width);

  ctx.font = dateSize + 'px HomeVideo';
  contentW = Math.max(contentW, ctx.measureText(date).width);

  ctx.font = bodySize + 'px HomeVideo';
  for (const row of lines) {
    contentW = Math.max(contentW, ctx.measureText(row.label + row.value).width);
  }

  const contentH =
    titleLines.length * titleSize * 1.2
    + titleGap
    + dateSize * 1.45
    + lines.length * lineGap;

  const boxW = Math.ceil(contentW + padX * 2);
  const boxH = Math.ceil(contentH + padY * 2);
  const x = inset;
  const y = inset;

  ctx.fillStyle = 'rgba(5, 5, 5, 0.78)';
  ctx.fillRect(x, y, boxW, boxH);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = border;
  ctx.strokeRect(x + border / 2, y + border / 2, boxW - border, boxH - border);

  let cursorY = y + padY;
  const textX = x + padX;

  ctx.fillStyle = 'rgb(252, 234, 124)';
  ctx.font = titleSize + 'px "Early Gameboy"';
  for (const line of titleLines) {
    ctx.fillText(line, textX, cursorY);
    cursorY += titleSize * 1.2;
  }
  cursorY += titleGap - titleSize * 0.2;

  ctx.fillStyle = '#79ccde';
  ctx.font = dateSize + 'px HomeVideo';
  ctx.fillText(date, textX, cursorY);
  cursorY += dateSize * 1.45;

  for (const row of lines) {
    ctx.font = bodySize + 'px HomeVideo';
    ctx.fillStyle = '#a89f8f';
    ctx.fillText(row.label, textX, cursorY);
    const labelW = ctx.measureText(row.label).width;
    ctx.fillStyle = '#f65699';
    ctx.fillText(row.value, textX + labelW, cursorY);
    cursorY += lineGap;
  }

  ctx.restore();
}

async function drawCornerMark(ctx, request) {
  const inset = typeof request.infoInset === 'number' ? request.infoInset : 50;
  await ensureHudFonts(request);

  const text = 'WAMP.LAND';
  const fontSize = 100;
  ctx.save();
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'right';
  ctx.fillStyle = '#faaa39';
  ctx.font = fontSize + 'px "Early Gameboy"';
  ctx.fillText(text, request.width - inset, request.height - inset);
  ctx.restore();
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

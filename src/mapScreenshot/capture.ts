import type { BrowserWorker } from '@cloudflare/puppeteer';
import {
  chooseTileLevelForZoom,
  padPublishedBounds,
  roomBoundsToWorldPixels,
  roomToTileCoordinate,
  type WorldTileLevel,
} from './bounds';
import {
  FONT_PUBLIC_BASE_URL,
  INFO_OVERLAY_INSET_PX,
  MAX_STITCH_TILES,
  PADDING_ROOMS,
} from './config';
import { fillInfoOverlayTemplate } from './infoOverlay';
import { formatEasternDate, formatEasternLongDate } from './naming';
import { loadMapScreenshotStats } from './stats';
import { buildStitchRequest } from './stitch';
import { stitchMapScreenshotPng } from './stitchBrowser';
import {
  dailyFileNameForToday,
  loadStarfieldDataUrl,
  loadZoomState,
  nextManualFileName,
  saveScreenshotPng,
  saveStarfieldPng,
  saveZoomState,
  screenshotExists,
  type ScreenshotR2Bucket,
} from './storage';
import {
  loadActiveRendererVersion,
  loadPublishedRoomBounds,
  loadPublishedRoomCoordinates,
  loadStitchTiles,
  type MapScreenshotDb,
} from './tiles';
import { applyGradualZoom, computeIdealFitZoom } from './zoom';
import { buildDailyCaption, maybePostToTwitter, type TwitterEnv } from './twitter';

export interface MapScreenshotEnv extends TwitterEnv {
  DB: MapScreenshotDb;
  SCREENSHOTS: ScreenshotR2Bucket;
  MAP_SCREENSHOT_BROWSER: BrowserWorker;
  WORLD_TILE_PUBLIC_BASE_URL: string;
  MAP_SCREENSHOT_PUBLIC_BASE_URL?: string;
}

export type CaptureMode = 'daily' | 'manual';

export interface CaptureResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  error?: string;
  fileName?: string;
  key?: string;
  zoom?: number;
  idealZoom?: number;
  level?: WorldTileLevel;
  roomCount?: number;
  twitter?: { posted: boolean; reason: string };
}

async function fetchTileAsDataUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch tile ${url}: HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

async function fetchFontAsDataUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch font ${url}: HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return `data:font/ttf;base64,${bytes.toString('base64')}`;
}

export async function captureMapScreenshot(
  env: MapScreenshotEnv,
  mode: CaptureMode,
): Promise<CaptureResult> {
  const easternDate = formatEasternDate();
  let fileName: string;
  if (mode === 'daily') {
    fileName = dailyFileNameForToday();
    if (await screenshotExists(env.SCREENSHOTS, fileName)) {
      return {
        ok: true,
        skipped: true,
        reason: `Daily screenshot ${fileName} already exists.`,
        fileName,
      };
    }
  } else {
    const next = await nextManualFileName(env.SCREENSHOTS, easternDate);
    if (!next) {
      return {
        ok: false,
        skipped: true,
        reason: `Manual screenshot limit reached for ${easternDate} (_9 already exists).`,
      };
    }
    fileName = next;
  }

  const published = await loadPublishedRoomBounds(env.DB);
  if (!published) {
    return { ok: false, reason: 'No published rooms found.' };
  }

  const padded = padPublishedBounds(published, PADDING_ROOMS);
  const world = roomBoundsToWorldPixels(padded);
  const idealZoom = computeIdealFitZoom(world);
  const previous = await loadZoomState(env.SCREENSHOTS);
  const zoom = applyGradualZoom(idealZoom, previous?.zoom ?? null);
  const fetchPadding = PADDING_ROOMS + 2;
  const fetchMinX = published.minX - fetchPadding;
  const fetchMaxX = published.maxX + fetchPadding;
  const fetchMinY = published.minY - fetchPadding;
  const fetchMaxY = published.maxY + fetchPadding;
  const level = chooseLevelWithinTileBudget(zoom, fetchMinX, fetchMaxX, fetchMinY, fetchMaxY);

  const rendererVersion = await loadActiveRendererVersion(env.DB);
  if (!rendererVersion) {
    return { ok: false, reason: 'No active world-tile renderer version.' };
  }

  const publicBaseUrl = env.WORLD_TILE_PUBLIC_BASE_URL?.trim();
  if (!publicBaseUrl) {
    return { ok: false, reason: 'WORLD_TILE_PUBLIC_BASE_URL is not configured.' };
  }

  const fontBase = FONT_PUBLIC_BASE_URL.replace(/\/$/, '');
  const [publishedRooms, stats, earlyGameboyDataUrl, homeVideoDataUrl, tiles, starfieldDataUrl] =
    await Promise.all([
      loadPublishedRoomCoordinates(env.DB, padded.minX, padded.maxX, padded.minY, padded.maxY),
      loadMapScreenshotStats(env.DB),
      fetchFontAsDataUrl(`${fontBase}/assets/fonts/early-gameboy.ttf`),
      fetchFontAsDataUrl(`${fontBase}/assets/fonts/HomeVideo-Regular.ttf`),
      loadStitchTiles({
        db: env.DB,
        rendererVersion,
        level,
        roomMinX: fetchMinX,
        roomMaxX: fetchMaxX,
        roomMinY: fetchMinY,
        roomMaxY: fetchMaxY,
        publicBaseUrl,
      }),
      loadStarfieldDataUrl(env.SCREENSHOTS),
    ]);

  if (tiles.length === 0) {
    return { ok: false, reason: `No ready tiles at L${level} for the published bounds.` };
  }

  // Fetch tiles in the Worker and pass data URLs so Browser Rendering setContent
  // pages (opaque origin) are not blocked by tile CDN CORS.
  const tilesWithDataUrls = await Promise.all(tiles.map(async (tile) => ({
    ...tile,
    url: await fetchTileAsDataUrl(tile.url),
  })));

  const infoOverlay = {
    date: formatEasternLongDate(),
    players: new Intl.NumberFormat('en-US').format(stats.players),
    builders: new Intl.NumberFormat('en-US').format(stats.builders),
    rooms: new Intl.NumberFormat('en-US').format(stats.rooms),
  };
  const infoHtml = fillInfoOverlayTemplate({
    date: infoOverlay.date,
    players: stats.players,
    builders: stats.builders,
    rooms: stats.rooms,
  });

  const stitchRequest = buildStitchRequest({
    zoom,
    centerWorldX: world.centerX,
    centerWorldY: world.centerY,
    tiles: tilesWithDataUrls,
    publishedRooms,
    gridRoomBounds: {
      minX: padded.minX,
      maxX: padded.maxX,
      minY: padded.minY,
      maxY: padded.maxY,
    },
    infoHtml,
    infoOverlay,
    earlyGameboyDataUrl,
    homeVideoDataUrl,
    infoInset: INFO_OVERLAY_INSET_PX,
    starfieldDataUrl,
    generateStarfield: !starfieldDataUrl,
  });

  let pngBytes: ArrayBuffer;
  let starfieldPngBytes: ArrayBuffer | null = null;
  try {
    const stitchResult = await stitchMapScreenshotPng(env.MAP_SCREENSHOT_BROWSER, stitchRequest);
    pngBytes = stitchResult.pngBytes;
    starfieldPngBytes = stitchResult.starfieldPngBytes;
  } catch (error) {
    const stitchDebug = (error as Error & { stitchDebug?: Record<string, unknown> }).stitchDebug;
    const stage = typeof stitchDebug?.stage === 'string' ? ` (stage: ${stitchDebug.stage})` : '';
    return {
      ok: false,
      reason: (error instanceof Error ? error.message : String(error)) + stage,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (starfieldPngBytes) {
    await saveStarfieldPng(env.SCREENSHOTS, starfieldPngBytes);
  }

  const key = await saveScreenshotPng(env.SCREENSHOTS, fileName, pngBytes);
  await saveZoomState(env.SCREENSHOTS, {
    zoom,
    updatedAt: new Date().toISOString(),
    easternDate,
  });

  const twitter = mode === 'daily'
    ? await maybePostToTwitter(env, {
      pngBytes,
      fileName,
      caption: buildDailyCaption(easternDate, published.roomCount),
    })
    : undefined;

  return {
    ok: true,
    fileName,
    key,
    zoom,
    idealZoom,
    level,
    roomCount: published.roomCount,
    twitter,
  };
}

function chooseLevelWithinTileBudget(
  zoom: number,
  roomMinX: number,
  roomMaxX: number,
  roomMinY: number,
  roomMaxY: number,
): WorldTileLevel {
  let level = chooseTileLevelForZoom(zoom);
  while (level > 0 && countTilesForRooms(level, roomMinX, roomMaxX, roomMinY, roomMaxY) > MAX_STITCH_TILES) {
    level = (level - 1) as WorldTileLevel;
  }
  return level;
}

function countTilesForRooms(
  level: WorldTileLevel,
  roomMinX: number,
  roomMaxX: number,
  roomMinY: number,
  roomMaxY: number,
): number {
  const minTile = roomToTileCoordinate(roomMinX, roomMinY, level);
  const maxTile = roomToTileCoordinate(roomMaxX, roomMaxY, level);
  return (maxTile.x - minTile.x + 1) * (maxTile.y - minTile.y + 1);
}

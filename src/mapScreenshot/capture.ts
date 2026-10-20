/// <reference path="../../generated-bindings/map-screenshot-worker-configuration.d.ts" />
import type { CaptureLease } from './lease';
import type { D1Database } from '../cloudflare/worker/core/types';
import type { BrowserWorker } from '@cloudflare/puppeteer';
import type { ScreenshotR2Bucket } from './storage';
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
  MAX_ZOOM_DELTA_PER_DAY,
  PADDING_ROOMS,
} from './config';
import { fillInfoOverlayTemplate } from './infoOverlay';
import { formatEasternLongDate } from './naming';
import { loadMapScreenshotStats } from './stats';
import { buildStitchRequest } from './stitch';
import { stitchMapScreenshotPng } from './stitchBrowser';
import { CaptureBrowserCleanupError } from './managedBrowser';
import {
  loadPreviousZoom,
  loadStarfieldDataUrl,
  saveScreenshotPng,
  saveStarfieldPng,
} from './storage';
import {
  loadActiveRendererVersion,
  loadPublishedRoomBounds,
  loadPublishedRoomCoordinates,
  loadStitchTiles,
} from './tiles';
import { resolveCaptureZoom, computeIdealFitZoom } from './zoom';
import { buildDailyCaption, maybePostToTwitter, type TwitterEnv } from './twitter';

export type MapScreenshotEnv = Pick<MapScreenshotBindings, 'WORLD_TILE_PUBLIC_BASE_URL' | 'MAP_SCREENSHOT_ADMIN_BASE_URL'> & TwitterEnv & { DB: D1Database; SCREENSHOTS: ScreenshotR2Bucket; MAP_SCREENSHOT_BROWSER: BrowserWorker };

export type CaptureMode = 'daily' | 'manual';

export interface CaptureResult {
  ok: boolean;
  skipped?: boolean;
  busy?: boolean;
  reason?: string;
  error?: string;
  fileName?: string;
  key?: string;
  zoom?: number;
  previousZoom?: number | null;
  idealZoom?: number;
  zoomDelta?: number;
  clamped?: boolean;
  level?: WorldTileLevel;
  roomCount?: number;
  twitter?: { posted: boolean; reason: string };
}

async function fetchTileAsDataUrl(url: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Failed to fetch tile ${url}: HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

async function fetchFontAsDataUrl(url: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Failed to fetch font ${url}: HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return `data:font/ttf;base64,${bytes.toString('base64')}`;
}

export async function renderMapScreenshot(
  env: MapScreenshotEnv,
  capture: { mode: CaptureMode; lease: CaptureLease; signal: AbortSignal; startedAt: number; assertActive(): Promise<void> },
): Promise<CaptureResult> {
  const { mode, lease, signal, assertActive } = capture;
  const easternDate = lease.day, fileName = lease.fileName;
  await assertActive();
  const published = await loadPublishedRoomBounds(env.DB);
  if (!published) {
    return { ok: false, reason: 'No published rooms found.' };
  }

  const padded = padPublishedBounds(published, PADDING_ROOMS);
  const world = roomBoundsToWorldPixels(padded);
  const idealZoom = computeIdealFitZoom(world);
  const previousZoom = lease.previousZoom ?? await loadPreviousZoom(env.SCREENSHOTS);
  const zoom = resolveCaptureZoom(mode, idealZoom, previousZoom);
  const zoomDelta = previousZoom === null ? idealZoom : zoom - previousZoom;
  const clamped =
    mode === 'daily' && previousZoom !== null && Math.abs(idealZoom - previousZoom) > MAX_ZOOM_DELTA_PER_DAY;
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
      fetchFontAsDataUrl(`${fontBase}/assets/fonts/early-gameboy.ttf`, signal),
      fetchFontAsDataUrl(`${fontBase}/assets/fonts/HomeVideo-Regular.ttf`, signal),
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
    url: await fetchTileAsDataUrl(tile.url, signal),
  })));

  const infoOverlay = {
    date: formatEasternLongDate(new Date(capture.startedAt)),
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
    await assertActive();
    const stitchResult = await stitchMapScreenshotPng(env.MAP_SCREENSHOT_BROWSER, stitchRequest, signal);
    await assertActive();
    pngBytes = stitchResult.pngBytes;
    starfieldPngBytes = stitchResult.starfieldPngBytes;
  } catch (error) {
    if (error instanceof CaptureBrowserCleanupError) throw error;
    const stitchDebug = (error as Error & { stitchDebug?: Record<string, unknown> }).stitchDebug;
    const stage = typeof stitchDebug?.stage === 'string' ? ` (stage: ${stitchDebug.stage})` : '';
    return {
      ok: false,
      reason: (error instanceof Error ? error.message : String(error)) + stage,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (starfieldPngBytes) {
    await assertActive();
    await saveStarfieldPng(env.SCREENSHOTS, starfieldPngBytes);
  }

  await assertActive();
  const key = await saveScreenshotPng(env.SCREENSHOTS, fileName, pngBytes, zoom);
  await assertActive();

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
    previousZoom,
    idealZoom,
    zoomDelta,
    clamped,
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

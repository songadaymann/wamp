import type { CustomBackgroundFit } from '../backgrounds/model';
import decodeJpegBytes from 'jpeg-js/lib/decoder.js';
import {
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
} from '../config';
import type { RoomImageEnvironment } from './types';
import {
  blitImageSmooth,
  decodePng,
  isJpeg,
  isPng,
  type RoomImageData,
} from './roomImagePrimitives';
import { resolveApiBaseUrl } from './environment';

const MAX_TILED_PHOTO_WIDTH = 128;
const MAX_TILED_PHOTO_HEIGHT = 96;
const MAX_CUSTOM_BACKGROUND_DECODE_MP = 8;
const MAX_CUSTOM_BACKGROUND_DECODE_MEMORY_MB = 96;

const imageDataCache = new Map<string, Promise<RoomImageData>>();
const imageCacheBytes = new Map<string, number>();
const IMAGE_CACHE_MAX_BYTES = 32 * 1024 * 1024;
const IMAGE_CACHE_MAX_ENTRIES = 64;

function cachedImage(key: string): Promise<RoomImageData> | undefined {
  const pending = imageDataCache.get(key);
  if (pending) { imageDataCache.delete(key); imageDataCache.set(key, pending); }
  return pending;
}

function cacheImage(key: string, pending: Promise<RoomImageData>): Promise<RoomImageData> {
  const tracked = pending.then(image => {
    if (imageDataCache.get(key) === tracked) { imageCacheBytes.set(key, image.pixels.byteLength); trimImageCache(); }
    return image;
  });
  imageDataCache.set(key, tracked); trimImageCache(); return tracked;
}

function trimImageCache(): void {
  let bytes = [...imageCacheBytes.values()].reduce((sum, size) => sum + size, 0);
  while (bytes > IMAGE_CACHE_MAX_BYTES || imageDataCache.size > IMAGE_CACHE_MAX_ENTRIES) {
    const key = imageDataCache.keys().next().value;
    if (key === undefined) break;
    bytes -= imageCacheBytes.get(key) ?? 0;
    imageDataCache.delete(key); imageCacheBytes.delete(key);
  }
}


export interface ImageSize {
  width: number;
  height: number;
}

export interface ImageRect extends ImageSize {
  x: number;
  y: number;
}

interface CloudflareImageRequestInit extends RequestInit {
  cf: {
    image: {
      format: 'png';
    };
  };
}

export function normalizeAssetPath(assetPath: unknown): string {
  const trimmed = String(assetPath || '').trim();
  return `/${trimmed.replace(/^\/+/, '')}`;
}

export async function loadAssetImageData(
  request: Request,
  env: RoomImageEnvironment,
  url: URL,
  assetPath: unknown,
): Promise<RoomImageData> {
  const normalizedPath = normalizeAssetPath(assetPath);
  let pending = cachedImage(normalizedPath);
  if (pending) {
    return pending;
  }

  pending = (async () => {
    const assetUrl = new URL(normalizedPath, url.origin);
    const response = await env.ASSETS.fetch(new Request(assetUrl, request));
    if (!response.ok) {
      throw new Error(`Failed to load asset ${normalizedPath}`);
    }

    return decodePng(new Uint8Array(await response.arrayBuffer()));
  })();
  return cacheImage(normalizedPath, pending);
}

export async function loadCustomBackgroundImageData(
  request: Request,
  env: RoomImageEnvironment,
  url: URL,
  id: string,
): Promise<RoomImageData> {
  if (env.loadCustomBackground) return env.loadCustomBackground(id);
  const apiBaseUrl = resolveApiBaseUrl(env, url);
  const imageUrl = new URL(`/api/background-images/${encodeURIComponent(id)}/image`, apiBaseUrl);
  const cacheKey = `custom-background:${imageUrl.toString()}`;
  let pending = cachedImage(cacheKey);
  if (pending) {
    return pending;
  }

  pending = (async () => {
    const requestInit: CloudflareImageRequestInit = {
      headers: {
        Accept: 'image/png',
        'User-Agent': request.headers.get('User-Agent') || 'WAMP room share renderer',
      },
      cf: {
        image: {
          format: 'png',
        },
      },
    };
    const response = await fetch(imageUrl.toString(), requestInit);
    if (!response.ok) {
      throw new Error(`Failed to load custom background ${id}`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    return decodeRoomImageBytes(bytes);
  })();
  return cacheImage(cacheKey, pending);
}

export function decodeRoomImageBytes(bytes: Uint8Array): Promise<RoomImageData> | RoomImageData {
  if (isPng(bytes)) return decodePng(bytes);
  if (isJpeg(bytes)) return decodeJpegImageData(bytes);
  throw new Error('Background image was not returned as a supported image format.');
}

export function decodeJpegImageData(bytes: Uint8Array): RoomImageData {
  const image = decodeJpegBytes(bytes, {
    useTArray: true,
    formatAsRGBA: true,
    maxResolutionInMP: MAX_CUSTOM_BACKGROUND_DECODE_MP,
    maxMemoryUsageInMB: MAX_CUSTOM_BACKGROUND_DECODE_MEMORY_MB,
  });
  return {
    width: image.width,
    height: image.height,
    pixels: image.data,
  };
}

export function drawCustomBackgroundImage(
  canvas: RoomImageData,
  image: RoomImageData,
  fit: CustomBackgroundFit,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  if (fit === 'stretch') {
    blitImageSmooth(canvas, image, 0, 0, image.width, image.height, x, y, width, height);
    return;
  }

  if (fit === 'center') {
    const rect = getCustomBackgroundCenterRect(
      { width: image.width, height: image.height },
      { width: ROOM_PX_WIDTH, height: ROOM_PX_HEIGHT },
    );
    const scaleX = width / ROOM_PX_WIDTH;
    const scaleY = height / ROOM_PX_HEIGHT;
    blitImageSmooth(
      canvas,
      image,
      0,
      0,
      image.width,
      image.height,
      x + rect.x * scaleX,
      y + rect.y * scaleY,
      Math.max(1, Math.round(rect.width * scaleX)),
      Math.max(1, Math.round(rect.height * scaleY)),
    );
    return;
  }

  const tileScale = getCustomBackgroundTileScale(image) * (width / ROOM_PX_WIDTH);
  const drawWidth = Math.max(1, Math.ceil(image.width * tileScale));
  const drawHeight = Math.max(1, Math.ceil(image.height * tileScale));
  for (let drawY = 0; drawY < height + drawHeight; drawY += drawHeight) {
    for (let drawX = 0; drawX < width + drawWidth; drawX += drawWidth) {
      blitImageSmooth(canvas, image, 0, 0, image.width, image.height, x + drawX, y + drawY, drawWidth, drawHeight);
    }
  }
}

export function getCustomBackgroundTileScale(size: ImageSize): number {
  const width = Math.max(1, size.width);
  const height = Math.max(1, size.height);
  return Math.min(1, MAX_TILED_PHOTO_WIDTH / width, MAX_TILED_PHOTO_HEIGHT / height);
}

export function getCustomBackgroundCenterRect(source: ImageSize, target: ImageSize): ImageRect {
  const sourceWidth = Math.max(1, Math.round(source.width));
  const sourceHeight = Math.max(1, Math.round(source.height));
  const scale = Math.min(1, target.width / sourceWidth, target.height / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  return {
    x: Math.floor((target.width - width) / 2),
    y: Math.floor((target.height - height) / 2),
    width,
    height,
  };
}

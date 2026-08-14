import decodeJpegBytes from 'jpeg-js/lib/decoder.js';
import {
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
} from '../config';
import type { PagesWorkerEnv } from './model';
import {
  blitImageSmooth,
  decodePng,
  isJpeg,
  isPng,
  type RoomImageData,
} from './roomImagePrimitives';
import { resolveApiBaseUrl } from './shareMetadata';

const CUSTOM_BACKGROUND_PREFIX = 'custom:';
const DEFAULT_CUSTOM_BACKGROUND_FIT = 'tile';
const MAX_TILED_PHOTO_WIDTH = 128;
const MAX_TILED_PHOTO_HEIGHT = 96;
const MAX_CUSTOM_BACKGROUND_DECODE_MP = 8;
const MAX_CUSTOM_BACKGROUND_DECODE_MEMORY_MB = 96;

const imageDataCache = new Map<string, Promise<RoomImageData>>();

export type CustomBackgroundFit = 'stretch' | 'center' | 'tile';

export interface CustomBackgroundReference {
  id: string;
  fit: CustomBackgroundFit;
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

export function parseCustomBackground(value: unknown): CustomBackgroundReference | null {
  const trimmed = String(value || '').trim();
  if (!trimmed.toLowerCase().startsWith(CUSTOM_BACKGROUND_PREFIX)) {
    return null;
  }

  const customValue = trimmed.slice(CUSTOM_BACKGROUND_PREFIX.length).trim();
  const queryStart = customValue.indexOf('?');
  const id = (queryStart >= 0 ? customValue.slice(0, queryStart) : customValue).trim();
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(id)) {
    return null;
  }

  const fit = queryStart >= 0
    ? new URLSearchParams(customValue.slice(queryStart + 1)).get('fit')
    : DEFAULT_CUSTOM_BACKGROUND_FIT;
  return {
    id,
    fit: fit === 'stretch' || fit === 'center' || fit === 'tile'
      ? fit
      : DEFAULT_CUSTOM_BACKGROUND_FIT,
  };
}

export function normalizeAssetPath(assetPath: unknown): string {
  const trimmed = String(assetPath || '').trim();
  return `/${trimmed.replace(/^\/+/, '')}`;
}

export async function loadAssetImageData(
  request: Request,
  env: PagesWorkerEnv,
  url: URL,
  assetPath: unknown,
): Promise<RoomImageData> {
  const normalizedPath = normalizeAssetPath(assetPath);
  let pending = imageDataCache.get(normalizedPath);
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
  imageDataCache.set(normalizedPath, pending);
  return pending;
}

export async function loadCustomBackgroundImageData(
  request: Request,
  env: PagesWorkerEnv,
  url: URL,
  id: string,
): Promise<RoomImageData> {
  const apiBaseUrl = resolveApiBaseUrl(env, url);
  const imageUrl = new URL(`/api/background-images/${encodeURIComponent(id)}/image`, apiBaseUrl);
  const cacheKey = `custom-background:${imageUrl.toString()}`;
  let pending = imageDataCache.get(cacheKey);
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
    if (isPng(bytes)) {
      return decodePng(bytes);
    }
    if (isJpeg(bytes)) {
      return decodeJpegImageData(bytes);
    }
    throw new Error(`Custom background ${id} was not returned as a supported image format.`);
  })();
  imageDataCache.set(cacheKey, pending);
  return pending;
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

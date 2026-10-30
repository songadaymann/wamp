import {
  SCREENSHOT_KEY_PREFIX,
  STARFIELD_OBJECT_KEY,
  STATE_OBJECT_KEY,
} from './config';
import {
  screenshotObjectKey,
} from './naming';
import type { ScreenshotZoomState } from './zoom';
import { ArchiveLimitError } from './zip';

export interface ScreenshotR2Object {
  key: string;
  etag?: string;
  size: number;
  uploaded?: Date;
  body: ReadableStream<Uint8Array>;
  customMetadata?: Record<string, string>;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface ScreenshotR2Bucket {
  get(key: string): Promise<ScreenshotR2Object | null>;
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
  list(options?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{
    objects: Array<{
      key: string;
      etag?: string;
      size: number;
      uploaded?: Date;
      customMetadata?: Record<string, string>;
    }>;
    truncated: boolean;
    cursor?: string;
  }>;
}

export interface StoredScreenshot {
  key: string;
  etag?: string;
  fileName: string;
  size: number;
  uploaded: Date | null;
}

export async function loadZoomState(bucket: ScreenshotR2Bucket): Promise<ScreenshotZoomState | null> {
  const object = await bucket.get(STATE_OBJECT_KEY);
  if (!object) return null;
  try {
    const parsed = JSON.parse(await object.text()) as Partial<ScreenshotZoomState>;
    if (typeof parsed.zoom !== 'number' || !Number.isFinite(parsed.zoom)) return null;
    return {
      zoom: parsed.zoom,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      easternDate: typeof parsed.easternDate === 'string' ? parsed.easternDate : '',
    };
  } catch {
    return null;
  }
}

export async function saveScreenshotPng(
  bucket: ScreenshotR2Bucket,
  fileName: string,
  pngBytes: ArrayBuffer,
  zoom?: number,
): Promise<string> {
  const key = screenshotObjectKey(fileName);
  await bucket.put(key, pngBytes, {
    httpMetadata: { contentType: 'image/png' },
    customMetadata:
      typeof zoom === 'number' && Number.isFinite(zoom)
        ? { zoom: String(zoom) }
        : undefined,
  });
  return key;
}

/**
 * Recover the daily baseline before legacy shared state, which old manual
 * captures could advance. Legacy state/manual metadata remain last-resort
 * recovery when no daily artifact has usable zoom metadata.
 */
export async function loadPreviousZoom(
  bucket: ScreenshotR2Bucket,
  signal?: AbortSignal,
): Promise<number | null> {
  const listed = await listScreenshots(bucket, undefined, undefined, signal);
  // listScreenshots sorts newest fileName first within either category.
  const recover = async (daily: boolean): Promise<number | null> => {
    for (const item of listed) {
      signal?.throwIfAborted();
      if (item.fileName.endsWith('_0.png') !== daily) continue;
      const object = await bucket.get(item.key);
      if (!object) continue;
      const raw = object.customMetadata?.zoom;
      await object.body.cancel().catch(() => undefined);
      signal?.throwIfAborted();
      if (typeof raw !== 'string' || !raw.trim()) continue;
      const zoom = Number(raw);
      if (Number.isFinite(zoom) && zoom > 0) return zoom;
    }
    return null;
  };
  const dailyZoom = await recover(true);
  if (dailyZoom !== null) return dailyZoom;
  signal?.throwIfAborted();
  const state = await loadZoomState(bucket);
  signal?.throwIfAborted();
  return state?.zoom ?? await recover(false);
}

/** Load the cached composite starfield as a PNG data URL, or null if missing. */
export async function loadStarfieldDataUrl(
  bucket: ScreenshotR2Bucket,
): Promise<string | null> {
  const object = await bucket.get(STARFIELD_OBJECT_KEY);
  if (!object) return null;
  const bytes = Buffer.from(await object.arrayBuffer());
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

/** Persist the composite starfield PNG for reuse on later captures. */
export async function saveStarfieldPng(
  bucket: ScreenshotR2Bucket,
  pngBytes: ArrayBuffer,
): Promise<string> {
  await bucket.put(STARFIELD_OBJECT_KEY, pngBytes, {
    httpMetadata: { contentType: 'image/png' },
  });
  return STARFIELD_OBJECT_KEY;
}

export async function listScreenshots(bucket: ScreenshotR2Bucket, prefix = SCREENSHOT_KEY_PREFIX, maxFiles = Number.MAX_SAFE_INTEGER, signal?: AbortSignal): Promise<StoredScreenshot[]> {
  const results: StoredScreenshot[] = [];
  let cursor: string | undefined;
  do {
    signal?.throwIfAborted();
    const page = await bucket.list({
      prefix,
      cursor,
      limit: 1000,
    });
    signal?.throwIfAborted();
    for (const object of page.objects) {
      if (!object.key.endsWith('.png')) continue;
      const fileName = object.key.slice(SCREENSHOT_KEY_PREFIX.length);
      if (!fileName || fileName.includes('/')) continue;
      results.push({
        key: object.key,
        etag: object.etag,
        fileName,
        size: object.size,
        uploaded: object.uploaded ?? null,
      });
      if (results.length > maxFiles) throw new ArchiveLimitError('Archive has too many files. Choose a month.');
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  results.sort((a, b) => b.fileName.localeCompare(a.fileName));
  return results;
}

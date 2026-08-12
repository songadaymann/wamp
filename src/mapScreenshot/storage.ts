import {
  MAX_MANUAL_SHOTS_PER_DAY,
  SCREENSHOT_KEY_PREFIX,
  STATE_OBJECT_KEY,
} from './config';
import {
  dailyScreenshotFileName,
  formatEasternDate,
  manualScreenshotFileName,
  parseManualIndex,
  screenshotObjectKey,
} from './naming';
import type { ScreenshotZoomState } from './zoom';

export interface ScreenshotR2Object {
  key: string;
  size: number;
  uploaded?: Date;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface ScreenshotR2Bucket {
  get(key: string): Promise<ScreenshotR2Object | null>;
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  list(options?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{
    objects: Array<{ key: string; size: number; uploaded?: Date }>;
    truncated: boolean;
    cursor?: string;
  }>;
}

export interface StoredScreenshot {
  key: string;
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

export async function saveZoomState(
  bucket: ScreenshotR2Bucket,
  state: ScreenshotZoomState,
): Promise<void> {
  await bucket.put(STATE_OBJECT_KEY, JSON.stringify(state, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  });
}

export async function screenshotExists(
  bucket: ScreenshotR2Bucket,
  fileName: string,
): Promise<boolean> {
  const object = await bucket.get(screenshotObjectKey(fileName));
  return object !== null;
}

export async function saveScreenshotPng(
  bucket: ScreenshotR2Bucket,
  fileName: string,
  pngBytes: ArrayBuffer,
): Promise<string> {
  const key = screenshotObjectKey(fileName);
  await bucket.put(key, pngBytes, {
    httpMetadata: { contentType: 'image/png' },
  });
  return key;
}

export async function loadScreenshotPng(
  bucket: ScreenshotR2Bucket,
  fileName: string,
): Promise<ArrayBuffer | null> {
  const object = await bucket.get(screenshotObjectKey(fileName));
  if (!object) return null;
  return object.arrayBuffer();
}

export async function listScreenshots(bucket: ScreenshotR2Bucket): Promise<StoredScreenshot[]> {
  const results: StoredScreenshot[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({
      prefix: SCREENSHOT_KEY_PREFIX,
      cursor,
      limit: 1000,
    });
    for (const object of page.objects) {
      if (!object.key.endsWith('.png')) continue;
      const fileName = object.key.slice(SCREENSHOT_KEY_PREFIX.length);
      if (!fileName || fileName.includes('/')) continue;
      results.push({
        key: object.key,
        fileName,
        size: object.size,
        uploaded: object.uploaded ?? null,
      });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  results.sort((a, b) => b.fileName.localeCompare(a.fileName));
  return results;
}

export async function nextManualFileName(
  bucket: ScreenshotR2Bucket,
  easternDate: string = formatEasternDate(),
): Promise<string | null> {
  const listed = await listScreenshots(bucket);
  const used = new Set<number>();
  for (const item of listed) {
    const index = parseManualIndex(item.fileName, easternDate);
    if (index !== null) used.add(index);
  }
  for (let index = 1; index <= MAX_MANUAL_SHOTS_PER_DAY; index += 1) {
    if (!used.has(index)) {
      return manualScreenshotFileName(easternDate, index);
    }
  }
  return null;
}

export function dailyFileNameForToday(date: Date = new Date()): string {
  return dailyScreenshotFileName(formatEasternDate(date));
}

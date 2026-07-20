import { renderRoomSnapshotToPngDataUrl } from '../mint/roomMetadataRender';
import { cloneRoomSnapshot, type RoomSnapshot } from './roomModel';
import {
  getSharedRoomSnapshot,
  invalidateSharedRoomSnapshots,
  setSharedRoomSnapshot,
} from './sharedRoomSnapshotCache';

const MAX_ENTRIES = 256;
const renderedByKey = new Map<string, string | null>();
const loadsByKey = new Map<string, Promise<string | null>>();

export function getSharedRenderedRoomPreview(key: string): string | null | undefined {
  const value = renderedByKey.get(key);
  if (value !== undefined || renderedByKey.has(key)) touch(renderedByKey, key, value ?? null);
  return value;
}

export function loadSharedRenderedRoomPreview(
  key: string,
  snapshotLoader: () => Promise<RoomSnapshot | null>,
): Promise<string | null> {
  const cached = getSharedRenderedRoomPreview(key);
  if (cached !== undefined || renderedByKey.has(key)) return Promise.resolve(cached ?? null);
  const inFlight = loadsByKey.get(key);
  if (inFlight) return inFlight;

  const request = (async () => {
    const cachedSnapshot = getSharedRoomSnapshot(key);
    const snapshot = cachedSnapshot ?? await snapshotLoader();
    if (!snapshot) {
      setCapped(renderedByKey, key, null);
      return null;
    }
    setSharedRoomSnapshot(key, cloneRoomSnapshot(snapshot));
    const dataUrl = await renderRoomSnapshotToPngDataUrl(snapshot, { tilePixelSize: 4 });
    setCapped(renderedByKey, key, dataUrl);
    return dataUrl;
  })().finally(() => loadsByKey.delete(key));
  loadsByKey.set(key, request);
  return request;
}

export function invalidateSharedRoomPreviewCache(roomId: string): void {
  for (const cache of [renderedByKey, loadsByKey]) {
    for (const key of cache.keys()) {
      if (key === roomId || key.startsWith(`${roomId}:`) || key.includes(`:${roomId}:`)) cache.delete(key);
    }
  }
  invalidateSharedRoomSnapshots(roomId);
}

function setCapped<T>(cache: Map<string, T>, key: string, value: T): void {
  touch(cache, key, value);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (typeof oldest !== 'string') break;
    cache.delete(oldest);
  }
}

function touch<T>(cache: Map<string, T>, key: string, value: T): void {
  cache.delete(key);
  cache.set(key, value);
}

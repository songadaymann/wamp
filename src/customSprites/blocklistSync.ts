import { getApiBaseUrl } from '../api/baseUrl';
import { setBlockedCustomSpriteIds } from './blocklist';

const REFRESH_MS = 3 * 60 * 1000;
let started = false;
let lastLoadedAt = 0;

/**
 * The blocked-sprite list (F189) comes from the edge-cached world tile config. The map tiles also
 * read it, but only while tiles are on, so the game keeps its own copy current: at boot, every few
 * minutes while visible, and when the tab comes back.
 */
export function startBlockedCustomSpriteSync(): void {
  if (started) return;
  started = true;
  void refresh();
  window.setInterval(() => {
    if (document.visibilityState === 'visible') void refresh();
  }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastLoadedAt > REFRESH_MS) void refresh();
  });
}

async function refresh(): Promise<void> {
  const ids = await fetchBlockedCustomSpriteIds(getApiBaseUrl());
  if (ids) {
    lastLoadedAt = Date.now();
    setBlockedCustomSpriteIds([...ids]);
  }
}

/** The blocked sprite ids, or null when the list could not load. */
export async function fetchBlockedCustomSpriteIds(apiBaseUrl: string): Promise<Set<string> | null> {
  try {
    const response = await fetch(`${apiBaseUrl.replace(/\/+$/, '')}/api/world/tiles/config`, { credentials: 'omit' });
    if (!response.ok) return null;
    const config = await response.json() as { blockedCustomSpriteIds?: unknown };
    return new Set(Array.isArray(config.blockedCustomSpriteIds)
      ? config.blockedCustomSpriteIds.filter((id): id is string => typeof id === 'string')
      : []);
  } catch {
    return null;
  }
}

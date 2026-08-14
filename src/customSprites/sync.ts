import {
  AUTH_SESSION_REFRESHED_EVENT,
  AUTH_STATE_CHANGED_EVENT,
  getAuthDebugState,
  type AuthDebugState,
} from '../auth/client';
import {
  CustomSpriteCatalogApiError,
  loadCommunityCustomSprite,
  listMyCustomSprites,
  saveCommunityCustomSprite,
} from './catalogClient';
import {
  configureCustomSpriteOwner,
  commitCustomSpriteLibraryChanges,
  getCustomSpriteDefinition,
  getLocalCustomSpriteMetadata,
  listLocalCustomSpriteRecords,
  registerOwnedCatalogSprite,
  updateLocalCustomSpriteMetadata,
} from './registry';

const RETRY_MIN_MS = 5_000;
const RETRY_MAX_MS = 60_000;

let initialized = false;
let currentUserId: string | null = null;
let refreshToken = 0;
let syncing = false;
let retryTimer: number | null = null;
let retryDelayMs = RETRY_MIN_MS;

export function initializeCustomSpriteCatalogSync(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  window.addEventListener(AUTH_STATE_CHANGED_EVENT, handleAuthEvent as EventListener);
  window.addEventListener(AUTH_SESSION_REFRESHED_EVENT, handleAuthEvent as EventListener);
  window.addEventListener('online', () => {
    retryDelayMs = RETRY_MIN_MS;
    void syncPendingCustomSprites();
  });
  handleAuthSnapshot(getAuthDebugState());
}

export function queueCustomSpriteSync(): void {
  if (!currentUserId) return;
  window.queueMicrotask(() => void syncPendingCustomSprites());
}

export async function refreshOwnedCustomSprites(): Promise<void> {
  const userId = currentUserId;
  if (!userId) return;
  const token = ++refreshToken;
  const remoteEntries = [];
  let cursor: string | null = null;
  do {
    const page = await listMyCustomSprites({ cursor, limit: 48 });
    if (token !== refreshToken || currentUserId !== userId) return;
    remoteEntries.push(...page.sprites);
    cursor = page.nextCursor;
  } while (cursor);

  const remoteIds = new Set<string>();
  for (const entry of remoteEntries) {
    remoteIds.add(entry.sprite.id);
    const local = getCustomSpriteDefinition(entry.sprite.id);
    const metadata = getLocalCustomSpriteMetadata(entry.sprite.id);
    const localNeedsUpload = Boolean(
      local
      && metadata
      && (metadata.ownerUserId === null || metadata.ownerUserId === userId)
      && metadata.syncStatus !== 'synced'
      && Date.parse(local.updatedAt) > Date.parse(entry.sprite.updatedAt)
    );
    if (localNeedsUpload) {
      updateLocalCustomSpriteMetadata(entry.sprite.id, {
        ownerUserId: userId,
        revision: entry.revision,
        syncStatus: 'pending',
        syncError: null,
        retryable: true,
      }, { persist: false, notify: false });
    } else {
      registerOwnedCatalogSprite(entry, { persist: false, notify: false });
    }
  }

  for (const { sprite, metadata } of listLocalCustomSpriteRecords()) {
    if (metadata.ownerUserId && metadata.ownerUserId !== userId) continue;
    if (remoteIds.has(sprite.id) && metadata.syncStatus === 'synced') continue;
    updateLocalCustomSpriteMetadata(sprite.id, {
      ownerUserId: userId,
      syncStatus: 'pending',
      syncError: null,
      retryable: true,
    }, { persist: false, notify: false });
  }

  commitCustomSpriteLibraryChanges();
  await syncPendingCustomSprites();
}

export async function syncPendingCustomSprites(): Promise<void> {
  const userId = currentUserId;
  if (!userId || syncing) return;
  syncing = true;
  clearRetryTimer();
  let needsRetry = false;

  try {
    for (const { sprite, metadata } of listLocalCustomSpriteRecords()) {
      if (currentUserId !== userId) return;
      if (metadata.ownerUserId && metadata.ownerUserId !== userId) continue;
      if (metadata.syncStatus === 'synced') continue;
      if (metadata.syncStatus === 'error' && !metadata.retryable) continue;

      updateLocalCustomSpriteMetadata(sprite.id, {
        ownerUserId: userId,
        syncStatus: 'pending',
        syncError: null,
        retryable: true,
      });
      try {
        const saved = await saveWithOwnershipRecovery(sprite, metadata, userId);
        if (currentUserId !== userId) return;
        registerOwnedCatalogSprite(saved);
        retryDelayMs = RETRY_MIN_MS;
      } catch (error) {
        const retryable = isRetryableSyncError(error);
        updateLocalCustomSpriteMetadata(sprite.id, {
          ownerUserId: userId,
          syncStatus: 'error',
          syncError: getSyncErrorMessage(error),
          retryable,
        });
        needsRetry ||= retryable;
      }
    }
  } finally {
    syncing = false;
    if (needsRetry && currentUserId === userId) scheduleRetry();
  }
}

function handleAuthEvent(event: Event): void {
  const detail = event instanceof CustomEvent
    ? event.detail as AuthDebugState | undefined
    : undefined;
  handleAuthSnapshot(detail ?? getAuthDebugState());
}

function handleAuthSnapshot(authState: AuthDebugState): void {
  const nextUserId = authState.authenticated ? authState.user?.id?.trim() || null : null;
  if (nextUserId === currentUserId) return;
  currentUserId = nextUserId;
  refreshToken += 1;
  retryDelayMs = RETRY_MIN_MS;
  clearRetryTimer();
  configureCustomSpriteOwner(nextUserId);
  if (nextUserId) {
    void syncPendingCustomSprites();
  }
}

async function saveWithOwnershipRecovery(
  sprite: ReturnType<typeof listLocalCustomSpriteRecords>[number]['sprite'],
  metadata: ReturnType<typeof listLocalCustomSpriteRecords>[number]['metadata'],
  userId: string,
) {
  try {
    return await saveCommunityCustomSprite(sprite.id, {
      definition: sprite,
      expectedRevision: metadata.revision,
      remixedFromSpriteId: metadata.remixedFromSpriteId,
    });
  } catch (error) {
    if (!(error instanceof CustomSpriteCatalogApiError) || error.status !== 409 || metadata.revision !== null) {
      throw error;
    }
    let existing;
    try {
      existing = await loadCommunityCustomSprite(sprite.id);
    } catch {
      throw error;
    }
    if (existing.creator.userId !== userId) throw error;
    updateLocalCustomSpriteMetadata(sprite.id, { revision: existing.revision });
    return saveCommunityCustomSprite(sprite.id, {
      definition: sprite,
      expectedRevision: existing.revision,
      remixedFromSpriteId: metadata.remixedFromSpriteId,
    });
  }
}

function isRetryableSyncError(error: unknown): boolean {
  return !(error instanceof CustomSpriteCatalogApiError) || error.status >= 500;
}

function getSyncErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not share this sprite.';
}

function scheduleRetry(): void {
  if (!currentUserId || retryTimer !== null) return;
  const delay = retryDelayMs;
  retryDelayMs = Math.min(RETRY_MAX_MS, retryDelayMs * 2);
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    void syncPendingCustomSprites();
  }, delay);
}

function clearRetryTimer(): void {
  if (retryTimer === null) return;
  window.clearTimeout(retryTimer);
  retryTimer = null;
}

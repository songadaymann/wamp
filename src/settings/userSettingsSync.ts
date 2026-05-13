import {
  AUTH_STATE_CHANGED_EVENT,
  getAuthDebugState,
  type AuthDebugState,
} from '../auth/client';
import {
  getGameSettings,
  replaceGameSettings,
  subscribeGameSettings,
} from './userSettings';
import {
  createUserSettingsRepository,
  type UserSettingsRepository,
} from './userSettingsApi';
import type { GameSettings } from './model';

const SAVE_DEBOUNCE_MS = 500;

export interface GameSettingsSyncDebugState {
  userId: string | null;
  loadedUserId: string | null;
  status: 'guest' | 'loading' | 'ready' | 'saving' | 'error';
  lastLoadedAt: string | null;
  lastSavedAt: string | null;
  lastError: string | null;
}

let initialized = false;
let currentUserId: string | null = null;
let loadedUserId: string | null = null;
let loadToken = 0;
let applyingRemoteSettings = false;
let saveTimer: number | null = null;
let syncStatus: GameSettingsSyncDebugState['status'] = 'guest';
let lastLoadedAt: string | null = null;
let lastSavedAt: string | null = null;
let lastError: string | null = null;
let repository: UserSettingsRepository = createUserSettingsRepository();

export function initializeGameSettingsSync(
  nextRepository: UserSettingsRepository = createUserSettingsRepository(),
): void {
  if (initialized) {
    return;
  }

  initialized = true;
  repository = nextRepository;
  subscribeGameSettings(handleLocalSettingsChanged);
  window.addEventListener(AUTH_STATE_CHANGED_EVENT, handleAuthStateChanged as EventListener);
  handleAuthSnapshot(getAuthDebugState());
}

export function getGameSettingsSyncDebugState(): GameSettingsSyncDebugState {
  return {
    userId: currentUserId,
    loadedUserId,
    status: syncStatus,
    lastLoadedAt,
    lastSavedAt,
    lastError,
  };
}

function handleAuthStateChanged(event: Event): void {
  const detail =
    event instanceof CustomEvent
      ? (event.detail as AuthDebugState | undefined)
      : undefined;
  handleAuthSnapshot(detail ?? getAuthDebugState());
}

function handleAuthSnapshot(authState: AuthDebugState): void {
  const nextUserId = authState.authenticated ? authState.user?.id ?? null : null;
  if (
    nextUserId === currentUserId
    && (loadedUserId === nextUserId || syncStatus === 'loading')
  ) {
    return;
  }

  currentUserId = nextUserId;
  clearSaveTimer();
  loadToken += 1;
  lastError = null;

  if (!currentUserId) {
    loadedUserId = null;
    syncStatus = 'guest';
    return;
  }

  void loadRemoteSettings(currentUserId, loadToken);
}

function handleLocalSettingsChanged(settings: GameSettings): void {
  if (!currentUserId || loadedUserId !== currentUserId || applyingRemoteSettings) {
    return;
  }

  scheduleSave(settings);
}

async function loadRemoteSettings(userId: string, token: number): Promise<void> {
  syncStatus = 'loading';

  try {
    const response = await repository.loadMySettings();
    if (token !== loadToken || currentUserId !== userId) {
      return;
    }

    loadedUserId = userId;
    lastLoadedAt = response.updatedAt ?? new Date().toISOString();
    lastError = null;

    if (response.settings) {
      applyingRemoteSettings = true;
      try {
        replaceGameSettings(response.settings);
      } finally {
        applyingRemoteSettings = false;
      }
      syncStatus = 'ready';
      return;
    }

    syncStatus = 'ready';
    scheduleSave(getGameSettings(), 0);
  } catch (error) {
    if (token !== loadToken || currentUserId !== userId) {
      return;
    }

    loadedUserId = userId;
    syncStatus = 'error';
    lastError = normalizeErrorMessage(error);
    console.warn('Failed to sync user settings', error);
  }
}

function scheduleSave(settings: GameSettings, delayMs: number = SAVE_DEBOUNCE_MS): void {
  clearSaveTimer();
  const snapshot = { ...settings };
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    void saveRemoteSettings(snapshot);
  }, delayMs);
}

async function saveRemoteSettings(settings: GameSettings): Promise<void> {
  if (!currentUserId || loadedUserId !== currentUserId) {
    return;
  }

  syncStatus = 'saving';
  try {
    const response = await repository.saveMySettings(settings);
    lastSavedAt = response.updatedAt;
    lastError = null;
    if (currentUserId) {
      syncStatus = 'ready';
    }
  } catch (error) {
    syncStatus = 'error';
    lastError = normalizeErrorMessage(error);
    console.warn('Failed to save user settings', error);
  }
}

function clearSaveTimer(): void {
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }
}

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown settings sync error.';
}

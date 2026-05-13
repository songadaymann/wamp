import {
  DEFAULT_GAME_SETTINGS,
  normalizeGameSettings,
  type GameSettings,
} from './model';

export type { GameSettings, OverworldPanningStyle } from './model';

type GameSettingsListener = (settings: GameSettings) => void;

const ROOM_COMMENTS_VISIBLE_STORAGE_KEY = 'wamp.roomComments.visible';
const MUSIC_VOLUME_STORAGE_KEY = 'wamp.settings.musicVolume';
const SFX_VOLUME_STORAGE_KEY = 'wamp.settings.sfxVolume';
const PANNING_STYLE_STORAGE_KEY = 'wamp.settings.panningStyle';

let cachedSettings = readSettingsFromStorage();
const listeners = new Set<GameSettingsListener>();

export function getGameSettings(): GameSettings {
  return { ...cachedSettings };
}

export function updateGameSettings(nextValues: Partial<GameSettings>): GameSettings {
  return setGameSettings({
    ...cachedSettings,
    ...nextValues,
  });
}

export function replaceGameSettings(nextValues: Partial<GameSettings>): GameSettings {
  return setGameSettings(nextValues);
}

export function subscribeGameSettings(listener: GameSettingsListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setGameSettings(nextValues: Partial<GameSettings>): GameSettings {
  const nextSettings = normalizeGameSettings(nextValues);
  if (settingsEqual(cachedSettings, nextSettings)) {
    return getGameSettings();
  }

  cachedSettings = nextSettings;
  writeSettingsToStorage(cachedSettings);
  notifyGameSettingsChanged();
  return getGameSettings();
}

function notifyGameSettingsChanged(): void {
  const snapshot = getGameSettings();
  for (const listener of listeners) {
    listener(snapshot);
  }
}

function readSettingsFromStorage(): GameSettings {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_GAME_SETTINGS };
  }

  try {
    return normalizeGameSettings({
      roomCommentsVisible:
        window.localStorage.getItem(ROOM_COMMENTS_VISIBLE_STORAGE_KEY) !== 'false',
      musicVolume: readStoredVolume(MUSIC_VOLUME_STORAGE_KEY, DEFAULT_GAME_SETTINGS.musicVolume),
      sfxVolume: readStoredVolume(SFX_VOLUME_STORAGE_KEY, DEFAULT_GAME_SETTINGS.sfxVolume),
      panningStyle: readStoredPanningStyle(),
    });
  } catch {
    return { ...DEFAULT_GAME_SETTINGS };
  }
}

function writeSettingsToStorage(settings: GameSettings): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(
      ROOM_COMMENTS_VISIBLE_STORAGE_KEY,
      settings.roomCommentsVisible ? 'true' : 'false',
    );
    window.localStorage.setItem(MUSIC_VOLUME_STORAGE_KEY, settings.musicVolume.toFixed(2));
    window.localStorage.setItem(SFX_VOLUME_STORAGE_KEY, settings.sfxVolume.toFixed(2));
    window.localStorage.setItem(PANNING_STYLE_STORAGE_KEY, settings.panningStyle);
  } catch {
    // Settings still apply for the current session if storage is unavailable.
  }
}

function readStoredVolume(key: string, fallback: number): number {
  const rawValue = window.localStorage.getItem(key);
  if (rawValue === null) {
    return fallback;
  }

  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readStoredPanningStyle(): GameSettings['panningStyle'] {
  const rawValue = window.localStorage.getItem(PANNING_STYLE_STORAGE_KEY);
  return rawValue === 'two-finger-drag' ? 'two-finger-drag' : 'option-drag';
}

function settingsEqual(left: GameSettings, right: GameSettings): boolean {
  return (
    left.roomCommentsVisible === right.roomCommentsVisible
    && left.musicVolume === right.musicVolume
    && left.sfxVolume === right.sfxVolume
    && left.panningStyle === right.panningStyle
  );
}

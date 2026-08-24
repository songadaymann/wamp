export type OverworldPanningStyle = 'option-drag' | 'two-finger-drag';
export type BuilderMode = 'unselected' | 'beginner' | 'advanced';
export type SmartThemeSetting = 'forest' | 'desert' | 'cave' | 'gothic' | 'cyber';

export interface GameSettings {
  roomCommentsVisible: boolean;
  musicVolume: number;
  sfxVolume: number;
  panningStyle: OverworldPanningStyle;
  builderMode: BuilderMode;
  lastSmartTheme: SmartThemeSetting;
}

export interface UserSettingsResponse {
  settings: GameSettings | null;
  updatedAt: string | null;
}

export interface UserSettingsUpdateRequestBody {
  settings: Partial<GameSettings>;
}

export interface UserSettingsUpdateResponse {
  ok: true;
  settings: GameSettings;
  updatedAt: string;
}

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  roomCommentsVisible: true,
  musicVolume: 1,
  sfxVolume: 1,
  panningStyle: 'option-drag',
  builderMode: 'unselected',
  lastSmartTheme: 'forest',
};

export function normalizeGameSettings(value: Partial<GameSettings> | null | undefined): GameSettings {
  const source = value ?? {};
  return {
    roomCommentsVisible:
      typeof source.roomCommentsVisible === 'boolean'
        ? source.roomCommentsVisible
        : DEFAULT_GAME_SETTINGS.roomCommentsVisible,
    musicVolume: clampUnit(source.musicVolume, DEFAULT_GAME_SETTINGS.musicVolume),
    sfxVolume: clampUnit(source.sfxVolume, DEFAULT_GAME_SETTINGS.sfxVolume),
    panningStyle:
      source.panningStyle === 'two-finger-drag'
        ? 'two-finger-drag'
        : DEFAULT_GAME_SETTINGS.panningStyle,
    builderMode:
      source.builderMode === 'beginner' || source.builderMode === 'advanced'
        ? source.builderMode
        : DEFAULT_GAME_SETTINGS.builderMode,
    lastSmartTheme:
      source.lastSmartTheme === 'desert'
      || source.lastSmartTheme === 'cave'
      || source.lastSmartTheme === 'gothic'
      || source.lastSmartTheme === 'cyber'
        ? source.lastSmartTheme
        : DEFAULT_GAME_SETTINGS.lastSmartTheme,
  };
}

function clampUnit(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(1, Math.max(0, value));
}

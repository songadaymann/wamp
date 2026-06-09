export type RoomWeatherMode = 'off' | 'rain' | 'snow' | 'fog';

export interface RoomWeatherSettings {
  mode: RoomWeatherMode;
  intensity: number;
}

export const ROOM_WEATHER_INTENSITY_MIN = 0;
export const ROOM_WEATHER_INTENSITY_MAX = 100;
export const DEFAULT_ROOM_WEATHER_INTENSITY = 50;

export const DEFAULT_ROOM_WEATHER_SETTINGS: RoomWeatherSettings = Object.freeze({
  mode: 'off',
  intensity: DEFAULT_ROOM_WEATHER_INTENSITY,
});

export function normalizeRoomWeatherMode(value: unknown): RoomWeatherMode {
  return value === 'rain' || value === 'snow' || value === 'fog' ? value : 'off';
}

export function clampRoomWeatherIntensityValue(value: number): number {
  return Math.min(ROOM_WEATHER_INTENSITY_MAX, Math.max(ROOM_WEATHER_INTENSITY_MIN, value));
}

export function normalizeRoomWeatherIntensityValue(
  value: unknown,
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return clampRoomWeatherIntensityValue(Math.round(value));
}

export function normalizeRoomWeatherSettings(value: unknown): RoomWeatherSettings {
  if (typeof value === 'string') {
    return {
      mode: normalizeRoomWeatherMode(value),
      intensity: DEFAULT_ROOM_WEATHER_INTENSITY,
    };
  }

  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_ROOM_WEATHER_SETTINGS };
  }

  const settings = value as Partial<RoomWeatherSettings>;

  return {
    mode: normalizeRoomWeatherMode(settings.mode),
    intensity: normalizeRoomWeatherIntensityValue(
      settings.intensity,
      DEFAULT_ROOM_WEATHER_INTENSITY,
    ),
  };
}

export function cloneRoomWeatherSettings(value: unknown): RoomWeatherSettings {
  return normalizeRoomWeatherSettings(value);
}

export function roomWeatherUsesOverlay(value: RoomWeatherSettings | null | undefined): boolean {
  const weather = normalizeRoomWeatherSettings(value);
  return weather.mode !== 'off' && weather.intensity > ROOM_WEATHER_INTENSITY_MIN;
}

export type RoomLightingMode = 'off' | 'playerAuraDark';

export interface RoomLightingSettings {
  mode: RoomLightingMode;
  darkness: number;
  radius: number;
}

export const ROOM_LIGHTING_SLIDER_MIN = 0;
export const ROOM_LIGHTING_SLIDER_MAX = 100;
export const DEFAULT_ROOM_LIGHTING_DARKNESS = 80;
export const DEFAULT_ROOM_LIGHTING_RADIUS = 50;

export const DEFAULT_ROOM_LIGHTING_SETTINGS: RoomLightingSettings = Object.freeze({
  mode: 'off',
  darkness: DEFAULT_ROOM_LIGHTING_DARKNESS,
  radius: DEFAULT_ROOM_LIGHTING_RADIUS,
});

export function normalizeRoomLightingMode(value: unknown): RoomLightingMode {
  return value === 'playerAuraDark' ? 'playerAuraDark' : 'off';
}

export function clampRoomLightingSliderValue(value: number): number {
  return Math.min(ROOM_LIGHTING_SLIDER_MAX, Math.max(ROOM_LIGHTING_SLIDER_MIN, value));
}

export function normalizeRoomLightingSliderValue(
  value: unknown,
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return clampRoomLightingSliderValue(Math.round(value));
}

export function normalizeRoomLightingSettings(value: unknown): RoomLightingSettings {
  if (typeof value === 'string') {
    return {
      mode: normalizeRoomLightingMode(value),
      darkness: DEFAULT_ROOM_LIGHTING_DARKNESS,
      radius: DEFAULT_ROOM_LIGHTING_RADIUS,
    };
  }

  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_ROOM_LIGHTING_SETTINGS };
  }

  const settings = value as Partial<RoomLightingSettings>;

  return {
    mode: normalizeRoomLightingMode(settings.mode),
    darkness: normalizeRoomLightingSliderValue(
      settings.darkness,
      DEFAULT_ROOM_LIGHTING_DARKNESS,
    ),
    radius: normalizeRoomLightingSliderValue(settings.radius, DEFAULT_ROOM_LIGHTING_RADIUS),
  };
}

export function cloneRoomLightingSettings(
  value: unknown,
): RoomLightingSettings {
  return normalizeRoomLightingSettings(value);
}

export function roomLightingUsesDynamicOverlay(
  value: RoomLightingSettings | null | undefined,
): boolean {
  return normalizeRoomLightingSettings(value).mode === 'playerAuraDark';
}

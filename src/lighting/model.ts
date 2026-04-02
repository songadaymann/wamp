export type RoomLightingMode = 'off' | 'playerAuraDark';

export interface RoomLightingSettings {
  mode: RoomLightingMode;
}

export const DEFAULT_ROOM_LIGHTING_SETTINGS: RoomLightingSettings = Object.freeze({
  mode: 'off',
});

export function normalizeRoomLightingMode(value: unknown): RoomLightingMode {
  return value === 'playerAuraDark' ? 'playerAuraDark' : 'off';
}

export function normalizeRoomLightingSettings(value: unknown): RoomLightingSettings {
  if (typeof value === 'string') {
    return {
      mode: normalizeRoomLightingMode(value),
    };
  }

  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_ROOM_LIGHTING_SETTINGS };
  }

  const settings = value as Partial<RoomLightingSettings>;

  return {
    mode: normalizeRoomLightingMode(settings.mode),
  };
}

export function cloneRoomLightingSettings(
  value: RoomLightingSettings | null | undefined,
): RoomLightingSettings {
  return normalizeRoomLightingSettings(value);
}

export function roomLightingUsesDynamicOverlay(
  value: RoomLightingSettings | null | undefined,
): boolean {
  return normalizeRoomLightingSettings(value).mode === 'playerAuraDark';
}

import { getBackgroundGroup, type BackgroundGroup } from '../config';

export const DEFAULT_ROOM_BACKGROUND = 'none';
export const SOLID_COLOR_BACKGROUND_ID = 'solid_color';
export const PHOTO_BACKGROUND_ID = 'photo';
export const DEFAULT_SOLID_BACKGROUND_COLOR = '#24324a';

const SOLID_COLOR_BACKGROUND_PREFIX = 'solid:';
const CUSTOM_BACKGROUND_PREFIX = 'custom:';
const HEX_COLOR_PATTERN = /^#?([0-9a-f]{6})$/i;
const CUSTOM_BACKGROUND_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;

export type CustomBackgroundFit = 'stretch' | 'tile' | 'center';

export interface ParsedCustomBackground {
  id: string;
  fit: CustomBackgroundFit;
}

export const DEFAULT_CUSTOM_BACKGROUND_FIT: CustomBackgroundFit = 'tile';
export const CUSTOM_BACKGROUND_FITS: CustomBackgroundFit[] = ['stretch', 'tile', 'center'];

export type ResolvedRoomBackground =
  | { kind: 'none' }
  | { kind: 'solid'; color: string }
  | { kind: 'custom'; id: string; fit: CustomBackgroundFit }
  | { kind: 'group'; group: BackgroundGroup };

export function normalizeSolidBackgroundColor(
  value: unknown,
  fallback: string = DEFAULT_SOLID_BACKGROUND_COLOR,
): string {
  if (typeof value !== 'string') {
    return fallback;
  }

  const match = HEX_COLOR_PATTERN.exec(value.trim());
  if (!match) {
    return fallback;
  }

  return `#${match[1].toLowerCase()}`;
}

export function buildSolidColorBackgroundValue(color: string): string {
  return `${SOLID_COLOR_BACKGROUND_PREFIX}${normalizeSolidBackgroundColor(color)}`;
}

export function parseSolidColorBackgroundColor(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed.toLowerCase().startsWith(SOLID_COLOR_BACKGROUND_PREFIX)) {
    return null;
  }

  const color = normalizeSolidBackgroundColor(
    trimmed.slice(SOLID_COLOR_BACKGROUND_PREFIX.length),
    '',
  );
  return color || null;
}

export function getSolidColorFromBackgroundValue(
  value: unknown,
  fallback: string = DEFAULT_SOLID_BACKGROUND_COLOR,
): string {
  return parseSolidColorBackgroundColor(value) ?? fallback;
}

export function isSolidColorBackgroundValue(value: unknown): boolean {
  return parseSolidColorBackgroundColor(value) !== null;
}

export function buildCustomBackgroundValue(
  id: string,
  fit: CustomBackgroundFit = DEFAULT_CUSTOM_BACKGROUND_FIT,
): string {
  const normalizedFit = normalizeCustomBackgroundFit(fit);
  return normalizedFit === DEFAULT_CUSTOM_BACKGROUND_FIT
    ? `${CUSTOM_BACKGROUND_PREFIX}${id}`
    : `${CUSTOM_BACKGROUND_PREFIX}${id}?fit=${normalizedFit}`;
}

export function parseCustomBackground(value: unknown): ParsedCustomBackground | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed.toLowerCase().startsWith(CUSTOM_BACKGROUND_PREFIX)) {
    return null;
  }

  const customValue = trimmed.slice(CUSTOM_BACKGROUND_PREFIX.length).trim();
  const queryStart = customValue.indexOf('?');
  const id = (queryStart >= 0 ? customValue.slice(0, queryStart) : customValue).trim();
  if (!CUSTOM_BACKGROUND_ID_PATTERN.test(id)) {
    return null;
  }

  const fit = queryStart >= 0
    ? parseCustomBackgroundFit(new URLSearchParams(customValue.slice(queryStart + 1)).get('fit'))
    : DEFAULT_CUSTOM_BACKGROUND_FIT;
  return {
    id,
    fit,
  };
}

export function parseCustomBackgroundId(value: unknown): string | null {
  return parseCustomBackground(value)?.id ?? null;
}

export function isCustomBackgroundValue(value: unknown): boolean {
  return parseCustomBackground(value) !== null;
}

export function parseCustomBackgroundFit(value: unknown): CustomBackgroundFit {
  if (typeof value !== 'string') {
    return DEFAULT_CUSTOM_BACKGROUND_FIT;
  }

  return normalizeCustomBackgroundFit(value);
}

export function normalizeCustomBackgroundFit(value: unknown): CustomBackgroundFit {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return CUSTOM_BACKGROUND_FITS.includes(normalized as CustomBackgroundFit)
    ? normalized as CustomBackgroundFit
    : DEFAULT_CUSTOM_BACKGROUND_FIT;
}

export function normalizeRoomBackground(value: unknown): string {
  const solidColor = parseSolidColorBackgroundColor(value);
  if (solidColor) {
    return buildSolidColorBackgroundValue(solidColor);
  }

  const customBackground = parseCustomBackground(value);
  if (customBackground) {
    return buildCustomBackgroundValue(customBackground.id, customBackground.fit);
  }

  if (typeof value !== 'string') {
    return DEFAULT_ROOM_BACKGROUND;
  }

  const trimmed = value.trim();
  return getBackgroundGroup(trimmed) ? trimmed : DEFAULT_ROOM_BACKGROUND;
}

export function getBackgroundSelectionValue(value: unknown): string {
  if (isSolidColorBackgroundValue(value)) {
    return SOLID_COLOR_BACKGROUND_ID;
  }

  if (parseCustomBackground(value)) {
    return PHOTO_BACKGROUND_ID;
  }

  return normalizeRoomBackground(value);
}

export function getRoomBackgroundLabel(value: unknown): string {
  const solidColor = parseSolidColorBackgroundColor(value);
  if (solidColor) {
    return `Solid Color (${solidColor.toUpperCase()})`;
  }

  if (parseCustomBackground(value)) {
    return 'Photo';
  }

  const group = getBackgroundGroup(normalizeRoomBackground(value));
  return group?.name ?? 'None';
}

export function resolveRoomBackground(value: unknown): ResolvedRoomBackground {
  const normalized = normalizeRoomBackground(value);
  const solidColor = parseSolidColorBackgroundColor(normalized);
  if (solidColor) {
    return { kind: 'solid', color: solidColor };
  }

  const customBackground = parseCustomBackground(normalized);
  if (customBackground) {
    return { kind: 'custom', id: customBackground.id, fit: customBackground.fit };
  }

  const group = getBackgroundGroup(normalized);
  if (group) {
    return group.id === DEFAULT_ROOM_BACKGROUND
      ? { kind: 'none' }
      : { kind: 'group', group };
  }

  return { kind: 'none' };
}

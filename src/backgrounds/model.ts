import { getBackgroundGroup, type BackgroundGroup } from '../config';

export const DEFAULT_ROOM_BACKGROUND = 'none';
export const SOLID_COLOR_BACKGROUND_ID = 'solid_color';
export const DEFAULT_SOLID_BACKGROUND_COLOR = '#24324a';

const SOLID_COLOR_BACKGROUND_PREFIX = 'solid:';
const HEX_COLOR_PATTERN = /^#?([0-9a-f]{6})$/i;

export type ResolvedRoomBackground =
  | { kind: 'none' }
  | { kind: 'solid'; color: string }
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

export function normalizeRoomBackground(value: unknown): string {
  const solidColor = parseSolidColorBackgroundColor(value);
  if (solidColor) {
    return buildSolidColorBackgroundValue(solidColor);
  }

  if (typeof value !== 'string') {
    return DEFAULT_ROOM_BACKGROUND;
  }

  const trimmed = value.trim();
  return getBackgroundGroup(trimmed) ? trimmed : DEFAULT_ROOM_BACKGROUND;
}

export function getBackgroundSelectionValue(value: unknown): string {
  return isSolidColorBackgroundValue(value)
    ? SOLID_COLOR_BACKGROUND_ID
    : normalizeRoomBackground(value);
}

export function getRoomBackgroundLabel(value: unknown): string {
  const solidColor = parseSolidColorBackgroundColor(value);
  if (solidColor) {
    return `Solid Color (${solidColor.toUpperCase()})`;
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

  const group = getBackgroundGroup(normalized);
  if (group) {
    return group.id === DEFAULT_ROOM_BACKGROUND
      ? { kind: 'none' }
      : { kind: 'group', group };
  }

  return { kind: 'none' };
}

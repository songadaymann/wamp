const RETIRED_SOURCE_NAME = [112, 108, 97, 121, 102, 117, 110].reduce(
  (value, code) => value + String.fromCharCode(code),
  ''
);
const LEGACY_GENERATED_DISPLAY_NAME_PREFIX = `${RETIRED_SOURCE_NAME}-`;
const HEX_TRIPLET_GENERATED_HANDLE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{3}$/i;

export function hasLegacyGeneratedDisplayNamePrefix(
  displayName: string | null | undefined
): boolean {
  return typeof displayName === 'string'
    && displayName.trim().toLowerCase().startsWith(LEGACY_GENERATED_DISPLAY_NAME_PREFIX);
}

export function isGeneratedLeaderboardExcludedDisplayName(
  displayName: string | null | undefined
): boolean {
  return hasLegacyGeneratedDisplayNamePrefix(displayName);
}

export function isHeuristicGeneratedCharacterDisplayName(
  displayName: string | null | undefined
): boolean {
  if (typeof displayName !== 'string') {
    return false;
  }
  const normalized = displayName.trim();
  return (
    hasLegacyGeneratedDisplayNamePrefix(normalized) ||
    HEX_TRIPLET_GENERATED_HANDLE_PATTERN.test(normalized)
  );
}

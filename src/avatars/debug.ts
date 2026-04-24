import {
  CRYPTOPUNK_AVATAR_UNLOCK_PLAYER_LEVEL,
  CRYPTOPUNK_UNLOCK_OVERRIDE_HEADER,
} from './model';

const CRYPTOPUNK_UNLOCK_OVERRIDE_STORAGE_KEY = 'ep_debug_cryptopunk_unlock_v1';
const CRYPTOPUNK_UNLOCK_OVERRIDE_QUERY_PARAM = 'cryptopunkUnlock';

export function isCryptopunkUnlockOverrideEnabled(): boolean {
  if (!isCryptopunkUnlockOverrideSupported() || typeof window === 'undefined') {
    return false;
  }

  syncCryptopunkUnlockOverrideFromUrl();
  return window.localStorage?.getItem(CRYPTOPUNK_UNLOCK_OVERRIDE_STORAGE_KEY) === '1';
}

export function getEffectiveCryptopunkViewerLevel(
  playerLevel: number | null | undefined,
): number {
  const normalized = Number.isFinite(playerLevel) ? Math.max(1, Math.round(Number(playerLevel))) : 1;
  if (!isCryptopunkUnlockOverrideEnabled()) {
    return normalized;
  }

  return Math.max(normalized, CRYPTOPUNK_AVATAR_UNLOCK_PLAYER_LEVEL);
}

export function appendCryptopunkUnlockOverrideHeaders(headers: Headers): void {
  if (!isCryptopunkUnlockOverrideEnabled()) {
    return;
  }

  headers.set(CRYPTOPUNK_UNLOCK_OVERRIDE_HEADER, '1');
}

export function syncCryptopunkUnlockOverrideFromUrl(): void {
  if (!isCryptopunkUnlockOverrideSupported() || typeof window === 'undefined') {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const requestedOverride = parseBooleanQueryValue(
    params.get(CRYPTOPUNK_UNLOCK_OVERRIDE_QUERY_PARAM),
  );
  if (requestedOverride === null) {
    return;
  }

  if (requestedOverride) {
    window.localStorage?.setItem(CRYPTOPUNK_UNLOCK_OVERRIDE_STORAGE_KEY, '1');
  } else {
    window.localStorage?.removeItem(CRYPTOPUNK_UNLOCK_OVERRIDE_STORAGE_KEY);
  }
}

function isCryptopunkUnlockOverrideSupported(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_ENABLE_TEST_RESET === '1';
}

function parseBooleanQueryValue(rawValue: string | null): boolean | null {
  if (typeof rawValue !== 'string') {
    return null;
  }

  switch (rawValue.trim().toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
    case 'on':
      return true;
    case '0':
    case 'false':
    case 'no':
    case 'off':
      return false;
    default:
      return null;
  }
}

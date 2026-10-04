const GUEST_RECOVERY_TOKEN_STORAGE_KEY = 'ep_guest_recovery_token_v1';
const volatileTokens = new WeakMap<Storage, string>();
let unavailableStorageToken: string | null = null;

export function resolveGuestRecoveryToken(storage: Storage | null = getLocalStorage()): string {
  try {
    const existing = storage?.getItem(GUEST_RECOVERY_TOKEN_STORAGE_KEY);
    if (existing && /^[A-Za-z0-9_-]{32,160}$/.test(existing)) {
      return existing;
    }
  } catch {
    // Fall through to a new volatile token.
  }

  const token = storage ? volatileTokens.get(storage) ?? createRecoveryToken()
    : unavailableStorageToken ?? createRecoveryToken();
  try {
    storage?.setItem(GUEST_RECOVERY_TOKEN_STORAGE_KEY, token);
  } catch {
    if (storage) volatileTokens.set(storage, token);
  }
  if (!storage) unavailableStorageToken = token;
  return token;
}

function createRecoveryToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random()
    .toString(36)
    .slice(2)}`;
}

function getLocalStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

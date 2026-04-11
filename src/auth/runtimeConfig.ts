export type AuthConfigSource = 'build' | 'runtime' | 'missing';
export type RoomStorageBackend = 'auto' | 'local' | 'remote';

export interface ResolvedPartykitConfig {
  host: string;
  party: string;
  source: Exclude<AuthConfigSource, 'missing'>;
}

export function getStorageBackend(): RoomStorageBackend {
  const configured = import.meta.env.VITE_ROOM_STORAGE_BACKEND;
  if (configured === 'auto' || configured === 'local' || configured === 'remote') {
    return configured;
  }

  return 'remote';
}

export function isTestResetEnabled(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_ENABLE_TEST_RESET === '1';
}

export function resolveWalletProjectId(runtimeWalletProjectId: string): string {
  const bundledProjectId = getBundledWalletProjectId();
  return bundledProjectId || runtimeWalletProjectId;
}

export function getWalletProjectIdSource(runtimeWalletProjectId: string): AuthConfigSource {
  if (getBundledWalletProjectId()) {
    return 'build';
  }

  if (runtimeWalletProjectId) {
    return 'runtime';
  }

  return 'missing';
}

export function resolvePartykitConfig(
  runtimePartykitHost: string,
  runtimePartykitParty: string
): ResolvedPartykitConfig | null {
  const bundledHost = getBundledPartykitHost();
  const host = bundledHost || runtimePartykitHost;
  if (!host) {
    return null;
  }

  return {
    host,
    party: getBundledPartykitParty() || runtimePartykitParty || 'main',
    source: bundledHost ? 'build' : 'runtime',
  };
}

export function getPartykitConfigSource(runtimePartykitHost: string): AuthConfigSource {
  if (getBundledPartykitHost()) {
    return 'build';
  }

  if (runtimePartykitHost) {
    return 'runtime';
  }

  return 'missing';
}

function getBundledWalletProjectId(): string {
  return (
    import.meta.env.VITE_REOWN_PROJECT_ID?.trim() ||
    import.meta.env.VITE_WALLET_CONNECT_PROJECT_ID?.trim() ||
    ''
  );
}

function getBundledPartykitHost(): string {
  return import.meta.env.VITE_PARTYKIT_HOST?.trim() || '';
}

function getBundledPartykitParty(): string {
  return import.meta.env.VITE_PARTYKIT_PARTY?.trim() || '';
}

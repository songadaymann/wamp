import type { AppKit } from '@reown/appkit';
import type {
  AuthSessionResponse,
  AuthUser,
  MagicLinkRequestResponse,
  WalletChallengeResponse,
  WalletVerifyResponse,
} from './model';
import { clearLocalRoomStorage } from '../persistence/browserStorage';

interface AuthDebugState {
  loading: boolean;
  authenticated: boolean;
  user: AuthUser | null;
  status: string;
  debugMagicLink: string | null;
  walletConnected: boolean;
  walletAddress: string | null;
  walletProjectConfigured: boolean;
  storageBackend: 'auto' | 'local' | 'remote';
  testResetEnabled: boolean;
}

interface TestResetResponse {
  ok: true;
  deleted: {
    rooms: number;
    roomVersions: number;
    users: number;
    sessions: number;
    magicLinks: number;
    walletChallenges: number;
  };
}

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
}

const state: AuthDebugState = {
  loading: false,
  authenticated: false,
  user: null,
  status: 'Guest mode.',
  debugMagicLink: null,
  walletConnected: false,
  walletAddress: null,
  walletProjectConfigured: false,
  storageBackend: getStorageBackend(),
  testResetEnabled: isTestResetEnabled(),
};

let authPanel: HTMLElement | null = null;
let authIdentity: HTMLElement | null = null;
let authEmailInput: HTMLInputElement | null = null;
let authEmailButton: HTMLButtonElement | null = null;
let authWalletButton: HTMLButtonElement | null = null;
let authLogoutButton: HTMLButtonElement | null = null;
let testResetButton: HTMLButtonElement | null = null;
let authStatus: HTMLElement | null = null;
let authDebugLink: HTMLAnchorElement | null = null;
let appKit: AppKit | null = null;
let walletBootstrapPromise: Promise<AppKit> | null = null;

export async function setupAuthUi(): Promise<void> {
  authPanel = document.getElementById('auth-panel');
  authIdentity = document.getElementById('auth-identity');
  authEmailInput = document.getElementById('auth-email-input') as HTMLInputElement | null;
  authEmailButton = document.getElementById('btn-auth-email') as HTMLButtonElement | null;
  authWalletButton = document.getElementById('btn-auth-wallet') as HTMLButtonElement | null;
  authLogoutButton = document.getElementById('btn-auth-logout') as HTMLButtonElement | null;
  testResetButton = document.getElementById('btn-test-reset') as HTMLButtonElement | null;
  authStatus = document.getElementById('auth-status');
  authDebugLink = document.getElementById('auth-debug-link') as HTMLAnchorElement | null;

  if (!authPanel) {
    return;
  }

  // Hamburger menu toggle
  const menuToggle = document.getElementById('menu-toggle');
  menuToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    authPanel!.classList.toggle('menu-open');
  });
  document.addEventListener('click', (e) => {
    if (authPanel && authPanel.classList.contains('menu-open') && !authPanel.contains(e.target as Node)) {
      authPanel.classList.remove('menu-open');
    }
  });

  authEmailButton?.addEventListener('click', () => {
    void requestMagicLink();
  });
  authEmailInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void requestMagicLink();
    }
  });
  authWalletButton?.addEventListener('click', () => {
    void handleWalletButton();
  });
  authLogoutButton?.addEventListener('click', () => {
    void logout();
  });
  testResetButton?.addEventListener('click', () => {
    void resetTestData();
  });

  initializeStatusFromQuery();
  await initializeWalletConnect();
  await refreshSession();
  renderAuthUi();
}

export function getAuthDebugState(): AuthDebugState {
  return { ...state };
}

async function initializeWalletConnect(): Promise<void> {
  const projectId = getWalletProjectId();
  state.walletProjectConfigured = Boolean(projectId);

  if (!projectId) {
    state.status =
      'Add VITE_REOWN_PROJECT_ID or VITE_WALLET_CONNECT_PROJECT_ID to env.local to enable wallet sign-in.';
    return;
  }

  state.status = 'Email auth is ready. Wallet connect will load on demand.';
}

async function refreshSession(): Promise<void> {
  try {
    const session = await apiRequest<AuthSessionResponse>('/api/auth/session');
    state.authenticated = session.authenticated;
    state.user = session.user;

    if (session.authenticated) {
      state.status = `Signed in as ${session.user?.displayName ?? 'player'}.`;
    } else if (window.location.search.includes('auth=')) {
      // Preserve status set from query params.
    } else {
      state.status = 'Guest mode.';
    }
  } catch (error) {
    console.error('Failed to load auth session', error);
    state.status = 'Failed to load account session.';
  }

  renderAuthUi();
}

async function requestMagicLink(): Promise<void> {
  const email = authEmailInput?.value.trim() ?? '';

  if (!email) {
    state.status = 'Enter an email address first.';
    renderAuthUi();
    return;
  }

  setLoading(true, 'Sending sign-in link...');

  try {
    const response = await apiRequest<MagicLinkRequestResponse>('/api/auth/request-link', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });

    state.debugMagicLink = response.debugMagicLink ?? null;
    state.status =
      response.delivery === 'email'
        ? 'Check your email for the sign-in link.'
        : 'Debug sign-in link generated below.';
  } catch (error) {
    console.error('Failed to request magic link', error);
    state.status = getErrorMessage(error, 'Failed to send sign-in link.');
  } finally {
    setLoading(false);
  }
}

async function logout(): Promise<void> {
  setLoading(true, 'Signing out...');

  try {
    await apiRequest<{ ok: true }>('/api/auth/logout', {
      method: 'POST',
    });

    state.authenticated = false;
    state.user = null;
    state.debugMagicLink = null;
    state.status = 'Signed out.';
  } catch (error) {
    console.error('Failed to sign out', error);
    state.status = getErrorMessage(error, 'Failed to sign out.');
  } finally {
    setLoading(false);
  }
}

async function resetTestData(): Promise<void> {
  const confirmed = window.confirm(
    'Reset test data on the current API backend? This deletes rooms, versions, users, sessions, and auth tokens.'
  );
  if (!confirmed) {
    return;
  }

  setLoading(true, 'Resetting test data...');

  try {
    const response = await apiRequest<TestResetResponse>('/api/test/reset', {
      method: 'POST',
    });

    const clearedLocalRooms = clearLocalRoomStorage();
    state.authenticated = false;
    state.user = null;
    state.debugMagicLink = null;
    state.status = `Reset complete. Cleared ${response.deleted.rooms} rooms and ${clearedLocalRooms} local cached room entries. Reloading...`;
    renderAuthUi();

    window.setTimeout(() => {
      window.location.replace(`${window.location.pathname}${window.location.hash}`);
    }, 200);
  } catch (error) {
    console.error('Test reset failed', error);
    state.status = getErrorMessage(error, 'Failed to reset test data.');
    setLoading(false);
  }
}

async function handleWalletButton(): Promise<void> {
  if (!state.walletProjectConfigured) {
    state.status =
      'Wallet connect is not configured. Add the project ID to env.local and restart Vite.';
    renderAuthUi();
    return;
  }

  const walletModal = await ensureWalletModal();

  const linkedWallet = state.user?.walletAddress?.toLowerCase();
  const connectedWallet = state.walletAddress?.toLowerCase();

  if (linkedWallet && linkedWallet === connectedWallet) {
    await walletModal.open({ view: 'Account', namespace: 'eip155' });
    return;
  }

  await authenticateWithWallet();
}

async function authenticateWithWallet(): Promise<void> {
  setLoading(true, state.authenticated ? 'Linking wallet...' : 'Signing in with wallet...');

  try {
    const walletModal = await ensureWalletModal();
    const address = await ensureWalletConnection();
    const challenge = await apiRequest<WalletChallengeResponse>('/api/auth/wallet/challenge', {
      method: 'POST',
      body: JSON.stringify({ address }),
    });

    const provider = walletModal.getWalletProvider() as Eip1193Provider | undefined;
    if (!provider) {
      throw new Error('Wallet provider was not available after connecting.');
    }

    const { BrowserProvider } = await import('ethers');
    const browserProvider = new BrowserProvider(provider);
    const signer = await browserProvider.getSigner();
    const signerAddress = await signer.getAddress();
    const signature = await signer.signMessage(challenge.message);

    const response = await apiRequest<WalletVerifyResponse>('/api/auth/wallet/verify', {
      method: 'POST',
      body: JSON.stringify({
        address: signerAddress,
        message: challenge.message,
        signature,
      }),
    });

    state.authenticated = true;
    state.user = response.user;
    state.status = response.linkedWallet
      ? `Wallet linked to ${response.user.displayName}.`
      : `Signed in with wallet ${shortenAddress(signerAddress)}.`;
    state.debugMagicLink = null;
  } catch (error) {
    console.error('Wallet authentication failed', error);
    state.status = getErrorMessage(error, 'Wallet sign-in failed.');
  } finally {
    setLoading(false);
    await refreshSession();
  }
}

async function ensureWalletConnection(): Promise<string> {
  const walletModal = await ensureWalletModal();

  const existing = walletModal.getAddress('eip155');
  if (existing) {
    return existing;
  }

  const connectedAddress = await waitForWalletConnection();
  if (!connectedAddress) {
    throw new Error('Wallet connection was cancelled.');
  }

  return connectedAddress;
}

async function waitForWalletConnection(timeoutMs: number = 60_000): Promise<string | null> {
  const walletModal = await ensureWalletModal();

  const existing = walletModal.getAddress('eip155');
  if (existing) {
    return existing;
  }

  await walletModal.open({ view: 'Connect', namespace: 'eip155' });

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      unsubscribe();
      resolve(value);
    };

    const unsubscribe = walletModal.subscribeAccount((account) => {
      if (account.isConnected && account.address) {
        finish(account.address);
      }
    }, 'eip155');

    const timer = window.setTimeout(() => finish(null), timeoutMs);
  });
}

async function ensureWalletModal(): Promise<AppKit> {
  if (appKit) {
    return appKit;
  }

  if (walletBootstrapPromise) {
    return walletBootstrapPromise;
  }

  const projectId = getWalletProjectId();
  if (!projectId) {
    throw new Error('Wallet connect is not configured.');
  }

  walletBootstrapPromise = (async () => {
    const [{ createAppKit }, { EthersAdapter }, { base, mainnet }] = await Promise.all([
      import('@reown/appkit'),
      import('@reown/appkit-adapter-ethers'),
      import('@reown/appkit/networks'),
    ]);

    const metadata = {
      name: "Everybody's Platformer",
      description: 'Collaborative platformer world builder',
      url: window.location.origin,
      icons: [`${window.location.origin}/favicon.ico`],
    };

    const walletModal = createAppKit({
      adapters: [new EthersAdapter()],
      metadata,
      networks: [base, mainnet],
      defaultNetwork: base,
      projectId,
      themeMode: 'dark',
    });

    await walletModal.ready();
    syncWalletAccount(walletModal.getAccount('eip155'));
    walletModal.subscribeAccount((account) => {
      syncWalletAccount(account);
      renderAuthUi();
    }, 'eip155');

    appKit = walletModal;
    renderAuthUi();
    return walletModal;
  })();

  return walletBootstrapPromise;
}

function syncWalletAccount(account: { isConnected: boolean; address?: string } | undefined): void {
  state.walletConnected = account?.isConnected ?? false;
  state.walletAddress = account?.address ?? null;
}

function renderAuthUi(): void {
  if (!authPanel) {
    return;
  }

  if (authIdentity) {
    authIdentity.textContent = state.authenticated
      ? buildIdentityText(state.user)
      : 'Guest';
  }

  if (authStatus) {
    authStatus.textContent = state.status;
  }

  if (authEmailButton) {
    authEmailButton.disabled = state.loading;
  }

  if (authEmailInput) {
    authEmailInput.disabled = state.loading;
  }

  if (authWalletButton) {
    authWalletButton.disabled = state.loading || !state.walletProjectConfigured;
    authWalletButton.textContent = getWalletButtonLabel();
  }

  if (authLogoutButton) {
    authLogoutButton.classList.toggle('hidden', !state.authenticated);
    authLogoutButton.disabled = state.loading;
  }

  if (testResetButton) {
    testResetButton.classList.toggle('hidden', !state.testResetEnabled);
    testResetButton.disabled = state.loading;
  }

  if (authDebugLink) {
    if (state.debugMagicLink) {
      authDebugLink.classList.remove('hidden');
      authDebugLink.href = state.debugMagicLink;
      authDebugLink.textContent = 'Open debug sign-in link';
    } else {
      authDebugLink.classList.add('hidden');
      authDebugLink.removeAttribute('href');
      authDebugLink.textContent = '';
    }
  }
}

function buildIdentityText(user: AuthUser | null): string {
  if (!user) {
    return 'Guest';
  }

  if (user.email && user.walletAddress) {
    return `${user.displayName} · ${shortenAddress(user.walletAddress)}`;
  }

  if (user.email) {
    return `${user.displayName} · ${user.email}`;
  }

  if (user.walletAddress) {
    return `${user.displayName} · ${shortenAddress(user.walletAddress)}`;
  }

  return user.displayName;
}

function getWalletButtonLabel(): string {
  if (!state.walletProjectConfigured) {
    return 'Wallet ID Missing';
  }

  if (state.walletConnected && state.user?.walletAddress?.toLowerCase() === state.walletAddress?.toLowerCase()) {
    return shortenAddress(state.walletAddress ?? '');
  }

  if (state.walletConnected && state.authenticated) {
    return 'Link Wallet';
  }

  if (state.walletConnected) {
    return 'Sign In Wallet';
  }

  return 'Wallet Connect';
}

function getStorageBackend(): 'auto' | 'local' | 'remote' {
  const configured = import.meta.env.VITE_ROOM_STORAGE_BACKEND;
  if (configured === 'auto' || configured === 'local' || configured === 'remote') {
    return configured;
  }

  return 'remote';
}

function isTestResetEnabled(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_ENABLE_TEST_RESET === '1';
}

function setLoading(loading: boolean, status?: string): void {
  state.loading = loading;
  if (status) {
    state.status = status;
  }
  renderAuthUi();
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}.`);
  }

  return (await response.json()) as T;
}

function initializeStatusFromQuery(): void {
  const url = new URL(window.location.href);
  const authResult = url.searchParams.get('auth');

  if (authResult === 'email') {
    state.status = 'Email sign-in complete.';
  } else if (authResult === 'invalid') {
    state.status = 'That sign-in link is invalid or expired.';
  } else {
    return;
  }

  url.searchParams.delete('auth');
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

function getWalletProjectId(): string {
  return (
    import.meta.env.VITE_REOWN_PROJECT_ID?.trim() ||
    import.meta.env.VITE_WALLET_CONNECT_PROJECT_ID?.trim() ||
    ''
  );
}

function shortenAddress(address: string): string {
  if (!address) {
    return 'Wallet';
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(error.message) as { error?: string };
    return parsed.error ?? fallback;
  } catch {
    return error.message || fallback;
  }
}

import type { AppKit } from '@reown/appkit';
import type {
  AuthSessionResponse,
  DisplayNameAvailabilityResponse,
  DisplayNameUpdateResponse,
  AuthUser,
  MagicLinkRequestResponse,
  WalletChallengeResponse,
  WalletVerifyResponse,
} from './model';
import type { ChatModerationViewer } from '../chat/model';
import { clearLocalRoomStorage } from '../persistence/browserStorage';
import { getApiBaseUrl } from '../api/baseUrl';
import { appendPlayfunRequestHeaders } from '../playfun/state';
import { isOpenableProfileUserId, requestProfileOpen } from '../ui/setup/profileEvents';
import type {
  PreparedWalletTransaction,
  RoomMintChainInfo,
} from '../mint/roomOwnership';

export const AUTH_STATE_CHANGED_EVENT = 'auth-state-changed';

export interface AuthDebugState {
  loading: boolean;
  authenticated: boolean;
  user: AuthUser | null;
  source: AuthSessionResponse['source'] | null;
  roomDailyClaimLimit: number | null;
  roomClaimsUsedToday: number;
  roomClaimsRemainingToday: number | null;
  status: string;
  debugMagicLink: string | null;
  walletConnected: boolean;
  walletAddress: string | null;
  walletProjectConfigured: boolean;
  storageBackend: 'auto' | 'local' | 'remote';
  testResetEnabled: boolean;
  chatModeration: ChatModerationViewer;
}

interface TestResetResponse {
  ok: true;
  deleted: {
    rooms: number;
    roomVersions: number;
    roomRuns: number;
    userStats: number;
    chatMessages: number;
    chatAdmins: number;
    chatBans: number;
    users: number;
    sessions: number;
    magicLinks: number;
    walletChallenges: number;
    apiTokens: number;
  };
}

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
}

const state: AuthDebugState = {
  loading: false,
  authenticated: false,
  user: null,
  source: null,
  roomDailyClaimLimit: null,
  roomClaimsUsedToday: 0,
  roomClaimsRemainingToday: null,
  status: 'Guest mode.',
  debugMagicLink: null,
  walletConnected: false,
  walletAddress: null,
  walletProjectConfigured: false,
  storageBackend: getStorageBackend(),
  testResetEnabled: isTestResetEnabled(),
  chatModeration: {
    role: 'none',
    banned: false,
  },
};

let authPanel: HTMLElement | null = null;
let authIdentity: HTMLElement | null = null;
let authEmailInput: HTMLInputElement | null = null;
let authEmailButton: HTMLButtonElement | null = null;
let authWalletButton: HTMLButtonElement | null = null;
let authLogoutButton: HTMLButtonElement | null = null;
let authDisplayNameRow: HTMLElement | null = null;
let authDisplayNameInput: HTMLInputElement | null = null;
let authDisplayNameButton: HTMLButtonElement | null = null;
let authDisplayNameStatus: HTMLElement | null = null;
let testResetButton: HTMLButtonElement | null = null;
let authStatus: HTMLElement | null = null;
let authDebugLink: HTMLAnchorElement | null = null;
let appKit: AppKit | null = null;
let walletBootstrapPromise: Promise<AppKit> | null = null;
let sessionRefreshListenersBound = false;
let displayNameCheckTimer: number | null = null;
let displayNameCheckToken = 0;
let lastCheckedDisplayName = '';
let lastDisplayNameAvailability: DisplayNameAvailabilityResponse | null = null;

const FEATURED_REOWN_WALLET_IDS = [
  'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96', // MetaMask
  '18388be9ac2d02726dbac9777c96efaac06d744b2f6d580fccdd4127a6d01fd1', // Rabby
  '1ae92b26df02f0abca6304df07debccd18262fdf5fe82daa81593582dac9a369', // Rainbow
  'ecc4036f814562b41a5268adc86270fba1365471402006302e70169465b7ac18', // Zerion
] as const;

const DEFAULT_GUEST_STATUS = 'Sign in to build rooms, publish them, and save your runs.';
const DEFAULT_SIGN_IN_PROMPT_STATUS = 'Sign in to build rooms, publish them, chat, and climb the leaderboards.';
let guestPanelAutoOpened = false;

export async function setupAuthUi(): Promise<void> {
  authPanel = document.getElementById('auth-panel');
  authIdentity = document.getElementById('auth-identity');
  authEmailInput = document.getElementById('auth-email-input') as HTMLInputElement | null;
  authEmailButton = document.getElementById('btn-auth-email') as HTMLButtonElement | null;
  authWalletButton = document.getElementById('btn-auth-wallet') as HTMLButtonElement | null;
  authLogoutButton = document.getElementById('btn-auth-logout') as HTMLButtonElement | null;
  authDisplayNameRow = document.getElementById('auth-display-name-row');
  authDisplayNameInput = document.getElementById('auth-display-name-input') as HTMLInputElement | null;
  authDisplayNameButton = document.getElementById('btn-auth-display-name') as HTMLButtonElement | null;
  authDisplayNameStatus = document.getElementById('auth-display-name-status');
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
  authIdentity?.addEventListener('click', () => {
    if (!isOpenableProfileUserId(state.user?.id)) {
      return;
    }

    requestProfileOpen(state.user.id);
  });
  authIdentity?.addEventListener('keydown', (event) => {
    if ((event.key !== 'Enter' && event.key !== ' ') || !isOpenableProfileUserId(state.user?.id)) {
      return;
    }

    event.preventDefault();
    requestProfileOpen(state.user.id);
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
  authDisplayNameButton?.addEventListener('click', () => {
    void updateDisplayName();
  });
  authDisplayNameInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void updateDisplayName();
    }
  });
  authDisplayNameInput?.addEventListener('input', () => {
    void scheduleDisplayNameAvailabilityCheck();
  });
  testResetButton?.addEventListener('click', () => {
    void resetTestData();
  });

  initializeStatusFromQuery();
  bindSessionRefreshListeners();
  await initializeWalletConnect();
  await refreshSession();
  maybeAutoOpenGuestPanel();
  renderAuthUi();
}

export function getAuthDebugState(): AuthDebugState {
  return {
    ...state,
    chatModeration: { ...state.chatModeration },
  };
}

export async function refreshAuthSession(): Promise<void> {
  await refreshSession();
}

export function syncChatModerationState(viewer: ChatModerationViewer): void {
  const normalized = normalizeChatModerationViewer(viewer);
  if (
    state.chatModeration.role === normalized.role
    && state.chatModeration.banned === normalized.banned
  ) {
    return;
  }

  state.chatModeration = normalized;
  renderAuthUi();
}

export function promptForSignIn(status: string = DEFAULT_SIGN_IN_PROMPT_STATUS): void {
  state.status = status;
  renderAuthUi();
  authPanel?.classList.add('menu-open');
  authEmailInput?.focus();
  authEmailInput?.select();
}

export async function sendPreparedWalletTransaction(
  transaction: PreparedWalletTransaction,
  chain: RoomMintChainInfo
): Promise<{ hash: string; from: string }> {
  if (!state.walletProjectConfigured) {
    throw new Error('Wallet connect is not configured.');
  }

  const walletModal = await ensureWalletModal();
  await ensureWalletConnection();
  const provider = getWalletProvider(walletModal);

  await ensureWalletChain(provider, chain);

  const { BrowserProvider } = await import('ethers');
  const browserProvider = new BrowserProvider(provider);
  const signer = await browserProvider.getSigner();
  const signerAddress = await signer.getAddress();
  const linkedWallet = state.user?.walletAddress?.toLowerCase();

  if (linkedWallet && linkedWallet !== signerAddress.toLowerCase()) {
    throw new Error('Connected wallet does not match the linked account wallet.');
  }

  const response = await signer.sendTransaction({
    to: transaction.to,
    data: transaction.data,
    value: BigInt(transaction.value),
  });

  await response.wait();

  return {
    hash: response.hash,
    from: signerAddress,
  };
}

async function initializeWalletConnect(): Promise<void> {
  const projectId = getWalletProjectId();
  state.walletProjectConfigured = Boolean(projectId);

  if (!projectId) {
    state.status =
      'Add VITE_REOWN_PROJECT_ID or VITE_WALLET_CONNECT_PROJECT_ID to env.local to enable wallet sign-in.';
    return;
  }

  state.status = DEFAULT_GUEST_STATUS;
}

async function refreshSession(): Promise<void> {
  try {
    const session = await apiRequest<AuthSessionResponse>('/api/auth/session');
    state.authenticated = session.authenticated;
    state.user = session.user;
    state.source = session.source ?? null;
    state.roomDailyClaimLimit = session.roomDailyClaimLimit ?? null;
    state.roomClaimsUsedToday = session.roomClaimsUsedToday ?? 0;
    state.roomClaimsRemainingToday = session.roomClaimsRemainingToday ?? null;
    state.chatModeration = normalizeChatModerationViewer(session.chatModeration);

    if (session.authenticated) {
      state.status = session.source === 'playfun'
        ? `Signed in via Play.fun as ${session.user?.displayName ?? 'player'}.`
        : `Signed in as ${session.user?.displayName ?? 'player'}.`;
      lastCheckedDisplayName = session.user?.displayName ?? '';
      lastDisplayNameAvailability = session.user
        ? {
            available: true,
            claimedByCurrentUser: true,
          }
        : null;
    } else if (window.location.search.includes('auth=')) {
      // Preserve status set from query params.
      state.source = null;
      lastCheckedDisplayName = '';
      lastDisplayNameAvailability = null;
    } else {
      state.source = null;
      state.status = DEFAULT_GUEST_STATUS;
      lastCheckedDisplayName = '';
      lastDisplayNameAvailability = null;
    }
  } catch (error) {
    console.error('Failed to load auth session', error);
    state.status = 'Failed to load account session.';
    state.source = null;
    state.roomDailyClaimLimit = null;
    state.roomClaimsUsedToday = 0;
    state.roomClaimsRemainingToday = null;
    state.chatModeration = {
      role: 'none',
      banned: false,
    };
    lastCheckedDisplayName = '';
    lastDisplayNameAvailability = null;
  }

  renderAuthUi();
}

function bindSessionRefreshListeners(): void {
  if (sessionRefreshListenersBound) {
    return;
  }

  sessionRefreshListenersBound = true;
  window.addEventListener('focus', () => {
    if (!state.loading) {
      void refreshSession();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !state.loading) {
      void refreshSession();
    }
  });
}

async function requestMagicLink(): Promise<void> {
  const email = authEmailInput?.value.trim() ?? '';

  if (!email) {
    state.status = 'Enter an email address, or sign in with wallet.';
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
        ? 'Check your email for the sign-in link. Wallet-only sign-in also works.'
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
    state.source = null;
    state.debugMagicLink = null;
    state.chatModeration = {
      role: 'none',
      banned: false,
    };
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
    state.source = null;
    state.debugMagicLink = null;
    state.chatModeration = {
      role: 'none',
      banned: false,
    };
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

async function updateDisplayName(): Promise<void> {
  if (!state.authenticated || !state.user || !authDisplayNameInput) {
    return;
  }

  const displayName = authDisplayNameInput.value.replace(/\s+/g, ' ').trim();
  if (!displayName) {
    state.status = 'Enter a display name first.';
    renderAuthUi();
    return;
  }

  if (displayName.length > 24) {
    state.status = 'Display name must be 24 characters or fewer.';
    renderAuthUi();
    return;
  }

  if (lastCheckedDisplayName === displayName && lastDisplayNameAvailability && !lastDisplayNameAvailability.available) {
    state.status = 'That display name has already been claimed.';
    renderAuthUi();
    return;
  }

  setLoading(true, 'Saving display name...');

  try {
    const response = await apiRequest<DisplayNameUpdateResponse>('/api/auth/display-name', {
      method: 'POST',
      body: JSON.stringify({ displayName }),
    });
    state.user = response.user;
    state.status = `Display name updated to ${response.user.displayName}.`;
    lastCheckedDisplayName = response.user.displayName;
    lastDisplayNameAvailability = {
      available: true,
      claimedByCurrentUser: true,
    };
  } catch (error) {
    console.error('Failed to update display name', error);
    state.status = getErrorMessage(error, 'Failed to update display name.');
  } finally {
    setLoading(false);
    await refreshSession();
  }
}

async function scheduleDisplayNameAvailabilityCheck(): Promise<void> {
  if (!state.authenticated || !authDisplayNameInput) {
    return;
  }

  if (displayNameCheckTimer !== null) {
    window.clearTimeout(displayNameCheckTimer);
    displayNameCheckTimer = null;
  }

  const displayName = authDisplayNameInput.value.replace(/\s+/g, ' ').trim();
  if (!displayName) {
    lastCheckedDisplayName = '';
    lastDisplayNameAvailability = null;
    renderAuthUi();
    return;
  }

  displayNameCheckTimer = window.setTimeout(() => {
    displayNameCheckTimer = null;
    void checkDisplayNameAvailability(displayName);
  }, 250);
}

async function checkDisplayNameAvailability(displayName: string): Promise<void> {
  const currentToken = ++displayNameCheckToken;
  try {
    const response = await apiRequest<DisplayNameAvailabilityResponse>(
      `/api/auth/display-name-availability?displayName=${encodeURIComponent(displayName)}`
    );
    if (currentToken !== displayNameCheckToken) {
      return;
    }

    lastCheckedDisplayName = displayName;
    lastDisplayNameAvailability = response;
    renderAuthUi();
  } catch (error) {
    if (currentToken !== displayNameCheckToken) {
      return;
    }

    console.error('Failed to check display name availability', error);
    lastCheckedDisplayName = displayName;
    lastDisplayNameAvailability = null;
    renderAuthUi();
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

    const provider = getWalletProvider(walletModal);

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
    state.source = 'session';
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

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      unsubscribe();
      resolve(value);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      unsubscribe();
      reject(error instanceof Error ? error : new Error('Failed to open wallet connection modal.'));
    };

    const unsubscribe = walletModal.subscribeAccount((account) => {
      if (account.isConnected && account.address) {
        finish(account.address);
      }
    }, 'eip155');

    const timer = window.setTimeout(() => finish(null), timeoutMs);

    const current = walletModal.getAddress('eip155');
    if (current) {
      finish(current);
      return;
    }

    void walletModal.open({ view: 'Connect', namespace: 'eip155' }).catch((error) => {
      fail(error);
    });
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
    const [{ createAppKit }, { EthersAdapter }, { base, baseSepolia, mainnet }] = await Promise.all([
      import('@reown/appkit'),
      import('@reown/appkit-adapter-ethers'),
      import('@reown/appkit/networks'),
    ]);

    const metadata = {
      name: 'WAMP',
      description: 'Collaborative platformer world builder',
      url: window.location.origin,
      icons: [`${window.location.origin}/favicon.svg`],
    };

    const walletModal = createAppKit({
      adapters: [new EthersAdapter()],
      featuredWalletIds: [...FEATURED_REOWN_WALLET_IDS],
      enableCoinbase: false,
      metadata,
      networks: [baseSepolia, base, mainnet],
      defaultNetwork: baseSepolia,
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

function getWalletProvider(walletModal: AppKit): Eip1193Provider {
  const provider = walletModal.getWalletProvider() as Eip1193Provider | undefined;
  if (!provider) {
    throw new Error('Wallet provider was not available after connecting.');
  }

  return provider;
}

async function ensureWalletChain(
  provider: Eip1193Provider,
  chain: RoomMintChainInfo
): Promise<void> {
  const chainIdHex = `0x${chain.chainId.toString(16)}`;

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainIdHex }],
    });
  } catch (error) {
    const code = getProviderErrorCode(error);
    if (code !== 4902) {
      throw error instanceof Error ? error : new Error('Failed to switch wallet network.');
    }

    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: chainIdHex,
          chainName: chain.name,
          rpcUrls: [chain.rpcUrl],
          nativeCurrency: chain.nativeCurrency,
          blockExplorerUrls: chain.blockExplorerUrl ? [chain.blockExplorerUrl] : [],
        },
      ],
    });

    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainIdHex }],
    });
  }
}

function renderAuthUi(): void {
  if (!authPanel) {
    return;
  }

  if (authIdentity) {
    authIdentity.textContent = state.authenticated
      ? buildIdentityText(state.user)
      : 'Guest';
    const canOpenProfile = isOpenableProfileUserId(state.user?.id);
    authIdentity.classList.toggle('profile-trigger', canOpenProfile);
    authIdentity.classList.toggle('auth-identity-clickable', canOpenProfile);
    if (canOpenProfile) {
      authIdentity.setAttribute('role', 'button');
      authIdentity.setAttribute('tabindex', '0');
    } else {
      authIdentity.removeAttribute('role');
      authIdentity.setAttribute('tabindex', '-1');
    }
    authIdentity.setAttribute('aria-label', canOpenProfile ? 'Open profile' : 'Account identity');
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

  authPanel.classList.toggle('auth-panel-guest', !state.authenticated);

  if (authLogoutButton) {
    authLogoutButton.classList.toggle('hidden', !state.authenticated || state.source === 'playfun');
    authLogoutButton.disabled = state.loading;
  }

  if (authDisplayNameRow) {
    authDisplayNameRow.classList.toggle('hidden', !state.authenticated);
  }

  if (authDisplayNameInput) {
    const desiredValue = state.user?.displayName ?? '';
    if (authDisplayNameInput !== document.activeElement) {
      authDisplayNameInput.value = desiredValue;
    }
    authDisplayNameInput.disabled = state.loading || !state.authenticated;
  }

  if (authDisplayNameButton) {
    authDisplayNameButton.classList.toggle('hidden', !state.authenticated);
    authDisplayNameButton.disabled = state.loading || !state.authenticated;
  }

  if (authDisplayNameStatus) {
    authDisplayNameStatus.classList.toggle('hidden', !state.authenticated);
    authDisplayNameStatus.classList.remove('is-available', 'is-taken');

    const draftValue = authDisplayNameInput?.value.replace(/\s+/g, ' ').trim() ?? '';
    if (!state.authenticated || !draftValue) {
      authDisplayNameStatus.textContent = '';
    } else if (draftValue === state.user?.displayName) {
      authDisplayNameStatus.textContent = 'Current display name.';
      authDisplayNameStatus.classList.add('is-available');
    } else if (lastCheckedDisplayName === draftValue && lastDisplayNameAvailability) {
      if (lastDisplayNameAvailability.available) {
        authDisplayNameStatus.textContent = lastDisplayNameAvailability.claimedByCurrentUser
          ? 'Current display name.'
          : 'Display name is available.';
        authDisplayNameStatus.classList.add('is-available');
      } else {
        authDisplayNameStatus.textContent = 'That display name has already been claimed.';
        authDisplayNameStatus.classList.add('is-taken');
      }
    } else if (authDisplayNameInput === document.activeElement) {
      authDisplayNameStatus.textContent = 'Checking availability...';
    } else {
      authDisplayNameStatus.textContent = '';
    }
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

  window.dispatchEvent(
    new CustomEvent(AUTH_STATE_CHANGED_EVENT, {
      detail: getAuthDebugState(),
    })
  );
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
    return 'Sign In With Wallet';
  }

  return 'Sign In With Wallet';
}

function maybeAutoOpenGuestPanel(): void {
  if (guestPanelAutoOpened || state.authenticated || state.loading || !authPanel || isPlayfunVisitor()) {
    return;
  }

  guestPanelAutoOpened = true;
  authPanel.classList.add('menu-open');
  authEmailInput?.focus();
  authEmailInput?.select();
}

function isPlayfunVisitor(): boolean {
  if (document.body.dataset.playfunMode === 'true') {
    return true;
  }

  const params = new URLSearchParams(window.location.search);
  return params.get('pf') === '1';
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

function normalizeChatModerationViewer(
  viewer: ChatModerationViewer | null | undefined
): ChatModerationViewer {
  if (!viewer || (viewer.role !== 'none' && viewer.role !== 'admin' && viewer.role !== 'owner')) {
    return {
      role: 'none',
      banned: false,
    };
  }

  return {
    role: viewer.role,
    banned: viewer.banned === true,
  };
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  appendPlayfunRequestHeaders(headers);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${getApiBaseUrl()}${path}`, {
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

function getProviderErrorCode(error: unknown): number | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const maybeCode = (error as { code?: unknown }).code;
  return typeof maybeCode === 'number' ? maybeCode : null;
}

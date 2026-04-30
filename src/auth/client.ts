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
import { createPlayerAvatarPreviewDataUrl } from '../player/avatar/previews';
import { setStoredPlayerAvatarId } from '../player/avatar/storage';
import { getApiBaseUrl } from '../api/baseUrl';
import { apiRequest as requestApi } from '../api/request';
import { appendPlayfunRequestHeaders } from '../playfun/state';
import { createProfileRepository } from '../profiles/profileRepository';
import { isOpenableProfileUserId, PROFILE_INVALIDATED_EVENT, requestProfileOpen } from '../ui/setup/profileEvents';
import type {
  PreparedWalletTransaction,
  RoomMintChainInfo,
} from '../mint/roomOwnership';
import {
  getPartykitConfigSource,
  getStorageBackend,
  getWalletProjectIdSource,
  isTestResetEnabled,
  resolvePartykitConfig,
  resolveWalletProjectId,
  type AuthConfigSource,
  type RoomStorageBackend,
} from './runtimeConfig';

export const AUTH_STATE_CHANGED_EVENT = 'auth-state-changed';
export const AUTH_SESSION_REFRESHED_EVENT = 'auth-session-refreshed';

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
  walletProjectSource: AuthConfigSource;
  partykitConfigured: boolean;
  partykitHost: string | null;
  partykitParty: string | null;
  partykitSource: AuthConfigSource;
  storageBackend: RoomStorageBackend;
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

interface AuthIdentityProfileView {
  userId: string;
  displayName: string;
  selectedAvatarId: string | null;
  playerLevel: number | null;
  playerProgressFraction: number | null;
  curatorLevel: number | null;
  curatorProgressFraction: number | null;
  builderLevel: number | null;
  builderProgressFraction: number | null;
}

const state: AuthDebugState = {
  loading: false,
  authenticated: false,
  user: null,
  source: null,
  roomDailyClaimLimit: null,
  roomClaimsUsedToday: 0,
  roomClaimsRemainingToday: null,
  status: 'Use email or wallet.',
  debugMagicLink: null,
  walletConnected: false,
  walletAddress: null,
  walletProjectConfigured: false,
  walletProjectSource: 'missing',
  partykitConfigured: false,
  partykitHost: null,
  partykitParty: null,
  partykitSource: 'missing',
  storageBackend: getStorageBackend(),
  testResetEnabled: isTestResetEnabled(),
  chatModeration: {
    role: 'none',
    banned: false,
  },
};

let authPanel: HTMLElement | null = null;
let authIdentity: HTMLButtonElement | null = null;
let authIdentityAvatar: HTMLImageElement | null = null;
let authIdentityName: HTMLElement | null = null;
let authIdentityPlayerLevel: HTMLElement | null = null;
let authIdentityPlayerProgress: HTMLElement | null = null;
let authIdentityCuratorLevel: HTMLElement | null = null;
let authIdentityCuratorProgress: HTMLElement | null = null;
let authIdentityBuilderLevel: HTMLElement | null = null;
let authIdentityBuilderProgress: HTMLElement | null = null;
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
let authSessionSummary: HTMLElement | null = null;
let authSessionSummaryValue: HTMLElement | null = null;
let authDebugLink: HTMLAnchorElement | null = null;
let appKit: AppKit | null = null;
let walletBootstrapPromise: Promise<AppKit> | null = null;
let sessionRefreshListenersBound = false;
let displayNameCheckTimer: number | null = null;
let displayNameCheckToken = 0;
let lastCheckedDisplayName = '';
let lastDisplayNameAvailability: DisplayNameAvailabilityResponse | null = null;
let runtimeWalletProjectId = '';
let runtimePartykitHost = '';
let runtimePartykitParty = '';
let authIdentityProfile: AuthIdentityProfileView | null = null;
let authIdentityProfileLoadingUserId: string | null = null;
let identityRefreshListenersBound = false;
const profileRepository = createProfileRepository();

const FEATURED_REOWN_WALLET_IDS = [
  'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96', // MetaMask
  '18388be9ac2d02726dbac9777c96efaac06d744b2f6d580fccdd4127a6d01fd1', // Rabby
  '1ae92b26df02f0abca6304df07debccd18262fdf5fe82daa81593582dac9a369', // Rainbow
  'ecc4036f814562b41a5268adc86270fba1365471402006302e70169465b7ac18', // Zerion
] as const;

const DEFAULT_GUEST_STATUS = 'Use email or wallet.';
const DEFAULT_SIGN_IN_PROMPT_STATUS = 'Sign in to continue.';
const WALLET_NOT_CONFIGURED_MESSAGE = 'Wallet sign-in is not configured on this deployment.';
let guestPanelAutoOpened = false;

export async function setupAuthUi(): Promise<void> {
  authPanel = document.getElementById('auth-panel');
  authIdentity = document.getElementById('auth-identity') as HTMLButtonElement | null;
  authIdentityAvatar = document.getElementById('auth-identity-avatar') as HTMLImageElement | null;
  authIdentityName = document.getElementById('auth-identity-name');
  authIdentityPlayerLevel = document.getElementById('auth-identity-player-level');
  authIdentityPlayerProgress = document.getElementById('auth-identity-player-progress');
  authIdentityCuratorLevel = document.getElementById('auth-identity-curator-level');
  authIdentityCuratorProgress = document.getElementById('auth-identity-curator-progress');
  authIdentityBuilderLevel = document.getElementById('auth-identity-builder-level');
  authIdentityBuilderProgress = document.getElementById('auth-identity-builder-progress');
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
  authSessionSummary = document.getElementById('auth-session-summary');
  authSessionSummaryValue = document.getElementById('auth-session-summary-value');
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
  bindIdentityRefreshListeners();
  await initializeWalletConnect();
  await refreshSession();
  maybeAutoOpenGuestPanel();
  renderAuthUi();
  window.dispatchEvent(
    new CustomEvent(AUTH_SESSION_REFRESHED_EVENT, {
      detail: getAuthDebugState(),
    })
  );
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
    throw new Error(WALLET_NOT_CONFIGURED_MESSAGE);
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
  refreshWalletProjectConfiguration();
  refreshPartykitConfiguration();
}

async function refreshSession(): Promise<void> {
  try {
    const session = await apiRequest<AuthSessionResponse>('/api/auth/session');
    setRuntimeWalletProjectId(session.walletProjectId);
    setRuntimePartykitConfig(session.partykitHost, session.partykitParty);
    state.authenticated = session.authenticated;
    state.user = session.user;
    state.source = session.source ?? null;
    state.roomDailyClaimLimit = session.roomDailyClaimLimit ?? null;
    state.roomClaimsUsedToday = session.roomClaimsUsedToday ?? 0;
    state.roomClaimsRemainingToday = session.roomClaimsRemainingToday ?? null;
    state.chatModeration = normalizeChatModerationViewer(session.chatModeration);

    if (session.authenticated) {
      setStoredPlayerAvatarId(session.user?.selectedAvatarId ?? null);
      syncAuthIdentityProfileFromSession(session.user);
      void ensureAuthIdentityProfileLoaded();
      if (state.status.length === 0 || state.status === DEFAULT_GUEST_STATUS || isGenericSignedInStatus(state.status)) {
        state.status = '';
      }
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
      authIdentityProfile = null;
      authIdentityProfileLoadingUserId = null;
      lastCheckedDisplayName = '';
      lastDisplayNameAvailability = null;
    } else {
      state.source = null;
      state.status = DEFAULT_GUEST_STATUS;
      authIdentityProfile = null;
      authIdentityProfileLoadingUserId = null;
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
    authIdentityProfile = null;
    authIdentityProfileLoadingUserId = null;
    lastCheckedDisplayName = '';
    lastDisplayNameAvailability = null;
  }

  renderAuthUi();
}

function bindIdentityRefreshListeners(): void {
  if (identityRefreshListenersBound) {
    return;
  }

  identityRefreshListenersBound = true;
  window.addEventListener(PROFILE_INVALIDATED_EVENT, (event) => {
    const detail =
      event instanceof CustomEvent
        ? (event.detail as { userId?: string } | undefined)
        : undefined;
    if (!detail?.userId || detail.userId !== state.user?.id) {
      return;
    }

    void ensureAuthIdentityProfileLoaded(true);
  });
}

function syncAuthIdentityProfileFromSession(user: AuthUser | null): void {
  if (!user) {
    authIdentityProfile = null;
    authIdentityProfileLoadingUserId = null;
    return;
  }

  const fallbackName =
    user.displayName?.trim()
    || user.email?.trim()
    || (user.walletAddress ? shortenAddress(user.walletAddress) : 'Player');

  if (authIdentityProfile?.userId !== user.id) {
    authIdentityProfile = {
      userId: user.id,
      displayName: fallbackName,
      selectedAvatarId: user.selectedAvatarId ?? null,
      playerLevel: null,
      playerProgressFraction: null,
      curatorLevel: null,
      curatorProgressFraction: null,
      builderLevel: null,
      builderProgressFraction: null,
    };
    return;
  }

  authIdentityProfile = {
    ...authIdentityProfile,
    displayName: fallbackName,
    selectedAvatarId: user.selectedAvatarId ?? authIdentityProfile.selectedAvatarId ?? null,
  };
}

async function ensureAuthIdentityProfileLoaded(force: boolean = false): Promise<void> {
  if (!state.authenticated || !state.user) {
    authIdentityProfile = null;
    authIdentityProfileLoadingUserId = null;
    renderAuthUi();
    return;
  }

  const userId = state.user.id;
  if (!force) {
    if (authIdentityProfileLoadingUserId === userId) {
      return;
    }
    if (
      authIdentityProfile?.userId === userId
      && authIdentityProfile.playerLevel !== null
      && authIdentityProfile.curatorLevel !== null
      && authIdentityProfile.builderLevel !== null
    ) {
      return;
    }
  }

  authIdentityProfileLoadingUserId = userId;
  try {
    const profile = await profileRepository.loadProfile(userId);
    if (state.user?.id !== userId) {
      return;
    }

    authIdentityProfile = {
      userId,
      displayName: profile.displayName?.trim() || authIdentityProfile?.displayName || 'Player',
      selectedAvatarId: profile.selectedAvatarId ?? authIdentityProfile?.selectedAvatarId ?? null,
      playerLevel: profile.progression.player.level,
      playerProgressFraction: profile.progression.player.progressFraction,
      curatorLevel: profile.progression.curator.level,
      curatorProgressFraction: profile.progression.curator.progressFraction,
      builderLevel: profile.progression.builder.level,
      builderProgressFraction: profile.progression.builder.progressFraction,
    };
  } catch (error) {
    console.warn('Failed to load auth identity profile summary', error);
  } finally {
    if (authIdentityProfileLoadingUserId === userId) {
      authIdentityProfileLoadingUserId = null;
    }
    renderAuthUi();
  }
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
    state.status = 'Enter an email address.';
    renderAuthUi();
    return;
  }

  setLoading(true, 'Sending sign-in link...');

  try {
    const response = await apiRequest<MagicLinkRequestResponse>('/api/auth/request-link', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });

    state.debugMagicLink = normalizeDebugMagicLink(response.debugMagicLink);
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
    state.status = 'Display name saved.';
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
    state.status = WALLET_NOT_CONFIGURED_MESSAGE;
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
      ? 'Wallet linked.'
      : 'Wallet sign-in complete.';
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
    throw new Error(WALLET_NOT_CONFIGURED_MESSAGE);
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
      networks: [base, mainnet, baseSepolia],
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

  renderAuthIdentity();

  if (authStatus) {
    const statusText = getAuthStatusText();
    authStatus.textContent = statusText;
    authStatus.classList.toggle('hidden', statusText.length === 0);
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
  const hasSavedDisplayName = Boolean(state.user?.displayName?.trim());
  const showDisplayNameRow = state.authenticated && !hasSavedDisplayName;

  if (authLogoutButton) {
    authLogoutButton.classList.toggle('hidden', !state.authenticated || state.source === 'playfun');
    authLogoutButton.disabled = state.loading;
  }

  if (authDisplayNameRow) {
    authDisplayNameRow.classList.toggle('hidden', !showDisplayNameRow);
  }

  if (authDisplayNameInput) {
    const desiredValue = showDisplayNameRow ? (state.user?.displayName ?? '') : '';
    if (authDisplayNameInput !== document.activeElement) {
      authDisplayNameInput.value = desiredValue;
    }
    authDisplayNameInput.disabled = state.loading || !showDisplayNameRow;
  }

  if (authDisplayNameButton) {
    authDisplayNameButton.classList.toggle('hidden', !showDisplayNameRow);
    authDisplayNameButton.disabled = state.loading || !showDisplayNameRow;
  }

  if (authDisplayNameStatus) {
    authDisplayNameStatus.classList.remove('is-available', 'is-taken');

    const draftValue = authDisplayNameInput?.value.replace(/\s+/g, ' ').trim() ?? '';
    let displayNameStatusText = '';
    if (!showDisplayNameRow || !draftValue) {
      displayNameStatusText = '';
    } else if (lastCheckedDisplayName === draftValue && lastDisplayNameAvailability) {
      if (lastDisplayNameAvailability.available) {
        displayNameStatusText = 'Display name is available.';
        authDisplayNameStatus.classList.add('is-available');
      } else {
        displayNameStatusText = 'That display name has already been claimed.';
        authDisplayNameStatus.classList.add('is-taken');
      }
    } else if (authDisplayNameInput === document.activeElement) {
      displayNameStatusText = 'Checking availability...';
    }

    authDisplayNameStatus.textContent = displayNameStatusText;
    authDisplayNameStatus.classList.toggle('hidden', displayNameStatusText.length === 0);
  }

  if (authSessionSummary && authSessionSummaryValue) {
    const summaryText = state.authenticated ? buildSessionSummaryValue(state.user) : '';
    authSessionSummaryValue.textContent = summaryText;
    authSessionSummary.classList.toggle('hidden', summaryText.length === 0);
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

function renderAuthIdentity(): void {
  if (!authIdentity) {
    return;
  }

  const showIdentity = state.authenticated && Boolean(authIdentityProfile);
  const clickable = isOpenableProfileUserId(state.user?.id);
  authIdentity.classList.toggle('hidden', !showIdentity);
  authIdentity.disabled = !clickable;
  authIdentity.title =
    showIdentity && clickable && authIdentityProfile
      ? `View ${authIdentityProfile.displayName}'s profile`
      : '';

  if (!showIdentity || !authIdentityProfile) {
    return;
  }

  if (authIdentityName) {
    authIdentityName.textContent = authIdentityProfile.displayName;
  }
  renderAuthIdentityAvatar(authIdentityProfile.selectedAvatarId);
  renderMiniProfileStatLevel(authIdentityPlayerLevel, authIdentityProfile.playerLevel);
  renderMiniProfileProgress(authIdentityPlayerProgress, authIdentityProfile.playerProgressFraction);
  renderMiniProfileStatLevel(authIdentityCuratorLevel, authIdentityProfile.curatorLevel);
  renderMiniProfileProgress(authIdentityCuratorProgress, authIdentityProfile.curatorProgressFraction);
  renderMiniProfileStatLevel(authIdentityBuilderLevel, authIdentityProfile.builderLevel);
  renderMiniProfileProgress(authIdentityBuilderProgress, authIdentityProfile.builderProgressFraction);
  authIdentity.dataset.playerProgress = formatProgressFraction(authIdentityProfile.playerProgressFraction);
  authIdentity.dataset.curatorProgress = formatProgressFraction(authIdentityProfile.curatorProgressFraction);
  authIdentity.dataset.builderProgress = formatProgressFraction(authIdentityProfile.builderProgressFraction);
}

function renderAuthIdentityAvatar(selectedAvatarId: string | null): void {
  if (!authIdentityAvatar) {
    return;
  }

  const avatarId = selectedAvatarId ?? '';
  if (
    authIdentityAvatar.dataset.avatarId === avatarId
    && authIdentityAvatar.dataset.previewLoaded === 'true'
  ) {
    return;
  }

  authIdentityAvatar.dataset.avatarId = avatarId;
  authIdentityAvatar.dataset.previewLoaded = 'false';
  void createPlayerAvatarPreviewDataUrl(selectedAvatarId).then((dataUrl) => {
    if (!authIdentityAvatar || authIdentityAvatar.dataset.avatarId !== avatarId || !dataUrl) {
      return;
    }

    authIdentityAvatar.src = dataUrl;
    authIdentityAvatar.dataset.previewLoaded = 'true';
  });
}

function renderMiniProfileStatLevel(element: HTMLElement | null, level: number | null): void {
  if (!element) {
    return;
  }

  const iconSrc = element.dataset.iconSrc?.trim() ?? '';
  const iconLabel = element.dataset.iconLabel?.trim() ?? 'Level';

  if (!Number.isFinite(level) || !level || level <= 0 || !iconSrc) {
    element.dataset.placeholder = 'true';
    element.setAttribute('aria-label', `${iconLabel} level unavailable`);
    if (element.textContent !== '--') {
      element.replaceChildren(document.createTextNode('--'));
    }
    return;
  }

  if (element.dataset.levelValue === String(level) && element.dataset.placeholder !== 'true') {
    return;
  }

  const icon = document.createElement('img');
  icon.className = 'mini-profile-stat-level-icon';
  icon.src = iconSrc;
  icon.alt = '';
  icon.setAttribute('aria-hidden', 'true');

  const label = document.createElement('span');
  label.className = 'mini-profile-stat-level-label';
  label.textContent = `LVL ${level}`;

  element.dataset.levelValue = String(level);
  element.dataset.placeholder = 'false';
  element.setAttribute('aria-label', `${iconLabel} level ${level}`);
  element.replaceChildren(icon, label);
}

function renderMiniProfileProgress(element: HTMLElement | null, fraction: number | null): void {
  if (!element) {
    return;
  }

  element.style.transition = 'none';
  element.style.width = `${Math.max(0, Math.min(1, fraction ?? 0)) * 100}%`;
}

function formatProgressFraction(fraction: number | null): string {
  return String(Math.max(0, Math.min(1, fraction ?? 0)));
}

function getAuthStatusText(): string {
  if (!state.authenticated) {
    return state.status;
  }

  if (!state.status || isGenericSignedInStatus(state.status)) {
    return '';
  }

  return state.status;
}

function isGenericSignedInStatus(status: string): boolean {
  return (
    status.length === 0
    || status.startsWith('Signed in as ')
    || status.startsWith('Signed in via Play.fun as ')
    || status.startsWith('Signed in with wallet ')
    || status.startsWith('Wallet linked to ')
  );
}

function buildSessionSummaryValue(user: AuthUser | null): string {
  if (!user) {
    return '';
  }

  const primary = user.displayName?.trim() || user.email?.trim() || 'player';
  if (user.walletAddress) {
    return `${primary} and ${shortenAddress(user.walletAddress)}`;
  }

  return primary;
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
  return requestApi<T>(path, {
    ...init,
    prepareHeaders: appendPlayfunRequestHeaders,
  });
}

function normalizeDebugMagicLink(rawMagicLink: string | null | undefined): string | null {
  if (!rawMagicLink) {
    return null;
  }

  const apiBase = getApiBaseUrl().replace(/\/+$/, '');
  if (!apiBase) {
    return rawMagicLink;
  }

  try {
    const magicLinkUrl = new URL(rawMagicLink);
    if (magicLinkUrl.pathname !== '/api/auth/verify') {
      return rawMagicLink;
    }

    return `${apiBase}${magicLinkUrl.pathname}${magicLinkUrl.search}${magicLinkUrl.hash}`;
  } catch {
    return rawMagicLink;
  }
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
  return resolveWalletProjectId(runtimeWalletProjectId);
}

export function getResolvedPartykitConfig(): {
  host: string;
  party: string;
  source: 'build' | 'runtime';
} | null {
  return resolvePartykitConfig(runtimePartykitHost, runtimePartykitParty);
}

function setRuntimeWalletProjectId(projectId: string | null | undefined): void {
  runtimeWalletProjectId = projectId?.trim() ?? '';
  refreshWalletProjectConfiguration();
}

function setRuntimePartykitConfig(host: string | null | undefined, party: string | null | undefined): void {
  runtimePartykitHost = host?.trim() ?? '';
  runtimePartykitParty = party?.trim() ?? '';
  refreshPartykitConfiguration();
}

function refreshWalletProjectConfiguration(): void {
  state.walletProjectConfigured = Boolean(getWalletProjectId());
  state.walletProjectSource = getWalletProjectIdSource(runtimeWalletProjectId);
}

function refreshPartykitConfiguration(): void {
  const config = getResolvedPartykitConfig();
  state.partykitConfigured = Boolean(config);
  state.partykitHost = config?.host ?? null;
  state.partykitParty = config?.party ?? null;
  state.partykitSource = getPartykitConfigSource(runtimePartykitHost);
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

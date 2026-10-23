import { classifyWalletRpcRejection, createSingleSendProvider } from './walletSendGuard';
import type { AppKit } from '@reown/appkit';
import type {
  AuthSessionResponse,
  DisplayNameAvailabilityResponse,
  DisplayNameUpdateResponse,
  AuthUser,
  MagicLinkRequestResponse,
} from './model';
import type { ChatModerationViewer } from '../chat/model';
import { clearLocalRoomStorage } from '../persistence/browserStorage';
import { createPlayerAvatarPreviewDataUrl } from '../player/avatar/previews';
import { setStoredPlayerAvatarId } from '../player/avatar/storage';
import { getApiBaseUrl } from '../api/baseUrl';
import { apiRequest as requestApi } from '../api/request';
import { createProfileRepository } from '../profiles/profileRepository';
import { rememberBuilderTrustTier } from '../roomVideo/access';
import { isOpenableProfileUserId, PROFILE_INVALIDATED_EVENT, requestProfileOpen } from '../ui/setup/profileEvents';
import { installMenuToggle } from '../ui/menuToggle';
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
} from './runtimeConfig';
import { createAuthState, transitionAuthState, getAuthStateSnapshot, getAuthQueryStatus,
  isGenericSignedInStatus, normalizeChatModerationViewer, type AuthDebugState } from './sessionState';
export type { AuthDebugState } from './sessionState';
import { dispatchTypedEvent } from '../events/typedEvent';
import { WalletRequestNotSubmittedError, WalletTransactionRevertedError } from './walletTransaction';
import { waitForWalletReceipt } from './walletReceiptWait';
import { applyWalletGate } from '../lib/wallet-gate.js';
import { hasCryptoWallet } from '../mint/walletGate';
import { authenticateWallet, walletAuthenticationErrorMessage } from './walletAuthentication';

export const AUTH_STATE_CHANGED_EVENT = 'auth-state-changed';
export const AUTH_SESSION_REFRESHED_EVENT = 'auth-session-refreshed';


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

let state = createAuthState({ storageBackend: getStorageBackend(), testResetEnabled: isTestResetEnabled() });
let sessionGeneration = 0;

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
let authEmailRow: HTMLElement | null = null;
let authEmailInput: HTMLInputElement | null = null;
let authEmailButton: HTMLButtonElement | null = null;
let authWalletButton: HTMLButtonElement | null = null;
let authLogoutButton: HTMLButtonElement | null = null;
let authLogoutAllButton: HTMLButtonElement | null = null;
let authDisplayNameRow: HTMLElement | null = null;
let authDisplayNameInput: HTMLInputElement | null = null;
let authDisplayNameButton: HTMLButtonElement | null = null;
let authDisplayNameStatus: HTMLElement | null = null;
let testResetButton: HTMLButtonElement | null = null;
let authStatus: HTMLElement | null = null;
let authSessionSummary: HTMLElement | null = null;
let authSessionSummaryValue: HTMLElement | null = null;
let authDebugLink: HTMLAnchorElement | null = null;
let emailCodePanel: HTMLElement | null = null;
let emailCodeInput: HTMLInputElement | null = null;
let emailCodeStatus: HTMLElement | null = null;
let pendingEmailCodeAddress = '';
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

const DEFAULT_SIGN_IN_PROMPT_STATUS = 'Sign in to continue.';
const WALLET_NOT_CONFIGURED_MESSAGE = 'Wallet sign-in is not configured on this deployment.';

export async function setupAuthUi(): Promise<void> {
  void applyWalletGate().then(() => renderAuthUi());
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
  authEmailRow = document.getElementById('auth-email-row');
  authEmailInput = document.getElementById('auth-email-input') as HTMLInputElement | null;
  authEmailButton = document.getElementById('btn-auth-email') as HTMLButtonElement | null;
  authWalletButton = document.getElementById('btn-auth-wallet') as HTMLButtonElement | null;
  authLogoutButton = document.getElementById('btn-auth-logout') as HTMLButtonElement | null;
  authLogoutAllButton = document.getElementById('btn-auth-logout-all') as HTMLButtonElement | null;
  authDisplayNameRow = document.getElementById('auth-display-name-row');
  authDisplayNameInput = document.getElementById('auth-display-name-input') as HTMLInputElement | null;
  authDisplayNameButton = document.getElementById('btn-auth-display-name') as HTMLButtonElement | null;
  authDisplayNameStatus = document.getElementById('auth-display-name-status');
  testResetButton = document.getElementById('btn-test-reset') as HTMLButtonElement | null;
  authStatus = document.getElementById('auth-status');
  authSessionSummary = document.getElementById('auth-session-summary');
  authSessionSummaryValue = document.getElementById('auth-session-summary-value');
  authDebugLink = document.getElementById('auth-debug-link') as HTMLAnchorElement | null;
  emailCodePanel = document.getElementById('auth-email-code');
  emailCodeInput = document.getElementById('email-code-input') as HTMLInputElement | null;
  emailCodeStatus = document.getElementById('email-code-status');
  document.getElementById('email-code-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    void verifyEmailCode();
  });
  emailCodeInput?.addEventListener('input', () => {
    if (emailCodeInput) emailCodeInput.value = emailCodeInput.value.replace(/\D/g, '').slice(0, 6);
  });

  if (!authPanel) {
    return;
  }

  // Hamburger menu toggle
  const menuToggle = document.getElementById('menu-toggle');
  if (menuToggle) {
    installMenuToggle({ panel: authPanel, toggle: menuToggle, game: document.getElementById('game-container') });
  }
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
  authLogoutAllButton?.addEventListener('click', () => {
    void logout('all');
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
  renderAuthUi();
  window.dispatchEvent(
    new CustomEvent(AUTH_SESSION_REFRESHED_EVENT, {
      detail: getAuthDebugState(),
    })
  );
}

export function getAuthDebugState(): AuthDebugState {
  return getAuthStateSnapshot(state);
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

  state = transitionAuthState(state, { type: 'moderation', viewer: normalized });
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
  chain: RoomMintChainInfo,
  options: {
    expectedWalletAddress?: string;
    isCurrent?: () => boolean;
    onBeforeSend?: () => void;
    signal?: AbortSignal;
    onSubmitted?: (transaction: { hash: string; from: string }) => void;
  } = {},
): Promise<{ hash: string; from: string }> {
  const current = () => !options.signal?.aborted && options.isCurrent?.() !== false;
  if (!current()) throw new Error('This room action is no longer current.');
  if (transaction.chainId !== chain.chainId) throw new Error('The room approval network changed. Prepare this room action again.');
  if (!state.walletProjectConfigured) {
    throw new Error(WALLET_NOT_CONFIGURED_MESSAGE);
  }

  const walletModal = await ensureWalletModal();
  await ensureWalletConnection();
  const provider = getWalletProvider(walletModal);

  if (!current()) throw new Error('This room action is no longer current.');
  try { await ensureWalletChain(provider, chain); }
  catch (error) {
    throw new WalletRequestNotSubmittedError('network-switch', `Switch your wallet to ${chain.name} and try again.`, error);
  }

  const { createPublicClient, createWalletClient, custom, TransactionReceiptNotFoundError, BaseError, ChainMismatchError, InsufficientFundsError, UserRejectedRequestError } = await import('viem');
  const sendProvider = createSingleSendProvider(provider, chain.chainId, current, options.onBeforeSend);
  const walletClient = createWalletClient({ transport: custom(sendProvider, { retryCount: 0 }) });
  const [signerAddress] = await walletClient.getAddresses();
  if (!signerAddress) throw new Error('The connected wallet did not expose an account.');
  const linkedWallet = state.user?.walletAddress?.toLowerCase();

  if (linkedWallet && linkedWallet !== signerAddress.toLowerCase()) {
    throw new WalletRequestNotSubmittedError('wallet-mismatch', `Switch to your linked wallet ${linkedWallet.slice(0, 6)}…${linkedWallet.slice(-4)} and try again.`);
  }

  if (!current()) throw new Error('This room action is no longer current.');
  if (options.expectedWalletAddress && options.expectedWalletAddress.trim().toLowerCase() !== signerAddress.toLowerCase()) {
    throw new WalletRequestNotSubmittedError('wallet-mismatch', 'The connected wallet changed while preparing this room action.');
  }

  const hash = await walletClient.sendTransaction({
    account: signerAddress,
    chain: { id: chain.chainId, name: chain.name, nativeCurrency: chain.nativeCurrency,
      rpcUrls: { default: { http: [chain.rpcUrl] } } },
    to: requireHexValue(transaction.to, 'transaction destination'),
    data: requireHexValue(transaction.data, 'transaction data'),
    value: BigInt(transaction.value),
  }).catch(error => {
    const stopped = error instanceof BaseError ? error.walk(cause => cause instanceof WalletRequestNotSubmittedError) : error;
    if (stopped instanceof WalletRequestNotSubmittedError) throw stopped;
    if (error instanceof BaseError && error.walk(cause => cause instanceof ChainMismatchError) instanceof ChainMismatchError) {
      throw new WalletRequestNotSubmittedError('network-switch', `Wallet network changed. Switch back to ${chain.name} and try again.`, error);
    }
    if (error instanceof BaseError && error.walk(cause => cause instanceof InsufficientFundsError) instanceof InsufficientFundsError) {
      throw new WalletRequestNotSubmittedError('insufficient-funds', 'Your wallet needs ETH for this action and its network fee.', error);
    }
    if (error instanceof BaseError && error.walk(cause => cause instanceof UserRejectedRequestError) instanceof UserRejectedRequestError) {
      throw new WalletRequestNotSubmittedError('cancelled', 'You cancelled in your wallet.', error);
    }
    if (error instanceof BaseError) {
      const rejection = classifyWalletRpcRejection(error, InsufficientFundsError.nodeMessage);
      if (rejection) throw rejection;
    }
    throw error;
  });
  options.onSubmitted?.({ hash, from: signerAddress });
  const publicClient = createPublicClient({ transport: custom(provider, { retryCount: 0 }) });
  const receipt = options.signal
    ? await waitForWalletReceipt(() => publicClient.getTransactionReceipt({ hash }), error => error instanceof TransactionReceiptNotFoundError, options.signal)
    : await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status === 'reverted') throw new WalletTransactionRevertedError(hash);

  return {
    hash,
    from: signerAddress,
  };
}

async function initializeWalletConnect(): Promise<void> {
  refreshWalletProjectConfiguration();
  refreshPartykitConfiguration();
}

async function refreshSession(): Promise<void> {
  const generation = sessionGeneration;
  try {
    const session = await apiRequest<AuthSessionResponse>('/api/auth/session');
    if (generation !== sessionGeneration) return;
    setRuntimeWalletProjectId(session.walletProjectId);
    setRuntimePartykitConfig(session.partykitHost, session.partykitParty);
    state = transitionAuthState(state, { type: 'session', session, preserveGuestStatus: window.location.search.includes('auth=') });

    if (session.authenticated) {
      setStoredPlayerAvatarId(session.user?.selectedAvatarId ?? null);
      syncAuthIdentityProfileFromSession(session.user);
      void ensureAuthIdentityProfileLoaded();
      lastCheckedDisplayName = session.user?.displayName ?? '';
      lastDisplayNameAvailability = session.user
        ? {
            available: true,
            claimedByCurrentUser: true,
          }
        : null;
    } else {
      authIdentityProfile = null;
      authIdentityProfileLoadingUserId = null;
      rememberBuilderTrustTier(null);
      lastCheckedDisplayName = '';
      lastDisplayNameAvailability = null;
    }
  } catch (error) {
    if (generation !== sessionGeneration) return;
    console.error('Failed to load auth session', error);
    state = transitionAuthState(state, { type: 'session-failed' });
    authIdentityProfile = null;
    authIdentityProfileLoadingUserId = null;
    rememberBuilderTrustTier(null);
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
    rememberBuilderTrustTier(null);
    return;
  }

  const fallbackName =
    user.displayName?.trim()
    || user.email?.trim()
    || (hasCryptoWallet() && user.walletAddress ? shortenAddress(user.walletAddress) : 'Player');

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
    rememberBuilderTrustTier(null);
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
    rememberBuilderTrustTier(null);
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
    const profile = await profileRepository.loadProfileSummary(userId);
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
    rememberBuilderTrustTier(profile.progression.builderCaps.trustTier);
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
  const linkingEmail = state.authenticated && !state.user?.email;

  if (!email) {
    state.status = linkingEmail
      ? 'Enter the email address you want to add.'
      : 'Enter an email address.';
    renderAuthUi();
    return;
  }

  setLoading(true, linkingEmail ? 'Sending verification link...' : 'Sending sign-in link...');

  try {
    const response = await apiRequest<MagicLinkRequestResponse>('/api/auth/request-link', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });

    state = transitionAuthState(state, { type: 'email-requested', response, debugMagicLink: normalizeDebugMagicLink(response.debugMagicLink) });
    showEmailCodeEntry(email, response.debugCode);
  } catch (error) {
    console.error('Failed to request magic link', error);
    state.status = getErrorMessage(error, 'Failed to send sign-in link.');
  } finally {
    setLoading(false);
  }
}

function showEmailCodeEntry(email: string, debugCode?: string): void {
  pendingEmailCodeAddress = email;
  if (emailCodeInput) emailCodeInput.value = '';
  const address = document.getElementById('email-code-address');
  if (address) address.textContent = email;
  if (emailCodeStatus) emailCodeStatus.textContent = debugCode
    ? `Debug code: ${debugCode}`
    : 'The code expires in 15 minutes.';
  emailCodePanel?.classList.remove('hidden');
  emailCodeInput?.focus();
}

function hideEmailCodeEntry(): void {
  pendingEmailCodeAddress = '';
  emailCodePanel?.classList.add('hidden');
}

async function verifyEmailCode(): Promise<void> {
  const code = emailCodeInput?.value.trim() ?? '';
  if (!/^\d{6}$/.test(code)) {
    if (emailCodeStatus) emailCodeStatus.textContent = 'Enter all six digits.';
    return;
  }
  const submit = document.getElementById('email-code-submit') as HTMLButtonElement | null;
  if (submit) submit.disabled = true;
  if (emailCodeStatus) emailCodeStatus.textContent = 'Checking code...';
  try {
    await apiRequest('/api/auth/verify-code', {
      method: 'POST',
      body: JSON.stringify({ email: pendingEmailCodeAddress, code }),
    });
    hideEmailCodeEntry();
    state = transitionAuthState(state, { type: 'email-verified' });
    await refreshSession();
  } catch (error) {
    if (emailCodeStatus) emailCodeStatus.textContent = getErrorMessage(error, 'Could not verify code.');
    emailCodeInput?.focus();
    emailCodeInput?.select();
  } finally {
    if (submit) submit.disabled = false;
  }
}

async function logout(scope: 'current' | 'all' = 'current'): Promise<void> {
  if (scope === 'all' && !window.confirm('Log out on all devices? You will need to sign in again.')) return;
  // A response started before or during revocation must not restore old identity.
  sessionGeneration += 1;
  setLoading(true, 'Signing out...');

  try {
    const classroomSlug = state.schoolManaged ? state.school?.classroomSlug ?? null : null;
    await apiRequest<{ ok: true }>(scope === 'all' ? '/api/auth/logout-all' : '/api/auth/logout', {
      method: 'POST',
    });
    if (classroomSlug) {
      // Shared school computers: hand the device straight back to the class login page.
      window.location.assign(`/school-login.html?classroom=${encodeURIComponent(classroomSlug)}`);
      return;
    }

    state = transitionAuthState(state, { type: 'signed-out',
      ...(scope === 'all' ? { status: 'Signed out on all devices.' } : {}),
    });
  } catch (error) {
    console.error('Failed to sign out', error);
    state.status = getErrorMessage(error, 'Failed to sign out.');
  } finally {
    sessionGeneration += 1;
    setLoading(false);
  }
}

async function resetTestData(): Promise<void> {
  const isLocalRoomStorage = state.storageBackend === 'local';
  const confirmed = window.confirm(
    isLocalRoomStorage
      ? 'Reset local test data? This deletes local room drafts and published room records cached in this browser.'
      : 'Reset test data on the current API backend? This deletes rooms, versions, users, sessions, and auth tokens.'
  );
  if (!confirmed) {
    return;
  }

  setLoading(true, 'Resetting test data...');

  try {
    if (isLocalRoomStorage) {
      const clearedLocalRooms = clearLocalRoomStorage();
      state.status = `Reset complete. Cleared ${clearedLocalRooms} local cached room entries. Reloading...`;
      renderAuthUi();

      window.setTimeout(() => {
        window.location.replace(`${window.location.pathname}${window.location.hash}`);
      }, 200);
      return;
    }

    const response = await apiRequest<TestResetResponse>('/api/test/reset', {
      method: 'POST',
    });

    const clearedLocalRooms = clearLocalRoomStorage();
    state = transitionAuthState(state, { type: 'signed-out', status: `Reset complete. Cleared ${response.deleted.rooms} rooms and ${clearedLocalRooms} local cached room entries. Reloading...` });
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
    state = transitionAuthState(state, { type: 'display-name', user: response.user });
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
  if (state.loading) return;
  if (!hasCryptoWallet()) return;
  if (!state.walletProjectConfigured) {
    state.status = WALLET_NOT_CONFIGURED_MESSAGE;
    renderAuthUi();
    return;
  }

  const linkedWallet = state.user?.walletAddress?.toLowerCase();
  const connectedWallet = state.walletAddress?.toLowerCase();

  if (linkedWallet && linkedWallet === connectedWallet) {
    try {
      const walletModal = await ensureWalletModal();
      await walletModal.open({ view: 'Account', namespace: 'eip155' });
    } catch (error) {
      state.status = walletAuthenticationErrorMessage(error);
      renderAuthUi();
    }
    return;
  }

  await authenticateWithWallet();
}

async function authenticateWithWallet(): Promise<void> {
  const userId = state.user?.id ?? null, generation = sessionGeneration;
  const controller = new AbortController();
  let connectedAddress: string | null = null;
  const current = () => hasCryptoWallet() && generation === sessionGeneration
    && (state.user?.id ?? null) === userId
    && (!connectedAddress || state.walletAddress?.toLowerCase() === connectedAddress);
  const changed = () => { if (!current()) controller.abort(); };
  const leaving = () => controller.abort();
  window.addEventListener(AUTH_STATE_CHANGED_EVENT, changed);
  window.addEventListener('wallet-gate', changed);
  window.addEventListener('pagehide', leaving);
  let failure = '';
  setLoading(true, state.authenticated ? 'Linking wallet...' : 'Signing in with wallet...');

  try {
    const response = await authenticateWallet({
      signal: controller.signal, isCurrent: current, expectedUserId: userId,
      connect: async () => {
        const walletModal = await ensureWalletModal(), address = await ensureWalletConnection();
        connectedAddress = address.toLowerCase();
        return { address, provider: getWalletProvider(walletModal) };
      },
    });
    if (controller.signal.aborted || !current()) return;
    state = transitionAuthState(state, { type: 'wallet-verified', response });
  } catch (error) {
    failure = walletAuthenticationErrorMessage(error);
  } finally {
    window.removeEventListener(AUTH_STATE_CHANGED_EVENT, changed);
    window.removeEventListener('wallet-gate', changed);
    window.removeEventListener('pagehide', leaving);
    controller.abort();
    await refreshSession();
    if (failure) state.status = failure;
    setLoading(false);
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
  if (!hasCryptoWallet()) throw new Error('Room collection is unavailable in this browser.');
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
    const [{ createAppKit }, { WagmiAdapter }, { base, baseSepolia, mainnet }] = await Promise.all([
      import('@reown/appkit'),
      import('@reown/appkit-adapter-wagmi'),
      import('@reown/appkit/networks'),
    ]);
    const networks: [typeof base, typeof mainnet, typeof baseSepolia] = [base, mainnet, baseSepolia];
    const wagmiAdapter = new WagmiAdapter({ projectId, networks });

    const metadata = {
      name: 'WAMP',
      description: 'Collaborative platformer world builder',
      url: window.location.origin,
      icons: [`${window.location.origin}/favicon.svg`],
    };

    const walletModal = createAppKit({
      adapters: [wagmiAdapter],
      featuredWalletIds: [...FEATURED_REOWN_WALLET_IDS],
      enableCoinbase: false,
      metadata,
      networks,
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

function requireHexValue(value: string, label: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]*$/.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value as `0x${string}`;
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
    authEmailButton.textContent =
      state.authenticated && !state.user?.email ? 'Add Email' : 'Sign In With Email';
    authEmailButton.disabled = state.loading;
  }

  // Classroom accounts never link a personal email or wallet (the server refuses it too).
  const showEmailRow = !state.schoolManaged && (!state.authenticated || !state.user?.email);
  authEmailRow?.classList.toggle('hidden', !showEmailRow);
  if (!showEmailRow) hideEmailCodeEntry();

  if (authEmailInput) {
    authEmailInput.placeholder =
      state.authenticated && !state.user?.email ? 'Add your email address' : 'you@example.com';
    authEmailInput.disabled = state.loading || !showEmailRow;
  }

  if (authWalletButton) {
    authWalletButton.disabled = state.loading || !state.walletProjectConfigured;
    authWalletButton.textContent = getWalletButtonLabel();
    authWalletButton.classList.toggle('hidden', state.schoolManaged);
  }

  authPanel.classList.toggle('auth-panel-guest', !state.authenticated);
  const hasSavedDisplayName = Boolean(state.user?.displayName?.trim());
  const showDisplayNameRow = state.authenticated && !hasSavedDisplayName;

  if (authLogoutButton) {
    authLogoutButton.classList.toggle('hidden', !state.authenticated);
    authLogoutButton.disabled = state.loading;
  }
  if (authLogoutAllButton) {
    authLogoutAllButton.classList.toggle('hidden', !state.authenticated);
    authLogoutAllButton.disabled = state.loading;
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

  dispatchTypedEvent<AuthDebugState>(window, AUTH_STATE_CHANGED_EVENT, getAuthDebugState());
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
  if (!hasCryptoWallet() && /wallet/i.test(state.status)) return 'Sign in with email to save your progress.';
  if (!state.authenticated) {
    return state.status;
  }

  if (!state.status || isGenericSignedInStatus(state.status)) {
    return state.user?.walletAddress && !state.user.email
      ? 'Add an email for another way to sign in and recover your account.'
      : '';
  }

  return state.status;
}

function buildSessionSummaryValue(user: AuthUser | null): string {
  if (!user) {
    return '';
  }

  const primary = user.displayName?.trim() || user.email?.trim() || 'player';
  if (hasCryptoWallet() && user.walletAddress) {
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

function setLoading(loading: boolean, status?: string): void {
  state = transitionAuthState(state, { type: 'loading', loading, status });
  renderAuthUi();
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  return requestApi<T>(path, {
    ...init,
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

  if (getAuthQueryStatus(authResult) === null) return;
  state = transitionAuthState(state, { type: 'query', result: authResult });

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

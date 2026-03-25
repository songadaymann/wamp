import type { AppKit } from '@reown/appkit';
import type { ChatModerationViewer } from '../chat/model';
import { isOpenableProfileUserId, requestProfileOpen } from '../ui/setup/profileEvents';
import type { PreparedWalletTransaction, RoomMintChainInfo } from '../mint/roomOwnership';
import type { WalletChallengeResponse, WalletVerifyResponse } from './model';
import type { AuthDebugState } from './clientTypes';
import type { AuthUiElements } from './domController';
import { collectAuthUiElements, bindAuthUiEvents } from './domController';
import { renderAuthUi as renderAuthElements } from './render';
import {
  AuthSessionService,
  authApiRequest,
  getAuthErrorMessage,
} from './sessionService';

export type { AuthDebugState } from './clientTypes';

export const AUTH_STATE_CHANGED_EVENT = 'auth-state-changed';

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

let authUi: AuthUiElements | null = null;
let appKit: AppKit | null = null;
let walletBootstrapPromise: Promise<AppKit> | null = null;
let sessionRefreshListenersBound = false;

const FEATURED_REOWN_WALLET_IDS = [
  'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96',
  '18388be9ac2d02726dbac9777c96efaac06d744b2f6d580fccdd4127a6d01fd1',
  '1ae92b26df02f0abca6304df07debccd18262fdf5fe82daa81593582dac9a369',
  'ecc4036f814562b41a5268adc86270fba1365471402006302e70169465b7ac18',
] as const;

const DEFAULT_GUEST_STATUS = 'Sign in to build rooms, publish them, and save your runs.';
const DEFAULT_SIGN_IN_PROMPT_STATUS =
  'Sign in to build rooms, publish them, chat, and climb the leaderboards.';
let guestPanelAutoOpened = false;

const sessionService = new AuthSessionService({
  state,
  guestStatus: DEFAULT_GUEST_STATUS,
  render: () => renderAuthUi(),
  setLoading,
});

export async function setupAuthUi(): Promise<void> {
  authUi = collectAuthUiElements();

  if (!authUi.authPanel) {
    return;
  }

  bindAuthUiEvents(authUi, {
    onToggleMenu: () => {
      authUi?.authPanel?.classList.toggle('menu-open');
    },
    onCloseMenu: () => {
      authUi?.authPanel?.classList.remove('menu-open');
    },
    onIdentityActivate: () => {
      const userId = state.user?.id;
      if (!isOpenableProfileUserId(userId)) {
        return;
      }

      requestProfileOpen(userId);
    },
    onEmailSubmit: () => {
      const email = authUi?.authEmailInput?.value.trim() ?? '';
      void sessionService.requestMagicLink(email);
    },
    onWalletSubmit: () => {
      void handleWalletButton();
    },
    onLogout: () => {
      void sessionService.logout();
    },
    onDisplayNameSubmit: () => {
      const displayName = authUi?.authDisplayNameInput?.value.replace(/\s+/g, ' ').trim() ?? '';
      void sessionService.updateDisplayName(displayName);
    },
    onDisplayNameInput: () => {
      const displayName = authUi?.authDisplayNameInput?.value.replace(/\s+/g, ' ').trim() ?? '';
      sessionService.scheduleDisplayNameAvailabilityCheck(displayName);
    },
    onTestReset: () => {
      void sessionService.resetTestData();
    },
  });

  initializeStatusFromQuery();
  bindSessionRefreshListeners();
  await initializeWalletConnect();
  await sessionService.refreshSession();
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
  await sessionService.refreshSession();
}

export function syncChatModerationState(viewer: ChatModerationViewer): void {
  sessionService.syncChatModerationState(viewer);
}

export function promptForSignIn(status: string = DEFAULT_SIGN_IN_PROMPT_STATUS): void {
  state.status = status;
  renderAuthUi();
  authUi?.authPanel?.classList.add('menu-open');
  authUi?.authEmailInput?.focus();
  authUi?.authEmailInput?.select();
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

function bindSessionRefreshListeners(): void {
  if (sessionRefreshListenersBound) {
    return;
  }

  sessionRefreshListenersBound = true;
  window.addEventListener('focus', () => {
    if (!state.loading) {
      void sessionService.refreshSession();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !state.loading) {
      void sessionService.refreshSession();
    }
  });
}

async function handleWalletButton(): Promise<void> {
  if (!state.walletProjectConfigured) {
    state.status = 'Wallet connect is not configured. Add the project ID to env.local and restart Vite.';
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
    const challenge = await authApiRequest<WalletChallengeResponse>(
      '/api/auth/wallet/challenge',
      {
        method: 'POST',
        body: JSON.stringify({ address }),
      }
    );

    const provider = getWalletProvider(walletModal);

    const { BrowserProvider } = await import('ethers');
    const browserProvider = new BrowserProvider(provider);
    const signer = await browserProvider.getSigner();
    const signerAddress = await signer.getAddress();
    const signature = await signer.signMessage(challenge.message);

    const response = await authApiRequest<WalletVerifyResponse>('/api/auth/wallet/verify', {
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
    state.status = getAuthErrorMessage(error, 'Wallet sign-in failed.');
  } finally {
    setLoading(false);
    await sessionService.refreshSession();
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
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      unsubscribe();
      resolve(value);
    };
    const fail = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      unsubscribe();
      reject(
        error instanceof Error
          ? error
          : new Error('Failed to open wallet connection modal.')
      );
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
    const [{ createAppKit }, { EthersAdapter }, { base, baseSepolia, mainnet }] =
      await Promise.all([
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
  if (!authUi) {
    return;
  }

  renderAuthElements(authUi, state, sessionService.getDisplayNameRenderState());

  window.dispatchEvent(
    new CustomEvent(AUTH_STATE_CHANGED_EVENT, {
      detail: getAuthDebugState(),
    })
  );
}

function maybeAutoOpenGuestPanel(): void {
  if (
    guestPanelAutoOpened ||
    state.authenticated ||
    state.loading ||
    !authUi?.authPanel ||
    isPlayfunVisitor()
  ) {
    return;
  }

  guestPanelAutoOpened = true;
  authUi.authPanel.classList.add('menu-open');
  authUi.authEmailInput?.focus();
  authUi.authEmailInput?.select();
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

function getProviderErrorCode(error: unknown): number | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const maybeCode = (error as { code?: unknown }).code;
  return typeof maybeCode === 'number' ? maybeCode : null;
}

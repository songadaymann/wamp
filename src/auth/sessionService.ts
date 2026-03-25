import type {
  AuthSessionResponse,
  DisplayNameAvailabilityResponse,
  DisplayNameUpdateResponse,
  MagicLinkRequestResponse,
} from './model';
import type { ChatModerationViewer } from '../chat/model';
import { clearLocalRoomStorage } from '../persistence/browserStorage';
import { getApiBaseUrl } from '../api/baseUrl';
import { appendPlayfunRequestHeaders } from '../playfun/state';
import type { AuthDebugState } from './clientTypes';

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

interface AuthSessionServiceOptions {
  state: AuthDebugState;
  guestStatus: string;
  render: () => void;
  setLoading: (loading: boolean, status?: string) => void;
}

export class AuthSessionService {
  private displayNameCheckTimer: number | null = null;
  private displayNameCheckToken = 0;
  private lastCheckedDisplayName = '';
  private lastDisplayNameAvailability: DisplayNameAvailabilityResponse | null = null;

  constructor(private readonly options: AuthSessionServiceOptions) {}

  getDisplayNameRenderState(): {
    lastCheckedDisplayName: string;
    lastDisplayNameAvailability: DisplayNameAvailabilityResponse | null;
  } {
    return {
      lastCheckedDisplayName: this.lastCheckedDisplayName,
      lastDisplayNameAvailability: this.lastDisplayNameAvailability,
    };
  }

  async refreshSession(): Promise<void> {
    const { state, guestStatus, render } = this.options;

    try {
      const session = await this.apiRequest<AuthSessionResponse>('/api/auth/session');
      state.authenticated = session.authenticated;
      state.user = session.user;
      state.source = session.source ?? null;
      state.roomDailyClaimLimit = session.roomDailyClaimLimit ?? null;
      state.roomClaimsUsedToday = session.roomClaimsUsedToday ?? 0;
      state.roomClaimsRemainingToday = session.roomClaimsRemainingToday ?? null;
      state.chatModeration = normalizeChatModerationViewer(session.chatModeration);

      if (session.authenticated) {
        state.status =
          session.source === 'playfun'
            ? `Signed in via Play.fun as ${session.user?.displayName ?? 'player'}.`
            : `Signed in as ${session.user?.displayName ?? 'player'}.`;
        this.lastCheckedDisplayName = session.user?.displayName ?? '';
        this.lastDisplayNameAvailability = session.user
          ? {
              available: true,
              claimedByCurrentUser: true,
            }
          : null;
      } else if (window.location.search.includes('auth=')) {
        state.source = null;
        this.lastCheckedDisplayName = '';
        this.lastDisplayNameAvailability = null;
      } else {
        state.source = null;
        state.status = guestStatus;
        this.lastCheckedDisplayName = '';
        this.lastDisplayNameAvailability = null;
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
      this.lastCheckedDisplayName = '';
      this.lastDisplayNameAvailability = null;
    }

    render();
  }

  syncChatModerationState(viewer: ChatModerationViewer): void {
    const normalized = normalizeChatModerationViewer(viewer);
    const { state, render } = this.options;
    if (
      state.chatModeration.role === normalized.role &&
      state.chatModeration.banned === normalized.banned
    ) {
      return;
    }

    state.chatModeration = normalized;
    render();
  }

  async requestMagicLink(email: string): Promise<void> {
    const { state, render, setLoading } = this.options;

    if (!email) {
      state.status = 'Enter an email address, or sign in with wallet.';
      render();
      return;
    }

    setLoading(true, 'Sending sign-in link...');

    try {
      const response = await this.apiRequest<MagicLinkRequestResponse>('/api/auth/request-link', {
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
      state.status = getAuthErrorMessage(error, 'Failed to send sign-in link.');
    } finally {
      setLoading(false);
    }
  }

  async logout(): Promise<void> {
    const { state, setLoading } = this.options;
    setLoading(true, 'Signing out...');

    try {
      await this.apiRequest<{ ok: true }>('/api/auth/logout', {
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
      state.status = getAuthErrorMessage(error, 'Failed to sign out.');
    } finally {
      setLoading(false);
    }
  }

  async resetTestData(): Promise<void> {
    const { state, render, setLoading } = this.options;
    const confirmed = window.confirm(
      'Reset test data on the current API backend? This deletes rooms, versions, users, sessions, and auth tokens.'
    );
    if (!confirmed) {
      return;
    }

    setLoading(true, 'Resetting test data...');

    try {
      const response = await this.apiRequest<TestResetResponse>('/api/test/reset', {
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
      render();

      window.setTimeout(() => {
        window.location.replace(`${window.location.pathname}${window.location.hash}`);
      }, 200);
    } catch (error) {
      console.error('Test reset failed', error);
      state.status = getAuthErrorMessage(error, 'Failed to reset test data.');
      setLoading(false);
    }
  }

  async updateDisplayName(displayName: string): Promise<void> {
    const { state, render, setLoading } = this.options;

    if (!state.authenticated || !state.user) {
      return;
    }

    if (!displayName) {
      state.status = 'Enter a display name first.';
      render();
      return;
    }

    if (displayName.length > 24) {
      state.status = 'Display name must be 24 characters or fewer.';
      render();
      return;
    }

    if (
      this.lastCheckedDisplayName === displayName &&
      this.lastDisplayNameAvailability &&
      !this.lastDisplayNameAvailability.available
    ) {
      state.status = 'That display name has already been claimed.';
      render();
      return;
    }

    setLoading(true, 'Saving display name...');

    try {
      const response = await this.apiRequest<DisplayNameUpdateResponse>('/api/auth/display-name', {
        method: 'POST',
        body: JSON.stringify({ displayName }),
      });
      state.user = response.user;
      state.status = `Display name updated to ${response.user.displayName}.`;
      this.lastCheckedDisplayName = response.user.displayName;
      this.lastDisplayNameAvailability = {
        available: true,
        claimedByCurrentUser: true,
      };
    } catch (error) {
      console.error('Failed to update display name', error);
      state.status = getAuthErrorMessage(error, 'Failed to update display name.');
    } finally {
      setLoading(false);
      await this.refreshSession();
    }
  }

  scheduleDisplayNameAvailabilityCheck(displayName: string): void {
    const { state, render } = this.options;
    if (!state.authenticated) {
      return;
    }

    if (this.displayNameCheckTimer !== null) {
      window.clearTimeout(this.displayNameCheckTimer);
      this.displayNameCheckTimer = null;
    }

    if (!displayName) {
      this.lastCheckedDisplayName = '';
      this.lastDisplayNameAvailability = null;
      render();
      return;
    }

    this.displayNameCheckTimer = window.setTimeout(() => {
      this.displayNameCheckTimer = null;
      void this.checkDisplayNameAvailability(displayName);
    }, 250);
  }

  private async checkDisplayNameAvailability(displayName: string): Promise<void> {
    const currentToken = ++this.displayNameCheckToken;
    try {
      const response = await this.apiRequest<DisplayNameAvailabilityResponse>(
        `/api/auth/display-name-availability?displayName=${encodeURIComponent(displayName)}`
      );
      if (currentToken !== this.displayNameCheckToken) {
        return;
      }

      this.lastCheckedDisplayName = displayName;
      this.lastDisplayNameAvailability = response;
      this.options.render();
    } catch (error) {
      if (currentToken !== this.displayNameCheckToken) {
        return;
      }

      console.error('Failed to check display name availability', error);
      this.lastCheckedDisplayName = displayName;
      this.lastDisplayNameAvailability = null;
      this.options.render();
    }
  }

  private async apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
    return authApiRequest<T>(path, init);
  }
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

export async function authApiRequest<T>(path: string, init?: RequestInit): Promise<T> {
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

export function getAuthErrorMessage(error: unknown, fallback: string): string {
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

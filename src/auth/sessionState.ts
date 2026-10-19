import type { AuthSessionResponse, AuthUser, MagicLinkRequestResponse, WalletVerifyResponse } from './model';
import type { ChatModerationViewer } from '../chat/model';
import type { AuthConfigSource, RoomStorageBackend } from './runtimeConfig';

const DEFAULT_GUEST_STATUS = 'Use email or wallet.';

export interface AuthDebugState {
  loading: boolean;
  authenticated: boolean;
  user: AuthUser | null;
  source: AuthSessionResponse['source'] | null;
  schoolManaged: boolean;
  school: AuthSessionResponse['school'] | null;
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

export function createAuthState(options: {
  storageBackend: RoomStorageBackend;
  testResetEnabled: boolean;
}): AuthDebugState {
  return {
    loading: false,
    authenticated: false,
    user: null,
    source: null,
    schoolManaged: false,
    school: null,
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
    storageBackend: options.storageBackend,
    testResetEnabled: options.testResetEnabled,
    chatModeration: {
      role: 'none',
      banned: false,
    },
  };
}

export type AuthTransition =
  | { type: 'session'; session: AuthSessionResponse; preserveGuestStatus: boolean }
  | { type: 'session-failed' }
  | { type: 'email-requested'; response: MagicLinkRequestResponse; debugMagicLink: string | null }
  | { type: 'email-verified' }
  | { type: 'signed-out'; status?: string }
  | { type: 'wallet-verified'; response: WalletVerifyResponse }
  | { type: 'display-name'; user: AuthUser }
  | { type: 'loading'; loading: boolean; status?: string }
  | { type: 'moderation'; viewer: ChatModerationViewer }
  | { type: 'query'; result: string | null };

/** Pure account transitions; requests, wallet providers and DOM effects stay in the client. */
export function transitionAuthState(state: AuthDebugState, event: AuthTransition): AuthDebugState {
  switch (event.type) {
    case 'session': {
      const { session } = event;
      return {
        ...state,
        authenticated: session.authenticated,
        user: session.user ? { ...session.user } : null,
        source: session.authenticated ? session.source ?? null : null,
        schoolManaged: session.authenticated && session.schoolManaged === true,
        school: session.authenticated && session.school ? { ...session.school } : null,
        roomDailyClaimLimit: session.roomDailyClaimLimit ?? null,
        roomClaimsUsedToday: session.roomClaimsUsedToday ?? 0,
        roomClaimsRemainingToday: session.roomClaimsRemainingToday ?? null,
        chatModeration: normalizeChatModerationViewer(session.chatModeration),
        status: session.authenticated
          ? state.status === DEFAULT_GUEST_STATUS || isGenericSignedInStatus(state.status) ? '' : state.status
          : event.preserveGuestStatus ? state.status : DEFAULT_GUEST_STATUS,
      };
    }
    case 'session-failed':
      // A failed request is not proof of expiry: retain the last identity, but drop
      // session-only school, quota and moderation details until a successful refresh.
      return { ...state, status: 'Failed to load account session.', source: null,
        schoolManaged: false, school: null, roomDailyClaimLimit: null,
        roomClaimsUsedToday: 0, roomClaimsRemainingToday: null,
        chatModeration: { role: 'none', banned: false } };
    case 'email-requested':
      return { ...state, debugMagicLink: event.debugMagicLink,
        status: event.response.delivery === 'email' ? '' : event.response.purpose === 'link_email'
          ? 'Debug email verification link generated below.' : 'Debug sign-in link generated below.' };
    case 'email-verified':
      // Only the subsequent session response supplies the verified identity.
      return { ...state, debugMagicLink: null, status: 'Signed in with email.' };
    case 'signed-out':
      return { ...state, authenticated: false, user: null, source: null,
        schoolManaged: false, school: null, debugMagicLink: null,
        roomDailyClaimLimit: null, roomClaimsUsedToday: 0, roomClaimsRemainingToday: null,
        chatModeration: { role: 'none', banned: false }, status: event.status ?? 'Signed out.' };
    case 'wallet-verified':
      return { ...state, authenticated: true, user: { ...event.response.user }, source: 'session',
        status: event.response.linkedWallet ? 'Wallet linked.' : 'Wallet sign-in complete.', debugMagicLink: null };
    case 'display-name':
      return { ...state, user: { ...event.user }, status: 'Display name saved.' };
    case 'loading':
      return { ...state, loading: event.loading, status: event.status || state.status };
    case 'moderation':
      return { ...state, chatModeration: normalizeChatModerationViewer(event.viewer) };
    case 'query': {
      const status = getAuthQueryStatus(event.result);
      return status === null ? state : { ...state, status };
    }
  }
}

export function getAuthStateSnapshot(state: AuthDebugState): AuthDebugState {
  return { ...state, user: state.user ? { ...state.user } : null,
    school: state.school ? { ...state.school } : null, chatModeration: { ...state.chatModeration } };
}

export function isGenericSignedInStatus(status: string): boolean {
  return status.length === 0 || status.startsWith('Signed in as ')
    || status.startsWith('Signed in with wallet ') || status.startsWith('Wallet linked to ');
}

export function normalizeChatModerationViewer(viewer: ChatModerationViewer | null | undefined): ChatModerationViewer {
  if (!viewer || (viewer.role !== 'none' && viewer.role !== 'admin' && viewer.role !== 'owner')) {
    return { role: 'none', banned: false };
  }
  return { role: viewer.role, banned: viewer.banned === true };
}

export function getAuthQueryStatus(result: string | null): string | null {
  switch (result) {
    case 'email': return 'Email sign-in complete.';
    case 'email-linked': return 'Email added to your account.';
    case 'school': return 'Classroom sign-in complete.';
    case 'invalid': return 'That sign-in link is invalid or expired.';
    default: return null;
  }
}

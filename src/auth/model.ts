import type { AgentAccount, RequestAuthSource, RequestPrincipal } from '../agents/model';
import type { ChatModerationViewer } from '../chat/model';

export interface AuthUser {
  id: string;
  email: string | null;
  walletAddress: string | null;
  displayName: string;
  createdAt?: string;
  avatarUrl?: string | null;
  bio?: string | null;
}

export const API_TOKEN_SCOPES = [
  'rooms:read',
  'rooms:write',
  'runs:write',
  'leaderboards:read',
] as const;

export type ApiTokenScope = typeof API_TOKEN_SCOPES[number];

export interface AuthSessionResponse {
  authenticated: boolean;
  user: AuthUser | null;
  source?: RequestAuthSource | null;
  scopes?: ApiTokenScope[] | null;
  principal?: RequestPrincipal | null;
  agent?: AgentAccount | null;
  chatModeration?: ChatModerationViewer;
  roomDailyClaimLimit?: number | null;
  roomClaimsUsedToday?: number;
  roomClaimsRemainingToday?: number | null;
}

export interface MagicLinkRequestBody {
  email: string;
}

export interface MagicLinkRequestResponse {
  ok: true;
  delivery: 'email' | 'debug';
  debugMagicLink?: string;
}

export interface WalletChallengeRequestBody {
  address: string;
}

export interface WalletChallengeResponse {
  address: string;
  message: string;
  expiresAt: string;
}

export interface WalletVerifyRequestBody {
  address: string;
  message: string;
  signature: string;
}

export interface WalletVerifyResponse {
  authenticated: true;
  linkedWallet: boolean;
  user: AuthUser;
}

export interface DisplayNameUpdateRequestBody {
  displayName: string;
}

export interface DisplayNameUpdateResponse {
  ok: true;
  user: AuthUser;
}

export interface DisplayNameAvailabilityResponse {
  available: boolean;
  claimedByCurrentUser: boolean;
}

export interface ApiTokenRecord {
  id: string;
  label: string;
  scopes: ApiTokenScope[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface ApiTokenListResponse {
  tokens: ApiTokenRecord[];
}

export interface ApiTokenCreateRequestBody {
  label: string;
  scopes: ApiTokenScope[];
}

export interface ApiTokenCreateResponse {
  token: string;
  record: ApiTokenRecord;
}

export interface AuthUser {
  id: string;
  email: string | null;
  walletAddress: string | null;
  displayName: string;
  createdAt?: string;
}

export interface AuthSessionResponse {
  authenticated: boolean;
  user: AuthUser | null;
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

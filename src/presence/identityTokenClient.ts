import { apiRequest } from '../api/request';
import type {
  PartyKitIdentity,
  PartyKitIdentityTokenIssueResponse,
} from './identityToken';

const TOKEN_REFRESH_SKEW_MS = 60_000;

interface CachedIdentityToken {
  token: string;
  expiresAtMs: number;
}

export class PartyKitIdentityTokenProvider {
  private cachedToken: CachedIdentityToken | null = null;
  private pendingTokenRequest: Promise<string> | null = null;

  constructor(private readonly resolveIdentity: () => PartyKitIdentity) {}

  async getToken(nowMs = Date.now()): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAtMs - TOKEN_REFRESH_SKEW_MS > nowMs) {
      return this.cachedToken.token;
    }

    if (this.pendingTokenRequest) {
      return this.pendingTokenRequest;
    }

    this.pendingTokenRequest = this.fetchToken()
      .finally(() => {
        this.pendingTokenRequest = null;
      });
    return this.pendingTokenRequest;
  }

  clear(): void {
    this.cachedToken = null;
    this.pendingTokenRequest = null;
  }

  private async fetchToken(): Promise<string> {
    const response = await apiRequest<PartyKitIdentityTokenIssueResponse>(
      '/api/presence/identity-token',
      {
        method: 'POST',
        body: JSON.stringify({
          identity: this.resolveIdentity(),
        }),
      }
    );

    const expiresAtMs = Date.parse(response.expiresAt);
    if (!response.token || !Number.isFinite(expiresAtMs)) {
      throw new Error('Presence identity token response was invalid.');
    }

    this.cachedToken = {
      token: response.token,
      expiresAtMs,
    };
    return response.token;
  }
}

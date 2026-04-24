import { getApiBaseUrl } from '../api/baseUrl';
import { appendCryptopunkUnlockOverrideHeaders } from './debug';
import type {
  AvatarSelectionRequestBody,
  AvatarSelectionResponse,
  CryptopunkAvatarGenerateResponse,
  CryptopunkAvatarStatusResponse,
} from './model';

export interface AvatarRepository {
  loadCryptopunkStatus(punkId: number): Promise<CryptopunkAvatarStatusResponse>;
  generateCryptopunkAvatar(punkId: number): Promise<CryptopunkAvatarGenerateResponse>;
  updateMySelectedAvatar(selectedAvatarId: string): Promise<AvatarSelectionResponse>;
}

class AvatarApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

class ApiAvatarRepository implements AvatarRepository {
  constructor(private readonly baseUrl: string) {}

  async loadCryptopunkStatus(punkId: number): Promise<CryptopunkAvatarStatusResponse> {
    return this.request<CryptopunkAvatarStatusResponse>(
      `/api/avatars/cryptopunks/${encodeURIComponent(String(punkId))}/status`
    );
  }

  async generateCryptopunkAvatar(punkId: number): Promise<CryptopunkAvatarGenerateResponse> {
    return this.request<CryptopunkAvatarGenerateResponse>(
      `/api/avatars/cryptopunks/${encodeURIComponent(String(punkId))}/generate`,
      {
        method: 'POST',
      }
    );
  }

  async updateMySelectedAvatar(selectedAvatarId: string): Promise<AvatarSelectionResponse> {
    const body: AvatarSelectionRequestBody = { selectedAvatarId };
    return this.request<AvatarSelectionResponse>('/api/profiles/me/avatar', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    if (init?.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    appendCryptopunkUnlockOverrideHeaders(headers);

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      credentials: 'include',
      headers,
    });

    if (!response.ok) {
      let message = `Avatar API request failed with status ${response.status}.`;
      try {
        const parsed = (await response.json()) as { error?: unknown };
        if (typeof parsed.error === 'string' && parsed.error.trim()) {
          message = parsed.error;
        }
      } catch {
        const raw = await response.text();
        if (raw.trim()) {
          message = raw;
        }
      }

      throw new AvatarApiError(message, response.status);
    }

    return (await response.json()) as T;
  }
}

export function createAvatarRepository(): AvatarRepository {
  return new ApiAvatarRepository(getApiBaseUrl());
}

export function isAvatarApiError(value: unknown): value is AvatarApiError {
  return value instanceof AvatarApiError;
}

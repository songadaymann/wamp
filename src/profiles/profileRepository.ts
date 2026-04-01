import { getApiBaseUrl } from '../api/baseUrl';
import type {
  UserProfileResponse,
  UserProfileUpdateRequestBody,
  UserProfileUpdateResponse,
} from './model';

export interface ProfileRepository {
  loadProfile(userId: string): Promise<UserProfileResponse>;
  updateMyProfile(body: UserProfileUpdateRequestBody): Promise<UserProfileUpdateResponse>;
}

class ProfileApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

class ApiProfileRepository implements ProfileRepository {
  constructor(private readonly baseUrl: string) {}

  async loadProfile(userId: string): Promise<UserProfileResponse> {
    return this.request<UserProfileResponse>(`/api/profiles/${encodeURIComponent(userId)}`);
  }

  async updateMyProfile(body: UserProfileUpdateRequestBody): Promise<UserProfileUpdateResponse> {
    return this.request<UserProfileUpdateResponse>('/api/profiles/me', {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    if (init?.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      credentials: 'include',
    });

    if (!response.ok) {
      let message = `Profile API request failed with status ${response.status}.`;
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

      throw new ProfileApiError(message, response.status);
    }

    return (await response.json()) as T;
  }
}

export function createProfileRepository(): ProfileRepository {
  return new ApiProfileRepository(getApiBaseUrl());
}

export function isProfileApiError(value: unknown): value is ProfileApiError {
  return value instanceof ProfileApiError;
}

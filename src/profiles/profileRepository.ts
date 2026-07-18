import { getApiBaseUrl } from '../api/baseUrl';
import { appendCryptopunkUnlockOverrideHeaders } from '../avatars/debug';
import {
  invalidateStaleWhileRevalidateCache,
  loadWithStaleWhileRevalidate,
} from '../api/staleWhileRevalidateCache';
import type {
  UserProfileResponse,
  UserProfileUpdateRequestBody,
  UserProfileUpdateResponse,
} from './model';

export interface ProfileRepository {
  loadProfile(userId: string): Promise<UserProfileResponse>;
  loadProfileByUsername(username: string): Promise<UserProfileResponse>;
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
    const path = `/api/profiles/${encodeURIComponent(userId)}`;
    return loadWithStaleWhileRevalidate(`profile:${this.baseUrl}${path}`, () => this.request<UserProfileResponse>(path));
  }

  async loadProfileByUsername(username: string): Promise<UserProfileResponse> {
    const path = `/api/profiles/by-username/${encodeURIComponent(username)}`;
    return loadWithStaleWhileRevalidate(`profile:${this.baseUrl}${path}`, () => this.request<UserProfileResponse>(path));
  }

  async updateMyProfile(body: UserProfileUpdateRequestBody): Promise<UserProfileUpdateResponse> {
    const response = await this.request<UserProfileUpdateResponse>('/api/profiles/me', {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    invalidateStaleWhileRevalidateCache('profile:');
    return response;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    if (init?.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    appendCryptopunkUnlockOverrideHeaders(headers);

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

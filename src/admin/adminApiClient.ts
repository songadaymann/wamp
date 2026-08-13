import { getApiBaseUrl } from '../api/baseUrl';

export interface AdminApiClient {
  request<T>(path: string, init?: RequestInit): Promise<T>;
}

export interface AdminResponseClient {
  request(path: string, init?: RequestInit): Promise<Response>;
}

export function createAdminResponseClient(getAdminKey: () => string): AdminResponseClient {
  return {
    request(path: string, init: RequestInit = {}): Promise<Response> {
      return fetch(`${getApiBaseUrl()}${path}`, {
        ...init,
        headers: {
          'x-admin-key': getAdminKey(),
          ...init.headers,
        },
      });
    },
  };
}

export function createAdminApiClient(getAdminKey: () => string): AdminApiClient {
  return {
    async request<T>(path: string, init: RequestInit = {}): Promise<T> {
      const response = await fetch(`${getApiBaseUrl()}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          'x-admin-key': getAdminKey(),
          ...init.headers,
        },
      });

      if (!response.ok) {
        const text = (await response.text()).trim();
        if (response.status === 403) throw new Error('Invalid admin key.');
        throw new Error(text || `Request failed with status ${response.status}.`);
      }

      return response.json() as Promise<T>;
    },
  };
}

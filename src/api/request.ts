import { getApiBaseUrl } from './baseUrl';
import { readApiErrorMessage } from './readApiErrorMessage';
import { fetchWithPageReadLifetime } from './pageReadLifetime';

/** A non-2xx API response; the message is the server's plain `error` text. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiRequestInit extends RequestInit {
  baseUrl?: string;
  prepareHeaders?: (headers: Headers) => void;
}

export async function apiRequest<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const { baseUrl = getApiBaseUrl(), prepareHeaders, ...requestInit } = init;
  const headers = new Headers(requestInit.headers);
  prepareHeaders?.(headers);

  if (requestInit.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetchWithPageReadLifetime(`${baseUrl}${path}`, {
    ...requestInit,
    headers,
    credentials: requestInit.credentials ?? 'include',
  });

  return parseJsonApiResponse<T>(response);
}

async function parseJsonApiResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new ApiError(
      await readApiErrorMessage(response, `Request failed with status ${response.status}.`),
      response.status,
    );
  }

  return (await response.json()) as T;
}

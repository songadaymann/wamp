import { getApiBaseUrl } from './baseUrl';

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

  const response = await fetch(`${baseUrl}${path}`, {
    ...requestInit,
    headers,
    credentials: 'include',
  });

  return parseJsonApiResponse<T>(response);
}

export async function parseJsonApiResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response));
  }

  return (await response.json()) as T;
}

export async function readApiErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  return text || `Request failed with status ${response.status}.`;
}

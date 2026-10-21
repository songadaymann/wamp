import { getApiBaseUrl } from '../api/baseUrl';
import { readApiErrorMessage } from '../api/readApiErrorMessage';
import type { CollectionAttribution, CollectionShelfResponse } from './model';

export async function collectionRead<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, { credentials: 'include', signal });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, 'Could not load collection.'));
  return response.json() as Promise<T>;
}
export function loadCollectorRows(targetIds: string[], signal: AbortSignal): Promise<{ results: CollectionAttribution[] }> {
  const query = new URLSearchParams();
  targetIds.forEach(id => query.append('target', id));
  return collectionRead(`/api/collections/attribution?${query}`, signal);
}
export function loadProfileCollection(userId: string, cursor: string | undefined, signal: AbortSignal): Promise<CollectionShelfResponse> {
  const query = new URLSearchParams({ limit: '24' });
  if (cursor) query.set('cursor', cursor);
  return collectionRead(`/api/profiles/${encodeURIComponent(userId)}/collection?${query}`, signal);
}

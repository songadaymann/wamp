import { readApiErrorMessage } from '../api/readApiErrorMessage';
import { getApiBaseUrl } from '../api/baseUrl';

const ADMIN_KEY_STORAGE_KEY = 'ep_launch_admin_api_key';

export interface FeaturedRoomMutationResponse {
  ok: true;
  roomId: string;
  roomVersion: number;
  featured: boolean;
  featuredAt: string | null;
}

export function loadFeaturedRoomsAdminKey(
  storage: Storage = window.sessionStorage,
): string | null {
  const value = storage.getItem(ADMIN_KEY_STORAGE_KEY)?.trim() ?? '';
  return value ? value : null;
}

export function hasFeaturedRoomsAdminKey(
  storage: Storage = window.sessionStorage,
): boolean {
  return loadFeaturedRoomsAdminKey(storage) !== null;
}

export async function setFeaturedRoomStatus(
  roomId: string,
  body: { roomVersion: number; featured: boolean },
  options: {
    storage?: Storage;
    baseUrl?: string;
  } = {},
): Promise<FeaturedRoomMutationResponse> {
  const adminKey = loadFeaturedRoomsAdminKey(options.storage);
  if (!adminKey) {
    throw new Error('Missing admin key for featured room changes.');
  }

  const response = await fetch(`${options.baseUrl ?? getApiBaseUrl()}/api/admin/rooms/${encodeURIComponent(roomId)}/feature`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-key': adminKey,
    },
    credentials: 'include',
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const message = await readApiErrorMessage(response, `Featured room request failed with status ${response.status}.`);

    throw new Error(message);
  }

  return (await response.json()) as FeaturedRoomMutationResponse;
}

import { getApiBaseUrl } from '../api/baseUrl';
import { apiRequest } from '../api/request';
import type {
  RoomPlaylistCreateRequestBody,
  RoomPlaylistItemCreateRequestBody,
  RoomPlaylistListResponse,
  RoomPlaylistResponse,
  RoomPlaylistUpdateRequestBody,
} from './model';

export interface PlaylistRepository {
  loadPlaylistBySlug(slug: string): Promise<RoomPlaylistResponse>;
  loadMyPlaylists(): Promise<RoomPlaylistListResponse>;
  createPlaylist(body: RoomPlaylistCreateRequestBody): Promise<RoomPlaylistResponse>;
  updatePlaylist(playlistId: string, body: RoomPlaylistUpdateRequestBody): Promise<RoomPlaylistResponse>;
  deletePlaylist(playlistId: string): Promise<void>;
  addPlaylistItem(
    playlistId: string,
    body: RoomPlaylistItemCreateRequestBody,
  ): Promise<RoomPlaylistResponse>;
  removePlaylistItem(playlistId: string, itemId: string): Promise<RoomPlaylistResponse>;
}

class ApiPlaylistRepository implements PlaylistRepository {
  constructor(private readonly baseUrl: string) {}

  loadPlaylistBySlug(slug: string): Promise<RoomPlaylistResponse> {
    return apiRequest<RoomPlaylistResponse>(
      `/api/playlists/by-slug/${encodeURIComponent(slug)}`,
      { baseUrl: this.baseUrl },
    );
  }

  loadMyPlaylists(): Promise<RoomPlaylistListResponse> {
    return apiRequest<RoomPlaylistListResponse>('/api/playlists/me', {
      baseUrl: this.baseUrl,
    });
  }

  createPlaylist(body: RoomPlaylistCreateRequestBody): Promise<RoomPlaylistResponse> {
    return apiRequest<RoomPlaylistResponse>('/api/playlists', {
      baseUrl: this.baseUrl,
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  updatePlaylist(playlistId: string, body: RoomPlaylistUpdateRequestBody): Promise<RoomPlaylistResponse> {
    return apiRequest<RoomPlaylistResponse>(`/api/playlists/${encodeURIComponent(playlistId)}`, {
      baseUrl: this.baseUrl,
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  async deletePlaylist(playlistId: string): Promise<void> {
    await apiRequest<void>(`/api/playlists/${encodeURIComponent(playlistId)}`, {
      baseUrl: this.baseUrl,
      method: 'DELETE',
    });
  }

  addPlaylistItem(
    playlistId: string,
    body: RoomPlaylistItemCreateRequestBody,
  ): Promise<RoomPlaylistResponse> {
    return apiRequest<RoomPlaylistResponse>(
      `/api/playlists/${encodeURIComponent(playlistId)}/items`,
      {
        baseUrl: this.baseUrl,
        method: 'POST',
        body: JSON.stringify(body),
      },
    );
  }

  removePlaylistItem(playlistId: string, itemId: string): Promise<RoomPlaylistResponse> {
    return apiRequest<RoomPlaylistResponse>(
      `/api/playlists/${encodeURIComponent(playlistId)}/items/${encodeURIComponent(itemId)}`,
      {
        baseUrl: this.baseUrl,
        method: 'DELETE',
      },
    );
  }
}

export function createPlaylistRepository(): PlaylistRepository {
  return new ApiPlaylistRepository(getApiBaseUrl());
}

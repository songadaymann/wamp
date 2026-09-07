import { getApiBaseUrl } from '../../api/baseUrl';
import type {
  MyWorldsResponse,
  WorldDetail,
  WorldMembership,
  WorldNameRequest,
  WorldPublicationRequest,
  WorldSettings,
  WorldSummary,
} from '../../worlds/model';

export class WorldsRepository {
  private readonly baseUrl = getApiBaseUrl();

  list(): Promise<{ worlds: WorldSummary[] }> {
    return this.request('/api/worlds');
  }

  mine(): Promise<MyWorldsResponse> {
    return this.request('/api/worlds/me');
  }

  byNumber(number: number): Promise<WorldDetail> {
    return this.request(`/api/worlds/number/${number}`);
  }

  updateSettings(worldId: string, settings: WorldSettings): Promise<WorldDetail> {
    return this.request(`/api/worlds/${encodeURIComponent(worldId)}/settings`, {
      method: 'PATCH',
      body: JSON.stringify(settings),
    });
  }

  members(worldId: string): Promise<{ members: WorldMembership[] }> {
    return this.request(`/api/worlds/${encodeURIComponent(worldId)}/members`);
  }

  invite(worldId: string, email: string): Promise<{ member: WorldMembership }> {
    return this.request(`/api/worlds/${encodeURIComponent(worldId)}/invitations`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  acceptInvitation(worldId: string): Promise<{ member: WorldMembership }> {
    return this.request(`/api/worlds/${encodeURIComponent(worldId)}/invitations/accept`, { method: 'POST' });
  }

  requestMembership(worldId: string): Promise<{ member: WorldMembership }> {
    return this.request(`/api/worlds/${encodeURIComponent(worldId)}/join-requests`, { method: 'POST' });
  }

  recordWarp(worldId: string): Promise<{ ok: true }> {
    return this.request(`/api/worlds/${encodeURIComponent(worldId)}/warp`, { method: 'POST' });
  }

  changeMember(worldId: string, memberId: string, action: string): Promise<{ member: WorldMembership }> {
    return this.request(`/api/worlds/${encodeURIComponent(worldId)}/members/${encodeURIComponent(memberId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ action }),
    });
  }

  publications(worldId: string): Promise<{ requests: WorldPublicationRequest[] }> {
    return this.request(`/api/worlds/${encodeURIComponent(worldId)}/publication-requests`);
  }

  resolvePublication(
    worldId: string,
    requestId: string,
    decision: 'approve' | 'reject',
    rejectionReason: string | null = null,
  ): Promise<{ request: WorldPublicationRequest }> {
    return this.request(
      `/api/worlds/${encodeURIComponent(worldId)}/publication-requests/${encodeURIComponent(requestId)}`,
      { method: 'PATCH', body: JSON.stringify({ decision, rejectionReason }) },
    );
  }

  requestName(worldId: string, proposedName: string): Promise<{ request: WorldNameRequest }> {
    return this.request(`/api/worlds/${encodeURIComponent(worldId)}/name-requests`, {
      method: 'POST',
      body: JSON.stringify({ proposedName }),
    });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body) headers.set('Content-Type', 'application/json');
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers, credentials: 'include' });
    if (!response.ok) {
      const body = await response.text();
      let message = body || `World request failed with status ${response.status}.`;
      try {
        const parsed = JSON.parse(body) as { error?: unknown };
        if (typeof parsed.error === 'string') message = parsed.error;
      } catch {
        // Keep the text response.
      }
      throw new WorldsApiError(message, response.status);
    }
    return response.json() as Promise<T>;
  }
}

export class WorldsApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'WorldsApiError';
  }
}

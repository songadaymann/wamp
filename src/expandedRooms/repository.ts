import { getApiBaseUrl } from '../api/baseUrl';
import type { RoomCoordinates } from '../persistence/roomModel';
import type { ResolvedExpandedRoomTarget } from './model';
import type {
  ExpandedRoomLeaderboardResponse,
  ExpandedRoomProgressRatingRequestBody,
  ExpandedRoomProgressRatingResponse,
  ExpandedRoomRunFinishRequestBody,
  ExpandedRoomRunStartRequestBody,
  ExpandedRoomRunStartResponse,
} from './runModel';
import {
  appendPlayfunRequestHeaders,
  notifyPlayfunEligibleActionSuccess,
} from '../playfun/client';
import { filterCourseLeaderboardForCurrentSurface } from '../playfun/leaderboards';

export interface ExpandedRoomRepository {
  loadExpandedRoom(expandedRoomId: string): Promise<ResolvedExpandedRoomTarget>;
  loadExpandedRoomByCoordinate(coordinates: RoomCoordinates): Promise<ResolvedExpandedRoomTarget>;
  startRun(
    expandedRoomId: string,
    body: ExpandedRoomRunStartRequestBody,
  ): Promise<ExpandedRoomRunStartResponse>;
  finishRun(attemptId: string, body: ExpandedRoomRunFinishRequestBody): Promise<void>;
  loadExpandedRoomLeaderboard(
    expandedRoomId: string,
    version?: number | null,
    limit?: number,
  ): Promise<ExpandedRoomLeaderboardResponse>;
  submitExpandedRoomRating(
    expandedRoomId: string,
    body: ExpandedRoomProgressRatingRequestBody,
  ): Promise<ExpandedRoomProgressRatingResponse>;
}

class ExpandedRoomApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

class ApiExpandedRoomRepository implements ExpandedRoomRepository {
  constructor(private readonly baseUrl: string) {}

  loadExpandedRoom(expandedRoomId: string): Promise<ResolvedExpandedRoomTarget> {
    return this.request<ResolvedExpandedRoomTarget>(
      `/api/expanded-rooms/${encodeURIComponent(expandedRoomId)}`
    );
  }

  loadExpandedRoomByCoordinate(coordinates: RoomCoordinates): Promise<ResolvedExpandedRoomTarget> {
    return this.request<ResolvedExpandedRoomTarget>(
      `/api/expanded-rooms/by-coordinate/${encodeURIComponent(String(coordinates.x))}/${encodeURIComponent(String(coordinates.y))}`,
    );
  }

  async startRun(
    expandedRoomId: string,
    body: ExpandedRoomRunStartRequestBody,
  ): Promise<ExpandedRoomRunStartResponse> {
    return this.request<ExpandedRoomRunStartResponse>(
      `/api/expanded-rooms/${encodeURIComponent(expandedRoomId)}/runs/start`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    );
  }

  async finishRun(
    attemptId: string,
    body: ExpandedRoomRunFinishRequestBody,
  ): Promise<void> {
    await this.request(`/api/expanded-room-runs/${encodeURIComponent(attemptId)}/finish`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    notifyPlayfunEligibleActionSuccess();
  }

  async loadExpandedRoomLeaderboard(
    expandedRoomId: string,
    version: number | null = null,
    limit: number = 10,
  ): Promise<ExpandedRoomLeaderboardResponse> {
    const params = new URLSearchParams({
      limit: String(limit),
    });

    if (typeof version === 'number' && Number.isInteger(version) && version > 0) {
      params.set('version', String(version));
    }

    const response = await this.request<ExpandedRoomLeaderboardResponse>(
      `/api/leaderboards/expanded-rooms/${encodeURIComponent(expandedRoomId)}?${params.toString()}`,
    );
    return filterCourseLeaderboardForCurrentSurface(response) as ExpandedRoomLeaderboardResponse;
  }

  async submitExpandedRoomRating(
    expandedRoomId: string,
    body: ExpandedRoomProgressRatingRequestBody,
  ): Promise<ExpandedRoomProgressRatingResponse> {
    return this.request<ExpandedRoomProgressRatingResponse>(
      `/api/expanded-rooms/${encodeURIComponent(expandedRoomId)}/ratings`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    );
  }

  private async request<T = void>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    appendPlayfunRequestHeaders(headers);

    if (init?.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      credentials: 'include',
    });

    if (!response.ok) {
      const details = await response.text();
      let message = details || `Expanded room API request failed with status ${response.status}.`;
      if (details) {
        try {
          const parsed = JSON.parse(details) as { error?: unknown };
          if (typeof parsed.error === 'string' && parsed.error.trim()) {
            message = parsed.error;
          }
        } catch {
          message = details;
        }
      }
      throw new ExpandedRoomApiError(message, response.status);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }
}

export function createExpandedRoomRepository(): ExpandedRoomRepository {
  return new ApiExpandedRoomRepository(getApiBaseUrl());
}

export function isExpandedRoomApiError(error: unknown): error is ExpandedRoomApiError {
  return error instanceof ExpandedRoomApiError;
}

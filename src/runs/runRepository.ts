import type { RoomCoordinates } from '../persistence/roomModel';
import { getApiBaseUrl } from '../api/baseUrl';
import type {
  GlobalLeaderboardResponse,
  RoomLeaderboardResponse,
  RunFinishRequestBody,
  RunStartRequestBody,
  RunStartResponse,
} from './model';
import {
  appendPlayfunRequestHeaders,
  notifyPlayfunEligibleActionSuccess,
} from '../playfun/client';

export interface RunRepository {
  startRun(body: RunStartRequestBody): Promise<RunStartResponse>;
  finishRun(attemptId: string, body: RunFinishRequestBody): Promise<void>;
  loadRoomLeaderboard(
    roomId: string,
    coordinates: RoomCoordinates,
    version?: number | null,
    limit?: number
  ): Promise<RoomLeaderboardResponse>;
  loadGlobalLeaderboard(limit?: number): Promise<GlobalLeaderboardResponse>;
}

class RunApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

class ApiRunRepository implements RunRepository {
  constructor(private readonly baseUrl: string) {}

  async startRun(body: RunStartRequestBody): Promise<RunStartResponse> {
    return this.request<RunStartResponse>('/api/runs/start', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async finishRun(attemptId: string, body: RunFinishRequestBody): Promise<void> {
    const headers = new Headers();
    appendPlayfunRequestHeaders(headers);
    await this.request(`/api/runs/${encodeURIComponent(attemptId)}/finish`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    notifyPlayfunEligibleActionSuccess();
  }

  async loadRoomLeaderboard(
    roomId: string,
    coordinates: RoomCoordinates,
    version: number | null = null,
    limit: number = 10
  ): Promise<RoomLeaderboardResponse> {
    const params = new URLSearchParams({
      x: String(coordinates.x),
      y: String(coordinates.y),
      limit: String(limit),
    });

    if (typeof version === 'number' && Number.isInteger(version) && version > 0) {
      params.set('version', String(version));
    }

    return this.request<RoomLeaderboardResponse>(
      `/api/leaderboards/rooms/${encodeURIComponent(roomId)}?${params.toString()}`
    );
  }

  async loadGlobalLeaderboard(limit: number = 10): Promise<GlobalLeaderboardResponse> {
    const params = new URLSearchParams({
      limit: String(limit),
    });

    return this.request<GlobalLeaderboardResponse>(`/api/leaderboards/global?${params.toString()}`);
  }

  private async request<T = void>(path: string, init?: RequestInit): Promise<T> {
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
      let message = `Run API request failed with status ${response.status}.`;
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

      throw new RunApiError(message, response.status);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }
}

export function createRunRepository(): RunRepository {
  return new ApiRunRepository(getApiBaseUrl());
}

export function isRunApiError(value: unknown): value is RunApiError {
  return value instanceof RunApiError;
}

import type { RoomCoordinates } from '../persistence/roomModel';
import { getApiBaseUrl } from '../api/baseUrl';
import {
  invalidateStaleWhileRevalidateCache,
  loadWithStaleWhileRevalidate,
} from '../api/staleWhileRevalidateCache';
import type {
  BuilderDiscoveryResponse,
  BuilderDiscoverySort,
  GlobalLeaderboardResponse,
  RoomDifficulty,
  RoomDiscoveryResponse,
  RoomDiscoverySort,
  RoomLeaderboardResponse,
  RoomDifficultyVoteRequestBody,
  RoomProgressRatingRequestBody,
  RoomProgressRatingResponse,
  RoomRushLeaderboardsResponse,
  RoomRushRunStartRequestBody,
  RoomRushRunStartResponse,
  RoomRushRunSubmissionRequestBody,
  RoomRushRunSubmissionResponse,
  RunFinishRequestBody,
  RunStartRequestBody,
  RunStartResponse,
} from './model';
import {
  filterGlobalLeaderboardForCurrentSurface,
  filterRoomLeaderboardForCurrentSurface,
} from '../generatedUsers/leaderboards';

export interface RunRepository {
  startRun(body: RunStartRequestBody): Promise<RunStartResponse>;
  finishRun(attemptId: string, body: RunFinishRequestBody): Promise<void>;
  loadRoomLeaderboard(
    roomId: string,
    coordinates: RoomCoordinates,
    version?: number | null,
    limit?: number,
    cacheAsCurrent?: boolean,
  ): Promise<RoomLeaderboardResponse>;
  submitRoomDifficultyVote(roomId: string, body: RoomDifficultyVoteRequestBody): Promise<void>;
  submitRoomRating(roomId: string, body: RoomProgressRatingRequestBody): Promise<RoomProgressRatingResponse>;
  startRoomRushRun(body: RoomRushRunStartRequestBody): Promise<RoomRushRunStartResponse>;
  submitRoomRushRun(body: RoomRushRunSubmissionRequestBody): Promise<RoomRushRunSubmissionResponse>;
  loadRoomRushLeaderboards(
    limit?: number,
    modeKey?: RoomRushLeaderboardsResponse['modes'][number]['modeKey']
  ): Promise<RoomRushLeaderboardsResponse>;
  loadRoomDiscovery(
    difficulty: RoomDifficulty | null,
    sort?: RoomDiscoverySort,
    limit?: number,
    includeGoalLessRooms?: boolean,
    cursor?: string | null,
  ): Promise<RoomDiscoveryResponse>;
  loadBuilderDiscovery(
    sort?: BuilderDiscoverySort,
    limit?: number
  ): Promise<BuilderDiscoveryResponse>;
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
    await this.request(`/api/runs/${encodeURIComponent(attemptId)}/finish`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    this.invalidateLeaderboards();
  }

  async loadRoomLeaderboard(
    roomId: string,
    coordinates: RoomCoordinates,
    version: number | null = null,
    limit: number = 10,
    cacheAsCurrent: boolean = false,
  ): Promise<RoomLeaderboardResponse> {
    const params = new URLSearchParams({
      x: String(coordinates.x),
      y: String(coordinates.y),
      limit: String(limit),
    });

    if (typeof version === 'number' && Number.isInteger(version) && version > 0) {
      params.set('version', String(version));
    }

    const path = `/api/leaderboards/rooms/${encodeURIComponent(roomId)}?${params.toString()}`;
    const cacheKey = cacheAsCurrent || version === null
      ? this.currentRoomLeaderboardCacheKey(roomId, coordinates, limit)
      : this.leaderboardCacheKey(path);
    const response = await loadWithStaleWhileRevalidate(
      cacheKey,
      () => this.request<RoomLeaderboardResponse>(path),
    );
    return filterRoomLeaderboardForCurrentSurface(response);
  }

  async submitRoomDifficultyVote(
    roomId: string,
    body: RoomDifficultyVoteRequestBody
  ): Promise<void> {
    await this.request(`/api/leaderboards/rooms/${encodeURIComponent(roomId)}/difficulty-vote`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    this.invalidateLeaderboards();
  }

  async submitRoomRating(
    roomId: string,
    body: RoomProgressRatingRequestBody
  ): Promise<RoomProgressRatingResponse> {
    const response = await this.request<RoomProgressRatingResponse>(`/api/rooms/${encodeURIComponent(roomId)}/ratings`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    this.invalidateLeaderboards();
    return response;
  }

  async startRoomRushRun(
    body: RoomRushRunStartRequestBody
  ): Promise<RoomRushRunStartResponse> {
    return this.request<RoomRushRunStartResponse>('/api/room-rush/runs/start', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async submitRoomRushRun(
    body: RoomRushRunSubmissionRequestBody
  ): Promise<RoomRushRunSubmissionResponse> {
    const response = await this.request<RoomRushRunSubmissionResponse>('/api/room-rush/runs', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    this.invalidateLeaderboards();
    return response;
  }

  async loadRoomRushLeaderboards(
    limit: number = 25,
    modeKey?: RoomRushLeaderboardsResponse['modes'][number]['modeKey']
  ): Promise<RoomRushLeaderboardsResponse> {
    const params = new URLSearchParams({
      limit: String(limit),
    });
    if (modeKey) {
      params.set('mode', modeKey);
    }

    const path = `/api/leaderboards/room-rush?${params.toString()}`;
    return loadWithStaleWhileRevalidate(
      this.leaderboardCacheKey(path),
      () => this.request<RoomRushLeaderboardsResponse>(path),
    );
  }

  async loadRoomDiscovery(
    difficulty: RoomDifficulty | null,
    sort: RoomDiscoverySort = 'featured',
    limit: number = 100,
    includeGoalLessRooms: boolean = false,
    cursor: string | null = null,
  ): Promise<RoomDiscoveryResponse> {
    const params = new URLSearchParams({
      limit: String(limit),
      sort,
    });
    if (difficulty) {
      params.set('difficulty', difficulty);
    }
    if (includeGoalLessRooms) {
      params.set('includeGoalLessRooms', '1');
    }
    if (cursor) {
      params.set('cursor', cursor);
    }

    const path = `/api/leaderboards/rooms/discover?${params.toString()}`;
    return loadWithStaleWhileRevalidate(
      `discovery:${this.baseUrl}${path}`,
      () => this.request<RoomDiscoveryResponse>(path),
    );
  }

  async loadBuilderDiscovery(
    sort: BuilderDiscoverySort = 'alphabet',
    limit: number = 100
  ): Promise<BuilderDiscoveryResponse> {
    const params = new URLSearchParams({
      limit: String(limit),
      sort,
    });

    return this.request<BuilderDiscoveryResponse>(
      `/api/leaderboards/builders/discover?${params.toString()}`
    );
  }

  async loadGlobalLeaderboard(limit: number = 10): Promise<GlobalLeaderboardResponse> {
    const params = new URLSearchParams({
      limit: String(limit),
    });

    const path = `/api/leaderboards/global?${params.toString()}`;
    const response = await loadWithStaleWhileRevalidate(
      this.leaderboardCacheKey(path),
      () => this.request<GlobalLeaderboardResponse>(path),
    );
    return filterGlobalLeaderboardForCurrentSurface(response);
  }

  private leaderboardCacheKey(path: string): string {
    return `leaderboard:${this.baseUrl}${path}`;
  }

  private currentRoomLeaderboardCacheKey(
    roomId: string,
    coordinates: RoomCoordinates,
    limit: number,
  ): string {
    return `leaderboard:${this.baseUrl}:room-current:${roomId}:${coordinates.x},${coordinates.y}:${limit}`;
  }

  private invalidateLeaderboards(): void {
    invalidateStaleWhileRevalidateCache(`leaderboard:${this.baseUrl}`);
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

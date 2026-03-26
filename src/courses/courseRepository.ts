import { getApiBaseUrl } from '../api/baseUrl';
import {
  cloneCourseRecord,
  normalizeCourseRecord,
  type CourseRecord,
  type CourseSnapshot,
} from './model';
import type {
  CourseLeaderboardResponse,
  CourseRunFinishRequestBody,
  CourseRunStartRequestBody,
  CourseRunStartResponse,
} from './runModel';
import {
  appendPlayfunRequestHeaders,
  notifyPlayfunEligibleActionSuccess,
} from '../playfun/client';
import { filterCourseLeaderboardForCurrentSurface } from '../playfun/leaderboards';

export interface CourseRepository {
  createCourse(snapshot: CourseSnapshot): Promise<CourseRecord>;
  loadCourse(courseId: string): Promise<CourseRecord>;
  loadLatestDraftForRoom(roomId: string): Promise<CourseRecord | null>;
  saveDraft(snapshot: CourseSnapshot): Promise<CourseRecord>;
  publishCourse(courseId: string): Promise<CourseRecord>;
  unpublishCourse(courseId: string): Promise<CourseRecord>;
  startRun(courseId: string, body: CourseRunStartRequestBody): Promise<CourseRunStartResponse>;
  finishRun(attemptId: string, body: CourseRunFinishRequestBody): Promise<void>;
  loadCourseLeaderboard(
    courseId: string,
    version?: number | null,
    limit?: number
  ): Promise<CourseLeaderboardResponse>;
}

class CourseApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

class ApiCourseRepository implements CourseRepository {
  constructor(private readonly baseUrl: string) {}

  async createCourse(snapshot: CourseSnapshot): Promise<CourseRecord> {
    return this.request<CourseRecord>('/api/courses', {
      method: 'POST',
      body: JSON.stringify(snapshot),
    });
  }

  async loadCourse(courseId: string): Promise<CourseRecord> {
    return this.request<CourseRecord>(`/api/courses/${encodeURIComponent(courseId)}`);
  }

  async loadLatestDraftForRoom(roomId: string): Promise<CourseRecord | null> {
    try {
      return await this.request<CourseRecord>(
        `/api/courses/drafts/by-room/${encodeURIComponent(roomId)}`
      );
    } catch (error) {
      if (isCourseApiError(error) && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async saveDraft(snapshot: CourseSnapshot): Promise<CourseRecord> {
    return this.request<CourseRecord>(`/api/courses/${encodeURIComponent(snapshot.id)}/draft`, {
      method: 'PUT',
      body: JSON.stringify(snapshot),
    });
  }

  async publishCourse(courseId: string): Promise<CourseRecord> {
    const record = await this.request<CourseRecord>(`/api/courses/${encodeURIComponent(courseId)}/publish`, {
      method: 'POST',
    });
    notifyPlayfunEligibleActionSuccess();
    return record;
  }

  async unpublishCourse(courseId: string): Promise<CourseRecord> {
    return this.request<CourseRecord>(`/api/courses/${encodeURIComponent(courseId)}/unpublish`, {
      method: 'POST',
    });
  }

  async startRun(
    courseId: string,
    body: CourseRunStartRequestBody
  ): Promise<CourseRunStartResponse> {
    return this.request<CourseRunStartResponse>(`/api/courses/${encodeURIComponent(courseId)}/runs/start`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async finishRun(attemptId: string, body: CourseRunFinishRequestBody): Promise<void> {
    await this.request(`/api/course-runs/${encodeURIComponent(attemptId)}/finish`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    notifyPlayfunEligibleActionSuccess();
  }

  async loadCourseLeaderboard(
    courseId: string,
    version: number | null = null,
    limit: number = 10
  ): Promise<CourseLeaderboardResponse> {
    const params = new URLSearchParams({
      limit: String(limit),
    });

    if (typeof version === 'number' && Number.isInteger(version) && version > 0) {
      params.set('version', String(version));
    }

    const response = await this.request<CourseLeaderboardResponse>(
      `/api/leaderboards/courses/${encodeURIComponent(courseId)}?${params.toString()}`
    );
    return filterCourseLeaderboardForCurrentSurface(response);
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
      let message = details || `Course API request failed with status ${response.status}.`;
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
      throw new CourseApiError(message, response.status);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const data = (await response.json()) as T;
    if (Array.isArray(data) && data.every((entry) => isCourseRecordResponse(entry))) {
      return data.map((entry) =>
        cloneCourseRecord(normalizeCourseRecord(entry, entry.draft.id))
      ) as T;
    }

    if (isCourseRecordResponse(data)) {
      return cloneCourseRecord(normalizeCourseRecord(data, (data as CourseRecord).draft.id)) as T;
    }

    return data;
  }
}

function isCourseRecordResponse(value: unknown): value is CourseRecord {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'draft' in value &&
      'versions' in value &&
      'permissions' in value
  );
}

export function createCourseRepository(): CourseRepository {
  return new ApiCourseRepository(getApiBaseUrl());
}

export function isCourseApiError(error: unknown): error is CourseApiError {
  return error instanceof CourseApiError;
}

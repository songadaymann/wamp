import { getApiBaseUrl } from '../api/baseUrl';
import {
  cloneCourseRecord,
  normalizeCourseRecord,
  type CourseRecord,
  type CourseSnapshot,
} from '../courses/model';
import type { RoomCoordinates } from '../persistence/roomModel';
import {
  appendPlayfunRequestHeaders,
  notifyPlayfunEligibleActionSuccess,
} from '../playfun/client';
import { expandedRoomIdFromLegacyCourseId } from './model';

export interface ExpandedRoomEditorCellRequestBody {
  roomId?: string;
  coordinates?: RoomCoordinates;
  x?: number;
  y?: number;
  roomVersion?: number | null;
}

export interface ExpandedRoomEditorRepository {
  createExpandedRoom(snapshot: CourseSnapshot): Promise<CourseRecord>;
  loadExpandedRoomRecord(expandedRoomIdOrCourseId: string): Promise<CourseRecord>;
  loadLatestDraftForRoom(roomId: string): Promise<CourseRecord | null>;
  saveDraft(snapshot: CourseSnapshot): Promise<CourseRecord>;
  publishExpandedRoom(expandedRoomIdOrCourseId: string): Promise<CourseRecord>;
  unpublishExpandedRoom(expandedRoomIdOrCourseId: string): Promise<CourseRecord>;
  expandIntoCell(
    expandedRoomIdOrCourseId: string,
    body: ExpandedRoomEditorCellRequestBody,
  ): Promise<CourseRecord>;
  removeCell(expandedRoomIdOrCourseId: string, roomId: string): Promise<CourseRecord>;
}

class ExpandedRoomEditorApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

class ApiExpandedRoomEditorRepository implements ExpandedRoomEditorRepository {
  constructor(private readonly baseUrl: string) {}

  createExpandedRoom(snapshot: CourseSnapshot): Promise<CourseRecord> {
    return this.request<CourseRecord>('/api/expanded-rooms', {
      method: 'POST',
      body: JSON.stringify(snapshot),
    });
  }

  loadExpandedRoomRecord(expandedRoomIdOrCourseId: string): Promise<CourseRecord> {
    const expandedRoomId = normalizeEditableExpandedRoomId(expandedRoomIdOrCourseId);
    return this.request<CourseRecord>(
      `/api/expanded-rooms/${encodeURIComponent(expandedRoomId)}/editor-record`,
    );
  }

  async loadLatestDraftForRoom(roomId: string): Promise<CourseRecord | null> {
    try {
      return await this.request<CourseRecord>(
        `/api/expanded-rooms/drafts/by-room/${encodeURIComponent(roomId)}`,
      );
    } catch (error) {
      if (isExpandedRoomEditorApiError(error) && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  saveDraft(snapshot: CourseSnapshot): Promise<CourseRecord> {
    const expandedRoomId = expandedRoomEditorIdFromCourseId(snapshot.id);
    return this.request<CourseRecord>(`/api/expanded-rooms/${encodeURIComponent(expandedRoomId)}/draft`, {
      method: 'PUT',
      body: JSON.stringify(snapshot),
    });
  }

  async publishExpandedRoom(expandedRoomIdOrCourseId: string): Promise<CourseRecord> {
    const expandedRoomId = normalizeEditableExpandedRoomId(expandedRoomIdOrCourseId);
    const record = await this.request<CourseRecord>(
      `/api/expanded-rooms/${encodeURIComponent(expandedRoomId)}/publish`,
      {
        method: 'POST',
      },
    );
    notifyPlayfunEligibleActionSuccess();
    return record;
  }

  unpublishExpandedRoom(expandedRoomIdOrCourseId: string): Promise<CourseRecord> {
    const expandedRoomId = normalizeEditableExpandedRoomId(expandedRoomIdOrCourseId);
    return this.request<CourseRecord>(
      `/api/expanded-rooms/${encodeURIComponent(expandedRoomId)}/unpublish`,
      {
        method: 'POST',
      },
    );
  }

  expandIntoCell(
    expandedRoomIdOrCourseId: string,
    body: ExpandedRoomEditorCellRequestBody,
  ): Promise<CourseRecord> {
    const expandedRoomId = normalizeEditableExpandedRoomId(expandedRoomIdOrCourseId);
    return this.request<CourseRecord>(
      `/api/expanded-rooms/${encodeURIComponent(expandedRoomId)}/cells`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    );
  }

  removeCell(expandedRoomIdOrCourseId: string, roomId: string): Promise<CourseRecord> {
    const expandedRoomId = normalizeEditableExpandedRoomId(expandedRoomIdOrCourseId);
    return this.request<CourseRecord>(
      `/api/expanded-rooms/${encodeURIComponent(expandedRoomId)}/cells/${encodeURIComponent(roomId)}`,
      {
        method: 'DELETE',
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
      let message = details || `Expanded room editor request failed with status ${response.status}.`;
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
      throw new ExpandedRoomEditorApiError(message, response.status);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const data = (await response.json()) as T;
    if (isCourseRecordResponse(data)) {
      return cloneCourseRecord(normalizeCourseRecord(data, data.draft.id)) as T;
    }

    return data;
  }
}

export function createExpandedRoomEditorRepository(): ExpandedRoomEditorRepository {
  return new ApiExpandedRoomEditorRepository(getApiBaseUrl());
}

export function isExpandedRoomEditorApiError(
  error: unknown
): error is ExpandedRoomEditorApiError {
  return error instanceof ExpandedRoomEditorApiError;
}

function expandedRoomEditorIdFromCourseId(courseId: string): string {
  return expandedRoomIdFromLegacyCourseId(courseId);
}

function normalizeEditableExpandedRoomId(expandedRoomIdOrCourseId: string): string {
  if (
    expandedRoomIdOrCourseId.startsWith('course:') ||
    expandedRoomIdOrCourseId.startsWith('room:')
  ) {
    return expandedRoomIdOrCourseId;
  }
  return expandedRoomEditorIdFromCourseId(expandedRoomIdOrCourseId);
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

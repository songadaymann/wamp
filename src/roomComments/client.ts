import { apiRequest } from '../api/request';
import type { RoomCoordinates } from '../persistence/roomModel';
import type {
  BrowseRoomCommentSummaryResponse,
  RoomCommentCreateRequestBody,
  RoomCommentCreateResponse,
  RoomCommentListResponse,
} from './model';

const browseSummaryRequestsInFlight = new Map<string, Promise<BrowseRoomCommentSummaryResponse>>();

export function fetchRoomComments(
  roomId: string,
  coordinates: RoomCoordinates,
  roomVersion: number,
): Promise<RoomCommentListResponse> {
  const params = new URLSearchParams({
    x: String(coordinates.x),
    y: String(coordinates.y),
    version: String(roomVersion),
  });
  return apiRequest<RoomCommentListResponse>(
    `/api/rooms/${encodeURIComponent(roomId)}/comments?${params}`,
  );
}

export function fetchBrowseRoomCommentSummaries(
  roomIds: readonly string[],
): Promise<BrowseRoomCommentSummaryResponse> {
  const normalizedRoomIds = Array.from(new Set(roomIds)).sort((left, right) => left.localeCompare(right));
  const params = new URLSearchParams();
  for (const roomId of normalizedRoomIds) params.append('roomId', roomId);
  const path = `/api/rooms/comments/browse?${params}`;
  const existing = browseSummaryRequestsInFlight.get(path);
  if (existing) return existing;

  const request = apiRequest<BrowseRoomCommentSummaryResponse>(path).finally(() => {
    if (browseSummaryRequestsInFlight.get(path) === request) {
      browseSummaryRequestsInFlight.delete(path);
    }
  });
  browseSummaryRequestsInFlight.set(path, request);
  return request;
}

export function submitRoomComment(
  roomId: string,
  coordinates: RoomCoordinates,
  body: RoomCommentCreateRequestBody,
): Promise<RoomCommentCreateResponse> {
  const params = new URLSearchParams({
    x: String(coordinates.x),
    y: String(coordinates.y),
  });
  return apiRequest<RoomCommentCreateResponse>(
    `/api/rooms/${encodeURIComponent(roomId)}/comments?${params}`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
}

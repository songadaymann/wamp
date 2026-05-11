import { apiRequest } from '../api/request';
import type { RoomCoordinates } from '../persistence/roomModel';
import type {
  RoomCommentCreateRequestBody,
  RoomCommentCreateResponse,
  RoomCommentListResponse,
} from './model';

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

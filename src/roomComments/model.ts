import type { RoomCoordinates } from '../persistence/roomModel';

export const ROOM_COMMENT_MAX_LENGTH = 220;
export const ROOM_COMMENT_DEFAULT_LIMIT = 80;
export const ROOM_COMMENT_ADMIN_DEFAULT_LIMIT = 80;
export const ROOM_COMMENT_MAX_LIMIT = 120;
export const ROOM_COMMENT_BROWSE_MAX_ROOM_IDS = 128;
export const ROOM_COMMENT_BROWSE_COMMENT_LIMIT = 12;

export type RoomCommentStatus = 'pending_review' | 'approved' | 'rejected';

export interface RoomCommentPosition {
  x: number;
  y: number;
}

export interface RoomCommentRecord {
  id: string;
  roomId: string;
  roomVersion: number;
  roomCoordinates: RoomCoordinates;
  position: RoomCommentPosition;
  body: string;
  authorUserId: string;
  authorDisplayName: string;
  createdAt: string;
}

export interface RoomCommentAreaContext {
  expandedRoomId: string;
  expandedRoomVersion: number | null;
  title: string | null;
  anchorCoordinates: RoomCoordinates;
  focusedCoordinates: RoomCoordinates;
  cellCount: number;
}

export interface RoomCommentListResponse {
  comments: RoomCommentRecord[];
  commentArea: RoomCommentAreaContext | null;
}

export interface BrowseRoomCommentSummary {
  roomId: string;
  roomVersion: number;
  commentCount: number;
  comments: BrowseRoomCommentPreview[];
}

export interface BrowseRoomCommentPreview {
  id: string;
  body: string;
  authorDisplayName: string;
  createdAt: string;
}

export interface BrowseRoomCommentSummaryResponse {
  rooms: BrowseRoomCommentSummary[];
}

export interface RoomCommentCreateRequestBody {
  roomVersion: number;
  position: RoomCommentPosition;
  body: string;
}

export interface RoomCommentCreateResponse {
  comment: RoomCommentRecord;
  status: RoomCommentStatus;
  message: string;
  commentArea: RoomCommentAreaContext | null;
}

export interface AdminRoomCommentRecord extends RoomCommentRecord {
  authorEmail: string | null;
  builderUserId: string | null;
  builderDisplayName: string | null;
  builderEmail: string | null;
  roomTitle: string | null;
  status: RoomCommentStatus;
  reviewedAt: string | null;
  reviewedByLabel: string | null;
  reviewReason: string | null;
  notifiedAt: string | null;
  notificationError: string | null;
}

export interface AdminRoomCommentListResponse {
  comments: AdminRoomCommentRecord[];
}

export interface AdminRoomCommentReviewRequestBody {
  decision: 'approved' | 'rejected';
  reason?: string | null;
  operatorLabel?: string | null;
}

export interface AdminRoomCommentReviewResponse {
  ok: true;
  comment: AdminRoomCommentRecord;
  email: {
    attempted: boolean;
    sent: boolean;
    skippedReason: string | null;
    error: string | null;
  };
}

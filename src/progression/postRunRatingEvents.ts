import type { RoomCoordinates } from '../persistence/roomModel';
import type { ProgressionDifficulty } from './model';

export const POST_RUN_RATING_REQUEST_EVENT = 'post-run-rating-request';
export const POST_RUN_GUEST_CLAIM_REQUEST_EVENT = 'post-run-guest-claim-request';
export const POST_RUN_RATING_SUBMITTED_EVENT = 'post-run-rating-submitted';

interface BasePostRunRatingRequestDetail {
  contentType: 'room' | 'course' | 'expanded_room';
  contentId: string;
  contentTitle: string | null;
  version: number;
  previousViewerRank: number | null;
  suppressLeaderboardRewardStings?: boolean;
  elapsedMs: number;
  deaths: number;
  score: number | null;
  autoSuggestedDifficulty: ProgressionDifficulty;
}

export interface RoomPostRunRatingRequestDetail extends BasePostRunRatingRequestDetail {
  contentType: 'room';
  roomCoordinates: RoomCoordinates;
}

export interface CoursePostRunRatingRequestDetail extends BasePostRunRatingRequestDetail {
  contentType: 'course';
  expandedRoomId?: string | null;
}

export interface ExpandedRoomPostRunRatingRequestDetail extends BasePostRunRatingRequestDetail {
  contentType: 'expanded_room';
  expandedRoomId: string;
  legacyCourseId?: string | null;
}

export type PostRunRatingRequestDetail =
  | RoomPostRunRatingRequestDetail
  | CoursePostRunRatingRequestDetail
  | ExpandedRoomPostRunRatingRequestDetail;

export interface PostRunRatingSubmittedDetail {
  contentType: 'room' | 'course' | 'expanded_room';
  contentId: string;
  expandedRoomId?: string | null;
}

export function requestPostRunRating(detail: PostRunRatingRequestDetail): void {
  window.dispatchEvent(
    new CustomEvent<PostRunRatingRequestDetail>(POST_RUN_RATING_REQUEST_EVENT, {
      detail,
    })
  );
}

export function requestPostRunGuestClaim(detail: PostRunRatingRequestDetail): void {
  window.dispatchEvent(
    new CustomEvent<PostRunRatingRequestDetail>(POST_RUN_GUEST_CLAIM_REQUEST_EVENT, {
      detail,
    })
  );
}

export function notifyPostRunRatingSubmitted(detail: PostRunRatingSubmittedDetail): void {
  window.dispatchEvent(
    new CustomEvent<PostRunRatingSubmittedDetail>(POST_RUN_RATING_SUBMITTED_EVENT, {
      detail,
    })
  );
}

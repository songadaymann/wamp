import type { RunFinishRequestBody } from '../runs/model';

export type GuestRunContentType = 'room' | 'course' | 'expanded_room';
export interface GuestRunStartBody {
  clientRunId: string;
  contentType: GuestRunContentType;
  contentId: string;
  version: number;
}
export interface GuestRunStartResponse extends GuestRunStartBody {
  attemptId: string;
  startedAt: string;
  verificationSchemaVersion: number;
  verificationNonce: string;
  snapshotHash: string;
}
export interface GuestRunFinishResponse {
  attemptId: string;
  result: RunFinishRequestBody['result'];
  verificationStatus: 'passed' | 'failed' | 'timeout';
  verificationReason: string | null;
  saved: boolean;
}
export interface GuestRunClaimResponse {
  claimId: string;
  userId: string;
  clearsSaved: number;
  pxpAwarded: number;
  remainingClears: number;
}

export interface GuestRunSavedClear {
  attemptId: string;
  contentType: GuestRunContentType;
  contentId: string;
  contentTitle: string | null;
  version: number;
  completedAt: string;
  elapsedMs: number;
  deaths: number;
}
export interface GuestRunClearListResponse {
  clears: GuestRunSavedClear[];
  totalClears: number;
}

export interface GuestRunClaimedListResponse extends GuestRunClearListResponse { userId: string }

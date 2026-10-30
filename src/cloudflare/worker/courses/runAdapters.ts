import type { CourseLeaderboardEntry, CourseLeaderboardResponse, CourseProgressRatingResponse, CourseRunStartResponse } from '../../../courses/runModel';
import { expandedRoomIdFromLegacyCourseId } from '../../../expandedRooms/model';
import type { ExpandedRoomLeaderboardEntry, ExpandedRoomLeaderboardResponse, ExpandedRoomProgressRatingResponse, ExpandedRoomRunStartResponse } from '../../../expandedRooms/runModel';
import type { Env, WorkerExecutionContextLike } from '../core/types';
import { handleExpandedRoomLeaderboard, handleExpandedRoomRatingSubmit, handleExpandedRoomRunFinish, handleExpandedRoomRunStart } from '../expandedRooms/runRoutes';

// Old URLs keep their wire formats; all run accounting and validation lives in Expanded Rooms.
export function handleCourseRunStart(request: Request, env: Env, courseId: string): Promise<Response> {
  return mapJson<ExpandedRoomRunStartResponse, CourseRunStartResponse>(
    handleExpandedRoomRunStart(request, env, expandedRoomIdFromLegacyCourseId(courseId), courseId),
    ({ expandedRoomId: _id, expandedRoomVersion, legacyCourseId, ...body }) => ({
      ...body, courseId: legacyCourseId ?? courseId, courseVersion: expandedRoomVersion,
    }),
  );
}

export function handleCourseRunFinish(request: Request, env: Env, attemptId: string, context?: WorkerExecutionContextLike): Promise<Response> {
  return handleExpandedRoomRunFinish(request, env, attemptId, context, true);
}

export function handleCourseLeaderboard(request: Request, url: URL, env: Env, courseId: string): Promise<Response> {
  return mapJson<ExpandedRoomLeaderboardResponse, CourseLeaderboardResponse>(
    handleExpandedRoomLeaderboard(request, url, env, expandedRoomIdFromLegacyCourseId(courseId)),
    ({ expandedRoomId: _id, expandedRoomTitle: _title, expandedRoomVersion: _version, legacyCourseId: _legacy, entries, viewerBest, ...body }) => ({
      ...body, entries: entries.map(legacyEntry), viewerBest: viewerBest ? legacyEntry(viewerBest) : null,
    }),
  );
}

export function handleCourseRatingSubmit(request: Request, env: Env, courseId: string, context?: WorkerExecutionContextLike): Promise<Response> {
  return mapJson<ExpandedRoomProgressRatingResponse, CourseProgressRatingResponse>(
    handleExpandedRoomRatingSubmit(request, env, expandedRoomIdFromLegacyCourseId(courseId), context, true),
    ({ expandedRoomId: _id, expandedRoomVersion, legacyCourseId, ...body }) => ({
      ...body, courseId: legacyCourseId ?? courseId, courseVersion: expandedRoomVersion,
    }),
  );
}

function legacyEntry({ expandedRoomId: _id, expandedRoomVersion: _version, legacyCourseId: _legacy, ...entry }: ExpandedRoomLeaderboardEntry): CourseLeaderboardEntry {
  return entry;
}

async function mapJson<T, U>(pending: Promise<Response>, map: (body: T) => U): Promise<Response> {
  const response = await pending;
  if (!response.ok) return response;
  const body = await response.json() as T;
  const headers = new Headers(response.headers);
  headers.delete('Content-Length');
  return new Response(JSON.stringify(map(body)), { status: response.status, headers });
}

import type { CourseGoalType } from '../../../courses/model';
import { isRoomMinted } from '../../../persistence/roomModel';
import {
  computeWorldChunkPreviewHash,
  computeWorldChunkWindow,
  computeWorldWindow,
  getRoomBoundsForChunkBounds,
  type ClaimableFrontierRoomWindow,
  type WorldRoomSummary,
} from '../../../persistence/worldModel';
import { HttpError, jsonResponse, parseIntegerQueryParam, parseWorldChunkBounds } from '../core/http';
import type { Env, RequestAuth } from '../core/types';
import { loadPublishedCourseMembershipsInBounds } from '../courses/store';
import { getRoomClaimQuota, loadPublishedRoomsInBounds, loadRoomRecordForMutation } from '../rooms/store';

export async function handleWorldRequest(request: Request, url: URL, env: Env): Promise<Response> {
  const centerX = parseIntegerQueryParam(url.searchParams, 'centerX');
  const centerY = parseIntegerQueryParam(url.searchParams, 'centerY');
  const radius = parseIntegerQueryParam(url.searchParams, 'radius');

  if (radius < 0 || radius > 32) {
    throw new HttpError(400, 'Radius must be between 0 and 32.');
  }

  const publishedRooms = await loadPublishedRoomsInBounds(
    env,
    centerX - radius - 1,
    centerX + radius + 1,
    centerY - radius - 1,
    centerY + radius + 1
  );
  const memberships = await loadPublishedCourseMembershipsInBounds(
    env,
    centerX - radius - 1,
    centerX + radius + 1,
    centerY - radius - 1,
    centerY + radius + 1
  );
  const worldWindow = computeWorldWindow(publishedRooms, { x: centerX, y: centerY }, radius);
  applyCourseMemberships(worldWindow.rooms, memberships);

  return jsonResponse(request, worldWindow);
}

export async function handleWorldChunksRequest(
  request: Request,
  url: URL,
  env: Env
): Promise<Response> {
  const chunkBounds = parseWorldChunkBounds(url.searchParams);
  const roomBounds = getRoomBoundsForChunkBounds(chunkBounds);
  const publishedRooms = await loadPublishedRoomsInBounds(
    env,
    roomBounds.minX - 1,
    roomBounds.maxX + 1,
    roomBounds.minY - 1,
    roomBounds.maxY + 1
  );
  const memberships = await loadPublishedCourseMembershipsInBounds(
    env,
    roomBounds.minX - 1,
    roomBounds.maxX + 1,
    roomBounds.minY - 1,
    roomBounds.maxY + 1
  );
  const chunkWindow = computeWorldChunkWindow(publishedRooms, chunkBounds);
  for (const chunk of chunkWindow.chunks) {
    applyCourseMemberships(chunk.rooms, memberships);
    chunk.chunkPreviewHash = computeWorldChunkPreviewHash(chunk);
  }

  return jsonResponse(request, chunkWindow);
}

export async function handleClaimableFrontierRoomsRequest(
  request: Request,
  url: URL,
  env: Env,
  auth: RequestAuth
): Promise<Response> {
  const centerX = parseIntegerQueryParam(url.searchParams, 'centerX');
  const centerY = parseIntegerQueryParam(url.searchParams, 'centerY');
  const radius = parseIntegerQueryParam(url.searchParams, 'radius');

  if (radius < 0 || radius > 32) {
    throw new HttpError(400, 'Radius must be between 0 and 32.');
  }

  const quota = await getRoomClaimQuota(env, auth.user.id, auth.source);
  const publishedRooms = await loadPublishedRoomsInBounds(
    env,
    centerX - radius - 1,
    centerX + radius + 1,
    centerY - radius - 1,
    centerY + radius + 1
  );
  const worldWindow = computeWorldWindow(publishedRooms, { x: centerX, y: centerY }, radius);
  const frontierRooms = worldWindow.rooms.filter((room) => room.state === 'frontier');
  const claimableRooms =
    auth.isAdmin || quota.claimsRemainingToday === null || quota.claimsRemainingToday > 0
      ? await filterClaimableFrontierRooms(env, frontierRooms, auth)
      : [];

  const responseBody: ClaimableFrontierRoomWindow = {
    center: { x: centerX, y: centerY },
    radius,
    rooms: claimableRooms,
    roomDailyClaimLimit: quota.limit,
    roomClaimsUsedToday: quota.claimsUsedToday,
    roomClaimsRemainingToday: quota.claimsRemainingToday,
  };

  return jsonResponse(request, responseBody);
}

async function filterClaimableFrontierRooms(
  env: Env,
  rooms: WorldRoomSummary[],
  auth: RequestAuth
) {
  const claimableRooms: WorldRoomSummary[] = [];
  for (const room of rooms) {
    if (room.state !== 'frontier') continue;
    const record = await loadRoomRecordForMutation(
      env,
      room.id,
      room.coordinates,
      auth.user,
      auth.isAdmin
    );
    if (record.published !== null) continue;
    if (record.claimerUserId !== null) continue;
    if (isRoomMinted(record)) continue;
    if (!record.permissions.canPublish) continue;
    claimableRooms.push(room);
  }

  return claimableRooms;
}

function applyCourseMemberships(
  rooms: Array<{
    id: string;
    course: {
      courseId: string;
      courseTitle: string | null;
      goalType: CourseGoalType | null;
      roomCount: number;
    } | null;
  }>,
  memberships: Array<{
    roomId: string;
    courseId: string;
    courseTitle: string | null;
    goalType: CourseGoalType | null;
    roomCount: number;
  }>
): void {
  const membershipsByRoomId = new Map(memberships.map((entry) => [entry.roomId, entry]));
  for (const room of rooms) {
    const membership = membershipsByRoomId.get(room.id);
    room.course = membership
        ? {
          courseId: membership.courseId,
          courseTitle: membership.courseTitle,
          goalType: membership.goalType,
          roomCount: membership.roomCount,
        }
      : null;
  }
}

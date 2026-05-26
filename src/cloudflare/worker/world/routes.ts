import type { CourseGoalType } from '../../../courses/model';
import {
  createExpandedRoomSummaryFromStandaloneRoom,
  type ExpandedRoomMembershipSummary,
  type ExpandedRoomCellMembership,
} from '../../../expandedRooms/model';
import type { RoomGoalType } from '../../../goals/roomGoals';
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
import { loadPublishedExpandedRoomMembershipsInBounds } from '../expandedRooms/store';
import {
  getRoomClaimQuota,
  loadClaimedUnpublishedRoomsInBounds,
  loadPublishedRoomsInBounds,
  loadRoomRecordForMutation,
} from '../rooms/store';

export async function handleWorldRequest(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response> {
  const centerX = parseIntegerQueryParam(url.searchParams, 'centerX');
  const centerY = parseIntegerQueryParam(url.searchParams, 'centerY');
  const radius = parseIntegerQueryParam(url.searchParams, 'radius');

  if (radius < 0 || radius > 32) {
    throw new HttpError(400, 'Radius must be between 0 and 32.');
  }

  const minX = centerX - radius - 1;
  const maxX = centerX + radius + 1;
  const minY = centerY - radius - 1;
  const maxY = centerY + radius + 1;
  const expandedRoomsEnabled = isExpandedRoomsEnabled(env);
  const [publishedRooms, claimedUnpublishedRooms, memberships] = await Promise.all([
    loadPublishedRoomsInBounds(env, minX, maxX, minY, maxY),
    loadClaimedUnpublishedRoomsInBounds(env, minX, maxX, minY, maxY),
    expandedRoomsEnabled
      ? loadPublishedExpandedRoomMembershipsInBounds(env, minX, maxX, minY, maxY)
      : loadPublishedCourseMembershipsInBounds(env, minX, maxX, minY, maxY),
  ]);
  const worldWindow = computeWorldWindow(
    [...publishedRooms, ...claimedUnpublishedRooms],
    { x: centerX, y: centerY },
    radius
  );
  if (expandedRoomsEnabled) {
    applyExpandedRoomMemberships(worldWindow.rooms, memberships as ExpandedRoomCellMembership[]);
  } else {
    applyLegacyCourseMemberships(worldWindow.rooms, memberships as LegacyCourseMembership[]);
  }

  return jsonResponse(request, worldWindow);
}

export async function handleWorldChunksRequest(
  request: Request,
  url: URL,
  env: Env
): Promise<Response> {
  const chunkBounds = parseWorldChunkBounds(url.searchParams);
  const roomBounds = getRoomBoundsForChunkBounds(chunkBounds);
  const minX = roomBounds.minX - 1;
  const maxX = roomBounds.maxX + 1;
  const minY = roomBounds.minY - 1;
  const maxY = roomBounds.maxY + 1;
  const expandedRoomsEnabled = isExpandedRoomsEnabled(env);
  const [publishedRooms, claimedUnpublishedRooms, memberships] = await Promise.all([
    loadPublishedRoomsInBounds(env, minX, maxX, minY, maxY),
    loadClaimedUnpublishedRoomsInBounds(env, minX, maxX, minY, maxY),
    expandedRoomsEnabled
      ? loadPublishedExpandedRoomMembershipsInBounds(env, minX, maxX, minY, maxY)
      : loadPublishedCourseMembershipsInBounds(env, minX, maxX, minY, maxY),
  ]);
  const chunkWindow = computeWorldChunkWindow(
    [...publishedRooms, ...claimedUnpublishedRooms],
    chunkBounds
  );
  for (const chunk of chunkWindow.chunks) {
    if (expandedRoomsEnabled) {
      applyExpandedRoomMemberships(chunk.rooms, memberships as ExpandedRoomCellMembership[]);
    } else {
      applyLegacyCourseMemberships(chunk.rooms, memberships as LegacyCourseMembership[]);
    }
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

type LegacyCourseMembership = {
  roomId: string;
  courseId: string;
  courseTitle: string | null;
  goalType: CourseGoalType | null;
  roomCount: number;
};

function applyLegacyCourseMemberships(
  rooms: Array<{
    id: string;
    course: {
      courseId: string;
      courseTitle: string | null;
      goalType: CourseGoalType | null;
      roomCount: number;
    } | null;
    expandedRoom: ExpandedRoomMembershipSummary | null;
  }>,
  memberships: LegacyCourseMembership[],
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
    room.expandedRoom = null;
  }
}

function applyExpandedRoomMemberships(
  rooms: Array<{
    id: string;
    title: string | null;
    state: string;
    goalType: RoomGoalType | null;
    course: {
      courseId: string;
      courseTitle: string | null;
      goalType: CourseGoalType | null;
      roomCount: number;
    } | null;
    expandedRoom: ExpandedRoomMembershipSummary | null;
  }>,
  memberships: ExpandedRoomCellMembership[],
): void {
  const membershipsByRoomId = new Map(memberships.map((entry) => [entry.roomId, entry]));
  for (const room of rooms) {
    const membership = membershipsByRoomId.get(room.id);
    room.course =
      membership?.legacyCourseId
        ? {
            courseId: membership.legacyCourseId,
            courseTitle: membership.title,
            goalType: membership.goalType as CourseGoalType | null,
            roomCount: membership.cellCount,
          }
        : null;
    room.expandedRoom = membership
      ? {
          expandedRoomId: membership.expandedRoomId,
          title: membership.title,
          goalType: membership.goalType,
          cellCount: membership.cellCount,
          source: membership.source,
          legacyCourseId: membership.legacyCourseId,
        }
      : room.state === 'published'
        ? createExpandedRoomSummaryFromStandaloneRoom({
            roomId: room.id,
            roomTitle: room.title,
            goalType: room.goalType,
          })
        : null;
  }
}

function isExpandedRoomsEnabled(env: Env): boolean {
  const raw = env.EXPANDED_ROOMS_ENABLED?.trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'off';
}

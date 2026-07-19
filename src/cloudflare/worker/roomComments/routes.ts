import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../../../config';
import {
  ROOM_COMMENT_BROWSE_COMMENT_LIMIT,
  ROOM_COMMENT_BROWSE_MAX_ROOM_IDS,
  ROOM_COMMENT_ADMIN_DEFAULT_LIMIT,
  ROOM_COMMENT_DEFAULT_LIMIT,
  ROOM_COMMENT_MAX_LENGTH,
  ROOM_COMMENT_MAX_LIMIT,
  type AdminRoomCommentListResponse,
  type BrowseRoomCommentSummaryResponse,
  type AdminRoomCommentReviewRequestBody,
  type AdminRoomCommentReviewResponse,
  type RoomCommentCreateRequestBody,
  type RoomCommentCreateResponse,
  type RoomCommentRecord,
  type RoomCommentListResponse,
  type RoomCommentStatus,
} from '../../../roomComments/model';
import { parseRoomId } from '../../../persistence/roomModel';
import {
  buildAdminReviewUrl,
  buildPublicAppUrl,
  logAdminReviewNotificationFailure,
  sendAdminReviewNotificationEmail,
} from '../admin/reviewNotifications';
import {
  requireAdminRequest,
  requireAuthenticatedRequestAuth,
} from '../auth/request';
import { resolveChatModerationViewer } from '../chat/moderation';
import { assertNotSchoolRestricted } from '../school/restrictions';
import {
  getCoordinatesFromRequest,
  HttpError,
  jsonResponse,
  normalizePositiveInteger,
  parseJsonBody,
  parseOptionalPositiveIntegerQueryParam,
  parsePositiveIntegerQueryParam,
} from '../core/http';
import type { Env, WorkerExecutionContextLike } from '../core/types';
import { loadAnonymousPublicCache } from '../core/publicCache';
import { ServerTiming, timedJsonResponse } from '../core/serverTiming';
import { sendRoomCommentApprovedEmail } from './email';
import {
  countRecentRoomCommentsForUser,
  countRecentRoomCommentsForUserTarget,
  createRoomComment,
  getRoomCommentAreaContext,
  listAdminRoomComments,
  listApprovedRoomComments,
  listBrowseRoomCommentSummaries,
  loadAdminRoomComment,
  loadRoomCommentTarget,
  markRoomCommentNotificationError,
  markRoomCommentNotificationSent,
  reviewRoomComment,
  type RoomCommentTarget,
} from './store';

const ROOM_COMMENT_USER_MINUTE_LIMIT = 1;
const ROOM_COMMENT_USER_DAILY_LIMIT = 20;
const ROOM_COMMENT_USER_ROOM_DAILY_LIMIT = 3;

export function parseBrowseRoomCommentIds(searchParams: URLSearchParams): string[] {
  const rawRoomIds = searchParams.getAll('roomId');
  if (rawRoomIds.length === 0) {
    throw new HttpError(400, 'At least one roomId is required.');
  }
  if (rawRoomIds.length > ROOM_COMMENT_BROWSE_MAX_ROOM_IDS) {
    throw new HttpError(400, `At most ${ROOM_COMMENT_BROWSE_MAX_ROOM_IDS} roomIds may be requested.`);
  }

  const roomIds = new Set<string>();
  for (const rawRoomId of rawRoomIds) {
    const coordinates = parseRoomId(rawRoomId);
    if (
      !coordinates
      || !Number.isSafeInteger(coordinates.x)
      || !Number.isSafeInteger(coordinates.y)
      || `${coordinates.x},${coordinates.y}` !== rawRoomId
    ) {
      throw new HttpError(400, 'roomId must be a canonical signed coordinate pair.');
    }
    roomIds.add(rawRoomId);
  }
  return Array.from(roomIds).sort((left, right) => left.localeCompare(right));
}

export async function handleBrowseRoomCommentSummaries(
  request: Request,
  url: URL,
  env: Env,
  context?: WorkerExecutionContextLike,
): Promise<Response> {
  const roomIds = parseBrowseRoomCommentIds(url.searchParams);
  const timing = new ServerTiming();
  const loadResponse = async (): Promise<Response> => {
    const rooms = await timing.measure('comments_d1', () => listBrowseRoomCommentSummaries(
      env,
      roomIds,
      ROOM_COMMENT_BROWSE_COMMENT_LIMIT,
    ));
    timing.setDiagnostic('cache_policy', 'public-20');
    const response: BrowseRoomCommentSummaryResponse = { rooms };
    return timedJsonResponse(request, response, timing, {
      headers: { 'Cache-Control': 'public, max-age=20' },
    });
  };
  return loadAnonymousPublicCache(request, context, loadResponse);
}

export async function handleRoomCommentList(
  request: Request,
  url: URL,
  env: Env,
  roomId: string,
): Promise<Response> {
  const coordinates = getCoordinatesFromRequest(roomId, url.searchParams);
  const roomVersion = parseOptionalPositiveIntegerQueryParam(url.searchParams, 'version');
  const limit = parsePositiveIntegerQueryParam(
    url.searchParams,
    'limit',
    ROOM_COMMENT_DEFAULT_LIMIT,
    1,
    ROOM_COMMENT_MAX_LIMIT,
  );
  const target = await loadRoomCommentTarget(env, roomId, coordinates, roomVersion);
  if (!target) {
    throw new HttpError(404, 'Published room not found for comments.');
  }

  const response: RoomCommentListResponse = {
    comments: await listApprovedRoomComments(env, target, limit),
    commentArea: getRoomCommentAreaContext(target),
  };
  return jsonResponse(request, response);
}

export async function handleRoomCommentCreate(
  request: Request,
  url: URL,
  env: Env,
  roomId: string,
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(env, request, 'comment on rooms');
  assertNotSchoolRestricted(auth, 'comment on rooms');
  const viewer = await resolveChatModerationViewer(env, auth.user);
  if (viewer.banned) {
    throw new HttpError(403, 'You are banned from chat and comments.');
  }

  const coordinates = getCoordinatesFromRequest(roomId, url.searchParams);
  const body = await parseJsonBody<RoomCommentCreateRequestBody>(request);
  const roomVersion = normalizePositiveInteger(body.roomVersion, 'roomVersion');
  const target = await loadRoomCommentTarget(env, roomId, coordinates, roomVersion);
  if (!target) {
    throw new HttpError(409, 'Comments can only be left on the current published room version.');
  }

  const text = normalizeRoomCommentBody(body.body);
  const position = normalizeRoomCommentPosition(body.position);
  const now = new Date();
  await assertRoomCommentRateLimit(env, {
    userId: auth.user.id,
    target,
    nowMs: now.getTime(),
  });

  const comment = await createRoomComment(env, {
    target,
    localX: position.x,
    localY: position.y,
    body: text,
    authorUserId: auth.user.id,
    authorDisplayName: auth.user.displayName,
    ipHash: await hashRoomCommentIp(env, getRequestIp(request)),
    userAgent: normalizeHeaderValue(request.headers.get('User-Agent')),
    createdAt: now.toISOString(),
  });

  await sendRoomCommentAdminReviewNotification(request, env, comment, target);

  const response: RoomCommentCreateResponse = {
    comment,
    status: 'pending_review',
    message: 'Comment submitted for review.',
    commentArea: getRoomCommentAreaContext(target),
  };
  return jsonResponse(request, response, { status: 201 });
}

async function sendRoomCommentAdminReviewNotification(
  request: Request,
  env: Env,
  comment: RoomCommentRecord,
  target: RoomCommentTarget,
): Promise<void> {
  const roomLabel = getRoomCommentTargetLabel(target);
  const result = await sendAdminReviewNotificationEmail(env, {
    subject: `Comment needs approval: ${roomLabel}`,
    heading: 'New comment needs approval',
    intro: `${comment.authorDisplayName} submitted a comment on ${roomLabel}.`,
    details: [
      `Comment: ${comment.body}`,
      `Room: ${roomLabel}`,
      `Room link: ${buildPublicAppUrl(request, env, `/r/${target.coordinates.x}/${target.coordinates.y}`)}`,
      ...(target.areaScope ? [`Focused cell: ${target.coordinates.x},${target.coordinates.y}`] : []),
      `Submitted: ${comment.createdAt}`,
    ],
    actionUrl: buildAdminReviewUrl(request, env, '/launch-admin.html'),
    actionLabel: 'Open comment review queue',
  });
  logAdminReviewNotificationFailure(result, `room comment ${comment.id}`);
}

export async function handleAdminRoomCommentRequest(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response> {
  if (url.pathname === '/api/admin/room-comments' && request.method === 'GET') {
    requireAdminRequest(env, request, 'list room comments');
    const status = normalizeAdminCommentStatus(url.searchParams.get('status'));
    const limit = parsePositiveIntegerQueryParam(
      url.searchParams,
      'limit',
      ROOM_COMMENT_ADMIN_DEFAULT_LIMIT,
      1,
      ROOM_COMMENT_MAX_LIMIT,
    );
    const response: AdminRoomCommentListResponse = {
      comments: await listAdminRoomComments(env, status, limit),
    };
    return jsonResponse(request, response);
  }

  const reviewMatch = /^\/api\/admin\/room-comments\/([^/]+)\/review$/.exec(url.pathname);
  if (reviewMatch && request.method === 'POST') {
    return handleAdminRoomCommentReview(
      request,
      env,
      decodeURIComponent(reviewMatch[1]),
    );
  }

  throw new HttpError(404, 'Room comment admin route not found.');
}

async function handleAdminRoomCommentReview(
  request: Request,
  env: Env,
  commentId: string,
): Promise<Response> {
  requireAdminRequest(env, request, `review room comment ${commentId}`);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(commentId)) {
    throw new HttpError(400, 'Comment id is invalid.');
  }

  const existing = await loadAdminRoomComment(env, commentId);
  if (!existing) {
    throw new HttpError(404, 'Room comment not found.');
  }

  const body = await parseJsonBody<AdminRoomCommentReviewRequestBody>(request);
  const decision = body.decision === 'approved' || body.decision === 'rejected'
    ? body.decision
    : null;
  if (!decision) {
    throw new HttpError(400, 'decision must be approved or rejected.');
  }

  await reviewRoomComment(env, commentId, decision, {
    reviewedAt: new Date().toISOString(),
    reviewedByLabel: normalizeOptionalText(body.operatorLabel, 80) ?? 'Admin',
    reviewReason: normalizeOptionalText(body.reason, 500),
  });

  let reviewed = await loadAdminRoomComment(env, commentId);
  if (!reviewed) {
    throw new HttpError(500, 'Room comment disappeared after review.');
  }

  let email = {
    attempted: false,
    sent: false,
    skippedReason: null as string | null,
    error: null as string | null,
  };
  if (decision === 'approved' && !reviewed.notifiedAt) {
    email = await sendRoomCommentApprovedEmail(request, env, reviewed);
    if (email.sent) {
      await markRoomCommentNotificationSent(env, commentId, new Date().toISOString());
      reviewed = (await loadAdminRoomComment(env, commentId)) ?? reviewed;
    } else if (email.error) {
      await markRoomCommentNotificationError(env, commentId, email.error);
      reviewed = (await loadAdminRoomComment(env, commentId)) ?? reviewed;
    }
  }

  const response: AdminRoomCommentReviewResponse = {
    ok: true,
    comment: reviewed,
    email,
  };
  return jsonResponse(request, response);
}

function normalizeRoomCommentBody(value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'Comment is required.');
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    throw new HttpError(400, 'Comment is required.');
  }

  if (normalized.length > ROOM_COMMENT_MAX_LENGTH) {
    throw new HttpError(400, `Comment must be ${ROOM_COMMENT_MAX_LENGTH} characters or fewer.`);
  }

  if (/[<>]/.test(normalized)) {
    throw new HttpError(400, 'Comment cannot contain angle brackets.');
  }

  if (/(https?:\/\/|www\.)/i.test(normalized)) {
    throw new HttpError(400, 'Links are not allowed in room comments yet.');
  }

  return normalized;
}

function normalizeRoomCommentPosition(value: unknown): { x: number; y: number } {
  if (!value || typeof value !== 'object') {
    throw new HttpError(400, 'position is required.');
  }

  const position = value as { x?: unknown; y?: unknown };
  const x = Math.round(Number(position.x));
  const y = Math.round(Number(position.y));
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new HttpError(400, 'position must contain finite x and y values.');
  }

  return {
    x: Math.max(8, Math.min(ROOM_PX_WIDTH - 8, x)),
    y: Math.max(16, Math.min(ROOM_PX_HEIGHT - 8, y)),
  };
}

async function assertRoomCommentRateLimit(
  env: Env,
  input: {
    userId: string;
    target: RoomCommentTarget;
    nowMs: number;
  },
): Promise<void> {
  const minuteAgo = new Date(input.nowMs - 60 * 1000).toISOString();
  const recentMinute = await countRecentRoomCommentsForUser(env, input.userId, minuteAgo);
  if (recentMinute >= ROOM_COMMENT_USER_MINUTE_LIMIT) {
    throw new HttpError(429, 'Please wait a minute before commenting again.');
  }

  const dayAgo = new Date(input.nowMs - 24 * 60 * 60 * 1000).toISOString();
  const recentDay = await countRecentRoomCommentsForUser(env, input.userId, dayAgo);
  if (recentDay >= ROOM_COMMENT_USER_DAILY_LIMIT) {
    throw new HttpError(429, 'You have left enough comments for today.');
  }

  const recentRoomDay = await countRecentRoomCommentsForUserTarget(
    env,
    input.userId,
    input.target,
    dayAgo,
  );
  if (recentRoomDay >= ROOM_COMMENT_USER_ROOM_DAILY_LIMIT) {
    throw new HttpError(429, 'You have already commented on this room today.');
  }
}

function getRoomCommentTargetLabel(target: RoomCommentTarget): string {
  const areaTitle = target.areaScope?.title?.trim();
  if (areaTitle) {
    return `"${areaTitle}"`;
  }

  const roomTitle = target.roomTitle?.trim();
  if (roomTitle) {
    return `"${roomTitle}"`;
  }

  if (target.areaScope) {
    return `Expanded Room ${target.areaScope.anchorCoordinates.x},${target.areaScope.anchorCoordinates.y}`;
  }

  return `Room ${target.coordinates.x},${target.coordinates.y}`;
}

function normalizeAdminCommentStatus(value: string | null): RoomCommentStatus | 'all' {
  const normalized = value?.trim() || 'pending_review';
  if (
    normalized === 'pending_review' ||
    normalized === 'approved' ||
    normalized === 'rejected' ||
    normalized === 'all'
  ) {
    return normalized;
  }

  throw new HttpError(400, 'status must be pending_review, approved, rejected, or all.');
}

function normalizeOptionalText(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new HttpError(400, 'Optional text values must be strings.');
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function getRequestIp(request: Request): string | null {
  return normalizeHeaderValue(
    request.headers.get('CF-Connecting-IP')
    ?? request.headers.get('X-Forwarded-For')?.split(',')[0]
    ?? null,
  );
}

async function hashRoomCommentIp(env: Env, ip: string | null): Promise<string | null> {
  if (!ip) {
    return null;
  }

  const salt = env.GUESTBOOK_IP_HASH_SALT?.trim() || 'wamp-room-comments';
  const bytes = new TextEncoder().encode(`${salt}:room-comments:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function normalizeHeaderValue(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed ? trimmed.slice(0, 260) : null;
}

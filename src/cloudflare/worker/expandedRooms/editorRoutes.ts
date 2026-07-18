import {
  cloneCourseSnapshot,
  sortCourseRoomRefsForStorage,
  type CourseRecord,
  type CourseRoomRef,
  type CourseSnapshot,
} from '../../../courses/model';
import {
  expandedRoomIdFromLegacyCourseId,
  getExpandedRoomCellRemovalError,
  type ExpandedRoomFootprintCell,
} from '../../../expandedRooms/model';
import {
  isRoomMinted,
  parseRoomId,
  roomIdFromCoordinates,
  type RoomCoordinates,
} from '../../../persistence/roomModel';
import { requireAuthenticatedRequestAuth } from '../auth/request';
import { HttpError, jsonResponse, parseJsonBody } from '../core/http';
import type { Env, RequestAuth, WorkerExecutionContextLike } from '../core/types';
import {
  handleCoursePublish,
  handleCourseUnpublish,
} from '../courses/routes';
import { parseCourseSnapshotBody } from '../courses/requestBodies';
import {
  createCourseDraft,
  loadCourseRecord,
  loadLatestEditableDraftCourseForRoom,
  saveCourseDraft,
} from '../courses/store';
import { resolveRoomCapabilities } from '../progression/store';
import { loadRoomRecord } from '../rooms/store';

interface ExpandedRoomCellMutationBody {
  roomId?: unknown;
  coordinates?: unknown;
  x?: unknown;
  y?: unknown;
  roomVersion?: unknown;
}

export async function handleExpandedRoomCreate(
  request: Request,
  env: Env
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'create expanded room drafts',
    'rooms:write'
  );
  const snapshot = await parseCourseSnapshotBody(request);
  const record = await createCourseDraft(env, snapshot, auth.user, auth.isAdmin, auth.source);
  return jsonResponse(request, record);
}

export async function handleExpandedRoomDraftByRoomLookup(
  request: Request,
  env: Env,
  roomId: string
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'load editable expanded room drafts',
    'rooms:write'
  );
  const record = await loadLatestEditableDraftCourseForRoom(
    env,
    roomId,
    auth.user.id,
    auth.isAdmin
  );

  if (!record) {
    throw new HttpError(404, 'Expanded room draft not found for this cell.');
  }

  return jsonResponse(request, await attachExpandedRoomCellLimitForAuth(env, record, auth));
}

export async function handleExpandedRoomEditorRecordGet(
  request: Request,
  env: Env,
  expandedRoomId: string
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'load editable expanded rooms',
    'rooms:write'
  );
  const courseId = legacyCourseIdForEditableExpandedRoom(expandedRoomId);
  const record = await requireEditableExpandedRoomRecord(
    env,
    courseId,
    auth.user.id,
    auth.isAdmin
  );
  return jsonResponse(request, await attachExpandedRoomCellLimitForAuth(env, record, auth));
}

export async function handleExpandedRoomDraftSave(
  request: Request,
  env: Env,
  expandedRoomId: string
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'save expanded room drafts',
    'rooms:write'
  );
  const courseId = legacyCourseIdForEditableExpandedRoom(expandedRoomId);
  const snapshot = await parseCourseSnapshotBody(request, courseId);
  const record = await saveCourseDraft(env, snapshot, auth.user, auth.isAdmin, auth.source);
  return jsonResponse(request, record);
}

export async function handleExpandedRoomPublish(
  request: Request,
  env: Env,
  expandedRoomId: string,
  executionContext?: WorkerExecutionContextLike,
): Promise<Response> {
  return handleCoursePublish(
    request,
    env,
    legacyCourseIdForEditableExpandedRoom(expandedRoomId),
    { enforceDailyPublishLimit: false, executionContext }
  );
}

export async function handleExpandedRoomUnpublish(
  request: Request,
  env: Env,
  expandedRoomId: string,
  executionContext?: WorkerExecutionContextLike,
): Promise<Response> {
  return handleCourseUnpublish(
    request,
    env,
    legacyCourseIdForEditableExpandedRoom(expandedRoomId),
    executionContext,
  );
}

export async function handleExpandedRoomCellAdd(
  request: Request,
  env: Env,
  expandedRoomId: string
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'expand expanded room drafts',
    'rooms:write'
  );
  const courseId = legacyCourseIdForEditableExpandedRoom(expandedRoomId);
  const record = await requireEditableExpandedRoomRecord(env, courseId, auth.user.id, auth.isAdmin);
  const body = await parseJsonBody<ExpandedRoomCellMutationBody>(request);
  const target = normalizeExpandedRoomCellMutationBody(body);
  const room = await loadRoomRecord(
    env,
    target.roomId,
    target.coordinates,
    auth.user.id,
    auth.user.walletAddress ?? null,
    auth.isAdmin
  );

  if (!room.published) {
    throw new HttpError(409, 'Expanded room cells must be published rooms.');
  }

  if (
    target.roomVersion !== null &&
    target.roomVersion !== room.published.version
  ) {
    throw new HttpError(409, 'Expanded room expansion uses the current published room version.');
  }

  if (record.draft.roomRefs.some((roomRef) => roomRef.roomId === target.roomId)) {
    throw new HttpError(409, 'This cell is already part of the expanded room.');
  }

  const draft = cloneCourseSnapshot(record.draft);
  const nextRef: CourseRoomRef = {
    roomId: room.published.id,
    coordinates: { ...room.published.coordinates },
    roomVersion: room.published.version,
    roomTitle: room.published.title,
  };
  draft.roomRefs = sortCourseRoomRefsForStorage([...draft.roomRefs, nextRef]);

  const saved = await saveCourseDraft(env, draft, auth.user, auth.isAdmin, auth.source);
  return jsonResponse(request, saved);
}

export async function handleExpandedRoomCellRemove(
  request: Request,
  env: Env,
  expandedRoomId: string,
  roomId: string
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'remove expanded room draft cells',
    'rooms:write'
  );
  const courseId = legacyCourseIdForEditableExpandedRoom(expandedRoomId);
  const record = await requireEditableExpandedRoomRecord(env, courseId, auth.user.id, auth.isAdmin);
  const targetRoomId = roomId.trim();
  if (!targetRoomId) {
    throw new HttpError(400, 'roomId is required.');
  }

  const existingRef = record.draft.roomRefs.find((roomRef) => roomRef.roomId === targetRoomId);
  if (!existingRef) {
    throw new HttpError(404, 'Cell is not part of this expanded room draft.');
  }

  const protectedRoomIds = await loadProtectedMintedRoomIds(
    env,
    record.draft.roomRefs.map((roomRef) => roomRef.roomId)
  );
  const anchorRoomId = resolveDraftAnchorRoomId(record.draft);
  const removalError = getExpandedRoomCellRemovalError(
    record.draft.roomRefs.map((roomRef) => ({
      roomId: roomRef.roomId,
      coordinates: { ...roomRef.coordinates },
      protectedMinted: protectedRoomIds.has(roomRef.roomId),
    } satisfies ExpandedRoomFootprintCell)),
    targetRoomId,
    anchorRoomId
  );
  if (removalError) {
    throw new HttpError(409, removalError);
  }

  const draft = stripRoomFromExpandedRoomDraft(record.draft, targetRoomId);
  const saved = await saveCourseDraft(env, draft, auth.user, auth.isAdmin, auth.source);
  return jsonResponse(request, saved);
}

async function attachExpandedRoomCellLimitForAuth(
  env: Env,
  record: CourseRecord,
  auth: RequestAuth
): Promise<CourseRecord> {
  const capabilities = await resolveRoomCapabilities(env, auth.user.id, auth.source);
  return {
    ...record,
    expandedRoomCellLimit: capabilities.expandedRoomCellLimit,
  };
}

function legacyCourseIdForEditableExpandedRoom(expandedRoomId: string): string {
  const trimmed = expandedRoomId.trim();
  if (!trimmed) {
    throw new HttpError(400, 'expandedRoomId is required.');
  }
  if (trimmed.startsWith('course:')) {
    const courseId = trimmed.slice('course:'.length);
    if (!courseId) {
      throw new HttpError(400, 'course-backed expanded room id is invalid.');
    }
    return courseId;
  }
  if (trimmed.startsWith('room:')) {
    throw new HttpError(409, 'Standalone rooms are edited through the room editor.');
  }
  return trimmed;
}

async function requireEditableExpandedRoomRecord(
  env: Env,
  courseId: string,
  viewerUserId: string,
  viewerIsAdmin: boolean
): Promise<CourseRecord> {
  const record = await loadCourseRecord(env, courseId, viewerUserId, viewerIsAdmin);
  if (!record) {
    throw new HttpError(404, 'Expanded room draft not found.');
  }
  if (!record.permissions.canSaveDraft) {
    throw new HttpError(403, 'You do not have permission to edit this expanded room.');
  }
  return record;
}

function normalizeExpandedRoomCellMutationBody(
  body: ExpandedRoomCellMutationBody
): { roomId: string; coordinates: RoomCoordinates; roomVersion: number | null } {
  const coordinates = normalizeCoordinatesFromCellMutationBody(body);
  const roomId =
    typeof body.roomId === 'string' && body.roomId.trim()
      ? body.roomId.trim()
      : roomIdFromCoordinates(coordinates);
  const parsedRoomId = parseRoomId(roomId);
  if (parsedRoomId && (parsedRoomId.x !== coordinates.x || parsedRoomId.y !== coordinates.y)) {
    throw new HttpError(400, 'roomId must match coordinates.');
  }

  return {
    roomId,
    coordinates,
    roomVersion:
      body.roomVersion === null || body.roomVersion === undefined
        ? null
        : normalizePositiveIntegerPathValue(body.roomVersion, 'roomVersion'),
  };
}

function normalizeCoordinatesFromCellMutationBody(
  body: ExpandedRoomCellMutationBody
): RoomCoordinates {
  if (body.coordinates && typeof body.coordinates === 'object') {
    const coordinates = body.coordinates as Partial<RoomCoordinates>;
    if (Number.isInteger(coordinates.x) && Number.isInteger(coordinates.y)) {
      return {
        x: Number(coordinates.x),
        y: Number(coordinates.y),
      };
    }
  }

  if (Number.isInteger(body.x) && Number.isInteger(body.y)) {
    return {
      x: Number(body.x),
      y: Number(body.y),
    };
  }

  if (typeof body.roomId === 'string') {
    const parsed = parseRoomId(body.roomId.trim());
    if (parsed) {
      return parsed;
    }
  }

  throw new HttpError(400, 'Cell coordinates are required.');
}

function normalizePositiveIntegerPathValue(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new HttpError(400, `${label} must be a positive integer.`);
  }
  return Number(value);
}

function resolveDraftAnchorRoomId(draft: CourseSnapshot): string {
  if (
    draft.startPoint &&
    draft.roomRefs.some((roomRef) => roomRef.roomId === draft.startPoint?.roomId)
  ) {
    return draft.startPoint.roomId;
  }
  const firstSorted = sortCourseRoomRefsForStorage(draft.roomRefs)[0] ?? null;
  return firstSorted?.roomId ?? draft.roomRefs[0]?.roomId ?? '';
}

function stripRoomFromExpandedRoomDraft(
  snapshot: CourseSnapshot,
  roomId: string
): CourseSnapshot {
  const draft = cloneCourseSnapshot(snapshot);
  draft.roomRefs = draft.roomRefs.filter((roomRef) => roomRef.roomId !== roomId);
  draft.objectLinks = draft.objectLinks.filter(
    (link) => link.triggerRoomId !== roomId && link.targetRoomId !== roomId
  );
  draft.pressurePlateLinks = draft.objectLinks.map((link) => ({ ...link }));
  if (draft.startPoint?.roomId === roomId) {
    draft.startPoint = null;
  }

  if (draft.goal?.type === 'reach_exit' && draft.goal.exit?.roomId === roomId) {
    draft.goal = {
      ...draft.goal,
      exit: null,
    };
  } else if (draft.goal?.type === 'checkpoint_sprint') {
    draft.goal = {
      ...draft.goal,
      checkpoints: draft.goal.checkpoints.filter((checkpoint) => checkpoint.roomId !== roomId),
      finish: draft.goal.finish?.roomId === roomId ? null : draft.goal.finish,
    };
  }

  return draft;
}

async function loadProtectedMintedRoomIds(env: Env, roomIds: string[]): Promise<Set<string>> {
  const uniqueRoomIds = Array.from(new Set(roomIds.filter((roomId) => roomId.trim())));
  if (uniqueRoomIds.length === 0) {
    return new Set();
  }

  const placeholders = uniqueRoomIds.map(() => '?').join(', ');
  const result = await env.DB.prepare(
    `
      SELECT id, minted_chain_id, minted_contract_address, minted_token_id
      FROM rooms
      WHERE id IN (${placeholders})
    `
  )
    .bind(...uniqueRoomIds)
    .all<{
      id: string;
      minted_chain_id: number | null;
      minted_contract_address: string | null;
      minted_token_id: string | null;
    }>();

  return new Set(
    result.results
      .filter((row) =>
        isRoomMinted({
          mintedChainId: row.minted_chain_id,
          mintedContractAddress: row.minted_contract_address,
          mintedTokenId: row.minted_token_id,
        })
      )
      .map((row) => row.id)
  );
}

export function editableExpandedRoomIdForCourseId(courseId: string): string {
  return expandedRoomIdFromLegacyCourseId(courseId);
}

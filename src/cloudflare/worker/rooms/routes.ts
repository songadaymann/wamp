import {
  createRoomSummaryFromRecord,
  type RoomCanonicalVersionRequestBody,
  type RoomLeaderboardLineageRequestBody,
  type RoomRecord,
  type RoomRevertRequestBody,
  type RoomSnapshotQueryReference,
} from '../../../persistence/roomModel';
import {
  annotateRoomRecordWithTilesetHints,
  annotateRoomSnapshotWithTilesetHint,
  annotateRoomVersionRecordsWithTilesetHints,
} from '../../../agentBuilder/tilesetCatalog';
import {
  createConstructionPreviewToken,
  resolveConstructionPreviewTokenSigningSecret,
  type ConstructionPreviewTokenIssueResponse,
} from '../../../presence/constructionPreviewToken';
import {
  buildMusicPhraseActor,
  buildRoomMutationActor,
} from '../auth/actors';
import {
  loadOptionalRequestAuth,
  requireAuthenticatedRequestAuth,
  requireOptionalScope,
} from '../auth/request';
import {
  getCoordinatesFromRequest,
  HttpError,
  jsonResponse,
  parseJsonBody,
  parseRoomSnapshot,
} from '../core/http';
import type { Env, WorkerExecutionContextLike } from '../core/types';
import { ServerTiming, timedJsonResponse } from '../core/serverTiming';
import { loadAnonymousPublicCache } from '../core/publicCache';
import {
  refreshPlayableContentIndexForRoom,
  schedulePlayableContentIndexRefresh,
} from '../playableContentIndex/store';
import {
  handleRoomMintConfirm,
  handleRoomMintPrepare,
  handleRoomTokenMetadataConfirm,
  handleRoomTokenMetadataPrepare,
} from '../mint/routes';
import {
  parseMusicPhraseInstrumentQuery,
  upsertMusicPhrasesForSnapshot,
} from '../music/store';
import {
  assertUserCanPublishContent,
  awardRoomPublishProgression,
} from '../progression/store';
import {
  awardRoomPublishPoints,
  upsertUserStats,
} from '../runs/points';
import {
  handleRoomCommentCreate,
  handleRoomCommentList,
} from '../roomComments/routes';
import {
  parseRoomDraftCommandsRequest,
  saveDraftFromCommandRequest,
} from './commands';
import {
  loadConstructionRoom,
  loadExactRoomVersion,
  loadPublishedRoom,
  loadRoomCurrent,
  loadRoomRecord,
  loadRoomRecordForMutation,
  loadRoomSnapshotsByReferences,
  createOverviewRoomSnapshot,
  loadRoomSummary,
  loadRoomVersionPage,
  publishRoom,
  revertRoom,
  saveDraft,
  setCanonicalRoomVersion,
  setRoomVersionLeaderboardSource,
} from './store';

export async function handleRoomRequest(
  request: Request,
  url: URL,
  env: Env,
  context?: WorkerExecutionContextLike,
): Promise<Response> {
  const segments = url.pathname.split('/').filter(Boolean);
  const roomId = decodeURIComponent(segments[2] ?? '');

  if (
    segments.length === 4 &&
    segments[2] === 'snapshots' &&
    segments[3] === 'query' &&
    request.method === 'POST'
  ) {
    const auth = await loadOptionalRequestAuth(env, request);
    requireOptionalScope(auth, 'rooms:read', 'read room snapshots');
    const body = await parseJsonBody<{ references?: unknown; detail?: unknown }>(request, { maxBytes: 64 * 1024 });
    const references = parseSnapshotQueryReferences(body.references);
    const detail = body.detail === 'overview' ? 'overview' : 'full';
    const timing = new ServerTiming();
    const response = await timing.measure('snapshots', () => loadRoomSnapshotsByReferences(env, references));
    const payload = detail === 'overview'
      ? {
          ...response,
          snapshots: response.snapshots.map((entry) => ({
            ...entry,
            snapshot: createOverviewRoomSnapshot(entry.snapshot),
          })),
        }
      : response;
    return timedJsonResponse(request, payload, timing, {
      headers: { 'Cache-Control': 'private, no-store', 'X-WAMP-Cache': 'bypass' },
    });
  }

  if (!roomId) {
    throw new HttpError(400, 'Room id is required.');
  }

  if (segments.length === 3 && request.method === 'GET') {
    const coordinates = getCoordinatesFromRequest(roomId, url.searchParams);
    const auth = await loadOptionalRequestAuth(env, request);
    requireOptionalScope(auth, 'rooms:read', 'read room drafts');
    const record = await loadRoomRecord(
      env,
      roomId,
      coordinates,
      auth?.user.id ?? null,
      auth?.user.walletAddress ?? null,
      auth?.isAdmin ?? false,
    );
    return jsonResponse(request, annotateRoomRecordWithTilesetHints(record));
  }

  if (segments.length === 4 && segments[3] === 'summary' && request.method === 'GET') {
    const coordinates = getCoordinatesFromRequest(roomId, url.searchParams);
    const auth = await loadOptionalRequestAuth(env, request);
    requireOptionalScope(auth, 'rooms:read', 'read room summaries');
    const timing = new ServerTiming();
    const loadResponse = async () => {
      const summary = await timing.measure('summary', () => loadRoomSummary(
        env,
        roomId,
        coordinates,
        auth?.user.id ?? null,
        auth?.user.walletAddress ?? null,
        auth?.isAdmin ?? false,
      ));
      return timedJsonResponse(request, summary, timing, {
        headers: { 'Cache-Control': auth ? 'private, no-store' : 'public, max-age=20' },
      });
    };
    return loadAnonymousPublicCache(request, auth ? undefined : context, loadResponse);
  }

  if (segments.length === 4 && segments[3] === 'current' && request.method === 'GET') {
    const coordinates = getCoordinatesFromRequest(roomId, url.searchParams);
    const auth = await loadOptionalRequestAuth(env, request);
    requireOptionalScope(auth, 'rooms:read', 'read current room snapshots');
    const timing = new ServerTiming();
    const current = await timing.measure('current', () => loadRoomCurrent(
      env,
      roomId,
      coordinates,
      auth?.user.id ?? null,
      auth?.user.walletAddress ?? null,
      auth?.isAdmin ?? false,
    ));
    return timedJsonResponse(request, {
      ...current,
      draft: annotateRoomSnapshotWithTilesetHint(current.draft),
      published: current.published ? annotateRoomSnapshotWithTilesetHint(current.published) : null,
    }, timing, { headers: { 'Cache-Control': 'private, no-store', 'X-WAMP-Cache': 'bypass' } });
  }

  if (segments.length === 4 && segments[3] === 'ownership' && request.method === 'POST') {
    throw new HttpError(404, 'Route not found.');
  }

  if (
    segments.length === 5 &&
    segments[3] === 'ownership' &&
    segments[4] === 'refresh' &&
    request.method === 'POST'
  ) {
    const coordinates = getCoordinatesFromRequest(roomId, url.searchParams);
    const auth = await requireAuthenticatedRequestAuth(
      env,
      request,
      'refresh room ownership',
      'rooms:write',
    );
    const timing = new ServerTiming();
    await timing.measure('chain_sync', () => loadRoomRecordForMutation(
      env,
      roomId,
      coordinates,
      auth.user,
      auth.isAdmin,
    ));
    const summary = await timing.measure('summary', () => loadRoomSummary(
      env,
      roomId,
      coordinates,
      auth.user.id,
      auth.user.walletAddress,
      auth.isAdmin,
    ));
    return timedJsonResponse(request, summary, timing, {
      headers: { 'Cache-Control': 'private, no-store', 'X-WAMP-Cache': 'bypass' },
    });
  }

  if (segments.length === 4 && segments[3] === 'comments' && request.method === 'GET') {
    return await handleRoomCommentList(request, url, env, roomId);
  }

  if (segments.length === 4 && segments[3] === 'comments' && request.method === 'POST') {
    return await handleRoomCommentCreate(request, url, env, roomId);
  }

  if (segments.length === 4 && segments[3] === 'published' && request.method === 'GET') {
    const auth = await loadOptionalRequestAuth(env, request);
    requireOptionalScope(auth, 'rooms:read', 'read published rooms');
    const coordinates = getCoordinatesFromRequest(roomId, url.searchParams);
    const publishedRoom = await loadPublishedRoom(env, roomId, coordinates);

    if (!publishedRoom) {
      throw new HttpError(404, 'Published room not found.');
    }

    return jsonResponse(request, annotateRoomSnapshotWithTilesetHint(publishedRoom));
  }

  if (segments.length === 4 && segments[3] === 'construction' && request.method === 'GET') {
    const auth = await loadOptionalRequestAuth(env, request);
    requireOptionalScope(auth, 'rooms:read', 'read construction rooms');
    const coordinates = getCoordinatesFromRequest(roomId, url.searchParams);
    const constructionRoom = await loadConstructionRoom(env, roomId, coordinates);

    if (!constructionRoom) {
      throw new HttpError(404, 'Construction room not found.');
    }

    return jsonResponse(request, annotateRoomSnapshotWithTilesetHint(constructionRoom));
  }

  if (
    segments.length === 4 &&
    segments[3] === 'construction-preview-token' &&
    request.method === 'POST'
  ) {
    const coordinates = getCoordinatesFromRequest(roomId, url.searchParams);
    const auth = await requireAuthenticatedRequestAuth(
      env,
      request,
      'share live construction previews',
      'rooms:write',
    );
    const signingSecret = resolveConstructionPreviewTokenSigningSecret(env);
    if (!signingSecret) {
      throw new HttpError(503, 'Construction preview token signing is not configured.');
    }

    const record = await loadRoomRecordForMutation(
      env,
      roomId,
      coordinates,
      auth.user,
      auth.isAdmin,
    );
    if (record.published !== null || !record.claimerUserId || !record.claimedAt) {
      throw new HttpError(404, 'Construction preview is only available for unpublished claimed rooms.');
    }
    if (!record.permissions.canSaveDraft) {
      throw new HttpError(403, 'Only the room claimer can share live construction previews.');
    }

    const { token, claims } = await createConstructionPreviewToken(
      {
        roomId: record.draft.id,
        roomCoordinates: record.draft.coordinates,
        userId: auth.user.id,
      },
      signingSecret.secret,
    );
    const response: ConstructionPreviewTokenIssueResponse = {
      token,
      expiresAt: new Date(claims.exp).toISOString(),
    };

    return jsonResponse(request, response);
  }

  if (segments.length === 4 && segments[3] === 'draft' && request.method === 'PUT') {
    const snapshot = await parseRoomSnapshot(request, roomId);
    const auth = await requireAuthenticatedRequestAuth(
      env,
      request,
      'save room drafts',
      'rooms:write',
    );
    const record = await saveDraft(env, snapshot, buildRoomMutationActor(auth), auth.isAdmin);
    return roomMutationResponse(request, url, record);
  }

  if (segments.length === 5 && segments[3] === 'music' && segments[4] === 'phrases' && request.method === 'POST') {
    const snapshot = await parseRoomSnapshot(request, roomId);
    const auth = await requireAuthenticatedRequestAuth(
      env,
      request,
      'save music phrases',
      'rooms:write',
    );
    const record = await loadRoomRecord(
      env,
      snapshot.id,
      snapshot.coordinates,
      auth.user.id,
      auth.user.walletAddress,
      auth.isAdmin,
    );
    if (!record.permissions.canSaveDraft) {
      throw new HttpError(403, 'Only the room token owner can save music phrases for this room.');
    }

    const instrument = url.searchParams.get('instrument');
    const saveMode = url.searchParams.get('mode');
    if (saveMode !== null && saveMode !== 'overwrite' && saveMode !== 'save-as') {
      throw new HttpError(400, 'mode must be overwrite or save-as.');
    }
    const overwritePhraseId = url.searchParams.get('overwritePhraseId')?.trim() ?? null;
    if (overwritePhraseId && !instrument) {
      throw new HttpError(400, 'overwritePhraseId requires an instrument.');
    }
    const response = await upsertMusicPhrasesForSnapshot(
      env,
      snapshot,
      buildMusicPhraseActor(auth),
      {
        instrumentIds: instrument
          ? [parseMusicPhraseInstrumentQuery(instrument)]
          : undefined,
        saveMode: saveMode ?? undefined,
        overwritePhraseId,
      },
    );
    return jsonResponse(request, response);
  }

  if (segments.length === 5 && segments[3] === 'draft' && segments[4] === 'commands' && request.method === 'POST') {
    const coordinates = getCoordinatesFromRequest(roomId, url.searchParams);
    const body = await parseRoomDraftCommandsRequest(request);
    const auth = await requireAuthenticatedRequestAuth(
      env,
      request,
      'save room drafts from commands',
      'rooms:write',
    );
    const record = await saveDraftFromCommandRequest(
      env,
      roomId,
      coordinates,
      body,
      buildRoomMutationActor(auth),
      auth.isAdmin,
    );
    return roomMutationResponse(request, url, record);
  }

  if (segments.length === 4 && segments[3] === 'publish' && request.method === 'POST') {
    const snapshot = await parseRoomSnapshot(request, roomId);
    const auth = await requireAuthenticatedRequestAuth(
      env,
      request,
      'publish rooms',
      'rooms:write',
    );
    const previousRecord = await loadRoomRecord(
      env,
      snapshot.id,
      snapshot.coordinates,
      auth.user.id,
      auth.user.walletAddress ?? null,
      auth.isAdmin,
    );
    const bypassDailyPublishLimit =
      previousRecord.published !== null && previousRecord.claimerUserId === auth.user.id;
    if (!bypassDailyPublishLimit) {
      await assertUserCanPublishContent(env, auth.user.id, auth.source);
    }
    const record = await publishRoom(
      env,
      snapshot,
      buildRoomMutationActor(auth),
      auth.isAdmin,
    );
    await awardRoomPublishPoints(
      env,
      auth.user.id,
      record.draft.id,
      record.published?.version ?? record.draft.version,
      {
        hasGoal: record.published?.goal !== null,
        hasPriorGoalPublish: record.versions.some(
          (version) =>
            version.version !== (record.published?.version ?? record.draft.version) &&
            version.snapshot.goal !== null,
        ),
      },
    );
    await awardRoomPublishProgression(env, {
      userId: auth.user.id,
      roomId: record.draft.id,
      roomVersion: record.published?.version ?? record.draft.version,
      publishedSnapshot: record.published ?? record.draft,
      previousPublishedSnapshot: previousRecord.published,
      hasGoal: record.published?.goal !== null,
      hasPriorGoalPublish: previousRecord.versions.some((version) => version.snapshot.goal !== null),
      publishedAt: record.published?.publishedAt ?? new Date().toISOString(),
    });
    await upsertUserStats(env, auth.user.id);
    schedulePlayableContentIndexRefresh(context, refreshPlayableContentIndexForRoom(env, record.draft.id));
    return roomMutationResponse(request, url, record);
  }

  if (segments.length === 4 && segments[3] === 'revert' && request.method === 'POST') {
    const coordinates = getCoordinatesFromRequest(roomId, url.searchParams);
    const body = await parseJsonBody<RoomRevertRequestBody>(request);
    const auth = await requireAuthenticatedRequestAuth(
      env,
      request,
      'revert rooms',
      'rooms:write',
    );
    const previousRecord = await loadRoomRecord(
      env,
      roomId,
      coordinates,
      auth.user.id,
      auth.user.walletAddress ?? null,
      auth.isAdmin,
    );
    const record = await revertRoom(
      env,
      roomId,
      coordinates,
      body.targetVersion,
      buildRoomMutationActor(auth),
      auth.isAdmin,
    );
    await awardRoomPublishPoints(
      env,
      auth.user.id,
      record.draft.id,
      record.published?.version ?? record.draft.version,
      {
        hasGoal: record.published?.goal !== null,
        hasPriorGoalPublish: record.versions.some(
          (version) =>
            version.version !== (record.published?.version ?? record.draft.version) &&
            version.snapshot.goal !== null,
        ),
      },
    );
    await awardRoomPublishProgression(env, {
      userId: auth.user.id,
      roomId: record.draft.id,
      roomVersion: record.published?.version ?? record.draft.version,
      publishedSnapshot: record.published ?? record.draft,
      previousPublishedSnapshot: previousRecord.published,
      hasGoal: record.published?.goal !== null,
      hasPriorGoalPublish: previousRecord.versions.some((version) => version.snapshot.goal !== null),
      publishedAt: record.published?.publishedAt ?? new Date().toISOString(),
    });
    await upsertUserStats(env, auth.user.id);
    schedulePlayableContentIndexRefresh(context, refreshPlayableContentIndexForRoom(env, record.draft.id));
    return roomMutationResponse(request, url, record);
  }

  if (segments.length === 4 && segments[3] === 'canonical' && request.method === 'POST') {
    const coordinates = getCoordinatesFromRequest(roomId, url.searchParams);
    const body = await parseJsonBody<RoomCanonicalVersionRequestBody>(request);
    const auth = await requireAuthenticatedRequestAuth(
      env,
      request,
      'set room canonical version',
      'rooms:write',
    );
    const record = await setCanonicalRoomVersion(
      env,
      roomId,
      coordinates,
      body.targetVersion,
      buildRoomMutationActor(auth),
      auth.isAdmin,
    );
    schedulePlayableContentIndexRefresh(context, refreshPlayableContentIndexForRoom(env, roomId));
    return roomMutationResponse(request, url, record);
  }

  if (segments.length === 4 && segments[3] === 'leaderboard-lineage' && request.method === 'POST') {
    const coordinates = getCoordinatesFromRequest(roomId, url.searchParams);
    const body = await parseJsonBody<RoomLeaderboardLineageRequestBody>(request);
    const auth = await requireAuthenticatedRequestAuth(
      env,
      request,
      'set room leaderboard lineage',
      'rooms:write',
    );
    const record = await setRoomVersionLeaderboardSource(
      env,
      roomId,
      coordinates,
      body.targetVersion,
      body.sourceVersion,
      buildRoomMutationActor(auth),
      auth.isAdmin,
    );
    return roomMutationResponse(request, url, record);
  }

  if (segments.length === 4 && segments[3] === 'versions' && request.method === 'GET') {
    const auth = await loadOptionalRequestAuth(env, request);
    requireOptionalScope(auth, 'rooms:read', 'read room versions');
    const limit = parseRoomVersionLimit(url.searchParams.get('limit'));
    const timing = new ServerTiming();
    const page = await timing.measure('versions', () => loadRoomVersionPage(
      env,
      roomId,
      limit,
      url.searchParams.get('cursor'),
    ));
    return timedJsonResponse(request, page, timing, {
      headers: { 'Cache-Control': 'private, no-store', 'X-WAMP-Cache': 'bypass' },
    });
  }

  if (segments.length === 5 && segments[3] === 'versions' && request.method === 'GET') {
    const auth = await loadOptionalRequestAuth(env, request);
    requireOptionalScope(auth, 'rooms:read', 'read an exact room version');
    const version = Number(segments[4]);
    if (!Number.isSafeInteger(version) || version < 1) throw new HttpError(400, 'Room version must be a positive integer.');
    const timing = new ServerTiming();
    const exact = await timing.measure('version', () => loadExactRoomVersion(env, roomId, version));
    if (!exact) throw new HttpError(404, 'Room version not found.');
    return timedJsonResponse(request, annotateRoomVersionRecordsWithTilesetHints([exact])[0], timing, {
      headers: { 'Cache-Control': 'public, max-age=31536000, immutable', 'X-WAMP-Cache': 'bypass' },
    });
  }

  if (
    segments.length === 6 &&
    segments[3] === 'mint' &&
    segments[4] === 'metadata' &&
    segments[5] === 'prepare' &&
    request.method === 'POST'
  ) {
    const coordinates = getCoordinatesFromRequest(roomId, url.searchParams);
    return await handleRoomTokenMetadataPrepare(request, env, roomId, coordinates);
  }

  if (
    segments.length === 6 &&
    segments[3] === 'mint' &&
    segments[4] === 'metadata' &&
    segments[5] === 'confirm' &&
    request.method === 'POST'
  ) {
    const coordinates = getCoordinatesFromRequest(roomId, url.searchParams);
    return await handleRoomTokenMetadataConfirm(request, env, roomId, coordinates);
  }

  if (
    segments.length === 5 &&
    segments[3] === 'mint' &&
    segments[4] === 'prepare' &&
    request.method === 'POST'
  ) {
    const coordinates = getCoordinatesFromRequest(roomId, url.searchParams);
    return await handleRoomMintPrepare(request, env, roomId, coordinates);
  }

  if (
    segments.length === 5 &&
    segments[3] === 'mint' &&
    segments[4] === 'confirm' &&
    request.method === 'POST'
  ) {
    const coordinates = getCoordinatesFromRequest(roomId, url.searchParams);
    return await handleRoomMintConfirm(request, env, roomId, coordinates);
  }

  throw new HttpError(405, 'Method not allowed.');
}

function parseRoomVersionLimit(value: string | null): number {
  if (value === null || value === '') return 25;
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new HttpError(400, 'Room version limit must be between 1 and 100.');
  }
  return limit;
}

function roomMutationResponse(request: Request, url: URL, record: RoomRecord): Response {
  if (url.searchParams.get('response') !== 'compact') {
    return jsonResponse(request, annotateRoomRecordWithTilesetHints(record));
  }
  return jsonResponse(request, {
    summary: createRoomSummaryFromRecord(record),
    draft: annotateRoomSnapshotWithTilesetHint(record.draft),
    published: record.published ? annotateRoomSnapshotWithTilesetHint(record.published) : null,
  }, {
    headers: { 'Cache-Control': 'private, no-store', 'X-WAMP-Cache': 'bypass' },
  });
}

function parseSnapshotQueryReferences(value: unknown): RoomSnapshotQueryReference[] {
  if (!Array.isArray(value)) throw new HttpError(400, 'references must be an array.');
  if (value.length > 128) throw new HttpError(400, 'A maximum of 128 room snapshot references is allowed.');
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== 'object') throw new HttpError(400, 'Invalid room snapshot reference.');
    const raw = candidate as Record<string, unknown>;
    const roomId = typeof raw.roomId === 'string' ? raw.roomId.trim() : '';
    if (!roomId || roomId.length > 160) throw new HttpError(400, 'Snapshot roomId is required.');
    if (raw.kind === 'version') {
      const version = Number(raw.version);
      if (!Number.isSafeInteger(version) || version < 1) throw new HttpError(400, 'Snapshot version must be positive.');
      return { kind: 'version', roomId, version };
    }
    if (raw.kind === 'current_preview') {
      const state = raw.state === undefined ? undefined : raw.state;
      if (state !== undefined && state !== 'published' && state !== 'claimed_unpublished') {
        throw new HttpError(400, 'Invalid current preview state.');
      }
      const coordinates = raw.coordinates && typeof raw.coordinates === 'object'
        ? raw.coordinates as Record<string, unknown>
        : null;
      const x = coordinates ? Number(coordinates.x) : null;
      const y = coordinates ? Number(coordinates.y) : null;
      if (coordinates && (!Number.isSafeInteger(x) || !Number.isSafeInteger(y))) {
        throw new HttpError(400, 'Invalid current preview coordinates.');
      }
      const updatedAt = raw.updatedAt === undefined ? undefined : raw.updatedAt;
      if (updatedAt !== undefined && (typeof updatedAt !== 'string' || updatedAt.length > 64)) {
        throw new HttpError(400, 'Invalid current preview timestamp.');
      }
      return {
        kind: 'current_preview',
        roomId,
        ...(state ? { state } : {}),
        ...(coordinates ? { coordinates: { x: x as number, y: y as number } } : {}),
        ...(updatedAt ? { updatedAt } : {}),
      };
    }
    throw new HttpError(400, 'Snapshot kind must be version or current_preview.');
  });
}

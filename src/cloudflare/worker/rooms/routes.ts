import {
  type RoomCanonicalVersionRequestBody,
  type RoomLeaderboardLineageRequestBody,
  type RoomRevertRequestBody,
} from '../../../persistence/roomModel';
import {
  annotateRoomRecordWithTilesetHints,
  annotateRoomSnapshotWithTilesetHint,
  annotateRoomVersionRecordsWithTilesetHints,
} from '../../../agentBuilder/tilesetCatalog';
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
import type { Env } from '../core/types';
import {
  handleRoomMintConfirm,
  handleRoomMintPrepare,
  handleRoomTokenMetadataConfirm,
  handleRoomTokenMetadataPrepare,
} from '../mint/routes';
import { syncRoomOwnershipFromChain } from '../mint/service';
import {
  parseMusicPhraseInstrumentQuery,
  upsertMusicPhrasesForSnapshot,
} from '../music/store';
import {
  enqueuePlayfunPointSync,
  flushPlayfunPointSync,
  linkPlayfunUserFromRequest,
} from '../playfun/service';
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
  loadPublishedRoom,
  loadRoomRecord,
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
): Promise<Response> {
  const segments = url.pathname.split('/').filter(Boolean);
  const roomId = decodeURIComponent(segments[2] ?? '');

  if (!roomId) {
    throw new HttpError(400, 'Room id is required.');
  }

  if (segments.length === 3 && request.method === 'GET') {
    const coordinates = getCoordinatesFromRequest(roomId, url.searchParams);
    const auth = await loadOptionalRequestAuth(env, request);
    requireOptionalScope(auth, 'rooms:read', 'read room drafts');
    let record = await loadRoomRecord(
      env,
      roomId,
      coordinates,
      auth?.user.id ?? null,
      auth?.user.walletAddress ?? null,
      auth?.isAdmin ?? false,
    );
    if (auth?.user) {
      try {
        await syncRoomOwnershipFromChain(env, record, auth.user);
        record = await loadRoomRecord(
          env,
          roomId,
          coordinates,
          auth.user.id,
          auth.user.walletAddress,
          auth.isAdmin,
        );
      } catch (error) {
        console.warn('Failed to refresh room ownership from chain during read', error);
      }
    }
    return jsonResponse(request, annotateRoomRecordWithTilesetHints(record));
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

  if (segments.length === 4 && segments[3] === 'draft' && request.method === 'PUT') {
    const snapshot = await parseRoomSnapshot(request, roomId);
    const auth = await requireAuthenticatedRequestAuth(
      env,
      request,
      'save room drafts',
      'rooms:write',
    );
    const record = await saveDraft(env, snapshot, buildRoomMutationActor(auth), auth.isAdmin);
    return jsonResponse(request, annotateRoomRecordWithTilesetHints(record));
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
    return jsonResponse(request, annotateRoomRecordWithTilesetHints(record));
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
    const pointEvent = await awardRoomPublishPoints(
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
    if (pointEvent) {
      await maybeMirrorPointEventToPlayfun(env, request, auth.user.id, pointEvent);
    }
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
    return jsonResponse(request, annotateRoomRecordWithTilesetHints(record));
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
    const pointEvent = await awardRoomPublishPoints(
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
    if (pointEvent) {
      await maybeMirrorPointEventToPlayfun(env, request, auth.user.id, pointEvent);
    }
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
    return jsonResponse(request, annotateRoomRecordWithTilesetHints(record));
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
    return jsonResponse(request, annotateRoomRecordWithTilesetHints(record));
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
    return jsonResponse(request, annotateRoomRecordWithTilesetHints(record));
  }

  if (segments.length === 4 && segments[3] === 'versions' && request.method === 'GET') {
    const coordinates = getCoordinatesFromRequest(roomId, url.searchParams);
    const auth = await loadOptionalRequestAuth(env, request);
    requireOptionalScope(auth, 'rooms:read', 'read room versions');
    const record = await loadRoomRecord(
      env,
      roomId,
      coordinates,
      auth?.user.id ?? null,
      auth?.user.walletAddress ?? null,
      auth?.isAdmin ?? false,
    );
    return jsonResponse(request, annotateRoomVersionRecordsWithTilesetHints(record.versions));
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

async function maybeMirrorPointEventToPlayfun(
  env: Env,
  request: Request,
  userId: string,
  pointEvent: { id: string; user_id: string; points: number; created_at: string },
): Promise<void> {
  if (pointEvent.points <= 0) {
    return;
  }

  const playfunSession = await linkPlayfunUserFromRequest(env, request, userId);
  if (!playfunSession) {
    return;
  }

  try {
    await enqueuePlayfunPointSync(env, pointEvent, playfunSession.ogpId);
    await flushPlayfunPointSync(env, userId);
  } catch (error) {
    console.warn('Failed to mirror room point event to Play.fun', { userId, pointEventId: pointEvent.id, error });
  }
}

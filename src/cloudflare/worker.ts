import { handleAdminRequest } from './worker/admin/routes';
import type { RoomRevertRequestBody } from '../persistence/roomModel';
import { handleAuthRequest } from './worker/auth/routes';
import { loadOptionalRequestAuth, requireAuthenticatedRequestAuth, requireOptionalScope } from './worker/auth/request';
import { handleAgentRequest } from './worker/agents/routes';
import { handleChatRequest } from './worker/chat/routes';
import {
  handleCourseCreate,
  handleCourseDraftSave,
  handleCourseGet,
  handleCourseLeaderboard,
  handleCoursePublish,
  handleCourseRunFinish,
  handleCourseRunStart,
} from './worker/courses/routes';
import { corsHeaders, getCoordinatesFromRequest, HttpError, jsonResponse, parseJsonBody, parseRoomSnapshot } from './worker/core/http';
import type { Env, RequestAuth } from './worker/core/types';
import { handleTestReset } from './worker/maintenance/routes';
import {
  handleRoomMintConfirm,
  handleRoomMintPrepare,
  handleRoomTokenMetadataConfirm,
  handleRoomTokenMetadataPrepare,
} from './worker/mint/routes';
import { syncRoomOwnershipFromChain } from './worker/mint/service';
import { handlePlayfunConfig, handlePlayfunFlush } from './worker/playfun/routes';
import {
  enqueuePlayfunPointSync,
  flushPlayfunPointSync,
  linkPlayfunUserFromRequest,
} from './worker/playfun/service';
import {
  handleGlobalLeaderboard,
  handleRoomDifficultyVote,
  handleRoomDiscovery,
  handleRoomLeaderboard,
  handleRunFinish,
  handleRunStart,
} from './worker/runs/routes';
import { awardRoomPublishPoints, upsertUserStats } from './worker/runs/points';
import {
  loadPublishedRoom,
  loadRoomRecord,
  publishRoom,
  revertRoom,
  saveDraft,
  type RoomMutationActor,
} from './worker/rooms/store';
import {
  handleClaimableFrontierRoomsRequest,
  handleWorldChunksRequest,
  handleWorldRequest,
} from './worker/world/routes';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request),
      });
    }

    try {
      if (url.pathname === '/api/health' && request.method === 'GET') {
        return jsonResponse(
          request,
          {
            ok: true,
            storage: 'd1',
            auth: {
              emailConfigured: Boolean(env.RESEND_API_KEY),
              debugMagicLinks: env.AUTH_DEBUG_MAGIC_LINKS === '1',
              testResetEnabled: env.ENABLE_TEST_RESET === '1',
            },
          }
        );
      }

      if (url.pathname.startsWith('/api/auth')) {
        return await handleAuthRequest(request, url, env);
      }

      if (url.pathname.startsWith('/api/agents')) {
        return await handleAgentRequest(request, url, env);
      }

      if (url.pathname.startsWith('/api/admin/')) {
        return await handleAdminRequest(request, url, env);
      }

      if (url.pathname === '/api/test/reset' && request.method === 'POST') {
        return await handleTestReset(request, env);
      }

      if (url.pathname.startsWith('/api/chat/')) {
        return await handleChatRequest(request, url, env);
      }

      if (url.pathname === '/api/world' && request.method === 'GET') {
        const auth = await loadOptionalRequestAuth(env, request);
        requireOptionalScope(auth, 'rooms:read', 'read world rooms');
        return handleWorldRequest(request, url, env);
      }

      if (url.pathname === '/api/world/claimable' && request.method === 'GET') {
        const auth = await requireAuthenticatedRequestAuth(
          env,
          request,
          'find claimable frontier rooms',
          'rooms:write'
        );
        return handleClaimableFrontierRoomsRequest(request, url, env, auth);
      }

      if (url.pathname === '/api/world/chunks' && request.method === 'GET') {
        const auth = await loadOptionalRequestAuth(env, request);
        requireOptionalScope(auth, 'rooms:read', 'read world room chunks');
        return handleWorldChunksRequest(request, url, env);
      }

      if (url.pathname === '/api/playfun/config' && request.method === 'GET') {
        return await handlePlayfunConfig(request, env);
      }

      if (url.pathname === '/api/playfun/flush' && request.method === 'POST') {
        return await handlePlayfunFlush(request, env);
      }

      if (url.pathname === '/api/runs/start' && request.method === 'POST') {
        return await handleRunStart(request, env);
      }

      if (url.pathname === '/api/courses' && request.method === 'POST') {
        return await handleCourseCreate(request, env);
      }

      const courseMatch = /^\/api\/courses\/([^/]+)$/.exec(url.pathname);
      if (courseMatch && request.method === 'GET') {
        return await handleCourseGet(request, env, decodeURIComponent(courseMatch[1]));
      }

      const courseDraftMatch = /^\/api\/courses\/([^/]+)\/draft$/.exec(url.pathname);
      if (courseDraftMatch && request.method === 'PUT') {
        return await handleCourseDraftSave(request, env, decodeURIComponent(courseDraftMatch[1]));
      }

      const coursePublishMatch = /^\/api\/courses\/([^/]+)\/publish$/.exec(url.pathname);
      if (coursePublishMatch && request.method === 'POST') {
        return await handleCoursePublish(request, env, decodeURIComponent(coursePublishMatch[1]));
      }

      const courseRunStartMatch = /^\/api\/courses\/([^/]+)\/runs\/start$/.exec(url.pathname);
      if (courseRunStartMatch && request.method === 'POST') {
        return await handleCourseRunStart(request, env, decodeURIComponent(courseRunStartMatch[1]));
      }

      const finishRunMatch = /^\/api\/runs\/([^/]+)\/finish$/.exec(url.pathname);
      if (finishRunMatch && request.method === 'POST') {
        return await handleRunFinish(request, env, decodeURIComponent(finishRunMatch[1]));
      }

      const finishCourseRunMatch = /^\/api\/course-runs\/([^/]+)\/finish$/.exec(url.pathname);
      if (finishCourseRunMatch && request.method === 'POST') {
        return await handleCourseRunFinish(request, env, decodeURIComponent(finishCourseRunMatch[1]));
      }

      if (url.pathname === '/api/leaderboards/rooms/discover' && request.method === 'GET') {
        return await handleRoomDiscovery(request, url, env);
      }

      const roomLeaderboardMatch = /^\/api\/leaderboards\/rooms\/([^/]+)$/.exec(url.pathname);
      if (roomLeaderboardMatch && request.method === 'GET') {
        return await handleRoomLeaderboard(
          request,
          url,
          env,
          decodeURIComponent(roomLeaderboardMatch[1])
        );
      }

      const roomDifficultyVoteMatch = /^\/api\/leaderboards\/rooms\/([^/]+)\/difficulty-vote$/.exec(
        url.pathname
      );
      if (roomDifficultyVoteMatch && request.method === 'POST') {
        return await handleRoomDifficultyVote(
          request,
          env,
          decodeURIComponent(roomDifficultyVoteMatch[1])
        );
      }

      const courseLeaderboardMatch = /^\/api\/leaderboards\/courses\/([^/]+)$/.exec(url.pathname);
      if (courseLeaderboardMatch && request.method === 'GET') {
        return await handleCourseLeaderboard(
          request,
          url,
          env,
          decodeURIComponent(courseLeaderboardMatch[1])
        );
      }

      if (url.pathname === '/api/leaderboards/global' && request.method === 'GET') {
        return await handleGlobalLeaderboard(request, url, env);
      }

      if (!url.pathname.startsWith('/api/rooms/')) {
        throw new HttpError(404, 'Route not found.');
      }

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
          auth?.isAdmin ?? false
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
              auth.isAdmin
            );
          } catch (error) {
            console.warn('Failed to refresh room ownership from chain during read', error);
          }
        }
        return jsonResponse(request, record);
      }

      if (segments.length === 4 && segments[3] === 'published' && request.method === 'GET') {
        const auth = await loadOptionalRequestAuth(env, request);
        requireOptionalScope(auth, 'rooms:read', 'read published rooms');
        const coordinates = getCoordinatesFromRequest(roomId, url.searchParams);
        const publishedRoom = await loadPublishedRoom(env, roomId, coordinates);

        if (!publishedRoom) {
          throw new HttpError(404, 'Published room not found.');
        }

        return jsonResponse(request, publishedRoom);
      }

      if (segments.length === 4 && segments[3] === 'draft' && request.method === 'PUT') {
        const snapshot = await parseRoomSnapshot(request, roomId);
        const auth = await requireAuthenticatedRequestAuth(
          env,
          request,
          'save room drafts',
          'rooms:write'
        );
        const record = await saveDraft(env, snapshot, buildRoomMutationActor(auth), auth.isAdmin);
        return jsonResponse(request, record);
      }

      if (segments.length === 4 && segments[3] === 'publish' && request.method === 'POST') {
        const snapshot = await parseRoomSnapshot(request, roomId);
        const auth = await requireAuthenticatedRequestAuth(
          env,
          request,
          'publish rooms',
          'rooms:write'
        );
        const record = await publishRoom(
          env,
          snapshot,
          buildRoomMutationActor(auth),
          auth.isAdmin
        );
        const pointEvent = await awardRoomPublishPoints(
          env,
          auth.user.id,
          record.draft.id,
          record.published?.version ?? record.draft.version,
          record.versions.length === 1
        );
        await maybeMirrorPointEventToPlayfun(env, request, auth.user.id, pointEvent);
        await upsertUserStats(env, auth.user.id);
        return jsonResponse(request, record);
      }

      if (segments.length === 4 && segments[3] === 'revert' && request.method === 'POST') {
        const coordinates = getCoordinatesFromRequest(roomId, url.searchParams);
        const body = await parseJsonBody<RoomRevertRequestBody>(request);
        const auth = await requireAuthenticatedRequestAuth(
          env,
          request,
          'revert rooms',
          'rooms:write'
        );
        const record = await revertRoom(
          env,
          roomId,
          coordinates,
          body.targetVersion,
          buildRoomMutationActor(auth),
          auth.isAdmin
        );
        const pointEvent = await awardRoomPublishPoints(
          env,
          auth.user.id,
          record.draft.id,
          record.published?.version ?? record.draft.version,
          false
        );
        await maybeMirrorPointEventToPlayfun(env, request, auth.user.id, pointEvent);
        await upsertUserStats(env, auth.user.id);
        return jsonResponse(request, record);
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
          auth?.isAdmin ?? false
        );
        return jsonResponse(request, record.versions);
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
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof Error ? error.message : 'Unexpected server error.';

      if (status >= 500) {
        console.error('API failure', error);
      }

      return jsonResponse(
        request,
        {
          error: message,
        },
        { status }
      );
    }
  },
};

async function maybeMirrorPointEventToPlayfun(
  env: Env,
  request: Request,
  userId: string,
  pointEvent: { id: string; user_id: string; points: number; created_at: string }
): Promise<void> {
  if (pointEvent.points <= 0) {
    return;
  }

  const playfunSession = await linkPlayfunUserFromRequest(env, request, userId);
  if (!playfunSession) {
    return;
  }

  await enqueuePlayfunPointSync(env, pointEvent, playfunSession.ogpId);
  await flushPlayfunPointSync(env, userId);
}

function buildRoomMutationActor(auth: RequestAuth): RoomMutationActor {
  return {
    ownerUser: auth.user,
    principalKind: auth.principal.kind,
    principalAgentId: auth.principal.agentId,
    principalDisplayName: auth.principal.displayName,
  };
}

import type { RoomRevertRequestBody } from '../persistence/roomModel';
import { handleAuthRequest } from './worker/auth/routes';
import { loadOptionalRequestAuth, requireAuthenticatedRequestAuth, requireOptionalScope } from './worker/auth/request';
import { handleChatRequest } from './worker/chat/routes';
import { corsHeaders, getCoordinatesFromRequest, HttpError, jsonResponse, parseJsonBody, parseRoomSnapshot } from './worker/core/http';
import type { Env } from './worker/core/types';
import { handleTestReset } from './worker/maintenance/routes';
import { handleRoomMintConfirm, handleRoomMintPrepare } from './worker/mint/routes';
import { syncRoomOwnershipFromChain } from './worker/mint/service';
import { handleGlobalLeaderboard, handleRoomLeaderboard, handleRunFinish, handleRunStart } from './worker/runs/routes';
import { awardRoomPublishPoints, upsertUserStats } from './worker/runs/points';
import { loadPublishedRoom, loadRoomRecord, publishRoom, revertRoom, saveDraft } from './worker/rooms/store';
import { handleWorldChunksRequest, handleWorldRequest } from './worker/world/routes';

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

      if (url.pathname === '/api/world/chunks' && request.method === 'GET') {
        const auth = await loadOptionalRequestAuth(env, request);
        requireOptionalScope(auth, 'rooms:read', 'read world room chunks');
        return handleWorldChunksRequest(request, url, env);
      }

      if (url.pathname === '/api/runs/start' && request.method === 'POST') {
        return await handleRunStart(request, env);
      }

      const finishRunMatch = /^\/api\/runs\/([^/]+)\/finish$/.exec(url.pathname);
      if (finishRunMatch && request.method === 'POST') {
        return await handleRunFinish(request, env, decodeURIComponent(finishRunMatch[1]));
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
          auth?.user.walletAddress ?? null
        );
        if (auth?.user) {
          try {
            await syncRoomOwnershipFromChain(env, record, auth.user);
            record = await loadRoomRecord(
              env,
              roomId,
              coordinates,
              auth.user.id,
              auth.user.walletAddress
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
        const record = await saveDraft(env, snapshot, auth.user);
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
        const record = await publishRoom(env, snapshot, auth.user);
        await awardRoomPublishPoints(
          env,
          auth.user.id,
          record.draft.id,
          record.published?.version ?? record.draft.version,
          record.versions.length === 1
        );
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
          auth.user
        );
        await awardRoomPublishPoints(
          env,
          auth.user.id,
          record.draft.id,
          record.published?.version ?? record.draft.version,
          false
        );
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
          auth?.user.walletAddress ?? null
        );
        return jsonResponse(request, record.versions);
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

import { handleAdminRequest } from './worker/admin/routes';
import { handleAuthRequest } from './worker/auth/routes';
import {
  handleAvatarSelectionUpdate,
  handleCryptopunkAvatarAsset,
  handleCryptopunkAvatarGenerate,
  handleCryptopunkAvatarStatus,
} from './worker/avatars/routes';
import { loadOptionalRequestAuth, requireAuthenticatedRequestAuth, requireOptionalScope } from './worker/auth/request';
import { handleBackgroundImageRequest } from './worker/backgroundImages/routes';
import { handleAgentRequest } from './worker/agents/routes';
import { handleDashboardStatsRequest } from './worker/dashboard/routes';
import { handleChatRequest } from './worker/chat/routes';
import { handleGuestActivityHeartbeat } from './worker/guestActivity/routes';
import { handleGuestRoomDraftRequest } from './worker/guestRoomDrafts/routes';
import { handleGuestbookRequest } from './worker/guestbook/routes';
import {
  handleCourseCreate,
  handleCourseDraftByRoomLookup,
  handleCourseDraftSave,
  handleCourseGet,
  handleCourseLeaderboard,
  handleCoursePublish,
  handleCourseRatingSubmit,
  handleCourseRunFinish,
  handleCourseRunStart,
  handleCourseUnpublish,
} from './worker/courses/routes';
import { corsHeaders, HttpError, jsonResponse } from './worker/core/http';
import type { Env } from './worker/core/types';
import {
  handleExpandedRoomByCoordinateGet,
  handleExpandedRoomGet,
} from './worker/expandedRooms/routes';
import {
  handleExpandedRoomCellAdd,
  handleExpandedRoomCellRemove,
  handleExpandedRoomCreate,
  handleExpandedRoomDraftByRoomLookup,
  handleExpandedRoomDraftSave,
  handleExpandedRoomEditorRecordGet,
  handleExpandedRoomPublish,
  handleExpandedRoomUnpublish,
} from './worker/expandedRooms/editorRoutes';
import {
  handleExpandedRoomLeaderboard,
  handleExpandedRoomRatingSubmit,
  handleExpandedRoomRunFinish,
  handleExpandedRoomRunStart,
} from './worker/expandedRooms/runRoutes';
import { handleTestReset } from './worker/maintenance/routes';
import {
  handleMusicPhraseDeleteRequest,
  handleMusicPhraseGetRequest,
  handleMusicPhraseListRequest,
} from './worker/music/routes';
import { handlePlayfunConfig, handlePlayfunFlush } from './worker/playfun/routes';
import {
  handleMyPlaylistsGet,
  handlePlaylistCreate,
  handlePlaylistDelete,
  handlePlaylistGetBySlug,
  handlePlaylistItemCreate,
  handlePlaylistItemDelete,
  handlePlaylistUpdate,
} from './worker/playlists/routes';
import { handleProfileGet, handleProfileGetByUsername, handleProfileUpdateMe } from './worker/profiles/routes';
import { handlePvpMatchSubmit } from './worker/pvp/routes';
import {
  handleBuilderDiscovery,
  handleGlobalLeaderboard,
  handleRoomDifficultyVote,
  handleRoomDiscovery,
  handleRoomLeaderboard,
  handleRoomRatingSubmit,
  handleRunFinish,
  handleRunStart,
} from './worker/runs/routes';
import {
  handleRoomRushLeaderboards,
  handleRoomRushRunSubmit,
} from './worker/runs/roomRushLeaderboards';
import {
  handleUserSettingsGet,
  handleUserSettingsPut,
} from './worker/userSettings/routes';
import {
  getAgentTilesetCatalogResponse,
  renderAgentTilesetMarkdown,
} from '../agentBuilder/tilesetCatalog';
import { handleRoomRequest } from './worker/rooms/routes';
import {
  handleClaimableFrontierRoomsRequest,
  handleWorldChunksRequest,
  handleWorldRequest,
} from './worker/world/routes';
import { handleRoomShareRequest } from './worker/share/routes';
import { handleSchoolRequest } from './worker/school/routes';
import { handleWampOGramRequest } from './worker/wampOGram/routes';

type WorkerExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
};

export default {
  async fetch(request: Request, env: Env, ctx?: WorkerExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const assetAlias = resolvePublicAssetAlias(url.pathname);

    if (assetAlias && (request.method === 'GET' || request.method === 'HEAD')) {
      return env.ASSETS.fetch(new Request(new URL(assetAlias, request.url), request));
    }

    if (url.pathname === '/agent-tilesets.md' && request.method === 'GET') {
      return new Response(renderAgentTilesetMarkdown(), {
        status: 200,
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          ...corsHeaders(request),
        },
      });
    }

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

      if (url.pathname === '/api/dashboard/stats' && request.method === 'GET') {
        return await handleDashboardStatsRequest(request, env);
      }

      if (url.pathname.startsWith('/api/auth')) {
        return await handleAuthRequest(request, url, env);
      }

      if (url.pathname.startsWith('/api/school')) {
        return await handleSchoolRequest(request, url, env);
      }

      if (url.pathname.startsWith('/api/agents')) {
        return await handleAgentRequest(request, url, env);
      }

      if (url.pathname.startsWith('/api/admin/')) {
        return await handleAdminRequest(request, url, env);
      }

      const cryptopunkAvatarStatusMatch = /^\/api\/avatars\/cryptopunks\/([^/]+)\/status$/.exec(url.pathname);
      if (cryptopunkAvatarStatusMatch && request.method === 'GET') {
        return await handleCryptopunkAvatarStatus(
          request,
          env,
          decodeURIComponent(cryptopunkAvatarStatusMatch[1])
        );
      }

      const cryptopunkAvatarGenerateMatch = /^\/api\/avatars\/cryptopunks\/([^/]+)\/generate$/.exec(url.pathname);
      if (cryptopunkAvatarGenerateMatch && request.method === 'POST') {
        return await handleCryptopunkAvatarGenerate(
          request,
          env,
          decodeURIComponent(cryptopunkAvatarGenerateMatch[1])
        );
      }

      const cryptopunkAvatarAssetMatch = /^\/api\/avatars\/cryptopunks\/([^/]+)\/files\/(.+)$/.exec(url.pathname);
      if (cryptopunkAvatarAssetMatch && request.method === 'GET') {
        return await handleCryptopunkAvatarAsset(
          request,
          env,
          decodeURIComponent(cryptopunkAvatarAssetMatch[1]),
          decodeURIComponent(cryptopunkAvatarAssetMatch[2])
        );
      }

      if (url.pathname.startsWith('/api/background-images')) {
        return await handleBackgroundImageRequest(request, url, env);
      }

      if (url.pathname === '/api/test/reset' && request.method === 'POST') {
        return await handleTestReset(request, env);
      }

      if (url.pathname.startsWith('/api/chat/')) {
        return await handleChatRequest(request, url, env, ctx);
      }

      if (url.pathname === '/api/guest-activity/heartbeat' && request.method === 'POST') {
        return await handleGuestActivityHeartbeat(request, env);
      }

      if (url.pathname.startsWith('/api/guest-room-drafts')) {
        return await handleGuestRoomDraftRequest(request, url, env);
      }

      if (url.pathname.startsWith('/api/guestbook')) {
        return await handleGuestbookRequest(request, url, env);
      }

      if (url.pathname === '/api/settings/me' && request.method === 'GET') {
        return await handleUserSettingsGet(request, env);
      }

      if (url.pathname === '/api/settings/me' && request.method === 'PUT') {
        return await handleUserSettingsPut(request, env);
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

      if (url.pathname === '/api/music/phrases' && request.method === 'GET') {
        return await handleMusicPhraseListRequest(request, url, env);
      }

      const musicPhraseMatch = /^\/api\/music\/phrases\/([^/]+)$/.exec(url.pathname);
      if (musicPhraseMatch && request.method === 'GET') {
        return await handleMusicPhraseGetRequest(
          request,
          env,
          decodeURIComponent(musicPhraseMatch[1])
        );
      }
      if (musicPhraseMatch && request.method === 'DELETE') {
        const auth = await requireAuthenticatedRequestAuth(
          env,
          request,
          'delete music phrases',
          'rooms:write'
        );
        return await handleMusicPhraseDeleteRequest(
          request,
          env,
          auth,
          decodeURIComponent(musicPhraseMatch[1])
        );
      }

      if (url.pathname === '/api/tilesets' && request.method === 'GET') {
        return jsonResponse(request, getAgentTilesetCatalogResponse());
      }

      if (url.pathname === '/api/playfun/flush' && request.method === 'POST') {
        return await handlePlayfunFlush(request, env);
      }

      if (url.pathname === '/api/playlists/me' && request.method === 'GET') {
        return await handleMyPlaylistsGet(request, env);
      }

      if (url.pathname === '/api/playlists' && request.method === 'POST') {
        return await handlePlaylistCreate(request, env);
      }

      const playlistItemMatch = /^\/api\/playlists\/([^/]+)\/items\/([^/]+)$/.exec(url.pathname);
      if (playlistItemMatch && request.method === 'DELETE') {
        return await handlePlaylistItemDelete(
          request,
          env,
          decodeURIComponent(playlistItemMatch[1]),
          decodeURIComponent(playlistItemMatch[2]),
        );
      }

      const playlistItemsMatch = /^\/api\/playlists\/([^/]+)\/items$/.exec(url.pathname);
      if (playlistItemsMatch && request.method === 'POST') {
        return await handlePlaylistItemCreate(
          request,
          env,
          decodeURIComponent(playlistItemsMatch[1]),
        );
      }

      const playlistBySlugMatch = /^\/api\/playlists\/by-slug\/([^/]+)$/.exec(url.pathname);
      if (playlistBySlugMatch && request.method === 'GET') {
        return await handlePlaylistGetBySlug(
          request,
          env,
          decodeURIComponent(playlistBySlugMatch[1]),
        );
      }

      const playlistMatch = /^\/api\/playlists\/([^/]+)$/.exec(url.pathname);
      if (playlistMatch && request.method === 'PATCH') {
        return await handlePlaylistUpdate(
          request,
          env,
          decodeURIComponent(playlistMatch[1]),
        );
      }
      if (playlistMatch && request.method === 'DELETE') {
        return await handlePlaylistDelete(
          request,
          env,
          decodeURIComponent(playlistMatch[1]),
        );
      }

      if (url.pathname === '/api/profiles/me' && request.method === 'PATCH') {
        return await handleProfileUpdateMe(request, env);
      }

      if (url.pathname === '/api/profiles/me/avatar' && request.method === 'POST') {
        return await handleAvatarSelectionUpdate(request, env);
      }

      const profileByUsernameMatch = /^\/api\/profiles\/by-username\/([^/]+)$/.exec(url.pathname);
      if (profileByUsernameMatch && request.method === 'GET') {
        return await handleProfileGetByUsername(request, env, decodeURIComponent(profileByUsernameMatch[1]));
      }

      const profileMatch = /^\/api\/profiles\/([^/]+)$/.exec(url.pathname);
      if (profileMatch && request.method === 'GET') {
        return await handleProfileGet(request, env, decodeURIComponent(profileMatch[1]));
      }

      if (url.pathname === '/api/runs/start' && request.method === 'POST') {
        return await handleRunStart(request, env);
      }

      if (url.pathname === '/api/expanded-rooms' && request.method === 'POST') {
        return await handleExpandedRoomCreate(request, env);
      }

      const expandedRoomRunStartMatch = /^\/api\/expanded-rooms\/([^/]+)\/runs\/start$/.exec(url.pathname);
      if (expandedRoomRunStartMatch && request.method === 'POST') {
        return await handleExpandedRoomRunStart(
          request,
          env,
          decodeURIComponent(expandedRoomRunStartMatch[1]),
        );
      }

      const expandedRoomByCoordinateMatch =
        /^\/api\/expanded-rooms\/by-coordinate\/(-?\d+)\/(-?\d+)$/.exec(url.pathname);
      if (expandedRoomByCoordinateMatch && request.method === 'GET') {
        return await handleExpandedRoomByCoordinateGet(
          request,
          env,
          expandedRoomByCoordinateMatch[1],
          expandedRoomByCoordinateMatch[2]
        );
      }

      const expandedRoomDraftByRoomMatch = /^\/api\/expanded-rooms\/drafts\/by-room\/([^/]+)$/.exec(url.pathname);
      if (expandedRoomDraftByRoomMatch && request.method === 'GET') {
        return await handleExpandedRoomDraftByRoomLookup(
          request,
          env,
          decodeURIComponent(expandedRoomDraftByRoomMatch[1])
        );
      }

      const expandedRoomEditorRecordMatch = /^\/api\/expanded-rooms\/([^/]+)\/editor-record$/.exec(url.pathname);
      if (expandedRoomEditorRecordMatch && request.method === 'GET') {
        return await handleExpandedRoomEditorRecordGet(
          request,
          env,
          decodeURIComponent(expandedRoomEditorRecordMatch[1])
        );
      }

      const expandedRoomDraftMatch = /^\/api\/expanded-rooms\/([^/]+)\/draft$/.exec(url.pathname);
      if (expandedRoomDraftMatch && request.method === 'PUT') {
        return await handleExpandedRoomDraftSave(
          request,
          env,
          decodeURIComponent(expandedRoomDraftMatch[1])
        );
      }

      const expandedRoomPublishMatch = /^\/api\/expanded-rooms\/([^/]+)\/publish$/.exec(url.pathname);
      if (expandedRoomPublishMatch && request.method === 'POST') {
        return await handleExpandedRoomPublish(
          request,
          env,
          decodeURIComponent(expandedRoomPublishMatch[1])
        );
      }

      const expandedRoomUnpublishMatch = /^\/api\/expanded-rooms\/([^/]+)\/unpublish$/.exec(url.pathname);
      if (expandedRoomUnpublishMatch && request.method === 'POST') {
        return await handleExpandedRoomUnpublish(
          request,
          env,
          decodeURIComponent(expandedRoomUnpublishMatch[1])
        );
      }

      const expandedRoomCellAddMatch = /^\/api\/expanded-rooms\/([^/]+)\/cells$/.exec(url.pathname);
      if (expandedRoomCellAddMatch && request.method === 'POST') {
        return await handleExpandedRoomCellAdd(
          request,
          env,
          decodeURIComponent(expandedRoomCellAddMatch[1])
        );
      }

      const expandedRoomCellRemoveMatch = /^\/api\/expanded-rooms\/([^/]+)\/cells\/([^/]+)$/.exec(url.pathname);
      if (expandedRoomCellRemoveMatch && request.method === 'DELETE') {
        return await handleExpandedRoomCellRemove(
          request,
          env,
          decodeURIComponent(expandedRoomCellRemoveMatch[1]),
          decodeURIComponent(expandedRoomCellRemoveMatch[2])
        );
      }

      const expandedRoomMatch = /^\/api\/expanded-rooms\/([^/]+)$/.exec(url.pathname);
      if (expandedRoomMatch && request.method === 'GET') {
        return await handleExpandedRoomGet(
          request,
          env,
          decodeURIComponent(expandedRoomMatch[1])
        );
      }

      if (url.pathname === '/api/courses' && request.method === 'POST') {
        return await handleCourseCreate(request, env);
      }

      const courseMatch = /^\/api\/courses\/([^/]+)$/.exec(url.pathname);
      if (courseMatch && request.method === 'GET') {
        return await handleCourseGet(request, env, decodeURIComponent(courseMatch[1]));
      }

      const courseDraftByRoomMatch = /^\/api\/courses\/drafts\/by-room\/([^/]+)$/.exec(url.pathname);
      if (courseDraftByRoomMatch && request.method === 'GET') {
        return await handleCourseDraftByRoomLookup(
          request,
          env,
          decodeURIComponent(courseDraftByRoomMatch[1])
        );
      }

      const courseDraftMatch = /^\/api\/courses\/([^/]+)\/draft$/.exec(url.pathname);
      if (courseDraftMatch && request.method === 'PUT') {
        return await handleCourseDraftSave(request, env, decodeURIComponent(courseDraftMatch[1]));
      }

      const coursePublishMatch = /^\/api\/courses\/([^/]+)\/publish$/.exec(url.pathname);
      if (coursePublishMatch && request.method === 'POST') {
        return await handleCoursePublish(request, env, decodeURIComponent(coursePublishMatch[1]));
      }

      const courseUnpublishMatch = /^\/api\/courses\/([^/]+)\/unpublish$/.exec(url.pathname);
      if (courseUnpublishMatch && request.method === 'POST') {
        return await handleCourseUnpublish(request, env, decodeURIComponent(courseUnpublishMatch[1]));
      }

      const courseRunStartMatch = /^\/api\/courses\/([^/]+)\/runs\/start$/.exec(url.pathname);
      if (courseRunStartMatch && request.method === 'POST') {
        return await handleCourseRunStart(request, env, decodeURIComponent(courseRunStartMatch[1]));
      }

      const finishRunMatch = /^\/api\/runs\/([^/]+)\/finish$/.exec(url.pathname);
      if (finishRunMatch && request.method === 'POST') {
        return await handleRunFinish(request, env, decodeURIComponent(finishRunMatch[1]));
      }

      const finishExpandedRoomRunMatch = /^\/api\/expanded-room-runs\/([^/]+)\/finish$/.exec(url.pathname);
      if (finishExpandedRoomRunMatch && request.method === 'POST') {
        return await handleExpandedRoomRunFinish(
          request,
          env,
          decodeURIComponent(finishExpandedRoomRunMatch[1]),
        );
      }

      const finishCourseRunMatch = /^\/api\/course-runs\/([^/]+)\/finish$/.exec(url.pathname);
      if (finishCourseRunMatch && request.method === 'POST') {
        return await handleCourseRunFinish(request, env, decodeURIComponent(finishCourseRunMatch[1]));
      }

      if (url.pathname === '/api/leaderboards/rooms/discover' && request.method === 'GET') {
        return await handleRoomDiscovery(request, url, env);
      }

      if (url.pathname === '/api/leaderboards/builders/discover' && request.method === 'GET') {
        return await handleBuilderDiscovery(request, url, env);
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

      const roomRatingMatch = /^\/api\/rooms\/([^/]+)\/ratings$/.exec(url.pathname);
      if (roomRatingMatch && request.method === 'POST') {
        return await handleRoomRatingSubmit(
          request,
          env,
          decodeURIComponent(roomRatingMatch[1]),
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

      const expandedRoomLeaderboardMatch = /^\/api\/leaderboards\/expanded-rooms\/([^/]+)$/.exec(url.pathname);
      if (expandedRoomLeaderboardMatch && request.method === 'GET') {
        return await handleExpandedRoomLeaderboard(
          request,
          url,
          env,
          decodeURIComponent(expandedRoomLeaderboardMatch[1]),
        );
      }

      const expandedRoomRatingMatch = /^\/api\/expanded-rooms\/([^/]+)\/ratings$/.exec(url.pathname);
      if (expandedRoomRatingMatch && request.method === 'POST') {
        return await handleExpandedRoomRatingSubmit(
          request,
          env,
          decodeURIComponent(expandedRoomRatingMatch[1]),
        );
      }

      const courseRatingMatch = /^\/api\/courses\/([^/]+)\/ratings$/.exec(url.pathname);
      if (courseRatingMatch && request.method === 'POST') {
        return await handleCourseRatingSubmit(
          request,
          env,
          decodeURIComponent(courseRatingMatch[1]),
        );
      }

      if (url.pathname === '/api/leaderboards/global' && request.method === 'GET') {
        return await handleGlobalLeaderboard(request, url, env);
      }

      if (url.pathname === '/api/leaderboards/room-rush' && request.method === 'GET') {
        return await handleRoomRushLeaderboards(request, url, env);
      }

      if (url.pathname === '/api/room-rush/runs' && request.method === 'POST') {
        return await handleRoomRushRunSubmit(request, env);
      }

      if (url.pathname === '/api/pvp/matches' && request.method === 'POST') {
        return await handlePvpMatchSubmit(request, env);
      }

      if (url.pathname.startsWith('/api/share/rooms/')) {
        return await handleRoomShareRequest(request, url, env);
      }

      if (url.pathname.startsWith('/api/wamp-o-grams')) {
        return await handleWampOGramRequest(request, url, env);
      }

      if (!url.pathname.startsWith('/api/rooms/')) {
        throw new HttpError(404, 'Route not found.');
      }

      return await handleRoomRequest(request, url, env);
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

function resolvePublicAssetAlias(pathname: string): string | null {
  if (pathname === '/dashboard' || pathname === '/dashboard/') {
    return '/dashboard.html';
  }

  return null;
}

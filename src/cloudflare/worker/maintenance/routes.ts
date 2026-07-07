import { clearSessionCookie } from '../auth/request';
import { HttpError, jsonResponse } from '../core/http';
import type { Env } from '../core/types';
import {
  LEGACY_GENERATED_POINT_SYNC_TABLE,
  LEGACY_GENERATED_USER_LINKS_TABLE,
} from '../generatedUsers/legacySource';

export async function handleTestReset(request: Request, env: Env): Promise<Response> {
  if (env.ENABLE_TEST_RESET !== '1') {
    throw new HttpError(403, 'Test reset is disabled for this Worker.');
  }

  const counts = {
    rooms: await countRows(env, 'rooms'),
    roomVersions: await countRows(env, 'room_versions'),
    roomRuns: await countRows(env, 'room_runs'),
    roomRushRuns: await countRows(env, 'room_rush_runs'),
    pvpMatches: await countRows(env, 'pvp_matches'),
    roomDifficultyVotes: await countRows(env, 'room_difficulty_votes'),
    guestRoomDrafts: await countRows(env, 'guest_room_drafts'),
    courses: await countRows(env, 'courses'),
    courseVersions: await countRows(env, 'course_versions'),
    courseRoomRefs: await countRows(env, 'course_room_refs'),
    courseRuns: await countRows(env, 'course_runs'),
    expandedRooms: await countRows(env, 'expanded_rooms'),
    expandedRoomVersions: await countRows(env, 'expanded_room_versions'),
    expandedRoomCells: await countRows(env, 'expanded_room_cells'),
    expandedRoomRuns: await countRows(env, 'expanded_room_runs'),
    expandedRoomRatings: await countRows(env, 'expanded_room_ratings'),
    userStats: await countRows(env, 'user_stats'),
    legacyGeneratedPointSync: await countRows(env, LEGACY_GENERATED_POINT_SYNC_TABLE),
    legacyGeneratedUserLinks: await countRows(env, LEGACY_GENERATED_USER_LINKS_TABLE),
    chatMessages: await countRows(env, 'chat_messages'),
    agents: await countRows(env, 'agents'),
    agentTokens: await countRows(env, 'agent_tokens'),
    users: await countRows(env, 'users'),
    sessions: await countRows(env, 'sessions'),
    magicLinks: await countRows(env, 'magic_link_tokens'),
    walletChallenges: await countRows(env, 'wallet_challenges'),
    apiTokens: await countRows(env, 'api_tokens'),
  };

  await env.DB.batch([
    env.DB.prepare('DELETE FROM api_tokens'),
    env.DB.prepare('DELETE FROM magic_link_tokens'),
    env.DB.prepare('DELETE FROM sessions'),
    env.DB.prepare('DELETE FROM wallet_challenges'),
    env.DB.prepare(`DELETE FROM ${LEGACY_GENERATED_POINT_SYNC_TABLE}`),
    env.DB.prepare(`DELETE FROM ${LEGACY_GENERATED_USER_LINKS_TABLE}`),
    env.DB.prepare('DELETE FROM user_stats'),
    env.DB.prepare('DELETE FROM expanded_room_ratings'),
    env.DB.prepare('DELETE FROM expanded_room_runs'),
    env.DB.prepare('DELETE FROM expanded_room_cells'),
    env.DB.prepare('DELETE FROM expanded_room_versions'),
    env.DB.prepare('DELETE FROM expanded_rooms'),
    env.DB.prepare('DELETE FROM course_runs'),
    env.DB.prepare('DELETE FROM course_room_refs'),
    env.DB.prepare('DELETE FROM course_versions'),
    env.DB.prepare('DELETE FROM courses'),
    env.DB.prepare('DELETE FROM pvp_match_players'),
    env.DB.prepare('DELETE FROM pvp_matches'),
    env.DB.prepare('DELETE FROM room_rush_runs'),
    env.DB.prepare('DELETE FROM room_runs'),
    env.DB.prepare('DELETE FROM room_difficulty_votes'),
    env.DB.prepare('DELETE FROM guest_room_drafts'),
    env.DB.prepare('DELETE FROM chat_messages'),
    env.DB.prepare('DELETE FROM agent_tokens'),
    env.DB.prepare('DELETE FROM agents'),
    env.DB.prepare('DELETE FROM room_versions'),
    env.DB.prepare('DELETE FROM rooms'),
    env.DB.prepare('DELETE FROM users'),
  ]);

  return jsonResponse(
    request,
    {
      ok: true,
      deleted: counts,
    },
    {
      headers: {
        'Set-Cookie': clearSessionCookie(request),
      },
    }
  );
}

export async function countRows(env: Env, tableName: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).first<{
    count: number | string | null;
  }>();

  return Number(row?.count ?? 0);
}

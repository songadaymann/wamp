import type {
  PvpMatchSubmissionRequestBody,
  PvpMatchSubmissionResponse,
} from '../../../pvp/model';
import { createEmptyProgressionDelta, parseRowNumber } from '../progression/shared';
import { loadPublicProgressionSummary } from '../progression/store';
import { requireAuthenticatedRequestAuth } from '../auth/request';
import { HttpError, jsonResponse, parseJsonBody } from '../core/http';
import type { Env, PvpMatchPlayerRow } from '../core/types';

/**
 * The presence room that ran a match saves its result (see ./store.ts). This reports what was
 * saved for the caller; anything else in the request body is ignored.
 */
export async function handlePvpMatchSubmit(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(env, request, 'submit PVP matches', 'runs:write');
  const body = await parseJsonBody<PvpMatchSubmissionRequestBody>(request);
  const matchId = normalizeMatchId(body?.matchId);
  const row = await env.DB.prepare(
    `
      SELECT xp_awarded
      FROM pvp_match_players
      WHERE match_id = ?
        AND user_id = ?
      LIMIT 1
    `
  )
    .bind(matchId, auth.user.id)
    .first<Pick<PvpMatchPlayerRow, 'xp_awarded'>>();

  const progressionDelta = createEmptyProgressionDelta();
  progressionDelta.pxp = row ? parseRowNumber(row.xp_awarded) : 0;
  return jsonResponse(request, {
    saved: Boolean(row),
    matchId,
    progressionDelta,
    progression: await loadPublicProgressionSummary(env, auth.user.id),
  } satisfies PvpMatchSubmissionResponse);
}

function normalizeMatchId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, 'Match id is required.');
  }

  return value.trim().slice(0, 96);
}

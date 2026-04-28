import { cloneRoomGoal, normalizeRoomGoal, type RoomGoal } from '../../../goals/roomGoals';
import { cloneRoomSnapshot, type RoomRecord, type RoomSnapshot } from '../../../persistence/roomModel';
import { computeRunScore, sortCompletedRunsForLeaderboard } from '../../../runs/scoring';
import { RANKED_RUN_TRACE_SCHEMA_VERSION } from '../../../runs/verificationTrace';
import type {
  RoomRunRecord,
  RunFinishRequestBody,
  RunStartResponse,
} from '../../../runs/model';
import {
  HttpError,
  getCoordinatesFromRequest,
  jsonResponse,
  noContentResponse,
  parseOptionalPositiveIntegerQueryParam,
  parsePositiveIntegerQueryParam,
} from '../core/http';
import type { Env, RoomRunRow } from '../core/types';
import { requireAuthenticatedRequestAuth, loadOptionalRequestAuth, requireOptionalScope } from '../auth/request';
import { loadRoomRecord } from '../rooms/store';
import {
  enqueuePlayfunPointSync,
  flushPlayfunPointSync,
  linkPlayfunUserFromRequest,
  loadPlayfunUserLink,
} from '../playfun/service';
import {
  assertWampLeaderboardWriteAllowed,
  sqlUserIdIsNotPlayfunOnly,
} from '../playfun/leaderboardIsolation';
import {
  awardRoomCreatorCompletionPoints,
  awardRunFinalizePoints,
  clampRunMetricsToSnapshot,
  getRunMetricCapsForSnapshot,
  loadBestCompletedRunForUserAndRoomVersion,
  previewRunFinalizePoints,
  upsertUserStats,
} from './points';
import {
  loadRoomDiscoveryResponse,
  parseRoomDiscoverySortOrThrow,
  parseRoomDifficultyOrThrow,
} from './difficulty';
import {
  parseRoomDifficultyVoteBody,
  parseRoomRatingBody,
  parseRunFinishBody,
  parseRunStartBody,
} from './requestBodies';
import {
  resolveAggregatedRoomLeaderboardSelection,
} from './roomLeaderboardAggregation';
import {
  awardRoomRunProgression,
  loadEffectiveTrustTier,
  submitRoomRating,
} from '../progression/store';
import {
  computeRoomSnapshotVerificationHash,
  createRoomVerificationTrigger,
  createRunVerificationNonce,
  relaxVerificationTriggerForTrustTier,
  recordRunVerificationAudit,
  requireVerificationTrace,
  type RunVerificationFailureReason,
  verifyRoomRunTrace,
} from './verification';
import {
  buildGlobalLeaderboardResponse,
  buildRoomLeaderboardResponse,
  loadRankedRoomLeaderboardRows,
  loadViewerRankedRoomLeaderboardRow,
  sqlIsVerificationAccepted,
} from './leaderboards';

export async function handleRunStart(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'submit leaderboard runs',
    'runs:write'
  );
  await assertWampLeaderboardWriteAllowed(env, auth, 'play');
  const body = await parseRunStartBody(request);
  const record = await loadRoomRecord(env, body.roomId, body.roomCoordinates, auth.user.id);
  const snapshot = resolveRoomSnapshotForVersion(record, body.roomVersion);

  if (!record.published || snapshot.status !== 'published') {
    throw new HttpError(409, 'Only published room versions can accept leaderboard submissions.');
  }

  if (!snapshot.goal) {
    throw new HttpError(400, 'This room version does not have an active goal.');
  }

  const canonicalGoal = cloneRoomGoal(snapshot.goal);
  if (JSON.stringify(canonicalGoal) !== JSON.stringify(body.goal)) {
    throw new HttpError(409, 'Run goal does not match the published room version.');
  }

  const attemptId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const verificationNonce = createRunVerificationNonce();
  const snapshotHash = await computeRoomSnapshotVerificationHash(snapshot);

  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO room_runs (
          attempt_id,
          room_id,
          room_x,
          room_y,
          room_version,
          goal_type,
          goal_json,
          user_id,
          user_display_name,
          started_at,
          finished_at,
          result,
          elapsed_ms,
          deaths,
          score,
          collectibles_collected,
          enemies_defeated,
          checkpoints_reached,
          verification_status,
          verification_reason,
          verification_nonce,
          verification_snapshot_hash
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'active', NULL, 0, 0, 0, 0, 0, 'not_required', NULL, ?, ?)
      `
    ).bind(
      attemptId,
      snapshot.id,
      snapshot.coordinates.x,
      snapshot.coordinates.y,
      snapshot.version,
      canonicalGoal!.type,
      JSON.stringify(canonicalGoal),
      auth.user.id,
      auth.user.displayName,
      startedAt,
      verificationNonce,
      snapshotHash
    ),
  ]);

  const responseBody: RunStartResponse = {
    attemptId,
    roomId: snapshot.id,
    roomVersion: snapshot.version,
    goalType: canonicalGoal!.type,
    startedAt,
    userId: auth.user.id,
    userDisplayName: auth.user.displayName,
    verificationSchemaVersion: RANKED_RUN_TRACE_SCHEMA_VERSION,
    verificationNonce,
    snapshotHash,
  };

  return jsonResponse(request, responseBody);
}

export async function handleRunFinish(
  request: Request,
  env: Env,
  attemptId: string
): Promise<Response> {
  if (!attemptId) {
    throw new HttpError(400, 'Attempt id is required.');
  }

  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'submit leaderboard runs',
    'runs:write'
  );
  await assertWampLeaderboardWriteAllowed(env, auth, 'play');
  const body = await parseRunFinishBody(request);
  const existing = await loadRoomRunByAttemptId(env, attemptId);

  if (!existing) {
    throw new HttpError(404, 'Run attempt was not found.');
  }

  if (existing.userId !== auth.user.id) {
    throw new HttpError(403, 'You can only finish your own run attempts.');
  }

  if (existing.result !== 'active') {
    throw new HttpError(409, 'This run attempt has already been finalized.');
  }

  const roomRecord = await loadRoomRecord(
    env,
    existing.roomId,
    existing.roomCoordinates,
    auth.user.id,
    auth.user.walletAddress ?? null
  );
  const snapshot = resolveRoomSnapshotForVersion(roomRecord, existing.roomVersion);
  if (!snapshot.goal) {
    throw new HttpError(409, 'This room version no longer has a leaderboard goal.');
  }

  const metricCaps = getRunMetricCapsForSnapshot(snapshot);
  const clampedMetrics = clampRunMetricsToSnapshot(snapshot, {
    collectiblesCollected: body.collectiblesCollected,
    enemiesDefeated: body.enemiesDefeated,
    checkpointsReached: body.checkpointsReached,
  });
  const finishedAt = new Date().toISOString();
  const reportedElapsedMs = body.elapsedMs;
  const clampedBody: RunFinishRequestBody = {
    ...normalizeFinalizedRunBody(
      snapshot.goal,
      {
        ...body,
        elapsedMs: computeEffectiveElapsedMs(existing.startedAt, finishedAt, reportedElapsedMs),
        collectiblesCollected: clampedMetrics.collectiblesCollected,
        enemyCollectiblesCollected: Math.min(
          metricCaps.maxCollectibles,
          body.enemyCollectiblesCollected,
        ),
        enemiesDefeated: clampedMetrics.enemiesDefeated,
        checkpointsReached: clampedMetrics.checkpointsReached,
      },
      metricCaps,
      reportedElapsedMs
    ),
    finishedAt,
  };
  const leaderboardSelection = resolveAggregatedRoomLeaderboardSelection(
    roomRecord,
    existing.roomVersion,
  );
  const provisionalScore =
    clampedBody.result === 'completed' ? computeRunScore(snapshot.goal, clampedBody) : 0;
  const provisionalPreviousBest =
    clampedBody.result === 'completed'
      ? await loadBestCompletedRunForUserAndRoomVersion(
          env,
          auth.user.id,
          existing.roomId,
          existing.roomVersion,
          snapshot.goal,
        )
      : null;
  const provisionalIsFirstCompletion =
    clampedBody.result === 'completed' && provisionalPreviousBest === null;
  const provisionalCandidateRun: RoomRunRecord | null =
    clampedBody.result === 'completed'
      ? {
          attemptId,
          roomId: existing.roomId,
          roomCoordinates: existing.roomCoordinates,
          roomVersion: existing.roomVersion,
          goalType: existing.goalType,
          goal: snapshot.goal,
          userId: auth.user.id,
          userDisplayName: auth.user.displayName,
          startedAt: existing.startedAt,
          finishedAt,
          result: clampedBody.result,
          elapsedMs: clampedBody.elapsedMs,
          deaths: clampedBody.deaths,
          score: provisionalScore,
          collectiblesCollected: clampedBody.collectiblesCollected,
          enemiesDefeated: clampedBody.enemiesDefeated,
          checkpointsReached: clampedBody.checkpointsReached,
        }
      : null;
  const provisionalIsNewPersonalBest =
    provisionalCandidateRun !== null &&
    (provisionalPreviousBest === null ||
      sortCompletedRunsForLeaderboard(
        [provisionalCandidateRun, provisionalPreviousBest],
        snapshot.goal,
      )[0]?.attemptId === provisionalCandidateRun.attemptId);
  const provisionalPointAward =
    provisionalCandidateRun !== null
      ? previewRunFinalizePoints(provisionalCandidateRun, {
          isFirstCompletion: provisionalIsFirstCompletion,
          isNewPersonalBest: provisionalIsNewPersonalBest,
        })
      : null;
  const currentTopRows =
    clampedBody.result === 'completed'
      ? await loadRankedRoomLeaderboardRows(
          env,
          snapshot.id,
          leaderboardSelection.leaderboardFamilyVersions,
          snapshot.goal,
          10,
        )
      : [];
  const viewerBestRow =
    clampedBody.result === 'completed'
      ? await loadViewerRankedRoomLeaderboardRow(
          env,
          snapshot.id,
          leaderboardSelection.leaderboardFamilyVersions,
          snapshot.goal,
          auth.user.id,
        )
      : null;
  const baseVerificationTrigger =
    clampedBody.result === 'completed'
      ? createRoomVerificationTrigger(snapshot.goal, {
          candidate: {
            attemptId,
            userId: auth.user.id,
            elapsedMs: clampedBody.elapsedMs,
            deaths: clampedBody.deaths,
            score: provisionalScore,
            finishedAt,
          },
          currentTopEntries: currentTopRows.map((row) => ({
            attemptId: row.attempt_id,
            userId: row.user_id,
            elapsedMs: row.elapsed_ms,
            deaths: row.deaths,
            score: row.score,
            finishedAt: row.finished_at,
            overallRank: row.overall_rank === null ? null : Number(row.overall_rank),
          })),
          viewerEntry:
            viewerBestRow === null
              ? null
              : {
                  attemptId: viewerBestRow.attempt_id,
                  userId: viewerBestRow.user_id,
                  elapsedMs: viewerBestRow.elapsed_ms,
                  deaths: viewerBestRow.deaths,
                  score: viewerBestRow.score,
                  finishedAt: viewerBestRow.finished_at,
                  overallRank:
                    viewerBestRow.overall_rank === null ? null : Number(viewerBestRow.overall_rank),
                },
          pointAwardPotential: (provisionalPointAward?.points ?? 0) > 0,
        })
      : null;
  const effectiveTrustTier =
    baseVerificationTrigger === null
      ? 'T0'
      : await loadEffectiveTrustTier(env, auth.user.id);
  const verificationTrigger =
    baseVerificationTrigger === null
      ? null
      : relaxVerificationTriggerForTrustTier(
          baseVerificationTrigger,
          effectiveTrustTier,
        );
  const shouldAuditRelaxedVerification =
    effectiveTrustTier === 'T1' && Boolean(baseVerificationTrigger?.required);

  let finalBody = clampedBody;
  let finalScore = provisionalScore;
  let verificationStatus: 'not_required' | 'passed' | 'failed' | 'timeout' = 'not_required';
  let verificationReason: RunVerificationFailureReason | null = null;
  let verificationAudit:
    | {
        status: 'passed' | 'failed' | 'timeout';
        reason: RunVerificationFailureReason | null;
        summary: Record<string, unknown>;
      }
    | null = null;

  if (verificationTrigger?.required) {
    let verificationResult;
    try {
      verificationResult = await verifyRoomRunTrace({
        trace: requireVerificationTrace(clampedBody.verificationTrace),
        binding: {
          verificationNonce: existing.verificationNonce ?? null,
          verificationSnapshotHash: existing.verificationSnapshotHash ?? null,
        },
        room: snapshot,
        elapsedMs: clampedBody.elapsedMs,
      });
    } catch (error) {
      if (!(error instanceof HttpError)) {
        throw error;
      }
      verificationResult = {
        status: 'failed' as const,
        reason: 'missing_trace' as const,
        derivedMetrics: {
          collectiblesCollected: 0,
          enemyCollectiblesCollected: 0,
          enemiesDefeated: 0,
          checkpointsReached: 0,
        },
        summary: {
          issue: 'missing_trace',
        },
      };
    }

    verificationStatus = verificationResult.status;
    verificationReason = verificationResult.reason;
    verificationAudit = {
      status: verificationResult.status,
      reason: verificationResult.reason,
      summary: {
        trigger: verificationTrigger,
        verifier: verificationResult.summary,
      },
    };

    if (verificationResult.status === 'passed') {
      finalBody = normalizeFinalizedRunBody(
        snapshot.goal,
        {
        ...clampedBody,
        collectiblesCollected: verificationResult.derivedMetrics.collectiblesCollected,
        enemyCollectiblesCollected: verificationResult.derivedMetrics.enemyCollectiblesCollected,
        enemiesDefeated: verificationResult.derivedMetrics.enemiesDefeated,
        checkpointsReached: verificationResult.derivedMetrics.checkpointsReached,
        },
        metricCaps,
        reportedElapsedMs,
      );
      finalScore = computeRunScore(snapshot.goal, finalBody);
    }
  }

  await env.DB.batch([
    env.DB.prepare(
      `
        UPDATE room_runs
        SET
          finished_at = ?,
          result = ?,
          elapsed_ms = ?,
          deaths = ?,
          score = ?,
          collectibles_collected = ?,
          enemies_defeated = ?,
          checkpoints_reached = ?,
          verification_status = ?,
          verification_reason = ?
        WHERE attempt_id = ?
      `
    ).bind(
      finishedAt,
      finalBody.result,
      finalBody.elapsedMs,
      finalBody.deaths,
      finalScore,
      finalBody.collectiblesCollected,
      finalBody.enemiesDefeated,
      finalBody.checkpointsReached,
      verificationStatus,
      verificationReason,
      attemptId
    ),
  ]);

  if (verificationTrigger?.required && verificationAudit) {
    await recordRunVerificationAudit(env, {
      attemptId,
      kind: 'room',
      status: verificationAudit.status,
      triggerReason: verificationTrigger.reason ?? 'record_gap',
      verificationReason: verificationAudit.reason,
      summary: verificationAudit.summary,
      trace: finalBody.verificationTrace ?? null,
      createdAt: finishedAt,
    });
  } else if (shouldAuditRelaxedVerification && baseVerificationTrigger) {
    await recordRunVerificationAudit(env, {
      attemptId,
      kind: 'room',
      status: 'skipped',
      triggerReason: baseVerificationTrigger.reason ?? 'record_gap',
      verificationReason: null,
      summary: {
        trigger: baseVerificationTrigger,
        policy: 't1_audit_only',
        trustTier: effectiveTrustTier,
        verifier: null,
      },
      trace: null,
      createdAt: finishedAt,
    });
  }

  if (verificationStatus === 'failed') {
    throw new HttpError(
      409,
      verificationReason === 'missing_trace'
        ? 'Missing verification trace for ranked run.'
        : verificationReason === 'trace_client_outdated'
          ? 'Client update required for ranked verification.'
          : 'Ranked run could not be verified.',
    );
  }

  if (verificationStatus === 'timeout') {
    throw new HttpError(409, 'Ranked run verification timed out.');
  }

  const finalizedRun = await loadRoomRunByAttemptId(env, attemptId);
  if (!finalizedRun) {
    throw new HttpError(500, 'Failed to reload finalized run.');
  }

  let isFirstCompletion = false;
  let isNewPersonalBest = false;
  if (finalizedRun.result === 'completed') {
    const previousBest = await loadBestCompletedRunForUserAndRoomVersion(
      env,
      auth.user.id,
      finalizedRun.roomId,
      finalizedRun.roomVersion,
      snapshot.goal,
      finalizedRun.attemptId
    );
    isFirstCompletion = previousBest === null;
    isNewPersonalBest =
      previousBest === null ||
      sortCompletedRunsForLeaderboard([finalizedRun, previousBest], snapshot.goal)[0]?.attemptId ===
        finalizedRun.attemptId;
  }

  const pointEvent = await awardRunFinalizePoints(env, finalizedRun, {
    isFirstCompletion,
    isNewPersonalBest,
  });
  await maybeMirrorRunPointEventToPlayfun(env, request, auth.user.id, pointEvent);
  const creatorPointEvent =
    finalizedRun.result === 'completed'
      ? await awardRoomCreatorCompletionPoints(env, {
          creatorUserId: resolveRoomVersionPublisherUserId(roomRecord, finalizedRun.roomVersion),
          roomId: finalizedRun.roomId,
          roomVersion: finalizedRun.roomVersion,
          finisherUserId: finalizedRun.userId,
          attemptId: finalizedRun.attemptId,
        })
      : null;
  if (creatorPointEvent) {
    await maybeMirrorPointEventToLinkedPlayfunUser(env, creatorPointEvent.user_id, creatorPointEvent);
    await upsertUserStats(env, creatorPointEvent.user_id);
  }
  await awardRoomRunProgression(env, {
    run: finalizedRun,
    goal: snapshot.goal,
    isFirstCompletion,
    isNewPersonalBest,
    creatorUserId: resolveRoomVersionPublisherUserId(roomRecord, finalizedRun.roomVersion),
    roomRecord,
    completedAt: finishedAt,
  });
  await upsertUserStats(env, auth.user.id);
  return noContentResponse(request);
}

export async function handleRoomLeaderboard(
  request: Request,
  url: URL,
  env: Env,
  roomId: string
): Promise<Response> {
  const auth = await loadOptionalRequestAuth(env, request);
  requireOptionalScope(auth, 'leaderboards:read', 'read room leaderboards');
  const coordinates = getCoordinatesFromRequest(roomId, url.searchParams);
  const version = parseOptionalPositiveIntegerQueryParam(url.searchParams, 'version');
  const limit = parsePositiveIntegerQueryParam(url.searchParams, 'limit', 10, 1, 50);
  const record = await loadRoomRecord(
    env,
    roomId,
    coordinates,
    auth?.user.id ?? null,
    auth?.user.walletAddress ?? null
  );
  const selection = resolveAggregatedRoomLeaderboardSelection(record, version);
  const snapshot = selection.snapshot;

  if (!snapshot.goal) {
    throw new HttpError(404, 'This room version does not have a leaderboard goal.');
  }

  const leaderboard = await buildRoomLeaderboardResponse(
    env,
    record,
    selection,
    limit,
    auth?.user.id ?? null
  );
  return jsonResponse(request, leaderboard);
}

export async function handleRoomDifficultyVote(
  request: Request,
  env: Env,
  roomId: string
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'rate room difficulty',
    'runs:write'
  );
  const body = await parseRoomDifficultyVoteBody(request);
  const record = await loadRoomRecord(
    env,
    roomId,
    body.roomCoordinates,
    auth.user.id,
    auth.user.walletAddress ?? null,
    auth.isAdmin
  );
  const selection = resolveAggregatedRoomLeaderboardSelection(record, body.roomVersion);

  if (!record.published || record.published.version !== selection.roomVersion) {
    throw new HttpError(409, 'Difficulty voting is only available on the current published version.');
  }

  const snapshot = selection.snapshot;
  if (!snapshot.goal) {
    throw new HttpError(409, 'Only published challenge rooms can receive difficulty votes.');
  }

  await submitRoomRating(env, {
    roomRecord: record,
    userId: auth.user.id,
    body: {
      roomCoordinates: body.roomCoordinates,
      roomVersion: selection.roomVersion,
      qualityStars: null,
      difficultyChoice: body.difficulty,
      autoSuggestedDifficulty: body.difficulty,
    },
  });

  return noContentResponse(request);
}

export async function handleRoomRatingSubmit(
  request: Request,
  env: Env,
  roomId: string,
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'rate rooms',
    'runs:write',
  );
  const body = await parseRoomRatingBody(request);
  const record = await loadRoomRecord(
    env,
    roomId,
    body.roomCoordinates,
    auth.user.id,
    auth.user.walletAddress ?? null,
    auth.isAdmin,
  );
  const responseBody = await submitRoomRating(env, {
    roomRecord: record,
    userId: auth.user.id,
    body,
  });
  return jsonResponse(request, responseBody);
}

export async function handleRoomDiscovery(
  request: Request,
  url: URL,
  env: Env
): Promise<Response> {
  const auth = await loadOptionalRequestAuth(env, request);
  requireOptionalScope(auth, 'leaderboards:read', 'discover room challenges');
  const rawDifficulty = url.searchParams.get('difficulty');
  const difficultyFilter =
    rawDifficulty && rawDifficulty.trim() ? parseRoomDifficultyOrThrow(rawDifficulty) : null;
  const rawSort = url.searchParams.get('sort');
  const sort = rawSort && rawSort.trim() ? parseRoomDiscoverySortOrThrow(rawSort) : 'featured';
  const limit = parsePositiveIntegerQueryParam(url.searchParams, 'limit', 100, 1, 200);
  const response = await loadRoomDiscoveryResponse(env, difficultyFilter, limit, sort);
  return jsonResponse(request, response);
}

async function maybeMirrorRunPointEventToPlayfun(
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

  try {
    await enqueuePlayfunPointSync(env, pointEvent, playfunSession.ogpId);
    await flushPlayfunPointSync(env, userId);
  } catch (error) {
    console.warn('Failed to mirror run point event to Play.fun', { userId, pointEventId: pointEvent.id, error });
  }
}

async function maybeMirrorPointEventToLinkedPlayfunUser(
  env: Env,
  userId: string,
  pointEvent: { id: string; user_id: string; points: number; created_at: string }
): Promise<void> {
  if (pointEvent.points <= 0) {
    return;
  }

  const link = await loadPlayfunUserLink(env, userId);
  if (!link?.ogp_id) {
    return;
  }

  try {
    await enqueuePlayfunPointSync(env, pointEvent, link.ogp_id);
    await flushPlayfunPointSync(env, userId);
  } catch (error) {
    console.warn('Failed to mirror linked Play.fun point event', { userId, pointEventId: pointEvent.id, error });
  }
}

function resolveRoomVersionPublisherUserId(
  roomRecord: { versions: Array<{ version: number; publishedByUserId: string | null }> },
  roomVersion: number
): string | null {
  return roomRecord.versions.find((entry) => entry.version === roomVersion)?.publishedByUserId ?? null;
}

export async function handleGlobalLeaderboard(
  request: Request,
  url: URL,
  env: Env
): Promise<Response> {
  const auth = await loadOptionalRequestAuth(env, request);
  requireOptionalScope(auth, 'leaderboards:read', 'read global leaderboards');
  const limit = parsePositiveIntegerQueryParam(url.searchParams, 'limit', 10, 1, 50);
  const leaderboard = await buildGlobalLeaderboardResponse(env, limit, auth?.user.id ?? null);
  return jsonResponse(request, leaderboard);
}

export function resolveRoomSnapshotForVersion(
  record: RoomRecord,
  version: number
): RoomSnapshot {
  if (record.published?.version === version) {
    return cloneRoomSnapshot(record.published);
  }

  const historicalVersion =
    record.versions.find((candidate) => candidate.version === version) ?? null;
  if (!historicalVersion) {
    throw new HttpError(404, `Room version ${version} was not found.`);
  }

  return cloneRoomSnapshot(historicalVersion.snapshot);
}

export async function loadRoomRunByAttemptId(
  env: Env,
  attemptId: string
): Promise<RoomRunRecord | null> {
  const row = await env.DB.prepare(
    `
      SELECT
        attempt_id,
        room_id,
        room_x,
        room_y,
        room_version,
        goal_type,
        goal_json,
        user_id,
        user_display_name,
        started_at,
        finished_at,
        result,
        elapsed_ms,
        deaths,
        score,
        collectibles_collected,
        enemies_defeated,
        checkpoints_reached,
        verification_status,
        verification_reason,
        verification_nonce,
        verification_snapshot_hash
      FROM room_runs
      WHERE attempt_id = ?
      LIMIT 1
    `
  )
    .bind(attemptId)
    .first<RoomRunRow>();

  return row ? mapRoomRunRow(row) : null;
}

export async function loadCompletedRoomRuns(
  env: Env,
  roomId: string,
  roomVersion: number
): Promise<RoomRunRecord[]> {
  const result = await env.DB.prepare(
    `
      SELECT
        attempt_id,
        room_id,
        room_x,
        room_y,
        room_version,
        goal_type,
        goal_json,
        user_id,
        user_display_name,
        started_at,
        finished_at,
        result,
        elapsed_ms,
        deaths,
        score,
        collectibles_collected,
        enemies_defeated,
        checkpoints_reached,
        verification_status,
        verification_reason,
        verification_nonce,
        verification_snapshot_hash
      FROM room_runs
      WHERE room_id = ?
        AND room_version = ?
        AND result = 'completed'
        AND ${sqlIsVerificationAccepted('room_runs')}
        AND ${sqlUserIdIsNotPlayfunOnly('room_runs.user_id')}
    `
  )
    .bind(roomId, roomVersion)
    .all<RoomRunRow>();

  return result.results.map(mapRoomRunRow);
}

export async function loadCompletedRoomRunsForVersions(
  env: Env,
  roomId: string,
  roomVersions: number[]
): Promise<RoomRunRecord[]> {
  if (roomVersions.length === 0) {
    return [];
  }

  const result = await env.DB.prepare(
    `
      SELECT
        attempt_id,
        room_id,
        room_x,
        room_y,
        room_version,
        goal_type,
        goal_json,
        user_id,
        user_display_name,
        started_at,
        finished_at,
        result,
        elapsed_ms,
        deaths,
        score,
        collectibles_collected,
        enemies_defeated,
        checkpoints_reached,
        verification_status,
        verification_reason,
        verification_nonce,
        verification_snapshot_hash
      FROM room_runs
      WHERE room_id = ?
        AND room_version IN (${roomVersions.map(() => '?').join(', ')})
        AND result = 'completed'
        AND ${sqlIsVerificationAccepted('room_runs')}
        AND ${sqlUserIdIsNotPlayfunOnly('room_runs.user_id')}
    `
  )
    .bind(roomId, ...roomVersions)
    .all<RoomRunRow>();

  return result.results.map(mapRoomRunRow);
}

export function mapRoomRunRow(row: RoomRunRow): RoomRunRecord {
  return {
    attemptId: row.attempt_id,
    roomId: row.room_id,
    roomCoordinates: {
      x: row.room_x,
      y: row.room_y,
    },
    roomVersion: row.room_version,
    goalType: parseStoredGoal(row.goal_json, 'room run goal').type,
    goal: parseStoredGoal(row.goal_json, 'room run goal'),
    userId: row.user_id,
    userDisplayName: row.user_display_name,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    result: row.result,
    elapsedMs: row.elapsed_ms,
    deaths: row.deaths,
    score: row.score,
    collectiblesCollected: row.collectibles_collected,
    enemiesDefeated: row.enemies_defeated,
    checkpointsReached: row.checkpoints_reached,
    verificationStatus: row.verification_status ?? 'not_required',
    verificationReason: row.verification_reason ?? null,
    verificationNonce: row.verification_nonce ?? null,
    verificationSnapshotHash: row.verification_snapshot_hash ?? null,
  };
}

export function parseStoredGoal(raw: string, label: string): RoomGoal {
  try {
    const parsed = normalizeRoomGoal(JSON.parse(raw));
    if (!parsed) {
      throw new Error('Invalid goal.');
    }
    return parsed;
  } catch {
    throw new HttpError(500, `Failed to parse ${label}.`);
  }
}

function computeEffectiveElapsedMs(
  startedAt: string,
  finishedAt: string,
  reportedElapsedMs: number
): number {
  const observedStart = Date.parse(startedAt);
  const observedFinish = Date.parse(finishedAt);
  const observedElapsedMs =
    Number.isFinite(observedStart) && Number.isFinite(observedFinish)
      ? Math.max(0, observedFinish - observedStart)
      : 0;
  return Math.max(Math.round(reportedElapsedMs), observedElapsedMs);
}

function normalizeFinalizedRunBody(
  goal: RoomGoal,
  body: RunFinishRequestBody,
  metricCaps: {
    maxCollectibles: number;
    maxEnemies: number;
    maxCheckpoints: number;
  },
  reportedElapsedMs: number
): RunFinishRequestBody {
  if (body.result !== 'completed') {
    return {
      ...body,
      collectiblesCollected: 0,
      enemyCollectiblesCollected: 0,
      enemiesDefeated: 0,
      checkpointsReached: 0,
    };
  }

  if (
    'timeLimitMs' in goal &&
    goal.timeLimitMs !== null &&
    reportedElapsedMs > goal.timeLimitMs
  ) {
    throw new HttpError(409, 'Completed runs must finish within the published time limit.');
  }

  switch (goal.type) {
    case 'collect_target':
      if (body.collectiblesCollected < goal.requiredCount) {
        throw new HttpError(409, 'Completed collect-target runs must meet the published goal.');
      }
      break;
    case 'collect_race': {
      const totalCollected = body.collectiblesCollected + body.enemyCollectiblesCollected;
      const finishedByTime = goal.timeLimitMs !== null && reportedElapsedMs >= goal.timeLimitMs;
      const finishedByExhaustion = totalCollected >= metricCaps.maxCollectibles;
      if (!finishedByTime && !finishedByExhaustion) {
        throw new HttpError(
          409,
          'Completed collect-race runs must end when time expires or all collectibles are claimed.',
        );
      }
      if (body.collectiblesCollected <= body.enemyCollectiblesCollected) {
        throw new HttpError(409, 'Completed collect-race runs must beat the Sword Hunter.');
      }
      break;
    }
    case 'defeat_all':
      if (body.enemiesDefeated < metricCaps.maxEnemies) {
        throw new HttpError(409, 'Completed defeat-all runs must clear every published enemy.');
      }
      break;
    case 'checkpoint_sprint':
      if (body.checkpointsReached < metricCaps.maxCheckpoints) {
        throw new HttpError(409, 'Completed checkpoint-sprint runs must hit every checkpoint.');
      }
      break;
    case 'survival':
      if (body.elapsedMs < goal.durationMs) {
        throw new HttpError(409, 'Completed survival runs must last the full published duration.');
      }
      break;
    case 'reach_exit':
      break;
  }

  return body;
}

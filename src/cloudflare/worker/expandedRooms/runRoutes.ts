import {
  cloneCourseGoal,
  cloneCourseSnapshot,
  normalizeCourseGoal,
  type CourseGoal,
  type CourseSnapshot,
} from '../../../courses/model';
import {
  computeCourseRunScore,
  compareCourseLeaderboardEntries,
} from '../../../courses/scoring';
import type {
  CourseProgressRatingRequestBody,
  CourseRunFinishRequestBody,
  CourseRunRecord,
} from '../../../courses/runModel';
import type {
  ExpandedRoomProgressRatingRequestBody,
  ExpandedRoomProgressRatingResponse,
  ExpandedRoomRunStartRequestBody,
  ExpandedRoomRunStartResponse,
} from '../../../expandedRooms/runModel';
import { cloneRoomSnapshot, type RoomSnapshot } from '../../../persistence/roomModel';
import type { RunResult } from '../../../runs/model';
import { RANKED_RUN_TRACE_SCHEMA_VERSION } from '../../../runs/verificationTrace';
import {
  HttpError,
  jsonResponse,
  noContentResponse,
  normalizeIsoTimestamp,
  normalizePositiveInteger,
  parseJsonBody,
  parseOptionalPositiveIntegerQueryParam,
  parsePositiveIntegerQueryParam,
} from '../core/http';
import { ServerTiming, timedJsonResponse } from '../core/serverTiming';
import type { Env, ExpandedRoomRunRow, WorkerExecutionContextLike } from '../core/types';
import {
  refreshPlayableContentIndexForExpandedRoom,
  schedulePlayableContentIndexRefresh,
} from '../playableContentIndex/store';
import {
  loadOptionalRequestAuth,
  requireAuthenticatedRequestAuth,
  requireOptionalScope,
} from '../auth/request';
import {
  loadCourseRecord,
  loadPublishedCourse,
} from '../courses/store';
import {
  computeEffectiveElapsedMs,
  normalizeFinalizedCourseRunBody,
  parseCourseRunFinishBody,
} from '../courses/requestBodies';
import {
  assertWampLeaderboardWriteAllowed,
} from '../generatedUsers/leaderboardIsolation';
import {
  awardCourseCreatorCompletionPoints,
  awardRunFinalizePoints,
  previewRunFinalizePoints,
  upsertUserStats,
} from '../runs/points';
import {
  computeCourseSnapshotVerificationHash,
  createCourseVerificationTrigger,
  createRunVerificationNonce,
  relaxVerificationTriggerForTrustTier,
  recordRunVerificationAudit,
  requireVerificationTrace,
  type RunVerificationFailureReason,
  verifyCourseRunTrace,
} from '../runs/verification';
import { sqlIsVerificationAccepted } from '../runs/verificationSql';
import { loadRoomRecord } from '../rooms/store';
import {
  awardCourseRunProgression,
  loadEffectiveTrustTier,
  submitCourseRating,
} from '../progression/store';
import {
  loadTrophyForContentVersion,
  refreshContentOwnerProgressCounts,
  syncContentTrophy,
} from '../progression/badgesTrophies';
import {
  buildExpandedRoomLeaderboardResponse,
  loadRankedExpandedRoomLeaderboardRows,
  loadViewerRankedExpandedRoomLeaderboardRow,
} from './leaderboards';
import {
  loadExpandedRoomTarget,
} from './store';

interface LegacyExpandedRoomCourseContext {
  expandedRoomId: string;
  expandedRoomTitle: string | null;
  expandedRoomVersion: number;
  legacyCourseId: string;
  snapshot: CourseSnapshot;
}

interface ExpandedRoomRunRecord {
  attemptId: string;
  expandedRoomId: string;
  expandedRoomVersion: number;
  legacyCourseAttemptId: string | null;
  goalType: CourseRunRecord['goalType'];
  goal: CourseGoal;
  userId: string;
  userDisplayName: string;
  startedAt: string;
  finishedAt: string | null;
  result: RunResult;
  elapsedMs: number | null;
  deaths: number;
  score: number;
  collectiblesCollected: number;
  enemiesDefeated: number;
  checkpointsReached: number;
  verificationStatus?: 'not_required' | 'passed' | 'failed' | 'timeout';
  verificationReason?: string | null;
  verificationNonce?: string | null;
  verificationSnapshotHash?: string | null;
}

export async function handleExpandedRoomRunStart(
  request: Request,
  env: Env,
  expandedRoomId: string,
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'submit expanded room runs',
    'runs:write',
  );
  await assertWampLeaderboardWriteAllowed(env, auth, 'play');
  const body = await parseExpandedRoomRunStartBody(request, expandedRoomId);
  const context = await resolveLegacyExpandedRoomCourseContext(
    env,
    body.expandedRoomId,
    body.expandedRoomVersion,
  );
  const { snapshot } = context;
  if (!snapshot.goal) {
    throw new HttpError(400, 'This expanded room version does not have an active goal.');
  }

  const canonicalGoal = cloneCourseGoal(snapshot.goal);
  if (JSON.stringify(canonicalGoal) !== JSON.stringify(body.goal)) {
    throw new HttpError(409, 'Run goal does not match the published expanded room version.');
  }

  const attemptId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const verificationNonce = createRunVerificationNonce();
  const snapshotHash = await computeCourseSnapshotVerificationHash(snapshot);
  const goalJson = JSON.stringify(canonicalGoal);

  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO expanded_room_runs (
          attempt_id,
          expanded_room_id,
          expanded_room_version,
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
          legacy_course_attempt_id,
          verification_status,
          verification_reason,
          verification_nonce,
          verification_snapshot_hash
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'active', NULL, 0, 0, 0, 0, 0, ?, 'not_required', NULL, ?, ?)
      `
    ).bind(
      attemptId,
      context.expandedRoomId,
      snapshot.version,
      canonicalGoal!.type,
      goalJson,
      auth.user.id,
      auth.user.displayName,
      startedAt,
      attemptId,
      verificationNonce,
      snapshotHash,
    ),
    env.DB.prepare(
      `
        INSERT INTO course_runs (
          attempt_id,
          course_id,
          course_version,
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'active', NULL, 0, 0, 0, 0, 0, 'not_required', NULL, ?, ?)
      `
    ).bind(
      attemptId,
      context.legacyCourseId,
      snapshot.version,
      canonicalGoal!.type,
      goalJson,
      auth.user.id,
      auth.user.displayName,
      startedAt,
      verificationNonce,
      snapshotHash,
    ),
  ]);

  const responseBody: ExpandedRoomRunStartResponse = {
    attemptId,
    expandedRoomId: context.expandedRoomId,
    expandedRoomVersion: snapshot.version,
    legacyCourseId: context.legacyCourseId,
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

export async function handleExpandedRoomRunFinish(
  request: Request,
  env: Env,
  attemptId: string,
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'submit expanded room runs',
    'runs:write',
  );
  await assertWampLeaderboardWriteAllowed(env, auth, 'play');
  const body = await parseCourseRunFinishBody(request);
  const existing = await loadExpandedRoomRunByAttemptId(env, attemptId);
  if (!existing) {
    throw new HttpError(404, 'Expanded room run attempt was not found.');
  }

  if (existing.userId !== auth.user.id) {
    throw new HttpError(403, 'You can only finish your own expanded room run attempts.');
  }

  if (existing.result !== 'active') {
    throw new HttpError(409, 'This expanded room run attempt has already been finalized.');
  }

  const context = await resolveLegacyExpandedRoomCourseContext(
    env,
    existing.expandedRoomId,
    existing.expandedRoomVersion,
  );
  const { snapshot } = context;
  if (!snapshot.goal) {
    throw new HttpError(409, 'This expanded room version no longer has a leaderboard goal.');
  }
  const courseRecord = await loadCourseRecord(
    env,
    context.legacyCourseId,
    auth.user.id,
    auth.isAdmin,
  );
  if (!courseRecord) {
    throw new HttpError(404, 'Legacy course record not found for expanded room.');
  }

  const finishedAt = new Date().toISOString();
  const reportedElapsedMs = body.elapsedMs;
  const clampedBody: CourseRunFinishRequestBody = {
    ...normalizeFinalizedCourseRunBody(
      snapshot.goal,
      {
        ...body,
        elapsedMs: computeEffectiveElapsedMs(existing.startedAt, finishedAt, reportedElapsedMs),
      },
      reportedElapsedMs,
    ),
    finishedAt,
  };
  const provisionalScore =
    clampedBody.result === 'completed' ? computeCourseRunScore(snapshot.goal, clampedBody) : 0;
  const provisionalPreviousBest =
    clampedBody.result === 'completed'
      ? await loadBestCompletedExpandedRoomRunForUserAndVersion(
          env,
          auth.user.id,
          existing.expandedRoomId,
          existing.expandedRoomVersion,
          snapshot.goal,
          null,
        )
      : null;
  const provisionalIsFirstCompletion =
    clampedBody.result === 'completed' && provisionalPreviousBest === null;
  const provisionalCandidateRun: ExpandedRoomRunRecord | null =
    clampedBody.result === 'completed'
      ? {
          attemptId,
          expandedRoomId: existing.expandedRoomId,
          expandedRoomVersion: existing.expandedRoomVersion,
          legacyCourseAttemptId: existing.legacyCourseAttemptId,
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
      compareExpandedRoomRunRecords(provisionalCandidateRun, provisionalPreviousBest, snapshot.goal) < 0);
  const provisionalPointAward =
    provisionalCandidateRun !== null
      ? previewRunFinalizePoints(provisionalCandidateRun, {
          isFirstCompletion: provisionalIsFirstCompletion,
          isNewPersonalBest: provisionalIsNewPersonalBest,
        })
      : null;
  const currentTopRows =
    clampedBody.result === 'completed'
      ? await loadRankedExpandedRoomLeaderboardRows(
          env,
          existing.expandedRoomId,
          existing.expandedRoomVersion,
          snapshot.goal,
          10,
        )
      : [];
  const viewerBestRow =
    clampedBody.result === 'completed'
      ? await loadViewerRankedExpandedRoomLeaderboardRow(
          env,
          existing.expandedRoomId,
          existing.expandedRoomVersion,
          snapshot.goal,
          auth.user.id,
        )
      : null;
  const baseVerificationTrigger =
    clampedBody.result === 'completed'
      ? createCourseVerificationTrigger(snapshot.goal, {
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
      verificationResult = await verifyCourseRunTrace({
        trace: requireVerificationTrace(clampedBody.verificationTrace),
        binding: {
          verificationNonce: existing.verificationNonce ?? null,
          verificationSnapshotHash: existing.verificationSnapshotHash ?? null,
        },
        course: snapshot,
        roomsById: await loadCourseVerificationRoomsById(
          env,
          snapshot,
          auth.user.id,
          auth.user.walletAddress ?? null,
        ),
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
      finalBody = {
        ...clampedBody,
        collectiblesCollected: verificationResult.derivedMetrics.collectiblesCollected,
        enemiesDefeated: verificationResult.derivedMetrics.enemiesDefeated,
        checkpointsReached: verificationResult.derivedMetrics.checkpointsReached,
      };
      finalScore = computeCourseRunScore(snapshot.goal, finalBody);
    }
  }

  await env.DB.batch([
    env.DB.prepare(
      `
        UPDATE expanded_room_runs
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
      attemptId,
    ),
    env.DB.prepare(
      `
        UPDATE course_runs
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
      attemptId,
    ),
  ]);

  if (verificationTrigger?.required && verificationAudit) {
    await recordRunVerificationAudit(env, {
      attemptId,
      kind: 'course',
      status: verificationAudit.status,
      triggerReason: verificationTrigger.reason ?? 'record_gap',
      verificationReason: verificationAudit.reason,
      summary: {
        ...verificationAudit.summary,
        expandedRoomId: existing.expandedRoomId,
      },
      trace: finalBody.verificationTrace ?? null,
      createdAt: finishedAt,
    });
  } else if (shouldAuditRelaxedVerification && baseVerificationTrigger) {
    await recordRunVerificationAudit(env, {
      attemptId,
      kind: 'course',
      status: 'skipped',
      triggerReason: baseVerificationTrigger.reason ?? 'record_gap',
      verificationReason: null,
      summary: {
        trigger: baseVerificationTrigger,
        expandedRoomId: existing.expandedRoomId,
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
        ? 'Missing verification trace for ranked expanded room run.'
        : verificationReason === 'trace_client_outdated'
          ? 'Client update required for ranked verification.'
          : 'Ranked expanded room run could not be verified.',
    );
  }

  if (verificationStatus === 'timeout') {
    throw new HttpError(409, 'Ranked expanded room run verification timed out.');
  }

  const finalizedRun = await loadExpandedRoomRunByAttemptId(env, attemptId);
  if (!finalizedRun) {
    throw new HttpError(500, 'Failed to reload finalized expanded room run.');
  }

  let isFirstCompletion = false;
  let isNewPersonalBest = false;
  if (finalizedRun.result === 'completed') {
    const previousBest = await loadBestCompletedExpandedRoomRunForUserAndVersion(
      env,
      auth.user.id,
      finalizedRun.expandedRoomId,
      finalizedRun.expandedRoomVersion,
      snapshot.goal,
      attemptId,
    );
    isFirstCompletion = previousBest === null;
    isNewPersonalBest =
      previousBest === null ||
      compareExpandedRoomRunRecords(finalizedRun, previousBest, snapshot.goal) < 0;
  }

  await awardRunFinalizePoints(env, finalizedRun, {
    isFirstCompletion,
    isNewPersonalBest,
  });
  const creatorUserId = await resolvePublishedCourseOwnerUserId(env, context.legacyCourseId);
  const creatorPointEvent =
    finalizedRun.result === 'completed'
      ? await awardCourseCreatorCompletionPoints(env, {
          creatorUserId,
          courseId: context.legacyCourseId,
          courseVersion: finalizedRun.expandedRoomVersion,
          finisherUserId: finalizedRun.userId,
          attemptId: finalizedRun.attemptId,
        })
      : null;

  if (creatorPointEvent) {
    await upsertUserStats(env, creatorPointEvent.user_id);
  }

  await awardCourseRunProgression(env, {
    run: mapExpandedRoomRunToCourseRun(finalizedRun, context.legacyCourseId),
    goal: snapshot.goal,
    isFirstCompletion,
    isNewPersonalBest,
    creatorUserId,
    courseRecord,
    completedAt: finishedAt,
  });
  await upsertUserStats(env, auth.user.id);
  return noContentResponse(request);
}

export async function handleExpandedRoomLeaderboard(
  request: Request,
  url: URL,
  env: Env,
  expandedRoomId: string,
): Promise<Response> {
  const timing = new ServerTiming();
  const auth = await timing.measure('auth', () => loadOptionalRequestAuth(env, request));
  requireOptionalScope(auth, 'leaderboards:read', 'read expanded room leaderboards');
  const version = parseOptionalPositiveIntegerQueryParam(url.searchParams, 'version');
  const limit = parsePositiveIntegerQueryParam(url.searchParams, 'limit', 10, 1, 50);
  const context = await timing.measure(
    'expanded_context',
    () => resolveLegacyExpandedRoomCourseContext(env, expandedRoomId, version ?? undefined),
  );
  if (!context.snapshot.goal) {
    throw new HttpError(404, 'This expanded room version does not have a leaderboard goal.');
  }
  const record = await timing.measure('course_record', () => loadCourseRecord(
    env,
    context.legacyCourseId,
    auth?.user.id ?? null,
    auth?.isAdmin ?? false,
  ));
  if (!record) {
    throw new HttpError(404, 'Legacy course not found for expanded room.');
  }

  const leaderboard = await timing.measure('leaderboard', () => buildExpandedRoomLeaderboardResponse(env, {
    expandedRoomId: context.expandedRoomId,
    expandedRoomTitle: context.expandedRoomTitle,
    legacyCourseId: context.legacyCourseId,
    courseRecord: record,
    snapshot: context.snapshot,
    limit,
    viewerUserId: auth?.user.id ?? null,
  }));
  const authenticated = auth !== null;
  timing.setDiagnostic('cache', authenticated ? 'private-20' : 'public-20-swr-40');
  return timedJsonResponse(request, leaderboard, timing, {
    headers: {
      'Cache-Control': authenticated
        ? 'private, max-age=20'
        : 'public, max-age=20, stale-while-revalidate=40',
    },
  });
}

export async function handleExpandedRoomRatingSubmit(
  request: Request,
  env: Env,
  expandedRoomId: string,
  executionContext?: WorkerExecutionContextLike,
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'rate expanded rooms',
    'runs:write',
  );
  const body = await parseExpandedRoomRatingBody(request);
  const context = await resolveLegacyExpandedRoomCourseContext(
    env,
    expandedRoomId,
    body.expandedRoomVersion,
  );
  const record = await loadCourseRecord(env, context.legacyCourseId, auth.user.id, auth.isAdmin);
  if (!record) {
    throw new HttpError(404, 'Legacy course not found for expanded room.');
  }

  const response = await submitCourseRating(env, {
    courseRecord: record,
    userId: auth.user.id,
    body: {
      courseVersion: body.expandedRoomVersion,
      qualityStars: body.qualityStars,
      difficultyChoice: body.difficultyChoice,
      autoSuggestedDifficulty: body.autoSuggestedDifficulty,
    },
  });
  await mirrorCourseRatingToExpandedRoomRating(env, {
    expandedRoomId: context.expandedRoomId,
    legacyCourseId: context.legacyCourseId,
    courseVersion: body.expandedRoomVersion,
    userId: auth.user.id,
  });
  await syncContentTrophy(
    env,
    'expanded_room',
    context.expandedRoomId,
    body.expandedRoomVersion,
    response.summary.quality,
  );
  await refreshContentOwnerProgressCounts(
    env,
    'expanded_room',
    context.expandedRoomId,
    body.expandedRoomVersion,
  );
  schedulePlayableContentIndexRefresh(
    executionContext,
    refreshPlayableContentIndexForExpandedRoom(env, context.expandedRoomId),
  );

  const responseBody: ExpandedRoomProgressRatingResponse = {
    expandedRoomId: context.expandedRoomId,
    expandedRoomVersion: body.expandedRoomVersion,
    legacyCourseId: context.legacyCourseId,
    ok: true,
    progressionDelta: response.progressionDelta,
    summary: {
      ...response.summary,
      trophy: await loadTrophyForContentVersion(
        env,
        'expanded_room',
        context.expandedRoomId,
        body.expandedRoomVersion,
      ),
    },
    progression: response.progression,
  };
  return jsonResponse(request, responseBody);
}

async function parseExpandedRoomRunStartBody(
  request: Request,
  fallbackExpandedRoomId: string,
): Promise<ExpandedRoomRunStartRequestBody> {
  const body = await parseJsonBody<
    Partial<ExpandedRoomRunStartRequestBody> & {
      courseVersion?: unknown;
    }
  >(request);
  const expandedRoomId =
    typeof body.expandedRoomId === 'string' && body.expandedRoomId.trim()
      ? body.expandedRoomId.trim()
      : fallbackExpandedRoomId;
  const expandedRoomVersion = normalizePositiveInteger(
    body.expandedRoomVersion ?? body.courseVersion,
    'expandedRoomVersion',
  );
  const goal = normalizeCourseGoal(body.goal);

  if (!expandedRoomId) {
    throw new HttpError(400, 'expandedRoomId is required.');
  }
  if (expandedRoomId !== fallbackExpandedRoomId) {
    throw new HttpError(400, 'expandedRoomId must match the URL.');
  }
  if (!goal) {
    throw new HttpError(400, 'goal must be a valid expanded room goal.');
  }

  return {
    expandedRoomId,
    expandedRoomVersion,
    goal,
    startedAt: normalizeIsoTimestamp(body.startedAt),
  };
}

async function parseExpandedRoomRatingBody(
  request: Request,
): Promise<ExpandedRoomProgressRatingRequestBody> {
  const body = await parseJsonBody<
    Partial<ExpandedRoomProgressRatingRequestBody & CourseProgressRatingRequestBody>
  >(request);
  return {
    expandedRoomVersion: normalizePositiveInteger(
      body.expandedRoomVersion ?? body.courseVersion,
      'expandedRoomVersion',
    ),
    qualityStars:
      body.qualityStars === null || body.qualityStars === undefined
        ? null
        : normalizePositiveInteger(body.qualityStars, 'qualityStars'),
    difficultyChoice: parseExpandedRoomDifficulty(body.difficultyChoice),
    autoSuggestedDifficulty: parseExpandedRoomDifficulty(body.autoSuggestedDifficulty),
  };
}

function parseExpandedRoomDifficulty(
  value: unknown,
): CourseProgressRatingRequestBody['difficultyChoice'] {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value === 'string' && ['easy', 'medium', 'hard', 'extreme'].includes(value)) {
    return value as CourseProgressRatingRequestBody['difficultyChoice'];
  }
  throw new HttpError(400, 'difficultyChoice must be easy, medium, hard, extreme, or null.');
}

async function resolveLegacyExpandedRoomCourseContext(
  env: Env,
  expandedRoomId: string,
  version?: number,
): Promise<LegacyExpandedRoomCourseContext> {
  const target = await loadExpandedRoomTarget(env, expandedRoomId);
  if (!target) {
    throw new HttpError(404, 'Expanded room not found.');
  }
  if (!target.legacyCourseId) {
    throw new HttpError(
      409,
      'Ranked expanded room runs are currently available for course-backed expanded rooms only.',
    );
  }

  const snapshot = await resolvePublishedCourseVersion(env, target.legacyCourseId, version);
  return {
    expandedRoomId: target.expandedRoomId,
    expandedRoomTitle: target.title,
    expandedRoomVersion: snapshot.version,
    legacyCourseId: target.legacyCourseId,
    snapshot,
  };
}

async function resolvePublishedCourseVersion(
  env: Env,
  courseId: string,
  version?: number,
): Promise<CourseSnapshot> {
  const course = await loadPublishedCourse(env, courseId);
  if (course && (version === undefined || version === null || course.version === version)) {
    return cloneCourseSnapshot(course);
  }

  const record = await loadCourseRecord(env, courseId);
  if (!record) {
    throw new HttpError(404, 'Legacy course not found for expanded room.');
  }
  if (version === undefined || version === null) {
    throw new HttpError(404, 'Published expanded room not found.');
  }
  const historicalVersion =
    record.versions.find((entry) => entry.version === version) ?? null;
  if (!historicalVersion) {
    throw new HttpError(404, `Expanded room version ${version} was not found.`);
  }

  return cloneCourseSnapshot(historicalVersion.snapshot);
}

async function loadCourseVerificationRoomsById(
  env: Env,
  course: CourseSnapshot,
  viewerUserId: string | null,
  viewerWalletAddress: string | null,
): Promise<Map<string, RoomSnapshot>> {
  const roomsById = new Map<string, RoomSnapshot>();
  for (const roomRef of course.roomRefs) {
    const roomRecord = await loadRoomRecord(
      env,
      roomRef.roomId,
      roomRef.coordinates,
      viewerUserId,
      viewerWalletAddress,
    );
    const historicalVersion =
      roomRecord.versions.find((entry) => entry.version === roomRef.roomVersion)?.snapshot ??
      (roomRecord.published?.version === roomRef.roomVersion ? roomRecord.published : null);
    if (!historicalVersion) {
      throw new HttpError(
        409,
        `Expanded room cell ${roomRef.roomId} version ${roomRef.roomVersion} is unavailable for verification.`,
      );
    }

    roomsById.set(roomRef.roomId, cloneRoomSnapshot(historicalVersion));
  }

  return roomsById;
}

async function loadExpandedRoomRunByAttemptId(
  env: Env,
  attemptId: string,
): Promise<ExpandedRoomRunRecord | null> {
  const row = await env.DB.prepare(
    `
      SELECT
        attempt_id,
        expanded_room_id,
        expanded_room_version,
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
        legacy_course_attempt_id,
        verification_status,
        verification_reason,
        verification_nonce,
        verification_snapshot_hash
      FROM expanded_room_runs
      WHERE attempt_id = ?
      LIMIT 1
    `
  )
    .bind(attemptId)
    .first<ExpandedRoomRunRow>();

  return row ? mapExpandedRoomRunRow(row) : null;
}

function mapExpandedRoomRunRow(row: ExpandedRoomRunRow): ExpandedRoomRunRecord {
  const goal = parseStoredCourseGoal(row.goal_json, 'expanded room run goal');
  return {
    attemptId: row.attempt_id,
    expandedRoomId: row.expanded_room_id,
    expandedRoomVersion: Number(row.expanded_room_version),
    legacyCourseAttemptId: row.legacy_course_attempt_id,
    goalType: goal.type,
    goal,
    userId: row.user_id,
    userDisplayName: row.user_display_name,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    result: row.result as RunResult,
    elapsedMs: row.elapsed_ms === null ? null : Number(row.elapsed_ms),
    deaths: Number(row.deaths),
    score: Number(row.score),
    collectiblesCollected: Number(row.collectibles_collected),
    enemiesDefeated: Number(row.enemies_defeated),
    checkpointsReached: Number(row.checkpoints_reached),
    verificationStatus: row.verification_status ?? 'not_required',
    verificationReason: row.verification_reason ?? null,
    verificationNonce: row.verification_nonce ?? null,
    verificationSnapshotHash: row.verification_snapshot_hash ?? null,
  };
}

function parseStoredCourseGoal(raw: string, label: string): CourseGoal {
  try {
    const parsed = normalizeCourseGoal(JSON.parse(raw));
    if (!parsed) {
      throw new Error('Invalid goal.');
    }
    return parsed;
  } catch {
    throw new HttpError(500, `Failed to parse ${label}.`);
  }
}

async function loadBestCompletedExpandedRoomRunForUserAndVersion(
  env: Env,
  userId: string,
  expandedRoomId: string,
  expandedRoomVersion: number,
  goal: CourseGoal,
  excludeAttemptId: string | null,
): Promise<ExpandedRoomRunRecord | null> {
  const result = await env.DB.prepare(
    `
      SELECT
        attempt_id,
        expanded_room_id,
        expanded_room_version,
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
        legacy_course_attempt_id,
        verification_status,
        verification_reason,
        verification_nonce,
        verification_snapshot_hash
      FROM expanded_room_runs
      WHERE user_id = ?
        AND expanded_room_id = ?
        AND expanded_room_version = ?
        AND result = 'completed'
        AND ${sqlIsVerificationAccepted('expanded_room_runs')}
        AND (? IS NULL OR attempt_id != ?)
    `
  )
    .bind(userId, expandedRoomId, expandedRoomVersion, excludeAttemptId, excludeAttemptId)
    .all<ExpandedRoomRunRow>();

  const runs = result.results
    .filter(
      (row): row is ExpandedRoomRunRow & { elapsed_ms: number; finished_at: string } =>
        typeof row.elapsed_ms === 'number' && typeof row.finished_at === 'string',
    )
    .map(mapExpandedRoomRunRow);

  if (runs.length === 0) {
    return null;
  }

  return [...runs].sort((left, right) => compareExpandedRoomRunRecords(left, right, goal))[0] ?? null;
}

function compareExpandedRoomRunRecords(
  left: ExpandedRoomRunRecord,
  right: ExpandedRoomRunRecord,
  goal: CourseGoal,
): number {
  return compareCourseLeaderboardEntries(
    {
      elapsedMs: left.elapsedMs,
      deaths: left.deaths,
      score: left.score,
      finishedAt: left.finishedAt,
    },
    {
      elapsedMs: right.elapsedMs,
      deaths: right.deaths,
      score: right.score,
      finishedAt: right.finishedAt,
    },
    goal,
  );
}

function mapExpandedRoomRunToCourseRun(
  run: ExpandedRoomRunRecord,
  legacyCourseId: string,
): CourseRunRecord {
  return {
    attemptId: run.attemptId,
    courseId: legacyCourseId,
    courseVersion: run.expandedRoomVersion,
    goalType: run.goalType,
    goal: run.goal,
    userId: run.userId,
    userDisplayName: run.userDisplayName,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    result: run.result,
    elapsedMs: run.elapsedMs,
    deaths: run.deaths,
    score: run.score,
    collectiblesCollected: run.collectiblesCollected,
    enemiesDefeated: run.enemiesDefeated,
    checkpointsReached: run.checkpointsReached,
    verificationStatus: run.verificationStatus,
    verificationReason: run.verificationReason,
    verificationNonce: run.verificationNonce,
    verificationSnapshotHash: run.verificationSnapshotHash,
  };
}

async function resolvePublishedCourseOwnerUserId(
  env: Env,
  courseId: string,
): Promise<string | null> {
  const row = await env.DB.prepare(
    `
      SELECT owner_user_id
      FROM courses
      WHERE id = ?
        AND published_json IS NOT NULL
      LIMIT 1
    `
  )
    .bind(courseId)
    .first<{ owner_user_id: string | null }>();

  return row?.owner_user_id ?? null;
}

async function mirrorCourseRatingToExpandedRoomRating(
  env: Env,
  params: {
    expandedRoomId: string;
    legacyCourseId: string;
    courseVersion: number;
    userId: string;
  },
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT OR REPLACE INTO expanded_room_ratings (
          expanded_room_id,
          lineage_key,
          version_key,
          user_id,
          quality_stars,
          difficulty_choice,
          auto_difficulty_choice,
          trust_weight,
          completed_attempt_id,
          first_rated_at,
          updated_at,
          rewarded_at,
          legacy_course_id
        )
        SELECT
          ?,
          lineage_key,
          version_key,
          user_id,
          quality_stars,
          difficulty_choice,
          auto_difficulty_choice,
          trust_weight,
          completed_attempt_id,
          first_rated_at,
          updated_at,
          rewarded_at,
          ?
        FROM course_ratings
        WHERE course_id = ?
          AND version_key = ?
          AND user_id = ?
      `
    ).bind(
      params.expandedRoomId,
      params.legacyCourseId,
      params.legacyCourseId,
      params.courseVersion,
      params.userId,
    ),
  ]);
}

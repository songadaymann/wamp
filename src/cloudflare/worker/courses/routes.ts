import {
  cloneCourseGoal,
  cloneCourseSnapshot,
  normalizeCourseGoal,
  type CourseRecord,
  type CourseSnapshot,
} from '../../../courses/model';
import { cloneRoomSnapshot, type RoomSnapshot } from '../../../persistence/roomModel';
import {
  computeCourseRunScore,
  sortCompletedCourseRunsForLeaderboard,
} from '../../../courses/scoring';
import { RANKED_RUN_TRACE_SCHEMA_VERSION } from '../../../runs/verificationTrace';
import type {
  CourseRunFinishRequestBody,
  CourseRunRecord,
  CourseRunStartResponse,
} from '../../../courses/runModel';
import { expandedRoomIdFromLegacyCourseId } from '../../../expandedRooms/model';
import type { RunResult } from '../../../runs/model';
import {
  HttpError,
  jsonResponse,
  noContentResponse,
  parseOptionalPositiveIntegerQueryParam,
  parsePositiveIntegerQueryParam,
} from '../core/http';
import { ServerTiming, timedJsonResponse } from '../core/serverTiming';
import type { CourseRunRow, Env, WorkerExecutionContextLike } from '../core/types';
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
  assertWampLeaderboardWriteAllowed,
} from '../generatedUsers/leaderboardIsolation';
import {
  awardCoursePublishPoints,
  awardCourseCreatorCompletionPoints,
  awardRunFinalizePoints,
  previewRunFinalizePoints,
  upsertUserStats,
} from '../runs/points';
import {
  assertUserCanPublishContent,
  awardCoursePublishProgression,
  awardCourseRunProgression,
  loadEffectiveTrustTier,
  resolveRoomCapabilities,
  submitCourseRating,
} from '../progression/store';
import {
  createCourseDraft,
  loadLatestEditableDraftCourseForRoom,
  loadCourseRecord,
  loadPublishedCourse,
  publishCourse,
  saveCourseDraft,
  unpublishCourse,
} from './store';
import { loadRoomSnapshotsByReferences } from '../rooms/store';
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
import {
  buildCourseLeaderboardResponse,
  loadRankedCourseLeaderboardRows,
  loadViewerRankedCourseLeaderboardRow,
} from './leaderboards';
import {
  computeEffectiveElapsedMs,
  normalizeFinalizedCourseRunBody,
  parseCourseRatingBody,
  parseCourseRunFinishBody,
  parseCourseRunStartBody,
  parseCourseSnapshotBody,
} from './requestBodies';
import { sqlIsVerificationAccepted } from '../runs/verificationSql';

interface CoursePublishRouteOptions {
  enforceDailyPublishLimit?: boolean;
  executionContext?: WorkerExecutionContextLike;
}

export async function handleCourseCreate(
  request: Request,
  env: Env
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'create course drafts',
    'rooms:write'
  );
  const snapshot = await parseCourseSnapshotBody(request);
  const record = await createCourseDraft(env, snapshot, auth.user, auth.isAdmin, auth.source);
  return jsonResponse(request, record);
}

export async function handleCourseGet(
  request: Request,
  env: Env,
  courseId: string
): Promise<Response> {
  const auth = await loadOptionalRequestAuth(env, request);
  requireOptionalScope(auth, 'rooms:read', 'read courses');
  const record = await loadCourseRecord(
    env,
    courseId,
    auth?.user.id ?? null,
    auth?.isAdmin ?? false
  );

  if (!record) {
    throw new HttpError(404, 'Course not found.');
  }

  if (record.permissions.canSaveDraft || auth?.isAdmin) {
    const editableRecord = auth
      ? await attachExpandedRoomCellLimitForUser(env, record, auth.user.id, auth.source)
      : record;
    return jsonResponse(request, editableRecord);
  }

  if (!record.published) {
    throw new HttpError(404, 'Published course not found.');
  }

  return jsonResponse(request, sanitizeCourseRecordForPublicRead(record));
}

export async function handleCourseDraftByRoomLookup(
  request: Request,
  env: Env,
  roomId: string
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'load editable course drafts',
    'rooms:write'
  );
  const record = await loadLatestEditableDraftCourseForRoom(
    env,
    roomId,
    auth.user.id,
    auth.isAdmin
  );

  if (!record) {
    throw new HttpError(404, 'Draft course not found for this room.');
  }

  return jsonResponse(
    request,
    await attachExpandedRoomCellLimitForUser(env, record, auth.user.id, auth.source)
  );
}

export async function handleCourseDraftSave(
  request: Request,
  env: Env,
  courseId: string
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'save course drafts',
    'rooms:write'
  );
  const snapshot = await parseCourseSnapshotBody(request, courseId);
  const record = await saveCourseDraft(env, snapshot, auth.user, auth.isAdmin, auth.source);
  return jsonResponse(request, record);
}

export async function handleCoursePublish(
  request: Request,
  env: Env,
  courseId: string,
  options: CoursePublishRouteOptions = {}
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'publish courses',
    'rooms:write'
  );
  const existing = await loadCourseRecord(env, courseId, auth.user.id, auth.isAdmin);
  if (!existing) {
    throw new HttpError(404, 'Course draft not found.');
  }

  if (options.enforceDailyPublishLimit !== false) {
    await assertUserCanPublishContent(env, auth.user.id, auth.source);
  }

  const record = await publishCourse(env, courseId, auth.user, auth.isAdmin, auth.source);
  await awardCoursePublishPoints(
    env,
    auth.user.id,
    record.draft.id,
    record.published?.version ?? record.draft.version,
    !existing.published
  );
  await awardCoursePublishProgression(env, {
    userId: auth.user.id,
    courseId: record.draft.id,
    courseVersion: record.published?.version ?? record.draft.version,
    publishedSnapshot: record.published ?? record.draft,
    previousPublishedSnapshot: existing.published,
    publishedAt: record.published?.publishedAt ?? new Date().toISOString(),
    isFirstPublish: !existing.published,
  });
  await upsertUserStats(env, auth.user.id);
  schedulePlayableContentIndexRefresh(
    options.executionContext,
    refreshPlayableContentIndexForExpandedRoom(env, expandedRoomIdFromLegacyCourseId(courseId)),
  );
  return jsonResponse(request, record);
}

export async function handleCourseUnpublish(
  request: Request,
  env: Env,
  courseId: string,
  executionContext?: WorkerExecutionContextLike,
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'unpublish courses',
    'rooms:write'
  );
  const record = await unpublishCourse(env, courseId, auth.user, auth.isAdmin);
  schedulePlayableContentIndexRefresh(
    executionContext,
    refreshPlayableContentIndexForExpandedRoom(env, expandedRoomIdFromLegacyCourseId(courseId)),
  );
  return jsonResponse(
    request,
    await attachExpandedRoomCellLimitForUser(env, record, auth.user.id, auth.source)
  );
}

async function attachExpandedRoomCellLimitForUser(
  env: Env,
  record: CourseRecord,
  userId: string,
  requestAuthSource: Parameters<typeof resolveRoomCapabilities>[2]
): Promise<CourseRecord> {
  const capabilities = await resolveRoomCapabilities(env, userId, requestAuthSource);
  return {
    ...record,
    expandedRoomCellLimit: capabilities.expandedRoomCellLimit,
  };
}

export async function handleCourseRunStart(
  request: Request,
  env: Env,
  courseId: string
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'submit course runs',
    'runs:write'
  );
  await assertWampLeaderboardWriteAllowed(env, auth, 'play');
  const body = await parseCourseRunStartBody(request, courseId);
  const snapshot = await resolvePublishedCourseVersion(env, body.courseId, body.courseVersion);
  if (!snapshot.goal) {
    throw new HttpError(400, 'This course version does not have an active goal.');
  }

  const canonicalGoal = cloneCourseGoal(snapshot.goal);
  if (JSON.stringify(canonicalGoal) !== JSON.stringify(body.goal)) {
    throw new HttpError(409, 'Run goal does not match the published course version.');
  }

  const attemptId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const verificationNonce = createRunVerificationNonce();
  const snapshotHash = await computeCourseSnapshotVerificationHash(snapshot);

  await env.DB.batch([
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
      snapshot.id,
      snapshot.version,
      canonicalGoal!.type,
      JSON.stringify(canonicalGoal),
      auth.user.id,
      auth.user.displayName,
      startedAt,
      verificationNonce,
      snapshotHash,
    ),
  ]);

  const responseBody: CourseRunStartResponse = {
    attemptId,
    courseId: snapshot.id,
    courseVersion: snapshot.version,
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

export async function handleCourseRunFinish(
  request: Request,
  env: Env,
  attemptId: string
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'submit course runs',
    'runs:write'
  );
  await assertWampLeaderboardWriteAllowed(env, auth, 'play');
  const body = await parseCourseRunFinishBody(request);
  const existing = await loadCourseRunByAttemptId(env, attemptId);
  if (!existing) {
    throw new HttpError(404, 'Expanded room run attempt was not found.');
  }

  if (existing.userId !== auth.user.id) {
    throw new HttpError(403, 'You can only finish your own expanded room run attempts.');
  }

  if (existing.result !== 'active') {
    throw new HttpError(409, 'This course run attempt has already been finalized.');
  }

  const snapshot = await resolvePublishedCourseVersion(env, existing.courseId, existing.courseVersion);
  if (!snapshot.goal) {
    throw new HttpError(409, 'This course version no longer has a leaderboard goal.');
  }
  const courseRecord = await loadCourseRecord(env, existing.courseId, auth.user.id, auth.isAdmin);
  if (!courseRecord) {
    throw new HttpError(404, 'Course record not found.');
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
      reportedElapsedMs
    ),
    finishedAt,
  };
  const provisionalScore =
    clampedBody.result === 'completed' ? computeCourseRunScore(snapshot.goal, clampedBody) : 0;
  const provisionalPreviousBest =
    clampedBody.result === 'completed'
      ? await loadBestCompletedCourseRunForUserAndVersion(
          env,
          auth.user.id,
          existing.courseId,
          existing.courseVersion,
          null,
        )
      : null;
  const provisionalIsFirstCompletion =
    clampedBody.result === 'completed' && provisionalPreviousBest === null;
  const provisionalCandidateRun: CourseRunRecord | null =
    clampedBody.result === 'completed'
      ? {
          attemptId,
          courseId: existing.courseId,
          courseVersion: existing.courseVersion,
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
      sortCompletedCourseRunsForLeaderboard(
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
      ? await loadRankedCourseLeaderboardRows(
          env,
          snapshot.id,
          snapshot.version,
          snapshot.goal,
          10,
        )
      : [];
  const viewerBestRow =
    clampedBody.result === 'completed'
      ? await loadViewerRankedCourseLeaderboardRow(
          env,
          snapshot.id,
          snapshot.version,
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
      attemptId
    ),
  ]);

  if (verificationTrigger?.required && verificationAudit) {
    await recordRunVerificationAudit(env, {
      attemptId,
      kind: 'course',
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
      kind: 'course',
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
        ? 'Missing verification trace for ranked course run.'
        : verificationReason === 'trace_client_outdated'
          ? 'Client update required for ranked verification.'
          : 'Ranked course run could not be verified.',
    );
  }

  if (verificationStatus === 'timeout') {
    throw new HttpError(409, 'Ranked run verification timed out.');
  }

  const finalizedRun = await loadCourseRunByAttemptId(env, attemptId);
  if (!finalizedRun) {
    throw new HttpError(500, 'Failed to reload finalized course run.');
  }

  let isFirstCompletion = false;
  let isNewPersonalBest = false;
  if (finalizedRun.result === 'completed') {
    const previousBest = await loadBestCompletedCourseRunForUserAndVersion(
      env,
      auth.user.id,
      finalizedRun.courseId,
      finalizedRun.courseVersion,
      attemptId
    );
    isFirstCompletion = previousBest === null;
    isNewPersonalBest =
      previousBest === null ||
      sortCompletedCourseRunsForLeaderboard([finalizedRun, previousBest], snapshot.goal)[0]?.attemptId ===
        finalizedRun.attemptId;
  }

  await awardRunFinalizePoints(env, finalizedRun, {
    isFirstCompletion,
    isNewPersonalBest,
  });
  const creatorPointEvent =
    finalizedRun.result === 'completed'
      ? await awardCourseCreatorCompletionPoints(env, {
          creatorUserId: await resolvePublishedCourseOwnerUserId(env, finalizedRun.courseId),
          courseId: finalizedRun.courseId,
          courseVersion: finalizedRun.courseVersion,
          finisherUserId: finalizedRun.userId,
          attemptId: finalizedRun.attemptId,
        })
      : null;

  if (creatorPointEvent) {
    await upsertUserStats(env, creatorPointEvent.user_id);
  }

  await awardCourseRunProgression(env, {
    run: finalizedRun,
    goal: snapshot.goal,
    isFirstCompletion,
    isNewPersonalBest,
    creatorUserId: await resolvePublishedCourseOwnerUserId(env, finalizedRun.courseId),
    courseRecord,
    completedAt: finishedAt,
  });
  await upsertUserStats(env, auth.user.id);
  return noContentResponse(request);
}

export async function handleCourseLeaderboard(
  request: Request,
  url: URL,
  env: Env,
  courseId: string
): Promise<Response> {
  const timing = new ServerTiming();
  const auth = await timing.measure('auth', () => loadOptionalRequestAuth(env, request));
  requireOptionalScope(auth, 'leaderboards:read', 'read course leaderboards');
  const version = parseOptionalPositiveIntegerQueryParam(url.searchParams, 'version');
  const limit = parsePositiveIntegerQueryParam(url.searchParams, 'limit', 10, 1, 50);
  const snapshot = await timing.measure(
    'published_version',
    () => resolvePublishedCourseVersion(env, courseId, version ?? undefined),
  );
  if (!snapshot.goal) {
    throw new HttpError(404, 'This course version does not have a leaderboard goal.');
  }
  const record = await timing.measure(
    'course_record',
    () => loadCourseRecord(env, courseId, auth?.user.id ?? null, auth?.isAdmin ?? false),
  );
  if (!record) {
    throw new HttpError(404, 'Course not found.');
  }

  const leaderboard = await timing.measure('leaderboard', () => buildCourseLeaderboardResponse(
    env,
    record,
    snapshot,
    limit,
    auth?.user.id ?? null
  ));
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

export async function handleCourseRatingSubmit(
  request: Request,
  env: Env,
  courseId: string,
  executionContext?: WorkerExecutionContextLike,
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'rate courses',
    'runs:write',
  );
  const body = await parseCourseRatingBody(request);
  const record = await loadCourseRecord(env, courseId, auth.user.id, auth.isAdmin);
  if (!record) {
    throw new HttpError(404, 'Course not found.');
  }

  const responseBody = await submitCourseRating(env, {
    courseRecord: record,
    userId: auth.user.id,
    body,
  });
  schedulePlayableContentIndexRefresh(
    executionContext,
    refreshPlayableContentIndexForExpandedRoom(env, expandedRoomIdFromLegacyCourseId(courseId)),
  );
  return jsonResponse(request, responseBody);
}

function sanitizeCourseRecordForPublicRead(record: CourseRecord): CourseRecord {
  const published = record.published ? cloneCourseSnapshot(record.published) : null;
  if (!published) {
    throw new HttpError(404, 'Published course not found.');
  }

  return {
    draft: cloneCourseSnapshot(published),
    published,
    versions: record.versions.map(cloneCourseRecordVersionForPublicRead),
    ownerUserId: record.ownerUserId,
    ownerDisplayName: record.ownerDisplayName,
    permissions: {
      canSaveDraft: false,
      canPublish: false,
      canUnpublish: false,
    },
  };
}

function cloneCourseRecordVersionForPublicRead(version: CourseRecord['versions'][number]) {
  return {
    ...version,
    snapshot: cloneCourseSnapshot(version.snapshot),
  };
}

async function resolvePublishedCourseVersion(
  env: Env,
  courseId: string,
  version?: number
): Promise<CourseSnapshot> {
  const course = await loadPublishedCourse(env, courseId);
  if (course && (version === undefined || version === null || course.version === version)) {
    return cloneCourseSnapshot(course);
  }

  const record = await loadCourseRecord(env, courseId);
  if (!record) {
    throw new HttpError(404, 'Course not found.');
  }
  if (version === undefined || version === null) {
    throw new HttpError(404, 'Published course not found.');
  }
  const historicalVersion =
    record?.versions.find((entry) => entry.version === version) ?? null;
  if (!historicalVersion) {
    throw new HttpError(404, `Course version ${version} was not found.`);
  }

  return cloneCourseSnapshot(historicalVersion.snapshot);
}

async function loadCourseVerificationRoomsById(
  env: Env,
  course: CourseSnapshot,
  _viewerUserId: string | null,
  _viewerWalletAddress: string | null,
): Promise<Map<string, RoomSnapshot>> {
  const response = await loadRoomSnapshotsByReferences(env, course.roomRefs.map((roomRef) => ({
    kind: 'version' as const,
    roomId: roomRef.roomId,
    version: roomRef.roomVersion,
  })));
  const snapshotsByKey = new Map(response.snapshots.map((entry) => [entry.key, entry.snapshot]));
  const roomsById = new Map<string, RoomSnapshot>();
  for (const roomRef of course.roomRefs) {
    const historicalVersion = snapshotsByKey.get(`version:${roomRef.roomId}:${roomRef.roomVersion}`) ?? null;
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

async function loadCourseRunByAttemptId(
  env: Env,
  attemptId: string
): Promise<CourseRunRecord | null> {
  const row = await env.DB.prepare(
    `
      SELECT
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
      FROM course_runs
      WHERE attempt_id = ?
      LIMIT 1
    `
  )
    .bind(attemptId)
    .first<CourseRunRow>();

  return row ? mapCourseRunRow(row) : null;
}

function mapCourseRunRow(row: CourseRunRow): CourseRunRecord {
  const goal = parseStoredCourseGoal(row.goal_json, 'course run goal');
  return {
    attemptId: row.attempt_id,
    courseId: row.course_id,
    courseVersion: row.course_version,
    goalType: goal.type,
    goal,
    userId: row.user_id,
    userDisplayName: row.user_display_name,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    result: row.result as RunResult,
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

function parseStoredCourseGoal(raw: string, label: string) {
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

async function loadBestCompletedCourseRunForUserAndVersion(
  env: Env,
  userId: string,
  courseId: string,
  courseVersion: number,
  excludeAttemptId: string | null
): Promise<CourseRunRecord | null> {
  const result = await env.DB.prepare(
    `
      SELECT
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
        checkpoints_reached
      FROM course_runs
      WHERE user_id = ?
        AND course_id = ?
        AND course_version = ?
        AND result = 'completed'
        AND ${sqlIsVerificationAccepted('course_runs')}
        AND (? IS NULL OR attempt_id != ?)
    `
  )
    .bind(userId, courseId, courseVersion, excludeAttemptId, excludeAttemptId)
    .all<CourseRunRow>();

  const runs = result.results
    .filter(
      (row): row is CourseRunRow & { elapsed_ms: number; finished_at: string } =>
        typeof row.elapsed_ms === 'number' && typeof row.finished_at === 'string'
    )
    .map(mapCourseRunRow);

  if (runs.length === 0) {
    return null;
  }

  const course = await resolvePublishedCourseVersion(env, courseId, courseVersion);
  if (!course.goal) {
    return null;
  }
  return sortCompletedCourseRunsForLeaderboard(runs, course.goal)[0] ?? null;
}

async function resolvePublishedCourseOwnerUserId(
  env: Env,
  courseId: string
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

import { DiscoveryPublicCache } from './discoveryPublicCache';
import { loadCachedRoomStandings } from './roomLeaderboardCache';
import { parseGlobalLeaderboardWindow } from './globalLeaderboards';
import { canReuseGlobalLeaderboardBase, loadGlobalLeaderboardViewer } from './globalLeaderboardViewer';
import type { GlobalLeaderboardResponse } from '../../../runs/model';
import { buildVerifiedRoomGhost, saveBuiltPersonalBestGhost } from './ghosts';
import { prepareRunGhostArchive, scheduleRunGhostArchive } from './ghostArchive';
import { assertSoloRoomRun } from './coopPolicy';
import {
  assertReplayableRunFinish, awaitInOrder, finalizeStatementWon, loadRunFinishOrder, nextFinalizeSeqSql, readAhead,
  recordRunSettlement, runNeedsResettle, runPastDisconnect, runVerificationError,
  type RunFinishMessages,
} from './finishReplay';
import { deathLocationsJson } from '../insights/deathLocations';
import { scheduleActivityEmails } from '../activity/emails';
import { applyVerifiedRunMetrics, evaluateRunFinalizationVerification } from './finalizationVerification';
import { cloneRoomGoal, normalizeRoomGoal, type RoomGoal } from '../../../goals/roomGoals';
import { cloneRoomSnapshot, type RoomSnapshot } from '../../../persistence/roomModel';
import { findRoomVersionSnapshot, type RoomRecordView } from '../../../persistence/roomVersionLineage';
import { computeRunScore, sortCompletedRunsForLeaderboard } from '../../../runs/scoring';
import { RANKED_RUN_TRACE_SCHEMA_VERSION } from '../../../runs/verificationTrace';
import type {
  RoomDiscoverySort,
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
import { ServerTiming, timedJsonResponse } from '../core/serverTiming';
import type { Env, RoomRunRow, WorkerExecutionContextLike } from '../core/types';
import { recordDiscoveryRunPlayer, scheduleDiscoveryMetrics } from '../playableContentIndex/runMetrics';
import { scheduleRunRewards } from './deferredRewards';
import { hasPublicCache, loadAnonymousPublicCache } from '../core/publicCache';
import {
  refreshPlayableContentIndexForRoom,
  schedulePlayableContentIndexRefresh,
} from '../playableContentIndex/store';
import { requireAuthenticatedRequestAuth, loadOptionalRequestAuth, requireOptionalScope } from '../auth/request';
import { loadExactRoomVersion } from '../rooms/store';
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
  loadBuilderDiscoveryResponse,
  loadRoomDiscoveryResponse,
  parseBuilderDiscoverySortOrThrow,
  parseRoomDiscoverySortOrThrow,
  parseRoomDifficultyOrThrow,
} from './difficulty';
import {
  parseRoomDifficultyVoteBody,
  parseRoomRatingBody,
  normalizeFinalizedRunBody,
  parseRunFinishBody,
  parseRunStartBody,
} from './requestBodies';
import {
  resolveAggregatedRoomLeaderboardSelection,
} from './roomLeaderboardAggregation';
import {
  awardRoomRunProgression,
  awardRunDailyClear,
  loadEffectiveTrustTier,
  submitRoomRating,
} from '../progression/store';
import { resolveRoomClearRewardScope, scopeClearRewardFlags } from '../progression/clearRewardScope';
import { loadRoomRankingRecord } from '../rooms/rankingRecord';
import {
  computeRoomSnapshotVerificationHash,
  createRoomVerificationTrigger,
  createRunVerificationNonce,
  recordRunVerificationAudit,
  requireVerificationTrace,
  verifyRoomRunTrace,
} from './verification';
import {
  buildGlobalLeaderboardResponse,
  buildRoomLeaderboardResponse,
  loadRankedRoomLeaderboardRows,
  loadViewerRankedRoomLeaderboardRow,
} from './leaderboards';

export async function handleRunStart(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'submit leaderboard runs',
    'runs:write'
  );
  const body = await parseRunStartBody(request);
  const exactVersion = await loadExactRoomVersion(env, body.roomId, body.roomVersion);
  if (!exactVersion) throw new HttpError(404, `Room version ${body.roomVersion} was not found.`);
  const snapshot = cloneRoomSnapshot(exactVersion.snapshot);
  assertSoloRoomRun(snapshot);

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

const ROOM_RUN_FINISH_MESSAGES: RunFinishMessages = {
  missingTrace: 'Missing verification trace for ranked run.',
  unverified: 'Ranked run could not be verified.',
  timedOut: 'Ranked run verification timed out.',
  finalized: 'This run attempt has already been finalized.',
};

export async function handleRunFinish(
  request: Request,
  env: Env,
  attemptId: string,
  executionContext?: WorkerExecutionContextLike,
): Promise<Response> {
  if (!attemptId) {
    throw new HttpError(400, 'Attempt id is required.');
  }

  // The run row needs only the attempt id, so it loads while the player signs in (F333).
  const existingRead = readAhead(loadRoomRunByAttemptId(env, attemptId));
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'submit leaderboard runs',
    'runs:write'
  );
  const body = await parseRunFinishBody(request);
  const existing = await existingRead;

  if (!existing) {
    throw new HttpError(404, 'Run attempt was not found.');
  }

  if (existing.userId !== auth.user.id) {
    throw new HttpError(403, 'You can only finish your own run attempts.');
  }

  // A resend of a finished attempt replays its stored answer (F351).
  const resend = existing.result !== 'active';
  if (resend) {
    assertReplayableRunFinish(existing, body.result, ROOM_RUN_FINISH_MESSAGES);
    if (!(await runNeedsResettle(env, 'room', attemptId, existing.finishedAt))) return noContentResponse(request);
  }
  // A clear is checked against the player's trust tier, which needs only the player: it loads with the room.
  const trustTierRead = !resend && body.result === 'completed' ? readAhead(loadEffectiveTrustTier(env, auth.user.id)) : null;

  const roomRecord = await loadRoomRankingRecord(env, existing.roomId, existing.roomCoordinates, {
    viewerUserId: auth.user.id,
    viewerWalletAddress: auth.user.walletAddress ?? null,
    snapshotVersions: [existing.roomVersion],
  });
  const snapshot = resolveRoomSnapshotForVersion(roomRecord, existing.roomVersion);
  assertSoloRoomRun(snapshot);
  if (!snapshot.goal) {
    throw new HttpError(409, 'This room version no longer has a leaderboard goal.');
  }
  const settlement = { attemptId, userId: auth.user.id, goal: snapshot.goal, roomRecord,
    roomId: existing.roomId, roomVersion: existing.roomVersion,
    rewardScope: resolveRoomClearRewardScope(roomRecord, existing.roomVersion, auth.user.id) };
  // An earlier finish committed, then threw or was cut off before its rewards finished.
  const settleResend = async (stored: Pick<RoomRunRecord, 'result' | 'finishedAt'>): Promise<Response> => {
    if (await runNeedsResettle(env, 'room', attemptId, stored.finishedAt)) {
      await runPastDisconnect(executionContext, attemptId,
        settleRoomRunFinish(env, executionContext, { ...settlement, result: stored.result, completedGhost: null }));
    }
    return noContentResponse(request);
  };
  if (resend) return settleResend(existing);

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
  const { rewardScope } = settlement;
  const provisionalScore =
    clampedBody.result === 'completed' ? computeRunScore(snapshot.goal, clampedBody) : 0;
  // The player's best, the top 10 and the player's row are independent reads: one wait (F333).
  const [provisionalPreviousBest, currentTopRows, viewerBestRow] = clampedBody.result === 'completed'
    ? await awaitInOrder([
        loadBestCompletedRunForUserAndRoomVersion(env, auth.user.id, existing.roomId, rewardScope.versions, snapshot.goal),
        loadRankedRoomLeaderboardRows(env, snapshot.id, leaderboardSelection.leaderboardFamilyVersions, snapshot.goal, 10),
        loadViewerRankedRoomLeaderboardRow(
          env, snapshot.id, leaderboardSelection.leaderboardFamilyVersions, snapshot.goal, auth.user.id,
        ),
      ])
    : [null, [], null] as const;
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
      ? previewRunFinalizePoints(provisionalCandidateRun, scopeClearRewardFlags(rewardScope, {
          isFirstCompletion: provisionalIsFirstCompletion,
          isNewPersonalBest: provisionalIsNewPersonalBest,
        }))
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
      : await (trustTierRead ?? loadEffectiveTrustTier(env, auth.user.id));
  const verification = await evaluateRunFinalizationVerification(
    baseVerificationTrigger,
    effectiveTrustTier,
    async () => verifyRoomRunTrace({
      trace: requireVerificationTrace(clampedBody.verificationTrace),
      binding: {
        verificationNonce: existing.verificationNonce ?? null,
        verificationSnapshotHash: existing.verificationSnapshotHash ?? null,
      },
      room: snapshot,
      // The trace follows the simulation clock. Network/finish latency stays
      // in the ranked server-time floor, rather than invalidating its movement.
      elapsedMs: reportedElapsedMs,
      deaths: clampedBody.deaths,
    }),
  );
  const { status: verificationStatus, reason: verificationReason } = verification;
  let finalBody = clampedBody;
  let finalScore = provisionalScore;
  if (verification.result?.status === 'passed') {
    finalBody = normalizeFinalizedRunBody(
      snapshot.goal,
      {
        ...applyVerifiedRunMetrics(clampedBody, verification.result.derivedMetrics),
        enemyCollectiblesCollected: verification.result.derivedMetrics.enemyCollectiblesCollected,
      },
      metricCaps,
      reportedElapsedMs,
    );
    finalScore = computeRunScore(snapshot.goal, finalBody);
  }

  const completedGhost = finalBody.result === 'completed'
    && (verificationStatus === 'passed' || verificationStatus === 'not_required')
    ? await buildVerifiedRoomGhost({ ...existing,
      elapsedMs: finalBody.elapsedMs, deaths: finalBody.deaths, finishedAt },
    snapshot, finalBody, auth.user.selectedAvatarId ?? 'default-player', verificationStatus === 'passed', reportedElapsedMs)
    : null;

  const [finalized] = await env.DB.batch<{ results?: unknown[]; meta?: { changes?: number } }>([
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
          verification_reason = ?,
          insight_deaths_json = ?,
          insight_play_ms = ?,
          ${nextFinalizeSeqSql('room_runs')}
        WHERE attempt_id = ? AND result = 'active'
        RETURNING attempt_id
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
      deathLocationsJson(finalBody.verificationTrace, { verificationNonce: existing.verificationNonce, snapshotHash: existing.verificationSnapshotHash }, [existing.roomCoordinates], finalBody.elapsedMs, finalBody.deaths),
      Math.min(30 * 60 * 1000, reportedElapsedMs),
      attemptId
    ),
    ...(completedGhost ? [prepareRunGhostArchive(env, completedGhost, {
      source: 'room', userId: auth.user.id, deaths: finalBody.deaths, createdAt: finishedAt,
    })] : []),
  ]);
  if (!finalizeStatementWon(finalized)) {
    // A resend raced this request and finalized first: replay its answer. Its awards are keyed.
    const stored = await loadRoomRunByAttemptId(env, attemptId);
    assertReplayableRunFinish(stored, body.result, ROOM_RUN_FINISH_MESSAGES);
    return settleResend(stored);
  }

  const verificationError = runVerificationError(verificationStatus, verificationReason, ROOM_RUN_FINISH_MESSAGES);
  // The audit row and the reward step write different rows, so they share a wait (F333). The reply
  // waits for both, and either failing still answers with an error the client retries.
  await runPastDisconnect(executionContext, attemptId, (async () => {
    await awaitInOrder([
      verificationError ? null : settleRoomRunFinish(env, executionContext, { ...settlement, result: finalBody.result, completedGhost }),
      verification.audit && recordRunVerificationAudit(env, {
        attemptId,
        kind: 'room',
        ...verification.audit,
        // Unverified (skipped) runs keep their recording so they can be reviewed later.
        trace: finalBody.verificationTrace ?? null,
        createdAt: finishedAt,
      }),
    ]);
  })());
  if (verificationError) throw verificationError;
  return noContentResponse(request);
}

interface RoomRunSettlement {
  attemptId: string;
  userId: string;
  goal: RoomGoal;
  roomRecord: Awaited<ReturnType<typeof loadRoomRankingRecord>>;
  /** The run's room and version (fixed at start), and the result its finalize stored. */
  roomId: string;
  roomVersion: number;
  result: RoomRunRecord['result'];
  rewardScope: ReturnType<typeof resolveRoomClearRewardScope>;
  /** Only the request that finalized the run holds its built ghost; a resend skips the PB ghost. */
  completedGhost: Awaited<ReturnType<typeof buildVerifiedRoomGhost>> | null;
}

/**
 * Everything after the finalize commit: discovery, reward flags, the PB ghost, the daily clear and
 * the deferred rewards. Every award is keyed, so a recent resend runs this again when an earlier try
 * threw or was cut off after the commit; its run_settlements row goes last, as the marker (F351).
 */
async function settleRoomRunFinish(
  env: Env,
  executionContext: WorkerExecutionContextLike | undefined,
  { attemptId, userId, goal, roomRecord, roomId, roomVersion, result, rewardScope, completedGhost }: RoomRunSettlement,
): Promise<void> {
  // Only clears stored before this one count, so a late resend and a later clear agree on "first".
  // The earlier clears load with the run itself and are filtered by its commit order (F333).
  const order = result === 'completed' ? readAhead(loadRunFinishOrder(env, 'room_runs', attemptId)) : null;
  const scopeIsVersion = rewardScope.versions.length === 1 && rewardScope.versions[0] === roomVersion;
  const [finalizedRun, previousBest, scopeBest] = await awaitInOrder([
    loadRoomRunByAttemptId(env, attemptId),
    order && loadBestCompletedRunForUserAndRoomVersion(env, userId, roomId, roomVersion, goal, attemptId, order),
    order && !scopeIsVersion
      ? loadBestCompletedRunForUserAndRoomVersion(env, userId, roomId, rewardScope.versions, goal, attemptId, order)
      : null,
  ]);
  if (!finalizedRun) {
    throw new HttpError(500, 'Failed to reload finalized run.');
  }
  // The stored finish time keeps a resend's day and week reward keys on the original clear.
  const finishedAt = finalizedRun.finishedAt ?? new Date().toISOString();
  await scheduleDiscoveryMetrics(executionContext, recordDiscoveryRunPlayer(
    env, 'room:' + finalizedRun.roomId, finalizedRun.roomVersion, userId,
    { ...finalizedRun, elapsedMs: finalizedRun.elapsedMs ?? 0, finishedAt },
  ));

  // The personal-best ghost follows this exact version; rewards follow the reward scope.
  let isNewPersonalBest = false;
  let rewardFlags = { isFirstCompletion: false, isNewPersonalBest: false };
  if (finalizedRun.result === 'completed' && order) {
    const isBetterThan = (best: RoomRunRecord | null) => best === null
      || sortCompletedRunsForLeaderboard([finalizedRun, best], goal)[0]?.attemptId === finalizedRun.attemptId;
    isNewPersonalBest = isBetterThan(previousBest);
    const rewardBest = scopeIsVersion ? previousBest : scopeBest;
    rewardFlags = scopeClearRewardFlags(rewardScope, {
      isFirstCompletion: rewardBest === null,
      isNewPersonalBest: isBetterThan(rewardBest),
    });
  }

  // The PB ghost and the daily clear write different rows; the reply waits for both (F333).
  await awaitInOrder([
    (async () => {
      if (isNewPersonalBest && completedGhost) {
        try {
          await saveBuiltPersonalBestGhost(env, finalizedRun, completedGhost);
        } catch {
          console.error(JSON.stringify({ event: 'run-ghost-save-failed', attemptId }));
        }
      }
      if (completedGhost) await scheduleRunGhostArchive(env, executionContext, attemptId);
    })(),
    awardRunDailyClear(env, finalizedRun,
      { type: 'room', id: finalizedRun.roomId, version: finalizedRun.roomVersion }, finishedAt),
  ]);
  await scheduleRunRewards(executionContext, attemptId, async () => {
    await awardRunFinalizePoints(env, finalizedRun, rewardFlags, finishedAt);
    const creatorPointEvent =
      finalizedRun.result === 'completed'
        ? await awardRoomCreatorCompletionPoints(env, {
            creatorUserId: resolveRoomVersionPublisherUserId(roomRecord, finalizedRun.roomVersion),
            roomId: finalizedRun.roomId,
            roomVersion: finalizedRun.roomVersion,
            finisherUserId: finalizedRun.userId,
            attemptId: finalizedRun.attemptId,
            rewardVersions: rewardScope.versions,
            createdAt: finishedAt,
          })
        : null;
    if (creatorPointEvent) {
      await upsertUserStats(env, creatorPointEvent.user_id);
    }
    await awardRoomRunProgression(env, {
      run: finalizedRun,
      goal,
      ...rewardFlags,
      creatorUserId: resolveRoomVersionPublisherUserId(roomRecord, finalizedRun.roomVersion),
      roomRecord,
      completedAt: finishedAt,
      ownContent: rewardScope.ownContent,
    });
    scheduleActivityEmails(env, executionContext, finalizedRun.attemptId);
    await upsertUserStats(env, userId);
    // Last: runNeedsResettle reads this row as "every reward above finished".
    await recordRunSettlement(env, 'room', attemptId);
  });
}

export async function handleRoomLeaderboard(
  request: Request,
  url: URL,
  env: Env,
  roomId: string,
  context?: WorkerExecutionContextLike,
): Promise<Response> {
  const timing = new ServerTiming();
  const auth = await timing.measure('auth', () => loadOptionalRequestAuth(env, request));
  requireOptionalScope(auth, 'leaderboards:read', 'read room leaderboards');
  const fresh = url.searchParams.get('fresh') === '1';
  const coordinates = getCoordinatesFromRequest(roomId, url.searchParams);
  const version = parseOptionalPositiveIntegerQueryParam(url.searchParams, 'version');
  const limit = parsePositiveIntegerQueryParam(url.searchParams, 'limit', 10, 1, 50);
  // Resolve access and lineage on every request, including a warmed standings hit.
  const record = await timing.measure('room_record', () => loadRoomRankingRecord(env, roomId, coordinates, {
    viewerUserId: auth?.user.id ?? null,
    viewerWalletAddress: auth?.user.walletAddress ?? null,
    viewerIsAdmin: auth?.isAdmin ?? false,
    snapshotVersions: [version],
  }));
  const selection = timing.measureSync('lineage', () => resolveAggregatedRoomLeaderboardSelection(record, version));
  if (!selection.snapshot.goal) throw new HttpError(404, 'This room version does not have a leaderboard goal.');
  // Keep non-prime Worlds out of the shared cache, including future private/school Worlds.
  const cached = !fresh && !record.world && hasPublicCache(context)
    ? timing.measure('standings', () => loadCachedRoomStandings(
      request, env, selection, limit, auth?.user.id ?? null, context!,
    )) : null;
  const [leaderboard, cacheResult] = await Promise.all([
    timing.measure('leaderboard', () => buildRoomLeaderboardResponse(
      env, record, selection, limit, auth?.user.id ?? null, cached?.then(result => result.standings),
    )),
    cached,
  ]);
  const status = cacheResult?.status ?? 'bypass';
  timing.setDiagnostic('cache', fresh ? 'fresh' : status);
  return timedJsonResponse(request, leaderboard, timing, {
    headers: {
      'Cache-Control': auth || fresh || record.world ? 'private, no-store' : 'public, max-age=20',
      'X-WAMP-Cache': status,
    },
  });
}

export async function handleRoomDifficultyVote(
  request: Request,
  env: Env,
  roomId: string,
  context?: WorkerExecutionContextLike,
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'rate room difficulty',
    'runs:write'
  );
  const body = await parseRoomDifficultyVoteBody(request);
  const record = await loadRoomRankingRecord(env, roomId, body.roomCoordinates, {
    viewerUserId: auth.user.id,
    viewerWalletAddress: auth.user.walletAddress ?? null,
    viewerIsAdmin: auth.isAdmin,
    snapshotVersions: [body.roomVersion],
  });
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
  schedulePlayableContentIndexRefresh(context, refreshPlayableContentIndexForRoom(env, roomId));

  return noContentResponse(request);
}

export async function handleRoomRatingSubmit(
  request: Request,
  env: Env,
  roomId: string,
  context?: WorkerExecutionContextLike,
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'rate rooms',
    'runs:write',
  );
  const body = await parseRoomRatingBody(request);
  const record = await loadRoomRankingRecord(env, roomId, body.roomCoordinates, {
    viewerUserId: auth.user.id,
    viewerWalletAddress: auth.user.walletAddress ?? null,
    viewerIsAdmin: auth.isAdmin,
    snapshotVersions: [body.roomVersion],
  });
  const responseBody = await submitRoomRating(env, {
    roomRecord: record,
    userId: auth.user.id,
    body,
  });
  schedulePlayableContentIndexRefresh(context, refreshPlayableContentIndexForRoom(env, roomId));
  return jsonResponse(request, responseBody);
}

export async function handleRoomDiscovery(
  request: Request,
  url: URL,
  env: Env,
  context?: WorkerExecutionContextLike,
): Promise<Response> {
  const timing = new ServerTiming();
  const auth = await timing.measure('auth', () => loadOptionalRequestAuth(env, request));
  requireOptionalScope(auth, 'leaderboards:read', 'discover room challenges');
  const rawDifficulty = url.searchParams.get('difficulty');
  const difficultyFilter =
    rawDifficulty && rawDifficulty.trim() ? parseRoomDifficultyOrThrow(rawDifficulty) : null;
  const rawSort = url.searchParams.get('sort');
  const sort = rawSort && rawSort.trim() ? parseRoomDiscoverySortOrThrow(rawSort) : 'featured';
  const limit = parsePositiveIntegerQueryParam(url.searchParams, 'limit', 100, 1, 200);
  const cursorOffset = decodeRoomDiscoveryCursor(url.searchParams.get('cursor'), sort);
  const includeGoalLessRooms =
    difficultyFilter === null
    && sort === 'newest'
    && parseBooleanQueryFlag(url.searchParams.get('includeGoalLessRooms'));
  const fresh = url.searchParams.get('fresh') === '1';
  const publicCache = new DiscoveryPublicCache(request, env, context, fresh);
  const response = await timing.measure('discovery', () => loadRoomDiscoveryResponse(
    env, difficultyFilter, limit, sort, includeGoalLessRooms, auth?.user.id ?? null, timing, cursorOffset, publicCache,
  ));
  timing.setDiagnostic('cache', fresh ? 'fresh' : publicCache.status);
  return timedJsonResponse(request, response, timing, {
    headers: {
      'Cache-Control': auth || fresh ? 'private, no-store' : 'public, max-age=20',
      'X-WAMP-Cache': publicCache.status,
    },
  });
}

function decodeRoomDiscoveryCursor(value: string | null, sort: RoomDiscoverySort): number {
  if (!value) return 0;
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = JSON.parse(atob(padded)) as {
      version?: unknown;
      sort?: unknown;
      offset?: unknown;
    };
    if (decoded.version !== 1 || decoded.sort !== sort) throw new Error('cursor mismatch');
    const offset = Number(decoded.offset);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) throw new Error('cursor offset');
    return offset;
  } catch {
    throw new HttpError(400, 'Invalid room discovery cursor.');
  }
}

export async function handleBuilderDiscovery(
  request: Request,
  url: URL,
  env: Env,
  context?: WorkerExecutionContextLike,
): Promise<Response> {
  const timing = new ServerTiming();
  const auth = await timing.measure('auth', () => loadOptionalRequestAuth(env, request));
  requireOptionalScope(auth, 'leaderboards:read', 'discover builders');
  const rawSort = url.searchParams.get('sort');
  const sort = rawSort && rawSort.trim() ? parseBuilderDiscoverySortOrThrow(rawSort) : 'alphabet';
  const limit = parsePositiveIntegerQueryParam(url.searchParams, 'limit', 100, 1, 200);
  const loadResponse = async () => {
    const response = await timing.measure('builders', () => loadBuilderDiscoveryResponse(env, limit, sort));
    timing.setDiagnostic('cache', 'public-20');
    return timedJsonResponse(request, response, timing, {
      headers: { 'Cache-Control': 'public, max-age=20' },
    });
  };
  // The builder list is viewer-independent; auth and scope checks still run before cache hits.
  return loadAnonymousPublicCache(request, context, loadResponse);
}

function parseBooleanQueryFlag(value: string | null): boolean {
  if (value === null) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
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
  env: Env,
  context?: WorkerExecutionContextLike,
): Promise<Response> {
  const window = parseGlobalLeaderboardWindow(url.searchParams.get('window'));
  const timing = new ServerTiming();
  const auth = await timing.measure('auth', () => loadOptionalRequestAuth(env, request));
  requireOptionalScope(auth, 'leaderboards:read', 'read global leaderboards');
  const limit = parsePositiveIntegerQueryParam(url.searchParams, 'limit', 10, 1, 50);
  const fresh = url.searchParams.get('fresh') === '1';
  const loadFullResponse = async () => {
    const leaderboard = await timing.measure('leaderboard', () =>
      buildGlobalLeaderboardResponse(env, limit, auth?.user.id ?? null, window));
    timing.setDiagnostic('cache', 'fresh');
    return timedJsonResponse(request, leaderboard, timing, {
      headers: { 'Cache-Control': 'private, no-store', 'X-WAMP-Cache': 'bypass' },
    });
  };
  // Weekly rollovers, explicit refreshes and unavailable caches retain one fresh snapshot.
  if (window === 'week' || fresh || (auth && !hasPublicCache(context))) return loadFullResponse();
  const publicResponse = await loadAnonymousPublicCache(request, context, async () => {
    const leaderboard = await timing.measure('leaderboard', () => buildGlobalLeaderboardResponse(env, limit, null, window));
    timing.setDiagnostic('cache', 'public-20');
    return timedJsonResponse(request, leaderboard, timing, { headers: { 'Cache-Control': 'public, max-age=20' } });
  });
  if (!auth) return publicResponse;
  const base = await publicResponse.json() as GlobalLeaderboardResponse;
  const viewer = await timing.measure('viewer', () => loadGlobalLeaderboardViewer(env, auth.user.id));
  // A new score/rank or changed adjacent player must not contradict a stale top list.
  if (!canReuseGlobalLeaderboardBase(base, viewer, auth.user.id, limit)) return loadFullResponse();
  const cache = publicResponse.headers.get('X-WAMP-Cache') ?? 'bypass';
  timing.setDiagnostic('cache', `public-${cache}-private-viewer`);
  return timedJsonResponse(request, { ...base, ...viewer }, timing, {
    headers: { 'Cache-Control': 'private, no-store', 'X-WAMP-Cache': cache },
  });
}

export function resolveRoomSnapshotForVersion(
  record: RoomRecordView,
  version: number
): RoomSnapshot {
  const snapshot = findRoomVersionSnapshot(record, version);
  if (!snapshot) {
    throw new HttpError(404, `Room version ${version} was not found.`);
  }

  return cloneRoomSnapshot(snapshot);
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

import { getAuthDebugState } from '../../auth/client';
import { createCourseRepository } from '../../courses/courseRepository';
import { isCourseApiError } from '../../courses/courseRepository';
import { getActiveCourseDraftSessionRoomOverrides } from '../../courses/draftSession';
import {
  cloneCourseSnapshot,
  type CourseGoal,
  type CourseRoomRef,
  type CourseSnapshot,
} from '../../courses/model';
import { expandedRoomIdFromLegacyCourseId } from '../../expandedRooms/model';
import {
  createExpandedRoomRepository,
  isExpandedRoomApiError,
} from '../../expandedRooms/repository';
import type {
  CourseLeaderboardResponse,
  CourseRunFinishRequestBody,
  CourseRunStartResponse,
} from '../../courses/runModel';
import { type GameObjectConfig } from '../../config';
import {
  cloneRoomSnapshot,
  roomIdFromCoordinates,
  type RoomCoordinates,
  type RoomSnapshot,
} from '../../persistence/roomModel';
import { createRoomRepository } from '../../persistence/roomRepository';
import {
  buildSharedRoomSnapshotKey,
  getSharedRoomSnapshot,
  setSharedRoomSnapshot,
} from '../../persistence/sharedRoomSnapshotCache';
import {
  isWampLeaderboardEligibleAuth,
} from '../../generatedUsers/leaderboardPolicy';
import {
  createActiveCourseRunState,
  type ActiveCourseRunState,
} from './courseRuns';
import { resolveCourseStartRoomRef } from './courseStartRoom';
import { suggestProgressionDifficulty } from '../../progression/autoDifficulty';
import {
  requestPostRunGuestClaim,
  requestPostRunRating,
} from '../../progression/postRunRatingEvents';
import {
  buildLeaderboardRankRewardStings,
  createPostRunClearReward,
  notifyRewardStings,
} from '../../progression/rewardStings';
import type { RankedRunVerificationTrace } from '../../runs/verificationTrace';

export type CoursePlaybackRoomSourceMode = 'published' | 'draftPreview';
type RankedCourseRunStartBinding = Pick<
  CourseRunStartResponse,
  'attemptId' | 'verificationSchemaVersion' | 'verificationNonce' | 'snapshotHash'
>;

interface OverworldCoursePlaybackHost {
  getSelectedCoordinates(): RoomCoordinates;
  getActiveCourseRun(): ActiveCourseRunState | null;
  setActiveCourseRun(runState: ActiveCourseRunState | null): void;
  clearTransientRoomOverride(roomId: string): void;
  clearTransientRoomOverrides(roomIds: Iterable<string>): void;
  setTransientRoomOverride(snapshot: RoomSnapshot): void;
  setTransientRoomOverrides(snapshots: Iterable<RoomSnapshot>): void;
  getRoomSnapshotForCoordinates(coordinates: RoomCoordinates): RoomSnapshot | null;
  countRoomObjectsByCategory(room: RoomSnapshot, category: GameObjectConfig['category']): number;
  showTransientStatus(message: string): void;
  renderHud(): void;
  onRankedRunStarted?(binding: {
    kind: 'course';
    verificationSchemaVersion: number;
    verificationNonce: string;
    snapshotHash: string;
  }): void;
  buildVerificationTrace?: (
    runState: ActiveCourseRunState,
    result: 'completed' | 'failed' | 'abandoned',
  ) => RankedRunVerificationTrace | null;
  clearVerificationTrace?: () => void;
}

export class OverworldCoursePlaybackController {
  private readonly roomRepository = createRoomRepository();
  private readonly courseRepository = createCourseRepository();
  private readonly expandedRoomRepository = createExpandedRoomRepository();
  private readonly activeCourseRoomOverrideIds = new Set<string>();
  private readonly pinnedCourseRoomSnapshotCache = new Map<string, RoomSnapshot>();

  constructor(private readonly host: OverworldCoursePlaybackHost) {}

  hasActiveCourseRoomOverride(roomId: string): boolean {
    return this.activeCourseRoomOverrideIds.has(roomId);
  }

  clearActiveCourseRoomOverrides(): void {
    this.host.clearTransientRoomOverrides(this.activeCourseRoomOverrideIds);
    this.activeCourseRoomOverrideIds.clear();
  }

  async prepareActiveCourseRoomOverrides(
    course: CourseSnapshot,
    options: {
      mode: CoursePlaybackRoomSourceMode;
      roomOverrides?: RoomSnapshot[];
    },
  ): Promise<void> {
    this.clearActiveCourseRoomOverrides();
    const overrideByRoomId = new Map<string, RoomSnapshot>();
    if (options.mode === 'draftPreview') {
      for (const room of options.roomOverrides ?? []) {
        overrideByRoomId.set(room.id, cloneRoomSnapshot(room));
      }
      for (const room of getActiveCourseDraftSessionRoomOverrides()) {
        overrideByRoomId.set(room.id, cloneRoomSnapshot(room));
      }
    }

    const pinnedByKey = await this.loadPinnedCourseRoomSnapshots(
      course.roomRefs.filter((roomRef) => !overrideByRoomId.has(roomRef.roomId)),
    );
    const snapshots = course.roomRefs.map((roomRef) => {
      const draftOverride = overrideByRoomId.get(roomRef.roomId);
      const snapshot = draftOverride
        ? cloneRoomSnapshot(draftOverride)
        : cloneRoomSnapshot(pinnedByKey.get(getPinnedCourseRoomSnapshotCacheKey(roomRef))!);
      snapshot.status = 'published';
      return snapshot;
    });

    this.host.setTransientRoomOverrides(snapshots);
    for (const snapshot of snapshots) {
      this.activeCourseRoomOverrideIds.add(snapshot.id);
    }
  }

  async activateDraftCoursePreview(
    course: CourseSnapshot,
    draftRoom: RoomSnapshot | null,
  ): Promise<void> {
    const snapshot = cloneCourseSnapshot(course);
    await this.prepareActiveCourseRoomOverrides(snapshot, {
      mode: 'draftPreview',
      roomOverrides: draftRoom ? [draftRoom] : [],
    });
    this.host.setActiveCourseRun(this.createCourseRunState(snapshot));
  }

  getCourseStartRoomRef(
    course: CourseSnapshot,
    lockedStartRoomId: string | null = null,
  ): CourseRoomRef | null {
    return resolveCourseStartRoomRef(course, {
      lockedStartRoomId,
      selectedRoomId: roomIdFromCoordinates(this.host.getSelectedCoordinates()),
      roomRefHasSpawnPoint: (roomRef) => this.roomRefHasSpawnPoint(roomRef),
    });
  }

  createCourseRunState(
    course: CourseSnapshot,
    options?: { hadPreviousCompletion?: boolean; previousViewerRank?: number | null },
  ): ActiveCourseRunState {
    const authState = getAuthDebugState();
    const startRoomRef = this.getCourseStartRoomRef(course);
    const leaderboardEligible =
      course.status === 'published' &&
      isWampLeaderboardEligibleAuth(
        authState.authenticated,
        authState.source ?? null,
        authState.user?.displayName ?? null
      );
    const localOnlyMessage =
      course.status !== 'published'
        ? 'Draft course run stays local.'
        : authState.authenticated
          ? 'Ranked course submission unavailable.'
          : 'Sign in to rank course runs.';
    return createActiveCourseRunState({
      course: cloneCourseSnapshot(course),
      expandedRoomId:
        course.status === 'published' ? expandedRoomIdFromLegacyCourseId(course.id) : null,
      expandedRoomVersion: course.status === 'published' ? course.version : null,
      returnCoordinates: { ...this.host.getSelectedCoordinates() },
      startRoomId: startRoomRef?.roomId ?? null,
      enemyTarget:
        course.goal?.type === 'defeat_all'
          ? this.countCourseObjectsByCategory(course, 'enemy')
          : null,
      leaderboardEligible,
      hadPreviousCompletion: options?.hadPreviousCompletion ?? false,
      previousViewerRank: options?.previousViewerRank ?? null,
      localOnlyMessage,
    });
  }

  private roomRefHasSpawnPoint(roomRef: CourseRoomRef): boolean {
    return Boolean(this.host.getRoomSnapshotForCoordinates(roomRef.coordinates)?.spawnPoint);
  }

  async startRemoteCourseRun(runState: ActiveCourseRunState): Promise<void> {
    try {
      const { response, submissionTarget } = await this.startRankedCourseRun(runState);
      const activeCourseRun = this.host.getActiveCourseRun();
      if (activeCourseRun?.course.id !== runState.course.id) {
        return;
      }

      activeCourseRun.attemptId = response.attemptId;
      activeCourseRun.submissionTarget = submissionTarget;
      activeCourseRun.verificationSchemaVersion = response.verificationSchemaVersion;
      activeCourseRun.verificationNonce = response.verificationNonce;
      activeCourseRun.snapshotHash = response.snapshotHash;
      activeCourseRun.submissionState = 'active';
      activeCourseRun.submissionMessage = 'Ranked expanded room run active.';
      this.host.onRankedRunStarted?.({
        kind: 'course',
        verificationSchemaVersion: response.verificationSchemaVersion,
        verificationNonce: response.verificationNonce,
        snapshotHash: response.snapshotHash,
      });
      this.host.renderHud();
    } catch (error) {
      console.error('Failed to start ranked course run', error);
      const activeCourseRun = this.host.getActiveCourseRun();
      if (activeCourseRun?.course.id !== runState.course.id) {
        return;
      }

      if (
        (isCourseApiError(error) || isExpandedRoomApiError(error)) &&
        error.status === 403
      ) {
        activeCourseRun.submissionState = 'local-only';
        activeCourseRun.submissionMessage = error.message;
      } else {
        activeCourseRun.submissionState = 'error';
        activeCourseRun.submissionMessage =
          error instanceof Error ? error.message : 'Ranked course run unavailable.';
      }
      this.host.renderHud();
    }
  }

  async finalizeActiveCourseRun(
    result: 'completed' | 'failed' | 'abandoned',
  ): Promise<void> {
    const activeCourseRun = this.host.getActiveCourseRun();
    if (!activeCourseRun || activeCourseRun.pendingResult) {
      return;
    }

    activeCourseRun.pendingResult = result;
    const attemptId = activeCourseRun.attemptId;
    if (!attemptId || activeCourseRun.submissionState === 'local-only') {
      activeCourseRun.submissionState = 'submitted';
      activeCourseRun.submissionMessage = 'Local expanded room run saved on this client only.';
      if (result === 'completed' && this.shouldPromptGuestClaimForLocalCourseClear(activeCourseRun)) {
        activeCourseRun.submissionMessage = 'Guest expanded room clear saved on this browser.';
        requestPostRunGuestClaim({
          contentType: 'course',
          contentId: activeCourseRun.course.id,
          contentTitle: activeCourseRun.course.title,
          expandedRoomId: activeCourseRun.expandedRoomId,
          version: activeCourseRun.course.version,
          previousViewerRank: null,
          elapsedMs: Math.round(activeCourseRun.elapsedMs),
          deaths: activeCourseRun.deaths,
          score: null,
          autoSuggestedDifficulty: suggestProgressionDifficulty({
            elapsedMs: activeCourseRun.elapsedMs,
            deaths: activeCourseRun.deaths,
            collectiblesCollected: activeCourseRun.collectiblesCollected,
            enemiesDefeated: activeCourseRun.enemiesDefeated,
            checkpointsReached: activeCourseRun.checkpointsReached,
          }),
        });
      }
      this.host.clearVerificationTrace?.();
      this.host.renderHud();
      return;
    }

    activeCourseRun.submissionState = 'finishing';
    activeCourseRun.submissionMessage = 'Submitting expanded room run...';
    this.host.renderHud();

    const verificationTrace = this.host.buildVerificationTrace?.(activeCourseRun, result) ?? null;
    if (!verificationTrace) {
      console.warn('Submitting ranked course finish without verification trace', {
        attemptId,
        courseId: activeCourseRun.course.id,
        courseVersion: activeCourseRun.course.version,
        result,
        elapsedMs: Math.round(activeCourseRun.elapsedMs),
        submissionState: activeCourseRun.submissionState,
        verificationSchemaVersion: activeCourseRun.verificationSchemaVersion,
        hasVerificationNonce: Boolean(activeCourseRun.verificationNonce),
        hasSnapshotHash: Boolean(activeCourseRun.snapshotHash),
      });
    }

    const body: CourseRunFinishRequestBody = {
      result,
      elapsedMs: activeCourseRun.elapsedMs,
      deaths: activeCourseRun.deaths,
      collectiblesCollected: activeCourseRun.collectiblesCollected,
      enemiesDefeated: activeCourseRun.enemiesDefeated,
      checkpointsReached: activeCourseRun.checkpointsReached,
      score: null,
      finishedAt: new Date().toISOString(),
      verificationTrace,
    };

    try {
      if (activeCourseRun.submissionTarget === 'expanded_room') {
        await this.expandedRoomRepository.finishRun(attemptId, body);
      } else {
        await this.courseRepository.finishRun(attemptId, body);
      }
      const currentActiveCourseRun = this.host.getActiveCourseRun();
      if (!currentActiveCourseRun || currentActiveCourseRun.attemptId !== attemptId) {
        return;
      }

      currentActiveCourseRun.submissionState = 'submitted';
      currentActiveCourseRun.submissionMessage = 'Ranked expanded room run submitted.';
      this.host.clearVerificationTrace?.();
      if (result === 'completed') {
        const refreshedLeaderboard = await this.loadFreshCourseLeaderboard(currentActiveCourseRun);
        const currentViewerRank = refreshedLeaderboard?.viewerRank ?? null;
        const contentTitle = refreshedLeaderboard?.courseTitle ?? currentActiveCourseRun.course.title;
        const leaderboardRewards = buildLeaderboardRankRewardStings({
          previousViewerRank: currentActiveCourseRun.previousViewerRank,
          currentViewerRank,
          contentTitle,
        });
        const shouldPromptForRating = !currentActiveCourseRun.hadPreviousCompletion;
        const ratingContentType = currentActiveCourseRun.expandedRoomId ? 'expanded_room' : 'course';
        const ratingContentId = currentActiveCourseRun.expandedRoomId ?? currentActiveCourseRun.course.id;
        const rewards = [
          ...(shouldPromptForRating
            ? [
                createPostRunClearReward({
                  contentType: ratingContentType,
                  contentTitle,
                  elapsedMs: body.elapsedMs,
                  deaths: body.deaths,
                  score: body.score ?? null,
                }),
              ]
            : []),
          ...leaderboardRewards,
        ];
        notifyRewardStings(rewards);
        if (shouldPromptForRating) {
          const baseRatingRequest = {
            contentTitle,
            version: currentActiveCourseRun.course.version,
            previousViewerRank: currentActiveCourseRun.previousViewerRank,
            suppressLeaderboardRewardStings: leaderboardRewards.length > 0,
            elapsedMs: body.elapsedMs,
            deaths: body.deaths,
            score: body.score ?? null,
            autoSuggestedDifficulty: suggestProgressionDifficulty({
              elapsedMs: body.elapsedMs,
              deaths: body.deaths,
              collectiblesCollected: body.collectiblesCollected,
              enemiesDefeated: body.enemiesDefeated,
              checkpointsReached: body.checkpointsReached,
            }),
          };
          const expandedRoomId = currentActiveCourseRun.expandedRoomId;
          if (expandedRoomId) {
            requestPostRunRating({
              ...baseRatingRequest,
              contentType: 'expanded_room',
              contentId: ratingContentId,
              expandedRoomId,
              legacyCourseId: currentActiveCourseRun.course.id,
            });
          } else {
            requestPostRunRating({
              ...baseRatingRequest,
              contentType: 'course',
              contentId: ratingContentId,
            });
          }
        }
      }
    } catch (error) {
      console.error('Failed to finish ranked course run', {
        attemptId,
        result,
        body,
        error,
      });
      const currentActiveCourseRun = this.host.getActiveCourseRun();
      if (!currentActiveCourseRun || currentActiveCourseRun.attemptId !== attemptId) {
        return;
      }

      const message = formatCourseRunSubmissionErrorMessage(error, result);
      currentActiveCourseRun.submissionState = 'error';
      currentActiveCourseRun.submissionMessage = message;
      this.host.clearVerificationTrace?.();
      if (result === 'completed') {
        this.host.showTransientStatus(message);
      }
    } finally {
      this.host.renderHud();
    }
  }

  private shouldPromptGuestClaimForLocalCourseClear(runState: ActiveCourseRunState): boolean {
    const authState = getAuthDebugState();
    return (
      runState.course.status === 'published' &&
      !runState.leaderboardEligible &&
      !authState.authenticated
    );
  }

  private async startRankedCourseRun(
    runState: ActiveCourseRunState,
  ): Promise<{
    response: RankedCourseRunStartBinding;
    submissionTarget: ActiveCourseRunState['submissionTarget'];
  }> {
    if (runState.expandedRoomId && runState.expandedRoomVersion) {
      try {
        return {
          response: await this.expandedRoomRepository.startRun(runState.expandedRoomId, {
            expandedRoomId: runState.expandedRoomId,
            expandedRoomVersion: runState.expandedRoomVersion,
            goal: runState.course.goal as CourseGoal,
            startedAt: new Date().toISOString(),
          }),
          submissionTarget: 'expanded_room',
        };
      } catch (error) {
        if (!this.shouldFallBackToLegacyCourseRunStart(error)) {
          throw error;
        }
        console.warn('Falling back to legacy course run start after expanded-room start failed', error);
      }
    }

    return {
      response: await this.courseRepository.startRun(runState.course.id, {
        courseId: runState.course.id,
        courseVersion: runState.course.version,
        goal: runState.course.goal as CourseGoal,
        startedAt: new Date().toISOString(),
      }),
      submissionTarget: 'course',
    };
  }

  private shouldFallBackToLegacyCourseRunStart(error: unknown): boolean {
    return isExpandedRoomApiError(error) && (error.status === 404 || error.status >= 500);
  }

  private async loadFreshCourseLeaderboard(
    runState: ActiveCourseRunState,
  ): Promise<CourseLeaderboardResponse | null> {
    const course = runState.course;
    if (runState.expandedRoomId) {
      try {
        return await this.expandedRoomRepository.loadExpandedRoomLeaderboard(
          runState.expandedRoomId,
          runState.expandedRoomVersion ?? course.version,
          5,
        );
      } catch (error) {
        console.warn('Failed to refresh expanded-room leaderboard after clear', error);
      }
    }

    try {
      return await this.courseRepository.loadCourseLeaderboard(course.id, course.version, 5);
    } catch (error) {
      console.warn('Failed to refresh leaderboard after course clear', error);
      return null;
    }
  }

  private async loadPinnedCourseRoomSnapshots(roomRefs: CourseRoomRef[]): Promise<Map<string, RoomSnapshot>> {
    const snapshotsByKey = new Map<string, RoomSnapshot>();
    const missingRefs: CourseRoomRef[] = [];
    for (const roomRef of roomRefs) {
      const cached = this.getCachedPinnedCourseRoomSnapshot(roomRef);
      if (cached) snapshotsByKey.set(getPinnedCourseRoomSnapshotCacheKey(roomRef), cached);
      else missingRefs.push(roomRef);
    }

    if (missingRefs.length > 0) {
      const response = await this.roomRepository.queryRoomSnapshots(missingRefs.map((roomRef) => ({
        kind: 'version' as const,
        roomId: roomRef.roomId,
        version: roomRef.roomVersion,
      })));
      const loadedByKey = new Map(response.snapshots.map((entry) => [entry.key, entry.snapshot]));
      for (const roomRef of missingRefs) {
        const responseKey = `version:${roomRef.roomId}:${roomRef.roomVersion}`;
        const snapshot = loadedByKey.get(responseKey);
        if (!snapshot) {
          const roomLabel = roomRef.roomTitle?.trim() || `Room ${roomRef.coordinates.x},${roomRef.coordinates.y}`;
          throw new Error(
            `${roomLabel} is missing published room version v${roomRef.roomVersion}. Reopen the expanded room builder and publish again.`,
          );
        }
        this.setCachedPinnedCourseRoomSnapshot(roomRef, snapshot);
        snapshotsByKey.set(getPinnedCourseRoomSnapshotCacheKey(roomRef), cloneRoomSnapshot(snapshot));
      }
    }

    return snapshotsByKey;
  }

  private getCachedPinnedCourseRoomSnapshot(roomRef: CourseRoomRef): RoomSnapshot | null {
    const cacheKey = getPinnedCourseRoomSnapshotCacheKey(roomRef);
    const cached = this.pinnedCourseRoomSnapshotCache.get(cacheKey) ?? null;
    if (cached) {
      return cloneRoomSnapshot(cached);
    }
    const shared = getSharedRoomSnapshot(buildSharedRoomSnapshotKey(
      roomRef.roomId,
      roomRef.roomVersion,
      'versioned',
    ));
    if (shared) {
      this.pinnedCourseRoomSnapshotCache.set(cacheKey, cloneRoomSnapshot(shared));
      return shared;
    }

    const loadedSnapshot = this.host.getRoomSnapshotForCoordinates(roomRef.coordinates);
    if (
      loadedSnapshot &&
      loadedSnapshot.id === roomRef.roomId &&
      loadedSnapshot.version === roomRef.roomVersion &&
      loadedSnapshot.status === 'published'
    ) {
      this.setCachedPinnedCourseRoomSnapshot(roomRef, loadedSnapshot);
      return cloneRoomSnapshot(loadedSnapshot);
    }

    return null;
  }

  private setCachedPinnedCourseRoomSnapshot(
    roomRef: CourseRoomRef,
    snapshot: RoomSnapshot,
  ): void {
    const key = getPinnedCourseRoomSnapshotCacheKey(roomRef);
    this.pinnedCourseRoomSnapshotCache.delete(key);
    this.pinnedCourseRoomSnapshotCache.set(key, cloneRoomSnapshot(snapshot));
    setSharedRoomSnapshot(
      buildSharedRoomSnapshotKey(roomRef.roomId, roomRef.roomVersion, 'versioned'),
      snapshot,
    );
    while (this.pinnedCourseRoomSnapshotCache.size > 256) {
      const oldest = this.pinnedCourseRoomSnapshotCache.keys().next().value;
      if (typeof oldest !== 'string') break;
      this.pinnedCourseRoomSnapshotCache.delete(oldest);
    }
  }

  private countCourseObjectsByCategory(
    course: CourseSnapshot,
    category: GameObjectConfig['category'],
  ): number {
    let count = 0;
    for (const roomRef of course.roomRefs) {
      const room = this.getCourseRoomSnapshot(course, roomRef.roomId);
      if (!room) {
        continue;
      }

      count += this.host.countRoomObjectsByCategory(room, category);
    }

    return count;
  }

  private getCourseRoomSnapshot(course: CourseSnapshot, roomId: string): RoomSnapshot | null {
    const roomRef = course.roomRefs.find((entry) => entry.roomId === roomId) ?? null;
    if (!roomRef) {
      return null;
    }

    return this.host.getRoomSnapshotForCoordinates(roomRef.coordinates);
  }
}

function getPinnedCourseRoomSnapshotCacheKey(roomRef: CourseRoomRef): string {
  return `${roomRef.roomId}@${roomRef.roomVersion}`;
}

function formatCourseRunSubmissionErrorMessage(
  error: unknown,
  result: 'completed' | 'failed' | 'abandoned'
): string {
  const detail =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : 'Expanded room run submission failed.';

  if (result === 'completed') {
    return `Ranked expanded room clear not recorded: ${detail}`;
  }

  if (result === 'failed') {
    return `Ranked failed expanded room run not recorded: ${detail}`;
  }

  return `Expanded room run abandon did not sync: ${detail}`;
}

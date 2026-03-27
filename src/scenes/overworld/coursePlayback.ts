import { getAuthDebugState } from '../../auth/client';
import { createCourseRepository } from '../../courses/courseRepository';
import { getActiveCourseDraftSessionRoomOverrides } from '../../courses/draftSession';
import {
  cloneCourseSnapshot,
  type CourseGoal,
  type CourseRoomRef,
  type CourseSnapshot,
} from '../../courses/model';
import type { CourseRunFinishRequestBody } from '../../courses/runModel';
import { type GameObjectConfig } from '../../config';
import {
  cloneRoomSnapshot,
  type RoomCoordinates,
  type RoomSnapshot,
} from '../../persistence/roomModel';
import { createRoomRepository } from '../../persistence/roomRepository';
import {
  createActiveCourseRunState,
  type ActiveCourseRunState,
} from './courseRuns';

export type CoursePlaybackRoomSourceMode = 'published' | 'draftPreview';

interface OverworldCoursePlaybackHost {
  getSelectedCoordinates(): RoomCoordinates;
  getActiveCourseRun(): ActiveCourseRunState | null;
  setActiveCourseRun(runState: ActiveCourseRunState | null): void;
  clearTransientRoomOverride(roomId: string): void;
  setTransientRoomOverride(snapshot: RoomSnapshot): void;
  getRoomSnapshotForCoordinates(coordinates: RoomCoordinates): RoomSnapshot | null;
  countRoomObjectsByCategory(room: RoomSnapshot, category: GameObjectConfig['category']): number;
  renderHud(): void;
}

export class OverworldCoursePlaybackController {
  private readonly roomRepository = createRoomRepository();
  private readonly courseRepository = createCourseRepository();
  private readonly activeCourseRoomOverrideIds = new Set<string>();

  constructor(private readonly host: OverworldCoursePlaybackHost) {}

  hasActiveCourseRoomOverride(roomId: string): boolean {
    return this.activeCourseRoomOverrideIds.has(roomId);
  }

  clearActiveCourseRoomOverrides(): void {
    for (const roomId of this.activeCourseRoomOverrideIds) {
      this.host.clearTransientRoomOverride(roomId);
    }
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

    const snapshots = await Promise.all(
      course.roomRefs.map(async (roomRef) => {
        const draftOverride = overrideByRoomId.get(roomRef.roomId);
        const snapshot = draftOverride
          ? cloneRoomSnapshot(draftOverride)
          : await this.loadPinnedCourseRoomSnapshot(roomRef);
        snapshot.status = 'published';
        return snapshot;
      }),
    );

    for (const snapshot of snapshots) {
      this.host.setTransientRoomOverride(snapshot);
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

  getCourseStartRoomRef(course: CourseSnapshot): CourseRoomRef | null {
    if (course.startPoint) {
      return course.roomRefs.find((roomRef) => roomRef.roomId === course.startPoint?.roomId) ?? null;
    }

    return course.roomRefs[0] ?? null;
  }

  createCourseRunState(course: CourseSnapshot): ActiveCourseRunState {
    const leaderboardEligible = course.status === 'published' && getAuthDebugState().authenticated;
    return createActiveCourseRunState({
      course: cloneCourseSnapshot(course),
      returnCoordinates: { ...this.host.getSelectedCoordinates() },
      enemyTarget:
        course.goal?.type === 'defeat_all'
          ? this.countCourseObjectsByCategory(course, 'enemy')
          : null,
      leaderboardEligible,
    });
  }

  async startRemoteCourseRun(runState: ActiveCourseRunState): Promise<void> {
    try {
      const response = await this.courseRepository.startRun(runState.course.id, {
        courseId: runState.course.id,
        courseVersion: runState.course.version,
        goal: runState.course.goal as CourseGoal,
        startedAt: new Date().toISOString(),
      });
      const activeCourseRun = this.host.getActiveCourseRun();
      if (activeCourseRun?.course.id !== runState.course.id) {
        return;
      }

      activeCourseRun.attemptId = response.attemptId;
      activeCourseRun.submissionState = 'active';
      activeCourseRun.submissionMessage = 'Ranked course run active.';
      this.host.renderHud();
    } catch (error) {
      console.error('Failed to start ranked course run', error);
      const activeCourseRun = this.host.getActiveCourseRun();
      if (activeCourseRun?.course.id !== runState.course.id) {
        return;
      }

      activeCourseRun.submissionState = 'error';
      activeCourseRun.submissionMessage =
        error instanceof Error ? error.message : 'Ranked course run unavailable.';
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
      activeCourseRun.submissionMessage = 'Local course run saved on this client only.';
      this.host.renderHud();
      return;
    }

    activeCourseRun.submissionState = 'finishing';
    activeCourseRun.submissionMessage = 'Submitting course run...';
    this.host.renderHud();

    const body: CourseRunFinishRequestBody = {
      result,
      elapsedMs: activeCourseRun.elapsedMs,
      deaths: activeCourseRun.deaths,
      collectiblesCollected: activeCourseRun.collectiblesCollected,
      enemiesDefeated: activeCourseRun.enemiesDefeated,
      checkpointsReached: activeCourseRun.checkpointsReached,
      score: null,
      finishedAt: new Date().toISOString(),
    };

    try {
      await this.courseRepository.finishRun(attemptId, body);
      const currentActiveCourseRun = this.host.getActiveCourseRun();
      if (!currentActiveCourseRun || currentActiveCourseRun.attemptId !== attemptId) {
        return;
      }

      currentActiveCourseRun.submissionState = 'submitted';
      currentActiveCourseRun.submissionMessage = 'Ranked course run submitted.';
    } catch (error) {
      console.error('Failed to finish ranked course run', error);
      const currentActiveCourseRun = this.host.getActiveCourseRun();
      if (!currentActiveCourseRun || currentActiveCourseRun.attemptId !== attemptId) {
        return;
      }

      currentActiveCourseRun.submissionState = 'error';
      currentActiveCourseRun.submissionMessage =
        error instanceof Error ? error.message : 'Failed to submit course run.';
    } finally {
      this.host.renderHud();
    }
  }

  private async loadPinnedCourseRoomSnapshot(roomRef: CourseRoomRef): Promise<RoomSnapshot> {
    const record = await this.roomRepository.loadRoom(roomRef.roomId, roomRef.coordinates);
    const historicalVersion =
      record.versions.find((entry) => entry.version === roomRef.roomVersion)?.snapshot ??
      (record.published?.version === roomRef.roomVersion ? record.published : null);
    if (!historicalVersion) {
      const roomLabel =
        roomRef.roomTitle?.trim() || `Room ${roomRef.coordinates.x},${roomRef.coordinates.y}`;
      throw new Error(
        `${roomLabel} is missing published room version v${roomRef.roomVersion}. Reopen the course builder and publish again.`,
      );
    }

    return cloneRoomSnapshot(historicalVersion);
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

import Phaser from 'phaser';
import { getAuthDebugState } from '../../auth/client';
import type { CourseRepository } from '../../courses/courseRepository';
import {
  clearActiveCourseDraftSessionRoomOverride,
  getActiveCourseDraftSessionCourseId,
  getActiveCourseDraftSessionDraft,
  getActiveCourseDraftSessionRecord,
  getActiveCourseDraftSessionRoomOverride,
  getActiveCourseDraftSessionSelectedRoomId,
  getActiveCourseDraftSessionSelectedRoomOrder,
  isActiveCourseDraftSessionDirty,
  setActiveCourseDraftSessionRecord,
  setActiveCourseDraftSessionSelectedRoom,
  updateActiveCourseDraftSession,
} from '../../courses/draftSession';
import {
  areCourseRoomRefsOrthogonallyAdjacent,
  cloneCourseSnapshot,
  courseGoalRequiresStartPoint,
  courseRoomRefsFollowLinearPath,
  MAX_COURSE_ROOMS,
  type CourseGoalType,
  type CourseRecord,
  type CourseRoomRef,
  type CourseSnapshot,
} from '../../courses/model';
import { setFocusedCoordinatesInUrl } from '../../navigation/worldNavigation';
import {
  cloneRoomSnapshot,
  roomIdFromCoordinates,
  type RoomCoordinates,
  type RoomRecord,
  type RoomSnapshot,
} from '../../persistence/roomModel';
import type { RoomRepository } from '../../persistence/roomRepository';
import { hideBusyOverlay, showBusyError, showBusyOverlay } from '../../ui/appFeedback';
import {
  type CourseComposerState,
} from '../../ui/setup/sceneBridge';
import type {
  ActiveCourseRunState,
} from './courseRuns';
import type {
  CameraMode,
} from './camera';
import type {
  OverworldMode,
  EditorSceneData,
} from '../sceneData';

interface CoursePublishedRoomMeta {
  roomId: string;
  coordinates: RoomCoordinates;
  roomVersion: number;
  roomTitle: string | null;
  publishedByUserId: string | null;
}

interface OverworldCourseComposerControllerHost {
  roomRepository: RoomRepository;
  courseRepository: CourseRepository;
  getMode(): OverworldMode;
  setMode(mode: OverworldMode): void;
  setCameraMode(mode: CameraMode): void;
  getSelectedCoordinates(): RoomCoordinates;
  setSelectedCoordinates(coordinates: RoomCoordinates): void;
  getCurrentRoomCoordinates(): RoomCoordinates;
  setCurrentRoomCoordinates(coordinates: RoomCoordinates): void;
  setWindowCenterCoordinates(coordinates: RoomCoordinates): void;
  setShouldCenterCamera(value: boolean): void;
  setShouldRespawnPlayer(value: boolean): void;
  getBrowseInspectZoom(): number;
  setInspectZoom(zoom: number): void;
  syncAppMode(): void;
  getRoomSnapshotForCoordinates(coordinates: RoomCoordinates): RoomSnapshot | null;
  getSelectedSummaryCourseId(): string | null;
  getActiveCourseRun(): ActiveCourseRunState | null;
  resetPlaySession(): void;
  clearTouchGestureState(): void;
  showTransientStatus(message: string): void;
  updateSelectedSummary(): void;
  redrawWorld(): void;
  renderHud(): void;
  emitStateChanged(): void;
  refreshAround(
    coordinates: RoomCoordinates,
    options?: { forceChunkReload?: boolean }
  ): Promise<unknown>;
  openEditor(editorData: EditorSceneData): void;
  startDraftCoursePlayback(snapshot: CourseSnapshot): Promise<void>;
}

export class OverworldCourseComposerController {
  private open = false;
  private loading = false;
  private record: CourseRecord | null = null;
  private statusText: string | null = null;
  private selectedRoomEligible = false;
  private selectedRoomInDraft = false;
  private selectedRoomOrder: number | null = null;
  private readonly roomMetaByRoomId = new Map<string, CoursePublishedRoomMeta>();

  constructor(private readonly host: OverworldCourseComposerControllerHost) {}

  reset(): void {
    this.open = false;
    this.loading = false;
    this.record = null;
    this.statusText = null;
    this.selectedRoomEligible = false;
    this.selectedRoomInDraft = false;
    this.selectedRoomOrder = null;
    this.roomMetaByRoomId.clear();
  }

  getRecord(): CourseRecord | null {
    return this.record;
  }

  isLoading(): boolean {
    return this.loading;
  }

  setStatusText(text: string | null): void {
    this.statusText = text;
  }

  syncRecordFromSession(): void {
    this.record = getActiveCourseDraftSessionRecord();
  }

  handleCourseEditorReturned(): void {
    this.syncRecordFromSession();
    if (!this.record) {
      return;
    }

    this.statusText = 'Course draft updated.';
    void this.refreshSelectedRoomState();
    this.host.emitStateChanged();
  }

  close(): void {
    this.open = false;
    this.host.emitStateChanged();
    this.host.renderHud();
  }

  getState(): CourseComposerState | null {
    if (!this.open || !this.record) {
      return null;
    }

    const draft = this.record.draft;
    const testDraftDisabledReason =
      !this.record.permissions.canSaveDraft
        ? 'This course is read-only for your account.'
        : this.getCurrentCourseDraftPreviewDisabledReason();
    const saveDraftDisabledReason =
      !this.record.permissions.canSaveDraft
        ? 'This course is read-only for your account.'
        : this.getCurrentCourseDraftSaveDisabledReason();
    const publishCourseDisabledReason =
      !this.record.permissions.canPublish
        ? 'This course is read-only for your account.'
        : this.getCurrentCourseDraftPublishDisabledReason();
    const unpublishCourseDisabledReason = this.getCourseComposerUnpublishDisabledReason();

    return {
      courseId: draft.id,
      title: draft.title ?? '',
      roomRefs: draft.roomRefs.map((roomRef) => ({
        ...roomRef,
        coordinates: { ...roomRef.coordinates },
      })),
      goalType: draft.goal?.type ?? null,
      timeLimitSeconds:
        draft.goal && 'timeLimitMs' in draft.goal && draft.goal.timeLimitMs !== null
          ? Math.max(1, Math.round(draft.goal.timeLimitMs / 1000))
          : null,
      requiredCount: draft.goal?.type === 'collect_target' ? draft.goal.requiredCount : null,
      survivalSeconds:
        draft.goal?.type === 'survival'
          ? Math.max(1, Math.round(draft.goal.durationMs / 1000))
          : null,
      startPointRoomId: draft.startPoint?.roomId ?? null,
      checkpointCount:
        draft.goal?.type === 'checkpoint_sprint' ? draft.goal.checkpoints.length : 0,
      finishRoomId:
        draft.goal?.type === 'checkpoint_sprint'
          ? draft.goal.finish?.roomId ?? null
          : draft.goal?.type === 'reach_exit'
            ? draft.goal.exit?.roomId ?? null
            : null,
      selectedRoomInDraft: this.selectedRoomInDraft,
      selectedRoomEligible: this.selectedRoomEligible,
      selectedRoomId: getActiveCourseDraftSessionSelectedRoomId(),
      canEdit: this.record.permissions.canSaveDraft,
      published: Boolean(this.record.published),
      publishedVersion: this.record.published?.version ?? null,
      publishedRoomCount: this.record.published?.roomRefs.length ?? 0,
      publishedStateText: this.getCourseComposerPublishedStateText(),
      publishedDraftWarningText: this.getCourseComposerPublishedDraftWarningText(),
      dirty: this.isDirty(),
      statusText: this.loading ? 'Loading course...' : this.statusText,
      selectedRoomOrder: this.selectedRoomOrder,
      canMoveSelectedRoomEarlier: this.canMoveSelectedCourseRoom(-1),
      canMoveSelectedRoomLater: this.canMoveSelectedCourseRoom(1),
      canEditSelectedRoom:
        this.record.permissions.canSaveDraft &&
        getActiveCourseDraftSessionSelectedRoomId() !== null,
      canTestDraft: testDraftDisabledReason === null,
      testDraftDisabledReason,
      canSaveDraft: saveDraftDisabledReason === null,
      saveDraftDisabledReason,
      canPublishCourse: publishCourseDisabledReason === null,
      publishCourseDisabledReason,
      showUnpublishCourse: Boolean(this.record.published),
      canUnpublishCourse: unpublishCourseDisabledReason === null,
      unpublishCourseDisabledReason,
    };
  }

  setCourseTitle(title: string | null): void {
    this.updateCourseComposerDraft((draft) => {
      draft.title = title?.trim() ? title.trim() : null;
    });
  }

  addSelectedRoomToCourseDraft(): void {
    void this.addSelectedRoomToCourseDraftAsync();
  }

  removeSelectedRoomFromCourseDraft(): void {
    if (!this.record?.permissions.canSaveDraft) {
      return;
    }

    const selectedRoomId = getActiveCourseDraftSessionSelectedRoomId();
    if (!selectedRoomId) {
      return;
    }

    this.updateCourseComposerDraft((draft) => {
      draft.roomRefs = draft.roomRefs.filter((roomRef) => roomRef.roomId !== selectedRoomId);
      if (draft.startPoint?.roomId === selectedRoomId) {
        draft.startPoint = null;
      }
      if (draft.goal?.type === 'reach_exit' && draft.goal.exit?.roomId === selectedRoomId) {
        draft.goal.exit = null;
      }
      if (draft.goal?.type === 'checkpoint_sprint') {
        draft.goal.checkpoints = draft.goal.checkpoints.filter(
          (checkpoint) => checkpoint.roomId !== selectedRoomId
        );
        if (draft.goal.finish?.roomId === selectedRoomId) {
          draft.goal.finish = null;
        }
      }
    });
    void this.refreshSelectedRoomState();
  }

  moveSelectedRoomEarlierInCourseDraft(): void {
    this.moveSelectedRoomInCourseDraft(-1);
  }

  moveSelectedRoomLaterInCourseDraft(): void {
    this.moveSelectedRoomInCourseDraft(1);
  }

  selectCourseRoomInComposer(roomId: string): void {
    if (!this.record) {
      return;
    }

    const roomRef = this.record.draft.roomRefs.find((candidate) => candidate.roomId === roomId);
    if (!roomRef) {
      return;
    }

    setActiveCourseDraftSessionSelectedRoom(roomId);
    this.selectedRoomOrder = getActiveCourseDraftSessionSelectedRoomOrder();
    this.host.setSelectedCoordinates({ ...roomRef.coordinates });
    if (this.host.getMode() !== 'play') {
      this.host.setCurrentRoomCoordinates({ ...roomRef.coordinates });
    }
    this.host.updateSelectedSummary();
    this.host.redrawWorld();
    this.host.renderHud();
    this.host.emitStateChanged();
  }

  editSelectedCourseRoom(): boolean {
    if (!this.record?.permissions.canSaveDraft) {
      return false;
    }

    const roomId = getActiveCourseDraftSessionSelectedRoomId();
    const roomRef = roomId
      ? this.record.draft.roomRefs.find((candidate) => candidate.roomId === roomId) ?? null
      : null;
    if (!roomId) {
      this.statusText = 'Select a room from this course to open it in the editor.';
      this.host.emitStateChanged();
      return false;
    }

    if (!roomRef) {
      this.statusText = 'Selected course room is no longer in this draft.';
      this.host.emitStateChanged();
      return false;
    }

    const roomSnapshot = this.host.getRoomSnapshotForCoordinates(roomRef.coordinates);
    if (!roomSnapshot) {
      this.statusText = 'Selected course room is not loaded yet.';
      this.host.emitStateChanged();
      return false;
    }

    this.statusText = 'Editing course room in the room editor...';
    this.host.emitStateChanged();

    this.host.openEditor({
      roomCoordinates: { ...roomRef.coordinates },
      source: 'world',
      roomSnapshot,
      courseEdit: {
        courseId: this.record.draft.id,
        roomId: roomRef.roomId,
      },
    });
    return true;
  }

  async continueCourseEditorNavigation(offset: -1 | 1): Promise<void> {
    const draft = getActiveCourseDraftSessionDraft();
    const currentOrder = getActiveCourseDraftSessionSelectedRoomOrder();
    const nextRoomRef =
      draft && currentOrder !== null ? draft.roomRefs[currentOrder + offset] ?? null : null;
    if (!draft || currentOrder === null || !nextRoomRef) {
      this.statusText =
        offset < 0
          ? 'Previous course room is no longer available.'
          : 'Next course room is no longer available.';
      await this.refreshSelectedRoomState();
      this.host.emitStateChanged();
      hideBusyOverlay();
      return;
    }

    setActiveCourseDraftSessionSelectedRoom(nextRoomRef.roomId);
    this.syncRecordFromSession();
    this.selectedRoomOrder = getActiveCourseDraftSessionSelectedRoomOrder();
    this.selectedRoomInDraft = true;
    this.host.setSelectedCoordinates({ ...nextRoomRef.coordinates });
    if (this.host.getMode() !== 'play') {
      this.host.setCurrentRoomCoordinates({ ...nextRoomRef.coordinates });
    }
    this.host.setWindowCenterCoordinates({ ...nextRoomRef.coordinates });
    this.host.setShouldCenterCamera(true);
    this.host.updateSelectedSummary();
    this.host.redrawWorld();
    this.host.renderHud();

    await this.host.refreshAround(nextRoomRef.coordinates, { forceChunkReload: true });

    const roomSnapshot =
      getActiveCourseDraftSessionRoomOverride(nextRoomRef.roomId) ??
      this.host.getRoomSnapshotForCoordinates(nextRoomRef.coordinates) ??
      (await (async () => {
        const record = await this.host.roomRepository.loadRoom(
          nextRoomRef.roomId,
          nextRoomRef.coordinates,
        );
        return record.draft ? cloneRoomSnapshot(record.draft) : null;
      })());

    if (!roomSnapshot) {
      this.statusText =
        offset < 0
          ? 'Failed to reopen the previous course room.'
          : 'Failed to reopen the next course room.';
      await this.refreshSelectedRoomState();
      this.host.emitStateChanged();
      hideBusyOverlay();
      return;
    }

    this.statusText = null;
    this.host.openEditor({
      roomCoordinates: { ...nextRoomRef.coordinates },
      source: 'world',
      roomSnapshot: cloneRoomSnapshot(roomSnapshot),
      courseEdit: {
        courseId: draft.id,
        roomId: nextRoomRef.roomId,
      },
    });
  }

  async testDraftCourse(): Promise<void> {
    const draft = this.record?.draft ?? null;
    const disabledReason =
      !this.record?.permissions.canSaveDraft
        ? 'This course is read-only for your account.'
        : this.getCurrentCourseDraftPreviewDisabledReason();
    if (!draft || disabledReason) {
      this.statusText = disabledReason ?? 'Course draft is not ready to test.';
      this.host.emitStateChanged();
      this.host.renderHud();
      return;
    }

    showBusyOverlay('Testing draft course...', 'Loading draft...');
    try {
      await this.host.startDraftCoursePlayback(cloneCourseSnapshot(draft));
      this.host.showTransientStatus('Testing draft course.');
      hideBusyOverlay();
    } catch (error) {
      console.error('Failed to test draft course', error);
      showBusyError(
        error instanceof Error ? error.message : 'Failed to test draft course.',
        {
          closeHandler: () => hideBusyOverlay(),
        },
      );
    }
  }

  async saveCourseDraft(): Promise<void> {
    const courseRecord = this.record;
    const disabledReason =
      !courseRecord?.permissions.canSaveDraft
        ? 'This course is read-only for your account.'
        : this.getCurrentCourseDraftSaveDisabledReason();
    if (disabledReason) {
      this.statusText = disabledReason;
      this.host.emitStateChanged();
      this.host.renderHud();
      return;
    }
    if (!courseRecord) {
      return;
    }

    this.statusText = 'Saving course draft...';
    this.host.emitStateChanged();
    try {
      const saved = await this.host.courseRepository.saveDraft(courseRecord.draft);
      this.setRecord(saved, {
        selectedRoomId: getActiveCourseDraftSessionSelectedRoomId(),
      });
      this.statusText = 'Course draft saved.';
      await this.refreshSelectedRoomState();
      await this.host.refreshAround(this.host.getCurrentRoomCoordinates(), { forceChunkReload: true });
    } catch (error) {
      console.error('Failed to save course draft', error);
      this.statusText =
        error instanceof Error ? error.message : 'Failed to save course draft.';
    } finally {
      this.host.emitStateChanged();
      this.host.renderHud();
    }
  }

  async publishCourseDraft(): Promise<void> {
    const courseRecord = this.record;
    const disabledReason =
      !courseRecord?.permissions.canPublish
        ? 'This course is read-only for your account.'
        : this.getCurrentCourseDraftPublishDisabledReason();
    if (disabledReason) {
      this.statusText = disabledReason;
      this.host.emitStateChanged();
      this.host.renderHud();
      return;
    }
    if (!courseRecord) {
      return;
    }

    this.statusText = 'Publishing course...';
    this.host.emitStateChanged();
    try {
      const saved = await this.host.courseRepository.saveDraft(courseRecord.draft);
      this.setRecord(saved, {
        selectedRoomId: getActiveCourseDraftSessionSelectedRoomId(),
      });
      const published = await this.host.courseRepository.publishCourse(courseRecord.draft.id);
      this.setRecord(published, {
        selectedRoomId: getActiveCourseDraftSessionSelectedRoomId(),
      });
      this.statusText = 'Course published.';
      await this.refreshSelectedRoomState();
      await this.host.refreshAround(this.host.getCurrentRoomCoordinates(), { forceChunkReload: true });
    } catch (error) {
      console.error('Failed to publish course', error);
      this.statusText =
        error instanceof Error ? error.message : 'Failed to publish course.';
    } finally {
      this.host.emitStateChanged();
      this.host.renderHud();
    }
  }

  async unpublishCourse(): Promise<void> {
    const courseRecord = this.record;
    const disabledReason = this.getCourseComposerUnpublishDisabledReason();
    if (disabledReason) {
      this.statusText = disabledReason;
      this.host.emitStateChanged();
      this.host.renderHud();
      return;
    }
    if (!courseRecord) {
      return;
    }

    this.statusText = 'Unpublishing course...';
    this.host.emitStateChanged();
    try {
      const unpublished = await this.host.courseRepository.unpublishCourse(courseRecord.draft.id);
      const preservedDraft = cloneCourseSnapshot(courseRecord.draft);
      preservedDraft.status = 'draft';
      preservedDraft.publishedAt = null;
      this.setRecord(
        {
          ...unpublished,
          draft: preservedDraft,
        },
        {
          selectedRoomId: getActiveCourseDraftSessionSelectedRoomId(),
        },
      );

      const activeCourseRun = this.host.getActiveCourseRun();
      const unpublishedActiveCourse = activeCourseRun?.course.id === courseRecord.draft.id;
      if (unpublishedActiveCourse) {
        const returnCoordinates = activeCourseRun?.returnCoordinates ?? this.host.getCurrentRoomCoordinates();
        this.host.resetPlaySession();
        this.host.clearTouchGestureState();
        this.host.setMode('browse');
        this.host.setCameraMode('inspect');
        this.host.setInspectZoom(this.host.getBrowseInspectZoom());
        this.host.syncAppMode();
        this.host.setSelectedCoordinates({ ...returnCoordinates });
        this.host.setCurrentRoomCoordinates({ ...returnCoordinates });
        this.host.setShouldCenterCamera(true);
        this.host.setShouldRespawnPlayer(false);
        setFocusedCoordinatesInUrl(returnCoordinates);
        this.host.showTransientStatus('Stopped course because it was unpublished.');
      }

      this.statusText = 'Course unpublished. The live course is no longer public.';
      await this.refreshSelectedRoomState();
      await this.host.refreshAround(this.host.getCurrentRoomCoordinates(), { forceChunkReload: true });
    } catch (error) {
      console.error('Failed to unpublish course', error);
      this.statusText =
        error instanceof Error ? error.message : 'Failed to unpublish course.';
    } finally {
      this.host.emitStateChanged();
      this.host.renderHud();
    }
  }

  private canMoveSelectedCourseRoom(direction: -1 | 1): boolean {
    const draft = this.record?.draft ?? null;
    const selectedRoomId = getActiveCourseDraftSessionSelectedRoomId();
    if (!draft || !selectedRoomId) {
      return false;
    }

    return this.buildMovedCourseRoomRefs(draft.roomRefs, selectedRoomId, direction) !== null;
  }

  private buildMovedCourseRoomRefs(
    roomRefs: CourseRoomRef[],
    roomId: string,
    direction: -1 | 1,
  ): CourseRoomRef[] | null {
    const currentIndex = roomRefs.findIndex((roomRef) => roomRef.roomId === roomId);
    if (currentIndex < 0) {
      return null;
    }

    const nextIndex = Phaser.Math.Clamp(currentIndex + direction, 0, roomRefs.length - 1);
    if (nextIndex === currentIndex) {
      return null;
    }

    const nextRoomRefs = [...roomRefs];
    const [moved] = nextRoomRefs.splice(currentIndex, 1);
    nextRoomRefs.splice(nextIndex, 0, moved);
    if (!courseRoomRefsFollowLinearPath(nextRoomRefs)) {
      return null;
    }

    return nextRoomRefs;
  }

  private moveSelectedRoomInCourseDraft(direction: -1 | 1): void {
    if (!this.record?.permissions.canSaveDraft) {
      return;
    }

    const roomId = getActiveCourseDraftSessionSelectedRoomId();
    if (!roomId) {
      return;
    }
    const nextRoomRefs = this.buildMovedCourseRoomRefs(this.record.draft.roomRefs, roomId, direction);
    if (!nextRoomRefs) {
      this.statusText =
        direction < 0
          ? 'This room cannot move earlier without breaking the course path.'
          : 'This room cannot move later without breaking the course path.';
      this.host.emitStateChanged();
      this.host.renderHud();
      return;
    }

    this.updateCourseComposerDraft((draft) => {
      draft.roomRefs = nextRoomRefs;
    });
    this.statusText =
      direction < 0 ? 'Moved selected room earlier.' : 'Moved selected room later.';
    this.host.emitStateChanged();
    this.host.renderHud();
    void this.refreshSelectedRoomState();
  }

  private updateCourseComposerDraft(mutator: (draft: CourseSnapshot) => void): void {
    if (!this.record?.permissions.canSaveDraft) {
      return;
    }

    updateActiveCourseDraftSession((draft) => {
      mutator(draft);
    });
    this.syncRecordFromSession();
    this.host.emitStateChanged();
    this.host.renderHud();
  }

  private isDirty(): boolean {
    return isActiveCourseDraftSessionDirty();
  }

  async refreshSelectedRoomState(): Promise<void> {
    if (!this.open || !this.record) {
      return;
    }

    const roomRefs = this.record.draft.roomRefs;
    const selectedCoordinates = this.host.getSelectedCoordinates();
    const worldSelectedRoomId = roomIdFromCoordinates(selectedCoordinates);
    const worldSelectedRoomOrder = roomRefs.findIndex((roomRef) => roomRef.roomId === worldSelectedRoomId);
    this.selectedRoomInDraft = worldSelectedRoomOrder >= 0;
    if (worldSelectedRoomOrder >= 0) {
      setActiveCourseDraftSessionSelectedRoom(worldSelectedRoomId);
    }
    this.selectedRoomOrder = getActiveCourseDraftSessionSelectedRoomOrder();

    const meta = await this.loadPublishedRoomMeta(selectedCoordinates);
    this.selectedRoomEligible = meta !== null && this.canSelectedRoomJoinCourseDraft(meta);
    this.host.emitStateChanged();
  }

  private async loadPublishedRoomMeta(
    coordinates: RoomCoordinates,
  ): Promise<CoursePublishedRoomMeta | null> {
    const roomId = roomIdFromCoordinates(coordinates);
    const cached = this.roomMetaByRoomId.get(roomId);
    if (cached) {
      return cached;
    }

    const record = await this.host.roomRepository.loadRoom(roomId, coordinates);
    if (!record.published) {
      return null;
    }

    const publishedVersion =
      record.versions.find((version) => version.version === record.published?.version) ?? null;
    const meta: CoursePublishedRoomMeta = {
      roomId,
      coordinates: { ...coordinates },
      roomVersion: record.published.version,
      roomTitle: record.published.title,
      publishedByUserId:
        publishedVersion?.publishedByUserId ?? record.lastPublishedByUserId ?? null,
    };
    this.roomMetaByRoomId.set(roomId, meta);
    return meta;
  }

  private canSelectedRoomJoinCourseDraft(meta: CoursePublishedRoomMeta): boolean {
    if (!this.record?.permissions.canSaveDraft) {
      return false;
    }

    const authState = getAuthDebugState();
    if (!authState.authenticated || !authState.user?.id) {
      return false;
    }

    if (meta.publishedByUserId !== authState.user.id) {
      return false;
    }

    if (
      this.host.getSelectedSummaryCourseId() &&
      this.host.getSelectedSummaryCourseId() !== this.record.draft.id
    ) {
      return false;
    }

    if (this.record.draft.roomRefs.some((roomRef) => roomRef.roomId === meta.roomId)) {
      return false;
    }

    if (this.record.draft.roomRefs.length >= MAX_COURSE_ROOMS) {
      return false;
    }

    if (this.record.ownerUserId && this.record.ownerUserId !== meta.publishedByUserId) {
      return false;
    }

    if (this.record.draft.roomRefs.length === 0) {
      return true;
    }

    if (!courseRoomRefsFollowLinearPath(this.record.draft.roomRefs)) {
      return false;
    }

    const lastRoomRef = this.record.draft.roomRefs[this.record.draft.roomRefs.length - 1];
    return areCourseRoomRefsOrthogonallyAdjacent(meta, lastRoomRef);
  }

  private setRecord(
    record: CourseRecord | null,
    options: { selectedRoomId?: string | null } = {},
  ): void {
    setActiveCourseDraftSessionRecord(record, options);
    this.syncRecordFromSession();
  }

  private getCurrentCourseDraftGoalSetupDisabledReason(
    draft: CourseSnapshot | null,
  ): string | null {
    if (!draft?.goal) {
      return 'Choose a course goal in the editor first.';
    }

    if (draft.goal && courseGoalRequiresStartPoint(draft.goal) && !draft.startPoint) {
      return 'Place a course start marker first.';
    }

    switch (draft.goal.type) {
      case 'reach_exit':
        return draft.goal.exit ? null : 'Place a course exit first.';
      case 'checkpoint_sprint':
        if (draft.goal.checkpoints.length === 0) {
          return 'Add at least one checkpoint first.';
        }
        return draft.goal.finish ? null : 'Place a course finish marker first.';
      case 'collect_target':
      case 'defeat_all':
      case 'survival':
        return null;
    }
  }

  private getCourseComposerPublishedStateText(): string {
    const published = this.record?.published ?? null;
    if (!published) {
      return 'Not published';
    }

    if (this.isDirty()) {
      return `Published v${published.version} live · draft has unpublished changes`;
    }

    return `Published v${published.version} live`;
  }

  private getCourseComposerPublishedDraftWarningText(): string | null {
    const published = this.record?.published ?? null;
    const draft = this.record?.draft ?? null;
    if (!published || !draft || draft.roomRefs.length > 0) {
      return null;
    }

    return `Draft is empty. Published course v${published.version} is still live until you unpublish it.`;
  }

  private getCurrentCourseDraftPreviewDisabledReason(): string | null {
    const draft = this.record?.draft ?? null;
    if (!draft || draft.roomRefs.length === 0) {
      return this.getCourseComposerPublishedDraftWarningText() ?? 'Add at least one room to the course first.';
    }

    return this.getCurrentCourseDraftGoalSetupDisabledReason(draft);
  }

  private getCurrentCourseDraftSaveDisabledReason(): string | null {
    const draft = this.record?.draft ?? null;
    if (!draft || draft.roomRefs.length === 0) {
      return this.getCourseComposerPublishedDraftWarningText() ?? 'Add at least one room before saving.';
    }

    if (!draft.title?.trim()) {
      return 'Add a course title before saving.';
    }

    if (!this.isDirty()) {
      return 'No unpublished course changes yet.';
    }

    return null;
  }

  private getCurrentCourseDraftPublishDisabledReason(): string | null {
    const draft = this.record?.draft ?? null;
    if (!draft || draft.roomRefs.length < 2) {
      const published = this.record?.published ?? null;
      return published
        ? `Add at least 2 rooms before publishing. Published course v${published.version} is still live until you republish or unpublish it.`
        : 'Add at least 2 rooms before publishing.';
    }

    if (!draft.title?.trim()) {
      return 'Add a course title before publishing.';
    }

    return this.getCurrentCourseDraftGoalSetupDisabledReason(draft);
  }

  private getCourseComposerUnpublishDisabledReason(): string | null {
    if (!this.record?.published) {
      return 'This course is not published yet.';
    }

    if (!this.record.permissions.canUnpublish) {
      return 'This course is read-only for your account.';
    }

    return null;
  }

  private async addSelectedRoomToCourseDraftAsync(): Promise<void> {
    if (!this.record?.permissions.canSaveDraft) {
      return;
    }

    const selectedCoordinates = this.host.getSelectedCoordinates();
    const meta = await this.loadPublishedRoomMeta(selectedCoordinates);
    if (!meta || !this.canSelectedRoomJoinCourseDraft(meta)) {
      this.statusText = 'Selected room cannot be added to this course.';
      this.host.emitStateChanged();
      return;
    }

    this.updateCourseComposerDraft((draft) => {
      const nextRoomRef = {
        roomId: meta.roomId,
        coordinates: { ...meta.coordinates },
        roomVersion: meta.roomVersion,
        roomTitle: meta.roomTitle,
      };
      if (draft.roomRefs.length === 0) {
        draft.roomRefs = [nextRoomRef];
        return;
      }
      const lastRoomRef = draft.roomRefs[draft.roomRefs.length - 1];
      if (areCourseRoomRefsOrthogonallyAdjacent(nextRoomRef, lastRoomRef)) {
        draft.roomRefs = [...draft.roomRefs, nextRoomRef];
      }
    });
    setActiveCourseDraftSessionSelectedRoom(meta.roomId);
    await this.refreshSelectedRoomState();
  }
}

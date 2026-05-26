import { getAuthDebugState } from '../../auth/client';
import type { ExpandedRoomEditorRepository } from '../../expandedRooms/editorRepository';
import {
  getActiveCourseDraftSessionRecord,
  getActiveCourseDraftSessionSelectedRoomId,
  isActiveCourseDraftSessionDirty,
  setActiveCourseDraftSessionRecord,
  setActiveCourseDraftSessionSelectedRoom,
  updateActiveCourseDraftSession,
} from '../../courses/draftSession';
import {
  getExpandedRoomCellLimit as getRecordExpandedRoomCellLimit,
  getExpandedRoomCellUsageText,
  isExpandedRoomCellLimitReached,
} from '../../courses/editor/state';
import {
  cloneCourseSnapshot,
  courseGoalRequiresStartPoint,
  courseRoomRefsFormConnectedCluster,
  type CourseRecord,
  type CourseRoomRef,
  type CourseSnapshot,
} from '../../courses/model';
import { setFocusedCoordinatesInUrl } from '../../navigation/worldNavigation';
import {
  roomIdFromCoordinates,
  type RoomCoordinates,
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
  builderUserId: string | null;
}

interface OverworldCourseComposerControllerHost {
  roomRepository: RoomRepository;
  expandedRoomEditorRepository: ExpandedRoomEditorRepository;
  getMode(): OverworldMode;
  setMode(mode: OverworldMode): void;
  setCameraMode(mode: CameraMode): void;
  getSelectedCoordinates(): RoomCoordinates;
  setSelectedCoordinates(coordinates: RoomCoordinates): void;
  getCurrentRoomCoordinates(): RoomCoordinates;
  setCurrentRoomCoordinates(coordinates: RoomCoordinates): void;
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
  private readonly roomMetaByRoomId = new Map<string, CoursePublishedRoomMeta>();

  constructor(private readonly host: OverworldCourseComposerControllerHost) {}

  reset(): void {
    this.open = false;
    this.loading = false;
    this.record = null;
    this.statusText = null;
    this.selectedRoomEligible = false;
    this.selectedRoomInDraft = false;
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

    this.statusText = 'Expanded room draft updated.';
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
        ? 'This expanded room is read-only for your account.'
        : this.getCurrentCourseDraftPreviewDisabledReason();
    const saveDraftDisabledReason =
      !this.record.permissions.canSaveDraft
        ? 'This expanded room is read-only for your account.'
        : this.getCurrentCourseDraftSaveDisabledReason();
    const publishCourseDisabledReason =
      !this.record.permissions.canPublish
        ? 'This expanded room is read-only for your account.'
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
      cellCount: draft.roomRefs.length,
      cellLimit: this.getExpandedRoomCellLimit(),
      cellUsageText: getExpandedRoomCellUsageText(this.record),
      cellLimitReached: isExpandedRoomCellLimitReached(this.record),
      dirty: this.isDirty(),
      statusText: this.loading ? 'Loading expanded room...' : this.statusText,
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
    void this.removeSelectedRoomFromCourseDraftAsync();
  }

  private async removeSelectedRoomFromCourseDraftAsync(): Promise<void> {
    if (!this.record?.permissions.canSaveDraft) {
      return;
    }

    const selectedRoomId = getActiveCourseDraftSessionSelectedRoomId();
    if (!selectedRoomId) {
      return;
    }

    this.loading = true;
    this.statusText = 'Removing expanded room cell...';
    this.host.emitStateChanged();
    this.host.renderHud();
    try {
      const baseRecord = await this.saveDraftBeforeFootprintMutation();
      const updated = await this.host.expandedRoomEditorRepository.removeCell(
        baseRecord.draft.id,
        selectedRoomId
      );
      this.setRecord(updated, {
        selectedRoomId: updated.draft.roomRefs[0]?.roomId ?? null,
      });
      this.statusText = 'Expanded room cell removed and draft saved.';
      await this.refreshSelectedRoomState();
    } catch (error) {
      console.error('Failed to remove expanded room cell', error);
      this.statusText =
        error instanceof Error ? error.message : 'Failed to remove expanded room cell.';
    } finally {
      this.loading = false;
      this.host.emitStateChanged();
      this.host.renderHud();
    }
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
      this.statusText = 'Select a cell from this expanded room to open it in the editor.';
      this.host.emitStateChanged();
      return false;
    }

    if (!roomRef) {
      this.statusText = 'Selected expanded room cell is no longer in this draft.';
      this.host.emitStateChanged();
      return false;
    }

    const roomSnapshot = this.host.getRoomSnapshotForCoordinates(roomRef.coordinates);
    if (!roomSnapshot) {
      this.statusText = 'Selected expanded room cell is not loaded yet.';
      this.host.emitStateChanged();
      return false;
    }

    this.statusText = 'Editing expanded room cell in the room editor...';
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

  async testDraftCourse(): Promise<void> {
    const draft = this.record?.draft ?? null;
    const disabledReason =
      !this.record?.permissions.canSaveDraft
        ? 'This expanded room is read-only for your account.'
        : this.getCurrentCourseDraftPreviewDisabledReason();
    if (!draft || disabledReason) {
      this.statusText = disabledReason ?? 'Expanded room draft is not ready to test.';
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
        ? 'This expanded room is read-only for your account.'
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

    this.statusText = 'Saving expanded room draft...';
    this.host.emitStateChanged();
    try {
      const saved = await this.host.expandedRoomEditorRepository.saveDraft(courseRecord.draft);
      this.setRecord(saved, {
        selectedRoomId: getActiveCourseDraftSessionSelectedRoomId(),
      });
      this.statusText = 'Expanded room draft saved.';
      await this.refreshSelectedRoomState();
      await this.host.refreshAround(this.host.getCurrentRoomCoordinates(), { forceChunkReload: true });
    } catch (error) {
      console.error('Failed to save expanded room draft', error);
      this.statusText =
        error instanceof Error ? error.message : 'Failed to save expanded room draft.';
    } finally {
      this.host.emitStateChanged();
      this.host.renderHud();
    }
  }

  async publishCourseDraft(): Promise<void> {
    const courseRecord = this.record;
    const disabledReason =
      !courseRecord?.permissions.canPublish
        ? 'This expanded room is read-only for your account.'
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

    this.statusText = 'Publishing expanded room...';
    this.host.emitStateChanged();
    try {
      const saved = await this.host.expandedRoomEditorRepository.saveDraft(courseRecord.draft);
      this.setRecord(saved, {
        selectedRoomId: getActiveCourseDraftSessionSelectedRoomId(),
      });
      const published = await this.host.expandedRoomEditorRepository.publishExpandedRoom(courseRecord.draft.id);
      this.setRecord(published, {
        selectedRoomId: getActiveCourseDraftSessionSelectedRoomId(),
      });
      this.statusText = 'Expanded room published.';
      await this.refreshSelectedRoomState();
      await this.host.refreshAround(this.host.getCurrentRoomCoordinates(), { forceChunkReload: true });
    } catch (error) {
      console.error('Failed to publish expanded room', error);
      this.statusText =
        error instanceof Error ? error.message : 'Failed to publish expanded room.';
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

    this.statusText = 'Unpublishing expanded room...';
    this.host.emitStateChanged();
    try {
      const unpublished = await this.host.expandedRoomEditorRepository.unpublishExpandedRoom(courseRecord.draft.id);
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

      this.statusText = 'Expanded room unpublished. The live expanded room is no longer public.';
      await this.refreshSelectedRoomState();
      await this.host.refreshAround(this.host.getCurrentRoomCoordinates(), { forceChunkReload: true });
    } catch (error) {
      console.error('Failed to unpublish expanded room', error);
      this.statusText =
        error instanceof Error ? error.message : 'Failed to unpublish expanded room.';
    } finally {
      this.host.emitStateChanged();
      this.host.renderHud();
    }
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
      builderUserId:
        record.claimerUserId ?? publishedVersion?.publishedByUserId ?? record.lastPublishedByUserId ?? null,
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

    if (meta.builderUserId !== authState.user.id) {
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

    if (this.record.draft.roomRefs.length >= this.getExpandedRoomCellLimit()) {
      return false;
    }

    if (this.record.ownerUserId && this.record.ownerUserId !== meta.builderUserId) {
      return false;
    }

    const nextRoomRefs: CourseRoomRef[] = [
      ...this.record.draft.roomRefs,
      {
        roomId: meta.roomId,
        coordinates: { ...meta.coordinates },
        roomVersion: meta.roomVersion,
        roomTitle: meta.roomTitle,
      },
    ];
    return courseRoomRefsFormConnectedCluster(nextRoomRefs);
  }

  private getExpandedRoomCellLimit(): number {
    return getRecordExpandedRoomCellLimit(this.record);
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
      return 'Choose an expanded room goal in the editor first.';
    }

    if (draft.goal && courseGoalRequiresStartPoint(draft.goal) && !draft.startPoint) {
      return 'Place an expanded room start marker first.';
    }

    switch (draft.goal.type) {
      case 'reach_exit':
        return draft.goal.exit ? null : 'Place an expanded room exit first.';
      case 'checkpoint_sprint':
        if (draft.goal.checkpoints.length === 0) {
          return 'Add at least one checkpoint first.';
        }
        return draft.goal.finish ? null : 'Place an expanded room finish marker first.';
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

    return `Draft is empty. Published expanded room v${published.version} is still live until you unpublish it.`;
  }

  private getCurrentCourseDraftPreviewDisabledReason(): string | null {
    const draft = this.record?.draft ?? null;
    if (!draft || draft.roomRefs.length === 0) {
      return this.getCourseComposerPublishedDraftWarningText() ?? 'Add at least one cell to the expanded room first.';
    }

    return this.getCurrentCourseDraftGoalSetupDisabledReason(draft);
  }

  private getCurrentCourseDraftSaveDisabledReason(): string | null {
    const draft = this.record?.draft ?? null;
    if (!draft || draft.roomRefs.length === 0) {
      return this.getCourseComposerPublishedDraftWarningText() ?? 'Add at least one cell before saving.';
    }

    if (!draft.title?.trim()) {
      return 'Add an expanded room title before saving.';
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
        ? `Add at least 2 cells before publishing. Published expanded room v${published.version} is still live until you republish or unpublish it.`
        : 'Add at least 2 cells before publishing.';
    }

    if (!draft.title?.trim()) {
      return 'Add an expanded room title before publishing.';
    }

    return this.getCurrentCourseDraftGoalSetupDisabledReason(draft);
  }

  private getCourseComposerUnpublishDisabledReason(): string | null {
    if (!this.record?.published) {
      return 'This expanded room is not published yet.';
    }

    if (!this.record.permissions.canUnpublish) {
      return 'This expanded room is read-only for your account.';
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

    this.loading = true;
    this.statusText = 'Adding expanded room cell...';
    this.host.emitStateChanged();
    this.host.renderHud();
    try {
      const record =
        this.record.draft.roomRefs.length === 0
          ? await this.createExpandedRoomDraftWithInitialCell(meta)
          : await this.expandSavedDraftIntoCell(meta);
      this.setRecord(record, { selectedRoomId: meta.roomId });
      this.statusText = 'Expanded room cell added and draft saved.';
      await this.refreshSelectedRoomState();
    } catch (error) {
      console.error('Failed to add expanded room cell', error);
      this.statusText =
        error instanceof Error ? error.message : 'Failed to add expanded room cell.';
    } finally {
      this.loading = false;
      this.host.emitStateChanged();
      this.host.renderHud();
    }
  }

  private async createExpandedRoomDraftWithInitialCell(
    meta: CoursePublishedRoomMeta
  ): Promise<CourseRecord> {
    if (!this.record) {
      throw new Error('No active expanded room draft.');
    }

    const draft = cloneCourseSnapshot(this.record.draft);
    draft.roomRefs = [
      {
        roomId: meta.roomId,
        coordinates: { ...meta.coordinates },
        roomVersion: meta.roomVersion,
        roomTitle: meta.roomTitle,
      },
    ];
    return this.host.expandedRoomEditorRepository.createExpandedRoom(draft);
  }

  private async expandSavedDraftIntoCell(
    meta: CoursePublishedRoomMeta
  ): Promise<CourseRecord> {
    const baseRecord = await this.saveDraftBeforeFootprintMutation();
    return this.host.expandedRoomEditorRepository.expandIntoCell(baseRecord.draft.id, {
      roomId: meta.roomId,
      coordinates: { ...meta.coordinates },
      roomVersion: meta.roomVersion,
    });
  }

  private async saveDraftBeforeFootprintMutation(): Promise<CourseRecord> {
    if (!this.record) {
      throw new Error('No active expanded room draft.');
    }

    if (!isActiveCourseDraftSessionDirty()) {
      return this.record;
    }

    const saved = await this.host.expandedRoomEditorRepository.saveDraft(this.record.draft);
    this.setRecord(saved, {
      selectedRoomId: getActiveCourseDraftSessionSelectedRoomId(),
    });
    return this.record ?? saved;
  }
}

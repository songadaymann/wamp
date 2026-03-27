import Phaser from 'phaser';
import {
  cloneCourseSnapshot,
  createDefaultCourseGoal,
  type CourseGoal,
  type CourseGoalType,
  type CourseMarkerPoint,
  type CourseSnapshot,
} from '../../courses/model';
import {
  clearActiveCourseDraftSessionRoomOverride,
  getActiveCourseDraftSessionCourseId,
  getActiveCourseDraftSessionDraft,
  setActiveCourseDraftSessionRoomOverride,
  updateActiveCourseDraftSession,
} from '../../courses/draftSession';
import { createGoalMarkerPointFromTile } from '../../goals/roomGoals';
import { createGoalMarkerFlagSprite } from '../../goals/markerFlags';
import { cloneRoomSnapshot, type RoomSnapshot } from '../../persistence/roomRepository';
import type { CourseEditedRoomData, EditorCourseEditData } from '../sceneData';
import type { EditorCourseUiState, EditorMarkerPlacementMode } from '../../ui/setup/sceneBridge';
import {
  buildCourseEditedRoomData,
  buildCourseEditorState,
  buildCourseMarkerDescriptors,
} from './courseEditing';
import { getSelectedCoursePreviewForPlay } from './playMode';

interface EditorCourseControllerHost {
  getRoomId(): string;
  syncBackgroundCameraIgnores(): void;
  updateGoalUi(): void;
  clearRoomGoalPlacementMode(): void;
}

export class EditorCourseController {
  private activeCourseMarkerEdit: EditorCourseEditData | null = null;
  private courseGoalPlacementMode: EditorMarkerPlacementMode | null = null;
  private courseEditorStatusText: string | null = null;
  private courseMarkerSprites: Phaser.GameObjects.Sprite[] = [];
  private courseMarkerLabels: Phaser.GameObjects.Text[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly host: EditorCourseControllerHost,
  ) {}

  initialize(courseEdit: EditorCourseEditData | null): void {
    this.activeCourseMarkerEdit = courseEdit
      ? {
          courseId: courseEdit.courseId,
          roomId: courseEdit.roomId,
        }
      : null;
    this.courseGoalPlacementMode = null;
    this.courseEditorStatusText = this.activeCourseMarkerEdit
      ? null
      : 'Open this room from the course builder to edit course goals.';
  }

  reset(): void {
    this.destroyCourseMarkerOverlays();
    this.activeCourseMarkerEdit = null;
    this.courseGoalPlacementMode = null;
    this.courseEditorStatusText = null;
  }

  getMarkerSprites(): Phaser.GameObjects.Sprite[] {
    return [...this.courseMarkerSprites];
  }

  getMarkerLabels(): Phaser.GameObjects.Text[] {
    return [...this.courseMarkerLabels];
  }

  getGoalPlacementMode(): EditorMarkerPlacementMode | null {
    return this.courseGoalPlacementMode;
  }

  hasActiveCourseEdit(): boolean {
    return this.activeCourseMarkerEdit !== null;
  }

  buildCourseEditedRoomData(): CourseEditedRoomData | null {
    return buildCourseEditedRoomData(this.activeCourseMarkerEdit);
  }

  setStatusText(text: string | null): void {
    this.courseEditorStatusText = text;
  }

  getCourseEditorState(): EditorCourseUiState {
    return buildCourseEditorState({
      activeCourseMarkerEdit: this.activeCourseMarkerEdit,
      courseEditorStatusText: this.courseEditorStatusText,
      draft: this.getActiveCourseDraft(),
      activeGoal: this.getActiveCourseGoal(),
      coursePlacementMode: this.courseGoalPlacementMode,
    });
  }

  getSelectedCoursePreviewForPlay(): CourseSnapshot | null {
    return getSelectedCoursePreviewForPlay(this.getActiveCourseDraft(), this.host.getRoomId());
  }

  syncActiveCourseRoomSessionSnapshot(room: RoomSnapshot, options: { published: boolean }): void {
    const courseEdit = this.activeCourseMarkerEdit;
    if (!courseEdit || getActiveCourseDraftSessionCourseId() !== courseEdit.courseId) {
      return;
    }

    const snapshot = cloneRoomSnapshot(room);
    if (options.published) {
      clearActiveCourseDraftSessionRoomOverride(snapshot.id);
    } else {
      setActiveCourseDraftSessionRoomOverride(snapshot);
    }

    const currentDraft = getActiveCourseDraftSessionDraft();
    const currentRoomRef = currentDraft?.roomRefs.find((entry) => entry.roomId === snapshot.id) ?? null;
    const nextTitle = snapshot.title ?? null;
    const needsRecordUpdate =
      currentRoomRef !== null &&
      (currentRoomRef.roomTitle !== nextTitle ||
        (options.published && currentRoomRef.roomVersion !== snapshot.version));
    if (needsRecordUpdate) {
      updateActiveCourseDraftSession((draft) => {
        const roomRef = draft.roomRefs.find((entry) => entry.roomId === snapshot.id);
        if (!roomRef) {
          return;
        }

        roomRef.roomTitle = nextTitle;
        if (options.published) {
          roomRef.roomVersion = snapshot.version;
        }
      });
      this.host.updateGoalUi();
    }
  }

  redrawMarkers(): void {
    this.destroyCourseMarkerOverlays();
    const markers = buildCourseMarkerDescriptors(this.getActiveCourseDraft(), this.host.getRoomId());
    if (markers.length === 0) {
      this.host.syncBackgroundCameraIgnores();
      return;
    }

    for (const marker of markers) {
      const sprite = createGoalMarkerFlagSprite(
        this.scene,
        marker.variant,
        marker.point.x,
        marker.point.y + 2,
        97,
      );
      this.courseMarkerSprites.push(sprite);

      if (marker.label) {
        const label = this.scene.add.text(marker.point.x, marker.point.y - 28, marker.label, {
          fontFamily: 'Courier New',
          fontSize: '12px',
          color: marker.textColor,
          stroke: '#050505',
          strokeThickness: 4,
        });
        label.setOrigin(0.5, 1);
        label.setDepth(98);
        this.courseMarkerLabels.push(label);
      }
    }

    this.host.syncBackgroundCameraIgnores();
  }

  setCourseGoalType(goalType: CourseGoalType | null): void {
    const draft = this.getActiveCourseDraft();
    if (!draft) {
      return;
    }

    const nextDraft = cloneCourseSnapshot(draft);
    nextDraft.goal = goalType ? createDefaultCourseGoal(goalType) : null;
    if (!goalType) {
      nextDraft.startPoint = null;
    }
    this.courseGoalPlacementMode = null;
    this.setActiveCourseDraft(nextDraft);
  }

  setCourseGoalTimeLimitSeconds(seconds: number | null): void {
    const draft = this.getActiveCourseDraft();
    if (!draft?.goal || draft.goal.type === 'survival' || !('timeLimitMs' in draft.goal)) {
      return;
    }

    const nextDraft = cloneCourseSnapshot(draft);
    if (nextDraft.goal && 'timeLimitMs' in nextDraft.goal) {
      nextDraft.goal.timeLimitMs = seconds === null ? null : Math.max(1, seconds) * 1000;
      this.setActiveCourseDraft(nextDraft);
    }
  }

  setCourseGoalRequiredCount(requiredCount: number): void {
    const draft = this.getActiveCourseDraft();
    if (draft?.goal?.type !== 'collect_target') {
      return;
    }

    const nextDraft = cloneCourseSnapshot(draft);
    if (nextDraft.goal?.type === 'collect_target') {
      nextDraft.goal.requiredCount = Math.max(1, requiredCount);
      this.setActiveCourseDraft(nextDraft);
    }
  }

  setCourseGoalSurvivalSeconds(seconds: number): void {
    const draft = this.getActiveCourseDraft();
    if (draft?.goal?.type !== 'survival') {
      return;
    }

    const nextDraft = cloneCourseSnapshot(draft);
    if (nextDraft.goal?.type === 'survival') {
      nextDraft.goal.durationMs = Math.max(1, seconds) * 1000;
      this.setActiveCourseDraft(nextDraft);
    }
  }

  startCourseGoalMarkerPlacement(mode: EditorMarkerPlacementMode): void {
    if (!this.getActiveCourseDraft() || this.getActiveCourseGoal() === null) {
      return;
    }

    this.host.clearRoomGoalPlacementMode();
    this.courseGoalPlacementMode = this.courseGoalPlacementMode === mode ? null : mode;
    this.host.updateGoalUi();
  }

  clearCourseGoalMarkers(): void {
    const draft = this.getActiveCourseDraft();
    if (!draft) {
      return;
    }

    const nextDraft = cloneCourseSnapshot(draft);
    nextDraft.startPoint = null;
    if (nextDraft.goal?.type === 'reach_exit') {
      nextDraft.goal.exit = null;
    } else if (nextDraft.goal?.type === 'checkpoint_sprint') {
      nextDraft.goal.checkpoints = [];
      nextDraft.goal.finish = null;
    }
    this.courseGoalPlacementMode = null;
    this.setActiveCourseDraft(nextDraft);
  }

  placeGoalMarker(tileX: number, tileY: number): boolean {
    if (this.courseGoalPlacementMode === null) {
      return false;
    }

    const draft = this.getActiveCourseDraft();
    const goal = this.getActiveCourseGoal();
    if (!draft || !goal) {
      return false;
    }

    const localPoint: CourseMarkerPoint = {
      roomId: this.host.getRoomId(),
      ...createGoalMarkerPointFromTile(tileX, tileY),
    };
    const nextDraft = cloneCourseSnapshot(draft);

    if (this.courseGoalPlacementMode === 'start') {
      nextDraft.startPoint = localPoint;
      this.courseGoalPlacementMode = null;
      this.setActiveCourseDraft(nextDraft);
      return true;
    }

    if (
      goal.type === 'reach_exit' &&
      this.courseGoalPlacementMode === 'exit' &&
      nextDraft.goal?.type === 'reach_exit'
    ) {
      nextDraft.goal.exit = localPoint;
      this.courseGoalPlacementMode = null;
      this.setActiveCourseDraft(nextDraft);
      return true;
    }

    if (goal.type !== 'checkpoint_sprint' || nextDraft.goal?.type !== 'checkpoint_sprint') {
      return false;
    }

    if (this.courseGoalPlacementMode === 'checkpoint') {
      nextDraft.goal.checkpoints = [...nextDraft.goal.checkpoints, localPoint];
      this.setActiveCourseDraft(nextDraft);
      return true;
    }

    if (this.courseGoalPlacementMode === 'finish') {
      nextDraft.goal.finish = localPoint;
      this.courseGoalPlacementMode = null;
      this.setActiveCourseDraft(nextDraft);
      return true;
    }

    return false;
  }

  removeGoalMarkerAt(worldX: number, worldY: number): boolean {
    const draft = this.getActiveCourseDraft();
    const goal = this.getActiveCourseGoal();
    if (!draft || !goal) {
      return false;
    }

    const nextDraft = cloneCourseSnapshot(draft);
    const tryRemovePoint = (point: CourseMarkerPoint | null): boolean =>
      Boolean(point && point.roomId === this.host.getRoomId() && Math.hypot(point.x - worldX, point.y - worldY) < 16);

    if (tryRemovePoint(nextDraft.startPoint)) {
      nextDraft.startPoint = null;
      this.setActiveCourseDraft(nextDraft);
      return true;
    }

    if (goal.type === 'reach_exit' && nextDraft.goal?.type === 'reach_exit' && tryRemovePoint(nextDraft.goal.exit)) {
      nextDraft.goal.exit = null;
      this.setActiveCourseDraft(nextDraft);
      return true;
    }

    if (goal.type !== 'checkpoint_sprint' || nextDraft.goal?.type !== 'checkpoint_sprint') {
      return false;
    }

    if (tryRemovePoint(nextDraft.goal.finish)) {
      nextDraft.goal.finish = null;
      this.setActiveCourseDraft(nextDraft);
      return true;
    }

    const index = nextDraft.goal.checkpoints.findIndex(
      (checkpoint) =>
        checkpoint.roomId === this.host.getRoomId() &&
        Math.hypot(checkpoint.x - worldX, checkpoint.y - worldY) < 16,
    );
    if (index >= 0) {
      nextDraft.goal.checkpoints.splice(index, 1);
      this.setActiveCourseDraft(nextDraft);
      return true;
    }

    return false;
  }

  clearPlacementMode(): void {
    this.courseGoalPlacementMode = null;
  }

  private getActiveCourseDraft(): CourseSnapshot | null {
    if (!this.activeCourseMarkerEdit) {
      return null;
    }

    if (getActiveCourseDraftSessionCourseId() !== this.activeCourseMarkerEdit.courseId) {
      return null;
    }

    return getActiveCourseDraftSessionDraft();
  }

  private getActiveCourseGoal(): CourseGoal | null {
    return this.getActiveCourseDraft()?.goal ?? null;
  }

  private setActiveCourseDraft(nextDraft: CourseSnapshot): void {
    if (!this.activeCourseMarkerEdit || getActiveCourseDraftSessionCourseId() !== this.activeCourseMarkerEdit.courseId) {
      return;
    }

    const normalized = cloneCourseSnapshot(nextDraft);
    updateActiveCourseDraftSession((draft) => {
      draft.title = normalized.title;
      draft.roomRefs = normalized.roomRefs;
      draft.startPoint = normalized.startPoint;
      draft.goal = normalized.goal;
    });
    this.host.updateGoalUi();
  }

  private destroyCourseMarkerOverlays(): void {
    for (const sprite of this.courseMarkerSprites) {
      sprite.destroy();
    }
    this.courseMarkerSprites = [];
    for (const label of this.courseMarkerLabels) {
      label.destroy();
    }
    this.courseMarkerLabels = [];
  }
}

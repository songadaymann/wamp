import * as goalAuthoring from '../../courses/goalAuthoring';
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
  setActiveCourseDraftSessionRoomUnsaved,
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

export interface CourseRoomSessionSyncOptions {
  published: boolean;
  baseUpdatedAt?: string | null;
  unsaved?: boolean;
}

interface EditorCourseControllerHost {
  getRoomId(): string;
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
      : 'Open this room from the expanded room builder to edit expanded room goals.';
  }

  reset(): void {
    this.destroyCourseMarkerOverlays();
    this.activeCourseMarkerEdit = null;
    this.courseGoalPlacementMode = null;
    this.courseEditorStatusText = null;
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

  /**
   * `baseUpdatedAt` is the server version this copy was loaded or saved at and `unsaved` whether the copy
   * holds edits not saved yet, so the Expanded Room editor neither overwrites newer work with it nor
   * drops it as stale (F379).
   */
  syncActiveCourseRoomSessionSnapshot(room: RoomSnapshot, options: CourseRoomSessionSyncOptions): void {
    const courseEdit = this.activeCourseMarkerEdit;
    if (!courseEdit || getActiveCourseDraftSessionCourseId() !== courseEdit.courseId) {
      return;
    }

    const snapshot = cloneRoomSnapshot(room);
    if (options.published) {
      clearActiveCourseDraftSessionRoomOverride(snapshot.id);
    } else {
      setActiveCourseDraftSessionRoomOverride(snapshot, options.baseUpdatedAt ?? null);
      if (options.unsaved !== undefined) setActiveCourseDraftSessionRoomUnsaved(snapshot.id, options.unsaved);
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
    if (!draft?.goal || !goalAuthoring.getExpandedGoalAuthoringFields(draft.goal).timeLimitEditable || !('timeLimitMs' in draft.goal)) {
      return;
    }

    const nextDraft = cloneCourseSnapshot(draft);
    if (goalAuthoring.setExpandedGoalTimeLimit(nextDraft.goal, seconds === null ? null : Math.max(1, seconds) * 1000)) {
      this.setActiveCourseDraft(nextDraft);
    }
  }

  setCourseGoalRequiredCount(requiredCount: number): void {
    const draft = this.getActiveCourseDraft();
    if (!draft?.goal || !goalAuthoring.getExpandedGoalAuthoringFields(draft.goal).requiredCountEditable) {
      return;
    }

    const nextDraft = cloneCourseSnapshot(draft);
    if (goalAuthoring.setExpandedGoalRequiredCount(nextDraft.goal, Math.max(1, requiredCount))) {
      this.setActiveCourseDraft(nextDraft);
    }
  }

  setCourseGoalSurvivalSeconds(seconds: number): void {
    const draft = this.getActiveCourseDraft();
    if (!draft?.goal || !goalAuthoring.getExpandedGoalAuthoringFields(draft.goal).durationEditable) {
      return;
    }

    const nextDraft = cloneCourseSnapshot(draft);
    if (goalAuthoring.setExpandedGoalDuration(nextDraft.goal, Math.max(1, seconds) * 1000)) {
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
    goalAuthoring.clearExpandedGoalMarkers(nextDraft.goal);
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

    if (!nextDraft.goal || goal.type !== nextDraft.goal.type || !goalAuthoring.placeExpandedGoalMarker(nextDraft.goal, this.courseGoalPlacementMode, localPoint)) return false;
    if (this.courseGoalPlacementMode !== 'checkpoint') this.courseGoalPlacementMode = null;
    this.setActiveCourseDraft(nextDraft);
    return true;
  }

  removeGoalMarkerAt(worldX: number, worldY: number): boolean {
    const draft = this.getActiveCourseDraft();
    const goal = this.getActiveCourseGoal();
    if (!draft || !goal) return false;
    const nextDraft = cloneCourseSnapshot(draft);
    const start = nextDraft.startPoint;
    if (start && start.roomId === this.host.getRoomId() && Math.hypot(start.x - worldX, start.y - worldY) < 16) {
      nextDraft.startPoint = null;
      this.setActiveCourseDraft(nextDraft);
      return true;
    }
    if (!nextDraft.goal || goal.type !== nextDraft.goal.type || !goalAuthoring.removeExpandedGoalMarker(nextDraft.goal, this.host.getRoomId(), worldX, worldY)) return false;
    this.setActiveCourseDraft(nextDraft);
    return true;
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

import type {
  CourseGoalType,
  CourseMarkerPoint,
  CoursePermissions,
  CourseRecord,
  CourseRoomRef,
  CourseSnapshot,
} from '../model';
import type { RoomCoordinates } from '../../persistence/roomModel';

export type CourseEditorTool = 'select' | 'rooms' | 'start' | 'exit' | 'checkpoint' | 'finish';

export interface CourseEditorRoomEntry {
  roomId: string;
  coordinates: RoomCoordinates;
  roomVersion: number;
  roomTitle: string | null;
  selected: boolean;
  isStartRoom: boolean;
  isFinishRoom: boolean;
  checkpointIndexes: number[];
}

export interface CourseEditorCheckpointEntry {
  index: number;
  point: CourseMarkerPoint;
  roomTitle: string | null;
  coordinates: RoomCoordinates;
  canMoveEarlier: boolean;
  canMoveLater: boolean;
}

export interface CourseEditorUiState {
  visible: boolean;
  title: string;
  canEdit: boolean;
  zoomText: string;
  tool: CourseEditorTool;
  statusText: string | null;
  placementHintText: string | null;
  selectedRoomSummary: string;
  selectedRoomStatusText: string;
  selectedRoomId: string | null;
  canToggleSelectedRoom: boolean;
  toggleSelectedRoomLabel: string;
  toggleSelectedRoomDisabledReason: string | null;
  canOpenSelectedRoom: boolean;
  canCenterSelectedRoom: boolean;
  canOpenCourseEditor: boolean;
  openCourseEditorDisabledReason: string | null;
  roomEntries: CourseEditorRoomEntry[];
  checkpointEntries: CourseEditorCheckpointEntry[];
  goalType: CourseGoalType | null;
  timeLimitSeconds: string;
  requiredCount: string;
  survivalSeconds: string;
  publishedStateText: string;
  publishedDraftWarningText: string | null;
  summaryText: string;
  dirty: boolean;
  canTestDraft: boolean;
  testDraftDisabledReason: string | null;
  canSaveDraft: boolean;
  saveDraftDisabledReason: string | null;
  canPublishCourse: boolean;
  publishCourseDisabledReason: string | null;
  showUnpublishCourse: boolean;
  canUnpublishCourse: boolean;
  unpublishCourseDisabledReason: string | null;
}

export function getCourseEditorPlacementHintText(tool: CourseEditorTool): string | null {
  switch (tool) {
    case 'rooms':
      return 'Click published rooms you authored to add or remove them from this course.';
    case 'start':
      return 'Click a course room to place the course start marker.';
    case 'exit':
      return 'Click a course room to place the course exit marker.';
    case 'checkpoint':
      return 'Click a course room to add a checkpoint marker.';
    case 'finish':
      return 'Click a course room to place the course finish marker.';
    case 'select':
    default:
      return null;
  }
}

export function getCurrentCourseDraftGoalSetupDisabledReason(
  draft: CourseSnapshot | null
): string | null {
  if (!draft?.goal) {
    return 'Choose a course goal first.';
  }

  if (!draft.startPoint) {
    return 'Place a course start marker first.';
  }

  switch (draft.goal.type) {
    case 'reach_exit':
      return draft.goal.exit ? null : 'Place a course exit marker.';
    case 'checkpoint_sprint':
      if (draft.goal.checkpoints.length === 0) {
        return 'Add at least one checkpoint first.';
      }
      return draft.goal.finish ? null : 'Place a course finish marker.';
    case 'collect_target':
    case 'defeat_all':
    case 'survival':
      return null;
  }
}

export function getPublishedCourseStillLiveWarningText(record: CourseRecord | null): string | null {
  const published = record?.published ?? null;
  if (!published) {
    return null;
  }

  return `Published course v${published.version} is still live until you unpublish it.`;
}

export function getCoursePublishedStateText(record: CourseRecord | null, dirty: boolean): string {
  const published = record?.published ?? null;
  if (!published) {
    return 'Not published';
  }

  if (dirty) {
    return `Published v${published.version} live · draft has unpublished changes`;
  }

  return `Published v${published.version} live`;
}

export function getCoursePublishedDraftWarningText(record: CourseRecord | null): string | null {
  const published = record?.published ?? null;
  const draft = record?.draft ?? null;
  if (!published || !draft || draft.roomRefs.length > 0) {
    return null;
  }

  return `Draft is empty. Published course v${published.version} is still live until you unpublish it.`;
}

export function getCurrentCourseDraftPreviewDisabledReason(record: CourseRecord | null): string | null {
  const draft = record?.draft ?? null;
  if (!draft || draft.roomRefs.length === 0) {
    return getCoursePublishedDraftWarningText(record) ?? 'Add at least one room to the course first.';
  }

  return getCurrentCourseDraftGoalSetupDisabledReason(draft);
}

export function getCurrentCourseDraftSaveDisabledReason(
  record: CourseRecord | null,
  dirty: boolean
): string | null {
  const draft = record?.draft ?? null;
  if (!draft || draft.roomRefs.length === 0) {
    return getCoursePublishedDraftWarningText(record) ?? 'Add at least one room before saving.';
  }

  if (!draft.title?.trim()) {
    return 'Add a course title before saving.';
  }

  if (!dirty) {
    return 'No unpublished course changes yet.';
  }

  return null;
}

export function getCurrentCourseDraftPublishDisabledReason(record: CourseRecord | null): string | null {
  const draft = record?.draft ?? null;
  if (!draft || draft.roomRefs.length < 2) {
    const published = record?.published ?? null;
    return published
      ? `Add at least 2 rooms before publishing. Published course v${published.version} is still live until you republish or unpublish it.`
      : 'Add at least 2 rooms before publishing.';
  }

  if (!draft.title?.trim()) {
    return 'Add a course title before publishing.';
  }

  return getCurrentCourseDraftGoalSetupDisabledReason(draft);
}

export function getCourseUnpublishDisabledReason(
  record: CourseRecord | null,
  permissions: CoursePermissions | null
): string | null {
  if (!record?.published) {
    return 'This course is not published yet.';
  }

  if (!permissions?.canUnpublish) {
    return 'This course is read-only for your account.';
  }

  return null;
}

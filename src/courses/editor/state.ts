import type {
  CourseGoalType,
  CourseMarkerPoint,
  CoursePermissions,
  CourseRecord,
  CourseSnapshot,
} from '../model';
import {
  MAX_EXPANDED_ROOM_CELLS,
  courseGoalRequiresStartPoint,
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
  cellUsageText: string;
  cellLimitReached: boolean;
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
      return 'Click published cells you authored to add or remove them from this expanded room.';
    case 'start':
      return 'Click an expanded room cell to place the start marker.';
    case 'exit':
      return 'Click an expanded room cell to place the exit marker.';
    case 'checkpoint':
      return 'Click an expanded room cell to add a checkpoint marker.';
    case 'finish':
      return 'Click an expanded room cell to place the finish marker.';
    case 'select':
    default:
      return null;
  }
}

export function getCurrentCourseDraftGoalSetupDisabledReason(
  draft: CourseSnapshot | null
): string | null {
  if (!draft?.goal) {
    return 'Expanded room goal is authored in Edit Expanded Room. Open Edit Expanded Room to choose a goal first.';
  }

  if (courseGoalRequiresStartPoint(draft.goal) && !draft.startPoint) {
    return 'Expanded room goal is authored in Edit Expanded Room. Open Edit Expanded Room to place a start marker first.';
  }

  switch (draft.goal.type) {
    case 'reach_exit':
      return draft.goal.exit
        ? null
        : 'Expanded room goal is authored in Edit Expanded Room. Open Edit Expanded Room to place an exit marker.';
    case 'checkpoint_sprint':
      if (draft.goal.checkpoints.length === 0) {
        return 'Expanded room goal is authored in Edit Expanded Room. Open Edit Expanded Room to add at least one checkpoint first.';
      }
      return draft.goal.finish
        ? null
        : 'Expanded room goal is authored in Edit Expanded Room. Open Edit Expanded Room to place a finish marker.';
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

  return `Published expanded room v${published.version} is still live until you unpublish it.`;
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

  return `Draft is empty. Published expanded room v${published.version} is still live until you unpublish it.`;
}

export function getExpandedRoomCellLimit(record: CourseRecord | null): number {
  return record?.expandedRoomCellLimit ?? MAX_EXPANDED_ROOM_CELLS;
}

export function formatExpandedRoomCellCount(count: number): string {
  return count === 1 ? '1 cell' : `${count} cells`;
}

export function getExpandedRoomCellUsageText(record: CourseRecord | null): string {
  const used = record?.draft.roomRefs.length ?? 0;
  const limit = getExpandedRoomCellLimit(record);
  const capLabel = limit === 1 ? 'cell' : 'cells';
  const base = `${used}/${limit} ${capLabel} used`;
  if (used >= limit) {
    return `${base} · builder cap reached`;
  }

  return `${base} · ${formatExpandedRoomCellCount(limit - used)} remaining`;
}

export function isExpandedRoomCellLimitReached(record: CourseRecord | null): boolean {
  if (!record) {
    return false;
  }

  return record.draft.roomRefs.length >= getExpandedRoomCellLimit(record);
}

export function getCurrentCourseDraftPreviewDisabledReason(record: CourseRecord | null): string | null {
  const draft = record?.draft ?? null;
  if (!draft || draft.roomRefs.length === 0) {
    return getCoursePublishedDraftWarningText(record) ?? 'Add at least one cell to the expanded room first.';
  }

  return getCurrentCourseDraftGoalSetupDisabledReason(draft);
}

export function getCurrentCourseDraftSaveDisabledReason(
  record: CourseRecord | null,
  dirty: boolean
): string | null {
  const draft = record?.draft ?? null;
  if (!draft || draft.roomRefs.length === 0) {
    return getCoursePublishedDraftWarningText(record) ?? 'Add at least one cell before saving.';
  }

  if (!draft.title?.trim()) {
    return 'Add an expanded room title before saving.';
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
      ? `Add at least 2 cells before publishing. Published expanded room v${published.version} is still live until you republish or unpublish it.`
      : 'Add at least 2 cells before publishing.';
  }

  if (!draft.title?.trim()) {
    return 'Add an expanded room title before publishing.';
  }

  return getCurrentCourseDraftGoalSetupDisabledReason(draft);
}

export function getCourseUnpublishDisabledReason(
  record: CourseRecord | null,
  permissions: CoursePermissions | null
): string | null {
  if (!record?.published) {
    return 'This expanded room is not published yet.';
  }

  if (!permissions?.canUnpublish) {
    return 'This expanded room is read-only for your account.';
  }

  return null;
}

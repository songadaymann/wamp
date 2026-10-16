import * as goalAuthoring from '../goalAuthoring';
import type { CourseRecord } from '../model';
import {
  getCourseEditorPlacementHintText,
  getExpandedRoomCellUsageText,
  getCoursePublishedDraftWarningText,
  getCoursePublishedStateText,
  getCourseUnpublishDisabledReason,
  getCurrentCourseDraftPreviewDisabledReason,
  getCurrentCourseDraftPublishDisabledReason,
  getCurrentCourseDraftSaveDisabledReason,
  isExpandedRoomCellLimitReached,
  type CourseEditorCheckpointEntry,
  type CourseEditorRoomEntry,
  type CourseEditorTool,
  type CourseEditorUiState,
} from './state';

export interface BuildCourseEditorUiStateOptions {
  busy?: boolean;
  record: CourseRecord | null;
  dirty: boolean;
  zoomText: string;
  tool: CourseEditorTool;
  statusText: string | null;
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
}

export function buildCourseEditorUiState(
  options: BuildCourseEditorUiStateOptions
): CourseEditorUiState {
  const {
    record,
    dirty,
    zoomText,
    tool,
    statusText,
    selectedRoomSummary,
    selectedRoomStatusText,
    selectedRoomId,
    canToggleSelectedRoom,
    toggleSelectedRoomLabel,
    toggleSelectedRoomDisabledReason,
    canOpenSelectedRoom,
    canCenterSelectedRoom,
    canOpenCourseEditor,
    openCourseEditorDisabledReason,
    roomEntries,
    checkpointEntries,
  } = options;
  const draft = record?.draft ?? null;
  const goalFields = goalAuthoring.getExpandedGoalAuthoringFields(draft?.goal ?? null);
  const permissions = record?.permissions ?? null;
  const testDraftDisabledReason = permissions?.canSaveDraft
    ? getCurrentCourseDraftPreviewDisabledReason(record)
    : 'This expanded room is read-only for your account.';
  const saveDraftDisabledReason = permissions?.canSaveDraft
    ? getCurrentCourseDraftSaveDisabledReason(record, dirty)
    : 'This expanded room is read-only for your account.';
  const publishCourseDisabledReason = options.busy ? 'Please wait…' : permissions?.canPublish
    ? getCurrentCourseDraftPublishDisabledReason(record)
    : 'This expanded room is read-only for your account.';
  const unpublishCourseDisabledReason = getCourseUnpublishDisabledReason(record, permissions);

  return {
    visible: true,
    title: draft?.title ?? '',
    pitsAreDeadly: draft?.pitsAreDeadly === true,
    playerHearts: draft?.playerHearts ?? 1,
    canEdit: Boolean(permissions?.canSaveDraft),
    zoomText,
    tool,
    statusText,
    placementHintText: getCourseEditorPlacementHintText(tool),
    selectedRoomSummary,
    selectedRoomStatusText,
    selectedRoomId,
    canToggleSelectedRoom,
    toggleSelectedRoomLabel,
    toggleSelectedRoomDisabledReason,
    canOpenSelectedRoom,
    canCenterSelectedRoom,
    canOpenCourseEditor,
    openCourseEditorDisabledReason,
    roomEntries,
    checkpointEntries,
    cellUsageText: getExpandedRoomCellUsageText(record),
    cellLimitReached: isExpandedRoomCellLimitReached(record),
    goalType: draft?.goal?.type ?? null,
    timeLimitSeconds:
      draft?.goal && 'timeLimitMs' in draft.goal && draft.goal.timeLimitMs !== null
        ? String(Math.max(1, Math.round(draft.goal.timeLimitMs / 1000)))
        : '',
    requiredCount:
      goalFields.requiredCountEditable ? String(goalFields.requiredCount) : '5',
    survivalSeconds:
      goalFields.durationEditable
        ? String(Math.max(1, Math.round(Number(goalFields.durationMs) / 1000)))
        : '30',
    publishedStateText: getCoursePublishedStateText(record, dirty),
    publishedDraftWarningText: getCoursePublishedDraftWarningText(record),
    summaryText: buildCourseSummaryText(record),
    dirty,
    canTestDraft: testDraftDisabledReason === null,
    testDraftDisabledReason,
    canSaveDraft: saveDraftDisabledReason === null,
    saveDraftDisabledReason,
    canPublishCourse: publishCourseDisabledReason === null,
    publishCourseDisabledReason,
    showUnpublishCourse: Boolean(record?.published),
    canUnpublishCourse: unpublishCourseDisabledReason === null,
    unpublishCourseDisabledReason,
  };
}

function buildCourseSummaryText(record: CourseRecord | null): string {
  const draft = record?.draft ?? null;
  const goal = draft?.goal ?? null;
  if (!draft) {
    return 'Select published cells you authored to build an expanded room.';
  }

  const parts: string[] = [];
  parts.push(getExpandedRoomCellUsageText(record));

  if (!goal) {
    parts.push('No expanded room goal selected');
    return parts.join(' · ');
  }

  parts.push(...goalAuthoring.expandedGoalSummaryParts(goal, Boolean(draft.startPoint), 'composer'));

  return parts.join(' · ');
}

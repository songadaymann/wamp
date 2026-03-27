import type { CourseRecord } from '../model';
import {
  getCourseEditorPlacementHintText,
  getCoursePublishedDraftWarningText,
  getCoursePublishedStateText,
  getCourseUnpublishDisabledReason,
  getCurrentCourseDraftPreviewDisabledReason,
  getCurrentCourseDraftPublishDisabledReason,
  getCurrentCourseDraftSaveDisabledReason,
  type CourseEditorCheckpointEntry,
  type CourseEditorRoomEntry,
  type CourseEditorTool,
  type CourseEditorUiState,
} from './state';

export interface BuildCourseEditorUiStateOptions {
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
  const permissions = record?.permissions ?? null;
  const testDraftDisabledReason = permissions?.canSaveDraft
    ? getCurrentCourseDraftPreviewDisabledReason(record)
    : 'This course is read-only for your account.';
  const saveDraftDisabledReason = permissions?.canSaveDraft
    ? getCurrentCourseDraftSaveDisabledReason(record, dirty)
    : 'This course is read-only for your account.';
  const publishCourseDisabledReason = permissions?.canPublish
    ? getCurrentCourseDraftPublishDisabledReason(record)
    : 'This course is read-only for your account.';
  const unpublishCourseDisabledReason = getCourseUnpublishDisabledReason(record, permissions);

  return {
    visible: true,
    title: draft?.title ?? '',
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
    goalType: draft?.goal?.type ?? null,
    timeLimitSeconds:
      draft?.goal && 'timeLimitMs' in draft.goal && draft.goal.timeLimitMs !== null
        ? String(Math.max(1, Math.round(draft.goal.timeLimitMs / 1000)))
        : '',
    requiredCount:
      draft?.goal?.type === 'collect_target' ? String(draft.goal.requiredCount) : '5',
    survivalSeconds:
      draft?.goal?.type === 'survival'
        ? String(Math.max(1, Math.round(draft.goal.durationMs / 1000)))
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
    return 'Select published rooms you authored to build a course.';
  }

  const parts: string[] = [];
  parts.push(`${draft.roomRefs.length} room${draft.roomRefs.length === 1 ? '' : 's'}`);

  if (!goal) {
    parts.push('No course goal selected');
    return parts.join(' · ');
  }

  switch (goal.type) {
    case 'reach_exit':
      parts.push('Reach Exit');
      parts.push(draft.startPoint ? 'start set' : 'start missing');
      parts.push(goal.exit ? 'exit set' : 'exit missing');
      break;
    case 'checkpoint_sprint':
      parts.push('Checkpoint Sprint');
      parts.push(draft.startPoint ? 'start set' : 'start missing');
      parts.push(`${goal.checkpoints.length} checkpoint${goal.checkpoints.length === 1 ? '' : 's'}`);
      parts.push(goal.finish ? 'finish set' : 'finish missing');
      break;
    case 'collect_target':
      parts.push(`Collect ${goal.requiredCount}`);
      break;
    case 'defeat_all':
      parts.push('Defeat All');
      break;
    case 'survival':
      parts.push(`Survival ${Math.max(1, Math.round(goal.durationMs / 1000))}s`);
      break;
  }

  return parts.join(' · ');
}

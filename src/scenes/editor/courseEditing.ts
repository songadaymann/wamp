import * as goalAuthoring from '../../courses/goalAuthoring';
import {
  cloneCourseSnapshot,
  type CourseGoal,
  type CourseMarkerPoint,
  type CourseSnapshot,
} from '../../courses/model';
import type { GoalMarkerFlagVariant } from '../../goals/markerFlags';
import type { EditorCourseEditData, CourseEditedRoomData } from '../sceneData';
import type { EditorCourseUiState, EditorMarkerPlacementMode } from '../../ui/setup/sceneBridge';

export interface CourseMarkerOverlayDescriptor {
  point: CourseMarkerPoint;
  label: string | null;
  variant: GoalMarkerFlagVariant;
  textColor: string;
}

export interface BuildCourseEditorStateOptions {
  activeCourseMarkerEdit: EditorCourseEditData | null;
  courseEditorStatusText: string | null;
  draft: CourseSnapshot | null;
  activeGoal: CourseGoal | null;
  coursePlacementMode: EditorMarkerPlacementMode | null;
}

export interface CourseGoalSummaryContext {
  collectiblesPlaced?: number;
}

export function getCourseEditorContextStatusText(
  activeCourseMarkerEdit: EditorCourseEditData | null,
  draft: CourseSnapshot | null,
  courseEditorStatusText: string | null,
): string | null {
  if (!activeCourseMarkerEdit) {
    return courseEditorStatusText;
  }

  if (!draft) {
    return courseEditorStatusText ?? 'Open this room from the active expanded room builder session.';
  }

  const titleText = draft.title?.trim() || 'Untitled Expanded Room';
  return `Expanded room cell · ${titleText}`;
}

export function buildCourseEditedRoomData(
  activeCourseMarkerEdit: EditorCourseEditData | null,
): CourseEditedRoomData | null {
  if (!activeCourseMarkerEdit) {
    return null;
  }

  return {
    courseId: activeCourseMarkerEdit.courseId,
    roomId: activeCourseMarkerEdit.roomId,
  };
}

export function getCourseGoalSummaryText(
  draft: CourseSnapshot | null,
  context: CourseGoalSummaryContext = {},
): string {
  const goal = draft?.goal ?? null;
  if (!goal) {
    return 'No expanded room goal selected.';
  }

  const parts = goalAuthoring.expandedGoalSummaryParts(goal, Boolean(draft?.startPoint), 'cell', context.collectiblesPlaced);

  if (draft?.roomRefs.length) {
    parts.push(`${draft.roomRefs.length} cell${draft.roomRefs.length === 1 ? '' : 's'}`);
  }

  return parts.join(' · ');
}

export function buildCourseMarkerDescriptors(
  draft: CourseSnapshot | null,
  currentRoomId: string,
): CourseMarkerOverlayDescriptor[] {
  return goalAuthoring.buildExpandedEditorMarkers(draft, 'cell')
    .filter(marker => marker.point.roomId === currentRoomId)
    .map(marker => ({ point: marker.point, label: marker.label, variant: marker.finish ? 'finish-pending' : 'checkpoint-pending', textColor: '#ffefef' }));
}

export function buildCourseEditorState(
  options: BuildCourseEditorStateOptions,
): EditorCourseUiState {
  const {
    activeCourseMarkerEdit,
    draft,
    activeGoal,
  } = options;
  if (activeCourseMarkerEdit) {
    return {
      visible: false,
      statusHidden: true,
      statusText: null,
      roomStepText: draft ? `${draft.roomRefs.length} cell${draft.roomRefs.length === 1 ? '' : 's'} in expanded room` : '',
      canReturnToCourseBuilder: true,
      goalTypeValue: activeGoal?.type ?? '',
      goalTypeDisabled: true,
      timeLimitHidden: true,
      timeLimitDisabled: true,
      timeLimitValue: '',
      requiredCountHidden: true,
      requiredCountDisabled: true,
      requiredCountValue: '1',
      survivalHidden: true,
      survivalDisabled: true,
      survivalValue: '30',
      markerControlsHidden: true,
      placementHintHidden: true,
      placementHintText: '',
      summaryText: draft ? getCourseGoalSummaryText(draft) : '',
      placeStartHidden: true,
      placeStartActive: false,
      placeExitHidden: true,
      placeExitActive: false,
      addCheckpointHidden: true,
      addCheckpointActive: false,
      placeFinishHidden: true,
      placeFinishActive: false,
    };
  }

  return {
    visible: false,
    statusHidden: true,
    statusText: null,
    roomStepText: '',
    canReturnToCourseBuilder: false,
    goalTypeValue: activeGoal?.type ?? '',
    goalTypeDisabled: true,
    timeLimitHidden: true,
    timeLimitDisabled: true,
    timeLimitValue: '',
    requiredCountHidden: true,
    requiredCountDisabled: true,
    requiredCountValue: '1',
    survivalHidden: true,
    survivalDisabled: true,
    survivalValue: '30',
    markerControlsHidden: true,
    placementHintHidden: true,
    placementHintText: '',
    summaryText: draft ? getCourseGoalSummaryText(draft) : '',
    placeStartHidden: true,
    placeStartActive: false,
    placeExitHidden: true,
    placeExitActive: false,
    addCheckpointHidden: true,
    addCheckpointActive: false,
    placeFinishHidden: true,
    placeFinishActive: false,
  };
}

export function cloneCourseDraftForMutation(draft: CourseSnapshot): CourseSnapshot {
  return cloneCourseSnapshot(draft);
}

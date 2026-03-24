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

export function getCourseEditorContextStatusText(
  activeCourseMarkerEdit: EditorCourseEditData | null,
  draft: CourseSnapshot | null,
  courseEditorStatusText: string | null,
): string | null {
  if (!activeCourseMarkerEdit) {
    return courseEditorStatusText;
  }

  if (!draft) {
    return courseEditorStatusText ?? 'Open this room from the active course builder session.';
  }

  const stepText =
    activeCourseMarkerEdit.roomOrder === null
      ? 'Course room'
      : `Step ${activeCourseMarkerEdit.roomOrder + 1}`;
  const titleText = draft.title?.trim() || 'Untitled Course';
  return `${stepText} · ${titleText}`;
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

export function getCourseGoalSummaryText(draft: CourseSnapshot | null): string {
  const goal = draft?.goal ?? null;
  if (!goal) {
    return 'No course goal selected.';
  }

  const parts: string[] = [];
  switch (goal.type) {
    case 'reach_exit':
      parts.push('Reach Exit');
      parts.push(draft?.startPoint ? 'start set' : 'start missing');
      parts.push(goal.exit ? 'exit set' : 'exit missing');
      break;
    case 'checkpoint_sprint':
      parts.push('Checkpoint Sprint');
      parts.push(draft?.startPoint ? 'start set' : 'start missing');
      parts.push(`${goal.checkpoints.length} checkpoint${goal.checkpoints.length === 1 ? '' : 's'}`);
      parts.push(goal.finish ? 'finish set' : 'finish missing');
      break;
    case 'collect_target':
      parts.push(`Collect Target · ${goal.requiredCount} required`);
      break;
    case 'defeat_all':
      parts.push('Defeat All');
      break;
    case 'survival':
      parts.push(`Survival · ${Math.max(1, Math.round(goal.durationMs / 1000))}s`);
      break;
  }

  if (draft?.roomRefs.length) {
    parts.push(`${draft.roomRefs.length} room${draft.roomRefs.length === 1 ? '' : 's'}`);
  }

  return parts.join(' · ');
}

export function buildCourseMarkerDescriptors(
  draft: CourseSnapshot | null,
  currentRoomId: string,
): CourseMarkerOverlayDescriptor[] {
  const goal = draft?.goal ?? null;
  if (!draft || !goal) {
    return [];
  }

  const markers: CourseMarkerOverlayDescriptor[] = [];
  if (draft.startPoint?.roomId === currentRoomId) {
    markers.push({
      point: draft.startPoint,
      label: 'START',
      variant: 'checkpoint-pending',
      textColor: '#ffefef',
    });
  }

  if (goal.type === 'reach_exit' && goal.exit?.roomId === currentRoomId) {
    markers.push({
      point: goal.exit,
      label: null,
      variant: 'finish-pending',
      textColor: '#ffefef',
    });
  }

  if (goal.type === 'checkpoint_sprint') {
    goal.checkpoints.forEach((checkpoint, index) => {
      if (checkpoint.roomId !== currentRoomId) {
        return;
      }

      markers.push({
        point: checkpoint,
        label: `${index + 1}`,
        variant: 'checkpoint-pending',
        textColor: '#ffefef',
      });
    });

    if (goal.finish?.roomId === currentRoomId) {
      markers.push({
        point: goal.finish,
        label: 'FINISH',
        variant: 'finish-pending',
        textColor: '#ffefef',
      });
    }
  }

  return markers;
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
      roomStepText: '',
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
      canEditPreviousRoom: false,
      canEditNextRoom: false,
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
    canEditPreviousRoom: false,
    canEditNextRoom: false,
  };
}

export function cloneCourseDraftForMutation(draft: CourseSnapshot): CourseSnapshot {
  return cloneCourseSnapshot(draft);
}

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
    roomOrder: activeCourseMarkerEdit.roomOrder,
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
    courseEditorStatusText,
    draft,
    activeGoal,
    coursePlacementMode,
  } = options;
  const roomOrder = activeCourseMarkerEdit?.roomOrder ?? null;
  const roomStepText =
    roomOrder !== null
      ? draft
        ? `Room ${roomOrder + 1} of ${draft.roomRefs.length}`
        : `Room ${roomOrder + 1}`
      : '';
  const canEditPreviousRoom =
    roomOrder !== null &&
    roomOrder > 0;
  const canEditNextRoom =
    roomOrder !== null &&
    draft !== null &&
    roomOrder < draft.roomRefs.length - 1;
  return {
    visible: Boolean(activeCourseMarkerEdit),
    statusHidden: !getCourseEditorContextStatusText(activeCourseMarkerEdit, draft, courseEditorStatusText),
    statusText: getCourseEditorContextStatusText(activeCourseMarkerEdit, draft, courseEditorStatusText),
    roomStepText,
    canReturnToCourseBuilder: Boolean(activeCourseMarkerEdit),
    goalTypeValue: activeGoal?.type ?? '',
    goalTypeDisabled: !draft,
    timeLimitHidden: !activeGoal || !('timeLimitMs' in activeGoal),
    timeLimitDisabled: !draft,
    timeLimitValue:
      activeGoal && 'timeLimitMs' in activeGoal && activeGoal.timeLimitMs
        ? String(Math.round(activeGoal.timeLimitMs / 1000))
        : '',
    requiredCountHidden: activeGoal?.type !== 'collect_target',
    requiredCountDisabled: !draft,
    requiredCountValue:
      activeGoal?.type === 'collect_target' ? String(activeGoal.requiredCount) : '1',
    survivalHidden: activeGoal?.type !== 'survival',
    survivalDisabled: !draft,
    survivalValue:
      activeGoal?.type === 'survival'
        ? String(Math.round(activeGoal.durationMs / 1000))
        : '30',
    markerControlsHidden: !activeGoal,
    placementHintHidden: coursePlacementMode === null,
    placementHintText:
      coursePlacementMode === 'start'
        ? 'Click the canvas to place the course start marker.'
        : coursePlacementMode === 'exit'
          ? 'Click the canvas to place the course exit marker.'
          : coursePlacementMode === 'checkpoint'
            ? 'Click the canvas to add a course checkpoint.'
            : coursePlacementMode === 'finish'
              ? 'Click the canvas to place the course finish marker.'
              : '',
    summaryText: draft ? getCourseGoalSummaryText(draft) : 'Open this room from the course builder.',
    placeStartHidden: !activeGoal,
    placeStartActive: coursePlacementMode === 'start',
    placeExitHidden: activeGoal?.type !== 'reach_exit',
    placeExitActive: coursePlacementMode === 'exit',
    addCheckpointHidden: activeGoal?.type !== 'checkpoint_sprint',
    addCheckpointActive: coursePlacementMode === 'checkpoint',
    placeFinishHidden: activeGoal?.type !== 'checkpoint_sprint',
    placeFinishActive: coursePlacementMode === 'finish',
    canEditPreviousRoom,
    canEditNextRoom,
  };
}

export function cloneCourseDraftForMutation(draft: CourseSnapshot): CourseSnapshot {
  return cloneCourseSnapshot(draft);
}

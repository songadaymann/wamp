import {
  cloneCourseSnapshot,
  courseGoalRequiresStartPoint,
  type CourseRoomRef,
  type CourseSnapshot,
} from '../../courses/model';
import type { RoomCoordinates, RoomSnapshot } from '../../persistence/roomRepository';
import type { CourseEditedRoomData, OverworldPlaySceneData } from '../sceneData';
import { getEditorDraftFingerprint } from './clearCheck';

export function getSelectedCoursePreviewForPlay(
  draft: CourseSnapshot | null,
  activeRoomId: string,
): CourseSnapshot | null {
  if (!draft?.goal) {
    return null;
  }

  if (courseGoalRequiresStartPoint(draft.goal) && !draft.startPoint) {
    return null;
  }

  if (!draft.roomRefs.some((roomRef) => roomRef.roomId === activeRoomId)) {
    return null;
  }

  if (draft.goal.type === 'reach_exit' && !draft.goal.exit) {
    return null;
  }

  if (
    draft.goal.type === 'checkpoint_sprint' &&
    (!draft.goal.finish || draft.goal.checkpoints.length === 0)
  ) {
    return null;
  }

  return cloneCourseSnapshot(draft);
}

export interface BuildEditorPlayModeDataOptions {
  roomCoordinates: RoomCoordinates;
  roomSnapshot: RoomSnapshot;
  usePublishedCourseRoomVersion: boolean;
  coursePreview: CourseSnapshot | null;
  courseEditedRoom: CourseEditedRoomData | null;
  practiceStart?: { x: number; y: number };
}

export function buildEditorPlayModeData(
  options: BuildEditorPlayModeDataOptions,
): OverworldPlaySceneData {
  const {
    roomCoordinates,
    roomSnapshot,
    usePublishedCourseRoomVersion,
    coursePreview,
    courseEditedRoom,
  } = options;
  const startRoomRef = getCoursePreviewStartRoomRef(coursePreview, roomSnapshot);
  const standalone = !coursePreview && !courseEditedRoom;
  const usePublished = usePublishedCourseRoomVersion && !standalone;
  const testedRoom = options.practiceStart && standalone ? { ...roomSnapshot, spawnPoint: { ...options.practiceStart } } : roomSnapshot;
  const playCoordinates = startRoomRef?.coordinates ?? roomCoordinates;
  return {
    centerCoordinates: { ...playCoordinates },
    roomCoordinates: { ...playCoordinates },
    draftRoom: usePublished ? null : testedRoom,
    publishedRoom: usePublished ? roomSnapshot : null,
    invalidateRoomId: roomSnapshot.id,
    forceRefreshAround: usePublished,
    courseDraftPreviewId: coursePreview?.id ?? null,
    courseEditedRoom,
    editorPlaytestReturnTarget: {
      roomCoordinates: { ...roomCoordinates },
      ...(standalone ? { clearCheck: { roomId: roomSnapshot.id, fingerprint: getEditorDraftFingerprint(roomSnapshot), eligible: !options.practiceStart } } : {}),
    },
    statusMessage: coursePreview ? 'Testing draft course.' : null,
    mode: 'play',
  };
}

function getCoursePreviewStartRoomRef(
  coursePreview: CourseSnapshot | null,
  roomSnapshot: RoomSnapshot,
): CourseRoomRef | null {
  if (!coursePreview) {
    return null;
  }

  if (coursePreview.startPoint) {
    const startRoomRef = coursePreview.roomRefs.find(
      (roomRef) => roomRef.roomId === coursePreview.startPoint?.roomId,
    );
    if (startRoomRef) {
      return startRoomRef;
    }
  }

  const currentRoomRef = coursePreview.roomRefs.find(
    (roomRef) => roomRef.roomId === roomSnapshot.id,
  );
  if (currentRoomRef && roomSnapshot.spawnPoint) {
    return currentRoomRef;
  }

  return coursePreview.roomRefs[0] ?? null;
}

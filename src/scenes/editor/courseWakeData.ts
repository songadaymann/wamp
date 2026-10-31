import type { CourseEditedRoomData, CourseEditorSceneData, OverworldPlaySceneData } from '../sceneData';

export function courseEditorWakeData(
  wakeData: OverworldPlaySceneData,
  roomCoordinates: { x: number; y: number },
  courseEdit: CourseEditedRoomData | null,
): CourseEditorSceneData {
  return {
    courseId: courseEdit?.courseId ?? null,
    selectedCoordinates: { ...roomCoordinates },
    centerCoordinates: { ...(wakeData.centerCoordinates ?? roomCoordinates) },
    statusMessage: wakeData.statusMessage ?? null,
    courseEditedRoom: courseEdit,
    draftRoom: wakeData.draftRoom ?? null,
    publishedRoom: wakeData.publishedRoom ?? null,
    clearDraftRoomId: wakeData.clearDraftRoomId ?? null,
    invalidateRoomId: wakeData.invalidateRoomId ?? null,
  };
}

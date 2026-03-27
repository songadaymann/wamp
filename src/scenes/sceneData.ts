import type { RoomCoordinates, RoomSnapshot } from '../persistence/roomModel';

export interface EditorCourseEditData {
  courseId: string;
  roomId: string;
}

export interface CourseEditedRoomData {
  courseId: string;
  roomId: string;
}

export interface CourseComposerReturnTarget {
  courseId: string | null;
  selectedCoordinates: RoomCoordinates;
  centerCoordinates: RoomCoordinates;
}

export interface EditorSceneData {
  roomCoordinates?: RoomCoordinates;
  source?: 'world' | 'direct';
  roomSnapshot?: RoomSnapshot | null;
  courseEdit?: EditorCourseEditData | null;
}

export interface CourseComposerSceneData {
  selectedCoordinates?: RoomCoordinates;
  centerCoordinates?: RoomCoordinates;
  courseId?: string | null;
  statusMessage?: string | null;
  courseEditedRoom?: CourseEditedRoomData | null;
  draftRoom?: RoomSnapshot | null;
  publishedRoom?: RoomSnapshot | null;
  clearDraftRoomId?: string | null;
  invalidateRoomId?: string | null;
}

export interface CourseEditorSceneData {
  courseId?: string | null;
  selectedRoomId?: string | null;
  selectedCoordinates?: RoomCoordinates;
  centerCoordinates?: RoomCoordinates;
  statusMessage?: string | null;
  courseEditedRoom?: CourseEditedRoomData | null;
  draftRoom?: RoomSnapshot | null;
  publishedRoom?: RoomSnapshot | null;
  clearDraftRoomId?: string | null;
  invalidateRoomId?: string | null;
}

export type OverworldMode = 'browse' | 'play';

export interface OverworldPlaySceneData {
  centerCoordinates?: RoomCoordinates;
  roomCoordinates?: RoomCoordinates;
  draftRoom?: RoomSnapshot | null;
  publishedRoom?: RoomSnapshot | null;
  clearDraftRoomId?: string | null;
  invalidateRoomId?: string | null;
  forceRefreshAround?: boolean;
  mode?: OverworldMode;
  statusMessage?: string | null;
  courseEditorReturned?: boolean;
  courseDraftPreviewId?: string | null;
  courseEditedRoom?: CourseEditedRoomData | null;
  courseEditorReturnTarget?: CourseComposerReturnTarget | null;
}

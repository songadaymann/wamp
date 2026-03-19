import type { RoomCoordinates, RoomSnapshot } from '../persistence/roomModel';

export interface EditorCourseEditData {
  courseId: string;
  roomId: string;
  roomOrder: number | null;
}

export interface CourseEditedRoomData {
  courseId: string;
  roomId: string;
  roomOrder: number | null;
}

export interface EditorSceneData {
  roomCoordinates?: RoomCoordinates;
  source?: 'world' | 'direct';
  roomSnapshot?: RoomSnapshot | null;
  courseEdit?: EditorCourseEditData | null;
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
  courseEditorNavigateOffset?: -1 | 1 | null;
}

import type { RoomCoordinates, RoomSnapshot } from '../persistence/roomModel';

export interface EditorSceneData {
  roomCoordinates?: RoomCoordinates;
  source?: 'world' | 'direct';
  roomSnapshot?: RoomSnapshot | null;
}

export type OverworldMode = 'browse' | 'play';

export interface OverworldPlaySceneData {
  centerCoordinates?: RoomCoordinates;
  roomCoordinates?: RoomCoordinates;
  draftRoom?: RoomSnapshot | null;
  clearDraftRoomId?: string | null;
  mode?: OverworldMode;
  statusMessage?: string | null;
}

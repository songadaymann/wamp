import type { RoomCoordinates } from '../../persistence/roomModel';

export const ROOM_SEQUENCE_START_EVENT = 'room-sequence-start';

export type RoomSequenceMode = 'play' | 'rate';
export type RoomSequenceKind = 'explore' | 'playlist' | 'welcome' | 'build-prompt';

export interface RoomSequenceEntry {
  buildPrompt?: { slug: string; targetKey: string; offset: number };
  roomId: string;
  roomCoordinates: RoomCoordinates;
  roomVersion: number;
  roomTitle?: string | null;
  expandedRoomId?: string | null;
  expandedRoomVersion?: number | null;
  expandedRoomCellCount?: number | null;
  legacyCourseId?: string | null;
}

export interface RoomSequenceStartDetail {
  mode: RoomSequenceMode;
  kind: RoomSequenceKind;
  entries: RoomSequenceEntry[];
  sourceLabel: string;
  kickerLabel: string;
  forceGoalIntro?: boolean;
  showDesktopControlsIntro?: boolean;
}

export function requestRoomSequenceStart(detail: RoomSequenceStartDetail): void {
  window.dispatchEvent(
    new CustomEvent<RoomSequenceStartDetail>(ROOM_SEQUENCE_START_EVENT, {
      detail,
    }),
  );
}

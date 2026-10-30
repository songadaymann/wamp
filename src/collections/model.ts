import type { RoomCoordinates } from '../persistence/roomModel';

export interface CollectionPerson {
  userId: string | null;
  displayName: string;
}
export interface RoomCollector extends CollectionPerson {
  walletAddress: string;
  cellCount: number;
}
export interface CollectionAttribution {
  targetId: string;
  cellCount: number;
  collectors: RoomCollector[];
  /** Last recorded ownership is display data, never edit authorization. */
  ownerSyncedAt: string | null;
}
export interface CollectedRoom {
  roomId: string;
  roomVersion: number;
  roomCoordinates: RoomCoordinates;
  roomTitle: string | null;
  builder: CollectionPerson;
  expandedRoomTitle: string | null;
  ownerSyncedAt: string | null;
  viewerUrl: string | null;
}
export interface CollectionShelfResponse {
  results: CollectedRoom[];
  nextCursor?: string;
}

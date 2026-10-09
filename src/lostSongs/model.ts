import type { PlacedObject } from '../config/objects';

export const LOST_SONG_OBJECT_ID = 'lost_song';
export const LOST_SONG_XP = 5;
export const LOST_SONG_DAILY_XP_LIMIT = 10;

/** Expanded Rooms keep this rule per physical cell, like terrain and object limits. */
export function getLostSongPlacementError(objects: readonly Pick<PlacedObject, 'id' | 'containedObjectId' | 'layer'>[]): string | null {
  if (objects.some(object => object.id === LOST_SONG_OBJECT_ID && (object.layer ?? 'terrain') !== 'terrain')) {
    return 'Lost Song uses the main solid layer so explorers can pick it up.';
  }
  if (objects.some(object => object.containedObjectId === LOST_SONG_OBJECT_ID)) {
    return 'Place Lost Song directly in the room; it cannot be stored inside a container.';
  }
  return objects.filter(object => object.id === LOST_SONG_OBJECT_ID).length > 1
    ? 'Only one Lost Song can be hidden in each room cell.' : null;
}

export interface LostSongTarget {
  roomId: string;
  roomVersion: number;
  expandedRoomId?: string | null;
  expandedRoomVersion?: number | null;
}
export interface LostSongPlaySession {
  id: string;
  token: string;
  expiresAt: string;
}
export interface LostSongFindReceipt {
  roomId: string;
  foundAt: string;
  xp: number;
}
export interface LostSongProgress {
  roomIds: string[];
  total: number;
}
export interface LostSongSample {
  atMs: number;
  x: number;
  y: number;
}
export interface LostSongFindBody {
  sessionId: string;
  token: string;
  samples: LostSongSample[];
}

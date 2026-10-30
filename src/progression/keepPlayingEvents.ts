import type { RoomCoordinates } from '../persistence/roomModel';
import type { RoomDifficulty } from '../runs/model';

export const KEEP_PLAYING_CLEAR_EVENT = 'wamp:keep-playing-clear';
export const KEEP_PLAYING_RESET_EVENT = 'wamp:keep-playing-reset';
export const KEEP_PLAYING_REQUEST_EVENT = 'wamp:keep-playing-request';
export interface KeepPlayingClear {
  contentId: string;
  roomCoordinates: RoomCoordinates;
  difficulty: RoomDifficulty | null;
}
export function notifyKeepPlayingClear(detail: KeepPlayingClear): void {
  if(typeof window !== 'undefined')window.dispatchEvent(new CustomEvent(KEEP_PLAYING_CLEAR_EVENT,{detail}));
}
export function requestKeepPlaying(): void {
  window.dispatchEvent(new Event(KEEP_PLAYING_REQUEST_EVENT));
}

export function resetKeepPlayingContext(): void {
  if(typeof window !== 'undefined')window.dispatchEvent(new Event(KEEP_PLAYING_RESET_EVENT));
}

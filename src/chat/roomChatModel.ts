import type { RoomCoordinates } from '../persistence/roomModel';

export const ROOM_CHAT_MESSAGE_MAX_LENGTH = 140;
export const ROOM_CHAT_MESSAGE_LIFETIME_MS = 6_000;
export const ROOM_CHAT_SEND_RATE_LIMIT_MS = 1_000;
export const ROOM_CHAT_BUBBLE_MAX_WIDTH = 220;

export type RoomChatTransportChannel = 'presence' | 'room-chat';

export interface RoomChatMessageRecord {
  id: string;
  shardId: string;
  userId: string;
  displayName: string;
  avatarId: string;
  roomCoordinates: RoomCoordinates;
  roomId: string;
  text: string;
  createdAt: number;
  expiresAt: number;
}

export interface RoomChatBroadcastMessage {
  type: 'room-chat:message';
  message: RoomChatMessageRecord;
}

export interface RoomChatSayMessage {
  type: 'room-chat:say';
  text: string;
}

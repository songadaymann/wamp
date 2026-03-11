export const CHAT_MESSAGE_MAX_LENGTH = 140;
export const DEFAULT_CHAT_MESSAGE_LIMIT = 50;
export const MAX_CHAT_MESSAGE_LIMIT = 100;

export interface ChatMessageRecord {
  id: string;
  userId: string;
  userDisplayName: string;
  body: string;
  createdAt: string;
}

export interface ChatMessageListResponse {
  messages: ChatMessageRecord[];
}

export interface ChatMessageCreateRequestBody {
  text: string;
}

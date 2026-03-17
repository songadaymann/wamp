export const CHAT_MESSAGE_MAX_LENGTH = 140;
export const DEFAULT_CHAT_MESSAGE_LIMIT = 50;
export const MAX_CHAT_MESSAGE_LIMIT = 100;

export type ChatModerationRole = 'none' | 'admin' | 'owner';

export interface ChatModerationViewer {
  role: ChatModerationRole;
  banned: boolean;
}

export interface ChatMessageRecord {
  id: string;
  userId: string;
  userDisplayName: string;
  body: string;
  createdAt: string;
}

export interface ChatMessageListResponse {
  messages: ChatMessageRecord[];
  viewer: ChatModerationViewer;
}

export interface ChatMessageCreateRequestBody {
  text: string;
}

export interface ChatModerationUserRecord {
  userId: string;
  displayName: string;
  createdAt: string;
  grantedByUserId: string | null;
  grantedByDisplayName: string | null;
}

export interface ChatBanRecord {
  userId: string;
  displayName: string;
  createdAt: string;
  bannedByUserId: string | null;
  bannedByDisplayName: string | null;
}

export interface ChatAdminListResponse {
  admins: ChatModerationUserRecord[];
  viewer: ChatModerationViewer;
}

export interface ChatBanListResponse {
  bans: ChatBanRecord[];
  viewer: ChatModerationViewer;
}

export interface ChatAdminCreateRequestBody {
  displayName: string;
}

export interface ChatBanCreateRequestBody {
  userId: string;
}

export interface ChatMessageDeleteResponse {
  ok: true;
  messageId: string;
  viewer: ChatModerationViewer;
}

export interface ChatAdminMutationResponse {
  ok: true;
  userId: string;
  viewer: ChatModerationViewer;
}

export interface ChatBanMutationResponse {
  ok: true;
  userId: string;
  viewer: ChatModerationViewer;
}

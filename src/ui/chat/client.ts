import type {
  ChatAdminCreateRequestBody,
  ChatAdminListResponse,
  ChatAdminMutationResponse,
  ChatBanCreateRequestBody,
  ChatBanListResponse,
  ChatBanMutationResponse,
  ChatMentionUserListResponse,
  ChatMessageCreateRequestBody,
  ChatMessageDeleteResponse,
  ChatMessageListResponse,
  ChatMessageRecord,
} from '../../chat/model';
import { apiRequest } from '../../api/request';

export async function fetchChatMessages(options: {
  limit?: number;
  after?: string | null;
} = {}): Promise<ChatMessageListResponse> {
  const params = new URLSearchParams();
  if (options.limit) {
    params.set('limit', String(options.limit));
  }
  if (options.after) {
    params.set('after', options.after);
  }

  const query = params.toString();
  return apiRequest<ChatMessageListResponse>(`/api/chat/messages${query ? `?${query}` : ''}`);
}

export async function sendChatMessage(text: string): Promise<ChatMessageRecord> {
  const body: ChatMessageCreateRequestBody = { text };
  return apiRequest<ChatMessageRecord>('/api/chat/messages', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function fetchChatMentionUsers(query: string): Promise<ChatMentionUserListResponse> {
  const params = new URLSearchParams();
  if (query.trim()) {
    params.set('q', query.trim());
  }

  const suffix = params.toString();
  return apiRequest<ChatMentionUserListResponse>(
    `/api/chat/mention-users${suffix ? `?${suffix}` : ''}`
  );
}

export async function deleteChatMessage(messageId: string): Promise<ChatMessageDeleteResponse> {
  return apiRequest<ChatMessageDeleteResponse>(`/api/chat/messages/${encodeURIComponent(messageId)}`, {
    method: 'DELETE',
  });
}

export async function fetchChatAdmins(): Promise<ChatAdminListResponse> {
  return apiRequest<ChatAdminListResponse>('/api/chat/moderation/admins');
}

export async function grantChatAdmin(displayName: string): Promise<ChatAdminMutationResponse> {
  const body: ChatAdminCreateRequestBody = { displayName };
  return apiRequest<ChatAdminMutationResponse>('/api/chat/moderation/admins', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function revokeChatAdmin(userId: string): Promise<ChatAdminMutationResponse> {
  return apiRequest<ChatAdminMutationResponse>(
    `/api/chat/moderation/admins/${encodeURIComponent(userId)}`,
    {
      method: 'DELETE',
    }
  );
}

export async function fetchChatBans(): Promise<ChatBanListResponse> {
  return apiRequest<ChatBanListResponse>('/api/chat/moderation/bans');
}

export async function banChatUser(userId: string): Promise<ChatBanMutationResponse> {
  const body: ChatBanCreateRequestBody = { userId };
  return apiRequest<ChatBanMutationResponse>('/api/chat/moderation/bans', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function unbanChatUser(userId: string): Promise<ChatBanMutationResponse> {
  return apiRequest<ChatBanMutationResponse>(
    `/api/chat/moderation/bans/${encodeURIComponent(userId)}`,
    {
      method: 'DELETE',
    }
  );
}

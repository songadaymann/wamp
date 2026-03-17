import type {
  ChatAdminCreateRequestBody,
  ChatAdminListResponse,
  ChatAdminMutationResponse,
  ChatBanCreateRequestBody,
  ChatBanListResponse,
  ChatBanMutationResponse,
  ChatMessageCreateRequestBody,
  ChatMessageDeleteResponse,
  ChatMessageListResponse,
  ChatMessageRecord,
} from '../../chat/model';
import { getApiBaseUrl } from '../../api/baseUrl';

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

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}.`);
  }

  return (await response.json()) as T;
}

import type {
  ChatMessageCreateRequestBody,
  ChatMessageListResponse,
  ChatMessageRecord,
} from '../../chat/model';

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

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, {
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

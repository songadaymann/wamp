import type {
  ChatMessageCreateRequestBody,
  ChatMessageListResponse,
} from '../../../chat/model';
import {
  CHAT_MESSAGE_MAX_LENGTH,
  DEFAULT_CHAT_MESSAGE_LIMIT,
  MAX_CHAT_MESSAGE_LIMIT,
} from '../../../chat/model';
import { requireCurrentSession } from '../auth/request';
import {
  HttpError,
  jsonResponse,
  normalizeIsoTimestamp,
  parseJsonBody,
  parsePositiveIntegerQueryParam,
} from '../core/http';
import type { Env } from '../core/types';
import {
  createChatMessage,
  listChatMessages,
  loadLatestChatMessageForUser,
} from './store';

const CHAT_RATE_LIMIT_WINDOW_MS = 1000;

export async function handleChatRequest(
  request: Request,
  url: URL,
  env: Env
): Promise<Response> {
  if (url.pathname === '/api/chat/messages' && request.method === 'GET') {
    return handleListChatMessages(request, url, env);
  }

  if (url.pathname === '/api/chat/messages' && request.method === 'POST') {
    return handleCreateChatMessage(request, env);
  }

  throw new HttpError(404, 'Chat route not found.');
}

export async function handleListChatMessages(
  request: Request,
  url: URL,
  env: Env
): Promise<Response> {
  const limit = parsePositiveIntegerQueryParam(
    url.searchParams,
    'limit',
    DEFAULT_CHAT_MESSAGE_LIMIT,
    1,
    MAX_CHAT_MESSAGE_LIMIT
  );
  const afterParam = url.searchParams.get('after');
  const after = parseAfterTimestamp(afterParam);
  const responseBody: ChatMessageListResponse = {
    messages: await listChatMessages(env, limit, after),
  };

  return jsonResponse(request, responseBody);
}

export async function handleCreateChatMessage(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await requireCurrentSession(env, request, 'send chat messages');
  const body = await parseJsonBody<ChatMessageCreateRequestBody>(request);
  const text = normalizeChatMessageText(body.text);
  const latestMessage = await loadLatestChatMessageForUser(env, session.user.id);
  const nowMs = Date.now();

  if (latestMessage) {
    const lastMessageMs = Date.parse(latestMessage.createdAt);
    if (Number.isFinite(lastMessageMs) && nowMs - lastMessageMs < CHAT_RATE_LIMIT_WINDOW_MS) {
      throw new HttpError(429, 'You are sending messages too quickly.');
    }
  }

  const message = await createChatMessage(
    env,
    session.user.id,
    session.user.displayName,
    text,
    new Date(nowMs).toISOString()
  );

  return jsonResponse(request, message, { status: 201 });
}

function normalizeChatMessageText(value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'text is required.');
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new HttpError(400, 'Message text cannot be empty.');
  }

  if (trimmed.length > CHAT_MESSAGE_MAX_LENGTH) {
    throw new HttpError(400, `Message text must be ${CHAT_MESSAGE_MAX_LENGTH} characters or fewer.`);
  }

  return trimmed;
}

function parseAfterTimestamp(value: string | null): string | null {
  if (value === null || value.trim() === '') {
    return null;
  }

  const normalized = normalizeIsoTimestamp(value);
  if (!normalized) {
    throw new HttpError(400, 'after must be a valid ISO timestamp.');
  }

  return normalized;
}

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
} from '../../../chat/model';
import {
  CHAT_MESSAGE_MAX_LENGTH,
  DEFAULT_CHAT_MESSAGE_LIMIT,
  MAX_CHAT_MESSAGE_LIMIT,
} from '../../../chat/model';
import { loadCurrentSession, requireCurrentSession } from '../auth/request';
import { findUserByDisplayName } from '../auth/store';
import {
  HttpError,
  jsonResponse,
  normalizeIsoTimestamp,
  parseJsonBody,
  parsePositiveIntegerQueryParam,
} from '../core/http';
import type { Env } from '../core/types';
import {
  assertViewerCanModerateTarget,
  NO_CHAT_MODERATION_VIEWER,
  loadChatModerationTarget,
  requireChatModeratorSession,
  requireChatOwnerSession,
  resolveChatModerationViewer,
} from './moderation';
import {
  createChatAdmin,
  createChatBan,
  createChatMessage,
  deleteChatAdmin,
  deleteChatBan,
  listChatAdmins,
  listChatBans,
  listChatMessages,
  loadChatAdminRecord,
  loadChatBanRecord,
  loadChatMessageById,
  loadLatestChatMessageForUser,
  softDeleteChatMessage,
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

  const deleteMessageMatch = /^\/api\/chat\/messages\/([^/]+)$/.exec(url.pathname);
  if (deleteMessageMatch && request.method === 'DELETE') {
    return handleDeleteChatMessage(request, env, decodeURIComponent(deleteMessageMatch[1]));
  }

  if (url.pathname === '/api/chat/moderation/admins' && request.method === 'GET') {
    return handleListChatAdmins(request, env);
  }

  if (url.pathname === '/api/chat/moderation/admins' && request.method === 'POST') {
    return handleCreateChatAdmin(request, env);
  }

  const deleteAdminMatch = /^\/api\/chat\/moderation\/admins\/([^/]+)$/.exec(url.pathname);
  if (deleteAdminMatch && request.method === 'DELETE') {
    return handleDeleteChatAdmin(request, env, decodeURIComponent(deleteAdminMatch[1]));
  }

  if (url.pathname === '/api/chat/moderation/bans' && request.method === 'GET') {
    return handleListChatBans(request, env);
  }

  if (url.pathname === '/api/chat/moderation/bans' && request.method === 'POST') {
    return handleCreateChatBan(request, env);
  }

  const deleteBanMatch = /^\/api\/chat\/moderation\/bans\/([^/]+)$/.exec(url.pathname);
  if (deleteBanMatch && request.method === 'DELETE') {
    return handleDeleteChatBan(request, env, decodeURIComponent(deleteBanMatch[1]));
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
    viewer: await loadChatViewerFromRequest(env, request),
  };

  return jsonResponse(request, responseBody);
}

export async function handleCreateChatMessage(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await requireCurrentSession(env, request, 'send chat messages');
  const viewer = await resolveChatModerationViewer(env, session.user);
  if (viewer.banned) {
    throw new HttpError(403, 'You are banned from chat.');
  }

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

async function handleDeleteChatMessage(
  request: Request,
  env: Env,
  messageId: string
): Promise<Response> {
  const { session, viewer } = await requireChatModeratorSession(env, request, 'delete chat messages');
  const message = await loadChatMessageById(env, messageId);
  if (!message) {
    throw new HttpError(404, 'Chat message not found.');
  }

  const target = await loadChatModerationTarget(env, message.userId);
  assertViewerCanModerateTarget({
    viewer,
    viewerUserId: session.user.id,
    targetUserId: target.user.id,
    targetViewer: target.viewer,
    actionLabel: 'delete chat messages from',
  });

  await softDeleteChatMessage(env, messageId, session.user.id, new Date().toISOString());

  const responseBody: ChatMessageDeleteResponse = {
    ok: true,
    messageId,
    viewer,
  };
  return jsonResponse(request, responseBody);
}

async function handleListChatAdmins(request: Request, env: Env): Promise<Response> {
  const { viewer } = await requireChatOwnerSession(env, request, 'view chat admins');
  const responseBody: ChatAdminListResponse = {
    admins: await listChatAdmins(env),
    viewer,
  };
  return jsonResponse(request, responseBody);
}

async function handleCreateChatAdmin(request: Request, env: Env): Promise<Response> {
  const { session, viewer } = await requireChatOwnerSession(env, request, 'grant chat admin access');
  const body = await parseJsonBody<ChatAdminCreateRequestBody>(request);
  const displayName = normalizeDisplayName(body.displayName);
  if (!displayName) {
    throw new HttpError(400, 'displayName is required.');
  }

  const user = await findUserByDisplayName(env, displayName);
  if (!user) {
    throw new HttpError(404, 'User not found for that display name.');
  }

  if (user.id === session.user.id) {
    throw new HttpError(403, 'You cannot grant chat admin access to yourself.');
  }

  const targetViewer = await resolveChatModerationViewer(env, user);
  if (targetViewer.role === 'owner') {
    throw new HttpError(400, 'That user is already a chat owner.');
  }
  if (targetViewer.role === 'admin') {
    throw new HttpError(409, 'That user is already a chat admin.');
  }
  if (targetViewer.banned) {
    throw new HttpError(409, 'Unban that user before promoting them to chat admin.');
  }

  await createChatAdmin(env, user.id, session.user.id, new Date().toISOString());

  const responseBody: ChatAdminMutationResponse = {
    ok: true,
    userId: user.id,
    viewer,
  };
  return jsonResponse(request, responseBody, { status: 201 });
}

async function handleDeleteChatAdmin(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  const { session, viewer } = await requireChatOwnerSession(env, request, 'revoke chat admin access');
  if (userId === session.user.id) {
    throw new HttpError(403, 'You cannot revoke your own chat access.');
  }

  const existing = await loadChatAdminRecord(env, userId);
  if (!existing) {
    throw new HttpError(404, 'Chat admin not found.');
  }

  const target = await loadChatModerationTarget(env, userId);
  assertViewerCanModerateTarget({
    viewer,
    viewerUserId: session.user.id,
    targetUserId: target.user.id,
    targetViewer: target.viewer,
    actionLabel: 'revoke chat admin access for',
  });

  await deleteChatAdmin(env, userId);

  const responseBody: ChatAdminMutationResponse = {
    ok: true,
    userId,
    viewer,
  };
  return jsonResponse(request, responseBody);
}

async function handleListChatBans(request: Request, env: Env): Promise<Response> {
  const { viewer } = await requireChatModeratorSession(env, request, 'view chat bans');
  const responseBody: ChatBanListResponse = {
    bans: await listChatBans(env),
    viewer,
  };
  return jsonResponse(request, responseBody);
}

async function handleCreateChatBan(request: Request, env: Env): Promise<Response> {
  const { session, viewer } = await requireChatModeratorSession(env, request, 'ban chat users');
  const body = await parseJsonBody<ChatBanCreateRequestBody>(request);
  const userId = normalizeUserId(body.userId);
  const target = await loadChatModerationTarget(env, userId);
  assertViewerCanModerateTarget({
    viewer,
    viewerUserId: session.user.id,
    targetUserId: target.user.id,
    targetViewer: target.viewer,
    actionLabel: 'ban',
  });

  const existing = await loadChatBanRecord(env, userId);
  if (existing) {
    throw new HttpError(409, 'That user is already banned from chat.');
  }

  await createChatBan(env, userId, session.user.id, new Date().toISOString());

  const responseBody: ChatBanMutationResponse = {
    ok: true,
    userId,
    viewer,
  };
  return jsonResponse(request, responseBody, { status: 201 });
}

async function handleDeleteChatBan(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  const { session, viewer } = await requireChatModeratorSession(env, request, 'unban chat users');
  const existing = await loadChatBanRecord(env, userId);
  if (!existing) {
    throw new HttpError(404, 'Chat ban not found.');
  }

  const target = await loadChatModerationTarget(env, userId);
  assertViewerCanModerateTarget({
    viewer,
    viewerUserId: session.user.id,
    targetUserId: target.user.id,
    targetViewer: target.viewer,
    actionLabel: 'unban',
  });

  await deleteChatBan(env, userId);

  const responseBody: ChatBanMutationResponse = {
    ok: true,
    userId,
    viewer,
  };
  return jsonResponse(request, responseBody);
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

function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed || null;
}

function normalizeUserId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, 'userId is required.');
  }

  return value.trim();
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

async function loadChatViewerFromRequest(env: Env, request: Request) {
  const session = await loadCurrentSession(env, request);
  if (!session) {
    return NO_CHAT_MODERATION_VIEWER;
  }

  return resolveChatModerationViewer(env, session.user);
}

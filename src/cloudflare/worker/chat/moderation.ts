import type { AuthUser } from '../../../auth/model';
import type { ChatModerationRole, ChatModerationViewer } from '../../../chat/model';
import { loadCurrentSession } from '../auth/request';
import { findUserById, normalizeEmail } from '../auth/store';
import { HttpError } from '../core/http';
import type { AuthSession, Env } from '../core/types';
import { isChatAdminUser, isChatBannedUser } from './store';

export const NO_CHAT_MODERATION_VIEWER: ChatModerationViewer = {
  role: 'none',
  banned: false,
};

export async function resolveChatModerationViewer(
  env: Env,
  user: AuthUser | null
): Promise<ChatModerationViewer> {
  if (!user) {
    return NO_CHAT_MODERATION_VIEWER;
  }

  const role = await resolveChatModerationRole(env, user);
  return {
    role,
    banned: role === 'none' ? await isChatBannedUser(env, user.id) : false,
  };
}

export async function resolveChatModerationRole(
  env: Env,
  user: AuthUser | null
): Promise<ChatModerationRole> {
  if (!user) {
    return 'none';
  }

  const normalizedEmail = user.email ? normalizeEmail(user.email) : null;
  if (normalizedEmail && getChatOwnerEmailSet(env).has(normalizedEmail)) {
    return 'owner';
  }

  return (await isChatAdminUser(env, user.id)) ? 'admin' : 'none';
}

export async function requireChatModeratorSession(
  env: Env,
  request: Request,
  actionLabel: string
): Promise<{ session: AuthSession; viewer: ChatModerationViewer }> {
  const session = await loadCurrentSession(env, request);
  if (!session) {
    throw new HttpError(401, `You must be signed in to ${actionLabel}.`);
  }

  const viewer = await resolveChatModerationViewer(env, session.user);
  if (viewer.role === 'none') {
    throw new HttpError(403, `You do not have permission to ${actionLabel}.`);
  }

  if (viewer.banned) {
    throw new HttpError(403, 'You are banned from chat moderation actions.');
  }

  return { session, viewer };
}

export async function requireChatOwnerSession(
  env: Env,
  request: Request,
  actionLabel: string
): Promise<{ session: AuthSession; viewer: ChatModerationViewer }> {
  const { session, viewer } = await requireChatModeratorSession(env, request, actionLabel);
  if (viewer.role !== 'owner') {
    throw new HttpError(403, `Only chat owners can ${actionLabel}.`);
  }

  return { session, viewer };
}

export async function loadChatModerationTarget(
  env: Env,
  userId: string
): Promise<{ user: AuthUser; viewer: ChatModerationViewer }> {
  const user = await findUserById(env, userId);
  if (!user) {
    throw new HttpError(404, 'User not found.');
  }

  return {
    user,
    viewer: await resolveChatModerationViewer(env, user),
  };
}

export function assertViewerCanModerateTarget(options: {
  viewer: ChatModerationViewer;
  viewerUserId: string;
  targetUserId: string;
  targetViewer: ChatModerationViewer;
  actionLabel: string;
}): void {
  const { viewer, viewerUserId, targetUserId, targetViewer, actionLabel } = options;

  if (viewerUserId === targetUserId) {
    throw new HttpError(403, `You cannot ${actionLabel} your own account.`);
  }

  if (viewer.role === 'owner') {
    if (targetViewer.role === 'owner') {
      throw new HttpError(403, `You cannot ${actionLabel} another chat owner.`);
    }
    return;
  }

  if (viewer.role === 'admin') {
    if (targetViewer.role !== 'none') {
      throw new HttpError(403, `Chat admins cannot ${actionLabel} other moderators.`);
    }
    return;
  }

  throw new HttpError(403, `You do not have permission to ${actionLabel}.`);
}

function getChatOwnerEmailSet(env: Env): Set<string> {
  const configured = env.CHAT_OWNER_EMAILS?.trim();
  if (!configured) {
    return new Set<string>();
  }

  return new Set(
    configured
      .split(',')
      .map((email) => normalizeEmail(email))
      .filter(Boolean)
  );
}

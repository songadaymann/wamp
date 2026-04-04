import type { UserProfileUpdateRequestBody, UserProfileUpdateResponse } from '../../../profiles/model';
import { HttpError, jsonResponse, parseJsonBody } from '../core/http';
import type { Env } from '../core/types';
import { findUserByDisplayName, updateUserProfile } from '../auth/store';
import { loadOptionalRequestAuth, requireAuthenticatedRequestAuth } from '../auth/request';
import { assertPlayfunOnlyDisplayNameChangeAllowed } from '../playfun/leaderboardIsolation';
import { loadUserProfile } from './store';

const MAX_PROFILE_BIO_LENGTH = 280;
const MAX_AVATAR_URL_LENGTH = 500;

export async function handleProfileGet(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  const auth = await loadOptionalRequestAuth(env, request);
  const profile = await loadUserProfile(env, userId, auth?.user.id ?? null);
  if (!profile) {
    throw new HttpError(404, 'Profile not found.');
  }

  return jsonResponse(request, profile);
}

export async function handleProfileUpdateMe(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(env, request, 'update your profile');
  const body = await parseProfileUpdateBody(request);

  await assertPlayfunOnlyDisplayNameChangeAllowed(env, auth.user, body.displayName);

  const existingUser = await findUserByDisplayName(env, body.displayName);
  if (existingUser && existingUser.id !== auth.user.id) {
    throw new HttpError(409, 'That display name has already been claimed.');
  }

  const updatedUser = await updateUserProfile(env, auth.user, body);
  const profile = await loadUserProfile(env, auth.user.id, auth.user.id);
  if (!profile) {
    throw new HttpError(500, 'Profile update succeeded but reload failed.');
  }

  const responseBody: UserProfileUpdateResponse = {
    ok: true,
    user: updatedUser,
    profile,
  };

  return jsonResponse(request, responseBody);
}

async function parseProfileUpdateBody(request: Request): Promise<UserProfileUpdateRequestBody> {
  const body = await parseJsonBody<Partial<UserProfileUpdateRequestBody>>(request);
  const displayName = normalizeDisplayName(body.displayName);
  if (!displayName) {
    throw new HttpError(400, 'Display name is required.');
  }

  if (displayName.length > 24) {
    throw new HttpError(400, 'Display name must be 24 characters or fewer.');
  }

  const avatarUrl = normalizeAvatarUrl(body.avatarUrl);
  const bio = normalizeBio(body.bio);

  return {
    displayName,
    avatarUrl,
    bio,
  };
}

function normalizeDisplayName(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.replace(/\s+/g, ' ').trim();
}

function normalizeAvatarUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  if (normalized.length > MAX_AVATAR_URL_LENGTH) {
    throw new HttpError(400, 'Avatar URL must be 500 characters or fewer.');
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new HttpError(400, 'Avatar URL must be a valid absolute URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new HttpError(400, 'Avatar URL must use http or https.');
  }

  return parsed.toString();
}

function normalizeBio(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return null;
  }

  if (normalized.length > MAX_PROFILE_BIO_LENGTH) {
    throw new HttpError(400, `Bio must be ${MAX_PROFILE_BIO_LENGTH} characters or fewer.`);
  }

  return normalized;
}

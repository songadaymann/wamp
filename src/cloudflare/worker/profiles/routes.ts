import type { UserProfileUpdateRequestBody, UserProfileUpdateResponse } from '../../../profiles/model';
import {
  normalizeProfileUsername,
  validateProfileUsername,
} from '../../../profiles/username';
import {
  CRYPTOPUNK_AVATAR_UNLOCK_PLAYER_LEVEL,
  CRYPTOPUNK_UNLOCK_OVERRIDE_HEADER,
  parseCryptopunkAvatarId,
} from '../../../avatars/model';
import { getRegisteredPlayerAvatarPack } from '../../../player/avatar/registry';
import {
  getPlayerAvatarUnlockLevel,
  isPlayerAvatarUnlockedForLevel,
} from '../../../player/avatar/unlocks';
import { HttpError, jsonResponse, parseJsonBody } from '../core/http';
import { ServerTiming, timedJsonResponse } from '../core/serverTiming';
import type { Env, WorkerExecutionContextLike } from '../core/types';
import { loadAnonymousPublicCache } from '../core/publicCache';
import { findUserByDisplayName, findUserById, findUserByUsername, updateUserProfile } from '../auth/store';
import { loadOptionalRequestAuth, requireAuthenticatedRequestAuth } from '../auth/request';
import { assertGeneratedOnlyDisplayNameChangeAllowed } from '../generatedUsers/leaderboardIsolation';
import { assertNotSchoolRestricted } from '../school/restrictions';
import { loadPublicProgressionSummary } from '../progression/store';
import { loadCryptopunkAvatarPackRow } from '../avatars/store';
import {
  loadUserProfile,
  loadUserProfilePlaylists,
  loadUserProfileRoomsPage,
  loadUserProfileSummary,
} from './store';

const MAX_PROFILE_BIO_LENGTH = 280;
const MAX_AVATAR_URL_LENGTH = 500;

export async function handleProfileGet(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  const timing = new ServerTiming();
  const auth = await timing.measure('auth', () => loadOptionalRequestAuth(env, request));
  const profile = await loadUserProfile(env, userId, auth?.user.id ?? null, timing);
  if (!profile) {
    throw new HttpError(404, 'Profile not found.');
  }

  return timedJsonResponse(request, profile, timing, profileCacheInit(auth !== null));
}

export async function handleProfileSummaryGet(
  request: Request, env: Env, userId: string, context?: WorkerExecutionContextLike,
): Promise<Response> {
  const timing = new ServerTiming();
  const auth = await timing.measure('auth', () => loadOptionalRequestAuth(env, request));
  const loadResponse = async () => {
    const profile = await loadUserProfileSummary(env, userId, auth?.user.id ?? null, timing);
    if (!profile) throw new HttpError(404, 'Profile not found.');
    timing.setDiagnostic('cache', auth ? 'private' : 'public-20');
    return timedJsonResponse(request, profile, timing, profileCacheInit(auth !== null));
  };
  return loadAnonymousPublicCache(request, auth ? undefined : context, loadResponse);
}

export async function handleProfileRoomsGet(
  request: Request, url: URL, env: Env, userId: string, context?: WorkerExecutionContextLike,
): Promise<Response> {
  const timing = new ServerTiming();
  const auth = await timing.measure('auth', () => loadOptionalRequestAuth(env, request));
  const limit = parseBoundedInteger(url.searchParams.get('limit'), 24, 1, 100);
  const loadResponse = async () => {
    const response = await loadUserProfileRoomsPage(env, userId, limit, url.searchParams.get('cursor'), timing);
    timing.setDiagnostic('cache', auth ? 'private' : 'public-20');
    return timedJsonResponse(request, response, timing, profileCacheInit(auth !== null));
  };
  return loadAnonymousPublicCache(request, auth ? undefined : context, loadResponse);
}

export async function handleProfilePlaylistsGet(
  request: Request, env: Env, userId: string, context?: WorkerExecutionContextLike,
): Promise<Response> {
  const timing = new ServerTiming();
  const auth = await timing.measure('auth', () => loadOptionalRequestAuth(env, request));
  const loadResponse = async () => {
    if (!await findUserById(env, userId)) throw new HttpError(404, 'Profile not found.');
    const response = await loadUserProfilePlaylists(env, userId, timing);
    timing.setDiagnostic('cache', auth ? 'private' : 'public-20');
    return timedJsonResponse(request, response, timing, profileCacheInit(auth !== null));
  };
  return loadAnonymousPublicCache(request, auth ? undefined : context, loadResponse);
}

function profileCacheInit(authenticated: boolean): ResponseInit {
  return { headers: { 'Cache-Control': authenticated ? 'private, no-store' : 'public, max-age=20' } };
}

function parseBoundedInteger(value: string | null, fallback: number, min: number, max: number): number {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new HttpError(400, `limit must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

export async function handleProfileGetByUsername(
  request: Request,
  env: Env,
  username: string
): Promise<Response> {
  const normalizedUsername = normalizeProfileUsername(username);
  const validationMessage = validateProfileUsername(normalizedUsername);
  if (validationMessage) {
    throw new HttpError(400, validationMessage);
  }

  const user = await findUserByUsername(env, normalizedUsername);
  if (!user) {
    throw new HttpError(404, 'Profile not found.');
  }

  return handleProfileGet(request, env, user.id);
}

export async function handleProfileUpdateMe(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(env, request, 'update your profile');
  assertNotSchoolRestricted(auth, 'edit profile text');
  const body = await parseProfileUpdateBody(request);

  await assertGeneratedOnlyDisplayNameChangeAllowed(env, auth.user, body.displayName);

  const existingUser = await findUserByDisplayName(env, body.displayName);
  if (existingUser && existingUser.id !== auth.user.id) {
    throw new HttpError(409, 'That display name has already been claimed.');
  }

  if (body.username !== undefined) {
    const existingUsernameUser = await findUserByUsername(env, body.username ?? '');
    if (existingUsernameUser && existingUsernameUser.id !== auth.user.id) {
      throw new HttpError(409, 'That username has already been claimed.');
    }
  }

  const selectedAvatarId = await validateSelectedAvatarUpdate(
    request,
    env,
    auth.user.id,
    body.selectedAvatarId,
  );
  const updatedUser = await updateUserProfile(env, auth.user, {
    ...body,
    ...(selectedAvatarId !== undefined ? { selectedAvatarId } : {}),
  });
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
  const username = normalizeOptionalUsername(body.username);
  const selectedAvatarId = normalizeSelectedAvatarId(body.selectedAvatarId);

  return {
    displayName,
    ...(username !== undefined ? { username } : {}),
    avatarUrl,
    bio,
    ...(selectedAvatarId !== undefined ? { selectedAvatarId } : {}),
  };
}

function normalizeOptionalUsername(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    throw new HttpError(400, 'Username is required.');
  }

  const username = normalizeProfileUsername(value);
  const validationMessage = validateProfileUsername(username);
  if (validationMessage) {
    throw new HttpError(400, validationMessage);
  }

  return username;
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

function normalizeSelectedAvatarId(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new HttpError(400, 'Selected avatar id must be a string.');
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

async function validateSelectedAvatarUpdate(
  request: Request,
  env: Env,
  userId: string,
  selectedAvatarId: string | null | undefined
): Promise<string | null | undefined> {
  if (selectedAvatarId === undefined || selectedAvatarId === null) {
    return selectedAvatarId;
  }

  const cryptopunkId = parseCryptopunkAvatarId(selectedAvatarId);
  if (cryptopunkId !== null) {
    const progression = await loadPublicProgressionSummary(env, userId);
    const playerLevel = getEffectiveCryptopunkViewerLevel(request, env, progression.player.level);
    if (!isPlayerAvatarUnlockedForLevel(selectedAvatarId, playerLevel)) {
      throw new HttpError(
        403,
        `CryptoPunk avatars unlock at Player LVL ${CRYPTOPUNK_AVATAR_UNLOCK_PLAYER_LEVEL}.`
      );
    }

    const row = await loadCryptopunkAvatarPackRow(env, cryptopunkId);
    if (!row || row.status !== 'ready') {
      throw new HttpError(409, 'That CryptoPunk avatar is not generated yet.');
    }

    return selectedAvatarId;
  }

  const pack = getRegisteredPlayerAvatarPack(selectedAvatarId);
  if (!pack) {
    throw new HttpError(400, 'Selected avatar is not registered.');
  }

  const progression = await loadPublicProgressionSummary(env, userId);
  const playerLevel = pack.kind === 'cryptopunk'
    ? getEffectiveCryptopunkViewerLevel(request, env, progression.player.level)
    : progression.player.level;
  if (isPlayerAvatarUnlockedForLevel(selectedAvatarId, playerLevel)) {
    return selectedAvatarId;
  }

  const unlockLevel = getPlayerAvatarUnlockLevel(selectedAvatarId);
  if (unlockLevel) {
    throw new HttpError(403, `That avatar unlocks at Player LVL ${unlockLevel}.`);
  }
  throw new HttpError(403, 'That avatar is not unlockable yet.');
}

function getEffectiveCryptopunkViewerLevel(
  request: Request,
  env: Env,
  playerLevel: number,
): number {
  if (!isCryptopunkUnlockOverrideEnabled(request, env)) {
    return playerLevel;
  }
  return Math.max(playerLevel, CRYPTOPUNK_AVATAR_UNLOCK_PLAYER_LEVEL);
}

function isCryptopunkUnlockOverrideEnabled(request: Request, env: Env): boolean {
  if (request.headers.get(CRYPTOPUNK_UNLOCK_OVERRIDE_HEADER) !== '1') {
    return false;
  }
  if (env.ENABLE_TEST_RESET !== '1') {
    return false;
  }

  const hostname = new URL(request.url).hostname.trim().toLowerCase();
  return (
    hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname === 'everybodys-platformer-safety.novox-robot.workers.dev'
  );
}

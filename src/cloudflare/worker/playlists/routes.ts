import type {
  RoomPlaylistCreateRequestBody,
  RoomPlaylistItemCreateRequestBody,
  RoomPlaylistUpdateRequestBody,
} from '../../../playlists/model';
import {
  normalizePlaylistSlug,
  validatePlaylistSlug,
} from '../../../playlists/model';
import { requireAuthenticatedRequestAuth, loadOptionalRequestAuth } from '../auth/request';
import { assertNotSchoolRestricted } from '../school/restrictions';
import { HttpError, jsonResponse, parseJsonBody } from '../core/http';
import { loadAnonymousPublicCache } from '../core/publicCache';
import {
  hashRateLimitKey,
  releaseRateLimitSlots,
  takeRateLimitSlots,
  type RateLimitRule,
  type RateLimitSlotUse,
} from '../core/rateLimit';
import type { Env, WorkerExecutionContextLike } from '../core/types';
import {
  addRoomToPlaylist,
  createRoomPlaylist,
  deleteRoomPlaylist,
  loadMyPlaylistSummaries,
  loadPlaylistBySlug,
  removeRoomFromPlaylist,
  updateRoomPlaylist,
} from './store';

const HOUR_MS = 60 * 60 * 1000;
/** Per account. Writes are making, renaming and adding rooms; deleting is never limited. */
const PLAYLIST_CREATES_PER_HOUR: RateLimitRule = { bucket: 'playlist:create-hour', limit: 20, windowMs: HOUR_MS };
const PLAYLIST_WRITES_PER_HOUR: RateLimitRule = { bucket: 'playlist:write-hour', limit: 300, windowMs: HOUR_MS };
/** A signed-out view is the same for everyone, so it is kept briefly at the edge like profile lists. */
const ANONYMOUS_PLAYLIST_CACHE_CONTROL = 'public, max-age=20';

export async function handlePlaylistGetBySlug(
  request: Request,
  env: Env,
  slug: string,
  context?: WorkerExecutionContextLike,
): Promise<Response> {
  const normalizedSlug = normalizePlaylistSlug(slug);
  const validationMessage = validatePlaylistSlug(normalizedSlug);
  if (validationMessage) {
    throw new HttpError(400, validationMessage);
  }

  // Credentials are checked before any shared copy is served.
  const auth = await loadOptionalRequestAuth(env, request);
  const loadResponse = async () => {
    const playlist = await loadPlaylistBySlug(env, normalizedSlug, auth?.user.id ?? null);
    if (!playlist) {
      throw new HttpError(404, 'Playlist not found.');
    }
    const response = jsonResponse(request, playlist, {
      headers: { 'Cache-Control': auth ? 'private, no-store' : ANONYMOUS_PLAYLIST_CACHE_CONTROL },
    });
    // A browser must not answer a signed-in request with a signed-out copy.
    if (!auth) response.headers.append('Vary', 'Cookie, Authorization');
    return response;
  };
  if (auth) return loadResponse();
  // One shared copy per playlist path: a query string cannot add copies.
  const cacheUrl = new URL(request.url);
  cacheUrl.search = '';
  return loadAnonymousPublicCache(new Request(cacheUrl, request), context, loadResponse);
}

export async function handleMyPlaylistsGet(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'load your playlists',
    'rooms:read',
  );
  const playlists = await loadMyPlaylistSummaries(env, auth.user.id);
  return jsonResponse(request, { playlists });
}

export async function handlePlaylistCreate(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'create playlists',
    'rooms:write',
  );
  assertNotSchoolRestricted(auth, 'create playlists');
  const body = await parseJsonBody<Partial<RoomPlaylistCreateRequestBody>>(request);
  const playlist = await withPlaylistWriteSlots(env, auth.user.id, [PLAYLIST_CREATES_PER_HOUR, PLAYLIST_WRITES_PER_HOUR],
    (slotUse) => createRoomPlaylist(env, auth.user, body, slotUse));
  return jsonResponse(request, playlist, { status: 201 });
}

export async function handlePlaylistUpdate(
  request: Request,
  env: Env,
  playlistId: string,
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'update playlists',
    'rooms:write',
  );
  assertNotSchoolRestricted(auth, 'update playlists');
  const body = await parseJsonBody<Partial<RoomPlaylistUpdateRequestBody>>(request);
  const playlist = await withPlaylistWriteSlots(env, auth.user.id, [PLAYLIST_WRITES_PER_HOUR],
    (slotUse) => updateRoomPlaylist(env, auth.user, playlistId, body, slotUse));
  return jsonResponse(request, playlist);
}

export async function handlePlaylistDelete(
  request: Request,
  env: Env,
  playlistId: string,
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'delete playlists',
    'rooms:write',
  );
  await deleteRoomPlaylist(env, auth.user.id, playlistId);
  return jsonResponse(request, { ok: true });
}

export async function handlePlaylistItemCreate(
  request: Request,
  env: Env,
  playlistId: string,
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'add rooms to playlists',
    'rooms:write',
  );
  assertNotSchoolRestricted(auth, 'add rooms to playlists');
  const body = await parseJsonBody<Partial<RoomPlaylistItemCreateRequestBody>>(request);
  const playlist = await withPlaylistWriteSlots(env, auth.user.id, [PLAYLIST_WRITES_PER_HOUR],
    (slotUse) => addRoomToPlaylist(env, auth.user, playlistId, body, slotUse));
  return jsonResponse(request, playlist, { status: 201 });
}

export async function handlePlaylistItemDelete(
  request: Request,
  env: Env,
  playlistId: string,
  itemId: string,
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'remove rooms from playlists',
    'rooms:write',
  );
  const playlist = await removeRoomFromPlaylist(env, auth.user.id, playlistId, itemId);
  return jsonResponse(request, playlist);
}

/**
 * Takes a slot under each rule for the account. They are given back when the change is refused or
 * its write fails, and kept once the write has stored something, even if a later step fails.
 */
async function withPlaylistWriteSlots<T>(
  env: Env,
  userId: string,
  rules: RateLimitRule[],
  write: (slotUse: RateLimitSlotUse) => Promise<T>,
): Promise<T> {
  const keyHash = await hashRateLimitKey(env, `playlist-user:${userId}`);
  const { ids, limitedBy } = await takeRateLimitSlots(env, rules.map((rule) => ({ rule, keyHash })));
  if (limitedBy === PLAYLIST_CREATES_PER_HOUR) {
    throw new HttpError(429, 'You have made a lot of playlists lately. Try again later.');
  }
  if (limitedBy) {
    throw new HttpError(429, 'You have changed your playlists a lot lately. Try again later.');
  }
  const slotUse: RateLimitSlotUse = { keep: false };
  try {
    return await write(slotUse);
  } catch (error) {
    if (!slotUse.keep) await releaseRateLimitSlots(env, ids);
    throw error;
  }
}

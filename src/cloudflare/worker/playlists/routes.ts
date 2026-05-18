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
import { HttpError, jsonResponse, parseJsonBody } from '../core/http';
import type { Env } from '../core/types';
import {
  addRoomToPlaylist,
  createRoomPlaylist,
  deleteRoomPlaylist,
  loadMyPlaylistSummaries,
  loadPlaylistBySlug,
  removeRoomFromPlaylist,
  updateRoomPlaylist,
} from './store';

export async function handlePlaylistGetBySlug(
  request: Request,
  env: Env,
  slug: string,
): Promise<Response> {
  const normalizedSlug = normalizePlaylistSlug(slug);
  const validationMessage = validatePlaylistSlug(normalizedSlug);
  if (validationMessage) {
    throw new HttpError(400, validationMessage);
  }

  const auth = await loadOptionalRequestAuth(env, request);
  const playlist = await loadPlaylistBySlug(env, normalizedSlug, auth?.user.id ?? null);
  if (!playlist) {
    throw new HttpError(404, 'Playlist not found.');
  }

  return jsonResponse(request, playlist);
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
  const body = await parseJsonBody<Partial<RoomPlaylistCreateRequestBody>>(request);
  const playlist = await createRoomPlaylist(env, auth.user, body);
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
  const body = await parseJsonBody<Partial<RoomPlaylistUpdateRequestBody>>(request);
  const playlist = await updateRoomPlaylist(env, auth.user, playlistId, body);
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
  const body = await parseJsonBody<Partial<RoomPlaylistItemCreateRequestBody>>(request);
  const playlist = await addRoomToPlaylist(env, auth.user, playlistId, body);
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

import { parsePlaylistSharePath } from '../playlists/model';
import { parseProfileSharePath } from '../profiles/username';
import { parseWampOGramSharePath } from '../wampOGram/links';
import type { PagesWorkerEnv } from './model';
import {
  loadPlaylistMetadata,
  loadProfileMetadata,
  loadRoomMetadata,
  loadWampOGramMetadata,
  type RoomCoordinates,
} from './shareMetadata';
import {
  renderPlaylistAppShell,
  renderProfileAppShell,
  renderRoomAppShell,
  renderWampOGramAppShell,
} from './shareAppShell';

const ROOM_PATH_PATTERN = /^\/r\/(-?\d+)\/(-?\d+)\/?$/;
const ROOM_IMAGE_PATH_PATTERN = /^\/r\/(-?\d+)\/(-?\d+)\/image(?:\.png)?\/?$/;

export function parseRoomImageCoordinates(pathname: string): RoomCoordinates | null {
  return parseRoomPath(pathname, ROOM_IMAGE_PATH_PATTERN);
}

export async function handleSharePageRequest(
  request: Request,
  env: PagesWorkerEnv,
  url: URL,
): Promise<Response | null> {
  const coordinates = parseRoomPath(url.pathname) ?? parseRoomQuery(url);
  if (coordinates) {
    const methodResponse = rejectUnsupportedMethod(request);
    if (methodResponse) return methodResponse;

    const metadata = await loadRoomMetadata(request, env, url, coordinates);
    return renderRoomAppShell(request, env, metadata);
  }

  const playlistSlug = parsePlaylistSharePath(url.pathname);
  if (playlistSlug) {
    const methodResponse = rejectUnsupportedMethod(request);
    if (methodResponse) return methodResponse;

    const metadata = await loadPlaylistMetadata(request, env, url, playlistSlug);
    return renderPlaylistAppShell(request, env, metadata);
  }

  const wampOGramSlug = parseWampOGramSharePath(url.pathname);
  if (wampOGramSlug) {
    const methodResponse = rejectUnsupportedMethod(request);
    if (methodResponse) return methodResponse;

    const metadata = await loadWampOGramMetadata(request, env, url, wampOGramSlug);
    return renderWampOGramAppShell(request, env, metadata);
  }

  const profileUsername = parseProfileSharePath(url.pathname);
  if (!profileUsername) return null;

  const methodResponse = rejectUnsupportedMethod(request);
  if (methodResponse) return methodResponse;

  const metadata = await loadProfileMetadata(request, env, url, profileUsername);
  return renderProfileAppShell(request, env, metadata);
}

function parseRoomPath(
  pathname: string,
  pattern: RegExp = ROOM_PATH_PATTERN,
): RoomCoordinates | null {
  const match = pattern.exec(pathname);
  if (!match) return null;

  return {
    x: Number.parseInt(match[1], 10),
    y: Number.parseInt(match[2], 10),
  };
}

function parseRoomQuery(url: URL): RoomCoordinates | null {
  if (url.pathname !== '/' && url.pathname !== '/index.html') return null;

  const x = parseStrictInteger(url.searchParams.get('x'));
  const y = parseStrictInteger(url.searchParams.get('y'));
  if (x === null || y === null) return null;

  return { x, y };
}

function parseStrictInteger(value: string | null): number | null {
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) return null;

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function rejectUnsupportedMethod(request: Request): Response | null {
  if (request.method === 'GET' || request.method === 'HEAD') return null;

  return new Response('Method Not Allowed', {
    status: 405,
    headers: { Allow: 'GET, HEAD' },
  });
}

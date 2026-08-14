import { buildPlaylistSharePath } from '../playlists/model';
import { buildProfileSharePath } from '../profiles/username';
import { buildWampOGramSharePath } from '../wampOGram/links';
import type { PagesWorkerEnv } from './model';

const DEFAULT_API_BASE_URL = 'https://api.wamp.land';
const ROOM_META_TIMEOUT_MS = 1200;
const PROFILE_META_TIMEOUT_MS = 1200;
const WAMP_O_GRAM_META_TIMEOUT_MS = 1200;
const ROOM_IMAGE_RENDERER_VERSION = 'assets-v5';
export const ROOM_SHARE_IMAGE_WIDTH = 1200;
export const ROOM_SHARE_IMAGE_HEIGHT = 630;

export interface RoomCoordinates {
  x: number;
  y: number;
}

export interface ShareMetadata {
  title: string;
  description: string;
  url: string;
  imageUrl: string;
  imageWidth?: number;
  imageHeight?: number;
}

export interface PublishedRoomSnapshot {
  title?: unknown;
  version?: number;
  [key: string]: unknown;
}

export interface RoomShareMetadata extends ShareMetadata {
  imageWidth: number;
  imageHeight: number;
}

interface ProfileMetadataInput {
  displayName?: unknown;
  username?: unknown;
  bio?: unknown;
  stats?: {
    totalRoomsPublished?: unknown;
  } | null;
  avatarUrl?: unknown;
}

interface PlaylistMetadataInput {
  title?: unknown;
  ownerDisplayName?: unknown;
  description?: unknown;
  roomCount?: unknown;
  items?: unknown[] | null;
}

interface WampOGramMetadataInput {
  title?: unknown;
  recipientName?: unknown;
  senderName?: unknown;
  creatorDisplayName?: unknown;
  message?: unknown;
}

interface RoomMetadataInput {
  title?: unknown;
  description?: unknown;
  url?: unknown;
  imageUrl?: unknown;
  imageWidth?: number;
  imageHeight?: number;
}

export async function loadRoomMetadata(
  request: Request,
  env: PagesWorkerEnv,
  url: URL,
  coordinates: RoomCoordinates,
): Promise<RoomShareMetadata> {
  const apiBaseUrl = resolveApiBaseUrl(env, url);
  const roomId = `${coordinates.x},${coordinates.y}`;
  const publicUrl = `${url.origin}/r/${coordinates.x}/${coordinates.y}`;
  const fallback = buildFallbackMetadata(coordinates, publicUrl);
  const publishedRoom = await loadPublishedRoomSnapshot(request, env, url, coordinates, ROOM_META_TIMEOUT_MS);
  if (publishedRoom) {
    return buildPublishedRoomMetadata(publishedRoom, fallback, coordinates);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ROOM_META_TIMEOUT_MS);

  try {
    const metaUrl = new URL(`/api/share/rooms/${encodeURIComponent(roomId)}/meta`, apiBaseUrl);
    metaUrl.searchParams.set('x', String(coordinates.x));
    metaUrl.searchParams.set('y', String(coordinates.y));
    metaUrl.searchParams.set('url', publicUrl);
    const response = await fetch(metaUrl.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': request.headers.get('User-Agent') || 'WAMP room share renderer',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      return fallback;
    }

    return {
      ...normalizeMetadata(await response.json(), fallback),
      imageUrl: fallback.imageUrl,
    };
  } catch {
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadProfileMetadata(
  request: Request,
  env: PagesWorkerEnv,
  url: URL,
  username: string,
): Promise<ShareMetadata> {
  const apiBaseUrl = resolveApiBaseUrl(env, url);
  const publicUrl = `${url.origin}${buildProfileSharePath(username)}`;
  const fallback = buildFallbackProfileMetadata(username, publicUrl, url.origin);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROFILE_META_TIMEOUT_MS);

  try {
    const profileUrl = new URL(`/api/profiles/by-username/${encodeURIComponent(username)}`, apiBaseUrl);
    const response = await fetch(profileUrl.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': request.headers.get('User-Agent') || 'WAMP profile share renderer',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      return fallback;
    }

    return buildPublishedProfileMetadata(await response.json(), fallback);
  } catch {
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadPlaylistMetadata(
  request: Request,
  env: PagesWorkerEnv,
  url: URL,
  slug: string,
): Promise<ShareMetadata> {
  const apiBaseUrl = resolveApiBaseUrl(env, url);
  const publicUrl = `${url.origin}${buildPlaylistSharePath(slug)}`;
  const fallback = buildFallbackPlaylistMetadata(slug, publicUrl, url.origin);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROFILE_META_TIMEOUT_MS);

  try {
    const playlistUrl = new URL(`/api/playlists/by-slug/${encodeURIComponent(slug)}`, apiBaseUrl);
    const response = await fetch(playlistUrl.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': request.headers.get('User-Agent') || 'WAMP playlist share renderer',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      return fallback;
    }

    return buildPublishedPlaylistMetadata(await response.json(), fallback);
  } catch {
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}

export function resolveApiBaseUrl(env: PagesWorkerEnv, url: URL): string {
  const configured = typeof env.ROOM_SHARE_API_BASE_URL === 'string'
    ? env.ROOM_SHARE_API_BASE_URL.trim()
    : '';
  if (configured) {
    return configured.replace(/\/+$/, '');
  }

  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    return `${url.protocol}//${url.hostname}:8787`;
  }

  return DEFAULT_API_BASE_URL;
}

function buildFallbackMetadata(
  coordinates: RoomCoordinates,
  publicUrl: string,
): RoomShareMetadata {
  const imageUrl = new URL(`/r/${coordinates.x}/${coordinates.y}/image.png`, publicUrl);

  return {
    title: `WAMP room ${coordinates.x},${coordinates.y}`,
    description: `Play this WAMP room at ${coordinates.x},${coordinates.y}.`,
    url: publicUrl,
    imageUrl: imageUrl.toString(),
    imageWidth: 1200,
    imageHeight: 630,
  };
}

function buildFallbackProfileMetadata(
  username: string,
  publicUrl: string,
  origin: string,
): ShareMetadata {
  return {
    title: `@${username} on WAMP`,
    description: `View @${username}'s WAMP profile, levels, progress, and stats.`,
    url: publicUrl,
    imageUrl: new URL('/favicon.svg', origin).toString(),
  };
}

function buildFallbackPlaylistMetadata(
  slug: string,
  publicUrl: string,
  origin: string,
): ShareMetadata {
  return {
    title: `${slug} - WAMP playlist`,
    description: `Play this WAMP room playlist.`,
    url: publicUrl,
    imageUrl: new URL('/favicon.svg', origin).toString(),
  };
}

function buildFallbackWampOGramMetadata(
  slug: string,
  publicUrl: string,
  apiBaseUrl: string,
): RoomShareMetadata {
  return {
    title: 'Wamp-O-Gram',
    description: 'Open this playable WAMP level postcard.',
    url: publicUrl,
    imageUrl: new URL(`/api/wamp-o-grams/${encodeURIComponent(slug)}/preview.png`, apiBaseUrl).toString(),
    imageWidth: ROOM_SHARE_IMAGE_WIDTH,
    imageHeight: ROOM_SHARE_IMAGE_HEIGHT,
  };
}

function buildPublishedRoomMetadata(
  snapshot: PublishedRoomSnapshot,
  fallback: RoomShareMetadata,
  coordinates: RoomCoordinates,
): RoomShareMetadata {
  const roomTitle = cleanText(snapshot?.title);
  const title = roomTitle
    ? `${roomTitle} - WAMP room ${coordinates.x},${coordinates.y}`
    : fallback.title;

  return {
    ...fallback,
    title,
    description: roomTitle
      ? `Play "${roomTitle}" in WAMP. Can you do better?`
      : fallback.description,
    imageUrl: withRoomVersionQuery(fallback.imageUrl, snapshot?.version),
  };
}

function buildPublishedProfileMetadata(
  profile: ProfileMetadataInput,
  fallback: ShareMetadata,
): ShareMetadata {
  const displayName = cleanText(profile?.displayName) || fallback.title.replace(/ on WAMP$/, '');
  const username = cleanText(profile?.username);
  const bio = cleanText(profile?.bio);
  const totalRooms = Number(profile?.stats?.totalRoomsPublished ?? 0) || 0;
  const roomText = totalRooms === 1 ? '1 published level' : `${totalRooms} published levels`;
  const title = username ? `${displayName} (@${username}) on WAMP` : `${displayName} on WAMP`;
  const description = bio || `${displayName}'s WAMP profile with ${roomText}, progress, and stats.`;
  const avatarUrl = cleanUrl(profile?.avatarUrl);

  return {
    ...fallback,
    title,
    description,
    imageUrl: avatarUrl || fallback.imageUrl,
  };
}

function buildPublishedPlaylistMetadata(
  playlist: PlaylistMetadataInput,
  fallback: ShareMetadata,
): ShareMetadata {
  const title = cleanText(playlist?.title) || fallback.title;
  const owner = cleanText(playlist?.ownerDisplayName);
  const description = cleanText(playlist?.description);
  const roomCount = Number(playlist?.roomCount ?? playlist?.items?.length ?? 0) || 0;
  const roomText = roomCount === 1 ? '1 room' : `${roomCount} rooms`;

  return {
    ...fallback,
    title: `${title} - WAMP playlist`,
    description: description || `${owner ? `${owner}'s ` : ''}WAMP playlist with ${roomText}.`,
  };
}

function buildPublishedWampOGramMetadata(
  record: WampOGramMetadataInput,
  fallback: RoomShareMetadata,
): RoomShareMetadata {
  const title = cleanText(record?.title);
  const recipient = cleanText(record?.recipientName);
  const sender = cleanText(record?.senderName) || cleanText(record?.creatorDisplayName);
  const message = cleanText(record?.message);

  return {
    ...fallback,
    title: title || (recipient ? `A Wamp-O-Gram for ${recipient}` : 'Wamp-O-Gram'),
    description: message || (sender
      ? `${sender} made a playable WAMP level postcard.`
      : fallback.description),
  };
}

export async function loadWampOGramMetadata(
  request: Request,
  env: PagesWorkerEnv,
  url: URL,
  slug: string,
): Promise<RoomShareMetadata> {
  const apiBaseUrl = resolveApiBaseUrl(env, url);
  const publicUrl = `${url.origin}${buildWampOGramSharePath(slug)}`;
  const fallback = buildFallbackWampOGramMetadata(slug, publicUrl, apiBaseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WAMP_O_GRAM_META_TIMEOUT_MS);

  try {
    const gramUrl = new URL(`/api/wamp-o-grams/${encodeURIComponent(slug)}`, apiBaseUrl);
    const response = await fetch(gramUrl.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': request.headers.get('User-Agent') || 'WAMP Wamp-O-Gram share renderer',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      return fallback;
    }

    return buildPublishedWampOGramMetadata(await response.json(), fallback);
  } catch {
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}

function withRoomVersionQuery(imageUrl: string, version: number | undefined): string {
  const url = new URL(imageUrl);
  if (Number.isFinite(version)) {
    url.searchParams.set('v', String(version));
  }
  url.searchParams.set('renderer', ROOM_IMAGE_RENDERER_VERSION);
  return url.toString();
}

export async function loadPublishedRoomSnapshot(
  request: Request,
  env: PagesWorkerEnv,
  url: URL,
  coordinates: RoomCoordinates,
  timeoutMs: number,
): Promise<PublishedRoomSnapshot | null> {
  const apiBaseUrl = resolveApiBaseUrl(env, url);
  const roomId = `${coordinates.x},${coordinates.y}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const roomUrl = new URL(`/api/rooms/${encodeURIComponent(roomId)}/published`, apiBaseUrl);
    roomUrl.searchParams.set('x', String(coordinates.x));
    roomUrl.searchParams.set('y', String(coordinates.y));
    const response = await fetch(roomUrl.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': request.headers.get('User-Agent') || 'WAMP room share renderer',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    return await response.json() as PublishedRoomSnapshot;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeMetadata(
  value: RoomMetadataInput | null,
  fallback: RoomShareMetadata,
): RoomShareMetadata {
  if (!value || typeof value !== 'object') {
    return fallback;
  }

  return {
    title: cleanText(value.title) || fallback.title,
    description: cleanText(value.description) || fallback.description,
    url: cleanUrl(value.url) || fallback.url,
    imageUrl: cleanUrl(value.imageUrl) || fallback.imageUrl,
    imageWidth: finiteNumberOr(value.imageWidth, fallback.imageWidth),
    imageHeight: finiteNumberOr(value.imageHeight, fallback.imageHeight),
  };
}

function finiteNumberOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? (value as number) : fallback;
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function cleanUrl(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

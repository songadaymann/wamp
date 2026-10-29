import { resolveApiBaseUrl } from '../roomImage/environment';
export { resolveApiBaseUrl } from '../roomImage/environment';
import { buildPlaylistSharePath } from '../playlists/model';
import { buildProfileSharePath } from '../profiles/username';
import { buildWampOGramPreviewPath, buildWampOGramSharePath } from '../wampOGram/links';
import type { PagesWorkerEnv } from './model';

const ROOM_META_TIMEOUT_MS = 1200;
const PROFILE_META_TIMEOUT_MS = 1200;
const WAMP_O_GRAM_META_TIMEOUT_MS = 1200;
import { ROOM_SHARE_RENDERER_VERSION as ROOM_IMAGE_RENDERER_VERSION, ROOM_SHARE_IMAGE_WIDTH, ROOM_SHARE_IMAGE_HEIGHT } from '../roomImage/types';

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
  imageWidth?: unknown;
  imageHeight?: unknown;
  roomVersion?: unknown;
  expandedRoom?: unknown;
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ROOM_META_TIMEOUT_MS);
  let metadata: RoomShareMetadata | null = null;

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
    if (response.ok) {
      metadata = normalizeMetadata(await response.json(), fallback, apiBaseUrl, roomId);
    }
  } catch {
    // A published single-cell snapshot can still provide a useful preview during an API outage.
  } finally {
    clearTimeout(timeout);
  }

  if (metadata) return metadata;
  const publishedRoom = await loadPublishedRoomSnapshot(request, env, url, coordinates, ROOM_META_TIMEOUT_MS);
  return publishedRoom ? buildPublishedRoomMetadata(publishedRoom, fallback, coordinates) : fallback;
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
    imageUrl: new URL(buildWampOGramPreviewPath(slug), apiBaseUrl).toString(),
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

/** Community sprites an admin blocked (F189), from the edge-cached world tile config; null if it can't load. */
export async function loadBlockedCustomSpriteIds(
  request: Request,
  env: PagesWorkerEnv,
  url: URL,
  timeoutMs: number,
): Promise<Set<string> | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(new URL('/api/world/tiles/config', resolveApiBaseUrl(env, url)).toString(), {
      headers: { Accept: 'application/json', 'User-Agent': request.headers.get('User-Agent') || 'WAMP room share renderer' },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const config = await response.json() as { blockedCustomSpriteIds?: unknown };
    return new Set(Array.isArray(config.blockedCustomSpriteIds)
      ? config.blockedCustomSpriteIds.filter((id): id is string => typeof id === 'string')
      : []);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeMetadata(
  value: unknown,
  fallback: RoomShareMetadata,
  apiBaseUrl: string,
  roomId: string,
): RoomShareMetadata | null {
  if (!isRoomMetadataInput(value) || (!cleanText(value.title) && !cleanText(value.description))) {
    return null;
  }

  const expandedRoom = value.expandedRoom;
  const expanded = isExpandedRoomMetadata(expandedRoom);
  const version = typeof value.roomVersion === 'number' ? value.roomVersion : undefined;
  const roomImageUrl = version === undefined ? fallback.imageUrl : withRoomVersionQuery(fallback.imageUrl, version);
  return {
    title: cleanText(value.title) || fallback.title,
    description: cleanText(value.description) || fallback.description,
    url: cleanUrl(value.url) || fallback.url,
    imageUrl: cachedArtworkUrl(value.imageUrl, expanded) || (expanded
      ? expandedRoomImageUrl(value.imageUrl, apiBaseUrl, roomId, expandedRoom.expandedRoomId) || roomImageUrl
      : roomImageUrl),
    imageWidth: finiteNumberOr(value.imageWidth, fallback.imageWidth),
    imageHeight: finiteNumberOr(value.imageHeight, fallback.imageHeight),
  };
}

function isRoomMetadataInput(value: unknown): value is RoomMetadataInput {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isExpandedRoomMetadata(value: unknown): value is { expandedRoomId: string; cellCount: number } {
  return value !== null && typeof value === 'object'
    && 'expandedRoomId' in value && Boolean(cleanText(value.expandedRoomId))
    && 'cellCount' in value && typeof value.cellCount === 'number'
    && Number.isSafeInteger(value.cellCount) && value.cellCount > 1;
}

function expandedRoomImageUrl(value: unknown, apiBaseUrl: string, roomId: string, expandedRoomId: string): string | null {
  const imageUrl = cleanUrl(value);
  if (!imageUrl) return null;
  const image = new URL(imageUrl);
  const expected = new URL(`/api/share/rooms/${encodeURIComponent(roomId)}/image`, apiBaseUrl);
  return image.origin === expected.origin && [expected.pathname, `${expected.pathname}.png`].includes(image.pathname)
    && image.searchParams.get('area') === expandedRoomId ? image.toString() : null;
}

function cachedArtworkUrl(value: unknown, expanded: boolean): string | null {
  const candidate = cleanUrl(value);
  if (!candidate) return null;
  const url = new URL(candidate);
  if (url.protocol !== 'https:' || !['tiles.wamp.land', 'tiles-safety.wamp.land'].includes(url.host)
    || url.username || url.password || url.search || url.hash) return null;
  const path = expanded ? /^\/share-artwork\/v1\/[a-f0-9]{64}\.png$/
    : /^\/world-tiles\/[a-zA-Z0-9._-]+\/objects\/[a-f0-9]{64}\.png$/;
  return path.test(url.pathname) ? url.toString() : null;
}

function finiteNumberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
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

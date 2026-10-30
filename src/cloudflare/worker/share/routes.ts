import { ROOM_SHARE_RENDERER_VERSION } from '../../../roomImage/types';
import { buildRoomSharePath } from '../../../social/roomShareLinks';
import type { ResolvedExpandedRoomTarget } from '../../../expandedRooms/model';
import {
  parseRoomId,
  type RoomCoordinates,
  type RoomSnapshot,
} from '../../../persistence/roomModel';
import { resolvePublicBaseUrl } from '../auth/store';
import { corsHeaders, HttpError, isTrustedAppHostname, jsonResponse } from '../core/http';
import type { Env, WorkerExecutionContextLike } from '../core/types';
import { loadAnonymousPublicCache } from '../core/publicCache';
import { resolveExpandedRoomAtCoordinates } from '../expandedRooms/store';
import { loadPublishedRoom, loadRoomSnapshotsByReferences } from '../rooms/store';
import {
  type ExpandedRoomSharePreviewCell,
  ROOM_SHARE_IMAGE_HEIGHT,
  ROOM_SHARE_IMAGE_WIDTH,
  renderExpandedRoomSharePreviewPng,
  renderRoomSharePreviewPng,
} from './imageRenderer';
import { maskBlockedArtInSnapshots } from '../customSprites/blockedArt';
import { loadCachedShareArtwork } from './cachedArtwork';

interface RoomShareMetadata {
  roomId: string;
  coordinates: RoomCoordinates;
  roomVersion: number;
  builderDisplayName: string | null;
  title: string;
  description: string;
  url: string;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  expandedRoom: RoomShareExpandedRoomMetadata | null;
}

interface RoomShareExpandedRoomMetadata {
  expandedRoomId: string;
  expandedRoomVersion: number | null;
  title: string | null;
  source: string;
  legacyCourseId: string | null;
  cellCount: number;
  anchorCoordinates: RoomCoordinates;
  focusedCoordinates: RoomCoordinates;
}

interface RoomShareTarget {
  focusSnapshot: RoomSnapshot;
  builderDisplayName: string | null;
  expandedRoom: ResolvedExpandedRoomTarget | null;
  previewCells: ExpandedRoomSharePreviewCell[];
}

export async function handleRoomShareRequest(
  request: Request,
  url: URL,
  env: Env,
  context?: WorkerExecutionContextLike,
): Promise<Response> {
  const match = /^\/api\/share\/rooms\/([^/]+)(?:\/(meta|image(?:\.png)?))?\/?$/.exec(url.pathname);
  if (!match) {
    throw new HttpError(404, 'Share route not found.');
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    throw new HttpError(405, 'Method not allowed.');
  }

  const roomId = decodeURIComponent(match[1]);
  const coordinates = parseRoomId(roomId);
  if (!coordinates) {
    throw new HttpError(400, 'Room id must use x,y coordinates.');
  }

  const target = match[2] ?? 'page';
  return loadAnonymousPublicCache(request, context, async () => {
    const shareTarget = await loadRoomShareTarget(env, roomId, coordinates);
    if (!shareTarget) throw new HttpError(404, 'Published room not found.');
    if (target === 'page') return roomSharePageRedirect(request, env, coordinates);
    const masked = await maskBlockedShareArt(env, shareTarget);
    // Moderation may have invalidated a leaf since its last render. Use the masked fallback until safe.
    const unchanged = masked.previewCells.every((cell, i) => cell.snapshot === shareTarget.previewCells[i].snapshot);
    const artwork = unchanged ? await loadCachedShareArtwork(env, masked.previewCells, masked.expandedRoom
      ? { id: masked.expandedRoom.expandedRoomId, version: masked.expandedRoom.version ?? null } : null) : null;
    if (target === 'meta') return jsonResponse(request, buildRoomShareMetadata(request, url, env, shareTarget, artwork), {
      headers: { 'Cache-Control': 'public, max-age=20' },
    });
    if (target === 'image' || target === 'image.png') {
      if (artwork && env.WORLD_TILE_BUCKET?.get) {
        try {
          const object = request.method === 'HEAD' ? null : await env.WORLD_TILE_BUCKET.get(artwork.key);
          if (request.method === 'HEAD' || object) return new Response(object ? await object.arrayBuffer() : null, {
            headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600, s-maxage=3600', ...corsHeaders(request) },
          });
        } catch { /* Keep the existing renderer available if R2 is temporarily unavailable. */ }
      }
      return roomShareImageResponse(request, masked, env);
    }
    throw new HttpError(404, 'Share route not found.');
  });
}

async function loadRoomShareTarget(
  env: Env,
  roomId: string,
  coordinates: RoomCoordinates,
): Promise<RoomShareTarget | null> {
  const resolvedRoom = await loadResolvedRoomShareTarget(env, coordinates);
  const expandedRoom = resolvedRoom && resolvedRoom.cellCount > 1 ? resolvedRoom : null;
  const builderDisplayName = resolvedRoom?.ownerDisplayName?.replace(/\s+/g, ' ').trim() || null;
  const focusCell = expandedRoom?.cells.find(
    (cell) => cell.roomId === roomId || coordinatesEqual(cell.coordinates, coordinates),
  ) ?? null;
  if (expandedRoom && focusCell) {
    const previewCells = await loadExpandedRoomSharePreviewCells(env, expandedRoom);
    const focusSnapshot =
      previewCells.find((cell) => coordinatesEqual(cell.coordinates, focusCell.coordinates))?.snapshot
      ?? await loadShareCellSnapshot(env, focusCell.roomId, focusCell.coordinates, focusCell.roomVersion)
      ?? previewCells[0]?.snapshot
      ?? null;
    if (focusSnapshot) {
      return {
        focusSnapshot,
        builderDisplayName,
        expandedRoom,
        previewCells: previewCells.length > 0
          ? previewCells
          : [{ snapshot: focusSnapshot, coordinates: focusCell.coordinates }],
      };
    }
  }

  const focusSnapshot = await loadPublishedRoom(env, roomId, coordinates);
  return focusSnapshot
    ? {
        focusSnapshot,
        builderDisplayName,
        expandedRoom: null,
        previewCells: [{ snapshot: focusSnapshot, coordinates }],
      }
    : null;
}

async function loadResolvedRoomShareTarget(
  env: Env,
  coordinates: RoomCoordinates,
): Promise<ResolvedExpandedRoomTarget | null> {
  if (!isExpandedRoomsEnabled(env)) {
    return null;
  }

  return resolveExpandedRoomAtCoordinates(env, coordinates);
}

async function loadExpandedRoomSharePreviewCells(
  env: Env,
  target: ResolvedExpandedRoomTarget,
): Promise<ExpandedRoomSharePreviewCell[]> {
  const versionedCells = target.cells.flatMap((cell) => {
    const version = normalizeShareRoomVersion(cell.roomVersion);
    return version === null ? [] : [{ cell, version }];
  });
  const response = await loadRoomSnapshotsByReferences(env, versionedCells.map(({ cell, version }) => ({
    kind: 'version' as const,
    roomId: cell.roomId,
    version,
  })));
  if (response.missing.length > 0) {
    const missing = response.missing[0];
    throw new HttpError(409, `Expanded room share cell ${missing.roomId} is missing its pinned version.`);
  }
  const snapshotByKey = new Map(response.snapshots.map((entry) => [entry.key, entry.snapshot]));
  const cells: ExpandedRoomSharePreviewCell[] = [];
  for (const cell of target.cells) {
    const version = normalizeShareRoomVersion(cell.roomVersion);
    const snapshot = version === null
      ? await loadPublishedRoom(env, cell.roomId, cell.coordinates)
      : snapshotByKey.get(`version:${cell.roomId}:${version}`) ?? null;
    if (!snapshot) {
      throw new HttpError(409, `Expanded room share cell ${cell.roomId} is unavailable.`);
    }
    cells.push({
      snapshot,
      coordinates: { ...cell.coordinates },
    });
  }
  return cells;
}

async function loadShareCellSnapshot(
  env: Env,
  roomId: string,
  coordinates: RoomCoordinates,
  roomVersion: number | null | undefined,
): Promise<RoomSnapshot | null> {
  const normalizedVersion = normalizeShareRoomVersion(roomVersion);
  if (normalizedVersion !== null) {
    const response = await loadRoomSnapshotsByReferences(env, [{
      kind: 'version', roomId, version: normalizedVersion,
    }]);
    return response.snapshots[0]?.snapshot ?? null;
  }

  return loadPublishedRoom(env, roomId, coordinates);
}

/** Share images never show a community sprite an admin blocked (F189). */
async function maskBlockedShareArt(env: Env, target: RoomShareTarget): Promise<RoomShareTarget> {
  const [focusSnapshot, ...cellSnapshots] = await maskBlockedArtInSnapshots(
    env,
    [target.focusSnapshot, ...target.previewCells.map((cell) => cell.snapshot)],
  );
  return {
    ...target,
    focusSnapshot,
    previewCells: target.previewCells.map((cell, index) => ({ ...cell, snapshot: cellSnapshots[index] })),
  };
}

async function roomShareImageResponse(request: Request, target: RoomShareTarget, env: Env): Promise<Response> {
  const headers = new Headers({
    'Content-Type': 'image/png',
    // An hour at the edge, so a sprite blocked by moderation leaves cached share images soon (F189).
    'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    ...corsHeaders(request),
  });

  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers });
  }

  const bytes = target.expandedRoom && target.previewCells.length > 1
    ? await renderExpandedRoomSharePreviewPng(target.previewCells, request, env)
    : await renderRoomSharePreviewPng(target.focusSnapshot, request, env);
  const body = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new Response(body, {
    status: 200,
    headers,
  });
}

function roomSharePageRedirect(request: Request, env: Env, coordinates: RoomCoordinates): Response {
  return new Response(null, {
    status: 301,
    headers: {
      Location: new URL(buildRoomSharePath(coordinates), resolveFrontendBaseUrl(request, env)).toString(),
      'Cache-Control': 'public, max-age=20',
      ...corsHeaders(request),
    },
  });
}

function buildRoomShareMetadata(
  request: Request,
  url: URL,
  env: Env,
  target: RoomShareTarget,
  artwork: Awaited<ReturnType<typeof loadCachedShareArtwork>>,
): RoomShareMetadata {
  const snapshot = target.focusSnapshot;
  const expandedRoom = target.expandedRoom;
  const titleText = expandedRoom ? getExpandedRoomDisplayTitle(expandedRoom, snapshot) : getRoomDisplayTitle(snapshot);
  const creditedTitle = target.builderDisplayName ? `${titleText} by ${target.builderDisplayName}` : titleText;
  const publicUrl = resolveRequestedPublicUrl(url)
    ?? new URL(buildRoomSharePath(snapshot.coordinates), resolveFrontendBaseUrl(request, env)).toString();
  const imageUrl = new URL(
    `/api/share/rooms/${encodeURIComponent(snapshot.id)}/image`,
    new URL(request.url).origin,
  );
  imageUrl.searchParams.set('x', String(snapshot.coordinates.x));
  imageUrl.searchParams.set('y', String(snapshot.coordinates.y));
  imageUrl.searchParams.set('v', String(snapshot.version));
  imageUrl.searchParams.set('renderer', ROOM_SHARE_RENDERER_VERSION);
  if (expandedRoom) {
    imageUrl.searchParams.set('area', expandedRoom.expandedRoomId);
    if (typeof expandedRoom.version === 'number') {
      imageUrl.searchParams.set('av', String(expandedRoom.version));
    }
  }

  return {
    roomId: snapshot.id,
    coordinates: { ...snapshot.coordinates },
    roomVersion: snapshot.version,
    builderDisplayName: target.builderDisplayName,
    title: `${creditedTitle} on WAMP`,
    description: expandedRoom
      ? buildExpandedRoomShareDescription(expandedRoom, snapshot, creditedTitle)
      : buildRoomShareDescription(snapshot, creditedTitle),
    url: publicUrl,
    imageUrl: artwork?.url ?? imageUrl.toString(),
    imageWidth: artwork?.width ?? ROOM_SHARE_IMAGE_WIDTH,
    imageHeight: artwork?.height ?? ROOM_SHARE_IMAGE_HEIGHT,
    expandedRoom: expandedRoom ? mapRoomShareExpandedRoomMetadata(expandedRoom, snapshot.coordinates) : null,
  };
}

export function resolveRequestedPublicUrl(url: URL): string | null {
  const candidate = url.searchParams.get('url')?.trim();
  if (!candidate) {
    return null;
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    // Metadata may name WAMP's own public URLs; other hosts fall back to the room URL.
    // The legacy page redirect always uses the canonical room path, independent of this input.
    return isAllowedSharePageHost(parsed.hostname) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function isAllowedSharePageHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return isTrustedAppHostname(host)
    || host.endsWith('.wamp.land')
    || host === 'localhost'
    || host === '127.0.0.1';
}

function resolveFrontendBaseUrl(request: Request, env: Env): string {
  const resolved = resolvePublicBaseUrl(request, env);
  try {
    const url = new URL(resolved);
    if (url.hostname === 'api.wamp.land') {
      return 'https://wamp.land';
    }
    return url.toString();
  } catch {
    return 'https://wamp.land';
  }
}

function getRoomDisplayTitle(snapshot: RoomSnapshot): string {
  const trimmed = snapshot.title?.replace(/\s+/g, ' ').trim();
  if (trimmed) {
    return trimmed;
  }

  return `Room ${snapshot.coordinates.x},${snapshot.coordinates.y}`;
}

function getExpandedRoomDisplayTitle(target: ResolvedExpandedRoomTarget, snapshot: RoomSnapshot): string {
  const trimmed = target.title?.replace(/\s+/g, ' ').trim();
  if (trimmed) {
    return trimmed;
  }
  return getRoomDisplayTitle(snapshot);
}

function buildRoomShareDescription(snapshot: RoomSnapshot, titleText: string): string {
  const goalText = snapshot.goal?.type
    ? ` Beat the ${snapshot.goal.type.replace(/_/g, ' ')} challenge.`
    : '';
  return `${titleText} is a playable WAMP room at ${snapshot.coordinates.x},${snapshot.coordinates.y}.${goalText}`;
}

function buildExpandedRoomShareDescription(
  target: ResolvedExpandedRoomTarget,
  snapshot: RoomSnapshot,
  titleText: string,
): string {
  const goalType = target.goalType ?? snapshot.goal?.type ?? null;
  const goalText = goalType
    ? ` Beat the ${goalType.replace(/_/g, ' ')} challenge.`
    : '';
  const cellText = target.cellCount === 1 ? '1-cell' : `${target.cellCount}-cell`;
  return `${titleText} is a ${cellText} Expanded Room in WAMP.${goalText}`;
}

function mapRoomShareExpandedRoomMetadata(
  target: ResolvedExpandedRoomTarget,
  focusedCoordinates: RoomCoordinates,
): RoomShareExpandedRoomMetadata {
  return {
    expandedRoomId: target.expandedRoomId,
    expandedRoomVersion: target.version,
    title: target.title,
    source: target.source,
    legacyCourseId: target.legacyCourseId,
    cellCount: target.cellCount,
    anchorCoordinates: { ...target.anchorCoordinates },
    focusedCoordinates: { ...focusedCoordinates },
  };
}

function normalizeShareRoomVersion(value: unknown): number | null {
  const version = Number(value);
  return Number.isInteger(version) && version > 0 ? version : null;
}

function coordinatesEqual(left: RoomCoordinates, right: RoomCoordinates): boolean {
  return left.x === right.x && left.y === right.y;
}

function isExpandedRoomsEnabled(env: Env): boolean {
  const raw = env.EXPANDED_ROOMS_ENABLED?.trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'off';
}

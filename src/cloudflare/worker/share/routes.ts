import { buildRoomSharePath } from '../../../social/roomShareLinks';
import type { ResolvedExpandedRoomTarget } from '../../../expandedRooms/model';
import {
  parseRoomId,
  type RoomCoordinates,
  type RoomSnapshot,
} from '../../../persistence/roomModel';
import { resolvePublicBaseUrl } from '../auth/store';
import { corsHeaders, HttpError, jsonResponse } from '../core/http';
import type { Env } from '../core/types';
import { resolveExpandedRoomAtCoordinates } from '../expandedRooms/store';
import { loadPublishedRoom, parseStoredSnapshot } from '../rooms/store';
import {
  type ExpandedRoomSharePreviewCell,
  ROOM_SHARE_IMAGE_HEIGHT,
  ROOM_SHARE_IMAGE_WIDTH,
  renderExpandedRoomSharePreviewPng,
  renderRoomSharePreviewPng,
} from './roomPreviewImage';

interface RoomShareMetadata {
  roomId: string;
  coordinates: RoomCoordinates;
  roomVersion: number;
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
  expandedRoom: ResolvedExpandedRoomTarget | null;
  previewCells: ExpandedRoomSharePreviewCell[];
}

export async function handleRoomShareRequest(
  request: Request,
  url: URL,
  env: Env,
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

  const shareTarget = await loadRoomShareTarget(env, roomId, coordinates);
  if (!shareTarget) {
    throw new HttpError(404, 'Published room not found.');
  }

  const target = match[2] ?? 'page';
  if (target === 'meta') {
    return jsonResponse(request, buildRoomShareMetadata(request, url, env, shareTarget));
  }

  if (target === 'image' || target === 'image.png') {
    return roomShareImageResponse(request, shareTarget);
  }

  return roomSharePageResponse(request, buildRoomShareMetadata(request, url, env, shareTarget));
}

async function loadRoomShareTarget(
  env: Env,
  roomId: string,
  coordinates: RoomCoordinates,
): Promise<RoomShareTarget | null> {
  const expandedRoom = await loadExpandedRoomShareTarget(env, coordinates);
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
        expandedRoom: null,
        previewCells: [{ snapshot: focusSnapshot, coordinates }],
      }
    : null;
}

async function loadExpandedRoomShareTarget(
  env: Env,
  coordinates: RoomCoordinates,
): Promise<ResolvedExpandedRoomTarget | null> {
  if (!isExpandedRoomsEnabled(env)) {
    return null;
  }

  const target = await resolveExpandedRoomAtCoordinates(env, coordinates);
  return target && target.cellCount > 1 ? target : null;
}

async function loadExpandedRoomSharePreviewCells(
  env: Env,
  target: ResolvedExpandedRoomTarget,
): Promise<ExpandedRoomSharePreviewCell[]> {
  const cells: ExpandedRoomSharePreviewCell[] = [];
  for (const cell of target.cells) {
    const snapshot = await loadShareCellSnapshot(env, cell.roomId, cell.coordinates, cell.roomVersion);
    if (!snapshot) {
      continue;
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
    const row = await env.DB.prepare(
      `
        SELECT snapshot_json
        FROM room_versions
        WHERE room_id = ?
          AND version = ?
        LIMIT 1
      `,
    )
      .bind(roomId, normalizedVersion)
      .first<{ snapshot_json: string | null }>();
    if (row?.snapshot_json) {
      return parseStoredSnapshot(row.snapshot_json, 'expanded room share cell');
    }
  }

  return loadPublishedRoom(env, roomId, coordinates);
}

function roomShareImageResponse(request: Request, target: RoomShareTarget): Response {
  const headers = new Headers({
    'Content-Type': 'image/png',
    'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    ...corsHeaders(request),
  });

  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers });
  }

  const bytes = target.expandedRoom && target.previewCells.length > 1
    ? renderExpandedRoomSharePreviewPng(target.previewCells)
    : renderRoomSharePreviewPng(target.focusSnapshot);
  const body = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new Response(body, {
    status: 200,
    headers,
  });
}

function roomSharePageResponse(request: Request, metadata: RoomShareMetadata): Response {
  return new Response(request.method === 'HEAD' ? null : buildRoomShareHtml(metadata), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=60, s-maxage=300',
      ...corsHeaders(request),
    },
  });
}

function buildRoomShareMetadata(
  request: Request,
  url: URL,
  env: Env,
  target: RoomShareTarget,
): RoomShareMetadata {
  const snapshot = target.focusSnapshot;
  const expandedRoom = target.expandedRoom;
  const titleText = expandedRoom ? getExpandedRoomDisplayTitle(expandedRoom, snapshot) : getRoomDisplayTitle(snapshot);
  const publicUrl = resolveRequestedPublicUrl(url)
    ?? new URL(buildRoomSharePath(snapshot.coordinates), resolveFrontendBaseUrl(request, env)).toString();
  const imageUrl = new URL(
    `/api/share/rooms/${encodeURIComponent(snapshot.id)}/image`,
    new URL(request.url).origin,
  );
  imageUrl.searchParams.set('x', String(snapshot.coordinates.x));
  imageUrl.searchParams.set('y', String(snapshot.coordinates.y));
  imageUrl.searchParams.set('v', String(snapshot.version));
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
    title: `${titleText} on WAMP`,
    description: expandedRoom
      ? buildExpandedRoomShareDescription(expandedRoom, snapshot, titleText)
      : buildRoomShareDescription(snapshot, titleText),
    url: publicUrl,
    imageUrl: imageUrl.toString(),
    imageWidth: ROOM_SHARE_IMAGE_WIDTH,
    imageHeight: ROOM_SHARE_IMAGE_HEIGHT,
    expandedRoom: expandedRoom ? mapRoomShareExpandedRoomMetadata(expandedRoom, snapshot.coordinates) : null,
  };
}

function resolveRequestedPublicUrl(url: URL): string | null {
  const candidate = url.searchParams.get('url')?.trim();
  if (!candidate) {
    return null;
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
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
  return `${titleText} is a ${cellText} WAMP room focused at ${snapshot.coordinates.x},${snapshot.coordinates.y}.${goalText}`;
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

function buildRoomShareHtml(metadata: RoomShareMetadata): string {
  const title = escapeHtml(metadata.title);
  const description = escapeHtml(metadata.description);
  const url = escapeHtml(metadata.url);
  const imageUrl = escapeHtml(metadata.imageUrl);

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    `  <title>${title}</title>`,
    '  <meta name="robots" content="index,follow">',
    `  <link rel="canonical" href="${url}">`,
    '  <meta property="og:type" content="website">',
    '  <meta property="og:site_name" content="WAMP">',
    `  <meta property="og:title" content="${title}">`,
    `  <meta property="og:description" content="${description}">`,
    `  <meta property="og:url" content="${url}">`,
    `  <meta property="og:image" content="${imageUrl}">`,
    `  <meta property="og:image:secure_url" content="${imageUrl}">`,
    `  <meta property="og:image:width" content="${metadata.imageWidth}">`,
    `  <meta property="og:image:height" content="${metadata.imageHeight}">`,
    '  <meta name="twitter:card" content="summary_large_image">',
    `  <meta name="twitter:title" content="${title}">`,
    `  <meta name="twitter:description" content="${description}">`,
    `  <meta name="twitter:image" content="${imageUrl}">`,
    '  <style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070b16;color:#f5f1de;font:16px system-ui,sans-serif}a{color:#7fd4ff}</style>',
    '</head>',
    '<body>',
    `  <main><p><a href="${url}">Open this WAMP room</a></p></main>`,
    `  <script>location.replace(${JSON.stringify(metadata.url)});</script>`,
    '</body>',
    '</html>',
  ].join('\n');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

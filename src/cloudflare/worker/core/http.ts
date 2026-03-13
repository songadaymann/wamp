import { cloneRoomSnapshot, parseRoomId, roomIdFromCoordinates, type RoomCoordinates, type RoomSnapshot } from '../../../persistence/roomModel';
import { type WorldChunkBounds } from '../../../persistence/worldModel';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export function noContentResponse(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}

export function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get('Origin');
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Key, X-Playfun-Session-Token',
    'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE,OPTIONS',
  };

  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
    headers.Vary = 'Origin';
  } else {
    headers['Access-Control-Allow-Origin'] = '*';
  }

  return headers;
}

export function jsonResponse(request: Request, body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');

  for (const [key, value] of Object.entries(corsHeaders(request))) {
    headers.set(key, value);
  }

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

export function redirectResponse(location: string, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Location', location);

  return new Response(null, {
    status: 302,
    headers: responseHeaders,
  });
}

export async function parseJsonBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
}

export function normalizeRoomCoordinates(value: unknown): RoomCoordinates {
  if (!value || typeof value !== 'object') {
    throw new HttpError(400, 'roomCoordinates are required.');
  }

  const coordinates = value as Partial<RoomCoordinates>;
  if (!Number.isInteger(coordinates.x) || !Number.isInteger(coordinates.y)) {
    throw new HttpError(400, 'roomCoordinates must be integers.');
  }

  return {
    x: Number(coordinates.x),
    y: Number(coordinates.y),
  };
}

export function normalizePositiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new HttpError(400, `${label} must be a positive integer.`);
  }

  return Number(value);
}

export function normalizeNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new HttpError(400, `${label} must be a number.`);
  }

  const rounded = Math.round(value);
  if (rounded < 0) {
    throw new HttpError(400, `${label} must be zero or greater.`);
  }

  return rounded;
}

export function normalizeIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return new Date(parsed).toISOString();
}

export function parseOptionalPositiveIntegerQueryParam(
  searchParams: URLSearchParams,
  key: string
): number | null {
  const raw = searchParams.get(key);
  if (raw === null || raw.trim() === '') {
    return null;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, `${key} must be a positive integer.`);
  }

  return parsed;
}

export function parsePositiveIntegerQueryParam(
  searchParams: URLSearchParams,
  key: string,
  defaultValue: number,
  min: number,
  max: number
): number {
  const raw = searchParams.get(key);
  if (raw === null || raw.trim() === '') {
    return defaultValue;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new HttpError(400, `${key} must be an integer between ${min} and ${max}.`);
  }

  return parsed;
}

export function getCoordinatesFromRequest(
  roomId: string,
  searchParams: URLSearchParams
): RoomCoordinates {
  const parsedFromId = parseRoomId(roomId);
  const xParam = searchParams.get('x');
  const yParam = searchParams.get('y');

  if (xParam === null || yParam === null) {
    if (parsedFromId) {
      return parsedFromId;
    }

    throw new HttpError(400, 'Room coordinates are required.');
  }

  const x = Number(xParam);
  const y = Number(yParam);

  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    throw new HttpError(400, 'Room coordinates must be integers.');
  }

  const coordinates = { x, y };
  const canonicalRoomId = roomIdFromCoordinates(coordinates);
  if (roomId !== canonicalRoomId) {
    throw new HttpError(400, 'Room id must match coordinates.');
  }

  return coordinates;
}

export function parseIntegerQueryParam(searchParams: URLSearchParams, key: string): number {
  const value = searchParams.get(key);
  const parsed = Number(value);

  if (value === null || !Number.isInteger(parsed)) {
    throw new HttpError(400, `${key} must be an integer.`);
  }

  return parsed;
}

export function parseWorldChunkBounds(searchParams: URLSearchParams): WorldChunkBounds {
  const minChunkX = parseIntegerQueryParam(searchParams, 'minChunkX');
  const maxChunkX = parseIntegerQueryParam(searchParams, 'maxChunkX');
  const minChunkY = parseIntegerQueryParam(searchParams, 'minChunkY');
  const maxChunkY = parseIntegerQueryParam(searchParams, 'maxChunkY');

  if (minChunkX > maxChunkX || minChunkY > maxChunkY) {
    throw new HttpError(400, 'Chunk bounds must be ordered from min to max.');
  }

  const width = maxChunkX - minChunkX + 1;
  const height = maxChunkY - minChunkY + 1;
  if (width > 7 || height > 7) {
    throw new HttpError(400, 'Chunk window must be at most 7x7.');
  }

  return {
    minChunkX,
    maxChunkX,
    minChunkY,
    maxChunkY,
  };
}

export function isRoomSnapshot(value: unknown): value is RoomSnapshot {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const snapshot = value as Partial<RoomSnapshot>;
  return Boolean(
    typeof snapshot.id === 'string' &&
      typeof snapshot.background === 'string' &&
      typeof snapshot.version === 'number' &&
      snapshot.coordinates &&
      typeof snapshot.coordinates.x === 'number' &&
      typeof snapshot.coordinates.y === 'number' &&
      snapshot.tileData &&
      snapshot.placedObjects
  );
}

export async function parseRoomSnapshot(request: Request, roomId: string): Promise<RoomSnapshot> {
  const body = await parseJsonBody<RoomSnapshot>(request);

  if (!isRoomSnapshot(body)) {
    throw new HttpError(400, 'Request body must be a room snapshot.');
  }

  const canonicalRoomId = roomIdFromCoordinates(body.coordinates);
  if (roomId !== canonicalRoomId || body.id !== canonicalRoomId) {
    throw new HttpError(400, 'Room id must match snapshot coordinates.');
  }

  return cloneRoomSnapshot(body);
}

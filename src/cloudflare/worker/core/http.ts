import {
  LAYER_NAMES,
  ROOM_HEIGHT,
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
  ROOM_WIDTH,
  TILE_SIZE,
  getObjectById,
  isTrustedAppHostname,
  type LayerName,
} from '../../../config';
import {
  normalizeCustomSpriteDefinitions,
  parseCustomSpriteObjectId,
} from '../../../customSprites/model';
import { cloneRoomSnapshot, parseRoomId, roomIdFromCoordinates, type RoomCoordinates, type RoomSnapshot } from '../../../persistence/roomModel';
import { type WorldChunkBounds } from '../../../persistence/worldModel';

export { isTrustedAppHostname } from '../../../config';

const MAX_ROOM_SNAPSHOT_BODY_BYTES = 2 * 1024 * 1024;
const PLACED_OBJECT_POSITION_MARGIN_PX = TILE_SIZE * 8;

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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Key, X-Debug-Force-Cryptopunk-Unlock, X-Guest-User-Id, X-Guest-Recovery-Token',
    'Access-Control-Allow-Methods': 'GET,PUT,POST,PATCH,DELETE,OPTIONS',
  };

  if (origin && isTrustedOrigin(origin, request.url)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
    headers.Vary = 'Origin';
  } else {
    headers['Access-Control-Allow-Origin'] = '*';
  }

  return headers;
}

export function isTrustedRequestOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  return !origin || isTrustedOrigin(origin, request.url);
}

export function isTrustedOrigin(origin: string, requestUrl: string): boolean {
  let parsedOrigin: URL;
  let parsedRequestUrl: URL;
  try {
    parsedOrigin = new URL(origin);
    parsedRequestUrl = new URL(requestUrl);
  } catch {
    return false;
  }

  if (parsedOrigin.protocol !== 'https:' && parsedOrigin.protocol !== 'http:') {
    return false;
  }

  if (parsedOrigin.origin === parsedRequestUrl.origin) {
    return true;
  }

  const hostname = parsedOrigin.hostname.toLowerCase();
  if (isLocalDevHostname(hostname)) {
    return true;
  }

  if (isTrustedAppHostname(hostname)) {
    return true;
  }

  return isSafetyWorkerHostname(parsedRequestUrl.hostname.toLowerCase()) && isPrivateDevHostname(hostname);
}

function isLocalDevHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

function isSafetyWorkerHostname(hostname: string): boolean {
  return hostname === 'everybodys-platformer-safety.novox-robot.workers.dev';
}

function isPrivateDevHostname(hostname: string): boolean {
  return (
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)
  );
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

interface ParseJsonBodyOptions {
  maxBytes?: number;
}

export async function parseJsonBody<T>(request: Request, options: ParseJsonBodyOptions = {}): Promise<T> {
  try {
    if (typeof options.maxBytes === 'number') {
      const text = await readRequestBodyTextWithLimit(request, options.maxBytes);
      return JSON.parse(text) as T;
    }

    return (await request.json()) as T;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
}

async function readRequestBodyTextWithLimit(request: Request, maxBytes: number): Promise<string> {
  const contentLength = request.headers.get('Content-Length');
  if (contentLength !== null) {
    const parsedContentLength = Number(contentLength);
    if (!Number.isSafeInteger(parsedContentLength) || parsedContentLength < 0) {
      throw new HttpError(400, 'Content-Length must be a non-negative integer.');
    }
    if (parsedContentLength > maxBytes) {
      throw new HttpError(413, 'Request body is too large.');
    }
  }

  if (!request.body) {
    return '';
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    receivedBytes += value.byteLength;
    if (receivedBytes > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // Continue with the validation error even if stream cancellation fails.
      }
      throw new HttpError(413, 'Request body is too large.');
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(bytes);
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
  if (width > 9 || height > 9) {
    throw new HttpError(400, 'Chunk window must be at most 9x9.');
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
  const body = await parseJsonBody<RoomSnapshot>(request, {
    maxBytes: MAX_ROOM_SNAPSHOT_BODY_BYTES,
  });

  if (!isRoomSnapshot(body)) {
    throw new HttpError(400, 'Request body must be a room snapshot.');
  }

  validateRoomSnapshotForWrite(body, roomId);

  try {
    return cloneRoomSnapshot(body);
  } catch {
    throw new HttpError(400, 'Request body must be a valid room snapshot.');
  }
}

function validateRoomSnapshotForWrite(snapshot: RoomSnapshot, roomId: string): void {
  validateRoomSnapshotIdentity(snapshot, roomId);
  validateRoomSnapshotTileData(snapshot.tileData);
  validateRoomSnapshotPlacedObjects(snapshot);
}

function validateRoomSnapshotIdentity(snapshot: RoomSnapshot, roomId: string): void {
  if (!Number.isInteger(snapshot.coordinates.x) || !Number.isInteger(snapshot.coordinates.y)) {
    throw new HttpError(400, 'Room coordinates must be integers.');
  }

  const canonicalRoomId = roomIdFromCoordinates(snapshot.coordinates);
  if (roomId !== canonicalRoomId || snapshot.id !== canonicalRoomId) {
    throw new HttpError(400, 'Room id must match snapshot coordinates.');
  }
}

function validateRoomSnapshotTileData(tileData: RoomSnapshot['tileData']): void {
  if (!tileData || typeof tileData !== 'object' || Array.isArray(tileData)) {
    throw new HttpError(400, 'tileData must be an object.');
  }

  const layerKeys = Object.keys(tileData).sort();
  const expectedLayerKeys = [...LAYER_NAMES].sort();
  if (
    layerKeys.length !== expectedLayerKeys.length ||
    layerKeys.some((key, index) => key !== expectedLayerKeys[index])
  ) {
    throw new HttpError(400, 'tileData must contain exactly background, terrain, and foreground layers.');
  }

  for (const layerName of LAYER_NAMES) {
    validateRoomSnapshotTileLayer(tileData[layerName], layerName);
  }
}

function validateRoomSnapshotTileLayer(layer: unknown, layerName: LayerName): void {
  if (!Array.isArray(layer) || layer.length !== ROOM_HEIGHT) {
    throw new HttpError(400, `tileData.${layerName} must contain ${ROOM_HEIGHT} rows.`);
  }

  for (let rowIndex = 0; rowIndex < layer.length; rowIndex += 1) {
    const row = layer[rowIndex];
    if (!Array.isArray(row) || row.length !== ROOM_WIDTH) {
      throw new HttpError(400, `tileData.${layerName}[${rowIndex}] must contain ${ROOM_WIDTH} tile values.`);
    }

    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const value = row[columnIndex];
      if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
        throw new HttpError(400, `tileData.${layerName}[${rowIndex}][${columnIndex}] must be a finite integer.`);
      }
    }
  }
}

function validateRoomSnapshotPlacedObjects(snapshot: RoomSnapshot): void {
  if (!Array.isArray(snapshot.placedObjects)) {
    throw new HttpError(400, 'placedObjects must be an array.');
  }

  const customSpriteIds = new Set(normalizeCustomSpriteDefinitions(snapshot.customSprites).map((sprite) => sprite.id));
  for (let index = 0; index < snapshot.placedObjects.length; index += 1) {
    validatePlacedObjectForWrite(snapshot.placedObjects[index], index, customSpriteIds);
  }
}

function validatePlacedObjectForWrite(
  placed: unknown,
  index: number,
  customSpriteIds: ReadonlySet<string>,
): void {
  if (!placed || typeof placed !== 'object') {
    throw new HttpError(400, `placedObjects[${index}] must be an object.`);
  }

  const candidate = placed as {
    id?: unknown;
    x?: unknown;
    y?: unknown;
    containedObjectId?: unknown;
  };

  if (typeof candidate.id !== 'string' || !candidate.id.trim()) {
    throw new HttpError(400, `placedObjects[${index}].id is required.`);
  }
  if (!isKnownSnapshotObjectId(candidate.id, customSpriteIds)) {
    throw new HttpError(400, `Unknown object id "${candidate.id}".`);
  }
  if (!isFinitePlacedObjectPosition(candidate.x, ROOM_PX_WIDTH)) {
    throw new HttpError(400, `placedObjects[${index}].x must be a finite room position.`);
  }
  if (!isFinitePlacedObjectPosition(candidate.y, ROOM_PX_HEIGHT)) {
    throw new HttpError(400, `placedObjects[${index}].y must be a finite room position.`);
  }
  if (
    candidate.containedObjectId !== undefined &&
    candidate.containedObjectId !== null &&
    !(typeof candidate.containedObjectId === 'string' && candidate.containedObjectId.trim() === '')
  ) {
    if (
      typeof candidate.containedObjectId !== 'string' ||
      !isKnownSnapshotObjectId(candidate.containedObjectId, customSpriteIds)
    ) {
      throw new HttpError(400, `placedObjects[${index}].containedObjectId must be a known object id.`);
    }
  }
}

function isFinitePlacedObjectPosition(value: unknown, roomSizePx: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= -PLACED_OBJECT_POSITION_MARGIN_PX &&
    value <= roomSizePx + PLACED_OBJECT_POSITION_MARGIN_PX
  );
}

function isKnownSnapshotObjectId(objectId: string, customSpriteIds: ReadonlySet<string>): boolean {
  if (getObjectById(objectId)) {
    return true;
  }

  const customSpriteId = parseCustomSpriteObjectId(objectId);
  return customSpriteId !== null && customSpriteIds.has(customSpriteId);
}

import {
  type CustomSpriteCatalogDeleteResponse,
  type CustomSpriteCatalogSaveRequest,
  type CustomSpriteCatalogSaveResponse,
} from '../../../customSprites/catalog';
import { normalizeCustomSpriteKind, type CustomSpriteKind } from '../../../customSprites/model';
import type { CustomSpriteUsageResponse } from '../../../customSprites/usage';
import { requireCurrentSession } from '../auth/request';
import { HttpError, jsonResponse, parseJsonBody } from '../core/http';
import type { Env } from '../core/types';
import {
  deleteOwnedCustomSprite,
  listOwnedCustomSprites,
  listPublicCustomSprites,
  loadCustomSpriteCatalogEntry,
  saveCustomSpriteCatalogEntry,
} from './catalogStore';
import { isCustomSpriteUsedInStoredRooms } from './store';

const CUSTOM_SPRITE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,96}$/;

export async function handleCustomSpriteRequest(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response> {
  if (url.pathname === '/api/custom-sprites' && request.method === 'GET') {
    return jsonResponse(request, await listPublicCustomSprites(env, readListOptions(url)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }

  if (url.pathname === '/api/custom-sprites/mine' && request.method === 'GET') {
    const session = await requireCurrentSession(env, request, 'load your custom sprites');
    return jsonResponse(request, await listOwnedCustomSprites(env, session.user.id, readListOptions(url)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }

  const usageMatch = /^\/api\/custom-sprites\/([^/]+)\/usage$/.exec(url.pathname);
  if (usageMatch) {
    if (request.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
    const spriteId = decodeSpriteId(usageMatch[1]);
    const response: CustomSpriteUsageResponse = {
      inUse: await isCustomSpriteUsedInStoredRooms(env, spriteId),
    };
    return jsonResponse(request, response, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }

  const spriteMatch = /^\/api\/custom-sprites\/([^/]+)$/.exec(url.pathname);
  if (!spriteMatch) {
    throw new HttpError(404, 'Custom sprite route not found.');
  }
  const spriteId = decodeSpriteId(spriteMatch[1]);

  if (request.method === 'GET') {
    const sprite = await loadCustomSpriteCatalogEntry(env, spriteId);
    if (!sprite) throw new HttpError(404, 'Custom sprite not found.');
    return jsonResponse(request, { sprite }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }

  if (request.method === 'PUT') {
    const session = await requireCurrentSession(env, request, 'share custom sprites');
    const body = await parseJsonBody<CustomSpriteCatalogSaveRequest>(request);
    const sprite = await saveCustomSpriteCatalogEntry(env, session.user, {
      spriteId,
      definition: body.definition,
      expectedRevision: body.expectedRevision,
      remixedFromSpriteId: body.remixedFromSpriteId,
    });
    const response: CustomSpriteCatalogSaveResponse = { sprite };
    return jsonResponse(request, response, {
      status: 200,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }

  if (request.method === 'DELETE') {
    const session = await requireCurrentSession(env, request, 'delete custom sprites');
    await deleteOwnedCustomSprite(env, session.user.id, spriteId);
    const response: CustomSpriteCatalogDeleteResponse = { deleted: true };
    return jsonResponse(request, response, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }

  throw new HttpError(405, 'Method not allowed.');
}

function readListOptions(url: URL): {
  query: string | null;
  kind: CustomSpriteKind | null;
  cursor: string | null;
  limit: number | undefined;
} {
  const kindParam = url.searchParams.get('kind');
  const kind = kindParam ? normalizeCustomSpriteKind(kindParam) : null;
  if (kindParam && kind !== kindParam) {
    throw new HttpError(400, 'kind must be decoration, collectible, sign, solid, or pushable.');
  }
  const rawLimit = url.searchParams.get('limit');
  const parsedLimit = rawLimit === null ? undefined : Number(rawLimit);
  if (rawLimit !== null && (!Number.isSafeInteger(parsedLimit) || Number(parsedLimit) <= 0)) {
    throw new HttpError(400, 'limit must be a positive integer.');
  }
  return {
    query: url.searchParams.get('query'),
    kind,
    cursor: url.searchParams.get('cursor'),
    limit: parsedLimit,
  };
}

function decodeSpriteId(value: string): string {
  let spriteId: string;
  try {
    spriteId = decodeURIComponent(value);
  } catch {
    throw new HttpError(400, 'Invalid custom sprite id.');
  }
  if (!CUSTOM_SPRITE_ID_PATTERN.test(spriteId)) {
    throw new HttpError(400, 'Invalid custom sprite id.');
  }
  return spriteId;
}

import type { CustomSpriteCatalogModerationRequest } from '../../../customSprites/catalog';
import { normalizeCustomSpriteKind, type CustomSpriteKind } from '../../../customSprites/model';
import { requireAdminRequest, requireTrustedOriginForMutation } from '../auth/request';
import { HttpError, jsonResponse, parseJsonBody } from '../core/http';
import type { Env } from '../core/types';
import { listAdminCustomSprites, moderateCustomSprite } from './catalogStore';

export async function handleAdminCustomSpriteRequest(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response> {
  requireAdminRequest(env, request, 'manage community sprites');

  if (url.pathname === '/api/admin/custom-sprites' && request.method === 'GET') {
    const status = url.searchParams.get('status') === 'blocked' ? 'blocked' : 'active';
    const kindParam = url.searchParams.get('kind');
    const kind = kindParam ? normalizeCustomSpriteKind(kindParam) : null;
    if (kindParam && kind !== kindParam) {
      throw new HttpError(400, 'kind must be decoration, collectible, sign, solid, or pushable.');
    }
    return jsonResponse(request, await listAdminCustomSprites(env, {
      query: url.searchParams.get('query'),
      kind: kind as CustomSpriteKind | null,
      cursor: url.searchParams.get('cursor'),
      limit: parseLimit(url.searchParams.get('limit')),
    }, status), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }

  const match = /^\/api\/admin\/custom-sprites\/([^/]+)$/.exec(url.pathname);
  if (match && request.method === 'PATCH') {
    requireTrustedOriginForMutation(request);
    const spriteId = decodeSpriteId(match[1]);
    const body = await parseJsonBody<CustomSpriteCatalogModerationRequest>(request);
    if (body.status !== 'active' && body.status !== 'blocked') {
      throw new HttpError(400, 'status must be active or blocked.');
    }
    return jsonResponse(request, {
      sprite: await moderateCustomSprite(env, spriteId, body.status),
    }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }

  throw new HttpError(404, 'Custom sprite admin route not found.');
}

function parseLimit(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, 'limit must be a positive integer.');
  }
  return parsed;
}

function decodeSpriteId(value: string): string {
  try {
    const id = decodeURIComponent(value);
    if (/^[a-zA-Z0-9_-]{1,96}$/.test(id)) return id;
  } catch {
    // Fall through to the shared validation error.
  }
  throw new HttpError(400, 'Invalid custom sprite id.');
}

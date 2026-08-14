import type { CustomSpriteUsageResponse } from '../../../customSprites/usage';
import { HttpError, jsonResponse } from '../core/http';
import type { Env } from '../core/types';
import { isCustomSpriteUsedInStoredRooms } from './store';

const CUSTOM_SPRITE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,96}$/;

export async function handleCustomSpriteRequest(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response> {
  const match = /^\/api\/custom-sprites\/([^/]+)\/usage$/.exec(url.pathname);
  if (!match) {
    throw new HttpError(404, 'Custom sprite route not found.');
  }
  if (request.method !== 'GET') {
    throw new HttpError(405, 'Method not allowed.');
  }

  let spriteId: string;
  try {
    spriteId = decodeURIComponent(match[1]);
  } catch {
    throw new HttpError(400, 'Invalid custom sprite id.');
  }
  if (!CUSTOM_SPRITE_ID_PATTERN.test(spriteId)) {
    throw new HttpError(400, 'Invalid custom sprite id.');
  }

  const response: CustomSpriteUsageResponse = {
    inUse: await isCustomSpriteUsedInStoredRooms(env, spriteId),
  };
  return jsonResponse(request, response, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

import {
  makePublicWampOGramRecord,
  normalizeWampOGramCreateRequest,
  normalizeWampOGramSlug,
} from '../../../wampOGram/model';
import {
  ROOM_SHARE_IMAGE_HEIGHT,
  ROOM_SHARE_IMAGE_WIDTH,
  renderRoomSharePreviewPng,
} from '../share/roomPreviewImage';
import { requireAuthenticatedRequestAuth } from '../auth/request';
import {
  corsHeaders,
  HttpError,
  jsonResponse,
  parseJsonBody,
} from '../core/http';
import type { Env } from '../core/types';
import {
  createWampOGram,
  loadWampOGramBySlug,
} from './store';

export async function handleWampOGramRequest(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response> {
  if (url.pathname === '/api/wamp-o-grams' && request.method === 'POST') {
    const body = await parseJsonBody<unknown>(request);
    const input = parseCreateRequest(body);
    const auth = await requireAuthenticatedRequestAuth(
      env,
      request,
      'create Wamp-O-Grams',
      'rooms:write',
    );
    const record = await createWampOGram(env, input, auth);
    return jsonResponse(request, record);
  }

  const match = /^\/api\/wamp-o-grams\/([^/]+)(?:\/(preview(?:\.png)?))?\/?$/.exec(url.pathname);
  if (!match) {
    throw new HttpError(404, 'Wamp-O-Gram route not found.');
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    throw new HttpError(405, 'Method not allowed.');
  }

  const slug = normalizeWampOGramSlug(decodeURIComponent(match[1]));
  if (!slug) {
    throw new HttpError(400, 'Wamp-O-Gram slug is invalid.');
  }

  const record = await loadWampOGramBySlug(env, slug);
  if (!record) {
    throw new HttpError(404, 'Wamp-O-Gram not found.');
  }

  const target = match[2] ?? 'record';
  if (target === 'preview' || target === 'preview.png') {
    return wampOGramPreviewResponse(request, record.roomSnapshot);
  }

  return jsonResponse(request, makePublicWampOGramRecord(record));
}

function parseCreateRequest(body: unknown): ReturnType<typeof normalizeWampOGramCreateRequest> {
  try {
    return normalizeWampOGramCreateRequest(body);
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? error.message : 'Invalid Wamp-O-Gram request.',
    );
  }
}

function wampOGramPreviewResponse(
  request: Request,
  roomSnapshot: Parameters<typeof renderRoomSharePreviewPng>[0],
): Response {
  const headers = new Headers({
    'Content-Type': 'image/png',
    'Cache-Control': 'public, max-age=300, s-maxage=3600',
    'X-Wamp-Image-Width': String(ROOM_SHARE_IMAGE_WIDTH),
    'X-Wamp-Image-Height': String(ROOM_SHARE_IMAGE_HEIGHT),
    ...corsHeaders(request),
  });

  if (request.method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers,
    });
  }

  const bytes = renderRoomSharePreviewPng(roomSnapshot);
  const body = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;

  return new Response(body, {
    status: 200,
    headers,
  });
}

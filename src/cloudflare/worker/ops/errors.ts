import { HttpError, jsonResponse, noContentResponse, parseJsonBody } from '../core/http';
import type { Env } from '../core/types';
import { getClientIp, hashRateLimitKey, networkKeyForIp, takeRateLimitSlot, type RateLimitRule } from '../core/rateLimit';

/**
 * The reply for an error that escaped a route. Client errors (4xx) keep their message.
 * Server errors are logged as one JSON line with the route and Cloudflare ray, so they
 * can be found in Workers Logs; deliberate HttpErrors keep their explanation, while
 * anything unexpected (a D1 or code failure) is not shown to players, only its reference.
 */
export function apiErrorResponse(request: Request, url: URL, error: unknown): Response {
  if (error instanceof HttpError && error.status < 500) {
    return jsonResponse(request, { error: error.message }, { status: error.status });
  }
  const status = error instanceof HttpError ? error.status : 500;
  const requestId = request.headers.get('cf-ray') ?? crypto.randomUUID();
  console.error(JSON.stringify({
    kind: 'api_error', status, method: request.method, route: url.pathname, requestId,
    name: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack?.slice(0, 1500) ?? null : null,
  }));
  const message = error instanceof HttpError
    ? error.message
    : `Something went wrong on our side. Reference: ${requestId}.`;
  return jsonResponse(request, { error: message, requestId }, { status });
}

// Per network, enough for a few sessions' capped reports; more is dropped quietly.
const CLIENT_ERROR_RULE: RateLimitRule = { bucket: 'client_error', limit: 30, windowMs: 60 * 60 * 1000 };
const MAX_CLIENT_ERROR_BYTES = 8_192;

/** Removes things a report must not carry: email addresses, tokens and query strings. */
export function redactClientErrorText(value: unknown, limit: number): string | null {
  if (typeof value !== 'string' || !value) return null;
  return value
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/(https?:\/\/[^\s?#)]+)[?#][^\s)]*/g, '$1')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[token]')
    .slice(0, limit);
}

/**
 * POST /api/client-errors: a browser's uncaught error, sent with navigator.sendBeacon.
 * Logged as `{ kind: 'client_error', ... }` for Workers Logs; nothing is stored.
 */
export async function handleClientErrorReport(request: Request, env: Env): Promise<Response> {
  // Capped while reading, so an oversized anonymous upload is refused before it is buffered (F426).
  const parsed = await parseJsonBody<unknown>(request, { maxBytes: MAX_CLIENT_ERROR_BYTES }).catch((error: unknown) => {
    throw error instanceof HttpError && error.status === 413 ? new HttpError(413, 'Error report too large.') : new HttpError(400, 'Invalid error report.');
  });
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new HttpError(400, 'Invalid error report.');
  const body = parsed as Record<string, unknown>;
  const message = redactClientErrorText(body.message, 300);
  if (!message) throw new HttpError(400, 'Invalid error report.');

  const ip = getClientIp(request);
  if (ip && await takeRateLimitSlot(env, CLIENT_ERROR_RULE, await hashRateLimitKey(env, networkKeyForIp(ip))) === null) {
    return noContentResponse(request);
  }
  const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null);
  console.log(JSON.stringify({
    kind: 'client_error',
    type: body.type === 'unhandledrejection' ? 'unhandledrejection' : 'error',
    message,
    source: redactClientErrorText(body.source, 200),
    line: number(body.line),
    column: number(body.column),
    stack: redactClientErrorText(body.stack, 2_000),
    build: redactClientErrorText(body.build, 80),
    route: redactClientErrorText(body.route, 120),
    appMode: redactClientErrorText(body.appMode, 40),
    device: redactClientErrorText(body.device, 40),
    ray: request.headers.get('cf-ray'),
  }));
  return noContentResponse(request);
}

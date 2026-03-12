import type { ApiTokenScope, AuthSessionResponse } from '../../../auth/model';
import { HttpError } from '../core/http';
import type { AuthSession, Env, RequestAuth } from '../core/types';
import {
  SESSION_MAX_AGE_SECONDS,
  loadApiTokenAuth,
  loadSessionFromToken,
  parseCookie,
} from './store';

export const SESSION_COOKIE_NAME = 'ep_session';

export async function requireCurrentSession(
  env: Env,
  request: Request,
  actionLabel: string
): Promise<AuthSession> {
  const session = await loadCurrentSession(env, request);
  if (!session) {
    throw new HttpError(401, `You must be signed in to ${actionLabel}.`);
  }

  return session;
}

export async function requireAuthenticatedRequestAuth(
  env: Env,
  request: Request,
  actionLabel: string,
  requiredScope?: ApiTokenScope
): Promise<RequestAuth> {
  const auth = await loadOptionalRequestAuth(env, request);
  if (!auth) {
    throw new HttpError(401, `You must be signed in to ${actionLabel}.`);
  }

  if (requiredScope) {
    requireScope(auth, requiredScope, actionLabel);
  }

  return auth;
}

export function requireAdminRequest(env: Env, request: Request, actionLabel: string): void {
  if (isAdminRequest(env, request)) {
    return;
  }

  throw new HttpError(403, `Admin key is required to ${actionLabel}.`);
}

export async function requireWalletLinkedRequestAuth(
  env: Env,
  request: Request,
  actionLabel: string,
  requiredScope: ApiTokenScope
): Promise<RequestAuth> {
  const auth = await requireAuthenticatedRequestAuth(env, request, actionLabel, requiredScope);
  if (!auth.user.walletAddress) {
    throw new HttpError(403, `Link a wallet to ${actionLabel}.`);
  }

  return auth;
}

export async function loadOptionalRequestAuth(
  env: Env,
  request: Request
): Promise<RequestAuth | null> {
  const isAdmin = isAdminRequest(env, request);
  const bearerToken = parseBearerToken(request.headers.get('Authorization'));
  if (bearerToken) {
    const tokenAuth = await loadApiTokenAuth(env, bearerToken);
    if (!tokenAuth) {
      throw new HttpError(401, 'API token is invalid or has been revoked.');
    }

    return {
      ...tokenAuth,
      isAdmin,
    };
  }

  const session = await loadCurrentSession(env, request);
  if (!session) {
    return null;
  }

  return {
    source: 'session',
    user: session.user,
    session,
    scopes: null,
    apiToken: null,
    isAdmin,
  };
}

export async function loadCurrentSession(env: Env, request: Request): Promise<AuthSession | null> {
  const token = parseCookie(request.headers.get('Cookie')).get(SESSION_COOKIE_NAME);
  if (!token) {
    return null;
  }

  return loadSessionFromToken(env, token);
}

export function createSessionResponse(auth: RequestAuth | null): AuthSessionResponse {
  return {
    authenticated: Boolean(auth),
    user: auth?.user ?? null,
    source: auth?.source ?? null,
    scopes: auth?.scopes ?? null,
  };
}

export function createSessionCookie(request: Request, token: string): string {
  const secure = new URL(request.url).protocol === 'https:';
  const sameSite = secure ? 'SameSite=None' : 'SameSite=Lax';
  return [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    sameSite,
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    secure ? 'Secure' : null,
  ]
    .filter(Boolean)
    .join('; ');
}

export function clearSessionCookie(request: Request): string {
  const secure = new URL(request.url).protocol === 'https:';
  const sameSite = secure ? 'SameSite=None' : 'SameSite=Lax';
  return [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    sameSite,
    'Max-Age=0',
    secure ? 'Secure' : null,
  ]
    .filter(Boolean)
    .join('; ');
}

export function parseBearerToken(rawHeader: string | null): string | null {
  if (!rawHeader) {
    return null;
  }

  const match = /^\s*Bearer\s+(.+?)\s*$/i.exec(rawHeader);
  if (!match) {
    return null;
  }

  const token = match[1].trim();
  return token ? token : null;
}

export function isAdminRequest(env: Env, request: Request): boolean {
  const configured = env.ADMIN_API_KEY?.trim();
  if (!configured) {
    return false;
  }

  const provided = request.headers.get('x-admin-key')?.trim();
  if (!provided) {
    return false;
  }

  return provided === configured;
}

export function hasScope(auth: RequestAuth, scope: ApiTokenScope): boolean {
  return auth.source === 'session' || auth.scopes?.includes(scope) === true;
}

export function requireScope(auth: RequestAuth, scope: ApiTokenScope, actionLabel: string): void {
  if (!hasScope(auth, scope)) {
    throw new HttpError(403, `This API token lacks the ${scope} scope required to ${actionLabel}.`);
  }
}

export function requireOptionalScope(
  auth: RequestAuth | null,
  scope: ApiTokenScope,
  actionLabel: string
): void {
  if (!auth || auth.source !== 'api_token') {
    return;
  }

  requireScope(auth, scope, actionLabel);
}

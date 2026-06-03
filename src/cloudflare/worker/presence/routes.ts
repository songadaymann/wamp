import {
  createPartykitIdentityToken,
  normalizePartykitAuthIdentity,
  normalizePartykitGuestIdentity,
  resolvePartykitIdentitySigningSecret,
  type PartyKitIdentity,
  type PartyKitIdentityTokenIssueRequestBody,
  type PartyKitIdentityTokenIssueResponse,
  type PartyKitIdentityTokenSource,
} from '../../../presence/identityToken';
import { loadOptionalRequestAuth } from '../auth/request';
import { HttpError, jsonResponse, parseJsonBody } from '../core/http';
import type { Env } from '../core/types';

const MAX_IDENTITY_TOKEN_REQUEST_BYTES = 4096;

export async function handlePresenceRequest(
  request: Request,
  url: URL,
  env: Env
): Promise<Response> {
  if (url.pathname === '/api/presence/identity-token' && request.method === 'POST') {
    return handlePresenceIdentityTokenIssue(request, env);
  }

  throw new HttpError(404, 'Presence route not found.');
}

async function handlePresenceIdentityTokenIssue(
  request: Request,
  env: Env
): Promise<Response> {
  const signingSecret = resolvePartykitIdentitySigningSecret(env);
  if (!signingSecret) {
    throw new HttpError(503, 'PartyKit identity token signing is not configured.');
  }

  const body = await parseJsonBody<PartyKitIdentityTokenIssueRequestBody>(request, {
    maxBytes: MAX_IDENTITY_TOKEN_REQUEST_BYTES,
  });
  const auth = await loadOptionalRequestAuth(env, request);
  const { identity, source } = resolveIssueIdentity(body, auth?.user ?? null);
  const { token, claims } = await createPartykitIdentityToken(identity, source, signingSecret.secret);
  const response: PartyKitIdentityTokenIssueResponse = {
    token,
    expiresAt: new Date(claims.exp).toISOString(),
    identity,
    source,
  };

  return jsonResponse(request, response);
}

function resolveIssueIdentity(
  body: PartyKitIdentityTokenIssueRequestBody,
  authUser: { id: string; displayName: string } | null
): { identity: PartyKitIdentity; source: PartyKitIdentityTokenSource } {
  const bodyIdentity = body.identity ?? {};
  const requestedAvatarId = bodyIdentity.avatarId ?? body.avatarId ?? 'default-player';

  if (authUser) {
    const identity = normalizePartykitAuthIdentity({
      userId: authUser.id,
      displayName: authUser.displayName,
      avatarId: requestedAvatarId,
    });
    if (!identity) {
      throw new HttpError(400, 'Authenticated presence identity is invalid.');
    }

    return {
      identity,
      source: 'auth',
    };
  }

  const identity = normalizePartykitGuestIdentity({
    userId: bodyIdentity.userId ?? body.userId,
    displayName: bodyIdentity.displayName ?? body.displayName,
    avatarId: requestedAvatarId,
  });
  if (!identity) {
    throw new HttpError(400, 'Guest presence identity is invalid.');
  }

  return {
    identity,
    source: 'guest',
  };
}

import {
  createPartykitIdentityToken,
  normalizePartykitAuthIdentity,
  normalizePartykitGuestIdentity,
  resolvePartykitIdentitySigningSecret,
  type PartyKitIdentity,
  type PartyKitIdentityTokenIssueRequestBody,
  type PartyKitIdentityTokenIssueResponse,
  isGeneratedGuestDisplayName,
  type PartyKitIdentityTokenSource,
  type RoomChatPermission,
} from '../../../presence/identityToken';
import { DEFAULT_PLAYER_AVATAR_ID } from '../../../player/avatar/registry';
import {
  isPlayerAvatarEntitlementGated,
  resolveSelectablePlayerAvatarId,
} from '../../../player/avatar/unlocks';
import { loadOptionalRequestAuth } from '../auth/request';
import { HttpError, jsonResponse, parseJsonBody } from '../core/http';
import type { Env } from '../core/types';
import { hasUserAvatarEntitlement } from '../avatars/entitlements';
import { isChatBannedUser } from '../chat/store';

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
  const { identity, source } = await resolveIssueIdentity(body, auth?.user ?? null, env);
  // The presence server cannot query the database, so the bubble permission travels in the token.
  const roomChat: RoomChatPermission | undefined = !auth?.user
    ? undefined
    : auth.school
      ? 'school'
      : await isChatBannedUser(env, auth.user.id) ? 'muted' : 'ok';
  const { token, claims } = await createPartykitIdentityToken(identity, source, signingSecret.secret, { roomChat });
  const response: PartyKitIdentityTokenIssueResponse = {
    token,
    expiresAt: new Date(claims.exp).toISOString(),
    identity,
    source,
  };

  return jsonResponse(request, response);
}

async function resolveIssueIdentity(
  body: PartyKitIdentityTokenIssueRequestBody,
  authUser: { id: string; displayName: string; selectedAvatarId?: string | null } | null,
  env: Env,
): Promise<{ identity: PartyKitIdentity; source: PartyKitIdentityTokenSource }> {
  const bodyIdentity = body.identity ?? {};
  const requestedAvatarId = bodyIdentity.avatarId ?? body.avatarId ?? 'default-player';

  if (authUser) {
    const selectedAvatarId = resolveSelectablePlayerAvatarId(authUser.selectedAvatarId);
    const avatarId = isPlayerAvatarEntitlementGated(selectedAvatarId)
      && !await hasUserAvatarEntitlement(env, authUser.id, selectedAvatarId)
      ? DEFAULT_PLAYER_AVATAR_ID
      : selectedAvatarId;
    const identity = normalizePartykitAuthIdentity({
      userId: authUser.id,
      displayName: authUser.displayName,
      avatarId,
    });
    if (!identity) {
      throw new HttpError(400, 'Authenticated presence identity is invalid.');
    }

    return {
      identity,
      source: 'auth',
    };
  }

  const requestedGuestName = bodyIdentity.displayName ?? body.displayName;
  const requestedGuestUserId = bodyIdentity.userId ?? body.userId;
  const identity = normalizePartykitGuestIdentity({
    userId: requestedGuestUserId,
    displayName: typeof requestedGuestName === 'string' && isGeneratedGuestDisplayName(requestedGuestName.trim())
      ? requestedGuestName
      : `Guest ${String(requestedGuestUserId ?? '').replace(/[^a-z0-9]/gi, '').slice(-4).toLowerCase() || 'wamp'}`,
    avatarId: typeof requestedAvatarId === 'string'
      && isPlayerAvatarEntitlementGated(requestedAvatarId.trim())
      ? DEFAULT_PLAYER_AVATAR_ID
      : requestedAvatarId,
  });
  if (!identity) {
    throw new HttpError(400, 'Guest presence identity is invalid.');
  }

  return {
    identity,
    source: 'guest',
  };
}

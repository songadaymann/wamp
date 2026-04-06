import { verifyMessage } from 'viem';
import type {
  ApiTokenCreateRequestBody,
  ApiTokenCreateResponse,
  ApiTokenListResponse,
  DisplayNameAvailabilityResponse,
  DisplayNameUpdateRequestBody,
  DisplayNameUpdateResponse,
  AuthSessionResponse,
  AuthUser,
  MagicLinkRequestBody,
  MagicLinkRequestResponse,
  WalletChallengeRequestBody,
  WalletChallengeResponse,
  WalletVerifyRequestBody,
  WalletVerifyResponse,
} from '../../../auth/model';
import { HttpError, jsonResponse, noContentResponse, parseJsonBody, redirectResponse } from '../core/http';
import type { Env } from '../core/types';
import {
  attachWalletToUser,
  API_TOKEN_PREFIX,
  MAGIC_LINK_TTL_MS,
  WALLET_CHALLENGE_TTL_MS,
  consumeMagicLinkToken,
  consumeWalletChallenge,
  createApiTokenForUser,
  createMagicLinkToken,
  createSession,
  createUserForEmail,
  createUserForWallet,
  createWalletChallenge,
  createWalletChallengeMessage,
  deleteSessionById,
  extractNonceFromWalletMessage,
  findApiTokenIdForUser,
  findUserByDisplayName,
  findUserByEmail,
  findUserByWallet,
  generateOpaqueToken,
  hashToken,
  isExpired,
  isValidAddress,
  isValidEmail,
  listApiTokensForUser,
  loadMagicLinkByTokenHash,
  loadWalletChallengeByNonceHash,
  normalizeAddress,
  normalizeApiTokenScopes,
  normalizeEmail,
  resolveMagicLinkRedirectBase,
  resolveMagicLinkReturnBase,
  revokeApiTokenForUser,
  sendMagicLinkEmail,
  updateUserDisplayName,
} from './store';
import {
  clearSessionCookie,
  createSessionCookie,
  createSessionResponse,
  loadCurrentSession,
  loadOptionalRequestAuth,
  requireAuthenticatedRequestAuth,
  requireCurrentSession,
} from './request';
import { NO_CHAT_MODERATION_VIEWER, resolveChatModerationViewer } from '../chat/moderation';
import { getRoomClaimQuota } from '../rooms/store';

export async function handleAuthRequest(request: Request, url: URL, env: Env): Promise<Response> {
  if (url.pathname === '/api/auth/session' && request.method === 'GET') {
    const auth = await loadOptionalRequestAuth(env, request);
    const responseBody: AuthSessionResponse = createSessionResponse(auth);
    responseBody.chatModeration =
      auth?.source === 'session' || auth?.source === 'playfun'
        ? await resolveChatModerationViewer(env, auth.user)
        : NO_CHAT_MODERATION_VIEWER;
    if (auth?.source === 'session' || auth?.source === 'playfun') {
      const quota = await getRoomClaimQuota(env, auth.user.id, auth.source);
      responseBody.roomDailyClaimLimit = quota.limit;
      responseBody.roomClaimsUsedToday = quota.claimsUsedToday;
      responseBody.roomClaimsRemainingToday = quota.claimsRemainingToday;
    }
    return jsonResponse(request, responseBody);
  }

  if (url.pathname === '/api/auth/request-link' && request.method === 'POST') {
    return handleRequestMagicLink(request, env);
  }

  if (url.pathname === '/api/auth/verify' && request.method === 'GET') {
    return handleVerifyMagicLink(request, url, env);
  }

  if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
    return handleLogout(request, env);
  }

  if (url.pathname === '/api/auth/display-name' && request.method === 'POST') {
    return handleUpdateDisplayName(request, env);
  }

  if (url.pathname === '/api/auth/display-name-availability' && request.method === 'GET') {
    return handleDisplayNameAvailability(request, url, env);
  }

  if (url.pathname === '/api/auth/tokens' && request.method === 'GET') {
    return handleListApiTokens(request, env);
  }

  if (url.pathname === '/api/auth/tokens' && request.method === 'POST') {
    return handleCreateApiToken(request, env);
  }

  const tokenDeleteMatch = /^\/api\/auth\/tokens\/([^/]+)$/.exec(url.pathname);
  if (tokenDeleteMatch && request.method === 'DELETE') {
    return handleDeleteApiToken(request, env, decodeURIComponent(tokenDeleteMatch[1]));
  }

  if (url.pathname === '/api/auth/wallet/challenge' && request.method === 'POST') {
    return handleWalletChallenge(request, env);
  }

  if (url.pathname === '/api/auth/wallet/verify' && request.method === 'POST') {
    return handleWalletVerify(request, env);
  }

  throw new HttpError(404, 'Auth route not found.');
}

export async function handleRequestMagicLink(request: Request, env: Env): Promise<Response> {
  const body = await parseJsonBody<MagicLinkRequestBody>(request);
  const email = normalizeEmail(body.email);

  if (!isValidEmail(email)) {
    throw new HttpError(400, 'Please enter a valid email address.');
  }

  const user = (await findUserByEmail(env, email)) ?? (await createUserForEmail(env, email));
  const token = generateOpaqueToken(32);
  const tokenHash = await hashToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + MAGIC_LINK_TTL_MS).toISOString();

  await createMagicLinkToken(env, user.id, email, tokenHash, expiresAt, now.toISOString());

  const verifyBaseUrl = new URL(request.url).origin;
  const returnBaseUrl = resolveMagicLinkReturnBase(request, env);
  const magicLinkUrl = new URL('/api/auth/verify', verifyBaseUrl);
  magicLinkUrl.searchParams.set('token', token);
  magicLinkUrl.searchParams.set('returnTo', returnBaseUrl);
  const magicLink = magicLinkUrl.toString();
  const responseBody: MagicLinkRequestResponse = {
    ok: true,
    delivery: env.AUTH_DEBUG_MAGIC_LINKS === '1'
      ? 'debug'
      : env.RESEND_API_KEY
        ? 'email'
        : 'debug',
  };

  if (env.AUTH_DEBUG_MAGIC_LINKS === '1') {
    responseBody.debugMagicLink = magicLink;
  } else if (env.RESEND_API_KEY) {
    await sendMagicLinkEmail(env, email, magicLink);
  } else {
    throw new HttpError(
      500,
      'Email auth is not configured. Set RESEND_API_KEY or enable AUTH_DEBUG_MAGIC_LINKS.'
    );
  }

  return jsonResponse(request, responseBody);
}

export async function handleVerifyMagicLink(
  request: Request,
  url: URL,
  env: Env
): Promise<Response> {
  const redirectBaseUrl = resolveMagicLinkRedirectBase(request, env, url.searchParams.get('returnTo'));
  const token = url.searchParams.get('token');
  if (!token) {
    return redirectResponse(`${redirectBaseUrl}/?auth=invalid`);
  }

  const tokenHash = await hashToken(token);
  const row = await loadMagicLinkByTokenHash(env, tokenHash);

  if (!row || row.consumed_at || isExpired(row.expires_at)) {
    return redirectResponse(`${redirectBaseUrl}/?auth=invalid`);
  }

  const user: AuthUser = {
    id: row.user_id,
    email: row.email,
    walletAddress: row.wallet_address,
    displayName: row.display_name,
    createdAt: row.user_created_at,
    avatarUrl: row.avatar_url,
    bio: row.bio,
  };

  const sessionToken = await createSession(env, user.id);
  const now = new Date().toISOString();
  await consumeMagicLinkToken(env, row.id, now);

  return redirectResponse(`${redirectBaseUrl}/?auth=email`, {
    'Set-Cookie': createSessionCookie(request, sessionToken),
  });
}

export async function handleLogout(request: Request, env: Env): Promise<Response> {
  const existing = await loadCurrentSession(env, request);
  if (existing) {
    await deleteSessionById(env, existing.sessionId);
  }

  return jsonResponse(
    request,
    { ok: true },
    {
      headers: {
        'Set-Cookie': clearSessionCookie(request),
      },
    }
  );
}

export async function handleUpdateDisplayName(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(env, request, 'update display name');
  const body = await parseJsonBody<DisplayNameUpdateRequestBody>(request);
  const displayName = normalizeDisplayName(body.displayName);

  if (!displayName) {
    throw new HttpError(400, 'Display name is required.');
  }

  if (displayName.length > 24) {
    throw new HttpError(400, 'Display name must be 24 characters or fewer.');
  }

  const existingUser = await findUserByDisplayName(env, displayName);
  if (existingUser && existingUser.id !== auth.user.id) {
    throw new HttpError(409, 'That display name has already been claimed.');
  }

  const updatedUser = await updateUserDisplayName(env, auth.user, displayName);
  const responseBody: DisplayNameUpdateResponse = {
    ok: true,
    user: updatedUser,
  };

  return jsonResponse(request, responseBody);
}

export async function handleDisplayNameAvailability(
  request: Request,
  url: URL,
  env: Env
): Promise<Response> {
  const displayName = normalizeDisplayName(url.searchParams.get('displayName'));
  if (!displayName) {
    throw new HttpError(400, 'displayName is required.');
  }

  if (displayName.length > 24) {
    throw new HttpError(400, 'Display name must be 24 characters or fewer.');
  }

  const auth = await loadOptionalRequestAuth(env, request);
  const existingUser = await findUserByDisplayName(env, displayName);
  const claimedByCurrentUser = Boolean(existingUser && auth?.user.id === existingUser.id);
  const responseBody: DisplayNameAvailabilityResponse = {
    available: !existingUser || claimedByCurrentUser,
    claimedByCurrentUser,
  };

  return jsonResponse(request, responseBody);
}

export async function handleListApiTokens(request: Request, env: Env): Promise<Response> {
  const session = await requireCurrentSession(env, request, 'manage API tokens');
  const tokens = await listApiTokensForUser(env, session.user.id);
  const responseBody: ApiTokenListResponse = {
    tokens,
  };

  return jsonResponse(request, responseBody);
}

export async function handleCreateApiToken(request: Request, env: Env): Promise<Response> {
  const session = await requireCurrentSession(env, request, 'manage API tokens');
  const body = await parseApiTokenCreateBody(request);
  const tokenId = crypto.randomUUID();
  const rawToken = `${API_TOKEN_PREFIX}${generateOpaqueToken(40)}`;
  const tokenHash = await hashToken(rawToken);
  const now = new Date().toISOString();

  await createApiTokenForUser(env, session.user.id, body.label, tokenHash, body.scopes, now, tokenId);

  const responseBody: ApiTokenCreateResponse = {
    token: rawToken,
    record: {
      id: tokenId,
      label: body.label,
      scopes: [...body.scopes],
      createdAt: now,
      lastUsedAt: null,
      revokedAt: null,
    },
  };

  return jsonResponse(request, responseBody, { status: 201 });
}

export async function handleDeleteApiToken(
  request: Request,
  env: Env,
  tokenId: string
): Promise<Response> {
  const session = await requireCurrentSession(env, request, 'manage API tokens');
  if (!tokenId) {
    throw new HttpError(400, 'Token id is required.');
  }

  const existing = await findApiTokenIdForUser(env, tokenId, session.user.id);
  if (!existing) {
    throw new HttpError(404, 'API token not found.');
  }

  await revokeApiTokenForUser(env, tokenId, session.user.id, new Date().toISOString());
  return noContentResponse(request);
}

export async function handleWalletChallenge(request: Request, env: Env): Promise<Response> {
  const body = await parseJsonBody<WalletChallengeRequestBody>(request);
  const address = normalizeAddress(body.address);

  if (!isValidAddress(address)) {
    throw new HttpError(400, 'Wallet address must be a valid EVM address.');
  }

  const nonce = generateOpaqueToken(24);
  const nonceHash = await hashToken(nonce);
  const now = new Date();
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + WALLET_CHALLENGE_TTL_MS).toISOString();
  const message = createWalletChallengeMessage(request, env, address, nonce, issuedAt);

  await createWalletChallenge(env, address, nonceHash, message, expiresAt, issuedAt);

  const responseBody: WalletChallengeResponse = {
    address,
    message,
    expiresAt,
  };

  return jsonResponse(request, responseBody);
}

export async function handleWalletVerify(request: Request, env: Env): Promise<Response> {
  const body = await parseJsonBody<WalletVerifyRequestBody>(request);
  const address = normalizeAddress(body.address);

  if (!isValidAddress(address)) {
    throw new HttpError(400, 'Wallet address must be a valid EVM address.');
  }

  const nonce = extractNonceFromWalletMessage(body.message);
  if (!nonce) {
    throw new HttpError(400, 'Wallet challenge message is invalid.');
  }

  const nonceHash = await hashToken(nonce);
  const challenge = await loadWalletChallengeByNonceHash(env, nonceHash);

  if (!challenge || challenge.consumed_at || isExpired(challenge.expires_at)) {
    throw new HttpError(401, 'Wallet challenge has expired. Please try again.');
  }

  if (challenge.address !== address || challenge.message_text !== body.message) {
    throw new HttpError(401, 'Wallet challenge did not match the requested address.');
  }

  const verified = await verifyMessage({
    address: address as `0x${string}`,
    message: body.message,
    signature: body.signature as `0x${string}`,
  });

  if (!verified) {
    throw new HttpError(401, 'Wallet signature could not be verified.');
  }

  const now = new Date().toISOString();
  await consumeWalletChallenge(env, challenge.id, now);

  const existingAuth = await loadOptionalRequestAuth(env, request);
  let user: AuthUser;
  let setCookie: string | null = null;
  let linkedWallet = false;

  if (existingAuth) {
    if (existingAuth.source === 'api_token' || existingAuth.source === 'agent_token') {
      throw new HttpError(403, 'API tokens cannot link wallets.');
    }

    user = await attachWalletToUser(env, existingAuth.user, address);
    linkedWallet = true;
    if (existingAuth.source === 'playfun') {
      setCookie = createSessionCookie(request, await createSession(env, user.id));
    }
  } else {
    const existingWalletUser = await findUserByWallet(env, address);
    user = existingWalletUser ?? (await createUserForWallet(env, address));
    setCookie = createSessionCookie(request, await createSession(env, user.id));
  }

  const responseBody: WalletVerifyResponse = {
    authenticated: true,
    linkedWallet,
    user,
  };

  return jsonResponse(
    request,
    responseBody,
    setCookie
      ? {
          headers: {
            'Set-Cookie': setCookie,
          },
        }
      : undefined
  );
}

async function parseApiTokenCreateBody(request: Request): Promise<ApiTokenCreateRequestBody> {
  const body = await parseJsonBody<ApiTokenCreateRequestBody>(request);
  const label = typeof body.label === 'string' ? body.label.trim() : '';

  if (!label) {
    throw new HttpError(400, 'label is required.');
  }

  if (label.length > 64) {
    throw new HttpError(400, 'label must be 64 characters or fewer.');
  }

  const scopes = normalizeApiTokenScopes(body.scopes);
  if (scopes.length === 0) {
    throw new HttpError(400, 'Choose at least one API token scope.');
  }

  return {
    label,
    scopes,
  };
}

function normalizeDisplayName(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.replace(/\s+/g, ' ').trim();
}

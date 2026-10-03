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
  EmailCodeVerifyBody,
  MagicLinkRequestBody,
  MagicLinkRequestResponse,
  WalletChallengeRequestBody,
  WalletChallengeResponse,
  WalletVerifyRequestBody,
  WalletVerifyResponse,
} from '../../../auth/model';
import { HttpError, jsonResponse, noContentResponse, parseJsonBody, redirectResponse } from '../core/http';
import type { Env, MagicLinkJoinRow } from '../core/types';
import {
  canonicalMailbox,
  clearRateLimitEvents,
  getClientIp,
  hashRateLimitKey,
  networkKeyForIp,
  releaseRateLimitSlots,
  takeRateLimitSlots,
  type RateLimitRule,
} from '../core/rateLimit';
import { ensureFounderIdentityQualification } from '../progression/awards';
import { assertNotSchoolRestricted, assertUserNotSchoolManaged } from '../school/restrictions';
import {
  attachEmailToUser,
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
  hasRecentEmailSignInRequest,
  isExpired,
  isValidAddress,
  isValidEmail,
  listApiTokensForUser,
  loadMagicLinkByTokenHash,
  loadLiveEmailCodes,
  recordEmailCodeAttempt,
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
  requireTrustedOriginForMutation,
} from './request';
import { NO_CHAT_MODERATION_VIEWER, resolveChatModerationViewer } from '../chat/moderation';
import { assertGeneratedOnlyDisplayNameChangeAllowed } from '../generatedUsers/leaderboardIsolation';
import { getRoomClaimQuota } from '../rooms/store';

export async function handleAuthRequest(request: Request, url: URL, env: Env): Promise<Response> {
  if (url.pathname === '/api/auth/session' && request.method === 'GET') {
    const auth = await loadOptionalRequestAuth(env, request);
    const responseBody: AuthSessionResponse = createSessionResponse(auth);
    responseBody.walletProjectId = resolvePublicWalletProjectId(env);
    responseBody.partykitHost = resolvePublicPartykitHost(env);
    responseBody.partykitParty = responseBody.partykitHost
      ? resolvePublicPartykitParty(env)
      : null;
    responseBody.chatModeration =
      auth?.source === 'session'
        ? await resolveChatModerationViewer(env, auth.user)
        : NO_CHAT_MODERATION_VIEWER;
    if (auth?.source === 'session') {
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

  if (url.pathname === '/api/auth/verify-code' && request.method === 'POST') {
    return handleVerifyEmailCode(request, env);
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

function resolvePublicPartykitHost(env: Env): string | null {
  const host = env.PARTYKIT_HOST?.trim();
  return host ? host : null;
}

function resolvePublicPartykitParty(env: Env): string {
  return env.PARTYKIT_PARTY?.trim() || 'main';
}

function resolvePublicWalletProjectId(env: Env): string | null {
  const projectId =
    env.REOWN_PROJECT_ID?.trim()
    || env.VITE_REOWN_PROJECT_ID?.trim()
    || env.WALLET_CONNECT_PROJECT_ID?.trim()
    || env.VITE_WALLET_CONNECT_PROJECT_ID?.trim()
    || '';

  return projectId || null;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// Sign-in emails. The network cap is sized for a busy shared network (a school or event wifi,
// including resends) but stops a script mailing thousands of strangers. The daily cap is per
// address *and* network, so a stranger elsewhere cannot use up the owner's allowance and lock
// them out; the hourly inbox cap (plus-tags and Gmail dots count as one inbox) stops flooding.
const SIGN_IN_EMAILS_PER_NETWORK: RateLimitRule = { bucket: 'sign-in-email:network', limit: 150, windowMs: HOUR_MS };
const SIGN_IN_EMAILS_PER_ADDRESS_AND_NETWORK: RateLimitRule = { bucket: 'sign-in-email:address-network', limit: 10, windowMs: DAY_MS };
const SIGN_IN_EMAILS_PER_INBOX: RateLimitRule = { bucket: 'sign-in-email:inbox', limit: 20, windowMs: HOUR_MS };
// Wrong six-digit codes, counted across every code sent so a code cannot be ground down over
// days. 30 a day per address is about a 1-in-33,000 chance; the emailed link always still works.
const WRONG_CODES_PER_NETWORK: RateLimitRule = { bucket: 'wrong-code:network', limit: 100, windowMs: HOUR_MS };
const WRONG_CODES_PER_ADDRESS_AND_NETWORK: RateLimitRule = { bucket: 'wrong-code:address-network', limit: 10, windowMs: DAY_MS };
const WRONG_CODES_PER_ADDRESS: RateLimitRule = { bucket: 'wrong-code:address', limit: 30, windowMs: DAY_MS };

interface AuthLimitKeys {
  network: string | null;
  address: string;
  addressAndNetwork: string;
  inbox: string;
}

async function authLimitKeys(request: Request, env: Env, email: string): Promise<AuthLimitKeys> {
  const ip = getClientIp(request);
  const network = ip ? networkKeyForIp(ip) : 'network:unknown';
  return {
    network: ip ? await hashRateLimitKey(env, network) : null,
    address: await hashRateLimitKey(env, `email:${email}`),
    addressAndNetwork: await hashRateLimitKey(env, `email:${email}|${network}`),
    inbox: await hashRateLimitKey(env, `inbox:${canonicalMailbox(email)}`),
  };
}

function signInEmailLimitMessage(rule: RateLimitRule): string {
  if (rule === SIGN_IN_EMAILS_PER_NETWORK) return 'Too many sign-in emails from this network. Try again in an hour.';
  if (rule === SIGN_IN_EMAILS_PER_INBOX) return 'Too many sign-in emails for this address. Try again in an hour.';
  return 'Too many sign-in emails for this address today. Try again tomorrow.';
}

/** The owner just proved the address, so earlier wrong guesses against it stop counting. */
async function clearWrongCodes(request: Request, env: Env, email: string): Promise<void> {
  const keys = await authLimitKeys(request, env, normalizeEmail(email));
  await clearRateLimitEvents(env, WRONG_CODES_PER_ADDRESS.bucket, keys.address);
  await clearRateLimitEvents(env, WRONG_CODES_PER_ADDRESS_AND_NETWORK.bucket, keys.addressAndNetwork);
}

// Founder numbers are a bonus and must never fail a sign-in whose link or code is already
// spent. The call is idempotent, so a miss is filled in on the next verified sign-in.
async function assignFounderNumberSafely(env: Env, userId: string, at: string): Promise<void> {
  try {
    await ensureFounderIdentityQualification(env, userId, at);
  } catch (error) {
    console.error('Founder number assignment failed; will retry on next sign-in', error);
  }
}

export async function handleRequestMagicLink(request: Request, env: Env): Promise<Response> {
  const body = await parseJsonBody<MagicLinkRequestBody>(request);
  const email = normalizeEmail(body.email);

  if (!isValidEmail(email)) {
    throw new HttpError(400, 'Please enter a valid email address.');
  }

  if (await hasRecentEmailSignInRequest(env, email, new Date(Date.now() - 60_000).toISOString())) {
    throw new HttpError(429, 'Wait a minute before requesting another sign-in email.');
  }
  const keys = await authLimitKeys(request, env, email);
  const slots = await takeRateLimitSlots(env, [
    ...(keys.network ? [{ rule: SIGN_IN_EMAILS_PER_NETWORK, keyHash: keys.network }] : []),
    { rule: SIGN_IN_EMAILS_PER_ADDRESS_AND_NETWORK, keyHash: keys.addressAndNetwork },
    { rule: SIGN_IN_EMAILS_PER_INBOX, keyHash: keys.inbox },
  ]);
  if (slots.limitedBy) {
    throw new HttpError(429, signInEmailLimitMessage(slots.limitedBy));
  }

  try {
    return await createAndSendSignInEmail(request, env, body, email);
  } catch (error) {
    // Nothing was sent (a 409, or the email provider failed), so it does not count.
    await releaseRateLimitSlots(env, slots.ids);
    throw error;
  }
}

async function createAndSendSignInEmail(
  request: Request,
  env: Env,
  body: MagicLinkRequestBody,
  email: string,
): Promise<Response> {
  const existingAuth = await loadOptionalRequestAuth(env, request);
  let purpose: MagicLinkRequestResponse['purpose'] = 'sign_in';
  let user: AuthUser;

  if (existingAuth?.source === 'session') {
    requireTrustedOriginForMutation(request);
    // Classroom accounts are created without an email; a child's personal address stays out.
    assertNotSchoolRestricted(existingAuth, 'add an email address');
    const existingEmailUser = await findUserByEmail(env, email);

    if (existingAuth.user.email && normalizeEmail(existingAuth.user.email) !== email) {
      throw new HttpError(409, 'This account is already linked to a different email.');
    }

    if (existingEmailUser && existingEmailUser.id !== existingAuth.user.id) {
      throw new HttpError(409, 'That email is already linked to another account.');
    }

    user = existingAuth.user;
    purpose = user.email ? 'sign_in' : 'link_email';
  } else {
    user = (await findUserByEmail(env, email)) ?? (await createUserForEmail(env, email));
  }
  const token = generateOpaqueToken(32);
  const tokenHash = await hashToken(token);
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
  const codeHash = await hashToken(`${tokenHash}:${code}`);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + MAGIC_LINK_TTL_MS).toISOString();

  await createMagicLinkToken(env, user.id, email, tokenHash, codeHash, expiresAt, now.toISOString());

  const returnBaseUrl = resolveMagicLinkReturnUrl(request, env, body.returnTo);
  const verifyBaseUrl = resolveMagicLinkVerifyBaseUrl(request, env, returnBaseUrl);
  const magicLinkUrl = new URL('/api/auth/verify', verifyBaseUrl);
  magicLinkUrl.searchParams.set('token', token);
  magicLinkUrl.searchParams.set('returnTo', returnBaseUrl);
  const magicLink = magicLinkUrl.toString();
  const responseBody: MagicLinkRequestResponse = {
    ok: true,
    purpose,
    delivery: env.AUTH_DEBUG_MAGIC_LINKS === '1'
      ? 'debug'
      : env.RESEND_API_KEY
        ? 'email'
        : 'debug',
  };

  if (env.AUTH_DEBUG_MAGIC_LINKS === '1') {
    responseBody.debugMagicLink = magicLink;
    responseBody.debugCode = code;
  } else if (env.RESEND_API_KEY) {
    await sendMagicLinkEmail(env, email, magicLink, code);
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
  const invalidRedirectUrl = buildMagicLinkRedirectUrl(request, env, url.searchParams.get('returnTo'), 'invalid');
  const token = url.searchParams.get('token');
  if (!token) {
    return redirectResponse(invalidRedirectUrl);
  }

  const tokenHash = await hashToken(token);
  const row = await loadMagicLinkByTokenHash(env, tokenHash);

  if (!row || row.consumed_at || isExpired(row.expires_at)) {
    return redirectResponse(invalidRedirectUrl);
  }

  let user: AuthUser = {
    id: row.user_id,
    email: row.user_email,
    walletAddress: row.wallet_address,
    displayName: row.display_name,
    username: row.username ?? null,
    createdAt: row.user_created_at,
    avatarUrl: row.avatar_url,
    bio: row.bio,
    selectedAvatarId: row.selected_avatar_id,
  };

  let authResult: 'email' | 'email-linked' = 'email';
  if (!user.email) {
    user = await attachEmailToUser(env, user, row.email);
    authResult = 'email-linked';
  } else if (normalizeEmail(user.email) !== normalizeEmail(row.email)) {
    return redirectResponse(invalidRedirectUrl);
  }

  const now = new Date().toISOString();
  if (!await consumeMagicLinkToken(env, row.id, now)) {
    return redirectResponse(invalidRedirectUrl);
  }
  const sessionToken = await createSession(env, user.id);
  // Accounts made by typing an email get their founder number only once the email is proven.
  await assignFounderNumberSafely(env, user.id, now);
  await clearWrongCodes(request, env, row.email);
  const redirectUrl = buildMagicLinkRedirectUrl(
    request,
    env,
    url.searchParams.get('returnTo'),
    authResult,
  );

  return redirectResponse(redirectUrl, {
    'Set-Cookie': createSessionCookie(request, sessionToken),
  });
}

export async function handleVerifyEmailCode(request: Request, env: Env): Promise<Response> {
  requireTrustedOriginForMutation(request);
  const body = await parseJsonBody<EmailCodeVerifyBody>(request);
  const email = normalizeEmail(body.email);
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
    throw new HttpError(400, 'Enter your email and six-digit code.');
  }
  const keys = await authLimitKeys(request, env, email);
  const guess = await takeRateLimitSlots(env, [
    ...(keys.network ? [{ rule: WRONG_CODES_PER_NETWORK, keyHash: keys.network }] : []),
    { rule: WRONG_CODES_PER_ADDRESS_AND_NETWORK, keyHash: keys.addressAndNetwork },
    { rule: WRONG_CODES_PER_ADDRESS, keyHash: keys.address },
  ]);
  if (guess.limitedBy) {
    throw new HttpError(429, guess.limitedBy === WRONG_CODES_PER_NETWORK
      ? 'Too many incorrect codes from this network. Use the link in your email, or try again in an hour.'
      : 'Too many incorrect codes for this email today. Use the link in your email instead.');
  }

  // Every guess holds a slot up front so parallel guesses cannot slip past the caps; only a
  // wrong code keeps it.
  let wrongCode = false;
  try {
    return await signInWithEmailCode(request, env, email, code);
  } catch (error) {
    wrongCode = error instanceof HttpError && error.message.startsWith('Incorrect code');
    throw error;
  } finally {
    if (!wrongCode) {
      await releaseRateLimitSlots(env, guess.ids);
    }
  }
}

async function signInWithEmailCode(request: Request, env: Env, email: string, code: string): Promise<Response> {
  // The newest two codes both work, so typing the code from an earlier email after pressing
  // resend is not counted as a wrong guess.
  const rows = await loadLiveEmailCodes(env, email, new Date().toISOString());
  const newest = rows[0];
  if (!newest || newest.code_attempts >= 5) {
    throw new HttpError(400, 'Code expired or invalid. Request a new email.');
  }
  if (!await recordEmailCodeAttempt(env, newest.id)) {
    throw new HttpError(400, 'Too many attempts. Request a new email.');
  }
  let row: MagicLinkJoinRow | null = null;
  for (const candidate of rows) {
    if (await hashToken(`${candidate.token_hash}:${code}`) === candidate.code_hash) {
      row = candidate;
      break;
    }
  }
  if (!row) {
    throw new HttpError(400, 'Incorrect code. Check the email and try again.');
  }
  let user: AuthUser = {
    id: row.user_id, email: row.user_email, walletAddress: row.wallet_address,
    displayName: row.display_name, username: row.username ?? null,
    createdAt: row.user_created_at, avatarUrl: row.avatar_url,
    bio: row.bio, selectedAvatarId: row.selected_avatar_id,
  };
  if (!user.email) {
    user = await attachEmailToUser(env, user, row.email);
  } else if (normalizeEmail(user.email) !== email) {
    throw new HttpError(400, 'Code expired or invalid. Request a new email.');
  }
  const verifiedAt = new Date().toISOString();
  if (!await consumeMagicLinkToken(env, row.id, verifiedAt)) {
    throw new HttpError(400, 'Code already used. Request a new email.');
  }
  const sessionToken = await createSession(env, user.id);
  await assignFounderNumberSafely(env, user.id, verifiedAt);
  await clearWrongCodes(request, env, email);
  return jsonResponse(request, { ok: true }, {
    headers: { 'Set-Cookie': createSessionCookie(request, sessionToken) },
  });
}

function resolveMagicLinkReturnUrl(request: Request, env: Env, candidate: unknown): string {
  if (typeof candidate !== 'string' || !candidate.trim()) {
    return resolveMagicLinkReturnBase(request, env);
  }

  const trustedBase = resolveMagicLinkRedirectBase(request, env, candidate);
  try {
    const parsed = new URL(candidate.trim());
    if (parsed.origin === trustedBase) {
      return parsed.toString();
    }
  } catch {
    // Fall back to the trusted origin below.
  }

  return trustedBase;
}

function resolveMagicLinkVerifyBaseUrl(request: Request, env: Env, returnBaseUrl: string): string {
  if (env.AUTH_DEBUG_MAGIC_LINKS === '1') {
    try {
      const parsedReturnUrl = new URL(returnBaseUrl);
      if (isLocalMagicLinkHostname(parsedReturnUrl.hostname)) {
        return parsedReturnUrl.origin;
      }
    } catch {
      // Fall back to the worker origin below.
    }
  }

  return new URL(request.url).origin;
}

function isLocalMagicLinkHostname(hostname: string): boolean {
  return (
    hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '[::1]'
    || hostname === '::1'
  );
}

function buildMagicLinkRedirectUrl(
  request: Request,
  env: Env,
  candidate: string | null,
  authResult: 'email' | 'email-linked' | 'invalid',
): string {
  const redirectUrl = new URL(resolveMagicLinkReturnUrl(request, env, candidate ?? undefined));
  redirectUrl.searchParams.set('auth', authResult);
  return redirectUrl.toString();
}

export async function handleLogout(request: Request, env: Env): Promise<Response> {
  const existing = await loadCurrentSession(env, request);
  if (existing) {
    requireTrustedOriginForMutation(request);
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
  assertNotSchoolRestricted(auth, 'change their display name');
  const body = await parseJsonBody<DisplayNameUpdateRequestBody>(request);
  const displayName = normalizeDisplayName(body.displayName);

  if (!displayName) {
    throw new HttpError(400, 'Display name is required.');
  }

  if (displayName.length > 24) {
    throw new HttpError(400, 'Display name must be 24 characters or fewer.');
  }

  await assertGeneratedOnlyDisplayNameChangeAllowed(env, auth.user, displayName);

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
  await assertUserNotSchoolManaged(env, session.user.id, 'create API tokens');
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
    assertNotSchoolRestricted(existingAuth, 'link a wallet');

    user = await attachWalletToUser(env, existingAuth.user, address);
    linkedWallet = true;
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

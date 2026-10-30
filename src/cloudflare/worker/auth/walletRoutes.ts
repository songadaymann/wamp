import { verifyMessage } from 'viem';
import type { AuthUser, WalletChallengeRequestBody, WalletChallengeResponse, WalletVerifyRequestBody, WalletVerifyResponse } from '../../../auth/model';
import { HttpError, jsonResponse, parseJsonBody } from '../core/http';
import type { Env, RequestAuth, WalletChallengeRow } from '../core/types';
import { assertNotSchoolRestricted } from '../school/restrictions';
import { createSessionCookie, hasSessionCookie, loadOptionalRequestAuth, requireTrustedOriginForMutation } from './request';
import {
  WALLET_CHALLENGE_TTL_MS, attachWalletToUser, consumeWalletChallenge, createSession, createUserForWallet,
  createWalletChallenge, createWalletChallengeMessage, extractNonceFromWalletMessage, findUserByWallet,
  generateOpaqueToken, hashToken, isExpired, isValidAddress, loadWalletChallengeByNonceHash, normalizeAddress,
} from './store';

const RESTART = 'Your sign-in changed. Refresh WAMP, then try linking your wallet again.';
const EXPIRED = 'Wallet approval expired or was already used. Try again for a new signature request.';

async function walletAuth(request: Request, env: Env): Promise<RequestAuth | null> {
  requireTrustedOriginForMutation(request);
  if (hasSessionCookie(request) && !request.headers.get('Origin')) throw new HttpError(403, 'Open WAMP in your browser to link a wallet.');
  const auth = await loadOptionalRequestAuth(env, request);
  if (auth && (auth.source !== 'session' || !auth.session)) throw new HttpError(403, 'Sign in to WAMP in your browser to link a wallet. API tokens cannot link wallets.');
  if (!auth && hasSessionCookie(request)) throw new HttpError(401, RESTART);
  if (auth) assertNotSchoolRestricted(auth, 'link a wallet');
  return auth;
}

function challengeMatchesAuth(challenge: WalletChallengeRow, auth: RequestAuth | null): boolean {
  if (challenge.purpose === 'sign_in') return !auth && !challenge.target_user_id && !challenge.target_session_id;
  return challenge.purpose === 'link_wallet' && auth?.source === 'session'
    && challenge.target_user_id === auth.user.id && challenge.target_session_id === auth.session?.sessionId;
}

export async function handleWalletChallenge(request: Request, env: Env): Promise<Response> {
  env = { ...env, DB: env.DB.withSession?.('first-primary') ?? env.DB };
  const auth = await walletAuth(request, env);
  const body = await parseJsonBody<WalletChallengeRequestBody>(request, { maxBytes: 1024 });
  const address = typeof body?.address === 'string' ? normalizeAddress(body.address) : '';
  if (!isValidAddress(address)) throw new HttpError(400, 'Wallet address must be a valid EVM address.');
  // The caller's expected account is a condition, never a source of authority.
  if (body.expectedUserId !== undefined) {
    if (body.expectedUserId !== null && typeof body.expectedUserId !== 'string') throw new HttpError(400, 'Wallet sign-in account is invalid.');
    if (body.expectedUserId !== (auth?.user.id ?? null)) throw new HttpError(409, RESTART);
  }
  if (auth?.user.walletAddress && auth.user.walletAddress.toLowerCase() !== address) {
    throw new HttpError(409, 'This WAMP account already has a different wallet. Switch your wallet app to the linked address. Changing the linked wallet is not available yet.');
  }
  const nonce = generateOpaqueToken(24), now = new Date();
  const issuedAt = now.toISOString(), expiresAt = new Date(now.getTime() + WALLET_CHALLENGE_TTL_MS).toISOString();
  const target = auth?.session ? { userId: auth.user.id, sessionId: auth.session.sessionId } : undefined;
  const message = createWalletChallengeMessage(request, env, address, nonce, issuedAt, target ? auth?.user : undefined);
  await createWalletChallenge(env, address, await hashToken(nonce), message, expiresAt, issuedAt, target);
  const responseBody: WalletChallengeResponse = { address, message, expiresAt };
  return jsonResponse(request, responseBody, { headers: { 'Cache-Control': 'no-store' } });
}

export async function handleWalletVerify(request: Request, env: Env): Promise<Response> {
  env = { ...env, DB: env.DB.withSession?.('first-primary') ?? env.DB };
  const auth = await walletAuth(request, env);
  const body = await parseJsonBody<WalletVerifyRequestBody>(request, { maxBytes: 8192 });
  const address = typeof body?.address === 'string' ? normalizeAddress(body.address) : '';
  if (!isValidAddress(address)) throw new HttpError(400, 'Wallet address must be a valid EVM address.');
  if (typeof body.message !== 'string' || typeof body.signature !== 'string' || !/^0x[\da-f]+$/i.test(body.signature)) {
    throw new HttpError(400, 'Wallet approval is invalid. Try again for a new signature request.');
  }
  const nonce = extractNonceFromWalletMessage(body.message);
  if (!nonce) throw new HttpError(400, 'Wallet challenge message is invalid.');
  const challenge = await loadWalletChallengeByNonceHash(env, await hashToken(nonce));
  if (!challenge || challenge.consumed_at || isExpired(challenge.expires_at)) throw new HttpError(401, EXPIRED);
  if (!challengeMatchesAuth(challenge, auth)) throw new HttpError(409, RESTART);
  if (challenge.address !== address || challenge.message_text !== body.message) {
    throw new HttpError(401, 'Wallet challenge did not match the requested address.');
  }
  let verified = false;
  try {
    verified = await verifyMessage({ address: address as `0x${string}`, message: body.message, signature: body.signature as `0x${string}` });
  } catch {
    // A malformed or unsupported signature is a failed proof, not a server error.
  }
  if (!verified) throw new HttpError(401, 'Wallet signature could not be verified. Try again with the connected wallet.');
  if (!await consumeWalletChallenge(env, challenge.id, new Date().toISOString())) throw new HttpError(401, EXPIRED);
  let user: AuthUser, setCookie: string | null = null;
  if (auth?.session) {
    user = await attachWalletToUser(env, auth.user, address, auth.session.sessionId);
  } else {
    const existing = await findUserByWallet(env, address);
    if (existing) user = existing;
    else {
      try { user = await createUserForWallet(env, address); }
      catch (error) {
        // A second valid proof can create this wallet's user at the same time.
        if (!(error instanceof Error) || !/UNIQUE constraint failed: users\.(wallet_address|username)/.test(error.message)) throw error;
        const raced = await findUserByWallet(env, address);
        if (!raced) throw error;
        user = raced;
      }
    }
    setCookie = createSessionCookie(request, await createSession(env, user.id));
  }
  const responseBody: WalletVerifyResponse = { authenticated: true, linkedWallet: Boolean(auth), user };
  return jsonResponse(request, responseBody, { headers: { 'Cache-Control': 'no-store', ...(setCookie ? { 'Set-Cookie': setCookie } : {}) } });
}

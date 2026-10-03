import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env, MagicLinkJoinRow } from '../core/types';

const authStore = vi.hoisted(() => ({
  row: null as MagicLinkJoinRow | null,
  attempts: 0,
  consumed: false,
  sessions: 0,
}));

const limitEvents = vi.hoisted(() => new Map<string, number[]>());
vi.mock('../core/rateLimit', async (importOriginal) => {
  const original = await importOriginal<typeof import('../core/rateLimit')>();
  return {
    ...original,
    hashRateLimitKey: vi.fn(async (_env: unknown, value: string) => value),
    isRateLimited: vi.fn(async (_env: unknown, rule: { bucket: string; limit: number; windowMs: number }, key: string) => {
      const since = Date.now() - rule.windowMs;
      return (limitEvents.get(`${rule.bucket}|${key}`) ?? []).filter((at) => at > since).length >= rule.limit;
    }),
    recordRateLimitEvent: vi.fn(async (_env: unknown, bucket: string, key: string) => {
      const list = limitEvents.get(`${bucket}|${key}`) ?? [];
      list.push(Date.now());
      limitEvents.set(`${bucket}|${key}`, list);
    }),
  };
});
const founder = vi.hoisted(() => ({ assignedTo: [] as string[] }));
vi.mock('../progression/awards', () => ({
  ensureFounderIdentityQualification: vi.fn(async (_env: unknown, userId: string) => {
    founder.assignedTo.push(userId);
    return 1;
  }),
}));

vi.mock('./store', async (importOriginal) => {
  const original = await importOriginal<typeof import('./store')>();
  return {
    ...original,
    loadLatestEmailCode: vi.fn(async () => authStore.row),
    recordEmailCodeAttempt: vi.fn(async () => {
      if (authStore.consumed || authStore.attempts >= 5) return false;
      authStore.attempts += 1;
      if (authStore.row) authStore.row.code_attempts = authStore.attempts;
      return true;
    }),
    consumeMagicLinkToken: vi.fn(async () => {
      if (authStore.consumed) return false;
      authStore.consumed = true;
      if (authStore.row) authStore.row.consumed_at = new Date().toISOString();
      return true;
    }),
    createSession: vi.fn(async () => {
      authStore.sessions += 1;
      return 'session-token';
    }),
    hasRecentEmailSignInRequest: vi.fn(async () => false),
    findUserByEmail: vi.fn(async () => ({ id: 'player', email, walletAddress: null, displayName: 'Player', username: 'player', createdAt: '' })),
    createMagicLinkToken: vi.fn(async () => {}),
  };
});

import { handleRequestMagicLink, handleVerifyEmailCode } from './routes';
import { hashToken } from './store';

const env = {} as Env;
const email = 'player@example.com';
const code = '123456';

function request(enteredCode: string, ip = '203.0.113.7', forEmail = email): Request {
  return new Request('https://api.wamp.land/api/auth/verify-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://wamp.land', 'CF-Connecting-IP': ip },
    body: JSON.stringify({ email: forEmail, code: enteredCode }),
  });
}

function sendNewCode(): void {
  authStore.attempts = 0;
  authStore.consumed = false;
  if (authStore.row) {
    authStore.row.code_attempts = 0;
    authStore.row.consumed_at = null;
  }
}

beforeEach(async () => {
  limitEvents.clear();
  founder.assignedTo = [];
  authStore.attempts = 0;
  authStore.consumed = false;
  authStore.sessions = 0;
  authStore.row = {
    id: 'email-request', user_id: 'player', email,
    token_hash: 'token-hash', code_hash: await hashToken(`token-hash:${code}`),
    code_attempts: 0, expires_at: new Date(Date.now() + 600_000).toISOString(),
    consumed_at: null, created_at: new Date().toISOString(),
    user_email: email, wallet_address: null, display_name: 'Player',
    avatar_url: null, bio: null, selected_avatar_id: null,
    user_created_at: new Date().toISOString(),
  };
});

describe('email sign-in code', () => {
  it('signs in once and consumes the matching link request', async () => {
    const response = await handleVerifyEmailCode(request(code), env);
    expect(response.status).toBe(200);
    expect(response.headers.get('Set-Cookie')).toContain('session-token');
    expect(authStore.consumed).toBe(true);
    expect(authStore.sessions).toBe(1);
    expect(founder.assignedTo).toEqual(['player']);
    await expect(handleVerifyEmailCode(request(code), env)).rejects.toThrow('Code expired or invalid');
    expect(authStore.sessions).toBe(1);
  });

  it('caps wrong guesses per email across every code sent, so codes cannot be ground down over days', async () => {
    for (let guess = 0; guess < 10; guess += 1) {
      if (guess % 5 === 0) sendNewCode();
      await expect(handleVerifyEmailCode(request('000000', `198.51.100.${guess}`), env)).rejects.toThrow('Incorrect code');
    }
    sendNewCode();
    await expect(handleVerifyEmailCode(request(code, '198.51.100.99'), env)).rejects.toThrow('Too many incorrect codes for this email');
    expect(authStore.sessions).toBe(0);
  });

  it('caps wrong guesses per network across many email addresses', async () => {
    for (let guess = 0; guess < 30; guess += 1) {
      sendNewCode();
      await expect(handleVerifyEmailCode(request('000000'), env)).rejects.toThrow('Incorrect code');
      limitEvents.delete(`wrong-code:address|email:${email}`);
    }
    sendNewCode();
    await expect(handleVerifyEmailCode(request(code), env)).rejects.toThrow('Too many incorrect codes from this network');
  });

  it('stops trying after five wrong codes', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(handleVerifyEmailCode(request('000000'), env)).rejects.toThrow('Incorrect code');
    }
    await expect(handleVerifyEmailCode(request(code), env)).rejects.toThrow('Code expired or invalid');
    expect(authStore.sessions).toBe(0);
  });
});

describe('sign-in email requests', () => {
  const debugEnv = { AUTH_DEBUG_MAGIC_LINKS: '1' } as Env;
  const requestLink = (ip: string, forEmail = email) => new Request('https://api.wamp.land/api/auth/request-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify({ email: forEmail }),
  });

  it('caps sign-in emails to one address per day, even from many networks', async () => {
    for (let sent = 0; sent < 10; sent += 1) {
      expect((await handleRequestMagicLink(requestLink(`192.0.2.${sent}`), debugEnv)).status).toBe(200);
    }
    await expect(handleRequestMagicLink(requestLink('192.0.2.200'), debugEnv)).rejects.toThrow('Too many sign-in emails for this address today');
  });

  it('caps sign-in emails from one network across many addresses', async () => {
    for (let sent = 0; sent < 30; sent += 1) {
      expect((await handleRequestMagicLink(requestLink('192.0.2.50', `person${sent}@example.com`), debugEnv)).status).toBe(200);
    }
    await expect(handleRequestMagicLink(requestLink('192.0.2.50', 'one-more@example.com'), debugEnv)).rejects.toThrow('Too many sign-in emails from this network');
  });
});

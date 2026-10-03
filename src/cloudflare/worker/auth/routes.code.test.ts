import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env, MagicLinkJoinRow } from '../core/types';

const authStore = vi.hoisted(() => ({
  row: null as MagicLinkJoinRow | null,
  olderRow: null as MagicLinkJoinRow | null,
  attempts: 0,
  consumed: false,
  sessions: 0,
  failSend: false,
}));

// In-memory stand-in for rate_limit_events with the same take/release/clear semantics.
const limits = vi.hoisted(() => ({ events: [] as Array<{ id: number; bucket: string; key: string; at: number }>, nextId: 1 }));
vi.mock('../core/rateLimit', async (importOriginal) => {
  const original = await importOriginal<typeof import('../core/rateLimit')>();
  return {
    ...original,
    hashRateLimitKey: vi.fn(async (_env: unknown, value: string) => value),
    takeRateLimitSlots: vi.fn(async (_env: unknown, checks: Array<{ rule: { bucket: string; limit: number; windowMs: number }; keyHash: string }>) => {
      const now = Date.now();
      for (const { rule, keyHash } of checks) {
        const used = limits.events.filter((e) => e.bucket === rule.bucket && e.key === keyHash && e.at > now - rule.windowMs).length;
        if (used >= rule.limit) return { ids: [], limitedBy: rule };
      }
      const ids = checks.map(({ rule, keyHash }) => {
        const id = limits.nextId++;
        limits.events.push({ id, bucket: rule.bucket, key: keyHash, at: now });
        return id;
      });
      return { ids, limitedBy: null };
    }),
    releaseRateLimitSlots: vi.fn(async (_env: unknown, ids: number[]) => {
      limits.events = limits.events.filter((e) => !ids.includes(e.id));
    }),
    clearRateLimitEvents: vi.fn(async (_env: unknown, bucket: string, key: string) => {
      limits.events = limits.events.filter((e) => !(e.bucket === bucket && e.key === key));
    }),
  };
});
const founder = vi.hoisted(() => ({ assignedTo: [] as string[], fail: false }));
vi.mock('../progression/awards', () => ({
  ensureFounderIdentityQualification: vi.fn(async (_env: unknown, userId: string) => {
    if (founder.fail) throw new Error('D1 overloaded');
    founder.assignedTo.push(userId);
    return 1;
  }),
}));

vi.mock('./store', async (importOriginal) => {
  const original = await importOriginal<typeof import('./store')>();
  const live = (row: MagicLinkJoinRow | null) => row && !row.consumed_at && Date.parse(row.expires_at) > Date.now();
  return {
    ...original,
    loadLiveEmailCodes: vi.fn(async () => [authStore.row, authStore.olderRow].filter(live)),
    recordEmailCodeAttempt: vi.fn(async () => {
      if (authStore.consumed || authStore.attempts >= 5) return false;
      authStore.attempts += 1;
      if (authStore.row) authStore.row.code_attempts = authStore.attempts;
      return true;
    }),
    consumeMagicLinkToken: vi.fn(async (_env: unknown, id: string) => {
      const target = [authStore.row, authStore.olderRow].find((row) => row?.id === id);
      if (!target || target.consumed_at) return false;
      target.consumed_at = new Date().toISOString();
      authStore.consumed = target === authStore.row;
      return true;
    }),
    createSession: vi.fn(async () => {
      authStore.sessions += 1;
      return 'session-token';
    }),
    hasRecentEmailSignInRequest: vi.fn(async () => false),
    findUserByEmail: vi.fn(async (_env: unknown, address: string) => ({ id: 'player', email: address, walletAddress: null, displayName: 'Player', username: 'player', createdAt: '' })),
    createMagicLinkToken: vi.fn(async () => {}),
    sendMagicLinkEmail: vi.fn(async () => {
      if (authStore.failSend) throw new Error('Failed to send sign-in email');
    }),
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

async function codeRow(id: string, rowCode: string): Promise<MagicLinkJoinRow> {
  return {
    id, user_id: 'player', email,
    token_hash: `${id}-hash`, code_hash: await hashToken(`${id}-hash:${rowCode}`),
    code_attempts: 0, expires_at: new Date(Date.now() + 600_000).toISOString(),
    consumed_at: null, created_at: new Date().toISOString(),
    user_email: email, wallet_address: null, display_name: 'Player',
    avatar_url: null, bio: null, selected_avatar_id: null,
    user_created_at: new Date().toISOString(),
  };
}

async function sendNewCode(rowCode = code): Promise<void> {
  authStore.attempts = 0;
  authStore.consumed = false;
  authStore.row = await codeRow(`request-${limits.nextId}-${Math.random()}`, rowCode);
}

async function guessWrong(ip: string, forEmail = email): Promise<void> {
  if (authStore.attempts >= 5) await sendNewCode();
  await expect(handleVerifyEmailCode(request('000000', ip, forEmail), env)).rejects.toThrow('Incorrect code');
}

beforeEach(async () => {
  limits.events = [];
  founder.assignedTo = [];
  founder.fail = false;
  authStore.olderRow = null;
  authStore.sessions = 0;
  authStore.failSend = false;
  await sendNewCode();
});

describe('email sign-in code', () => {
  it('signs in once, assigns the founder number, and consumes the code', async () => {
    const response = await handleVerifyEmailCode(request(code), env);
    expect(response.status).toBe(200);
    expect(response.headers.get('Set-Cookie')).toContain('session-token');
    expect(authStore.sessions).toBe(1);
    expect(founder.assignedTo).toEqual(['player']);
    await expect(handleVerifyEmailCode(request(code), env)).rejects.toThrow('Code expired or invalid');
    expect(authStore.sessions).toBe(1);
  });

  it('still signs in if assigning the founder number fails', async () => {
    founder.fail = true;
    expect((await handleVerifyEmailCode(request(code), env)).status).toBe(200);
    expect(authStore.sessions).toBe(1);
  });

  it('accepts the code from the previous email after a resend', async () => {
    authStore.olderRow = await codeRow('older', '654321');
    expect((await handleVerifyEmailCode(request('654321'), env)).status).toBe(200);
    expect(limits.events).toHaveLength(0);
  });

  it('caps wrong guesses from one network against one email at 10 a day, across every code sent', async () => {
    for (let guess = 0; guess < 10; guess += 1) await guessWrong('198.51.100.1');
    await sendNewCode();
    await expect(handleVerifyEmailCode(request(code, '198.51.100.1'), env)).rejects.toThrow('Too many incorrect codes for this email today');
  });

  it('caps wrong guesses against one email at 30 a day even when spread across networks', async () => {
    for (let guess = 0; guess < 30; guess += 1) await guessWrong(`198.51.100.${10 + Math.floor(guess / 9)}`);
    await sendNewCode();
    await expect(handleVerifyEmailCode(request(code, '198.51.100.200'), env)).rejects.toThrow('Too many incorrect codes for this email today');
  });

  it('caps wrong guesses from one network across many emails', async () => {
    for (let guess = 0; guess < 100; guess += 1) {
      await sendNewCode();
      await guessWrong('192.0.2.9', `person${guess}@example.com`);
    }
    await sendNewCode();
    await expect(handleVerifyEmailCode(request(code, '192.0.2.9'), env)).rejects.toThrow('Too many incorrect codes from this network');
  });

  it('treats a whole IPv6 /64 as one network', async () => {
    for (let guess = 0; guess < 100; guess += 1) {
      await sendNewCode();
      await guessWrong(`2001:db8:1:2::${guess.toString(16)}`, `person${guess}@example.com`);
    }
    await sendNewCode();
    await expect(handleVerifyEmailCode(request(code, '2001:db8:1:2:ffff::1'), env)).rejects.toThrow('from this network');
  });

  it("does not count correct codes, and signing in clears the owner's wrong guesses", async () => {
    for (let guess = 0; guess < 9; guess += 1) await guessWrong('203.0.113.7');
    await sendNewCode();
    expect((await handleVerifyEmailCode(request(code), env)).status).toBe(200);
    for (let guess = 0; guess < 10; guess += 1) {
      if (guess === 0) await sendNewCode();
      await guessWrong('203.0.113.7');
    }
  });
});

describe('sign-in email requests', () => {
  const debugEnv = { AUTH_DEBUG_MAGIC_LINKS: '1' } as Env;
  const requestLink = (ip: string, forEmail = email) => new Request('https://api.wamp.land/api/auth/request-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify({ email: forEmail }),
  });

  it('caps one network at 10 emails a day to one address, without locking the owner out elsewhere', async () => {
    for (let sent = 0; sent < 10; sent += 1) {
      expect((await handleRequestMagicLink(requestLink('192.0.2.1'), debugEnv)).status).toBe(200);
    }
    await expect(handleRequestMagicLink(requestLink('192.0.2.1'), debugEnv)).rejects.toThrow('Too many sign-in emails for this address today');
    expect((await handleRequestMagicLink(requestLink('198.51.100.77'), debugEnv)).status).toBe(200);
  });

  it('treats plus-tags and Gmail dots as one inbox for the hourly flood cap', async () => {
    const variants = Array.from({ length: 20 }, (_, n) => (n % 2 ? `victim+${n}@gmail.com` : `vic.tim${'.'.repeat(n % 3)}@gmail.com`.replace('..', '.')));
    for (const [n, variant] of variants.entries()) {
      expect((await handleRequestMagicLink(requestLink(`192.0.2.${n + 20}`, variant), debugEnv)).status).toBe(200);
    }
    await expect(handleRequestMagicLink(requestLink('192.0.2.99', 'v.i.c.t.i.m+x@gmail.com'), debugEnv)).rejects.toThrow('Try again in an hour');
  });

  it('caps sign-in emails from one network across many addresses at 150 an hour', async () => {
    for (let sent = 0; sent < 150; sent += 1) {
      expect((await handleRequestMagicLink(requestLink('192.0.2.50', `person${sent}@example.com`), debugEnv)).status).toBe(200);
    }
    await expect(handleRequestMagicLink(requestLink('192.0.2.50', 'one-more@example.com'), debugEnv)).rejects.toThrow('Too many sign-in emails from this network');
  });

  it('does not count emails that failed to send', async () => {
    authStore.failSend = true;
    for (let tries = 0; tries < 12; tries += 1) {
      await expect(handleRequestMagicLink(requestLink('192.0.2.5'), { RESEND_API_KEY: 'key' } as Env)).rejects.toThrow('Failed to send');
    }
    expect(limits.events).toHaveLength(0);
  });
});

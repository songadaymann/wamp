import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env, MagicLinkJoinRow } from '../core/types';

const authStore = vi.hoisted(() => ({
  row: null as MagicLinkJoinRow | null,
  attempts: 0,
  consumed: false,
  sessions: 0,
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
  };
});

import { handleVerifyEmailCode } from './routes';
import { hashToken } from './store';

const env = {} as Env;
const email = 'player@example.com';
const code = '123456';

function request(enteredCode: string): Request {
  return new Request('https://api.wamp.land/api/auth/verify-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://wamp.land' },
    body: JSON.stringify({ email, code: enteredCode }),
  });
}

beforeEach(async () => {
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
    await expect(handleVerifyEmailCode(request(code), env)).rejects.toThrow('Code expired or invalid');
    expect(authStore.sessions).toBe(1);
  });

  it('stops trying after five wrong codes', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(handleVerifyEmailCode(request('000000'), env)).rejects.toThrow('Incorrect code');
    }
    await expect(handleVerifyEmailCode(request(code), env)).rejects.toThrow('Code expired or invalid');
    expect(authStore.sessions).toBe(0);
  });
});

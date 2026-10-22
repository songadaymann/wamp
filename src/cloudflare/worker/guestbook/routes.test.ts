import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixture } from '../activity/testDatabase';
import { handleGuestbookRequest } from './routes';

const opened: ReturnType<typeof fixture>[] = [];
let siteverifySecrets: string[] = [];
let siteverifySuccess = true;

function setup(secrets: { TURNSTILE_SECRET?: string; TURNSTILE_SECRET_KEY?: string } = { TURNSTILE_SECRET_KEY: 'secret-key' }) {
  const f = fixture();
  Object.assign(f.env, { TURNSTILE_SITE_KEY: 'site-key', ...secrets });
  opened.push(f);
  siteverifySecrets = [];
  siteverifySuccess = true;
  vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    siteverifySecrets.push(new URLSearchParams(String(init?.body)).get('secret') ?? '');
    return Response.json({ success: siteverifySuccess });
  }));
  return f;
}
afterEach(() => {
  vi.unstubAllGlobals();
  for (const f of opened.splice(0)) f.sqlite.close();
});

let sessionCounter = 0;
function sign(f: ReturnType<typeof fixture>, options: { ip?: string | null; session?: string | null; headers?: Record<string, string> } = {}) {
  const ip = options.ip === undefined ? '203.0.113.9' : options.ip;
  const session = options.session === undefined ? `session-${String(sessionCounter += 1).padStart(4, '0')}` : options.session;
  const request = new Request('https://api.wamp.land/api/guestbook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://wamp.land', ...(ip ? { 'CF-Connecting-IP': ip } : {}), ...options.headers },
    body: JSON.stringify({ displayName: 'Visitor', body: 'Nice game!', guestSessionId: session, turnstileToken: 'token' }),
  });
  return handleGuestbookRequest(request, new URL(request.url), f.env);
}
const entryCount = (f: ReturnType<typeof fixture>) => (f.sqlite.prepare('SELECT COUNT(*) AS n FROM guestbook_entries').get() as { n: number }).n;

describe('guestbook signing limits (F422)', () => {
  it('allows five entries an hour per network, counting an IPv6 /64 as one network', async () => {
    const f = setup();
    for (let index = 0; index < 5; index += 1) expect((await sign(f, { ip: `2001:db8:1:2::${index + 1}` })).status).toBe(201);
    await expect(sign(f, { ip: '2001:db8:1:2::99' })).rejects.toMatchObject({
      status: 429, message: 'Too many guestbook entries from this network. Try again later.',
    });
    expect((await sign(f, { ip: '198.51.100.20' })).status).toBe(201);
    expect(entryCount(f)).toBe(6);
  });

  it('keys the network on CF-Connecting-IP only, never X-Forwarded-For', async () => {
    const f = setup();
    for (let index = 0; index < 5; index += 1) {
      expect((await sign(f, { ip: null, headers: { 'X-Forwarded-For': `198.51.100.${index}` } })).status).toBe(201);
    }
    await expect(sign(f, { ip: null, headers: { 'X-Forwarded-For': '198.51.100.50' } })).rejects.toMatchObject({ status: 429 });
    expect(f.sqlite.prepare('SELECT DISTINCT ip_hash FROM guestbook_entries').all()).toEqual([{ ip_hash: null }]);
  });

  it('keeps the per-session minute and day limits', async () => {
    const f = setup();
    expect((await sign(f, { session: 'session-same' })).status).toBe(201);
    await expect(sign(f, { session: 'session-same', ip: '198.51.100.20' })).rejects.toMatchObject({
      status: 429, message: 'Please wait a minute before signing again.',
    });
    const old = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    f.sqlite.prepare("UPDATE rate_limit_events SET created_at = ? WHERE bucket LIKE 'guestbook:session-%'").run(old);
    const insert = f.sqlite.prepare('INSERT INTO rate_limit_events (bucket, key_hash, created_at) SELECT bucket, key_hash, ? FROM rate_limit_events WHERE bucket = ? LIMIT 1');
    for (let index = 0; index < 9; index += 1) insert.run(old, 'guestbook:session-day');
    await expect(sign(f, { session: 'session-same', ip: '198.51.100.21' })).rejects.toMatchObject({
      status: 429, message: 'This browser has signed the guestbook enough for today.',
    });
  });

  it('gives back the slots when Turnstile fails', async () => {
    const f = setup();
    siteverifySuccess = false;
    for (let index = 0; index < 6; index += 1) {
      await expect(sign(f, { session: 'session-retry' })).rejects.toMatchObject({ status: 403 });
    }
    siteverifySuccess = true;
    expect((await sign(f, { session: 'session-retry' })).status).toBe(201);
    expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM rate_limit_events WHERE bucket LIKE 'guestbook:%'").get()).toEqual({ n: 3 });
  });
});

describe('guestbook Turnstile secret', () => {
  it('reads TURNSTILE_SECRET first and falls back to TURNSTILE_SECRET_KEY', async () => {
    let f = setup({ TURNSTILE_SECRET_KEY: 'secret-key', TURNSTILE_SECRET: 'guestbook-secret' });
    expect((await sign(f)).status).toBe(201);
    expect(siteverifySecrets).toEqual(['guestbook-secret']);

    f = setup({ TURNSTILE_SECRET_KEY: 'secret-key' });
    expect((await sign(f)).status).toBe(201);
    expect(siteverifySecrets).toEqual(['secret-key']);

    f = setup({});
    await expect(sign(f)).rejects.toMatchObject({ status: 503 });
    expect(siteverifySecrets).toEqual([]);
    expect(entryCount(f)).toBe(0);
  });
});

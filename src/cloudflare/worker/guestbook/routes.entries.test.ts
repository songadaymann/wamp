import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { GuestbookCreateResponse, GuestbookListResponse } from '../../../guestbook/model';
import worker from '../../worker';
import { NOW, fixture } from '../activity/testDatabase';
import { createSession } from '../auth/store';

// Through the Worker's router; routes.test.ts covers the per-network and per-session limits in detail.
let f: ReturnType<typeof fixture>;
let sessions: Map<string, string>;
let siteverify: Mock<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>;
beforeEach(() => {
  f = fixture();
  Object.assign(f.env, { TURNSTILE_SITE_KEY: 'site-key', TURNSTILE_SECRET_KEY: 'secret-key', ADMIN_API_KEY: 'test-admin-key' });
  sessions = new Map();
  siteverify = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ success: true }));
  vi.stubGlobal('fetch', siteverify);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); f.sqlite.close(); });

interface CallOptions { as?: string | null; body?: unknown; ip?: string | null; headers?: Record<string, string> }
type Body = GuestbookCreateResponse & GuestbookListResponse & { error?: string; ok?: boolean; entryId?: string };
async function call(method: string, path: string, options: CallOptions = {}): Promise<{ status: number; body: Body }> {
  const ip = options.ip === undefined ? '203.0.113.9' : options.ip;
  const headers = new Headers({ Origin: 'https://wamp.land', 'User-Agent': 'Test browser', ...(ip ? { 'CF-Connecting-IP': ip } : {}), ...options.headers });
  if (options.as) {
    if (!sessions.has(options.as)) sessions.set(options.as, await createSession(f.env, options.as));
    headers.set('Cookie', `ep_session=${sessions.get(options.as)}`);
  }
  let body: string | undefined;
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }
  const response = await worker.fetch(new Request(`https://api.wamp.land${path}`, { method, headers, body }), f.env);
  return { status: response.status, body: await response.json() as Body };
}
let sessionCounter = 0;
const entry = (fields: Record<string, unknown> = {}) => ({
  displayName: 'Visitor', body: 'Nice game!', guestSessionId: `session-${String(sessionCounter += 1).padStart(4, '0')}`, turnstileToken: 'token', ...fields,
});
const sign = (fields: Record<string, unknown> = {}, options: CallOptions = {}) => call('POST', '/api/guestbook', { body: entry(fields), ...options });
const list = (query = '') => call('GET', `/api/guestbook${query}`);
const hide = (id: string, options: CallOptions = {}) =>
  call('DELETE', `/api/guestbook/entries/${id}`, { ...options, headers: { 'x-admin-key': 'test-admin-key', ...options.headers } });
const count = (where = '') => (f.sqlite.prepare(`SELECT COUNT(*) AS n FROM guestbook_entries ${where}`).get() as { n: number }).n;
const slotCount = () => (f.sqlite.prepare("SELECT COUNT(*) AS n FROM rate_limit_events WHERE bucket LIKE 'guestbook:%'").get() as { n: number }).n;
const insertEntry = (id: string, createdAt: string, hiddenAt: string | null = null) => f.sqlite.prepare(`INSERT INTO guestbook_entries
  (id,display_name,body,user_id,guest_session_id,ip_hash,user_agent,created_at,hidden_at) VALUES (?,?,?,'p1','session-private','hash-private','Agent-private',?,?)`)
  .run(id, `Name ${id}`, `Body ${id}`, createdAt, hiddenAt);

describe('guestbook list', () => {
  it('lists visible entries newest first, with only their public fields, up to the limit asked for', async () => {
    insertEntry('entry-old-0001', '2026-10-01T00:00:00.000Z');
    insertEntry('entry-new-0002', '2026-10-03T00:00:00.000Z');
    insertEntry('entry-gone-003', '2026-10-04T00:00:00.000Z', NOW);
    insertEntry('entry-mid-0004', '2026-10-02T00:00:00.000Z');
    const { status, body } = await list();
    expect(status).toBe(200);
    expect(body.entries.map((item) => item.id)).toEqual(['entry-new-0002', 'entry-mid-0004', 'entry-old-0001']);
    expect(body.entries[0]).toEqual({ id: 'entry-new-0002', displayName: 'Name entry-new-0002', body: 'Body entry-new-0002', createdAt: '2026-10-03T00:00:00.000Z', signedIn: true });
    expect(body.config).toEqual({ turnstileSiteKey: 'site-key', turnstileRequired: true });
    expect(JSON.stringify(body)).not.toMatch(/private|p1/);

    expect((await list('?limit=1')).body.entries).toHaveLength(1);
    for (const limit of ['0', '81', '1.5', 'many']) {
      expect(await list(`?limit=${limit}`)).toEqual({ status: 400, body: { error: 'limit must be an integer between 1 and 80.' } });
    }
  });

  it('answers an unknown guestbook route with not found', async () => {
    expect(await call('GET', '/api/guestbook/entries')).toEqual({ status: 404, body: { error: 'Guestbook route not found.' } });
    expect((await call('GET', '/api/guestbook/entries/entry-new-0002')).status).toBe(404);
  });
});

describe('guestbook signing', () => {
  it('cleans up the name and message, and keeps only a hash of the network address', async () => {
    const { status, body } = await sign({ displayName: '  Ada   L ', body: ' Hello\n\n  there ' }, { headers: { 'User-Agent': `Agent ${'x'.repeat(300)}` } });
    expect(status).toBe(201);
    expect(body.entry).toEqual({ id: expect.any(String), displayName: 'Ada L', body: 'Hello there', createdAt: expect.any(String), signedIn: false });
    expect(body.config).toEqual({ turnstileSiteKey: 'site-key', turnstileRequired: true });
    const row = f.sqlite.prepare('SELECT * FROM guestbook_entries').get() as Record<string, string | null>;
    expect(row).toMatchObject({ user_id: null, guest_session_id: expect.stringMatching(/^session-/), turnstile_verified_at: body.entry.createdAt });
    expect(row.ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.user_agent).toHaveLength(260);
    expect(JSON.stringify(row)).not.toContain('203.0.113.9');
    expect((await list()).body.entries.map((item) => item.displayName)).toEqual(['Ada L']);
  });

  it("marks an entry as signed in only under the account's own name", async () => {
    f.sqlite.prepare("UPDATE users SET display_name = 'Ada  Lovelace' WHERE id = 'p1'").run();
    expect((await sign({ displayName: ' ada lovelace ' }, { as: 'p1' })).body.entry).toMatchObject({ displayName: 'ada lovelace', signedIn: true });
    expect((await sign({ displayName: 'Someone Else' }, { as: 'p1' }))).toMatchObject({ status: 201, body: { entry: { displayName: 'Someone Else', signedIn: false } } });
    expect((await sign({ displayName: 'Ada Lovelace' })).body.entry.signedIn).toBe(false);
    expect(f.sqlite.prepare('SELECT display_name, user_id FROM guestbook_entries ORDER BY rowid').all()).toEqual([
      { display_name: 'ada lovelace', user_id: 'p1' }, { display_name: 'Someone Else', user_id: null }, { display_name: 'Ada Lovelace', user_id: null },
    ]);
    expect((await list()).body.entries.map((item) => item.signedIn).sort()).toEqual([false, false, true]);
  });

  it('removes invisible formatting characters before checking names and messages', async () => {
    const { body } = await sign({ displayName: 'A\u200Bd\u202Ea\uFEFF', body: '\u2066Hello\u2069 \u200Fthere\u202A' });
    expect(body.entry).toMatchObject({ displayName: 'Ada', body: 'Hello there' });
    expect(await sign({ displayName: '\u200B\u200CA\u200D' })).toEqual({ status: 400, body: { error: 'Name must be at least 2 characters.' } });
    expect(await sign({ body: 'www\u200B.example.test' })).toEqual({ status: 400, body: { error: 'Links are not allowed in the guestbook yet.' } });
    expect(await sign({ body: '\u202E\u202D' })).toEqual({ status: 400, body: { error: 'Message is required.' } });
    f.sqlite.prepare("UPDATE users SET display_name = 'Ada' WHERE id = 'p1'").run();
    expect((await sign({ displayName: 'A\u200Bda' }, { as: 'p1' })).body.entry.signedIn).toBe(true);
  });

  it('refuses a name or message outside the rules before taking a slot or calling Turnstile', async () => {
    const refused: Array<[Record<string, unknown>, string]> = [
      [{ displayName: undefined }, 'Name is required.'],
      [{ displayName: 42 }, 'Name is required.'],
      [{ displayName: ' A ' }, 'Name must be at least 2 characters.'],
      [{ displayName: 'n'.repeat(33) }, 'Name must be 32 characters or fewer.'],
      [{ displayName: '<b>Ada</b>' }, 'Name cannot contain angle brackets.'],
      [{ displayName: 'https://example.test' }, 'Links are not allowed in the guestbook yet.'],
      [{ displayName: 'visit www.example.test' }, 'Links are not allowed in the guestbook yet.'],
      [{ body: undefined }, 'Message is required.'],
      [{ body: ' \n ' }, 'Message is required.'],
      [{ body: 'm'.repeat(281) }, 'Message must be 280 characters or fewer.'],
      [{ body: 'hi <script>' }, 'Message cannot contain angle brackets.'],
      [{ body: 'see https://example.test' }, 'Links are not allowed in the guestbook yet.'],
      [{ body: 'see WWW.example.test' }, 'Links are not allowed in the guestbook yet.'],
      [{ guestSessionId: 'short' }, 'guestSessionId is invalid.'],
      [{ guestSessionId: 'has spaces in it' }, 'guestSessionId is invalid.'],
      [{ guestSessionId: 12345678 }, 'guestSessionId is invalid.'],
    ];
    for (const [fields, error] of refused) expect(await sign(fields)).toEqual({ status: 400, body: { error } });
    expect(await call('POST', '/api/guestbook', { body: '{"displayName":' })).toEqual({ status: 400, body: { error: 'Request body must be valid JSON.' } });
    expect((await sign({ body: 'm'.repeat(17_000) })).status).toBe(413);
    expect(count()).toBe(0);
    expect(slotCount()).toBe(0);
    expect(siteverify).not.toHaveBeenCalled();
    expect((await sign({ displayName: 'n'.repeat(32), body: 'm'.repeat(280) })).status).toBe(201);
  });

  it('keeps school-managed student accounts from signing', async () => {
    f.sqlite.prepare(`INSERT INTO school_classrooms (id,slug,display_name,teacher_email,created_at,updated_at)
      VALUES ('class-1','room-12','Room 12','teacher@example.test',?,?)`).run(NOW, NOW);
    f.sqlite.prepare(`INSERT INTO school_students (id,classroom_id,user_id,username,password_hash,password_reset_required,password_updated_at,created_at,updated_at)
      VALUES ('student-1','class-1','p3','ada','hash',0,?,?,?)`).run(NOW, NOW, NOW);
    expect(await sign({}, { as: 'p3' })).toEqual({ status: 403, body: { error: 'School-managed student accounts cannot sign the guestbook.' } });
    expect(count()).toBe(0);
    expect(slotCount()).toBe(0);
  });

  it('refuses a cookie-signed entry sent from another site', async () => {
    expect((await sign({}, { as: 'p1', headers: { Origin: 'https://evil.example' } })).status).toBe(403);
    expect(count()).toBe(0);
  });

  it('applies account status to guestbook entries', async () => {
    f.sqlite.prepare("UPDATE users SET suspended_at = ?, suspended_reason = 'Spam' WHERE id = 'p1'").run(NOW);
    expect(await sign({}, { as: 'p1' })).toEqual({
      status: 403, body: { error: 'This account is suspended. You can still play, but saving, publishing and posting are turned off.' },
    });
    expect(count()).toBe(0);
    expect(slotCount()).toBe(0);
    expect(siteverify).not.toHaveBeenCalled();
    expect((await sign({}, { as: 'p2' })).status).toBe(201);
  });

  it('holds the network limit under parallel posts that carry no browser session', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => sign({ guestSessionId: null })));
    expect(results.map((result) => result.status).sort()).toEqual([201, 201, 201, 201, 201, 429, 429, 429]);
    expect(count()).toBe(5);
    expect(count('WHERE guest_session_id IS NOT NULL')).toBe(0);
    expect(slotCount()).toBe(5);
  });
});

describe('guestbook Turnstile', () => {
  it('needs a token, and gives the slots back when it is missing', async () => {
    for (const turnstileToken of [undefined, '   ', 42]) {
      expect(await sign({ turnstileToken })).toEqual({ status: 403, body: { error: 'Turnstile verification is required.' } });
    }
    expect(siteverify).not.toHaveBeenCalled();
    expect(slotCount()).toBe(0);
  });

  it('sends the token and network address to siteverify', async () => {
    expect((await sign({ turnstileToken: '  the-token ' })).status).toBe(201);
    expect(siteverify).toHaveBeenCalledTimes(1);
    const [url, init] = siteverify.mock.calls[0];
    expect(String(url)).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual({ secret: 'secret-key', response: 'the-token', remoteip: '203.0.113.9' });
  });

  it('treats an error from siteverify, or no answer at all, as a failed check', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    siteverify.mockResolvedValueOnce(new Response('unavailable', { status: 500 }));
    siteverify.mockRejectedValueOnce(new Error('network down'));
    siteverify.mockResolvedValueOnce(Response.json({ success: 'yes' }));
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(await sign()).toEqual({ status: 403, body: { error: 'Turnstile verification failed. Try again.' } });
    }
    expect(logged).toHaveBeenCalledTimes(2);
    expect(count()).toBe(0);
    expect(slotCount()).toBe(0);
  });

  it('signs without Turnstile when none is set up, and asks for it when only a secret is set', async () => {
    Object.assign(f.env, { TURNSTILE_SITE_KEY: undefined, TURNSTILE_SECRET_KEY: undefined });
    const { status, body } = await sign({ turnstileToken: undefined });
    expect(status).toBe(201);
    expect(body.config).toEqual({ turnstileSiteKey: null, turnstileRequired: false });
    expect(f.sqlite.prepare('SELECT turnstile_verified_at FROM guestbook_entries').get()).toEqual({ turnstile_verified_at: null });
    expect(siteverify).not.toHaveBeenCalled();

    f.env.TURNSTILE_SECRET = 'guestbook-secret';
    expect((await list()).body.config).toEqual({ turnstileSiteKey: null, turnstileRequired: true });
    expect((await sign({ turnstileToken: undefined })).status).toBe(403);
  });
});

describe('guestbook moderation', () => {
  it('lets only an admin hide an entry, once, and hides it from the list', async () => {
    const { body: { entry: { id } } } = await sign();
    expect((await call('DELETE', `/api/guestbook/entries/${id}`)).status).toBe(403);
    expect((await hide(id, { headers: { 'x-admin-key': 'wrong-key' } })).status).toBe(403);
    expect(await hide('bad id!')).toEqual({ status: 400, body: { error: 'Guestbook entry id is invalid.' } });
    expect(await hide('no-such-entry')).toEqual({ status: 404, body: { error: 'Guestbook entry not found.' } });
    expect(count('WHERE hidden_at IS NULL')).toBe(1);

    expect(await hide(id, { as: 'p2' })).toEqual({ status: 200, body: { ok: true, entryId: id } });
    expect(f.sqlite.prepare('SELECT hidden_at IS NOT NULL AS hidden, hidden_by_user_id FROM guestbook_entries').get())
      .toEqual({ hidden: 1, hidden_by_user_id: 'p2' });
    expect((await list()).body.entries).toEqual([]);
    expect((await hide(id)).status).toBe(404);
  });
});

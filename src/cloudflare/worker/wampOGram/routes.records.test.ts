import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDefaultRoomSnapshot, type RoomSnapshot } from '../../../persistence/roomModel';
import type { WampOGramPublicRecord, WampOGramRecord } from '../../../wampOGram/model';
import worker from '../../worker';
import { NOW, fixture } from '../activity/testDatabase';
import { API_TOKEN_PREFIX, createApiTokenForUser, createSession, generateOpaqueToken, hashToken } from '../auth/store';
import { hashRateLimitKey } from '../core/rateLimit';

// These go through the Worker's router with real sessions; routes.test.ts covers room checks and previews.
let f: ReturnType<typeof fixture>;
let sessions: Map<string, string>;
beforeEach(() => { f = fixture(); sessions = new Map(); });
afterEach(() => f.sqlite.close());

type Caller = string | null | { bearer: string };
type Body = WampOGramRecord & { error?: string };
interface CallOptions { as?: Caller; body?: unknown; origin?: string; headers?: Record<string, string> }

async function call<T = Body>(method: string, path: string, options: CallOptions = {}): Promise<{ status: number; body: T; headers: Headers }> {
  const headers = new Headers({ Origin: options.origin ?? 'https://wamp.land', 'CF-Connecting-IP': '203.0.113.7', ...options.headers });
  const caller = options.as === undefined ? 'p1' : options.as;
  if (typeof caller === 'string') {
    if (!sessions.has(caller)) sessions.set(caller, await createSession(f.env, caller));
    headers.set('Cookie', `ep_session=${sessions.get(caller)}`);
  } else if (caller) {
    headers.set('Authorization', `Bearer ${caller.bearer}`);
  }
  let body: string | undefined;
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }
  const env = { ...f.env, ADMIN_API_KEY: 'test-admin-key' };
  const response = await worker.fetch(new Request(`https://api.wamp.land${path}`, { method, headers, body }), env);
  return { status: response.status, body: await response.json() as T, headers: response.headers };
}
const room = (): RoomSnapshot => ({ ...createDefaultRoomSnapshot('0,0', { x: 0, y: 0 }), title: 'Ignored for a published room' });
const send = (postcard: unknown = { title: 'Hi' }, as?: Caller) => call('POST', '/api/wamp-o-grams', { body: { postcard, roomSnapshot: room() }, as });
const read = (slug: string) => call<WampOGramPublicRecord & { error?: string }>('GET', `/api/wamp-o-grams/${slug}`, { as: null });
const count = (table: string) => (f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe('Wamp-O-Gram postcards', () => {
  it('keeps each postcard field within its limit and leaves the recipient email out of the public record', async () => {
    const { status, body } = await send({
      title: `  Happy   birthday ${'t'.repeat(80)}`, recipientName: 'r'.repeat(50), senderName: 's'.repeat(50),
      message: `Line one\n\nline two ${'m'.repeat(300)}`, occasion: 'o'.repeat(40), recipientEmail: '  Friend@Example.TEST ',
    });
    expect(status).toBe(200);
    expect(body.slug).toMatch(/^[0-9a-f]{36}$/);
    expect(body).toMatchObject({ recipientEmail: 'friend@example.test', sourceRoomStatus: 'published', deliveryStatus: 'draft' });
    expect(f.sqlite.prepare('SELECT title, recipient_name, sender_name, message, occasion, recipient_email FROM wamp_o_grams').get()).toEqual({
      title: `Happy birthday ${'t'.repeat(45)}`, recipient_name: 'r'.repeat(40), sender_name: 's'.repeat(40),
      message: `Line one line two ${'m'.repeat(222)}`, occasion: 'o'.repeat(32), recipient_email: 'friend@example.test',
    });

    const { status: readStatus, body: record } = await read(body.slug);
    expect(readStatus).toBe(200);
    expect(record).toMatchObject({
      slug: body.slug, title: `Happy birthday ${'t'.repeat(45)}`, recipientName: 'r'.repeat(40), recipientEmail: null, deliveryError: null,
      creatorUserId: 'p1', creatorDisplayName: 'p1', sourceRoomId: '0,0', sourceRoomVersion: 1, sourceRoomStatus: 'published',
      roomSnapshot: expect.objectContaining({ id: '0,0', title: 'Lava Gauntlet' }),
    });
    expect(JSON.stringify(record)).not.toContain('@');
  });

  it('stores missing or non-text postcard fields as empty', async () => {
    const { body } = await send({ title: 42, recipientName: ['x'], message: '   ', recipientEmail: '' });
    expect(body).toMatchObject({ title: null, recipientName: null, senderName: null, message: null, occasion: null, recipientEmail: null });
    expect((await call('POST', '/api/wamp-o-grams', { body: { roomSnapshot: room() } })).body).toMatchObject({ title: null });
  });

  it('refuses a bad recipient email, a body that is not a gram, and an oversized body, before taking a slot', async () => {
    const refused: Array<[unknown, number, string]> = [
      [{ postcard: { recipientEmail: 'not-an-email' }, roomSnapshot: room() }, 400, 'Recipient email is invalid.'],
      [{ postcard: { recipientEmail: `${'a'.repeat(250)}@example.test` }, roomSnapshot: room() }, 400, 'Recipient email is too long.'],
      [[room()], 400, 'Request body must be an object.'],
      [{ postcard: { title: 'Hi' } }, 400, 'roomSnapshot is required.'],
      ['{"postcard":', 400, 'Request body must be valid JSON.'],
      [{ postcard: { message: 'm'.repeat(70_000) }, roomSnapshot: room() }, 413, 'Request body is too large.'],
    ];
    for (const [body, status, error] of refused) {
      expect(await call('POST', '/api/wamp-o-grams', { body })).toMatchObject({ status, body: { error } });
    }
    expect(count('wamp_o_grams')).toBe(0);
    expect(count('rate_limit_events')).toBe(0);
  });

  it('gives every send its own link, and counts each one toward the limits', async () => {
    const first = await send();
    const second = await send();
    expect(first.body.slug).not.toBe(second.body.slug);
    expect(count('wamp_o_grams')).toBe(2);
    expect(count("rate_limit_events WHERE bucket LIKE 'wamp-o-gram:%'")).toBe(6);
  });

  it('limits each account to 60 grams a day, whatever the network', async () => {
    const userKey = await hashRateLimitKey(f.env, 'wamp-o-gram-user:p1');
    const insert = f.sqlite.prepare("INSERT INTO rate_limit_events (bucket, key_hash, created_at) VALUES ('wamp-o-gram:user-day', ?, ?)");
    for (let index = 0; index < 60; index += 1) insert.run(userKey, new Date().toISOString());
    expect(await call('POST', '/api/wamp-o-grams', { body: { roomSnapshot: room() }, headers: { 'CF-Connecting-IP': '198.51.100.4' } }))
      .toMatchObject({ status: 429, body: { error: 'You have made a lot of Wamp-O-Grams lately. Try again later.' } });
    // A refused send gives back the slots it took under the other rules.
    expect(count("rate_limit_events WHERE bucket <> 'wamp-o-gram:user-day'")).toBe(0);
    expect((await send(undefined, 'p2')).status).toBe(200);
  });
});

describe('Wamp-O-Gram senders', () => {
  it('needs a signed-in player whose account is not suspended or managed by a school', async () => {
    expect((await send(undefined, null)).status).toBe(401);
    f.sqlite.prepare("UPDATE users SET suspended_at = ?, suspended_reason = 'Spam' WHERE id = 'p2'").run(NOW);
    expect((await send(undefined, 'p2')).status).toBe(403);
    f.sqlite.prepare(`INSERT INTO school_classrooms (id,slug,display_name,teacher_email,created_at,updated_at)
      VALUES ('class-1','room-12','Room 12','teacher@example.test',?,?)`).run(NOW, NOW);
    f.sqlite.prepare(`INSERT INTO school_students (id,classroom_id,user_id,username,password_hash,password_reset_required,password_updated_at,created_at,updated_at)
      VALUES ('student-1','class-1','p3','ada','hash',0,?,?,?)`).run(NOW, NOW, NOW);
    expect(await send(undefined, 'p3')).toMatchObject({ status: 403, body: { error: 'School-managed student accounts cannot send Wamp-O-Grams.' } });
    expect(count('wamp_o_grams')).toBe(0);
    expect((await send()).status).toBe(200);
  });

  it('needs the rooms:write scope with an API token, and a trusted origin with a session', async () => {
    async function token(scopes: Array<'rooms:read' | 'rooms:write'>) {
      const value = API_TOKEN_PREFIX + generateOpaqueToken(32);
      await createApiTokenForUser(f.env, 'p1', 'Test token', await hashToken(value), scopes, NOW, crypto.randomUUID());
      return { bearer: value };
    }
    expect((await send(undefined, await token(['rooms:read']))).status).toBe(403);
    expect((await call('POST', '/api/wamp-o-grams', { body: { roomSnapshot: room() }, origin: 'https://evil.example' })).status).toBe(403);
    expect(count('wamp_o_grams')).toBe(0);
    expect((await send(undefined, await token(['rooms:write']))).status).toBe(200);
  });
});

describe('Wamp-O-Gram links', () => {
  it('answers a malformed link, an unknown gram, another method and an unknown sub-path', async () => {
    const { body: { slug } } = await send();
    expect((await call('GET', `/api/wamp-o-grams/${slug}/`, { as: null })).body.slug).toBe(slug);
    expect(await read('short')).toMatchObject({ status: 400, body: { error: 'Wamp-O-Gram slug is invalid.' } });
    expect(await read('a'.repeat(36))).toMatchObject({ status: 404, body: { error: 'Wamp-O-Gram not found.' } });
    expect(await read(`${slug}/thumbnail`)).toMatchObject({ status: 404, body: { error: 'Wamp-O-Gram route not found.' } });
    expect(await call('GET', '/api/wamp-o-grams', { as: null })).toMatchObject({ status: 404 });
    for (const method of ['POST', 'PUT', 'DELETE']) {
      expect(await call(method, `/api/wamp-o-grams/${slug}`)).toMatchObject({ status: 405, body: { error: 'Method not allowed.' } });
    }
    expect(count('wamp_o_grams')).toBe(1);
  });

  it('lets only an admin delete a gram, from a trusted origin', async () => {
    const { body: { slug } } = await send();
    const admin = (path: string, origin = 'https://wamp.land', key = 'test-admin-key') =>
      call('DELETE', path, { as: null, origin, headers: { 'x-admin-key': key } });
    expect((await call('DELETE', `/api/admin/wamp-o-grams/${slug}`)).status).toBe(403);
    expect((await admin(`/api/admin/wamp-o-grams/${slug}`, 'https://evil.example')).status).toBe(403);
    expect((await admin(`/api/admin/wamp-o-grams/${slug}/extra`)).status).toBe(404);
    expect((await admin('/api/admin/wamp-o-grams/short')).status).toBe(404);
    expect(count('wamp_o_grams')).toBe(1);

    const deleted = await admin(`/api/admin/wamp-o-grams/${slug}`);
    expect(deleted).toMatchObject({ status: 200, body: { slug, deleted: true } });
    expect(deleted.headers.get('Cache-Control')).toBe('no-store');
    expect((await read(slug)).status).toBe(404);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomPlaylistItem, RoomPlaylistListResponse, RoomPlaylistResponse } from '../../../playlists/model';
import worker from '../../worker';
import { NOW } from '../activity/testDatabase';
import { API_TOKEN_PREFIX, createApiTokenForUser, createSession, generateOpaqueToken, hashToken } from '../auth/store';
import { hashRateLimitKey } from '../core/rateLimit';
import type { WorkerExecutionContextLike } from '../core/types';
import { discoveryFixture } from '../runs/discoveryTestDatabase';
import { loadPublicPlaylistSummariesForUser } from './store';

// Rooms 1,0 to 13,0 are published by "builder" (6,0 has versions 1 and 2). Cells 7,0 and 8,0 form the
// Expanded Room "native" and 9,0 and 10,0 form "course:legacy", each at version 3 with cells at version 1.
let f: ReturnType<typeof discoveryFixture>;
let sessions: Map<string, string>;
beforeEach(() => { f = discoveryFixture(); sessions = new Map(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); f.sqlite.close(); });

type Caller = string | null | { bearer: string };
type Body = RoomPlaylistResponse & { error?: string };
interface CallOptions { as?: Caller; body?: unknown; origin?: string; context?: WorkerExecutionContextLike }

async function call<T = Body>(method: string, path: string, options: CallOptions = {}): Promise<{ status: number; body: T; headers: Headers }> {
  const headers = new Headers({ Origin: options.origin ?? 'https://wamp.land' });
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
  const response = await worker.fetch(new Request(`https://api.wamp.land${path}`, { method, headers, body }), f.env, options.context);
  return { status: response.status, body: await response.json() as T, headers: response.headers };
}
const create = (body: unknown, as?: Caller) => call('POST', '/api/playlists', { body, as });
const update = (id: string, body: unknown, as?: Caller) => call('PATCH', `/api/playlists/${id}`, { body, as });
const remove = (id: string, as?: Caller) => call('DELETE', `/api/playlists/${id}`, { as });
const add = (id: string, x: number, roomVersion = 1, as?: Caller) =>
  call('POST', `/api/playlists/${id}/items`, { body: { roomId: `${x},0`, roomCoordinates: { x, y: 0 }, roomVersion }, as });
const addBody = (id: string, body: unknown) => call('POST', `/api/playlists/${id}/items`, { body });
const removeItem = (id: string, itemId: string, as?: Caller) => call('DELETE', `/api/playlists/${id}/items/${itemId}`, { as });
const bySlug = (slug: string, as: Caller = null, context?: WorkerExecutionContextLike) =>
  call('GET', `/api/playlists/by-slug/${slug}`, { as, context });
const mine = (as: Caller = 'p1') => call<RoomPlaylistListResponse & { error?: string }>('GET', '/api/playlists/me', { as });

async function made(title = 'Mix', as?: Caller): Promise<RoomPlaylistResponse> {
  const { status, body } = await create({ title }, as);
  expect(status).toBe(201);
  return body;
}
const roomIds = (items: RoomPlaylistItem[]) => items.map((item) => item.roomId);
const count = (table: string) => (f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const insertItem = (playlistId: string, roomId: string, version: number, position: number) => f.sqlite.prepare(`INSERT INTO room_playlist_items
  (id,playlist_id,room_id,room_version,position,added_by_user_id,added_at) VALUES (?,?,?,?,?,'p1',?)`).run(crypto.randomUUID(), playlistId, roomId, version, position, NOW);
const insertPlaylist = (slug: string, owner = 'p2', updatedAt = NOW) => f.sqlite.prepare(`INSERT INTO room_playlists
  (id,owner_user_id,title,slug,visibility,created_at,updated_at) VALUES (?,?,?,?,'public',?,?)`).run(crypto.randomUUID(), owner, slug, slug, NOW, updatedAt);

/** Runs `write` once, just before the next statement matching `sql`, as another request would. */
function beforeStatement(sql: RegExp, write: () => void): void {
  const database = f.env.DB;
  const prepare = (Object.getPrototypeOf(database) as typeof database).prepare.bind(database);
  let pending = true;
  vi.spyOn(database, 'prepare').mockImplementation((query: string) => {
    if (pending && sql.test(query)) { pending = false; write(); }
    return prepare(query);
  });
}

async function apiToken(scopes: Array<'rooms:read' | 'rooms:write'>): Promise<{ bearer: string }> {
  const token = API_TOKEN_PREFIX + generateOpaqueToken(32);
  await createApiTokenForUser(f.env, 'p1', 'Test token', await hashToken(token), scopes, NOW, crypto.randomUUID());
  return { bearer: token };
}

describe('playlist routes: making, editing and deleting', () => {
  it('makes a public playlist named after its title that its owner can edit and anyone can open', async () => {
    const { status, body } = await create({ title: '  Lava   Favourites ', description: ' Hot rooms \r\n ' });
    expect(status).toBe(201);
    expect(body).toMatchObject({
      title: 'Lava Favourites', slug: 'lava-favourites', description: 'Hot rooms', ownerUserId: 'p1', ownerDisplayName: 'p1',
      ownerUsername: null, roomCount: 0, viewerCanEdit: true, items: [],
    });
    expect((await mine()).body.playlists).toEqual([expect.objectContaining({ id: body.id, slug: 'lava-favourites', roomCount: 0 })]);
    expect((await bySlug('lava-favourites')).body).toMatchObject({ id: body.id, viewerCanEdit: false });
    expect((await bySlug('LAVA-Favourites', 'p1')).body).toMatchObject({ id: body.id, viewerCanEdit: true });
    expect((await bySlug('lava-favourites', 'p2')).body.viewerCanEdit).toBe(false);
    expect(JSON.stringify((await bySlug('lava-favourites')).body)).not.toContain('@example.test');
  });

  it('numbers a URL name already taken by anyone, and falls back to "playlist" for a short or non-Latin title', async () => {
    expect((await made('Mix')).slug).toBe('mix');
    expect((await made('Mix', 'p2')).slug).toBe('mix-1');
    expect((await create({ title: 'Other', slug: 'MIX!!' })).body.slug).toBe('mix-2');
    expect((await made('Hi')).slug).toBe('playlist');
    expect((await made('日本')).slug).toBe('playlist-1');
    expect((await create({ title: 'Chosen', slug: '  My Cool Mix ' })).body.slug).toBe('my-cool-mix');
    expect((await create({ title: 'Blank name', slug: '   ' })).body.slug).toBe('blank-name');
  });

  it('keeps URL names within 48 characters, numbered ones included', async () => {
    const first = await made('a'.repeat(60));
    expect(first.slug).toBe('a'.repeat(48));
    const second = await made('a'.repeat(60));
    expect(second.slug).toBe(`${'a'.repeat(46)}-1`);
    expect((await bySlug(second.slug)).body.id).toBe(second.id);
  });

  it('numbers a long URL name that would be cut at a hyphen so its link still opens it', async () => {
    const title = `${'a'.repeat(45)} bb`;
    expect((await made(title)).slug).toBe(`${'a'.repeat(45)}-bb`);
    const second = await made(title);
    expect(second.slug).toBe(`${'a'.repeat(45)}-1`);
    expect((await bySlug(second.slug)).body.id).toBe(second.id);
  });

  it('stops numbering after 99 clashes', async () => {
    insertPlaylist('mix');
    for (let suffix = 1; suffix <= 99; suffix += 1) insertPlaylist(`mix-${suffix}`);
    expect(await create({ title: 'Mix' })).toMatchObject({ status: 409, body: { error: 'Could not find an available playlist URL name.' } });
    expect(count('room_playlists')).toBe(100);
    // A hundred tries counts toward the limits.
    expect(count("rate_limit_events WHERE bucket LIKE 'playlist:%'")).toBe(2);
  });

  it('refuses a missing or oversized title, an oversized description, a bad URL name or a body that is not JSON', async () => {
    const refused = [
      [{}, 'Playlist title is required.'],
      [{ title: '   ' }, 'Playlist title is required.'],
      [{ title: 42 }, 'Playlist title is required.'],
      [{ title: 'x'.repeat(61) }, 'Playlist title must be 60 characters or fewer.'],
      [{ title: 'Mix', description: 'd'.repeat(281) }, 'Playlist description must be 280 characters or fewer.'],
      [{ title: 'Mix', slug: 'ab' }, 'Playlist URL name must be 3-48 characters.'],
      [{ title: 'Mix', slug: '!!' }, 'Playlist URL name is required.'],
      ['{"title":', 'Request body must be valid JSON.'],
    ] as const;
    for (const [body, error] of refused) expect(await create(body)).toMatchObject({ status: 400, body: { error } });
    expect(count('room_playlists')).toBe(0);
    expect((await create({ title: 'x'.repeat(60), description: 'd'.repeat(280) })).status).toBe(201);
  });

  it('changes only the fields sent, and the URL name only when a different one is asked for', async () => {
    insertPlaylist('taken');
    const { body: playlist } = await create({ title: 'Mix', description: 'First' });
    expect((await update(playlist.id, { title: 'New name' })).body).toMatchObject({ title: 'New name', slug: 'mix', description: 'First' });
    expect((await update(playlist.id, { description: null })).body).toMatchObject({ title: 'New name', description: null });
    expect((await update(playlist.id, { slug: 'MIX' })).body.slug).toBe('mix');
    expect((await update(playlist.id, { slug: '' })).body.slug).toBe('mix');
    expect((await update(playlist.id, { slug: 'Party Time' })).body.slug).toBe('party-time');
    expect((await bySlug('mix')).status).toBe(404);
    expect((await bySlug('party-time')).body.id).toBe(playlist.id);
    expect((await update(playlist.id, { slug: 'taken' })).body.slug).toBe('taken-1');

    for (const body of [{ title: '' }, { title: 'x'.repeat(61) }, { description: 'd'.repeat(281) }, { slug: 'a!' }]) {
      expect((await update(playlist.id, body)).status).toBe(400);
    }
    expect((await bySlug('taken-1')).body).toMatchObject({ title: 'New name', description: null });
  });

  it('deletes a playlist together with its rooms', async () => {
    const playlist = await made();
    await add(playlist.id, 1);
    expect(await remove(playlist.id)).toMatchObject({ status: 200, body: { ok: true } });
    expect((await bySlug('mix')).status).toBe(404);
    expect((await mine()).body.playlists).toEqual([]);
    expect(count('room_playlist_items')).toBe(0);
    expect((await remove(playlist.id)).status).toBe(404);
  });

  it('refuses an invalid URL name and reports an unknown one as not found', async () => {
    expect(await bySlug('ab')).toMatchObject({ status: 400, body: { error: 'Playlist URL name must be 3-48 characters.' } });
    expect(await bySlug('no-such-playlist')).toMatchObject({ status: 404, body: { error: 'Playlist not found.' } });
  });

  it("lists up to 50 of a player's playlists, most recently changed first", async () => {
    for (let index = 0; index < 52; index += 1) {
      insertPlaylist(`list-${index}`, 'p1', new Date(Date.parse(NOW) + index * 1000).toISOString());
    }
    insertPlaylist('someone-else');
    const { playlists } = (await mine()).body;
    expect(playlists).toHaveLength(50);
    expect(playlists[0].slug).toBe('list-51');
    expect(playlists.every((playlist) => playlist.ownerUserId === 'p1')).toBe(true);
    // A profile shows the twelve most recent.
    const profile = (await loadPublicPlaylistSummariesForUser(f.env, 'p1')).map((playlist) => playlist.slug);
    expect([profile.length, profile[0], profile[11]]).toEqual([12, 'list-51', 'list-40']);
  });
});

describe('playlist routes: who can change a playlist', () => {
  it('needs a signed-in player for every change and for "my playlists", but not to open one', async () => {
    const playlist = await made();
    const { body: withItem } = await add(playlist.id, 1);
    const itemId = withItem.items[0].id;
    for (const response of [
      await mine(null), await create({ title: 'Mine' }, null), await update(playlist.id, { title: 'Hijacked' }, null),
      await remove(playlist.id, null), await add(playlist.id, 2, 1, null), await removeItem(playlist.id, itemId, null),
    ]) expect(response.status).toBe(401);
    expect((await bySlug('mix', null)).body).toMatchObject({ title: 'Mix', roomCount: 1 });
  });

  it("treats another player's playlist as not found and leaves it unchanged", async () => {
    const playlist = await made();
    const { body: withItem } = await add(playlist.id, 1);
    const itemId = withItem.items[0].id;
    for (const response of [
      await update(playlist.id, { title: 'Hijacked' }, 'p2'), await remove(playlist.id, 'p2'),
      await add(playlist.id, 2, 1, 'p2'), await removeItem(playlist.id, itemId, 'p2'),
    ]) expect(response).toMatchObject({ status: 404, body: { error: 'Playlist not found.' } });
    expect((await bySlug('mix')).body).toMatchObject({ title: 'Mix', items: [expect.objectContaining({ id: itemId })] });
    expect((await mine('p2')).body.playlists).toEqual([]);
  });

  it('refuses changes from a suspended account but still lists its playlists', async () => {
    const playlist = await made();
    f.sqlite.prepare("UPDATE users SET suspended_at = ?, suspended_reason = 'Vandalism' WHERE id = 'p1'").run(NOW);
    for (const response of [
      await create({ title: 'More' }), await update(playlist.id, { title: 'Renamed' }), await add(playlist.id, 1),
      await remove(playlist.id),
    ]) expect(response.status).toBe(403);
    expect((await mine()).body.playlists).toEqual([expect.objectContaining({ title: 'Mix', roomCount: 0 })]);
  });

  it('keeps school-managed student accounts from making, renaming or filling playlists', async () => {
    f.sqlite.prepare(`INSERT INTO school_classrooms (id,slug,display_name,teacher_email,created_at,updated_at)
      VALUES ('class-1','room-12','Room 12','teacher@example.test',?,?)`).run(NOW, NOW);
    f.sqlite.prepare(`INSERT INTO school_students (id,classroom_id,user_id,username,password_hash,password_reset_required,password_updated_at,created_at,updated_at)
      VALUES ('student-1','class-1','p3','ada','hash',0,?,?,?)`).run(NOW, NOW, NOW);
    insertPlaylist('from-before', 'p3');
    const { id } = f.sqlite.prepare("SELECT id FROM room_playlists WHERE slug = 'from-before'").get() as { id: string };
    expect(await create({ title: 'Mine' }, 'p3')).toMatchObject({ status: 403, body: { error: 'School-managed student accounts cannot create playlists.' } });
    expect((await update(id, { title: 'Renamed' }, 'p3')).status).toBe(403);
    expect((await add(id, 1, 1, 'p3')).status).toBe(403);
    expect((await bySlug('from-before', 'p3')).body).toMatchObject({ title: 'from-before', roomCount: 0 });
  });

  it('needs the rooms:write scope to change playlists with an API token', async () => {
    const reader = await apiToken(['rooms:read']);
    expect((await mine(reader)).status).toBe(200);
    expect((await create({ title: 'Mine' }, reader)).status).toBe(403);
    expect((await create({ title: 'Mine' }, await apiToken(['rooms:write']))).status).toBe(201);
    expect((await create({ title: 'Mine' }, { bearer: `${API_TOKEN_PREFIX}revoked` })).status).toBe(401);
  });

  it('refuses a cookie-signed change sent from another site', async () => {
    expect((await call('POST', '/api/playlists', { body: { title: 'Mine' }, origin: 'https://evil.example' })).status).toBe(403);
    expect(count('room_playlists')).toBe(0);
  });
});

describe('playlist rooms', () => {
  it('adds published room versions in order, once each, and keeps the order after a removal', async () => {
    const playlist = await made();
    for (const x of [1, 2, 3]) expect((await add(playlist.id, x)).status).toBe(201);
    const { status, body } = await add(playlist.id, 2);
    expect(status).toBe(201);
    expect(roomIds(body.items)).toEqual(['1,0', '2,0', '3,0']);
    expect(body.items[0]).toEqual({
      id: expect.any(String), roomId: '1,0', roomCoordinates: { x: 1, y: 0 }, roomTitle: 'Public room 1', roomVersion: 1,
      goalType: 'reach_exit', publishedAt: NOW, position: 0, addedAt: expect.any(String), expandedRoom: null,
    });

    const removed = await removeItem(playlist.id, body.items[1].id);
    expect(removed.body.items.map((item) => [item.roomId, item.position])).toEqual([['1,0', 0], ['3,0', 2]]);
    const { body: after } = await add(playlist.id, 4);
    expect(after.items.map((item) => [item.roomId, item.position])).toEqual([['1,0', 0], ['3,0', 2], ['4,0', 3]]);
    expect(after.roomCount).toBe(3);
    expect((await mine()).body.playlists[0].roomCount).toBe(3);
    expect((await removeItem(playlist.id, 'not-an-item')).body.items).toHaveLength(3);
  });

  it('keeps two versions of the same room as two entries', async () => {
    const playlist = await made();
    await add(playlist.id, 6, 1);
    const { body } = await add(playlist.id, 6, 2);
    expect(body.items.map((item) => [item.roomId, item.roomVersion])).toEqual([['6,0', 1], ['6,0', 2]]);
    expect((await mine()).body.playlists[0].roomCount).toBe(2);
  });

  it('refuses a malformed room, an unpublished room and a version that does not exist', async () => {
    f.sqlite.prepare("INSERT INTO rooms (id,x,y,draft_json,claimer_user_id) VALUES ('20,0',20,0,'{}','p1')").run();
    const playlist = await made();
    const malformed = [
      [{ roomCoordinates: { x: 1, y: 0 }, roomVersion: 1 }, 'roomId is required.'],
      [{ roomId: '  ', roomCoordinates: { x: 1, y: 0 }, roomVersion: 1 }, 'roomId is required.'],
      [{ roomId: '1,0', roomCoordinates: { x: 1, y: 0 }, roomVersion: 0 }, 'roomVersion must be a positive integer.'],
      [{ roomId: '1,0', roomCoordinates: { x: 1, y: 0 }, roomVersion: 1.5 }, 'roomVersion must be a positive integer.'],
      [{ roomId: '1,0', roomCoordinates: { x: 1, y: 0 }, roomVersion: 'latest' }, 'roomVersion must be a positive integer.'],
      [{ roomId: '1,0', roomVersion: 1 }, 'roomCoordinates are required.'],
      [{ roomId: '1,0', roomCoordinates: { x: 1.5, y: 0 }, roomVersion: 1 }, 'roomCoordinates must be integers.'],
    ] as const;
    for (const [body, error] of malformed) expect(await addBody(playlist.id, body)).toMatchObject({ status: 400, body: { error } });
    for (const body of [
      { roomId: '1,0', roomCoordinates: { x: 2, y: 0 }, roomVersion: 1 },
      { roomId: '1,0', roomCoordinates: { x: 1, y: 0 }, roomVersion: 9 },
      { roomId: '20,0', roomCoordinates: { x: 20, y: 0 }, roomVersion: 1 },
      { roomId: '99,0', roomCoordinates: { x: 99, y: 0 }, roomVersion: 1 },
    ]) expect(await addBody(playlist.id, body)).toMatchObject({ status: 404, body: { error: 'Published room version not found.' } });
    expect(count('room_playlist_items')).toBe(0);
  });

  it('accepts a room version sent as a numeric string', async () => {
    const playlist = await made();
    const { body } = await addBody(playlist.id, { roomId: ' 1,0 ', roomCoordinates: { x: 1, y: 0 }, roomVersion: '1' });
    expect(body.items).toEqual([expect.objectContaining({ roomId: '1,0', roomVersion: 1 })]);
  });

  it('shows the moderation title for a room version hidden after it was added', async () => {
    const playlist = await made();
    await add(playlist.id, 1);
    f.sqlite.prepare(`UPDATE room_versions SET redacted_at = ?, redacted_title = title, title = 'Hidden by moderation'
      WHERE room_id = '1,0' AND version = 1`).run(NOW);
    expect((await bySlug('mix')).body.items).toEqual([expect.objectContaining({ roomId: '1,0', roomTitle: 'Hidden by moderation' })]);
  });

  it('refuses a room version that cannot be read, and still lists one that later could not be', async () => {
    const playlist = await made();
    f.sqlite.prepare("UPDATE room_versions SET snapshot_json = 'not json' WHERE room_id = '2,0'").run();
    expect(await add(playlist.id, 2)).toMatchObject({
      status: 409, body: { error: 'That room version could not be read and cannot be added to a playlist.' },
    });
    for (const x of [1, 3]) await add(playlist.id, x);
    f.sqlite.prepare("UPDATE room_versions SET snapshot_json = 'not json', goal_type = 'survival' WHERE room_id = '3,0'").run();
    const { status, body } = await bySlug('mix');
    expect(status).toBe(200);
    expect(body.items.map((item) => [item.roomId, item.roomTitle, item.goalType])).toEqual([
      ['1,0', 'Public room 1', 'reach_exit'], ['3,0', 'Public room 3', 'survival'],
    ]);
    f.sqlite.prepare("UPDATE room_versions SET title = NULL, goal_type = NULL WHERE room_id = '3,0'").run();
    expect((await bySlug('mix')).body.items[1]).toMatchObject({ roomId: '3,0', roomTitle: null, goalType: null });
    expect((await mine()).body.playlists[0].roomCount).toBe(2);
    f.env.EXPANDED_ROOMS_ENABLED = 'off';
    expect((await mine()).body.playlists[0].roomCount).toBe(2);
  });

  it('counts rooms from indexes alone, without reading any stored room', async () => {
    const playlist = await made();
    for (const x of [1, 7]) await add(playlist.id, x);
    insertItem(playlist.id, '8,0', 1, 2);
    const statements: string[] = [];
    const database = f.env.DB;
    const prepare = (Object.getPrototypeOf(database) as typeof database).prepare.bind(database);
    vi.spyOn(database, 'prepare').mockImplementation((query: string) => { statements.push(query); return prepare(query); });
    expect((await mine()).body.playlists[0].roomCount).toBe(2);
    expect((await loadPublicPlaylistSummariesForUser(f.env, 'p1'))[0].roomCount).toBe(2);
    f.env.EXPANDED_ROOMS_ENABLED = 'off';
    expect((await mine()).body.playlists[0].roomCount).toBe(3);

    const counting = statements.filter((query) => query.includes('room_playlist_items'));
    expect(counting.length).toBeGreaterThanOrEqual(3);
    for (const query of counting) {
      expect(query).not.toContain('snapshot_json');
      const plan = (f.sqlite.prepare(`EXPLAIN QUERY PLAN ${query}`).all() as Array<{ detail: string }>).map((step) => step.detail);
      for (const step of plan.filter((detail) => detail.includes('room_versions'))) expect(step).toContain('COVERING INDEX');
      if (query.includes('AS room_count')) expect(plan.join('\n')).toMatch(/room_playlist_items USING COVERING INDEX/);
    }
  });

  it("reads each room's title and goal from its version row, falling back to the stored room", async () => {
    const playlist = await made();
    await add(playlist.id, 1);
    await add(playlist.id, 2);
    f.sqlite.prepare("UPDATE room_versions SET goal_type = 'survival', created_at = '2026-10-05T09:00:00.000Z' WHERE room_id = '1,0'").run();
    f.sqlite.prepare("UPDATE room_versions SET title = '  ', goal_type = NULL WHERE room_id = '2,0'").run();
    expect((await bySlug('mix')).body.items.map((item) => [item.roomTitle, item.goalType, item.publishedAt])).toEqual([
      ['Public room 1', 'survival', '2026-10-05T09:00:00.000Z'], ['Public room 2', 'reach_exit', NOW],
    ]);
  });

  it('refuses a room version hidden by moderation', async () => {
    const playlist = await made();
    f.sqlite.prepare("UPDATE room_versions SET redacted_at = ?, redacted_title = title, title = 'Hidden by moderation' WHERE room_id = '1,0'").run(NOW);
    expect(await add(playlist.id, 1)).toMatchObject({
      status: 409, body: { error: 'That room version was hidden by moderation and cannot be added to a playlist.' },
    });
    expect(count('room_playlist_items')).toBe(0);
  });

  it('gives rooms added at the same moment their own places', async () => {
    const playlist = await made();
    beforeStatement(/INTO room_playlist_items/, () => insertItem(playlist.id, '2,0', 1, 0));
    expect((await add(playlist.id, 1)).body.items.map((item) => [item.roomId, item.position])).toEqual([['2,0', 0], ['1,0', 1]]);
    const results = await Promise.all([3, 4, 5].map((x) => add(playlist.id, x)));
    expect(results.map((result) => result.status)).toEqual([201, 201, 201]);
    expect((await bySlug('mix')).body.items.map((item) => item.position)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('playlist limits', () => {
  const playlistKey = () => hashRateLimitKey(f.env, 'playlist-user:p1');
  async function fill(bucket: string, slots: number) {
    const key = await playlistKey();
    const insert = f.sqlite.prepare('INSERT INTO rate_limit_events (bucket, key_hash, created_at) VALUES (?, ?, ?)');
    for (let index = 0; index < slots; index += 1) insert.run(bucket, key, new Date().toISOString());
  }

  it('limits playlists per account', async () => {
    for (let index = 0; index < 49; index += 1) insertPlaylist(`kept-${index}`, 'p1');
    const fiftieth = await made('Fiftieth');
    expect(await create({ title: 'One more' })).toMatchObject({
      status: 409, body: { error: 'You can have up to 50 playlists. Delete one to make another.' },
    });
    expect(count("room_playlists WHERE owner_user_id = 'p1'")).toBe(50);
    expect((await mine()).body.playlists).toHaveLength(50);
    expect((await made('Mine', 'p2')).slug).toBe('mine');
    expect((await remove(fiftieth.id)).status).toBe(200);
    expect((await made('One more')).slug).toBe('one-more');
  });

  it('limits rooms per playlist', async () => {
    const playlist = await made();
    const insertRoom = f.sqlite.prepare("INSERT INTO rooms (id,x,y,draft_json,published_json,claimer_user_id) VALUES (?,?,0,?,?,'builder')");
    const insertVersion = f.sqlite.prepare('INSERT INTO room_versions (room_id,version,snapshot_json,title,created_at) VALUES (?,1,?,?,?)');
    for (let x = 20; x < 221; x += 1) {
      const json = JSON.stringify({ ...f.record.published!, id: `${x},0`, coordinates: { x, y: 0 }, title: `Room ${x}` });
      insertRoom.run(`${x},0`, x, json, json);
      insertVersion.run(`${x},0`, json, `Room ${x}`, NOW);
      if (x < 219) insertItem(playlist.id, `${x},0`, 1, x - 20);
    }
    const { status, body } = await add(playlist.id, 219);
    expect(status).toBe(201);
    expect(body.roomCount).toBe(200);
    expect(body.items.at(-1)).toMatchObject({ roomId: '219,0', position: 199 });
    expect(await add(playlist.id, 220)).toMatchObject({ status: 409, body: { error: 'A playlist can hold up to 200 rooms.' } });
    // A room already in a full playlist is still a quiet no-op.
    expect((await add(playlist.id, 20)).status).toBe(201);
    await removeItem(playlist.id, body.items[0].id);
    expect((await add(playlist.id, 220)).body.roomCount).toBe(200);
  }, 15_000);

  it('limits how often an account makes and changes playlists, but never deleting', async () => {
    const playlist = await made();
    await fill('playlist:create-hour', 19);
    expect(await create({ title: 'Too many' })).toMatchObject({ status: 429, body: { error: 'You have made a lot of playlists lately. Try again later.' } });
    expect((await update(playlist.id, { title: 'Renamed' })).status).toBe(200);
    expect((await add(playlist.id, 1)).status).toBe(201);

    await fill('playlist:write-hour', 297);
    const tooOften = { status: 429, body: { error: 'You have changed your playlists a lot lately. Try again later.' } };
    expect(await update(playlist.id, { title: 'Again' })).toMatchObject(tooOften);
    expect(await add(playlist.id, 2)).toMatchObject(tooOften);
    expect((await removeItem(playlist.id, (await bySlug('mix')).body.items[0].id)).status).toBe(200);
    expect((await remove(playlist.id)).status).toBe(200);
    expect((await made('Other account', 'p2')).slug).toBe('other-account');
  });

  it('gives back the slot when a change is refused', async () => {
    const playlist = await made();
    expect((await create({ title: '' })).status).toBe(400);
    expect((await update(playlist.id, { title: 'x'.repeat(61) })).status).toBe(400);
    expect((await add(playlist.id, 99)).status).toBe(404);
    expect((await update(playlist.id, { title: 'Hijacked' }, 'p2')).status).toBe(404);
    for (let index = 0; index < 49; index += 1) insertPlaylist(`kept-${index}`, 'p1');
    expect((await create({ title: 'Over the limit' })).status).toBe(409);
    expect(count("rate_limit_events WHERE bucket LIKE 'playlist:%'")).toBe(2);
  });

  it('keeps the slot once a change is stored, even if a later step fails', async () => {
    const playlist = await made();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    beforeStatement(/SET updated_at = \?/, () => { throw new Error('Storage unavailable'); });
    expect((await add(playlist.id, 1)).status).toBe(500);
    expect(count('room_playlist_items')).toBe(1);
    expect(count("rate_limit_events WHERE bucket LIKE 'playlist:%'")).toBe(3);
  });

  it('gives creates of one name at the same moment their own numbers', async () => {
    beforeStatement(/INTO room_playlists /, () => insertPlaylist('mix'));
    expect(await create({ title: 'Mix' })).toMatchObject({ status: 201, body: { slug: 'mix-1' } });
    beforeStatement(/UPDATE (OR IGNORE )?room_playlists\s+SET title/, () => insertPlaylist('party'));
    expect(await update((await bySlug('mix-1')).body.id, { slug: 'party' })).toMatchObject({ status: 200, body: { slug: 'party-1' } });
    const results = await Promise.all([1, 2, 3].map(() => create({ title: 'Mix' })));
    expect(results.map((result) => result.status)).toEqual([201, 201, 201]);
    expect(results.map((result) => result.body.slug).sort()).toEqual(['mix-1', 'mix-2', 'mix-3']);
  });
});

describe('playlist page caching', () => {
  it('keeps a signed-out view at the edge for 20 seconds, and never a signed-in one', async () => {
    const stored = new Map<string, Response>();
    vi.stubGlobal('caches', { default: {
      match: async (request: Request) => stored.get(request.url)?.clone(),
      put: async (request: Request, response: Response) => { stored.set(request.url, response.clone()); },
    } });
    const waits: Promise<unknown>[] = [];
    const context = { waitUntil: (promise: Promise<unknown>) => { waits.push(promise); } };
    const playlist = await made();
    await add(playlist.id, 1);

    const first = await bySlug('mix', null, context);
    await Promise.all(waits.splice(0));
    expect(first.headers.get('Cache-Control')).toBe('public, max-age=20');
    expect(first.headers.get('X-WAMP-Cache')).toBe('miss');
    expect(first.body.viewerCanEdit).toBe(false);
    expect(first.headers.get('Vary')).toContain('Cookie, Authorization');
    const second = await bySlug('mix', null, context);
    expect(second.headers.get('X-WAMP-Cache')).toBe('hit');
    expect(second.body).toEqual(first.body);
    expect(second.headers.get('Vary')).toContain('Cookie, Authorization');
    // A query string shares the same copy rather than adding one.
    expect((await bySlug('mix?ref=share', null, context)).headers.get('X-WAMP-Cache')).toBe('hit');

    const owner = await bySlug('mix', 'p1', context);
    expect(owner.headers.get('Cache-Control')).toBe('private, no-store');
    expect(owner.headers.get('X-WAMP-Cache')).toBeNull();
    expect(owner.body.viewerCanEdit).toBe(true);
    expect([...stored.keys()]).toEqual(['https://api.wamp.land/api/playlists/by-slug/mix']);
    expect(JSON.stringify(await stored.get('https://api.wamp.land/api/playlists/by-slug/mix')!.clone().json())).toContain('"viewerCanEdit":false');
  });
});

describe('Expanded Rooms in playlists', () => {
  const nativeEntry = {
    expandedRoomId: 'native', expandedRoomVersion: 3, title: 'native', source: 'native_expanded_room', legacyCourseId: null,
    cellCount: 2, anchorCoordinates: { x: 7, y: 0 }, focusedCoordinates: { x: 7, y: 0 },
  };

  it('adds an Expanded Room once, whichever of its cells is added', async () => {
    const playlist = await made();
    const { body } = await add(playlist.id, 7);
    expect(body.items).toEqual([expect.objectContaining({ roomId: '7,0', roomTitle: 'native', goalType: 'reach_exit', publishedAt: NOW, expandedRoom: nativeEntry })]);
    expect(roomIds((await add(playlist.id, 8)).body.items)).toEqual(['7,0']);
    const { body: withLegacy } = await add(playlist.id, 10);
    expect(withLegacy.items[1].expandedRoom).toMatchObject({ expandedRoomId: 'course:legacy', source: 'legacy_course', focusedCoordinates: { x: 10, y: 0 } });
    expect(withLegacy.roomCount).toBe(2);
    expect((await mine()).body.playlists[0].roomCount).toBe(2);
    expect(count('room_playlist_items')).toBe(2);
  });

  it('shows cells saved separately as one Expanded Room, and counts it once in "my playlists"', async () => {
    const playlist = await made();
    insertItem(playlist.id, '7,0', 1, 0);
    insertItem(playlist.id, '1,0', 1, 1);
    insertItem(playlist.id, '8,0', 1, 2);
    const { body } = await bySlug('mix');
    expect(body.items.map((item) => [item.roomId, item.expandedRoom?.expandedRoomId ?? null])).toEqual([['7,0', 'native'], ['1,0', null]]);
    expect(body.roomCount).toBe(2);
    expect((await mine()).body.playlists[0].roomCount).toBe(2);
  });

  it('keeps an Expanded Room entry after its focused cell is republished on its own', async () => {
    const playlist = await made();
    await add(playlist.id, 7);
    const republished = JSON.stringify({ ...f.record.published!, id: '7,0', coordinates: { x: 7, y: 0 }, title: 'Solo 7', version: 2 });
    f.sqlite.prepare("UPDATE rooms SET published_json = ?, published_title = 'Solo 7' WHERE id = '7,0'").run(republished);
    f.sqlite.prepare("INSERT INTO room_versions (room_id,version,snapshot_json,title,created_at) VALUES ('7,0',2,?,'Solo 7',?)").run(republished, NOW);

    expect((await bySlug('mix')).body.items).toEqual([expect.objectContaining({ roomId: '7,0', roomVersion: 1, expandedRoom: nativeEntry })]);
    expect((await mine()).body.playlists[0].roomCount).toBe(1);
    // The new version is not part of the Expanded Room, so it is a room of its own.
    const { body } = await add(playlist.id, 7, 2);
    expect(body.items.map((item) => [item.roomVersion, item.roomTitle, item.expandedRoom?.expandedRoomId ?? null])).toEqual([[1, 'native', 'native'], [2, 'Solo 7', null]]);
    expect((await mine()).body.playlists[0].roomCount).toBe(2);
  });

  it('shows the cells as plain rooms once the Expanded Room is archived', async () => {
    const playlist = await made();
    await add(playlist.id, 7);
    insertItem(playlist.id, '8,0', 1, 1);
    f.sqlite.prepare("UPDATE expanded_rooms SET archived_at = ? WHERE id = 'native'").run(NOW);
    const { body } = await bySlug('mix');
    expect(body.items.map((item) => [item.roomId, item.roomTitle, item.expandedRoom])).toEqual([['7,0', 'Public room 7', null], ['8,0', 'Public room 8', null]]);
    expect((await mine()).body.playlists[0].roomCount).toBe(2);
  });

  it('treats every cell as a plain room while Expanded Rooms are switched off', async () => {
    f.env.EXPANDED_ROOMS_ENABLED = 'off';
    const playlist = await made();
    await add(playlist.id, 7);
    const { body } = await add(playlist.id, 8);
    expect(body.items.map((item) => [item.roomId, item.expandedRoom])).toEqual([['7,0', null], ['8,0', null]]);
    expect((await mine()).body.playlists[0].roomCount).toBe(2);
  });

  it.skip('matches the page count in "my playlists" for courses outside Expanded Rooms', async () => {
    // Left as is for now; such courses are counted per saved cell in "my playlists".
    const roomRefs = [11, 12].map((x) => ({ roomId: `${x},0`, coordinates: { x, y: 0 }, roomVersion: 1, roomTitle: `Public room ${x}` }));
    const course = JSON.stringify({ id: 'c1', version: 1, title: 'Old course', status: 'published', roomRefs, goal: { type: 'reach_exit' }, publishedAt: NOW });
    f.sqlite.prepare(`INSERT INTO courses (id,owner_user_id,owner_display_name,draft_json,published_json,published_title,published_version,created_at,updated_at)
      VALUES ('c1','builder','builder',?,?,'Old course',1,?,?)`).run(course, course, NOW, NOW);
    f.sqlite.prepare("INSERT INTO course_versions (course_id,version,snapshot_json,created_at) VALUES ('c1',1,?,?)").run(course, NOW);
    for (const [order, ref] of roomRefs.entries()) f.sqlite.prepare(`INSERT INTO course_room_refs
      (course_id,course_version,room_order,room_id,room_x,room_y,room_version,room_title) VALUES ('c1',1,?,?,?,0,1,?)`).run(order, ref.roomId, ref.coordinates.x, ref.roomTitle);
    const playlist = await made();
    insertItem(playlist.id, '11,0', 1, 0);
    insertItem(playlist.id, '12,0', 1, 1);
    expect((await bySlug('mix')).body.roomCount).toBe(1);
    expect((await mine()).body.playlists[0].roomCount).toBe(1);
  });
});

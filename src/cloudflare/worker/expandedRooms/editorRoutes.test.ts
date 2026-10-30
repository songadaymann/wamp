import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultCourseSnapshot } from '../../../courses/model';
import { publishRoomAs, publishRoomSnapshot, roomSnapshot, workerApi, type WorkerApi } from '../core/workerApi.testSupport';

// Expanded Room create, edit, publish and unpublish through the /api/expanded-rooms routes the
// editor and composer call today (F487). These are the safety net for moving Expanded Rooms onto
// one server path (F270, F268, F273), so they only use URLs and response bodies.
//
// Cells: 0,0 (fixture), 1,0 and 2,0 are published by "builder"; -1,0 by "p1".
let api: WorkerApi;
let builder: string;
let other: string;
let clock = 0;
const tick = () => { clock += 1_000; vi.setSystemTime(clock); };

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  clock = Date.parse('2026-10-04T18:00:00.000Z');
  vi.setSystemTime(clock);
  api = workerApi();
  builder = await api.signIn('builder');
  other = await api.signIn('p1');
  await publishRoomAs(api, builder, 1, 0, { title: 'Middle' });
  await publishRoomAs(api, builder, 2, 0, { title: 'East' });
  await publishRoomAs(api, other, -1, 0, { title: 'Someone else' });
  // New builders get one cell; the admin override stands in for a higher trust tier.
  await api.setBuilderCaps('builder', { expandedRoomCellLimit: 4 });
});
afterEach(() => { api.close(); vi.useRealTimers(); });

const ref = (x: number, y: number, roomVersion = 1) => ({ roomId: `${x},${y}`, coordinates: { x, y }, roomVersion, roomTitle: null });
const roomIds = (record: { draft: { roomRefs: Array<{ roomId: string }> } }) => record.draft.roomRefs.map((entry) => entry.roomId).sort();
const complete = {
  title: 'Three Rooms',
  startPoint: { roomId: '0,0', x: 64, y: 256 },
  goal: { type: 'reach_exit', exit: { roomId: '2,0', x: 600, y: 256 }, timeLimitMs: null },
};
const path = (id: string, action = '') => `/api/expanded-rooms/${encodeURIComponent(`course:${id}`)}${action}`;

async function create(id: string, refs: unknown[], extra: Record<string, unknown> = {}, session = builder) {
  return api.call('/api/expanded-rooms', { session, body: { ...createDefaultCourseSnapshot(id), roomRefs: refs, ...extra } });
}
async function saveDraft(id: string, draft: unknown, session = builder) {
  return api.call(path(id, '/draft'), { method: 'PUT', session, body: draft });
}
/** A published three-cell Expanded Room "er" owned by builder. */
async function publishedThreeCells() {
  const created = await create('er', [ref(0, 0), ref(1, 0), ref(2, 0)], complete);
  expect(created.status).toBe(200);
  const published = await api.call(path('er', '/publish'), { method: 'POST', session: builder });
  expect(published.status).toBe(200);
  return published.body;
}

describe('the Expanded Room editor lifecycle', () => {
  it('creates a one-cell draft, expands it, publishes it for everyone, and unpublishes it', async () => {
    const created = await create('er', [ref(0, 0)]);
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      ownerUserId: 'builder', published: null, versions: [], expandedRoomCellLimit: 4,
      draft: { id: 'er', status: 'draft' },
      permissions: { canSaveDraft: true, canPublish: true, canUnpublish: true },
    });
    expect((await api.call(path('er'))).status).toBe(404);

    const expanded = await api.call(path('er', '/cells'), { session: builder, body: { roomId: '1,0', coordinates: { x: 1, y: 0 }, roomVersion: 1 } });
    expect(expanded.status).toBe(200);
    expect(roomIds(expanded.body)).toEqual(['0,0', '1,0']);
    expect(expanded.body.draft.roomRefs.find((entry: { roomId: string }) => entry.roomId === '1,0')).toMatchObject({ roomVersion: 1, roomTitle: 'Middle' });

    const saved = await saveDraft('er', { ...expanded.body.draft, ...complete, goal: { ...complete.goal, exit: { roomId: '1,0', x: 600, y: 256 } } });
    expect(saved.status).toBe(200);
    expect(saved.body.draft).toMatchObject({ title: 'Three Rooms', startPoint: { roomId: '0,0' } });

    const published = await api.call(path('er', '/publish'), { method: 'POST', session: builder });
    expect(published.status).toBe(200);
    expect(published.body.published).toMatchObject({ id: 'er', status: 'published', version: 1, title: 'Three Rooms' });
    expect(published.body.versions.map((entry: { version: number }) => entry.version)).toEqual([1]);

    const publicView = await api.call(path('er'));
    expect(publicView.status).toBe(200);
    expect(JSON.stringify(publicView.body)).toContain('Three Rooms');
    const byCell = await api.call('/api/expanded-rooms/by-coordinate/1/0');
    expect(byCell.status).toBe(200);
    expect(JSON.stringify(byCell.body)).toContain('Three Rooms');

    const unpublished = await api.call(path('er', '/unpublish'), { method: 'POST', session: builder });
    expect(unpublished.status).toBe(200);
    expect(unpublished.body).toMatchObject({ published: null, draft: { title: 'Three Rooms' } });
    expect((await api.call(path('er'))).status).toBe(404);
    expect((await api.call(path('er', '/unpublish'), { method: 'POST', session: builder })).status).toBe(409);

    // Publishing again keeps the history and adds the next version.
    tick();
    const again = await api.call(path('er', '/publish'), { method: 'POST', session: builder });
    expect(again.body.published.version).toBe(2);
    expect(again.body.versions.map((entry: { version: number }) => entry.version)).toEqual([1, 2]);
  });

  it('opens the editor record and the draft for a cell for the owner only', async () => {
    await create('er', [ref(0, 0), ref(1, 0)]);
    const record = await api.call(path('er', '/editor-record'), { session: builder });
    expect(record.status).toBe(200);
    expect(record.body).toMatchObject({ draft: { id: 'er' }, expandedRoomCellLimit: 4 });
    expect((await api.call(path('er', '/editor-record'), { session: other })).status).toBe(403);
    expect((await api.call(path('er', '/editor-record'))).status).toBe(401);
    expect((await api.call(path('missing', '/editor-record'), { session: builder })).status).toBe(404);
    const standalone = await api.call(`/api/expanded-rooms/${encodeURIComponent('room:0,0')}/editor-record`, { session: builder });
    expect(standalone.status).toBe(409);
    expect(standalone.body.error).toMatch(/room editor/);

    const byRoom = await api.call(`/api/expanded-rooms/drafts/by-room/${encodeURIComponent('1,0')}`, { session: builder });
    expect(byRoom.status).toBe(200);
    expect(byRoom.body.draft.id).toBe('er');
    expect((await api.call(`/api/expanded-rooms/drafts/by-room/${encodeURIComponent('1,0')}`, { session: other })).status).toBe(404);
    expect((await api.call(`/api/expanded-rooms/drafts/by-room/${encodeURIComponent('2,0')}`, { session: builder })).status).toBe(404);
  });
});

describe('who may change an Expanded Room', () => {
  it('refuses every write by someone who does not own it, and by signed-out callers', async () => {
    const published = await publishedThreeCells();
    const writes = [
      () => ['PUT', path('er', '/draft'), { ...published.draft, title: 'Hijacked' }],
      () => ['POST', path('er', '/publish'), undefined],
      () => ['POST', path('er', '/unpublish'), undefined],
      () => ['POST', path('er', '/cells'), { roomId: '-1,0' }],
      () => ['DELETE', path('er', `/cells/${encodeURIComponent('2,0')}`), undefined],
    ] as const;
    for (const write of writes) {
      const [method, url, body] = write();
      const asOther = await api.call(url, { method, body, session: other });
      expect([method, url, asOther.status]).toEqual([method, url, 403]);
      const signedOut = await api.call(url, { method, body });
      expect([method, url, signedOut.status]).toEqual([method, url, 401]);
    }
    const after = await api.call(path('er'));
    expect(after.status).toBe(200);
    expect(JSON.stringify(after.body)).toContain('Three Rooms');
    expect(roomIds((await api.call(path('er', '/editor-record'), { session: builder })).body)).toEqual(['0,0', '1,0', '2,0']);
  });

  it('refuses a create that reuses the id of an Expanded Room someone else owns', async () => {
    // The create used to overwrite that row: a new owner, a new draft, and no longer published.
    await publishedThreeCells();
    const takeover = await create('er', [ref(-1, 0)], { title: 'Mine now' }, other);
    expect(takeover.status).toBe(403);
    const after = await api.call(path('er', '/editor-record'), { session: builder });
    expect(after.body).toMatchObject({ ownerUserId: 'builder', draft: { title: 'Three Rooms' }, published: { version: 1 } });
    expect((await api.call(path('er'))).status).toBe(200);
    for (const legacyRoute of ['/api/courses']) {
      const viaCourses = await api.call(legacyRoute, { session: other, body: { ...createDefaultCourseSnapshot('er'), roomRefs: [ref(-1, 0)] } });
      expect([legacyRoute, viaCourses.status]).toEqual([legacyRoute, 403]);
    }
    // The owner can still repeat a create with their own id.
    expect((await create('er', [ref(0, 0), ref(1, 0), ref(2, 0)], complete)).status).toBe(200);
  });

  it('refuses writes from a suspended owner', async () => {
    await publishedThreeCells();
    api.sqlite.prepare("UPDATE users SET suspended_at = ?, suspended_reason = 'raid' WHERE id = 'builder'").run(new Date().toISOString());
    for (const [method, url] of [['POST', path('er', '/unpublish')], ['POST', path('er', '/publish')], ['POST', '/api/expanded-rooms']] as const) {
      const response = await api.call(url, { method, session: builder, body: url === '/api/expanded-rooms' ? { ...createDefaultCourseSnapshot('new'), roomRefs: [ref(0, 0)] } : undefined });
      expect([url, response.status]).toEqual([url, 403]);
    }
    expect((await api.call(path('er'))).status).toBe(200);
  });
});

describe('Expanded Room cells', () => {
  it('only adds a current, published, connected cell by the same creator, within the cell limit', async () => {
    await create('er', [ref(0, 0)]);
    const add = (body: unknown) => api.call(path('er', '/cells'), { session: builder, body });

    const unpublished = await add({ roomId: '0,1', coordinates: { x: 0, y: 1 } });
    expect([unpublished.status, unpublished.body.error]).toEqual([409, 'Expanded room cells must be published rooms.']);
    expect((await add({ roomId: '1,0', roomVersion: 2 })).status).toBe(409);
    expect((await add({ roomId: '0,0' })).status).toBe(409);
    const foreign = await add({ roomId: '-1,0' });
    expect([foreign.status, foreign.body.error]).toEqual([403, 'All expanded room cells must be published by the same creator.']);
    const detached = await add({ roomId: '2,0' });
    expect([detached.status, detached.body.error]).toEqual([400, 'Expanded room cells must stay in one connected cluster.']);
    expect((await add({ roomId: '1,0', coordinates: { x: 2, y: 0 } })).status).toBe(400);
    expect((await add({})).status).toBe(400);
    expect((await add({ roomId: '1,0', roomVersion: 0 })).status).toBe(400);

    await api.setBuilderCaps('builder', { expandedRoomCellLimit: 2 });
    expect((await add({ x: 1, y: 0 })).status).toBe(200);
    const overLimit = await add({ roomId: '2,0' });
    expect([overLimit.status, overLimit.body.error]).toEqual([400, 'Expanded rooms can span at most 2 cells at your builder tier.']);
    expect(roomIds((await api.call(path('er', '/editor-record'), { session: builder })).body)).toEqual(['0,0', '1,0']);
  });

  it('removes a cell with its markers, but never the anchor, a minted cell, or one that holds the rest together', async () => {
    await create('er', [ref(0, 0), ref(1, 0), ref(2, 0)], complete);
    const remove = (roomId: string) => api.call(path('er', `/cells/${encodeURIComponent(roomId)}`), { method: 'DELETE', session: builder });

    expect(await remove('0,0')).toMatchObject({ status: 409, body: { error: 'Anchor cells cannot be removed.' } });
    expect(await remove('1,0')).toMatchObject({ status: 409, body: { error: 'Removing this cell would split the expanded room.' } });
    expect((await remove('9,9')).status).toBe(404);

    api.sqlite.prepare(`UPDATE rooms SET minted_chain_id = 8453, minted_contract_address = '0x2222222222222222222222222222222222222222',
      minted_token_id = '7' WHERE id = '2,0'`).run();
    expect(await remove('2,0')).toMatchObject({ status: 409, body: { error: 'Minted protected cells cannot be removed.' } });
    api.sqlite.prepare('UPDATE rooms SET minted_chain_id = NULL, minted_contract_address = NULL, minted_token_id = NULL WHERE id = ?').run('2,0');

    const removed = await remove('2,0');
    expect(removed.status).toBe(200);
    expect(roomIds(removed.body)).toEqual(['0,0', '1,0']);
    expect(JSON.stringify(removed.body.draft.goal ?? null)).not.toContain('2,0');
    expect(removed.body.draft.startPoint).toMatchObject({ roomId: '0,0' });
  });
});

describe('publishing an Expanded Room', () => {
  it('publishes only a titled draft of two or more cells with a goal and a start', async () => {
    const tryPublish = async (refs: unknown[], extra: Record<string, unknown>) => {
      await create('er', refs, extra);
      return api.call(path('er', '/publish'), { method: 'POST', session: builder });
    };
    const twoCellGoal = { ...complete.goal, exit: { roomId: '1,0', x: 600, y: 256 } };
    expect(await tryPublish([ref(0, 0)], { ...complete, goal: { ...complete.goal, exit: { roomId: '0,0', x: 600, y: 256 } } }))
      .toMatchObject({ status: 400, body: { error: 'Published expanded rooms need at least 2 cells.' } });
    expect(await tryPublish([ref(0, 0), ref(1, 0)], { ...complete, goal: twoCellGoal, title: '  ' }))
      .toMatchObject({ status: 400, body: { error: 'Published expanded rooms need a title.' } });
    expect(await tryPublish([ref(0, 0), ref(1, 0)], { ...complete, goal: null }))
      .toMatchObject({ status: 400, body: { error: 'Published expanded rooms need a goal.' } });
    expect(await tryPublish([ref(0, 0), ref(1, 0)], { ...complete, goal: twoCellGoal, startPoint: null }))
      .toMatchObject({ status: 400, body: { error: 'Published expanded rooms need a start point.' } });
    const markerOutside = await create('er', [ref(0, 0), ref(1, 0)], complete);
    expect([markerOutside.status, markerOutside.body.error]).toEqual([400, 'Exit must belong to a room in the expanded room.']);
    expect((await api.call(path('er'))).status).toBe(404);
  });

  it('keeps a cell in one published Expanded Room at a time', async () => {
    await publishedThreeCells();
    await create('second', [ref(1, 0), ref(2, 0)], { ...complete, startPoint: { roomId: '1,0', x: 64, y: 256 } });
    const conflict = await api.call(path('second', '/publish'), { method: 'POST', session: builder });
    expect([conflict.status, conflict.body.error]).toEqual([409, 'A room can only belong to one active published expanded room.']);
    // Once the first is unpublished, its cells are free.
    await api.call(path('er', '/unpublish'), { method: 'POST', session: builder });
    expect((await api.call(path('second', '/publish'), { method: 'POST', session: builder })).status).toBe(200);
  });

  it('pins cells to the room versions it was saved with, and moves them to the latest on publish', async () => {
    await create('er', [ref(0, 0), ref(1, 0), ref(2, 0)], complete);
    tick();
    expect((await publishRoomSnapshot(api, builder, roomSnapshot(1, 0, { title: 'Middle, revised' }))).status).toBe(200);
    const record = await api.call(path('er', '/editor-record'), { session: builder });
    expect(record.body.draft.roomRefs.find((entry: { roomId: string }) => entry.roomId === '1,0').roomVersion).toBe(1);

    const published = await api.call(path('er', '/publish'), { method: 'POST', session: builder });
    expect(published.body.published.roomRefs.find((entry: { roomId: string }) => entry.roomId === '1,0'))
      .toMatchObject({ roomVersion: 2, roomTitle: 'Middle, revised' });
  });

  it('will not pin a cell to a room version hidden by moderation', async () => {
    tick();
    await publishRoomSnapshot(api, builder, roomSnapshot(1, 0, { title: 'Middle, revised' }));
    await api.call(`/api/admin/rooms/${encodeURIComponent('1,0')}/versions/1/hide`, { admin: true, body: { reason: 'fixture' } });
    const pinnedHidden = await create('er', [ref(0, 0), ref(1, 0, 1)]);
    expect(pinnedHidden.status).toBe(404);
    expect((await create('er', [ref(0, 0), ref(1, 0, 2)])).status).toBe(200);
  });
});

// Known gap: whole-draft saves ignore the base, unlike cell saves (F379). Keep the desired
// two-tab contract executable before the shared-backend work; remove .fails when it is fixed.
it.fails('refuses an Expanded Room whole-draft save based on an older save', async () => {
  const created = await create('er', [ref(0, 0), ref(1, 0), ref(2, 0)], complete);
  expect(created.status).toBe(200);
  const original = created.body.draft;
  const base = original.updatedAt as string;
  const saveFromBase = (title: string) => api.call(
    `${path('er', '/draft')}?baseUpdatedAt=${encodeURIComponent(base)}`,
    { method: 'PUT', session: builder, body: { ...original, title } },
  );

  tick();
  const otherTab = await saveFromBase('Other tab');
  expect(otherTab.status).toBe(200);
  expect(otherTab.body.draft.updatedAt).not.toBe(base);

  tick();
  const staleTab = await saveFromBase('Stale tab');
  expect(staleTab.status).toBe(409);
  const stored = await api.call(path('er', '/editor-record'), { session: builder });
  expect(stored.body.draft.title).toBe('Other tab');
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROOM_EDIT_CONFLICT_MESSAGE } from '../../../persistence/roomEditConflict';
import {
  publishRoomAs,
  publishRoomSnapshot,
  roomSnapshot,
  saveRoomDraft,
  workerApi,
  type WorkerApi,
} from '../core/workerApi.testSupport';

// Room save and publish as the room editor and bots call them (F487). Room 0,0 is published by
// "builder" in the fixture; other cells start empty.
let api: WorkerApi;
let clock = Date.parse('2026-10-04T18:00:00.000Z');
/** Moves the clock on, so each save gets its own updatedAt. */
const tick = () => { clock += 1_000; vi.setSystemTime(clock); };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  clock = Date.parse('2026-10-04T18:00:00.000Z');
  vi.setSystemTime(clock);
  api = workerApi();
});
afterEach(() => { api.close(); vi.useRealTimers(); vi.restoreAllMocks(); });

const room = (x: number, y: number) => `/api/rooms/${encodeURIComponent(`${x},${y}`)}`;

describe('saving room drafts', () => {
  it('claims a frontier cell with the first save and keeps the draft out of public reads until publish', async () => {
    const builder = await api.signIn('builder');
    const saved = await saveRoomDraft(api, builder, roomSnapshot(1, 0, { title: 'Work in progress' }));
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      claimerUserId: 'builder',
      published: null,
      versions: [],
      draft: { id: '1,0', status: 'draft', title: 'Work in progress' },
      permissions: { canSaveDraft: true, canPublish: true },
    });

    expect((await api.call(`${room(1, 0)}/published`)).status).toBe(404);
    const reloaded = await api.call(room(1, 0), { session: builder });
    expect(reloaded.body.draft.title).toBe('Work in progress');
    expect(reloaded.body.draft.updatedAt).toBe(saved.body.draft.updatedAt);
  });

  it('lets only the claimer save or publish a claimed room that is not published yet', async () => {
    const builder = await api.signIn('builder');
    const other = await api.signIn('p1');
    await saveRoomDraft(api, builder, roomSnapshot(1, 0, { title: 'Mine' }));

    for (const write of [saveRoomDraft, publishRoomSnapshot]) {
      const refused = await write(api, other, roomSnapshot(1, 0, { title: 'Taken over' }));
      expect(refused.status).toBe(403);
      expect(refused.body.error).toMatch(/Only the room claimer/);
    }
    const kept = await api.call(room(1, 0), { session: builder });
    expect(kept.body).toMatchObject({ claimerUserId: 'builder', draft: { title: 'Mine' }, published: null });
  });

  it('refuses signed-out, foreign-origin and suspended writes but still serves reads', async () => {
    const snapshot = roomSnapshot(1, 0);
    const signedOut = await api.call(`${room(1, 0)}/draft`, { method: 'PUT', body: snapshot });
    expect(signedOut.status).toBe(401);
    expect((await api.call(`${room(1, 0)}/publish`, { body: snapshot })).status).toBe(401);
    expect((await api.call(`${room(1, 0)}/draft`, { method: 'PUT', body: snapshot, session: 'not-a-session' })).status).toBe(401);

    const builder = await api.signIn('builder');
    const foreign = await api.call(`${room(1, 0)}/draft`, { method: 'PUT', body: snapshot, session: builder, origin: 'https://evil.example' });
    expect(foreign.status).toBe(403);
    expect(foreign.body.error).toMatch(/origin/i);

    api.sqlite.prepare("UPDATE users SET suspended_at = ?, suspended_reason = 'raid' WHERE id = 'builder'").run(new Date().toISOString());
    for (const write of [saveRoomDraft, publishRoomSnapshot]) {
      const suspended = await write(api, builder, snapshot);
      expect(suspended.status).toBe(403);
      expect(suspended.body.error).toMatch(/suspended/);
    }
    expect((await api.call(`${room(0, 0)}/published`, { session: builder })).status).toBe(200);
    expect((await api.call(room(1, 0), { session: builder })).body.claimerUserId).toBeNull();
  });

  it('rejects a snapshot whose id does not match the room in the URL', async () => {
    const builder = await api.signIn('builder');
    const mismatched = await api.call(`${room(1, 0)}/draft`, { method: 'PUT', body: roomSnapshot(2, 0), session: builder });
    expect(mismatched.status).toBe(400);
    expect((await api.call(`${room(1, 0)}/draft`, { method: 'PUT', body: { title: 'not a room' }, session: builder })).status).toBe(400);
  });
});

describe('edit conflicts (F058, F379)', () => {
  it('refuses a save or publish based on an older save, and lets a write without a base overwrite', async () => {
    const builder = await api.signIn('builder');
    const first = await saveRoomDraft(api, builder, roomSnapshot(1, 0, { title: 'First' }));
    const base = first.body.draft.updatedAt as string;

    // Another tab saves from the same base: allowed, and it moves the stored base on.
    tick();
    const otherTab = await saveRoomDraft(api, builder, roomSnapshot(1, 0, { title: 'Other tab' }), `baseUpdatedAt=${encodeURIComponent(base)}`);
    expect(otherTab.status).toBe(200);
    expect(otherTab.body.draft.updatedAt).not.toBe(base);

    // The first tab still has the old base.
    tick();
    const staleSave = await saveRoomDraft(api, builder, roomSnapshot(1, 0, { title: 'Stale tab' }), `baseUpdatedAt=${encodeURIComponent(base)}`);
    expect(staleSave.status).toBe(409);
    expect(staleSave.body.error).toBe(ROOM_EDIT_CONFLICT_MESSAGE);
    const stalePublish = await publishRoomSnapshot(api, builder, roomSnapshot(1, 0, { title: 'Stale tab' }), `baseUpdatedAt=${encodeURIComponent(base)}`);
    expect(stalePublish.status).toBe(409);
    expect(stalePublish.body.error).toBe(ROOM_EDIT_CONFLICT_MESSAGE);

    const stored = await api.call(room(1, 0), { session: builder });
    expect(stored.body).toMatchObject({ draft: { title: 'Other tab' }, published: null, versions: [] });

    // "Keep mine" sends no base and overwrites.
    tick();
    const keepMine = await saveRoomDraft(api, builder, roomSnapshot(1, 0, { title: 'Stale tab' }));
    expect(keepMine.status).toBe(200);
    expect(keepMine.body.draft.title).toBe('Stale tab');
  });

  it('checks the base on a published room too, and accepts a publish from the current base', async () => {
    const builder = await api.signIn('builder');
    const current = await api.call(room(0, 0), { session: builder });
    const base = current.body.draft.updatedAt as string;
    tick();
    const fresh = await publishRoomSnapshot(api, builder, roomSnapshot(0, 0, { title: 'Second take' }), `baseUpdatedAt=${encodeURIComponent(base)}`);
    expect(fresh.status).toBe(200);
    expect(fresh.body.published).toMatchObject({ version: 2, title: 'Second take' });

    tick();
    const stale = await publishRoomSnapshot(api, builder, roomSnapshot(0, 0, { title: 'Third take' }), `baseUpdatedAt=${encodeURIComponent(base)}`);
    expect(stale.status).toBe(409);
    expect((await api.call(`${room(0, 0)}/published`)).body).toMatchObject({ version: 2, title: 'Second take' });
  });

  it('rejects an oversized base timestamp', async () => {
    const builder = await api.signIn('builder');
    const response = await saveRoomDraft(api, builder, roomSnapshot(1, 0), `baseUpdatedAt=${'9'.repeat(65)}`);
    expect(response.status).toBe(400);
  });
});

describe('publishing rooms and version history', () => {
  it('publishes version 1, and each republish adds the next version credited to its publisher', async () => {
    const builder = await api.signIn('builder');
    const first = await publishRoomAs(api, builder, 1, 0, { title: 'Opening' });
    expect(first).toMatchObject({
      claimerUserId: 'builder',
      published: { id: '1,0', status: 'published', version: 1, title: 'Opening' },
      draft: { status: 'draft', version: 1, title: 'Opening' },
    });
    expect(first.versions).toHaveLength(1);

    tick();
    const second = await publishRoomSnapshot(api, builder, roomSnapshot(1, 0, { title: 'Encore' }));
    expect(second.status).toBe(200);
    expect(second.body.published).toMatchObject({ version: 2, title: 'Encore' });
    expect((await api.call(`${room(1, 0)}/published`)).body).toMatchObject({ version: 2, title: 'Encore' });

    const page = await api.call(`${room(1, 0)}/versions`);
    expect(page.status).toBe(200);
    expect(page.body.versions.map((entry: { version: number; title: string; publishedByUserId: string }) =>
      [entry.version, entry.title, entry.publishedByUserId])).toEqual([[2, 'Encore', 'builder'], [1, 'Opening', 'builder']]);
    const exact = await api.call(`${room(1, 0)}/versions/1`);
    expect(exact.body.snapshot).toMatchObject({ version: 1, title: 'Opening' });
    expect((await api.call(`${room(1, 0)}/versions/3`)).status).toBe(404);
    expect((await api.call(`${room(1, 0)}/versions/0`)).status).toBe(400);
  });

  it('returns the compact shape when asked', async () => {
    const builder = await api.signIn('builder');
    const compact = await saveRoomDraft(api, builder, roomSnapshot(1, 0), 'response=compact');
    expect(compact.status).toBe(200);
    expect(Object.keys(compact.body).sort()).toEqual(['draft', 'published', 'summary']);
    expect(compact.body.summary).toMatchObject({ id: '1,0' });
  });

  it("lets another builder publish over a published WAMP 0 room without taking the builder's claim", async () => {
    const visitor = await api.signIn('p1');
    const edited = await publishRoomSnapshot(api, visitor, roomSnapshot(0, 0, { title: 'Visitor remix' }));
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ claimerUserId: 'builder', published: { version: 2, title: 'Visitor remix' } });
    const page = await api.call(`${room(0, 0)}/versions`);
    expect(page.body.versions[0]).toMatchObject({ version: 2, publishedByUserId: 'p1' });
    // ...but not revert it: that stays with the claimer.
    expect((await api.call(`${room(0, 0)}/revert`, { body: { targetVersion: 1 }, session: visitor })).status).toBe(403);
  });

  it('reverts to an earlier version by publishing it again as the next version', async () => {
    const builder = await api.signIn('builder');
    tick();
    await publishRoomSnapshot(api, builder, roomSnapshot(0, 0, { title: 'Worse' }));
    tick();
    const reverted = await api.call(`${room(0, 0)}/revert`, { body: { targetVersion: 1 }, session: builder });
    expect(reverted.status).toBe(200);
    expect(reverted.body.published).toMatchObject({ version: 3, title: 'Lava Gauntlet' });
    const page = await api.call(`${room(0, 0)}/versions`);
    expect(page.body.versions[0]).toMatchObject({ version: 3, revertedFromVersion: 1 });
    expect((await api.call(`${room(0, 0)}/revert`, { body: { targetVersion: 9 }, session: builder })).status).toBe(404);
    expect((await api.call(`${room(0, 0)}/revert`, { body: { targetVersion: 0 }, session: builder })).status).toBe(400);
  });

  it('keeps a hidden version hidden through later publishes, and never reuses its number', async () => {
    const builder = await api.signIn('builder');
    tick();
    await publishRoomSnapshot(api, builder, roomSnapshot(0, 0, { title: 'Rude title' }));
    tick();
    await publishRoomSnapshot(api, builder, roomSnapshot(0, 0, { title: 'Cleaned up' }));
    const hide = await api.call(`/api/admin/rooms/${encodeURIComponent('0,0')}/versions/2/hide`, { admin: true, body: { reason: 'fixture' } });
    expect(hide.status).toBe(200);

    tick();
    const next = await publishRoomSnapshot(api, builder, roomSnapshot(0, 0, { title: 'Fourth' }));
    expect(next.body.published.version).toBe(4);
    const titles = (next.body.versions as Array<{ version: number; snapshot: { title: string } }>)
      .map((entry) => [entry.version, entry.snapshot.title]);
    expect(titles).toEqual([[1, 'Lava Gauntlet'], [2, 'Hidden by moderation'], [3, 'Cleaned up'], [4, 'Fourth']]);
    expect((await api.call(`${room(0, 0)}/versions/2`)).body.snapshot.title).toBe('Hidden by moderation');
    const restore = await api.call(`${room(0, 0)}/revert`, { body: { targetVersion: 2 }, session: builder });
    expect(restore.status).toBe(409);
  });
});

describe('draft commands and the leaderboard version', () => {
  it('builds a draft from commands, as bots do, and keeps the same claim rules', async () => {
    const builder = await api.signIn('builder');
    const commands = (base: string) => ({ base, commands: [
      { type: 'set_title', title: 'Made by commands' },
      { type: 'place_object', ref: 'coin', objectId: 'coin_gold', tileX: 3, tileY: 3 },
    ] });
    const saved = await api.call(`${room(1, 0)}/draft/commands`, { session: builder, body: commands('blank') });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ claimerUserId: 'builder', published: null, draft: { title: 'Made by commands' } });
    expect(saved.body.draft.placedObjects.map((placed: { instanceId: string }) => placed.instanceId)).toEqual([saved.body.commandRefs.coin]);

    expect((await api.call(`${room(1, 0)}/draft/commands`, { session: builder, body: commands('published') })).status).toBe(409);
    expect((await api.call(`${room(1, 0)}/draft/commands`, { session: await api.signIn('p1'), body: commands('current_draft') })).status).toBe(403);
    expect((await api.call(`${room(1, 0)}/draft/commands`, { body: commands('blank') })).status).toBe(401);
    expect((await api.call(`${room(1, 0)}/draft/commands`, { session: builder, body: { base: 'blank', commands: [{ type: 'teleport' }] } })).status).toBe(400);
  });

  it('lets the claimer choose which version the leaderboard uses', async () => {
    const builder = await api.signIn('builder');
    tick();
    await publishRoomSnapshot(api, builder, roomSnapshot(0, 0, { title: 'Second' }));
    const pinned = await api.call(`${room(0, 0)}/canonical`, { session: builder, body: { targetVersion: 1 } });
    expect(pinned.status).toBe(200);
    expect(pinned.body).toMatchObject({ canonicalVersion: 1, published: { version: 2 } });
    expect((await api.call(`${room(0, 0)}/canonical`, { session: await api.signIn('p1'), body: { targetVersion: 2 } })).status).toBe(403);
    expect((await api.call(`${room(0, 0)}/canonical`, { session: builder, body: { targetVersion: 7 } })).status).toBe(404);
    expect((await api.call(room(0, 0))).body.canonicalVersion).toBe(1);
  });
});

describe('publish limits', () => {
  it('refuses a goal that cannot be finished, and creates no version', async () => {
    const builder = await api.signIn('builder');
    await saveRoomDraft(api, builder, roomSnapshot(1, 0));
    const refused = await publishRoomSnapshot(api, builder, roomSnapshot(1, 0, { goal: { type: 'reach_exit', exit: null, timeLimitMs: null } }));
    expect(refused.status).toBe(409);
    expect((await api.call(room(1, 0), { session: builder })).body).toMatchObject({ published: null, versions: [] });
  });

  it('only lets a new room be claimed next to a published one', async () => {
    const builder = await api.signIn('builder');
    for (const write of [saveRoomDraft, publishRoomSnapshot]) {
      const far = await write(api, builder, roomSnapshot(5, 5));
      expect(far.status).toBe(409);
      expect(far.body.error).toMatch(/adjacent to an existing published room/);
    }
    // A claimed draft is not a published neighbour.
    await saveRoomDraft(api, builder, roomSnapshot(1, 0));
    expect((await saveRoomDraft(api, builder, roomSnapshot(2, 0))).status).toBe(409);
  });

  it('enforces the daily claim limit and the daily publish limit for new rooms only', async () => {
    const builder = await api.signIn('builder');
    await api.setBuilderCaps('builder', { claimLimitPerDay: 1 });
    expect((await saveRoomDraft(api, builder, roomSnapshot(1, 0))).status).toBe(200);
    const secondClaim = await saveRoomDraft(api, builder, roomSnapshot(-1, 0));
    expect(secondClaim.status).toBe(429);
    expect(secondClaim.body.error).toMatch(/Daily room claim limit/);

    // Room 0,0's first version was published today (the fixture's day), so a limit of 1 is used up.
    await api.setBuilderCaps('builder', { publishLimitPerDay: 1 });
    const newRoom = await publishRoomSnapshot(api, builder, roomSnapshot(1, 0));
    expect(newRoom.status).toBe(429);
    expect(newRoom.body.error).toMatch(/Daily publish limit/);
    // Republishing a room the builder already published is not limited.
    tick();
    expect((await publishRoomSnapshot(api, builder, roomSnapshot(0, 0, { title: 'Update' }))).status).toBe(200);
  });

  it("enforces the builder's object cap on publish, but lets an existing room keep what it has", async () => {
    const builder = await api.signIn('builder');
    const coins = (count: number) => Array.from({ length: count }, (_, index) => ({
      id: 'coin_gold', instanceId: `coin-${index}`, x: 100 + index * 32, y: 200, layer: 'terrain' as const,
    }));
    tick();
    expect((await publishRoomSnapshot(api, builder, roomSnapshot(0, 0, { placedObjects: coins(3) }))).status).toBe(200);
    await api.setBuilderCaps('builder', { objectLimit: 2 });
    tick();
    const over = await publishRoomSnapshot(api, builder, roomSnapshot(0, 0, { placedObjects: coins(4) }));
    expect(over.status).toBe(429);
    expect(over.body.error).toMatch(/Builder cap reached/);
    tick();
    expect((await publishRoomSnapshot(api, builder, roomSnapshot(0, 0, { placedObjects: coins(3), title: 'Same coins' }))).status).toBe(200);
  });
});

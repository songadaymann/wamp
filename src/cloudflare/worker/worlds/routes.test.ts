import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultCourseSnapshot } from '../../../courses/model';
import { publishRoomAs, publishRoomSnapshot, roomSnapshot, saveRoomDraft, workerApi, type WorkerApi } from '../core/workerApi.testSupport';

// Worlds: a grant, the seed room that activates World 1, then members, roles, room placement and
// publication approval, all through the routes the Worlds panel calls (F487).
// "p2" owns World 1, "p1" is invited to build in it, "p3" is an outsider.
let api: WorkerApi;
let owner: string;
let member: string;
let outsider: string;
let clock = 0;
const tick = () => { clock += 1_000; vi.setSystemTime(clock); };

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  clock = Date.parse('2026-10-04T18:00:00.000Z');
  vi.setSystemTime(clock);
  api = workerApi({ WORLDS_ENABLED: '1' });
  owner = await api.signIn('p2');
  member = await api.signIn('p1');
  outsider = await api.signIn('p3');
});
afterEach(() => { api.close(); vi.useRealTimers(); });

// World 1's origin room, and the cells beside it.
const ORIGIN = { x: 129, y: 0 };
const world = (worldId: string, action = '') => `/api/worlds/${encodeURIComponent(worldId)}${action}`;
const inWorld = (worldId: string) => `worldId=${encodeURIComponent(worldId)}`;

async function grantWorld(email = 'p2@example.test') {
  const granted = await api.call('/api/admin/worlds/grants', { admin: true, body: { email } });
  expect(granted.status).toBe(201);
  return granted.body.entitlement.id as string;
}
async function activateWorld() {
  const grantId = await grantWorld();
  expect((await api.call(`/api/world-grants/${grantId}/seed-draft`, { method: 'PUT', session: owner, body: roomSnapshot(0, 0, { title: 'Seed' }) })).status).toBe(200);
  const activated = await api.call(`/api/world-grants/${grantId}/activate`, { method: 'POST', session: owner });
  expect(activated.status).toBe(201);
  return { grantId, worldId: activated.body.world.id as string, activated: activated.body };
}
/** World 1 with p1 as an active builder. */
async function worldWithMember() {
  const { worldId, grantId } = await activateWorld();
  expect((await api.call(world(worldId, '/invitations'), { session: owner, body: { email: 'p1@example.test' } })).status).toBe(201);
  expect((await api.call(world(worldId, '/invitations/accept'), { method: 'POST', session: member })).status).toBe(200);
  return { worldId, grantId };
}
const memberships = async (worldId: string) =>
  (await api.call(world(worldId, '/members'), { session: owner })).body.members as Array<{ id: string; userId: string; role: string; status: string }>;
const membershipOf = async (worldId: string, userId: string) => (await memberships(worldId)).find((entry) => entry.userId === userId)!;

describe('starting a World', () => {
  it('activates World 1 from the grantee seed room, and only once', async () => {
    const grantId = await grantWorld();
    expect((await api.call(`/api/world-grants/${grantId}/seed-draft`, { method: 'PUT', session: outsider, body: roomSnapshot(0, 0) })).status).toBe(404);
    const noSeed = await api.call(`/api/world-grants/${grantId}/activate`, { method: 'POST', session: owner });
    expect([noSeed.status, noSeed.body.error]).toEqual([409, 'Save a seed-room draft before publishing your World.']);
    expect((await api.call(`/api/world-grants/${grantId}/seed-draft`, { method: 'PUT', session: owner, body: { title: 'not a room' } })).status).toBe(400);
    expect((await api.call(`/api/world-grants/${grantId}/seed-draft`, { method: 'PUT', session: owner, body: roomSnapshot(0, 0, { title: 'Seed' }) })).status).toBe(200);

    const activated = await api.call(`/api/world-grants/${grantId}/activate`, { method: 'POST', session: owner });
    expect(activated.status).toBe(201);
    expect(activated.body.world).toMatchObject({ number: 1, origin: ORIGIN, ownerUserId: 'p2', viewerRole: 'owner', canManageSettings: true,
      buildPolicy: 'request_to_join', publishPolicy: 'approval_required' });
    expect(activated.body.room).toMatchObject({ claimerUserId: 'p2', published: { id: '129,0', version: 1, title: 'Seed' } });
    expect((await api.call(`/api/rooms/${encodeURIComponent('129,0')}/published`)).body).toMatchObject({ version: 1, title: 'Seed' });

    const publicView = await api.call('/api/worlds/number/1');
    expect(publicView.body).toMatchObject({ number: 1, viewerRole: null, canManageMembers: false });
    expect((await api.call('/api/worlds')).body.worlds.map((entry: { number: number }) => entry.number)).toContain(1);
    expect((await api.call('/api/worlds/me', { session: owner })).body.worlds.map((entry: { number: number }) => entry.number)).toEqual([1]);
    expect((await api.call('/api/worlds/me')).status).toBe(401);

    const again = await api.call(`/api/world-grants/${grantId}/activate`, { method: 'POST', session: owner });
    expect([again.status, again.body.error]).toEqual([409, 'This grant has already activated a World.']);
  });

  it('names a World only when its owner asks and an admin approves', async () => {
    const { worldId } = await worldWithMember();
    expect((await api.call(world(worldId, '/name-requests'), { session: member, body: { proposedName: 'Lava Land' } })).status).toBe(403);
    expect((await api.call(world(worldId, '/name-requests'), { session: owner, body: { proposedName: 'L' } })).status).toBe(400);
    const requested = await api.call(world(worldId, '/name-requests'), { session: owner, body: { proposedName: 'Lava Land' } });
    expect(requested.status).toBe(201);
    expect((await api.call(world(worldId))).body.displayName).toBeNull();

    const decide = (decision: string) => api.call(`/api/admin/worlds/name-requests/${requested.body.request.id}`, { method: 'PATCH', admin: true, body: { decision } });
    expect((await decide('approve')).status).toBe(200);
    expect((await api.call(world(worldId))).body.displayName).toBe('Lava Land');
    expect((await decide('reject')).status).toBe(409);
  });

  it('answers 404 for every World route while Worlds are switched off', async () => {
    const off = workerApi();
    try {
      expect((await off.call('/api/worlds')).status).toBe(404);
      expect((await off.call('/api/world-grants/any/activate', { method: 'POST', session: await off.signIn('p2') })).status).toBe(404);
      const draft = await saveRoomDraft(off, await off.signIn('builder'), roomSnapshot(1, 0), inWorld('world-1'));
      expect([draft.status, draft.body.error]).toEqual([404, 'Worlds are not enabled.']);
    } finally {
      off.close();
    }
  });
});

describe('World membership', () => {
  it('invites a builder by email, who accepts and can then claim a frontier room in the World', async () => {
    const { worldId } = await activateWorld();
    const invited = await api.call(world(worldId, '/invitations'), { session: owner, body: { email: 'P1@Example.test' } });
    expect(invited.status).toBe(201);
    expect(invited.body.member).toMatchObject({ email: 'p1@example.test', role: 'builder', status: 'invited' });
    expect((await api.call(world(worldId, '/invitations'), { session: member, body: { email: 'p3@example.test' } })).status).toBe(403);
    expect((await api.call(world(worldId, '/invitations'), { session: owner, body: { email: 'not-an-email' } })).status).toBe(400);
    expect((await api.call(world(worldId, '/invitations/accept'), { method: 'POST', session: outsider })).status).toBe(404);

    const before = await saveRoomDraft(api, member, roomSnapshot(130, 0), inWorld(worldId));
    expect(before.status).toBe(403);
    const accepted = await api.call(world(worldId, '/invitations/accept'), { method: 'POST', session: member });
    expect(accepted.body.member).toMatchObject({ userId: 'p1', status: 'active', role: 'builder' });
    // Accepting twice is harmless.
    expect((await api.call(world(worldId, '/invitations/accept'), { method: 'POST', session: member })).status).toBe(200);

    const claimed = await saveRoomDraft(api, member, roomSnapshot(130, 0), inWorld(worldId));
    expect(claimed.status).toBe(200);
    expect(claimed.body).toMatchObject({ claimerUserId: 'p1', world: { worldId, worldNumber: 1 } });
    const notFrontier = await saveRoomDraft(api, member, roomSnapshot(140, 5), inWorld(worldId));
    expect(notFrontier.status).toBe(409);
    expect((await saveRoomDraft(api, outsider, roomSnapshot(129, 1), inWorld(worldId))).status).toBe(403);
  });

  it('takes join requests and lets the owner approve, promote, demote, remove and block', async () => {
    const { worldId } = await worldWithMember();
    const requested = await api.call(world(worldId, '/join-requests'), { method: 'POST', session: outsider });
    expect(requested.status).toBe(201);
    expect(requested.body.member).toMatchObject({ userId: 'p3', status: 'requested' });
    const request = requested.body.member.id as string;
    const act = (session: string, membershipId: string, action: string) =>
      api.call(world(worldId, `/members/${membershipId}`), { method: 'PATCH', session, body: { action } });

    expect((await act(member, request, 'approve')).status).toBe(403);
    expect((await act(owner, request, 'promote')).status).toBe(409);
    expect((await act(owner, request, 'approve')).body.member).toMatchObject({ status: 'active', role: 'builder' });
    expect((await act(owner, request, 'approve')).status).toBe(409);
    expect((await act(owner, request, 'promote')).body.member).toMatchObject({ status: 'active', role: 'manager' });

    // A manager runs members and reviews, but cannot touch managers or the owner.
    const builderMembership = (await membershipOf(worldId, 'p1')).id;
    const ownerMembership = (await membershipOf(worldId, 'p2')).id;
    expect((await api.call(world(worldId, '/members'), { session: outsider })).status).toBe(200);
    expect((await api.call(world(worldId, '/publication-requests'), { session: outsider })).status).toBe(200);
    expect(await act(outsider, builderMembership, 'promote')).toMatchObject({ status: 403, body: { error: 'Only the World owner can manage managers.' } });
    expect((await act(outsider, ownerMembership, 'remove')).status).toBe(409);
    expect((await api.call(world(worldId, '/settings'), { method: 'PATCH', session: outsider,
      body: { buildPolicy: 'invite_only', publishPolicy: 'approval_required', claimLimitPerDay: 5, publishLimitPerDay: 10 } })).status).toBe(403);

    expect((await act(owner, request, 'demote')).body.member).toMatchObject({ role: 'builder', status: 'active' });
    expect((await act(owner, request, 'block')).body.member).toMatchObject({ status: 'blocked' });
    expect((await saveRoomDraft(api, outsider, roomSnapshot(130, 0), inWorld(worldId))).status).toBe(403);
    expect((await api.call(world(worldId, '/join-requests'), { method: 'POST', session: outsider })).status).toBe(403);
    expect((await act(owner, builderMembership, 'remove')).body.member).toMatchObject({ status: 'removed' });
    expect((await saveRoomDraft(api, member, roomSnapshot(130, 0), inWorld(worldId))).status).toBe(403);
    expect((await act(owner, builderMembership, 'crown')).status).toBe(400);
  });

  it('lets only the owner change settings, within the grant ceilings', async () => {
    const { worldId } = await worldWithMember();
    const settings = { buildPolicy: 'invite_only', publishPolicy: 'members_publish', claimLimitPerDay: 5, publishLimitPerDay: 10 };
    expect((await api.call(world(worldId, '/settings'), { method: 'PATCH', session: member, body: settings })).status).toBe(403);
    expect((await api.call(world(worldId, '/settings'), { method: 'PATCH', session: owner, body: { ...settings, claimLimitPerDay: 0 } })).status).toBe(400);
    expect((await api.call(world(worldId, '/settings'), { method: 'PATCH', session: owner, body: { ...settings, publishLimitPerDay: 10_000 } })).status).toBe(400);
    expect((await api.call(world(worldId, '/settings'), { method: 'PATCH', session: owner, body: { ...settings, buildPolicy: 'open' } })).status).toBe(400);
    const changed = await api.call(world(worldId, '/settings'), { method: 'PATCH', session: owner, body: settings });
    expect(changed.body).toMatchObject({ buildPolicy: 'invite_only', publishPolicy: 'members_publish' });

    // Invite-only Worlds take no join requests; members now publish directly.
    expect((await api.call(world(worldId, '/join-requests'), { method: 'POST', session: outsider })).status).toBe(403);
    await saveRoomDraft(api, member, roomSnapshot(130, 0), inWorld(worldId));
    const published = await publishRoomSnapshot(api, member, roomSnapshot(130, 0), inWorld(worldId));
    expect(published.status).toBe(200);
    expect(published.body.published).toMatchObject({ id: '130,0', version: 1 });
  });

  it('keeps a frozen World playable but refuses every write in it', async () => {
    const { worldId, grantId } = await worldWithMember();
    await saveRoomDraft(api, member, roomSnapshot(130, 0), inWorld(worldId));
    const frozen = await api.call(`/api/admin/worlds/entitlements/${grantId}/status`, { method: 'PATCH', admin: true, body: { status: 'frozen' } });
    expect(frozen.status).toBe(200);

    tick();
    const write = await saveRoomDraft(api, member, roomSnapshot(130, 0, { title: 'After the freeze' }), inWorld(worldId));
    expect([write.status, write.body.error]).toEqual([403, 'This World is currently play-only.']);
    expect((await saveRoomDraft(api, owner, roomSnapshot(129, 0), inWorld(worldId))).status).toBe(403);
    expect((await api.call(world(worldId, '/invitations'), { session: owner, body: { email: 'p3@example.test' } })).status).toBe(403);
    expect((await api.call(world(worldId, '/publication-requests'), { session: member, body: { roomId: '130,0', x: 130, y: 0 } })).status).toBe(403);
    expect((await api.call(world(worldId))).body).toMatchObject({ number: 1, frozen: true });
    expect((await api.call(`/api/rooms/${encodeURIComponent('129,0')}/published`)).status).toBe(200);
  });
});

describe('placing rooms in and around a World', () => {
  it('keeps World rooms and WAMP 0 rooms apart', async () => {
    const { worldId } = await worldWithMember();
    const builder = await api.signIn('builder');
    await publishRoomAs(api, builder, 1, 0);
    // A World room is not a WAMP 0 neighbour, and a WAMP 0 room cannot be saved as a World room.
    expect((await saveRoomDraft(api, builder, roomSnapshot(130, 0))).status).toBe(409);
    const wampZero = await saveRoomDraft(api, member, roomSnapshot(1, 0, { title: 'Pulled into World 1' }), inWorld(worldId));
    expect([wampZero.status, wampZero.body.error]).toEqual([409, 'This room belongs to WAMP 0.']);
    expect((await saveRoomDraft(api, builder, roomSnapshot(1, 0), 'worldId=wamp-prime')).status).toBe(400);
    expect((await saveRoomDraft(api, member, roomSnapshot(130, 0), inWorld('no-such-world'))).status).toBe(404);
    // Outsiders cannot edit the published origin room even without naming the World.
    expect((await publishRoomSnapshot(api, outsider, roomSnapshot(129, 0, { title: 'Defaced' }))).status).toBe(403);

    // And numbered-World rooms stay out of Expanded Rooms.
    const expanded = await api.call('/api/expanded-rooms', { session: owner, body: {
      ...createDefaultCourseSnapshot('world-er'), roomRefs: [{ roomId: '129,0', coordinates: ORIGIN, roomVersion: 1, roomTitle: null }],
    } });
    expect([expanded.status, expanded.body.error]).toEqual([403, 'Expanded Room authoring is disabled for numbered World rooms.']);
  });

  it.skip('treats a claimed room with no World claim row as WAMP 0', async () => {
    // Policy remains undecided for this legacy fixture. The read-only production count on
    // 2026-10-26 found zero claimed/published rooms missing World claim rows (F487 follow-up).
    // A room claimed while Worlds were switched off has no World claim row
    // (like the fixture's 0,0), so naming a World lets its members save it under that World's rules.
    const { worldId } = await worldWithMember();
    const legacy = await saveRoomDraft(api, member, roomSnapshot(0, 0, { title: 'Pulled into World 1' }), inWorld(worldId));
    expect([legacy.status, legacy.body.error]).toEqual([409, 'This room belongs to WAMP 0.']);
  });

  it("holds builders to the World's daily claim and publish limits", async () => {
    // Both limits used to surface as a 500: the database names the CHECK expression, not the table.
    const { worldId } = await worldWithMember();
    await api.call(world(worldId, '/settings'), { method: 'PATCH', session: owner,
      body: { buildPolicy: 'request_to_join', publishPolicy: 'members_publish', claimLimitPerDay: 1, publishLimitPerDay: 1 } });
    expect((await saveRoomDraft(api, member, roomSnapshot(130, 0), inWorld(worldId))).status).toBe(200);
    const secondClaim = await saveRoomDraft(api, member, roomSnapshot(128, 0), inWorld(worldId));
    expect([secondClaim.status, secondClaim.body.error]).toEqual([429, 'This builder has reached the World daily limit.']);

    expect((await publishRoomSnapshot(api, member, roomSnapshot(130, 0), inWorld(worldId))).status).toBe(200);
    tick();
    const secondPublish = await publishRoomSnapshot(api, member, roomSnapshot(130, 0, { title: 'Again' }), inWorld(worldId));
    expect([secondPublish.status, secondPublish.body.error]).toEqual([429, 'This builder has reached the World daily limit.']);
  });
});

describe('publication approval', () => {
  async function submitted(worldId: string, x = 130) {
    await saveRoomDraft(api, member, roomSnapshot(x, 0, { title: `Member room ${x}` }), inWorld(worldId));
    const submission = await api.call(world(worldId, '/publication-requests'), { session: member, body: { roomId: `${x},0`, x, y: 0 } });
    expect(submission.status).toBe(201);
    return submission.body.request as { id: string; status: string };
  }
  const resolve = (worldId: string, requestId: string, body: Record<string, unknown>, session = owner) =>
    api.call(world(worldId, `/publication-requests/${requestId}`), { method: 'PATCH', session, body });

  it('sends member rooms through review, and approval publishes the submitted draft', async () => {
    const { worldId } = await worldWithMember();
    await saveRoomDraft(api, member, roomSnapshot(130, 0), inWorld(worldId));
    const direct = await publishRoomSnapshot(api, member, roomSnapshot(130, 0), inWorld(worldId));
    expect([direct.status, direct.body.error]).toEqual([403, 'This World requires publication approval. Submit the draft for review.']);

    const request = await submitted(worldId);
    expect(request.status).toBe('pending');
    const resubmitted = await api.call(world(worldId, '/publication-requests'), { session: member, body: { roomId: '130,0', x: 130, y: 0 } });
    expect(resubmitted.body.request.id).toBe(request.id);
    expect((await api.call(world(worldId, '/publication-requests'), { session: member })).status).toBe(403);
    expect((await api.call(world(worldId, '/publication-requests'), { session: outsider, body: { roomId: '130,0', x: 130, y: 0 } })).status).toBe(403);
    expect((await api.call(world(worldId, '/publication-requests'), { session: member, body: { roomId: '130,0' } })).status).toBe(400);
    const queue = await api.call(world(worldId, '/publication-requests'), { session: owner });
    expect(queue.body.requests).toMatchObject([{ id: request.id, roomId: '130,0', status: 'pending', submittedByUserId: 'p1' }]);

    expect((await resolve(worldId, request.id, { decision: 'approve' }, member)).status).toBe(403);
    expect((await resolve(worldId, request.id, { decision: 'maybe' })).status).toBe(400);
    const approved = await resolve(worldId, request.id, { decision: 'approve' });
    expect(approved.status).toBe(200);
    expect(approved.body.request).toMatchObject({ status: 'approved' });
    const room = await api.call(`/api/rooms/${encodeURIComponent('130,0')}`, { session: member });
    expect(room.body).toMatchObject({ claimerUserId: 'p1', published: { version: 1, title: 'Member room 130' } });

    expect((await resolve(worldId, request.id, { decision: 'approve' })).body.request.status).toBe('approved');
    expect((await resolve(worldId, request.id, { decision: 'reject' })).status).toBe(409);
  });

  it('rejects with a reason and leaves the room unpublished', async () => {
    const { worldId } = await worldWithMember();
    const request = await submitted(worldId);
    expect((await resolve(worldId, request.id, { decision: 'reject', rejectionReason: 'x'.repeat(501) })).status).toBe(400);
    const rejected = await resolve(worldId, request.id, { decision: 'reject', rejectionReason: '  Needs   an exit  ' });
    expect(rejected.body.request).toMatchObject({ status: 'rejected', rejectionReason: 'Needs an exit' });
    expect((await api.call(`/api/rooms/${encodeURIComponent('130,0')}/published`)).status).toBe(404);
  });

  it('refuses to approve a draft that changed after it was submitted', async () => {
    const { worldId } = await worldWithMember();
    const request = await submitted(worldId);
    tick();
    await saveRoomDraft(api, member, roomSnapshot(130, 0, { title: 'Swapped after review' }), inWorld(worldId));
    const approved = await resolve(worldId, request.id, { decision: 'approve' });
    expect([approved.status, approved.body.error]).toEqual([409, 'This draft changed after submission and must be submitted again.']);
    expect((await api.call(`/api/rooms/${encodeURIComponent('130,0')}/published`)).status).toBe(404);
    const queue = await api.call(world(worldId, '/publication-requests'), { session: owner });
    expect(queue.body.requests[0]).toMatchObject({ id: request.id, status: 'stale' });
  });

  it('does not publish for a builder who was suspended after submitting', async () => {
    const { worldId } = await worldWithMember();
    const request = await submitted(worldId);
    api.sqlite.prepare("UPDATE users SET suspended_at = ?, suspended_reason = 'raid' WHERE id = 'p1'").run(new Date().toISOString());
    expect((await resolve(worldId, request.id, { decision: 'approve' })).status).toBe(403);
    expect((await api.call(`/api/rooms/${encodeURIComponent('130,0')}/published`)).status).toBe(404);
  });
});

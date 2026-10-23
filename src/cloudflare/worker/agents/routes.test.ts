import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { roomSnapshot, saveRoomDraft, workerApi, type WorkerApi } from '../core/workerApi.testSupport';

// Bot agents, agent tokens and personal API tokens: create, list, revoke, and use them for room
// writes (F487). Token holders act for the owner's account, so every check here is about whose
// account a token writes as, and what it may still do once revoked or disabled.
let api: WorkerApi;
let builder: string;
let other: string;
beforeEach(async () => {
  api = workerApi();
  builder = await api.signIn('builder');
  other = await api.signIn('p1');
});
afterEach(() => api.close());

const draftAt = (x: number, y: number) => ({ method: 'PUT', body: roomSnapshot(x, y, { title: 'Bot room' }) });
const roomDraftPath = (x: number, y: number) => `/api/rooms/${encodeURIComponent(`${x},${y}`)}/draft`;

async function createAgent(displayName = 'Helper Bot', session = builder) {
  return api.call('/api/agents', { session, body: { displayName, description: 'Builds rooms' } });
}
async function createAgentToken(agentId: string, body: Record<string, unknown> = { label: 'ci' }, session = builder) {
  return api.call(`/api/agents/${agentId}/tokens`, { session, body });
}

describe('bot agents', () => {
  it('creates an agent and a token, and the token writes rooms as the agent on the owner account', async () => {
    const created = await createAgent();
    expect(created.status).toBe(201);
    expect(created.body.agent).toMatchObject({ ownerUserId: 'builder', displayName: 'Helper Bot', status: 'active' });
    const agentId = created.body.agent.id as string;
    expect((await api.call('/api/agents', { session: builder })).body.agents.map((agent: { id: string }) => agent.id)).toEqual([agentId]);
    expect((await api.call('/api/agents', { session: other })).body.agents).toEqual([]);

    const token = await createAgentToken(agentId);
    expect(token.status).toBe(201);
    expect(token.body.token).toMatch(/^epagt_/);
    expect(token.body.record).toMatchObject({ agentId, label: 'ci', scopes: ['rooms:read', 'rooms:write', 'leaderboards:read'], revokedAt: null });

    const session = await api.call('/api/auth/session', { bearer: token.body.token });
    expect(session.body).toMatchObject({
      authenticated: true, source: 'agent_token', user: { id: 'builder' },
      principal: { kind: 'agent', agentId, displayName: 'Helper Bot', ownerUserId: 'builder' },
    });

    const saved = await api.call(roomDraftPath(1, 0), { ...draftAt(1, 0), bearer: token.body.token, origin: null });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ claimerUserId: 'builder', claimerPrincipalKind: 'agent', claimerAgentId: agentId, claimerDisplayName: 'Helper Bot' });
    const published = await api.call(`/api/rooms/${encodeURIComponent('1,0')}/publish`, { body: roomSnapshot(1, 0), bearer: token.body.token, origin: null });
    expect(published.status).toBe(200);
    expect(published.body.versions[0]).toMatchObject({ publishedByUserId: 'builder', publishedByPrincipalKind: 'agent', publishedByAgentId: agentId });

    const listed = await api.call(`/api/agents/${agentId}/tokens`, { session: builder });
    expect(listed.body.tokens).toHaveLength(1);
    expect(listed.body.tokens[0]).toMatchObject({ id: token.body.record.id, label: 'ci' });
    expect(listed.body.tokens[0].lastUsedAt).not.toBeNull();
    expect(JSON.stringify(listed.body)).not.toContain(token.body.token);
  });

  it('stops a token the moment it is revoked, and every token when its agent is disabled', async () => {
    const agentId = (await createAgent()).body.agent.id as string;
    const first = (await createAgentToken(agentId, { label: 'first' })).body;
    const second = (await createAgentToken(agentId, { label: 'second' })).body;

    expect((await api.call(`/api/agents/${agentId}/tokens/${first.record.id}`, { method: 'DELETE', session: builder })).status).toBe(204);
    const revoked = await api.call(roomDraftPath(1, 0), { ...draftAt(1, 0), bearer: first.token });
    expect(revoked).toMatchObject({ status: 401, body: { error: 'API token is invalid or has been revoked.' } });
    expect((await api.call(`/api/agents/${agentId}/tokens`, { session: builder })).body.tokens.map((entry: { label: string }) => entry.label)).toEqual(['second']);
    expect((await api.call(roomDraftPath(1, 0), { ...draftAt(1, 0), bearer: second.token })).status).toBe(200);

    expect((await api.call(`/api/agents/${agentId}`, { method: 'DELETE', session: builder })).status).toBe(204);
    expect((await api.call(roomDraftPath(1, 0), { ...draftAt(1, 0), bearer: second.token })).status).toBe(401);
    expect((await api.call('/api/agents', { session: builder })).body.agents[0].status).toBe('disabled');
    const noNewTokens = await createAgentToken(agentId);
    expect([noNewTokens.status, noNewTokens.body.error]).toEqual([409, 'Disabled agents cannot receive new tokens.']);
  });

  it('keeps a token to the scopes it was given', async () => {
    const agentId = (await createAgent()).body.agent.id as string;
    const readOnly = (await createAgentToken(agentId, { label: 'reader', scopes: ['rooms:read'] })).body;
    expect(readOnly.record.scopes).toEqual(['rooms:read']);
    const write = await api.call(roomDraftPath(1, 0), { ...draftAt(1, 0), bearer: readOnly.token });
    expect([write.status, write.body.error]).toEqual([403, 'This token lacks the rooms:write scope required to save room drafts.']);
    expect((await api.call(`/api/rooms/${encodeURIComponent('0,0')}`, { bearer: readOnly.token })).status).toBe(200);
    expect((await api.call(`/api/rooms/${encodeURIComponent('0,0')}/published`, { bearer: readOnly.token })).status).toBe(200);

    expect((await createAgentToken(agentId, { label: 'runs', scopes: ['runs:write'] })).status).toBe(400);
    expect((await createAgentToken(agentId, { label: 'none', scopes: [] })).status).toBe(400);
    expect((await createAgentToken(agentId, { label: 'bad', scopes: ['admin'] })).status).toBe(400);
  });

  it("does not let anyone else see, use or manage an owner's agent", async () => {
    const agentId = (await createAgent()).body.agent.id as string;
    const token = (await createAgentToken(agentId)).body;
    const othersAgent = (await createAgent('Other Bot', other)).body.agent.id as string;

    expect((await api.call(`/api/agents/${agentId}/tokens`, { session: other })).status).toBe(404);
    expect((await createAgentToken(agentId, { label: 'stolen' }, other)).status).toBe(404);
    expect((await api.call(`/api/agents/${agentId}/tokens/${token.record.id}`, { method: 'DELETE', session: other })).status).toBe(404);
    // The token id under the other builder's own agent is still not theirs.
    expect((await api.call(`/api/agents/${othersAgent}/tokens/${token.record.id}`, { method: 'DELETE', session: other })).status).toBe(404);
    expect((await api.call(`/api/agents/${agentId}`, { method: 'DELETE', session: other })).status).toBe(404);
    expect((await api.call(roomDraftPath(1, 0), { ...draftAt(1, 0), bearer: token.token })).status).toBe(200);
  });

  it('manages agents only from a signed-in browser session', async () => {
    const agentId = (await createAgent()).body.agent.id as string;
    const token = (await createAgentToken(agentId)).body.token as string;
    expect((await api.call('/api/agents')).status).toBe(401);
    expect((await api.call('/api/agents', { body: { displayName: 'Anon Bot' } })).status).toBe(401);
    expect((await api.call('/api/agents', { bearer: token })).status).toBe(401);
    expect((await createAgentToken(agentId, { label: 'self-minted' }, '')).status).toBe(401);
    expect((await api.call(`/api/agents/${agentId}/tokens`, { body: { label: 'bot-made' }, bearer: token })).status).toBe(401);
    expect((await api.call('/api/agents', { session: builder, body: { displayName: 'Foreign Bot' }, origin: 'https://evil.example' })).status).toBe(403);
  });

  it('validates agent names and token labels', async () => {
    expect((await createAgent('   ')).status).toBe(400);
    expect((await createAgent('x'.repeat(25))).status).toBe(400);
    expect((await createAgent('p1')).status).toBe(409);
    expect((await createAgent('Helper Bot')).status).toBe(201);
    expect((await createAgent('helper   bot')).status).toBe(409);
    const agentId = (await api.call('/api/agents', { session: builder })).body.agents[0].id as string;
    expect((await createAgentToken(agentId, { label: '' })).status).toBe(400);
    expect((await createAgentToken(agentId, { label: 'x'.repeat(65) })).status).toBe(400);
  });

  it('lets a suspended owner revoke tokens and disable agents, but not create them or write through them', async () => {
    const agentId = (await createAgent()).body.agent.id as string;
    const keep = (await createAgentToken(agentId, { label: 'keep' })).body;
    const drop = (await createAgentToken(agentId, { label: 'drop' })).body;
    api.sqlite.prepare("UPDATE users SET suspended_at = ?, suspended_reason = 'raid' WHERE id = 'builder'").run(new Date().toISOString());

    expect((await createAgent('Second Bot')).status).toBe(403);
    expect((await createAgentToken(agentId, { label: 'more' })).status).toBe(403);
    const write = await api.call(roomDraftPath(1, 0), { ...draftAt(1, 0), bearer: keep.token });
    expect([write.status, write.body.error]).toEqual([403, expect.stringMatching(/suspended/)]);
    expect((await api.call(`/api/agents/${agentId}/tokens/${drop.record.id}`, { method: 'DELETE', session: builder })).status).toBe(204);
    expect((await api.call(`/api/agents/${agentId}`, { method: 'DELETE', session: builder })).status).toBe(204);
  });

  it('keeps school-managed student accounts from creating agents or API tokens', async () => {
    api.sqlite.exec(`
      INSERT INTO school_classrooms (id, slug, display_name, teacher_email, created_at, updated_at)
        VALUES ('class-1', 'class-1', 'Class 1', 'teacher@example.test', '2026-10-01', '2026-10-01');
      INSERT INTO school_students (id, classroom_id, user_id, username, password_hash, password_reset_required, password_updated_at, created_at, updated_at)
        VALUES ('student-1', 'class-1', 'p3', 'p3', 'unused', 0, '2026-10-01', '2026-10-01', '2026-10-01');`);
    const student = await api.signIn('p3');
    expect(await createAgent('Student Bot', student)).toMatchObject({ status: 403, body: { error: 'School-managed student accounts cannot create agents.' } });
    expect(await api.call('/api/auth/tokens', { session: student, body: { label: 'mine', scopes: ['rooms:read'] } }))
      .toMatchObject({ status: 403, body: { error: 'School-managed student accounts cannot create API tokens.' } });
    // Students still build rooms themselves.
    expect((await saveRoomDraft(api, student, roomSnapshot(1, 0))).status).toBe(200);
  });
});

describe('personal API tokens', () => {
  async function createApiToken(scopes: unknown, session = builder, label = 'script') {
    return api.call('/api/auth/tokens', { session, body: { label, scopes } });
  }

  it('creates, lists, uses and revokes a token that writes as the user', async () => {
    const created = await createApiToken(['rooms:write', 'rooms:read']);
    expect(created.status).toBe(201);
    expect(created.body.token).toMatch(/^epat_/);
    expect(created.body.record).toMatchObject({ label: 'script', scopes: ['rooms:read', 'rooms:write'], revokedAt: null });

    const saved = await api.call(roomDraftPath(1, 0), { ...draftAt(1, 0), bearer: created.body.token, origin: null });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ claimerUserId: 'builder', claimerPrincipalKind: 'user', claimerAgentId: null });

    const listed = await api.call('/api/auth/tokens', { session: builder });
    expect(listed.body.tokens.map((entry: { id: string }) => entry.id)).toEqual([created.body.record.id]);
    expect(listed.body.tokens[0].lastUsedAt).not.toBeNull();
    expect(JSON.stringify(listed.body)).not.toContain(created.body.token);
    expect((await api.call('/api/auth/tokens', { session: other })).body.tokens).toEqual([]);

    expect((await api.call(`/api/auth/tokens/${created.body.record.id}`, { method: 'DELETE', session: other })).status).toBe(404);
    expect((await api.call(roomDraftPath(1, 0), { ...draftAt(1, 0), bearer: created.body.token })).status).toBe(200);
    expect((await api.call(`/api/auth/tokens/${created.body.record.id}`, { method: 'DELETE', session: builder })).status).toBe(204);
    expect((await api.call(roomDraftPath(1, 0), { ...draftAt(1, 0), bearer: created.body.token })).status).toBe(401);
  });

  it('checks scopes, and is managed from a browser session only', async () => {
    const runsOnly = (await createApiToken(['runs:write'])).body.token as string;
    expect((await api.call(roomDraftPath(1, 0), { ...draftAt(1, 0), bearer: runsOnly })).status).toBe(403);
    expect((await api.call(`/api/rooms/${encodeURIComponent('0,0')}`, { bearer: runsOnly })).status).toBe(403);
    expect((await createApiToken(undefined)).status).toBe(400);
    expect((await createApiToken([])).status).toBe(400);
    expect((await createApiToken(['rooms:admin'])).status).toBe(400);
    expect((await createApiToken(['rooms:read'], builder, '')).status).toBe(400);
    expect((await api.call('/api/auth/tokens', { bearer: runsOnly })).status).toBe(401);
    expect((await api.call('/api/auth/tokens', { bearer: runsOnly, body: { label: 'more', scopes: ['rooms:write'] } })).status).toBe(401);
    expect((await api.call(roomDraftPath(1, 0), { ...draftAt(1, 0), bearer: 'epat_not-a-real-token' })).status).toBe(401);
  });
});

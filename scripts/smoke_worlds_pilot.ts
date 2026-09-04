import { createDefaultRoomSnapshot, roomIdFromCoordinates } from '../src/persistence/roomModel';

const apiBase = (process.argv[2] || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const adminKey = process.env.WORLDS_SMOKE_ADMIN_KEY?.trim();

if (!adminKey) {
  throw new Error('Set WORLDS_SMOKE_ADMIN_KEY to the local Worker ADMIN_API_KEY.');
}

interface JsonResult<T> {
  response: Response;
  json: T;
}

interface SessionClient {
  email: string;
  cookie: string;
  request<T>(path: string, init?: RequestInit): Promise<JsonResult<T>>;
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<JsonResult<T>> {
  const response = await fetch(`${apiBase}${path}`, init);
  const text = await response.text();
  let json: T;
  try {
    json = (text ? JSON.parse(text) : null) as T;
  } catch {
    throw new Error(`${init.method ?? 'GET'} ${path} returned non-JSON (${response.status}): ${text.slice(0, 300)}`);
  }
  return { response, json };
}

async function expectJson<T>(
  path: string,
  init: RequestInit,
  expectedStatus: number,
): Promise<JsonResult<T>> {
  const result = await requestJson<T>(path, init);
  if (result.response.status !== expectedStatus) {
    throw new Error(
      `${init.method ?? 'GET'} ${path} expected ${expectedStatus}, got ${result.response.status}: `
      + JSON.stringify(result.json),
    );
  }
  return result;
}

async function signIn(email: string): Promise<SessionClient> {
  const link = await expectJson<{ debugMagicLink?: string }>(
    '/api/auth/request-link',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, returnTo: `${apiBase}/` }),
    },
    200,
  );
  if (!link.json.debugMagicLink) {
    throw new Error('The local Worker must run with AUTH_DEBUG_MAGIC_LINKS=1.');
  }
  const verification = await fetch(link.json.debugMagicLink, { redirect: 'manual' });
  if (verification.status !== 302) {
    throw new Error(`Magic-link verification expected 302, got ${verification.status}.`);
  }
  const cookie = verification.headers.get('set-cookie')?.match(/^([^=]+=[^;]+)/)?.[1];
  if (!cookie) throw new Error(`No session cookie was returned for ${email}.`);

  return {
    email,
    cookie,
    request: async <T>(path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set('cookie', cookie);
      return requestJson<T>(path, { ...init, headers });
    },
  };
}

function jsonInit(method: string, body: unknown, extraHeaders: HeadersInit = {}): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json', ...Object.fromEntries(new Headers(extraHeaders)) },
    body: JSON.stringify(body),
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const ownerEmail = `worlds-owner-${suffix}@example.com`;
const managerEmail = `worlds-manager-${suffix}@example.com`;
const builderEmail = `worlds-builder-${suffix}@example.com`;
const adminHeaders = { 'x-admin-key': adminKey };

const grant = await expectJson<{
  entitlement: { id: string; ownerEmail: string };
}>(
  '/api/admin/worlds/grants',
  jsonInit('POST', { email: ownerEmail, idempotencyKey: `worlds-smoke-${suffix}` }, adminHeaders),
  201,
);
assert(grant.json.entitlement.ownerEmail === ownerEmail, 'The grant was assigned to the wrong email.');

const owner = await signIn(ownerEmail);
const seed = createDefaultRoomSnapshot('world-seed-draft', { x: 0, y: 0 });
seed.title = 'Worlds pilot seed';
const savedSeed = await owner.request<{ entitlement: { seedDraft: unknown } }>(
  `/api/world-grants/${encodeURIComponent(grant.json.entitlement.id)}/seed-draft`,
  jsonInit('PUT', seed),
);
assert(savedSeed.response.status === 200 && savedSeed.json.entitlement.seedDraft, 'The seed draft was not persisted.');

const activated = await owner.request<{
  world: { id: string; number: number; origin: { x: number; y: number }; sharePath: string };
  room: { published: { id: string } | null };
}>(
  `/api/world-grants/${encodeURIComponent(grant.json.entitlement.id)}/activate`,
  { method: 'POST' },
);
assert(activated.response.status === 201, `Activation failed: ${JSON.stringify(activated.json)}`);
const world = activated.json.world;
assert(world.number === 1, `Expected the fresh database to allocate WAMP 1, received WAMP ${world.number}.`);
assert(world.origin.x === 129 && world.origin.y === 0, 'WAMP 1 did not activate at (129,0).');
assert(world.sharePath === '/w/1', 'WAMP 1 did not receive its stable share path.');
assert(activated.json.room.published?.id === '129,0', 'The seed room was not published at the World origin.');

const manager = await signIn(managerEmail);
const managerRequest = await manager.request<{ member: { id: string; status: string } }>(
  `/api/worlds/${encodeURIComponent(world.id)}/join-requests`,
  { method: 'POST' },
);
assert(managerRequest.response.status === 201 && managerRequest.json.member.status === 'requested', 'Manager join request failed.');
const managerMembershipId = managerRequest.json.member.id;

const approvedManager = await owner.request<{ member: { status: string } }>(
  `/api/worlds/${encodeURIComponent(world.id)}/members/${encodeURIComponent(managerMembershipId)}`,
  jsonInit('PATCH', { action: 'approve' }),
);
assert(approvedManager.response.status === 200 && approvedManager.json.member.status === 'active', 'Owner could not approve manager.');
const promotedManager = await owner.request<{ member: { role: string } }>(
  `/api/worlds/${encodeURIComponent(world.id)}/members/${encodeURIComponent(managerMembershipId)}`,
  jsonInit('PATCH', { action: 'promote' }),
);
assert(promotedManager.response.status === 200 && promotedManager.json.member.role === 'manager', 'Owner could not promote manager.');

const builder = await signIn(builderEmail);
const builderRequest = await builder.request<{ member: { id: string; status: string } }>(
  `/api/worlds/${encodeURIComponent(world.id)}/join-requests`,
  { method: 'POST' },
);
assert(builderRequest.response.status === 201 && builderRequest.json.member.status === 'requested', 'Builder join request failed.');
const approvedBuilder = await manager.request<{ member: { status: string } }>(
  `/api/worlds/${encodeURIComponent(world.id)}/members/${encodeURIComponent(builderRequest.json.member.id)}`,
  jsonInit('PATCH', { action: 'approve' }),
);
assert(approvedBuilder.response.status === 200 && approvedBuilder.json.member.status === 'active', 'Manager could not approve builder.');

const adjacent = { x: world.origin.x + 1, y: world.origin.y };
const adjacentRoomId = roomIdFromCoordinates(adjacent);
const adjacentDraft = createDefaultRoomSnapshot(adjacentRoomId, adjacent);
adjacentDraft.title = 'Builder room awaiting approval';
const roomContext = `x=${adjacent.x}&y=${adjacent.y}&worldId=${encodeURIComponent(world.id)}`;
const savedRoom = await builder.request<{ world?: { worldId: string }; claimerUserId?: string }>(
  `/api/rooms/${encodeURIComponent(adjacentRoomId)}/draft?${roomContext}`,
  jsonInit('PUT', adjacentDraft),
);
assert(savedRoom.response.status === 200, `Builder could not claim the adjacent room: ${JSON.stringify(savedRoom.json)}`);
assert(savedRoom.json.world?.worldId === world.id, 'The adjacent room lost its World context.');

const publication = await builder.request<{ request: { id: string; status: string } }>(
  `/api/worlds/${encodeURIComponent(world.id)}/publication-requests`,
  jsonInit('POST', { roomId: adjacentRoomId, ...adjacent }),
);
assert(publication.response.status === 201 && publication.json.request.status === 'pending', 'Publication request failed.');

const approvedPublication = await manager.request<{ request: { status: string } }>(
  `/api/worlds/${encodeURIComponent(world.id)}/publication-requests/${encodeURIComponent(publication.json.request.id)}`,
  jsonInit('PATCH', { decision: 'approve' }),
);
assert(
  approvedPublication.response.status === 200 && approvedPublication.json.request.status === 'approved',
  `Manager publication approval failed: ${JSON.stringify(approvedPublication.json)}`,
);

const directory = await expectJson<{ worlds: Array<{ number: number; roomCount: number }> }>(
  '/api/worlds',
  {},
  200,
);
assert(directory.json.worlds.some((entry) => entry.number === 0), 'The directory omitted WAMP 0.');
assert(
  directory.json.worlds.some((entry) => entry.number === 1 && entry.roomCount === 2),
  'The directory did not report two rooms for WAMP 1.',
);

const frozen = await expectJson<{ ok: boolean }>(
  `/api/admin/worlds/entitlements/${encodeURIComponent(grant.json.entitlement.id)}/status`,
  jsonInit(
    'PATCH',
    { status: 'frozen', idempotencyKey: `worlds-smoke-freeze-${suffix}` },
    adminHeaders,
  ),
  200,
);
assert(frozen.json.ok, 'The admin freeze did not complete.');

for (const coordinates of [world.origin, adjacent]) {
  const roomId = roomIdFromCoordinates(coordinates);
  await expectJson(
    `/api/rooms/${encodeURIComponent(roomId)}/published?x=${coordinates.x}&y=${coordinates.y}`,
    {},
    200,
  );
}

const rejectedDraft = await builder.request<{ error?: string }>(
  `/api/rooms/${encodeURIComponent(adjacentRoomId)}/draft?${roomContext}`,
  jsonInit('PUT', adjacentDraft),
);
assert(rejectedDraft.response.status === 403, 'A frozen World accepted a draft mutation.');
const rejectedSettings = await owner.request<{ error?: string }>(
  `/api/worlds/${encodeURIComponent(world.id)}/settings`,
  jsonInit('PATCH', {
    buildPolicy: 'invite_only',
    publishPolicy: 'members_publish',
    claimLimitPerDay: 5,
    publishLimitPerDay: 10,
  }),
);
assert(rejectedSettings.response.status === 403, 'A frozen World accepted a settings mutation.');

const frozenWorld = await expectJson<{ frozen: boolean; roomCount: number }>(
  '/api/worlds/number/1',
  {},
  200,
);
assert(frozenWorld.json.frozen && frozenWorld.json.roomCount === 2, 'Frozen World discovery/play state was not retained.');

console.log(JSON.stringify({
  ok: true,
  world: { number: world.number, origin: world.origin, roomCount: frozenWorld.json.roomCount },
  governance: { managerApprovedBuilder: true, managerApprovedPublication: true },
  freeze: { publicRoomsPlayable: 2, draftRejected: true, settingsRejected: true },
}, null, 2));

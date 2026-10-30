import { afterEach, describe, expect, it } from 'vitest';
import type { AdminBuildingModerationResponse, AdminRevertEditsResponse } from '../../../admin/model';
import { fixture } from '../activity/testDatabase';
import { assertAccountNotSuspended } from '../moderation/suspension';
import { handleAdminBuildingModeration, handleAdminRevertUserEdits, handleAdminRoomVersionVisibility, handleAdminUserSuspension } from './buildingModeration';
import { handleRoomRequest } from '../rooms/routes';
import { loadRoomSnapshotsByReferences, loadRoomVersionPage, revertRoom, setCanonicalRoomVersion } from '../rooms/store';

const opened: ReturnType<typeof fixture>[] = [];
function setup() {
  const f = fixture();
  f.env.ADMIN_API_KEY = 'test-admin-key';
  opened.push(f);
  return f;
}
afterEach(() => { for (const f of opened.splice(0)) f.sqlite.close(); });

function adminRequest(path: string, body?: unknown, key = 'test-admin-key'): Request {
  return new Request(`https://api.wamp.land${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-admin-key': key, 'Content-Type': 'application/json', Origin: 'https://wamp.land' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function addRoom(f: ReturnType<typeof fixture>, x: number, claimer: string, versions: Array<[string, string]>): string {
  const roomId = `${x},0`;
  const snapshot = (title: string, version: number) => JSON.stringify({
    ...f.record.draft, id: roomId, coordinates: { x, y: 0 }, title, version, status: 'published',
    updatedAt: `2026-10-05T0${version - 1}:00:00.000Z`,
  });
  const last = versions.length;
  f.sqlite.prepare(`INSERT INTO rooms (id,x,y,draft_json,published_json,published_title,claimer_user_id)
    VALUES (?,?,0,?,?,?,?)`).run(roomId, x, snapshot(versions[last - 1][1], last), snapshot(versions[last - 1][1], last), versions[last - 1][1], claimer);
  versions.forEach(([by, title], index) => f.sqlite.prepare(`INSERT INTO room_versions
    (room_id,version,snapshot_json,title,created_at,published_by_user_id) VALUES (?,?,?,?,?,?)`)
    .run(roomId, index + 1, snapshot(title, index + 1), title, `2026-10-05T0${index}:00:00.000Z`, by));
  return roomId;
}

describe('building moderation', () => {
  it('requires the admin key', async () => {
    const f = setup();
    await expect(handleAdminBuildingModeration(adminRequest('/api/admin/users/p1/building', undefined, 'wrong'), f.env, 'p1'))
      .rejects.toMatchObject({ status: 403 });
  });

  it('suspends and restores an account with an audited reason', async () => {
    const f = setup();
    await expect(handleAdminUserSuspension(adminRequest('/x', { suspended: true }), f.env, 'p1'))
      .rejects.toMatchObject({ status: 400 });
    const suspended = await (await handleAdminUserSuspension(
      adminRequest('/x', { suspended: true, reason: 'Vandal raid', operatorLabel: 'jm' }), f.env, 'p1')).json() as AdminBuildingModerationResponse;
    expect(suspended.suspendedReason).toBe('Vandal raid');
    await expect(assertAccountNotSuspended(f.env, 'p1')).rejects.toMatchObject({ status: 403 });
    await expect(assertAccountNotSuspended(f.env, 'p2')).resolves.toBeUndefined();
    const lifted = await (await handleAdminUserSuspension(
      adminRequest('/x', { suspended: false, operatorLabel: 'jm' }), f.env, 'p1')).json() as AdminBuildingModerationResponse;
    expect(lifted.suspendedAt).toBeNull();
    expect(lifted.recentActions.map((entry) => entry.action)).toEqual(['unsuspend', 'suspend']);
    await expect(assertAccountNotSuspended(f.env, 'p1')).resolves.toBeUndefined();
    await expect(handleAdminUserSuspension(adminRequest('/x', { suspended: true, reason: 'x' }), f.env, 'missing'))
      .rejects.toMatchObject({ status: 404 });
  });

  it('previews, then restores only rooms where the user is still the latest publisher', async () => {
    const f = setup();
    const vandalised = addRoom(f, 1, 'p2', [['p2', 'Good'], ['p1', 'Defaced'], ['p1', 'Defaced again']]);
    const fixedSince = addRoom(f, 2, 'p2', [['p2', 'Good'], ['p1', 'Defaced'], ['p2', 'Fixed']]);
    const own = addRoom(f, 3, 'p1', [['p1', 'Mine'], ['p1', 'Mine 2']]);
    const repeat = addRoom(f, 4, 'p3', [['p1', 'Old p1'], ['p3', 'Good'], ['p1', 'Defaced']]);
    const since = '2026-10-05T00:30:00.000Z';
    const preview = await (await handleAdminRevertUserEdits(adminRequest('/x', { since }), f.env, 'p1'))
      .json() as AdminRevertEditsResponse;
    expect(Object.fromEntries(preview.rooms.map((room) => [room.roomId, [room.action, room.reason, room.targetVersion]]))).toEqual({
      [vandalised]: ['revert', null, 1],
      [fixedSince]: ['skip', 'changed_since', 1],
      [own]: ['skip', 'own_room', null],
      [repeat]: ['revert', null, 2],
    });
    expect(preview.reverted).toEqual([]);
    expect((f.sqlite.prepare('SELECT COUNT(*) AS n FROM room_versions').get() as { n: number }).n).toBe(12);

    const executed = await (await handleAdminRevertUserEdits(
      adminRequest('/x', { since, execute: true, reason: 'raid', operatorLabel: 'jm' }), f.env, 'p1')).json() as AdminRevertEditsResponse;
    expect(executed.reverted).toEqual([
      { roomId: vandalised, fromVersion: 3, toVersion: 1 },
      { roomId: repeat, fromVersion: 3, toVersion: 2 },
    ]);
    expect(executed.remaining).toBe(0);
    const restored = f.sqlite.prepare(`SELECT version, title, published_by_user_id, reverted_from_version
      FROM room_versions WHERE room_id = ? ORDER BY version DESC LIMIT 1`).get(vandalised);
    expect(restored).toMatchObject({ version: 4, title: 'Good', published_by_user_id: null, reverted_from_version: 1 });
    expect(f.sqlite.prepare('SELECT published_title FROM rooms WHERE id = ?').get(fixedSince)).toEqual({ published_title: 'Fixed' });
    const audit = f.sqlite.prepare("SELECT action, target_user_id, details_json FROM moderation_audit").all() as Array<{ details_json: string }>;
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0].details_json).reverted).toHaveLength(2);

    const again = await (await handleAdminRevertUserEdits(adminRequest('/x', { since, execute: true }), f.env, 'p1'))
      .json() as AdminRevertEditsResponse;
    expect(again.reverted).toEqual([]);
    expect(again.rooms.every((room) => room.action === 'skip')).toBe(true);
  });

  it('restores rooms the user claimed by publishing over them, but not rooms with anyone else\'s later work', async () => {
    const f = setup();
    const hijacked = addRoom(f, 5, 'p1', [['p2', 'Orphan'], ['p1', 'Defaced']]);
    const mixed = addRoom(f, 6, 'p2', [['p2', 'Good'], ['p1', 'Defaced'], ['p3', 'Repair'], ['p1', 'Defaced again']]);
    const drafted = addRoom(f, 7, 'p2', [['p2', 'Good'], ['p1', 'Defaced']]);
    f.sqlite.prepare("UPDATE rooms SET draft_json = json_set(draft_json, '$.updatedAt', '2026-10-06T00:00:00.000Z') WHERE id = ?").run(drafted);
    const since = '2026-10-05T00:30:00.000Z';
    const preview = await (await handleAdminRevertUserEdits(adminRequest('/x', { since }), f.env, 'p1')).json() as AdminRevertEditsResponse;
    expect(Object.fromEntries(preview.rooms.map((room) => [room.roomId, [room.action, room.reason]]))).toEqual({
      [hijacked]: ['revert', null], [mixed]: ['skip', 'changed_since'], [drafted]: ['skip', 'newer_draft'],
    });
    await handleAdminRevertUserEdits(adminRequest('/x', { since, execute: true }), f.env, 'p1');
    expect(f.sqlite.prepare('SELECT claimer_user_id, published_title FROM rooms WHERE id = ?').get(hijacked))
      .toEqual({ claimer_user_id: null, published_title: 'Orphan' });
    expect(preview.rooms.find((entry) => entry.roomId === mixed)?.hideableVersions).toBe(1);
    // The room someone repaired is left as it is, but the user's older version still leaves History.
    expect(f.sqlite.prepare('SELECT version, title FROM room_versions WHERE room_id = ? ORDER BY version').all(mixed)).toEqual([
      { version: 1, title: 'Good' }, { version: 2, title: 'Hidden by moderation' }, { version: 3, title: 'Repair' }, { version: 4, title: 'Defaced again' },
    ]);
  });

  it('refuses to restore a room that was published again after the plan was made', async () => {
    const f = setup();
    const room = addRoom(f, 8, 'p2', [['p2', 'Good'], ['p1', 'Defaced']]);
    const { revertRoom } = await import('../rooms/store');
    await expect(revertRoom(f.env, room, { x: 8, y: 0 }, 1, {
      ownerUser: null, principalKind: 'user', principalAgentId: null, principalDisplayName: 'WAMP moderation', requestAuthSource: null,
    }, true, { expectedLatestVersion: 1 })).rejects.toMatchObject({ status: 409 });
  });

  it('revokes the account\'s API and bot tokens when it is suspended', async () => {
    const f = setup();
    f.sqlite.exec(`INSERT INTO api_tokens (id, user_id, label, token_hash, scopes_json, created_at)
      VALUES ('t1', 'p1', 'Bot', 'hash-1', '["rooms:write"]', '2026-10-01');
      INSERT INTO agents (id, owner_user_id, display_name, created_at, updated_at)
      VALUES ('a1', 'p1', 'Helper', '2026-10-01', '2026-10-01');
      INSERT INTO agent_tokens (id, agent_id, label, token_hash, scopes_json, created_at, created_by_user_id)
      VALUES ('at1', 'a1', 'Bot', 'hash-2', '["rooms:write"]', '2026-10-01', 'p1');`);
    await handleAdminUserSuspension(adminRequest('/x', { suspended: true, reason: 'raid' }), f.env, 'p1');
    expect(f.sqlite.prepare('SELECT revoked_at IS NOT NULL AS revoked FROM api_tokens').get()).toEqual({ revoked: 1 });
    expect(f.sqlite.prepare('SELECT revoked_at IS NOT NULL AS revoked FROM agent_tokens').get()).toEqual({ revoked: 1 });
  });

  it('hides restored-over versions everywhere players can see them, and never restores to them (F189)', async () => {
    const f = setup();
    const room = addRoom(f, 9, 'p2', [['p2', 'Good'], ['p1', 'Rude title']]);
    await handleAdminRevertUserEdits(adminRequest('/x', { since: '2026-10-05T00:30:00.000Z', execute: true }), f.env, 'p1');
    expect(f.sqlite.prepare('SELECT version, redacted_at IS NOT NULL AS hidden FROM room_versions WHERE room_id = ? ORDER BY version').all(room))
      .toEqual([{ version: 1, hidden: 0 }, { version: 2, hidden: 1 }, { version: 3, hidden: 0 }]);
    const page = await loadRoomVersionPage(f.env, room, 10, null);
    expect(page.versions.map((entry) => entry.title)).toEqual(['Good', 'Hidden by moderation', 'Good']);
    const url = new URL(`https://api.wamp.land/api/rooms/${encodeURIComponent(room)}/versions/2`);
    const response = await handleRoomRequest(new Request(url, { headers: { Origin: 'https://wamp.land' } }), url, f.env);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300');
    const exact = await response.json() as { snapshot: { title: string; placedObjects: unknown[] } };
    expect(exact.snapshot.title).toBe('Hidden by moderation');
    const referenced = await loadRoomSnapshotsByReferences(f.env, [{ kind: 'version', roomId: room, version: 2 }]);
    expect(referenced.snapshots[0].snapshot.title).toBe('Hidden by moderation');
    await expect(revertRoom(f.env, room, { x: 9, y: 0 }, 2, {
      ownerUser: null, principalKind: 'user', principalAgentId: null, principalDisplayName: 'WAMP moderation', requestAuthSource: null,
    }, true)).rejects.toMatchObject({ status: 409 });
    await expect(handleAdminRoomVersionVisibility(adminRequest('/x', {}), f.env, room, 3, true)).rejects.toMatchObject({ status: 409 });
    expect(f.sqlite.prepare('SELECT title, redacted_title FROM room_versions WHERE room_id = ? AND version = 2').get(room))
      .toEqual({ title: 'Hidden by moderation', redacted_title: 'Rude title' });
    const recordUrl = new URL(`https://api.wamp.land/api/rooms/${encodeURIComponent(room)}`);
    const record = await (await handleRoomRequest(new Request(recordUrl, { headers: { Origin: 'https://wamp.land' } }), recordUrl, f.env))
      .json() as { versions: Array<{ version: number; snapshot: { title: string } }> };
    expect(record.versions.map((entry) => entry.snapshot.title)).toEqual(['Good', 'Hidden by moderation', 'Good']);
    expect((await handleAdminRoomVersionVisibility(adminRequest('/x', { reason: 'mistake' }), f.env, room, 2, false)).status).toBe(200);
    expect(f.sqlite.prepare('SELECT redacted_at, title, redacted_title FROM room_versions WHERE room_id = ? AND version = 2').get(room))
      .toEqual({ redacted_at: null, title: 'Rude title', redacted_title: null });
  });

  it('hides every version the user published over the restore target, even before the undo window (F189)', async () => {
    const f = setup();
    const room = addRoom(f, 10, 'p2', [['p2', 'Good'], ['p1', 'Early'], ['p1', 'Late']]);
    f.sqlite.prepare('UPDATE rooms SET canonical_version = 2 WHERE id = ?').run(room);
    await handleAdminRevertUserEdits(adminRequest('/x', { since: '2026-10-05T01:30:00.000Z', execute: true }), f.env, 'p1');
    // A leaderboard pinned to a hidden version goes back to the default, and can't be pinned there again.
    expect(f.sqlite.prepare('SELECT canonical_version FROM rooms WHERE id = ?').get(room)).toEqual({ canonical_version: null });
    await expect(setCanonicalRoomVersion(f.env, room, { x: 10, y: 0 }, 2, {
      ownerUser: null, principalKind: 'user', principalAgentId: null, principalDisplayName: 'WAMP moderation', requestAuthSource: null,
    }, true)).rejects.toMatchObject({ status: 409 });
    expect(f.sqlite.prepare('SELECT version, title FROM room_versions WHERE room_id = ? ORDER BY version').all(room)).toEqual([
      { version: 1, title: 'Good' }, { version: 2, title: 'Hidden by moderation' }, { version: 3, title: 'Hidden by moderation' },
      { version: 4, title: 'Good' },
    ]);
    // A later bulk restore never picks a hidden version as its target.
    const again = addRoom(f, 11, 'p2', [['p2', 'Good'], ['p3', 'Other vandal'], ['p1', 'Defaced']]);
    await handleAdminRoomVersionVisibility(adminRequest('/x', {}), f.env, again, 2, true);
    const preview = await (await handleAdminRevertUserEdits(adminRequest('/x', { since: '2026-10-05T01:30:00.000Z' }), f.env, 'p1'))
      .json() as AdminRevertEditsResponse;
    expect(preview.rooms.find((entry) => entry.roomId === again)?.targetVersion).toBe(1);
  });

  it('rejects a missing or invalid start time', async () => {
    const f = setup();
    await expect(handleAdminRevertUserEdits(adminRequest('/x', { since: 'soon' }), f.env, 'p1'))
      .rejects.toMatchObject({ status: 400 });
  });
});

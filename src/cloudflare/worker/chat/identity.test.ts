import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NOW, fixture } from '../activity/testDatabase';
import { createSession } from '../auth/store';
import { handleChatRequest } from './routes';
import { handleRoomCommentCreate } from '../roomComments/routes';
import { createSchoolClassroom, createSchoolStudent } from '../school/store';
import { createChatAdmin, createChatBan, createChatMessage, listChatAdmins, listChatBans,
  listChatMessages, searchChatMentionUsers } from './store';
import { createRoomComment, listAdminRoomComments, listApprovedRoomComments,
  listBrowseRoomCommentSummaries, loadAdminRoomComment, type RoomCommentTarget } from '../roomComments/store';

let f: ReturnType<typeof fixture>;
let owner: string;
beforeEach(async () => {
  f = fixture(); f.env.CHAT_OWNER_EMAILS = 'builder@example.test';
  for (const [id, username] of [['builder', 'owner_account'], ['p1', 'first_account'], ['p2', 'second_account']]) {
    f.sqlite.prepare('UPDATE users SET display_name = ?, username = ? WHERE id = ?')
      .run(id === 'builder' ? 'Owner' : 'Shared name', username, id);
  }
  owner = await createSession(f.env, 'builder');
});
afterEach(() => f.sqlite.close());
async function grant(body: unknown, cookie: string | null = owner, origin = 'https://wamp.land') {
  const request = new Request('https://api.wamp.land/api/chat/moderation/admins', { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: `ep_session=${cookie}` } : {}) },
    body: JSON.stringify(body) });
  return handleChatRequest(request, new URL(request.url), f.env);
}
const target = (roomId = '0,0', roomVersion = 1): RoomCommentTarget => ({ roomId, roomVersion,
  roomTitle: 'Fixture', coordinates: { x: Number(roomId.split(',')[0]), y: 0 }, builderUserId: 'builder',
  builderDisplayName: 'Owner', builderEmail: 'builder@example.test', areaScope: null });
async function comment(userId: string, options: { roomId?: string; version?: number; approved?: boolean } = {}) {
  return createRoomComment(f.env, { target: target(options.roomId, options.version), localX: 60, localY: 200,
    body: 'A comment', authorUserId: userId, authorDisplayName: 'Shared name',
    authorUsername: userId === 'p1' ? 'first_account' : 'second_account', ipHash: null, userAgent: null,
    createdAt: NOW, ...(options.approved === false ? {} : { autoApproval: { trustTier: 'T1' as const } }) });
}

describe('stable chat moderation identity', () => {
  it('grants the explicitly selected namesake and lists unique account handles without emails', async () => {
    const response = await grant({ userId: 'p2', displayName: 'Shared name' });
    expect(response.status).toBe(201); expect(await response.json()).toMatchObject({ userId: 'p2' });
    expect(f.sqlite.prepare('SELECT user_id FROM chat_admins').all()).toEqual([{ user_id: 'p2' }]);
    const admins = await listChatAdmins(f.env);
    expect(admins).toEqual([expect.objectContaining({ userId: 'p2', displayName: 'Shared name', username: 'second_account',
      grantedByUserId: 'builder', grantedByUsername: 'owner_account' })]);
    expect(JSON.stringify(admins)).not.toContain('@example.test');
  });
  it.each([{}, { displayName: 'Shared name' }, { userId: '' }, { userId: 1 }])('rejects missing or invalid stable IDs (%j)', async body => {
    await expect(grant(body)).rejects.toMatchObject({ status: 400 });
    expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM chat_admins').get()).toEqual({ n: 0 });
  });
  it('never falls back to a matching display name when the selected ID is unknown', async () => {
    await expect(grant({ userId: 'missing', displayName: 'Shared name' })).rejects.toMatchObject({ status: 404 });
    expect(await listChatAdmins(f.env)).toEqual([]);
  });
  it('requires an owner cookie and a trusted origin', async () => {
    await expect(grant({ userId: 'p2' }, null)).rejects.toMatchObject({ status: 401 });
    const ordinary = await createSession(f.env, 'p1');
    await expect(grant({ userId: 'p2' }, ordinary)).rejects.toMatchObject({ status: 403 });
    await createChatAdmin(f.env, 'p1', 'builder', NOW);
    await expect(grant({ userId: 'p2' }, ordinary)).rejects.toMatchObject({ status: 403 });
    await expect(grant({ userId: 'p2' }, owner, 'https://untrusted.example')).rejects.toMatchObject({ status: 403 });
    expect((await listChatAdmins(f.env)).map(a => a.userId)).toEqual(['p1']);
  });
  it('preserves self, existing-owner, existing-admin and banned-target guards', async () => {
    await expect(grant({ userId: 'builder' })).rejects.toMatchObject({ status: 403 });
    f.env.CHAT_OWNER_EMAILS += ',p1@example.test';
    await expect(grant({ userId: 'p1' })).rejects.toMatchObject({ status: 400 });
    await createChatAdmin(f.env, 'p2', 'builder', NOW);
    await expect(grant({ userId: 'p2' })).rejects.toMatchObject({ status: 409 });
    await createChatBan(f.env, 'p3', 'builder', NOW);
    await expect(grant({ userId: 'p3' })).rejects.toMatchObject({ status: 409 });
  });
  it('searches shared names, exact handles, spaces and literal SQL wildcard characters', async () => {
    expect((await searchChatMentionUsers(f.env, 'Shared name')).map(u => u.userId)).toEqual(['p1', 'p2']);
    expect(await searchChatMentionUsers(f.env, '@second_account')).toEqual([
      { userId: 'p2', displayName: 'Shared name', username: 'second_account' }]);
    await createChatMessage(f.env, 'p1', 'Shared name', 'Recent', NOW);
    expect(await searchChatMentionUsers(f.env, '%')).toEqual([]);
    expect((await searchChatMentionUsers(f.env, 'first_')).map(u => u.userId)).toEqual(['p1']);
  });
  it('returns current handles for both bounded chat pages while preserving captured names and message order', async () => {
    for (const [id, userId, at] of [['a', 'p1', '01'], ['b', 'p2', '02'], ['c', 'p1', '03']]) {
      await createChatMessage(f.env, userId, 'Shared name', id, `2026-10-04T17:00:${at}.000Z`, id);
    }
    f.sqlite.prepare("UPDATE users SET username = 'renamed_account' WHERE id = 'p1'").run();
    expect(await listChatMessages(f.env, 2, null)).toEqual([
      expect.objectContaining({ id: 'b', userDisplayName: 'Shared name', userUsername: 'second_account' }),
      expect.objectContaining({ id: 'c', userUsername: 'renamed_account' }),
    ]);
    expect((await listChatMessages(f.env, 2, '2026-10-04T17:00:01.000Z')).map(m => m.id)).toEqual(['b', 'c']);
    f.sqlite.prepare("UPDATE users SET username = NULL WHERE id = 'p2'").run();
    expect((await listChatMessages(f.env, 2, null))[0]).toMatchObject({ userDisplayName: 'Shared name', userUsername: null });
  });
  it('includes the signed-in handle in a newly posted message', async () => {
    const cookie = await createSession(f.env, 'p2');
    const request = new Request('https://api.wamp.land/api/chat/messages', { method: 'POST',
      headers: { Origin: 'https://wamp.land', Cookie: `ep_session=${cookie}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hello' }) });
    expect(await (await handleChatRequest(request, new URL(request.url), f.env)).json())
      .toMatchObject({ userId: 'p2', userDisplayName: 'Shared name', userUsername: 'second_account' });
  });
  it('retains classroom read-only chat while excluding posting, account search and admin grants', async () => {
    const classroom = await createSchoolClassroom(new Request('https://wamp.land'), f.env,
      { slug: 'identity-class', displayName: 'Identity', teacherEmail: 'teacher@example.test' });
    const { student } = await createSchoolStudent(f.env, classroom, 'student');
    const cookie = await createSession(f.env, student.userId);
    const read = new Request('https://api.wamp.land/api/chat/messages', { headers: { Cookie: `ep_session=${cookie}` } });
    expect(await (await handleChatRequest(read, new URL(read.url), f.env)).json()).toMatchObject({ viewer: { role: 'none', banned: false } });
    for (const path of ['/api/chat/mention-users?q=Shared']) {
      const request = new Request('https://api.wamp.land' + path, { headers: { Cookie: `ep_session=${cookie}` } });
      await expect(handleChatRequest(request, new URL(request.url), f.env)).rejects.toMatchObject({ status: 403 });
    }
    const post = new Request('https://api.wamp.land/api/chat/messages', { method: 'POST',
      headers: { Origin: 'https://wamp.land', Cookie: `ep_session=${cookie}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Blocked' }) });
    await expect(handleChatRequest(post, new URL(post.url), f.env)).rejects.toMatchObject({ status: 403 });
    await expect(grant({ userId: 'p2' }, cookie)).rejects.toMatchObject({ status: 403 });
  });

  it('disambiguates ban records and their issuer using the existing bounded query', async () => {
    await createChatBan(f.env, 'p2', 'builder', NOW);
    expect(await listChatBans(f.env)).toEqual([expect.objectContaining({ userId: 'p2', username: 'second_account',
      bannedByUsername: 'owner_account' })]);
  });
});

describe('comment author identity', () => {
  it('returns the authenticated username from the actual comment creation handler', async () => {
    const cookie = await createSession(f.env, 'p2');
    const request = new Request('https://api.wamp.land/api/rooms/0%2C0/comments', { method: 'POST',
      headers: { Origin: 'https://wamp.land', Cookie: `ep_session=${cookie}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomVersion: 1, position: { x: 80, y: 260 }, body: 'Useful note' }) });
    const response = await handleRoomCommentCreate(request, new URL(request.url), f.env, '0,0');
    expect(response.status).toBe(201); expect(await response.json()).toMatchObject({ status: 'pending_review',
      comment: { authorUserId: 'p2', authorDisplayName: 'Shared name', authorUsername: 'second_account' } });
  });

  it('returns create/public/admin handles and a legacy null without changing approval or version filtering', async () => {
    const created = await comment('p2'); expect(created.authorUsername).toBe('second_account');
    await comment('p1', { approved: false }); await comment('p1', { version: 2 });
    expect(await listApprovedRoomComments(f.env, target(), 80)).toEqual([
      expect.objectContaining({ id: created.id, authorDisplayName: 'Shared name', authorUsername: 'second_account' })]);
    expect(await loadAdminRoomComment(f.env, created.id)).toMatchObject({ authorUsername: 'second_account' });
    expect((await listAdminRoomComments(f.env, 'all', 80)).every(c => c.authorUsername)).toBe(true);
    f.sqlite.prepare("UPDATE users SET username = NULL WHERE id = 'p2'").run();
    expect((await listApprovedRoomComments(f.env, target(), 80))[0]).toMatchObject({ authorUsername: null, authorDisplayName: 'Shared name' });
  });
  it('keeps expanded cell/version scope with distinct author identities', async () => {
    const first = await comment('p1'); const second = await comment('p2', { roomId: '1,0', version: 7 });
    await comment('p1', { roomId: '1,0', version: 6 });
    const expanded: RoomCommentTarget = { ...target(), areaScope: { expandedRoomId: 'expanded-fixture',
      expandedRoomVersion: 1, title: 'Expanded', anchorCoordinates: { x: 0, y: 0 }, focusedCoordinates: { x: 0, y: 0 },
      cellCount: 2, cells: [{ roomId: '0,0', roomVersion: 1, coordinates: { x: 0, y: 0 } },
        { roomId: '1,0', roomVersion: 7, coordinates: { x: 1, y: 0 } }] } };
    const rows = await listApprovedRoomComments(f.env, expanded, 80);
    expect(new Set(rows.map(c => c.id))).toEqual(new Set([first.id, second.id]));
    expect(new Set(rows.map(c => c.authorUsername))).toEqual(new Set(['first_account', 'second_account']));
  });
  it('includes author handles in actual set-based expanded browse summaries without changing target scope', async () => {
    f.sqlite.prepare(`INSERT INTO playable_content_index
      (target_key,target_type,content_id,version_key,representative_room_id,room_x,room_y,published_at,first_published_at,anchor_x,anchor_y,source_type,updated_at)
      VALUES ('expanded_room:fixture','expanded_room','fixture',1,'0,0',0,0,?,?,0,0,'native',?)`).run(NOW,NOW,NOW);
    f.sqlite.exec(`INSERT INTO playable_content_index_members VALUES ('expanded_room:fixture','0,0',1);`);
    const created = await comment('p2');
    const rows = await listBrowseRoomCommentSummaries(f.env, ['0,0'], 12);
    expect(rows).toEqual([expect.objectContaining({ commentCount: 1,
      comments: [expect.objectContaining({ id: created.id, authorDisplayName: 'Shared name', authorUsername: 'second_account' })] })]);
  });
});

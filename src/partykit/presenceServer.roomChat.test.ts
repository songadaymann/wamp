import { afterEach, describe, expect, it } from 'vitest';
import { fixture, NOW } from '../cloudflare/worker/activity/testDatabase';
import type { RoomChatPermission } from '../presence/identityToken';
import { ROOM_CHAT_PERMISSION_RECHECK_MS } from './roomChatModeration';
import {
  type FakePresenceConnection,
  PresenceServerHarness,
  presencePayload,
  sendPresence,
  testIdentity,
} from './presenceServer.testHarness';

let harness: PresenceServerHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

async function playerInRoom(
  id: string,
  options: { roomChat?: RoomChatPermission; guest?: boolean; userId?: string } = {},
): Promise<FakePresenceConnection> {
  const connection = await harness!.connect(id, {
    channel: 'room-chat',
    roomChat: options.roomChat,
    ...(options.guest ? { source: 'guest' as const, identity: { ...testIdentity(id), userId: `guest-${id}-0000-0000` } } : {}),
    ...(options.userId ? { identity: { ...testIdentity(id), userId: options.userId } } : {}),
  });
  sendPresence(harness!, connection, presencePayload({ mode: 'play' }));
  connection.sent.length = 0;
  return connection;
}

function say(connection: FakePresenceConnection, text: string): void {
  harness!.server.onMessage(JSON.stringify({ type: 'room-chat:say', text }), connection.asPartyConnection());
}

const bubblesReceived = (connection: FakePresenceConnection) =>
  connection.sent.map((raw) => JSON.parse(raw) as { type: string }).filter((message) => message.type === 'room-chat:message');

describe('in-room speech bubbles', () => {
  it('reach other signed-in players in the room', async () => {
    harness = new PresenceServerHarness();
    const alice = await playerInRoom('alice', { roomChat: 'ok' });
    const bob = await playerInRoom('bob', { roomChat: 'ok' });
    say(alice, 'hi bob');
    expect(bubblesReceived(bob)).toHaveLength(1);
  });

  it('are refused from guests, chat-banned players and classroom accounts, whatever the client sends', async () => {
    harness = new PresenceServerHarness();
    const listener = await playerInRoom('listener', { roomChat: 'ok' });
    say(await playerInRoom('guest', { guest: true }), 'hello');
    say(await playerInRoom('banned', { roomChat: 'muted' }), 'hello');
    say(await playerInRoom('student', { roomChat: 'school' }), 'hello');
    expect(bubblesReceived(listener)).toHaveLength(0);
  });

  it('are never delivered to classroom accounts', async () => {
    harness = new PresenceServerHarness();
    const student = await playerInRoom('student', { roomChat: 'school' });
    const stranger = await playerInRoom('stranger', { roomChat: 'ok' });
    say(stranger, 'hey kid');
    expect(bubblesReceived(student)).toHaveLength(0);
  });

  it('still work for signed-in players whose token predates the permission claim', async () => {
    harness = new PresenceServerHarness();
    const alice = await playerInRoom('alice');
    const bob = await playerInRoom('bob');
    say(alice, 'hi');
    expect(bubblesReceived(bob)).toHaveLength(1);
  });

  it('stop for a connected player once a chat ban or suspension is recorded', async () => {
    const db = fixture();
    harness = new PresenceServerHarness({ env: { DB: db.env.DB } });
    const listener = await playerInRoom('listener', { roomChat: 'ok' });
    const banned = await playerInRoom('banned', { roomChat: 'ok', userId: 'p1' });
    const suspended = await playerInRoom('suspended', { roomChat: 'ok', userId: 'p2' });
    say(banned, 'before');
    say(suspended, 'before');
    expect(bubblesReceived(listener)).toHaveLength(2);

    db.sqlite.prepare("INSERT INTO chat_bans (user_id, banned_by_user_id, created_at) VALUES ('p1', 'builder', ?)").run(NOW);
    db.sqlite.prepare("UPDATE users SET suspended_at = ? WHERE id = 'p2'").run(NOW);
    listener.sent.length = 0;
    await harness.advance(ROOM_CHAT_PERMISSION_RECHECK_MS);
    say(banned, 'after');
    say(suspended, 'after');
    await harness.settleAsyncWork();
    expect(bubblesReceived(listener)).toHaveLength(0);
    expect(banned.state?.canSendRoomChat).toBe(false);
    expect(suspended.state?.canSendRoomChat).toBe(false);
  });

  it('read the database at most once a minute per sender', async () => {
    const db = fixture();
    let reads = 0;
    const counted = { prepare: (sql: string) => { reads += 1; return db.env.DB.prepare(sql); } };
    harness = new PresenceServerHarness({ env: { DB: counted } });
    const listener = await playerInRoom('listener', { roomChat: 'ok' });
    const alice = await playerInRoom('alice', { roomChat: 'ok', userId: 'p3' });
    await harness.advance(ROOM_CHAT_PERMISSION_RECHECK_MS);
    for (let index = 0; index < 5; index += 1) {
      say(alice, `hello ${index}`);
      await harness.settleAsyncWork();
      await harness.advance(2_000);
    }
    expect(reads).toBe(1);
    expect(bubblesReceived(listener)).toHaveLength(5);
  });
});

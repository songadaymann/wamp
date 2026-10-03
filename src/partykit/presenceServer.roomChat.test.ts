import { afterEach, describe, expect, it } from 'vitest';
import type { RoomChatPermission } from '../presence/identityToken';
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
  options: { roomChat?: RoomChatPermission; guest?: boolean } = {},
): Promise<FakePresenceConnection> {
  const connection = await harness!.connect(id, {
    channel: 'room-chat',
    roomChat: options.roomChat,
    ...(options.guest ? { source: 'guest' as const, identity: { ...testIdentity(id), userId: `guest-${id}-0000-0000` } } : {}),
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
});

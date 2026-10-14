import { afterEach, describe, expect, it } from 'vitest';
import { PresenceServerHarness, presencePayload, sendPresence, testIdentity, createTestConstructionPreviewToken, sendRoomPreview, roomPreviewPayload } from './presenceServer.testHarness';
import type { RoomChatPermission } from '../presence/identityToken';

let harness: PresenceServerHarness;
afterEach(() => harness?.dispose());
const bubbles = (connection: Awaited<ReturnType<PresenceServerHarness['connect']>>) =>
  connection.messages<{ type: string; message: { text: string } }>().filter((m) => m.type === 'room-chat:message');

async function player(id: string, options: { sharedRoomChat?: boolean; channel?: string; roomChat?: RoomChatPermission; guest?: boolean } = {}) {
  const connection = await harness.connect(id, { ...options,
    ...(options.guest ? { source: 'guest' as const, identity: { ...testIdentity(id), userId: `guest-${id}-0000` } } : {}) });
  sendPresence(harness, connection, presencePayload({ mode: 'play' }));
  return connection;
}
function say(connection: Awaited<ReturnType<typeof player>>, text: string) {
  harness.server.onMessage(JSON.stringify({ type: 'room-chat:say', text }), connection.asPartyConnection());
}

describe('shared presence and room chat', () => {
  it('negotiates explicitly, retains presence, and delivers both directions with legacy chat', async () => {
    harness = new PresenceServerHarness();
    const shared = await player('shared', { sharedRoomChat: true, roomChat: 'ok' });
    const legacy = await player('legacy', { channel: 'room-chat', roomChat: 'ok' });
    const plain = await player('plain');
    expect(shared.messages().find((m) => (m as { type: string }).type === 'snapshot')).toMatchObject({ roomChat: true });
    expect(plain.messages().find((m) => (m as { type: string }).type === 'snapshot')).toMatchObject({ roomChat: false });
    say(shared, 'shared to legacy');
    say(legacy, 'legacy to shared');
    expect(bubbles(shared).map((m) => m.message.text)).toEqual(['shared to legacy', 'legacy to shared']);
    expect(bubbles(legacy)).toHaveLength(2);
    expect(bubbles(plain)).toHaveLength(0);
    say(plain, 'cannot send without capability');
    expect(bubbles(shared)).toHaveLength(2);
    await harness.advance(250);
    expect(shared.messages().find((m) => (m as { type: string }).type === 'populations')).toMatchObject({ roomPopulations: { '1,2': 2 } });
  });

  it('keeps signed permissions authoritative even when capability is requested', async () => {
    harness = new PresenceServerHarness();
    const listener = await player('listener', { sharedRoomChat: true, roomChat: 'ok' });
    const student = await player('student', { sharedRoomChat: true, roomChat: 'school' });
    const muted = await player('muted', { sharedRoomChat: true, roomChat: 'muted' });
    const guest = await player('guest', { sharedRoomChat: true, guest: true });
    for (const connection of [student, muted, guest]) say(connection, 'rejected');
    expect(bubbles(listener)).toHaveLength(0);
    say(listener, 'allowed');
    expect(bubbles(student)).toHaveLength(0);
    expect(bubbles(muted)).toHaveLength(1);
    expect(bubbles(guest)).toHaveLength(1);
  });

  it('enforces room/play scope and the existing rate limit on the shared connection', async () => {
    harness = new PresenceServerHarness();
    const alice = await player('alice', { sharedRoomChat: true });
    const bob = await player('bob', { sharedRoomChat: true });
    say(alice, 'first');say(alice, 'too soon');
    expect(bubbles(bob)).toHaveLength(1);
    await harness.advance(1000);
    sendPresence(harness, bob, presencePayload({ mode: 'play', roomX: 3 }));
    say(alice, 'other room');
    expect(bubbles(bob)).toHaveLength(1);
    sendPresence(harness, bob, presencePayload({ mode: 'browse' }));
    say(bob, 'not playing');
    expect(bubbles(alice)).toHaveLength(2);
    harness.server.onMessage(JSON.stringify({ type: 'presence:leave' }), alice.asPartyConnection());
    await harness.advance(1000);say(alice, 'left');
    expect(bubbles(alice)).toHaveLength(2);
  });
  it('completes the peer close handshake without replying again to a closed socket', async () => {
    harness = new PresenceServerHarness();
    const closing = await player('closing', { sharedRoomChat: true });
    Object.defineProperty(closing, 'readyState', { value: WebSocket.CLOSING });
    harness.close(closing);
    expect(closing.closes).toEqual([{ code: 1000, reason: 'peer-disconnected' }]);
    const closed = await player('closed', { sharedRoomChat: true });
    Object.defineProperty(closed, 'readyState', { value: WebSocket.CLOSED });
    harness.close(closed);
    expect(closed.closes).toEqual([]);
  });

  it('keeps construction previews and PvP invites on the same shared presence connection', async () => {
    harness = new PresenceServerHarness();
    const alice = await harness.connect('alice', { sharedRoomChat: true, previewDeltas: true });
    const bob = await harness.connect('bob', { sharedRoomChat: true, previewDeltas: true });
    sendPresence(harness, alice, presencePayload({ mode: 'edit' }));
    sendPresence(harness, bob, presencePayload({ mode: 'play' }));
    const token = await createTestConstructionPreviewToken(testIdentity('alice'), { x: 1, y: 2 });
    sendRoomPreview(harness, alice, roomPreviewPayload({ token }));
    await harness.waitUntilPreviewStored('preview:1,2');await harness.advance(250);
    expect(bob.messages().some((m) => (m as { type: string }).type === 'preview:upsert')).toBe(true);
    say(alice, 'not while editing');expect(bubbles(bob)).toHaveLength(0);
    sendPresence(harness, alice, presencePayload({ mode: 'play' }));await harness.advance(250);
    expect(bob.messages().some((m) => (m as { type: string }).type === 'preview:remove')).toBe(true);
    harness.server.onMessage(JSON.stringify({ type: 'pvp:invite', invite: { inviteId: 'invite', matchId: 'match', mode: 'arena', roomId: '1,2', roomCoordinates: { x: 1, y: 2 }, targetConnectionId: bob.id, target: testIdentity('bob'), expiresAt: Date.now() + 5000 } }), alice.asPartyConnection());
    expect(bob.messages().some((m) => (m as { type: string }).type === 'pvp:invite:offer')).toBe(true);
    say(alice, 'after editing');expect(bubbles(bob)).toHaveLength(1);
  });

});
